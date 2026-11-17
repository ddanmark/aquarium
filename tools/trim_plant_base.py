"""裁掉 AI 水草 GLB 自带的「灰边塑料盆 / 砂盘底座」，只删底座那一层，不碰植株。

为什么不直接用 trim_decor_base.py：那个工具按固定比例切掉底部 9%，
对细长水草会连根带茎一起切。水草的底座是「一块又宽又薄的圆盘」，
特征是半径≈全模型最大半径、厚度只有总高的百分之几、且顶点极密，
按这个特征自动识别盘厚，切得干净也不会误伤。

判定（两端都试，取更像盘的一端）：
  盘层厚度 = 自该端向内扫层，直到某层 rmax < 0.88 * 全局 rmax
  盘层厚度必须 <= 总高 3.5%，否则认为是整株形态（比如莫斯团块底部本来就最宽），不切
  —— 用 8% 时莫斯团块会被误判成盘，一次砍掉 24% 的面

用法:
  python3 tools/trim_plant_base.py <in.glb> <out.glb> [--dry]
"""
import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
FMT = {5126: 'f', 5123: 'H', 5125: 'I', 5121: 'B'}
SZ = {5126: 4, 5123: 2, 5125: 4, 5121: 1}


def read_acc(g, bin_data, i):
    a = g['accessors'][i]
    bv = g['bufferViews'][a['bufferView']]
    st = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n, t, c = a['count'], a['type'], a['componentType']
    nc = NC[t]
    fmt, sz = FMT[c], SZ[c]
    raw = struct.unpack('<%d%s' % (n * nc, fmt), bin_data[st:st + n * nc * sz])
    return [raw[k * nc:(k + 1) * nc] for k in range(n)], fmt, sz


def write_glb(path, g, segs, views):
    out = bytearray()
    nv = []
    for i, seg in enumerate(segs):
        while len(out) % 4:
            out.append(0)
        v = dict(views[i])
        v['byteOffset'] = len(out)
        v['byteLength'] = len(seg)
        nv.append(v)
        out.extend(seg)
    g['bufferViews'] = nv
    g['buffers'][0]['byteLength'] = len(out) + (4 - len(out) % 4) % 4
    js = json.dumps(g, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    bn = bytes(out) + b'\0' * ((4 - len(out) % 4) % 4)
    with open(path, 'wb') as fp:
        fp.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(bn)))
        fp.write(struct.pack('<I4s', len(js), b'JSON'))
        fp.write(js)
        fp.write(struct.pack('<I4s', len(bn), b'BIN\0'))
        fp.write(bn)


def plate_depth(P, n, hi_end):
    """返回盘层厚度（沿 Z），hi_end=True 表示底座在 z 最大端。"""
    zs = [p[2] for p in P]
    zmin, zmax = min(zs), max(zs)
    H = zmax - zmin
    cx = sum(p[0] for p in P) / n
    cy = sum(p[1] for p in P) / n
    rmax_all = max(((p[0] - cx) ** 2 + (p[1] - cy) ** 2) ** 0.5 for p in P)
    if rmax_all <= 0:
        return 0.0, H

    steps, layer = 80, H / 80
    depth = 0.0
    for s in range(steps):
        if hi_end:
            hi, lo = zmax - s * layer, zmax - (s + 1) * layer
        else:
            hi, lo = zmin + (s + 1) * layer, zmin + s * layer
        rl = 0.0
        for p in P:
            z = p[2]
            if lo < z <= hi:
                r = ((p[0] - cx) ** 2 + (p[1] - cy) ** 2) ** 0.5
                if r > rl:
                    rl = r
        if rl < rmax_all * 0.88:
            break
        depth = (s + 1) * layer
    return depth, H


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry' in sys.argv
    if len(args) < 1:
        print(__doc__)
        raise SystemExit(1)
    src = args[0]
    dst = args[1] if len(args) > 1 else src.replace('.glb', '_nobase.glb')

    d = open(src, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    g = json.loads(d[20:20 + jl])
    off = 20 + jl
    blen = struct.unpack('<I', d[off:off + 4])[0]
    bin_data = d[off + 8:off + 8 + blen]
    views = g['bufferViews']
    segs = [bin_data[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in views]

    prim = g['meshes'][0]['primitives'][0]
    P, _, _ = read_acc(g, bin_data, prim['attributes']['POSITION'])
    IDX, fmt, sz = read_acc(g, bin_data, prim['indices'])
    n = len(P)

    d_hi, H = plate_depth(P, n, True)
    d_lo, _ = plate_depth(P, n, False)
    use_hi = d_hi >= d_lo
    depth = d_hi if use_hi else d_lo
    base = os.path.basename(src)
    if depth <= 0 or depth > H * 0.035:
        print('%s: 未识别到底座盘（上端 %.3f / 下端 %.3f / 总高 %.3f），原样输出'
              % (base, d_hi, d_lo, H))
        if not dry:
            open(dst, 'wb').write(d)
        return

    zs = [p[2] for p in P]
    zmin, zmax = min(zs), max(zs)
    cut = (zmax - depth) if use_hi else (zmin + depth)

    kept = []
    for t in range(0, len(IDX), 3):
        tri = IDX[t:t + 3]
        inside = all((P[int(v[0])][2] > cut) if use_hi else (P[int(v[0])][2] < cut) for v in tri)
        if inside:
            continue
        kept.extend(int(v[0]) for v in tri)

    removed = (len(IDX) - len(kept)) // 3
    print('%s: 底座在 %s端，盘厚 %.4f（总高 %.3f），删 %d / %d 面，剩 %d 面'
          % (base, 'z 最大' if use_hi else 'z 最小', depth, H, removed, len(IDX) // 3, len(kept) // 3))
    if dry:
        return

    acc = dict(g['accessors'][prim['indices']])
    acc['count'] = len(kept)
    g['accessors'][prim['indices']] = acc
    vi = acc['bufferView']
    segs[vi] = struct.pack('<%d%s' % (len(kept), fmt), *kept)
    write_glb(dst, g, segs, views)


if __name__ == '__main__':
    main()
