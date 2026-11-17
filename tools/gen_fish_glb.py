"""参数化生成一条带骨骼动画的神仙鱼 GLB（零额度、零外部依赖）。

对照实验用：同样的物种、同样的尺寸，对比 AI 文生 3D 与代码建模两条路线。
用法: python3 tools/gen_fish_glb.py <out.glb>
"""
import io
import json
import math
import struct
import sys

from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else 'models/_test/param_angelfish.glb'

# ---------------- 体型参数（归一化体长 = 1，头在 +X） ----------------
# 神仙鱼：极高、极侧扁
H_CTRL = [(0.00, 0.020), (0.06, 0.100), (0.18, 0.265), (0.34, 0.400), (0.50, 0.425),
          (0.66, 0.340), (0.80, 0.185), (0.90, 0.100), (1.00, 0.060)]
W_CTRL = [(0.00, 0.008), (0.06, 0.030), (0.18, 0.060), (0.34, 0.076), (0.50, 0.070),
          (0.66, 0.050), (0.80, 0.028), (0.90, 0.016), (1.00, 0.010)]


def interp(ctrl, s):
    for i in range(len(ctrl) - 1):
        a, b = ctrl[i], ctrl[i + 1]
        if a[0] <= s <= b[0]:
            t = (s - a[0]) / max(b[0] - a[0], 1e-9)
            t = t * t * (3 - 2 * t)
            return a[1] + (b[1] - a[1]) * t
    return ctrl[-1][1]


def x_of(s):
    return 0.5 - s


def yc(s):
    return 0.018 * math.sin(math.pi * min(s * 1.15, 1.0))


def cross_section(s, th, p=1.35):
    h = interp(H_CTRL, s)
    w = interp(W_CTRL, s)
    ct, st = math.cos(th), math.sin(th)
    y = h * math.copysign(abs(ct) ** p, ct)
    z = w * math.copysign(abs(st) ** p, st)
    return x_of(s), yc(s) + y, z


N, M = 44, 22          # 体干分段：沿体长 / 环向
V, UV, T = [], [], []  # 顶点、UV、三角形
IDX = []


def push(x, y, z, u, v):
    V.append((x, y, z))
    UV.append((u, v))
    return len(V) - 1


# ---------------- 体干 ----------------
grid = []
for i in range(N + 1):
    s = i / N
    row = []
    for j in range(M):
        th = 2 * math.pi * j / M
        x, y, z = cross_section(s, th)
        row.append(push(x, y, z, s, 0.76 * j / M))
    grid.append(row)

for i in range(N):
    for j in range(M):
        a = grid[i][j]
        b = grid[i][(j + 1) % M]
        c = grid[i + 1][(j + 1) % M]
        d = grid[i + 1][j]
        IDX += [a, b, c, a, c, d]

# ---------------- 鳍：单面薄片，双面材质 ----------------
FIN_UV = (0.5, 0.93)


def add_strip(inner_pts, outer_pts):
    """两排点之间生成一条带子（inner 贴体、outer 是鳍缘）"""
    global IDX
    n = len(inner_pts)
    base = len(V)
    for (x, y, z) in inner_pts:
        push(x, y, z, *FIN_UV)
    for (x, y, z) in outer_pts:
        push(x, y, z, *FIN_UV)
    for i in range(n - 1):
        a = base + i
        b = base + i + 1
        c = base + n + i + 1
        d = base + n + i
        IDX += [a, b, c, a, c, d]


def body_point(s, th, grow=1.0):
    x, y, z = cross_section(s, th)
    return (x, yc(s) + (y - yc(s)) * grow, z * grow)


# 背鳍：沿背线从 s=0.20 到 0.82，向后上方展开
K = 16
inn, out = [], []
for i in range(K + 1):
    s = 0.20 + 0.62 * i / K
    inn.append(body_point(s, 0.0, 1.0))
    h = interp(H_CTRL, s)
    span = 0.235 * math.sin(math.pi * (0.10 + 0.90 * (i / K))) ** 0.85
    lean = -0.20 * (i / K) ** 1.6           # 向后倾
    out.append((x_of(s) + lean, yc(s) + h + span, 0.0))
add_strip(inn, out)

# 臀鳍：腹线镜像，范围略靠后
inn, out = [], []
for i in range(K + 1):
    s = 0.34 + 0.52 * i / K
    inn.append(body_point(s, math.pi, 1.0))
    h = interp(H_CTRL, s)
    span = 0.19 * math.sin(math.pi * (0.10 + 0.90 * (i / K))) ** 0.85
    lean = -0.12 * (i / K) ** 1.5
    out.append((x_of(s) + lean, yc(s) - h - span, 0.0))
add_strip(inn, out)

# 尾鳍：从体尾的竖直根线段向扇形展开
LF = 14
h_tail = interp(H_CTRL, 0.985)
inn, out = [], []
for i in range(LF + 1):
    t = i / LF
    yy = (t - 0.5) * 2 * h_tail
    inn.append((x_of(0.955), yc(1.0) + yy * 1.15, 0.0))
    ang = (t - 0.5) * math.pi * 0.86
    rad = 0.235 - 0.075 * abs(t - 0.5) * 2
    out.append((x_of(1.0) - rad * math.cos(ang), yc(1.0) + rad * 1.05 * math.sin(ang), 0.0))
add_strip(inn, out)

# 胸鳍：左右各一片小扇
for side in (-1, 1):
    inn, out = [], []
    for i in range(7):
        t = i / 6
        s = 0.34 + 0.10 * t
        x, y, z = cross_section(s, 0.0)
        inn.append((x, yc(s) - 0.02, side * interp(W_CTRL, s) * 0.9))
        out.append((x - 0.13 * (0.4 + 0.6 * t), yc(s) - 0.10 - 0.07 * t,
                    side * (interp(W_CTRL, s) + 0.085 * (0.3 + 0.7 * t))))
    add_strip(inn, out)

# ---------------- 法线 ----------------
NRM = []
for (x, y, z) in V:
    NRM.append(None)

# 体干：解析近似（用参数微分）
for i in range(N + 1):
    s = i / N
    for j in range(M):
        th = 2 * math.pi * j / M
        e = 1e-3
        s0, s1 = max(0.0, s - e), min(1.0, s + e)
        p = cross_section(s, th)
        ds = tuple((cross_section(s1, th)[k] - cross_section(s0, th)[k]) for k in range(3))
        dth = tuple((cross_section(s, th + e)[k] - cross_section(s, th - e)[k]) for k in range(3))
        nx = ds[1] * dth[2] - ds[2] * dth[1]
        ny = ds[2] * dth[0] - ds[0] * dth[2]
        nz = ds[0] * dth[1] - ds[1] * dth[0]
        L = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
        NRM[grid[i][j]] = (nx / L, ny / L, nz / L)

import array

for i, nv in enumerate(NRM):
    if nv is None:
        NRM[i] = (0.0, 0.0, 1.0)

# ---------------- 骨骼与蒙皮 ----------------
K_JOINTS = 9
U_CUTS = [0.0, 0.13, 0.27, 0.41, 0.55, 0.68, 0.79, 0.89, 1.0]
joints = [(x_of(u), yc(u), 0.0) for u in U_CUTS]

JOINTS_B = bytearray()
WEIGHTS_B = bytearray()
for (x, y, z) in V:
    u = min(max((0.5 - x) / 1.0, 0.0), 1.0)
    seg = K_JOINTS - 2
    for k in range(K_JOINTS - 1):
        if u <= U_CUTS[k + 1] or k == K_JOINTS - 2:
            seg = k
            break
    t = min(max((u - U_CUTS[seg]) / max(U_CUTS[seg + 1] - U_CUTS[seg], 1e-9), 0.0), 1.0)
    w0 = round((1 - t) * 255)
    JOINTS_B += bytes((seg, seg + 1, 0, 0))
    WEIGHTS_B += bytes((w0, 255 - w0, 0, 0))

IBM = bytearray()
for p in joints:
    IBM += struct.pack('<16f', 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1)

# ---------------- 动画 ----------------
CYCLE, WAVES, N_KEYS, TIP = 0.9, 0.92, 32, 0.07


def ang(phase, base):
    return [base * (U_CUTS[k] ** 1.7) * math.sin(phase - 2 * math.pi * WAVES * U_CUTS[k])
            for k in range(K_JOINTS)]


def tip_z(th):
    pos = list(joints[0])
    a = 0.0
    for k in range(1, K_JOINTS):
        a += th[k]
        dx = joints[k][0] - joints[k - 1][0]
        pos[0] += dx * math.cos(a)
        pos[2] += -dx * math.sin(a)
    return pos[2]


peak = max(abs(tip_z(ang(k * 2 * math.pi / 24, 1.0))) for k in range(24))
BASE = TIP / max(peak, 1e-9)
times, quats = [], [[] for _ in range(K_JOINTS)]
for k in range(N_KEYS + 1):
    tt = CYCLE * k / N_KEYS
    times.append(tt)
    for j, th in enumerate(ang(2 * math.pi * tt / CYCLE, BASE)):
        quats[j] += [0.0, math.sin(th * 0.5), 0.0, math.cos(th * 0.5)]

# ---------------- 贴图 ----------------
TW, TH = 512, 128
img = Image.new('RGB', (TW, TH), (196, 208, 214))
d = ImageDraw.Draw(img)
bands = [(0.10, 0.19), (0.34, 0.43), (0.58, 0.67)]
for a, b in bands:
    d.rectangle([int(a * TW), 0, int(b * TW), int(TH * 0.78) - 1], fill=(38, 46, 56))
# 腹部渐亮
for y in range(int(TH * 0.55), int(TH * 0.78)):
    k = (y - TH * 0.55) / (TH * 0.23)
    d.line([(0, y), (TW, y)], fill=(int(196 + 40 * k), int(208 + 34 * k), int(214 + 28 * k)))
# 鳍色带
for y in range(0, int(TH * 0.14)):
    k = y / max(1, TH * 0.14)
    d.line([(0, y), (TW, y)], fill=(int(206 - 30 * k), int(196 - 34 * k), int(166 - 38 * k)))
buf = io.BytesIO()
img.save(buf, 'JPEG', quality=90)
IMG = buf.getvalue()

# ---------------- 组装 glTF ----------------
bin_parts = bytearray()
views = []
accs = []


def add_view(data, target=None):
    while len(bin_parts) % 4:
        bin_parts.append(0)
    v = {'buffer': 0, 'byteOffset': len(bin_parts), 'byteLength': len(data)}
    if target:
        v['target'] = target
    views.append(v)
    bin_parts.extend(data)
    return len(views) - 1


def add_acc(data, ctype, atype, count, target=34962, mn=None, mx=None, normalized=False):
    vi = add_view(data, target)
    a = {'bufferView': vi, 'componentType': ctype, 'count': count, 'type': atype}
    if normalized:
        a['normalized'] = True
    if mn is not None:
        a['min'] = mn
        a['max'] = mx
    accs.append(a)
    return len(accs) - 1


pos = array.array('f')
for v in V:
    pos.extend(v)
nrm = array.array('f')
for n in NRM:
    nrm.extend(n)
uv = array.array('f')
for t in UV:
    uv.extend(t)
idx = array.array('H')
idx.extend(IDX)

xs = [v[0] for v in V]
ys = [v[1] for v in V]
zs = [v[2] for v in V]

a_pos = add_acc(pos.tobytes(), 5126, 'VEC3', len(V), mn=[min(xs), min(ys), min(zs)], mx=[max(xs), max(ys), max(zs)])
a_nrm = add_acc(nrm.tobytes(), 5126, 'VEC3', len(V))
a_uv = add_acc(uv.tobytes(), 5126, 'VEC2', len(V))
a_idx = add_acc(idx.tobytes(), 5123, 'SCALAR', len(IDX), target=34963)
a_j = add_acc(bytes(JOINTS_B), 5121, 'VEC4', len(V))
a_w = add_acc(bytes(WEIGHTS_B), 5121, 'VEC4', len(V), normalized=True)
a_ibm = add_acc(bytes(IBM), 5126, 'MAT4', K_JOINTS, target=None)
a_t = add_acc(struct.pack('<%df' % len(times), *times), 5126, 'SCALAR', len(times),
              target=None, mn=[times[0]], mx=[times[-1]])
q_accs = []
for j in range(K_JOINTS):
    q_accs.append(add_acc(struct.pack('<%df' % len(quats[j]), *quats[j]), 5126, 'VEC4',
                          len(times), target=None))
a_img = add_view(IMG)

gltf = {
    'asset': {'version': '2.0', 'generator': 'parametric-fish-generator'},
    'scene': 0,
    'scenes': [{'nodes': [0, 1]}],
    'nodes': [{'mesh': 0, 'name': 'param_fish', 'skin': 0}],
    'meshes': [{'name': 'param_fish', 'primitives': [{
        'attributes': {'POSITION': a_pos, 'NORMAL': a_nrm, 'TEXCOORD_0': a_uv,
                       'JOINTS_0': a_j, 'WEIGHTS_0': a_w},
        'indices': a_idx, 'material': 0}]}],
    'materials': [{
        'name': 'fish',
        'doubleSided': True,
        'pbrMetallicRoughness': {
            'baseColorTexture': {'index': 0},
            'metallicFactor': 0.0,
            'roughnessFactor': 0.42,
        },
    }],
    'textures': [{'sampler': 0, 'source': 0}],
    'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
    'images': [{'bufferView': a_img, 'mimeType': 'image/jpeg'}],
    'skins': [{'name': 'spine', 'joints': [1 + k for k in range(K_JOINTS)],
               'inverseBindMatrices': a_ibm, 'skeleton': 1}],
    'animations': [{
        'name': 'Swim',
        'samplers': [{'input': a_t, 'output': q_accs[j], 'interpolation': 'LINEAR'} for j in range(K_JOINTS)],
        'channels': [{'sampler': j, 'target': {'node': 1 + j, 'path': 'rotation'}} for j in range(K_JOINTS)],
    }],
    'accessors': accs,
    'bufferViews': views,
    'buffers': [{'byteLength': len(bin_parts)}],
}

for k, p in enumerate(joints):
    node = {'name': 'spine_%02d' % k}
    if k == 0:
        node['translation'] = list(p)
    else:
        prev = joints[k - 1]
        node['translation'] = [p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]]
    if k < K_JOINTS - 1:
        node['children'] = [2 + k]
    gltf['nodes'].append(node)

while len(bin_parts) % 4:
    bin_parts.append(0)
gltf['buffers'] = [{'byteLength': len(bin_parts)}]

js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
while len(js) % 4:
    js += b' '
glb = bytearray()
glb += struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_parts))
glb += struct.pack('<II', len(js), 0x4E4F534A) + js
glb += struct.pack('<II', len(bin_parts), 0x004E4942) + bytes(bin_parts)

import os
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'wb').write(glb)
print('顶点 %d  三角面 %d  贴图 %dKB  文件 %.1f KB' %
      (len(V), len(IDX) // 3, len(IMG) // 1024, len(glb) / 1024))
print('写入', OUT)
