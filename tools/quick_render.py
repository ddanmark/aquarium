"""极简软件光栅化：把 GLB 渲染成 PNG（仅用于离线比对，不做骨骼变换）。

用法: python3 tools/quick_render.py <in.glb> <out.png> [宽] [高]
"""
import io
import json
import math
import os
import struct
import sys

from PIL import Image

VFLIP = os.environ.get('TEXVFLIP', '0') == '1'

SRC, DST = sys.argv[1], sys.argv[2]
W = int(sys.argv[3]) if len(sys.argv) > 3 else 560
H = int(sys.argv[4]) if len(sys.argv) > 4 else 440

raw = open(SRC, 'rb').read()
off = 12
jl = struct.unpack('<I', raw[off:off + 4])[0]
g = json.loads(raw[off + 8:off + 8 + jl])
o = off + 8 + jl
blen = struct.unpack('<I', raw[o:o + 4])[0]
BIN = raw[o + 8:o + 8 + blen]


def read_acc(i):
    a = g['accessors'][i]
    bv = g['bufferViews'][a['bufferView']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = a['count']
    t = a['type']
    c = a['componentType']
    nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[t]
    fmt = {5126: 'f', 5123: 'H', 5125: 'I', 5121: 'B'}[c]
    size = {5126: 4, 5123: 2, 5125: 4, 5121: 1}[c]
    data = struct.unpack('<%d%s' % (n * nc, fmt), BIN[start:start + n * nc * size])
    return [data[k * nc:(k + 1) * nc] for k in range(n)]


prim = g['meshes'][0]['primitives'][0]
P = read_acc(prim['attributes']['POSITION'])
N = read_acc(prim['attributes']['NORMAL']) if 'NORMAL' in prim['attributes'] else None
UV = read_acc(prim['attributes']['TEXCOORD_0']) if 'TEXCOORD_0' in prim['attributes'] else None
IDX = [int(v[0]) for v in read_acc(prim['indices'])]

# 视图变换：默认看 XY 平面（Z 为深度）。
# QR_AXIS=z  → 模型长轴在 -Z（AI 文生 3D 摆件常见），先转成 Y-up 再渲；
# QR_VIEW=top → 俯视贴水面的极扁模型（浮萍），把 XZ 当屏幕平面。
_AXIS = os.environ.get('QR_AXIS', 'y')
_VIEW = os.environ.get('QR_VIEW', 'front')
if _AXIS == 'z' or _VIEW == 'top':
    P = [(x, -z, y) for (x, y, z) in P]
    if N:
        N = [(nx, -nz, ny) for (nx, ny, nz) in N]
elif _AXIS == 'x':
    P = [(y, -x, z) for (x, y, z) in P]
    if N:
        N = [(ny, -nx, nz) for (nx, ny, nz) in N]

# 基础色贴图
tex = None
mat = g['materials'][prim.get('material', 0)]
bct = mat.get('pbrMetallicRoughness', {}).get('baseColorTexture')
if bct:
    src = g['textures'][bct['index']]['source']
    im = g['images'][src]
    bv = g['bufferViews'][im['bufferView']]
    s0 = bv.get('byteOffset', 0)
    tex = Image.open(io.BytesIO(BIN[s0:s0 + bv['byteLength']])).convert('RGB')

xs = [p[0] for p in P]
ys = [p[1] for p in P]
zs = [p[2] for p in P]
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
span = max(max(xs) - min(xs), max(ys) - min(ys), 1e-6)
# AI 摆件常自带一块砂质圆盘底座；缩略图里按高度裁掉最底部一小截。
# 运行时 render.js 用 model.baseCut 把同一块底座埋进底砂。
CUT = float(os.environ.get('QR_CUT', '0'))
CUT_Y = min(ys) + (max(ys) - min(ys)) * CUT if CUT > 0 else None
k = min(W, H) * 0.86 / span

BG = os.environ.get('QR_BG', '236,239,243')
try:
    _bg = tuple(int(v) for v in BG.split(','))
except Exception:
    _bg = (236, 239, 243)
img = Image.new('RGB', (W, H), _bg)
px = img.load()
zbuf = [[-1e18] * W for _ in range(H)]

L = (0.42, 0.62, 0.66)
ln = math.sqrt(sum(c * c for c in L))
L = tuple(c / ln for c in L)


def to_screen(p):
    return (W * 0.5 + (p[0] - cx) * k, H * 0.5 - (p[1] - cy) * k, p[2])


for t in range(0, len(IDX), 3):
    ia, ib, ic = IDX[t], IDX[t + 1], IDX[t + 2]
    if CUT_Y is not None and max(P[ia][1], P[ib][1], P[ic][1]) < CUT_Y:
        continue                      # 整片三角形都落在底座切片里
    a, b, c = to_screen(P[ia]), to_screen(P[ib]), to_screen(P[ic])
    minx = max(0, int(min(a[0], b[0], c[0])))
    maxx = min(W - 1, int(max(a[0], b[0], c[0])) + 1)
    miny = max(0, int(min(a[1], b[1], c[1])))
    maxy = min(H - 1, int(max(a[1], b[1], c[1])) + 1)
    if minx > maxx or miny > maxy:
        continue
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-9:
        continue
    nrm = N[ia] if N else (0, 0, 1)
    lz = nrm[2]
    shade = abs(nrm[0] * L[0] + nrm[1] * L[1] + nrm[2] * L[2])
    shade = 0.32 + 0.78 * shade
    if shade != shade:      # 法线里有 NaN（个别模型导出时留下的）时退化成平光
        shade = 0.72
    for y in range(miny, maxy + 1):
        for x in range(minx, maxx + 1):
            w0 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d
            w1 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d
            w2 = 1 - w0 - w1
            if w0 < 0 or w1 < 0 or w2 < 0:
                continue
            z = w0 * a[2] + w1 * b[2] + w2 * c[2]
            if z <= zbuf[y][x]:
                continue
            zbuf[y][x] = z
            if tex and UV:
                u = w0 * UV[ia][0] + w1 * UV[ib][0] + w2 * UV[ic][0]
                v = w0 * UV[ia][1] + w1 * UV[ib][1] + w2 * UV[ic][1]
                tu = int((u % 1.0) * (tex.width - 1))
                tv = int((1 - (v % 1.0)) * (tex.height - 1)) if VFLIP else int((v % 1.0) * (tex.height - 1))
                r, gg, bb = tex.getpixel((tu, tv))[:3]   # 有些 GLB 的基础色图是 RGBA
            else:
                r = gg = bb = 190
            px[x, y] = (min(255, int(r * shade)), min(255, int(gg * shade)), min(255, int(bb * shade)))

img.save(DST)
print('渲染完成 ->', DST, '  顶点', len(P), ' 三角面', len(IDX) // 3)
