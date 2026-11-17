"""程序化生成水草 / 石头 GLB（零生成额度、纯 Python + Pillow）。

与 gen-fish-models.js 的区别：摆件不需要骨骼与动画，输出无 skin 的静态 glTF 2.0。
所有模型统一为 Y-up、底部贴 y=0，可直接交给 render.js 的 buildGlbPlant / buildGlbRock。

用法: python3 tools/gen_decor_glb.py
输出: models/<id>.glb   （水草 5 种 + 石头 3 种）
之后跑 node tools/build-models.js 与 python3 tools/make_thumbs.py。
"""
import io
import json
import math
import os
import random
import struct

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'models')
os.makedirs(OUT, exist_ok=True)


# ---------------------------------------------------------------- 网格容器
class Mesh(object):
    def __init__(self):
        self.pos = []
        self.nrm = []
        self.uv = []
        self.idx = []

    def vert(self, p, n, t):
        self.pos.extend([float(p[0]), float(p[1]), float(p[2])])
        self.nrm.extend([float(n[0]), float(n[1]), float(n[2])])
        self.uv.extend([float(t[0]), float(t[1])])
        return len(self.pos) // 3 - 1

    def tri(self, a, b, c):
        self.idx.extend([a, b, c])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def norm(a):
    l = math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
    if l < 1e-8:
        return (0.0, 1.0, 0.0)      # 退化面给个安全法线，避免 NaN 光照
    return (a[0] / l, a[1] / l, a[2] / l)


def add(a, b, k=1.0):
    return (a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k)


def quad(m, a, b, c, d, ua, ub):
    """四边形 a-b-c-d（顺时针），uv.x 沿 a→b，uv.y 0..1。"""
    n = norm(cross(sub(b, a), sub(d, a)))
    i0 = m.vert(a, n, (ua, 0.0))
    i1 = m.vert(b, n, (ub, 0.0))
    i2 = m.vert(c, n, (ub, 1.0))
    i3 = m.vert(d, n, (ua, 1.0))
    m.tri(i0, i1, i2)
    m.tri(i0, i2, i3)


def leaf(m, origin, direction, length, width, side=None, bend=0.0,
         droop=0.0, twist=0.0, segs=9, width_pow=0.75, u0=0.0, u1=1.0):
    """一片叶：沿 direction 生长的四边条带，宽度按 sin(pi t)^p 收尖。

    bend   : 末端向 side 方向的侧弯量（占长度比例）
    droop  : 末端下坠量（占长度比例）
    twist  : 叶面绕生长轴扭转的弧度
    """
    d = norm(direction)
    up = (0.0, 1.0, 0.0)
    if abs(d[1]) > 0.95:
        up = (0.0, 0.0, 1.0)
    s = side or norm(cross(d, up))
    prev = None
    for i in range(segs + 1):
        t = float(i) / segs
        w = width * max(0.02, math.sin(math.pi * t) ** width_pow) * (1.0 - 0.22 * t)
        ctr = add(origin, d, length * t)
        ctr = add(ctr, s, bend * length * t * t)
        ctr = (ctr[0], ctr[1] - droop * length * t * t, ctr[2])
        # 扭转：把侧向量绕生长轴缓慢转一点
        ang = twist * (t - 0.5)
        sx = add(s, norm(cross(d, s)), math.sin(ang) * 0.9)
        sx = norm(sx)
        left = add(ctr, sx, -w)
        right = add(ctr, sx, w)
        ua = u0 + (u1 - u0) * t
        if prev:
            quad(m, prev[0], left, right, prev[1], prev[2], ua)
        prev = (left, right, ua)


def tube(m, a, b, r0, r1, sides=6, segs=1):
    """一段圆锥/圆柱（茎、叶柄）。"""
    d = norm(sub(b, a))
    up = (0.0, 0.0, 1.0) if abs(d[2]) < 0.9 else (1.0, 0.0, 0.0)
    s = norm(cross(d, up))
    s2 = norm(cross(d, s))
    prev = None
    for i in range(segs + 1):
        t = float(i) / segs
        c = add(a, sub(b, a), t)
        r = r0 + (r1 - r0) * t
        ring = []
        for k in range(sides):
            ang = 2 * math.pi * k / sides
            p = add(add(c, s, math.cos(ang) * r), s2, math.sin(ang) * r)
            ring.append(p)
        if prev:
            for k in range(sides):
                k2 = (k + 1) % sides
                quad(m, prev[k], ring[k], ring[k2], prev[k2], t - 1.0 / segs, t)
        prev = ring


def blob(m, radius, seed, flatten=1.0, rough=0.16, lat=12, lon=18,
         base_y=None):
    """变形 UV 球：用确定性三角噪声做石头表面，底部压平贴 y=0。"""
    rnd = random.Random(seed)
    phase = [rnd.random() * 6.28 for _ in range(7)]

    def noise(u, v):
        return (math.sin(u * 5.1 + phase[0]) * math.cos(v * 4.3 + phase[1]) * .5
                + math.sin(u * 9.7 + phase[2] + v * 3.1) * .28
                + math.cos(u * 3.3 - v * 8.2 + phase[3]) * .22)

    if base_y is None:
        base_y = radius * flatten
    rings = []
    for i in range(lat + 1):
        th = math.pi * i / lat
        ring = []
        for k in range(lon + 1):
            ph = 2 * math.pi * k / lon
            u, v = k / lon, i / lat
            r = radius * (1.0 + rough * noise(u, v))
            x = r * math.sin(th) * math.cos(ph)
            y = r * math.cos(th) * flatten
            z = r * math.sin(th) * math.sin(ph)
            ring.append((x, y + base_y, z))
        rings.append(ring)
    for i in range(lat):
        for k in range(lon):
            a, b = rings[i][k], rings[i][k + 1]
            c, d = rings[i + 1][k + 1], rings[i + 1][k]
            quad(m, a, b, c, d, k / lon * 2.0, (k + 1) / lon * 2.0)


# ---------------------------------------------------------------- 贴图
def rgb(hexs):
    h = hexs.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def leaf_tex(c_dark, c_mid, c_light, vein):
    """叶贴图：u=沿叶长，v=叶宽。中脉 + 侧脉 + 明暗渐变。"""
    W, H = 256, 64
    im = Image.new('RGB', (W, H))
    px = im.load()
    dk, md, lt = rgb(c_dark), rgb(c_mid), rgb(c_light)
    for y in range(H):
        vy = abs(y / (H - 1) - .5) * 2          # 0=中脉 1=叶缘
        for x in range(W):
            u = x / (W - 1)
            base = tuple(int(dk[i] + (md[i] - dk[i]) * min(1, u * 1.7)) for i in range(3))
            base = tuple(int(base[i] + (lt[i] - base[i]) * (1 - vy) * .35) for i in range(3))
            # 中脉
            if vy < .06:
                base = rgb(vein)
            # 斜向侧脉
            elif abs(math.sin((u * 13 - vy * 4) * math.pi)) > .965:
                base = tuple(int(base[i] * .86 + rgb(vein)[i] * .14) for i in range(3))
            edge = 1.0 - vy * .28
            px[x, y] = tuple(max(0, min(255, int(base[i] * edge))) for i in range(3))
    return im


def rock_tex(c0, c1, seed, speck=0.55):
    W = H = 128
    rnd = random.Random(seed)
    a, b = rgb(c0), rgb(c1)
    im = Image.new('RGB', (W, H), a)
    d = ImageDraw.Draw(im)
    for _ in range(900):
        x, y = rnd.randrange(W), rnd.randrange(H)
        r = rnd.randrange(1, 6)
        k = rnd.random() * speck
        c = tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
        d.ellipse((x - r, y - r, x + r, y + r), fill=c)
    im = im.filter(ImageFilter.GaussianBlur(.6))
    return im


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


# ---------------------------------------------------------------- GLB 组装
def assemble(mesh, tex_png, out_path, name):
    blob = bytearray()
    views, accs = [], []

    def add_view(data, target=None):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(data)
        v = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            v['target'] = target
        views.append(v)
        return len(views) - 1

    def add_acc(data, comp, typ, ncomp, target=None, bounds=False):
        vi = add_view(data, target)
        a = {'bufferView': vi, 'componentType': comp, 'count': len(data) // (4 * ncomp), 'type': typ}
        if bounds:
            pts = list(zip(*[iter(struct.unpack('<%df' % (len(mesh.pos) // 3 * 3), data))] * 3))
            a['min'] = [min(p[i] for p in pts) for i in range(3)]
            a['max'] = [max(p[i] for p in pts) for i in range(3)]
        accs.append(a)
        return len(accs) - 1

    f = lambda seq: struct.pack('<%df' % len(seq), *seq)
    i32 = lambda seq: struct.pack('<%dI' % len(seq), *seq)

    a_pos = add_acc(f(mesh.pos), 5126, 'VEC3', 3, 34962, True)
    a_nrm = add_acc(f(mesh.nrm), 5126, 'VEC3', 3, 34962)
    a_uv = add_acc(f(mesh.uv), 5126, 'VEC2', 2, 34962)
    a_idx = add_acc(i32(mesh.idx), 5125, 'SCALAR', 1, 34963)
    a_img = add_view(tex_png)

    gltf = {
        'asset': {'version': '2.0', 'generator': 'gen_decor_glb.py'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'name': name, 'mesh': 0}],
        'meshes': [{'name': name, 'primitives': [{
            'attributes': {'POSITION': a_pos, 'NORMAL': a_nrm, 'TEXCOORD_0': a_uv},
            'indices': a_idx, 'material': 0}]}],
        'materials': [{'name': name + '_mat', 'doubleSided': True,
                       'pbrMetallicRoughness': {
                           'baseColorTexture': {'index': 0},
                           'metallicFactor': 0.0, 'roughnessFactor': .88}}],
        'textures': [{'source': 0}],
        'images': [{'bufferView': a_img, 'mimeType': 'image/png'}],
        'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
        'accessors': accs,
        'bufferViews': views,
        'buffers': [{'byteLength': len(blob) + (4 - len(blob) % 4) % 4}]
    }
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    bn = bytes(blob) + b'\0' * ((4 - len(blob) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(out_path, 'wb') as fp:
        fp.write(struct.pack('<4sII', b'glTF', 2, total))
        fp.write(struct.pack('<I4s', len(js), b'JSON'))
        fp.write(js)
        fp.write(struct.pack('<I4s', len(bn), b'BIN\0'))
        fp.write(bn)
    return os.path.getsize(out_path)


# ---------------------------------------------------------------- 各品种几何
def plant_moss():
    m = Mesh()
    r = random.Random(21)
    for i in range(46):
        a = r.random() * 2 * math.pi
        rad = .05 + r.random() * .34
        x, z = math.cos(a) * rad, math.sin(a) * rad
        h = .12 + r.random() * .20
        tube(m, (x, 0, z), (x * 1.1, h, z * 1.1), .012, .006, 5)
        for k in range(3):
            d = (math.cos(a + k * 2.1) * .55, .8, math.sin(a + k * 2.1) * .55)
            leaf(m, (x, h * (.35 + k * .2), z), d, .16, .045,
                 bend=.12, droop=.05, segs=5, width_pow=.6)
    return m


def plant_elodea():
    m = Mesh()
    r = random.Random(7)
    for st in range(5):
        a = r.random() * 2 * math.pi
        rad = r.random() * .12
        bx, bz = math.cos(a) * rad, math.sin(a) * rad
        H = .72 + r.random() * .28
        lean = (r.uniform(-.10, .10), 0, r.uniform(-.10, .10))
        tube(m, (bx, 0, bz), (bx + lean[0], H, bz + lean[2]), .017, .008, 6, 6)
        for j in range(9):
            t = (j + 1) / 10.0
            cx = bx + lean[0] * t
            cz = bz + lean[2] * t
            for k in range(4):
                ang = a + k * math.pi / 2 + j * .8
                d = (math.cos(ang) * .85, .28, math.sin(ang) * .85)
                leaf(m, (cx, H * t, cz), d, .20 - t * .05, .038,
                     bend=.08, droop=.10, segs=5, width_pow=.55)
    return m


def plant_sword():
    m = Mesh()
    r = random.Random(33)
    for i in range(11):
        a = 2 * math.pi * i / 11 + r.uniform(-.15, .15)
        L = .62 + r.random() * .38
        tip = (math.cos(a) * L * .52, L, math.sin(a) * L * .52)
        tube(m, (0, 0, 0), (tip[0] * .22, L * .28, tip[2] * .22), .020, .013, 6, 4)
        d = (tip[0] - tip[0] * .22, (L - L * .28) * 1.5, tip[2] - tip[2] * .22)
        leaf(m, (tip[0] * .22, L * .28, tip[2] * .22), d, L * .74, .105,
             bend=.06, droop=.13, twist=.12, segs=10, width_pow=.62)
    return m


def plant_duckweed():
    m = Mesh()
    r = random.Random(11)
    for i in range(30):
        a = r.random() * 2 * math.pi
        rad = r.random() * .34
        x, z = math.cos(a) * rad, math.sin(a) * rad
        w = .035 + r.random() * .03
        d = (math.cos(a + 1.2), .06, math.sin(a + 1.2))
        leaf(m, (x, .012, z), d, w * 2.4, w, bend=.02, segs=4, width_pow=.42)
    return m


def plant_hairgrass():
    m = Mesh()
    r = random.Random(5)
    for i in range(90):
        a = r.random() * 2 * math.pi
        rad = r.random() * .26
        x, z = math.cos(a) * rad, math.sin(a) * rad
        H = .34 + r.random() * .40
        d = (math.cos(a) * .22, 1.0, math.sin(a) * .22)
        leaf(m, (x, 0, z), d, H, .012, bend=.16, droop=.10, segs=6, width_pow=.28)
    return m


def rock_pebble():
    m = Mesh()
    blob(m, .50, 101, flatten=.72, rough=.13, lat=13, lon=20)
    return m


def rock_lava():
    m = Mesh()
    blob(m, .50, 202, flatten=.86, rough=.30, lat=15, lon=22)
    return m


def rock_slate():
    m = Mesh()
    blob(m, .50, 303, flatten=.40, rough=.20, lat=10, lon=14)
    return m


PLANTS = [
    ('moss', plant_moss, ('#244d24', '#5aa256', '#9ad36a', '#2c6a34')),
    ('elodea', plant_elodea, ('#245c2a', '#62a84f', '#a8d878', '#3d7a38')),
    ('sword', plant_sword, ('#245a34', '#5aa85a', '#a6d488', '#2f7040')),
    ('duckweed', plant_duckweed, ('#3c7a34', '#7cc25a', '#c2e890', '#4f8c40')),
    ('hairgrass', plant_hairgrass, ('#2f6a30', '#71b552', '#b4d97e', '#3f8038'))
]
ROCKS = [
    ('rock_pebble', rock_pebble, ('#5c6a68', '#9aa8a2', 41)),
    ('rock_lava', rock_lava, ('#2e2c2c', '#6a5a50', 42)),
    ('rock_slate', rock_slate, ('#414b52', '#7e8a90', 43))
]


def main():
    print('=== 水草 ===')
    for sid, fn, pal in PLANTS:
        m = fn()
        tex = png_bytes(leaf_tex(*pal))
        p = os.path.join(OUT, sid + '.glb')
        n = assemble(m, tex, p, sid)
        print('  %-12s %6d 顶点 %6d 面  %6.1f KB' %
              (sid, len(m.pos) // 3, len(m.idx) // 3, n / 1024.0))
    print('=== 石头 ===')
    for sid, fn, pal in ROCKS:
        m = fn()
        tex = png_bytes(rock_tex(pal[0], pal[1], pal[2]))
        p = os.path.join(OUT, sid + '.glb')
        n = assemble(m, tex, p, sid)
        print('  %-12s %6d 顶点 %6d 面  %6.1f KB' %
              (sid, len(m.pos) // 3, len(m.idx) // 3, n / 1024.0))


if __name__ == '__main__':
    main()
