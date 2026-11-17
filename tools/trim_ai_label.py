"""剔除 AI 生成模型里被烘进几何的「白色标签牌 / 水印底板」。

有些 3D 生成结果会把参考照片里的标牌一起建出来：它是几片位于鱼体下方的
薄平面（正反两面 + 四条边框），UV 落在贴图的白色标签带上，跟着鱼一起游。
这类标牌不是独立 primitive，按高度裁切会切掉鱼腹和腹鳍，必须按「连通分量 +
空间位置 + 平面度」识别后删三角面。

判据（在 rig_fish.py 产出的 Y-up 模型上）：
  · 分量整体位于鱼体下方：max(Y) < ymax
  · 是薄平面：Z 跨度 < zspan
  · 是片而不是碎点：顶点数 >= minverts，且 X 或 Y 跨度够大
只改 indices：把保留的索引写回原 bufferView 起始处、缩小 accessor.count，
BIN 长度、bufferView、顶点属性、贴图、骨骼、动画全部不动。
JSON chunk 用空格补齐到原长度，避免重写整个 GLB。

用法: python3 tools/trim_ai_label.py <in.glb> <out.glb> [ymax=0.30] [zspan=0.012] [minverts=60]
"""
import json
import struct
import sys
from collections import defaultdict

SRC, DST = sys.argv[1], sys.argv[2]
YMAX = float(sys.argv[3]) if len(sys.argv) > 3 else 0.30
ZSPAN = float(sys.argv[4]) if len(sys.argv) > 4 else 0.012
MINV = int(sys.argv[5]) if len(sys.argv) > 5 else 60

raw = bytearray(open(SRC, 'rb').read())
assert struct.unpack('<I', raw[:4])[0] == 0x46546C67, '不是 GLB'
jlen = struct.unpack('<I', raw[12:16])[0]
jstr = bytes(raw[20:20 + jlen])
g = json.loads(jstr)
BIN_OFF = 20 + jlen + 8

prim = g['meshes'][0]['primitives'][0]


def view_of(a):
    bv = g['bufferViews'][a['bufferView']]
    return BIN_OFF + bv.get('byteOffset', 0) + a.get('byteOffset', 0)


def read(a, fmt, nc):
    size = struct.calcsize(fmt)
    s = view_of(a)
    return list(struct.unpack('<%d%s' % (a['count'] * nc, fmt),
                             raw[s:s + a['count'] * nc * size]))


pa = g['accessors'][prim['attributes']['POSITION']]
P = read(pa, 'f', 3)
uv = prim['attributes'].get('TEXCOORD_0')
UV = read(g['accessors'][uv], 'f', 2) if uv is not None else [0.0] * (len(P) // 3 * 2)
ia = prim['indices']
acc = g['accessors'][ia]
fmt = {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'I'}[acc['componentType']]
IDX = read(acc, fmt, 1)

n = len(P) // 3
par = list(range(n))


def find(x):
    while par[x] != x:
        par[x] = par[par[x]]
        x = par[x]
    return x


def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        par[rb] = ra


tris = []
for t in range(len(IDX) // 3):
    a, b, c = IDX[3 * t], IDX[3 * t + 1], IDX[3 * t + 2]
    tris.append((a, b, c))
    union(a, b)
    union(a, c)

comp = defaultdict(list)
for v in range(n):
    comp[find(v)].append(v)

bad = set()
picked = []
for root, vs in comp.items():
    xs = [P[3 * v] for v in vs]
    ys = [P[3 * v + 1] for v in vs]
    zs = [P[3 * v + 2] for v in vs]
    sx, sy, sz = max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)
    if max(ys) < YMAX and sz < ZSPAN and len(vs) >= MINV and (sx > 0.50 or sy > 0.15):
        us = [UV[2 * v] for v in vs]
        vv = [UV[2 * v + 1] for v in vs]
        picked.append((len(vs), sx, sy, min(us), max(us), min(vv), max(vv)))
        bad.update(vs)

print('识别到标签牌分量 %d 个:' % len(picked))
for nv, sx, sy, u0, u1, v0, v1 in picked:
    print('   v=%5d 空间 %.2f×%.2f  UV %.2f..%.2f / %.2f..%.2f' %
          (nv, sx, sy, u0, u1, v0, v1))
if not picked:
    print('没有可删的分量，原样写出（可调 ymax / zspan / minverts）')

out = []
for t in tris:
    if t[0] not in bad and t[1] not in bad and t[2] not in bad:
        out.extend(t)
print('删除三角面 %d / %d，剩余 %d' % (len(tris) - len(out) // 3, len(tris), len(out) // 3))

struct.pack_into('<%d%s' % (len(out), fmt), raw, view_of(acc), *out)
g['accessors'][ia]['count'] = len(out)
if 'min' in g['accessors'][ia]:
    g['accessors'][ia]['min'] = [min(out)]
if 'max' in g['accessors'][ia]:
    g['accessors'][ia]['max'] = [max(out)]

nj = json.dumps(g, separators=(',', ':')).encode('utf-8')
assert len(nj) <= len(jstr), 'JSON 变长 %d > %d，需要重写 GLB' % (len(nj), len(jstr))
raw[20:20 + jlen] = nj + b' ' * (len(jstr) - len(nj))
open(DST, 'wb').write(raw)
print('写出', DST)
