"""裁掉 AI 摆件 GLB 自带的砂质圆盘底座（按几何删除，不是靠渲染时下沉）。

为什么必须改几何：render.js 的 model.baseCut 会把整株下移，但 syncCreatures 会
按生长比例缩放 g.scale.y = r，幼株时这点下沉量被一起缩小，砂盘又会露在砂面上。

约定：AI 摆件是 Z-up，底座在 z 最大端（约 z=0），植株朝 -Z 生长。
判定「整片三角形都落在底座切片内」才删，植株根部不会被误伤。

用法: python3 tools/trim_decor_base.py <in.glb> <out.glb> [cut=0.09]
"""
import io
import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_acc(g, bin_data, i):
    a = g['accessors'][i]
    bv = g['bufferViews'][a['bufferView']]
    st = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n, t, c = a['count'], a['type'], a['componentType']
    nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[t]
    fmt = {5126: 'f', 5123: 'H', 5125: 'I', 5121: 'B'}[c]
    sz = {5126: 4, 5123: 2, 5125: 4, 5121: 1}[c]
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


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(1)
    src, dst = sys.argv[1], sys.argv[2]
    cut = float(sys.argv[3]) if len(sys.argv) > 3 else 0.09

    d = open(src, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    g = json.loads(d[20:20 + jl])
    off = 20 + jl
    blen = struct.unpack('<I', d[off:off + 4])[0]
    bin_data = d[off + 8:off + 8 + blen]
    views = g['bufferViews']
    segs = [bin_data[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in views]

    prim = g['meshes'][0]['primitives'][0]
    ai, ii = prim['attributes']['POSITION'], prim['indices']
    P, _, _ = read_acc(g, bin_data, ai)
    IDX, fmt, sz = read_acc(g, bin_data, ii)
    zs = [p[2] for p in P]
    zmax, zmin = max(zs), min(zs)
    threshold = zmax - (zmax - zmin) * cut      # 底座切片：z > threshold

    kept = []
    for t in range(0, len(IDX), 3):
        tri = IDX[t:t + 3]
        if min(P[int(v[0])][2] for v in tri) > threshold:
            continue                              # 整片都在底座里
        kept.extend(int(v[0]) for v in tri)

    removed = (len(IDX) - len(kept)) // 3
    acc = dict(g['accessors'][ii])
    acc['count'] = len(kept)
    g['accessors'][ii] = acc
    vi = acc['bufferView']
    segs[vi] = struct.pack('<%d%s' % (len(kept), fmt), *kept)
    write_glb(dst, g, segs, views)
    print('%s → %s  删除 %d / %d 个三角面（底座切片 z > %.4f），剩余 %d 面' %
          (os.path.basename(src), os.path.basename(dst), removed, len(IDX) // 3,
           threshold, len(kept) // 3))


if __name__ == '__main__':
    main()
