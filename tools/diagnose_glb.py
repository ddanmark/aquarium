import json
import math
import struct
import sys

for path in sys.argv[1:]:
    print('=' * 70)
    print(path)
    d = open(path, 'rb').read()
    magic, ver, total = struct.unpack('<III', d[:12])
    print('  magic %s  version %d  声明长度 %d  实际 %d' %
          (d[:4].decode(errors='replace'), ver, total, len(d)))
    off = 12
    chunks = []
    while off < len(d):
        clen, ctype = struct.unpack('<II', d[off:off + 8])
        chunks.append((ctype, clen))
        off += 8 + clen
    jl = struct.unpack('<I', d[12:16])[0]
    g = json.loads(d[20:20 + jl])
    o = 20 + jl
    blen = struct.unpack('<I', d[o:o + 4])[0]
    BIN = d[o + 8:o + 8 + blen]
    print('  chunks %s' % [(hex(c), n) for c, n in chunks])
    print('  binary 声明 %d  实际 %d  %s' % (blen, len(BIN), 'OK' if blen == len(BIN) else '❌不一致'))

    tris = 0
    for m in g['meshes']:
        for p in m['primitives']:
            if 'indices' in p:
                tris += g['accessors'][p['indices']]['count'] // 3

    # 顶点属性检查
    bad = []
    for ai, a in enumerate(g['accessors']):
        bv = g['bufferViews'][a['bufferView']]
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        cs = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}[a['componentType']]
        need = a['count'] * nc * cs
        if need > bv['byteLength']:
            bad.append('acc%d 越界 need=%d bv=%d' % (ai, need, bv['byteLength']))
        if bv.get('byteOffset', 0) + bv['byteLength'] > blen:
            bad.append('acc%d bufferView 越界' % ai)
    print('  accessor 越界: %s' % (bad[:5] if bad else '无'))

    # 原始数组内容
    def raw(ai):
        a = g['accessors'][ai]
        bv = g['bufferViews'][a['bufferView']]
        s = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        f = {5126: 'f', 5123: 'H', 5125: 'I', 5121: 'B'}[a['componentType']]
        sz = {5126: 4, 5123: 2, 5125: 4, 5121: 1}[a['componentType']]
        n = a['count'] * nc
        return struct.unpack('<%d%s' % (n, f), BIN[s:s + n * sz])

    prim = g['meshes'][0]['primitives'][0]
    pos = raw(prim['attributes']['POSITION'])
    nan = sum(1 for v in pos if not math.isfinite(v))
    xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
    print('  顶点 %d  面 %d  primitives %d  材质 %d' %
          (len(pos) // 3, tris, len(g['meshes'][0]['primitives']), len(g.get('materials', []))))
    print('  POSITION NaN/Inf: %d   bbox x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]' %
          (nan, min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))

    # 索引越界
    if 'indices' in prim:
        idx = raw(prim['indices'])
        print('  索引 %d 个  最大 %d  顶点数 %d  %s' %
              (len(idx), max(idx), len(pos) // 3, 'OK' if max(idx) < len(pos) // 3 else '❌越界'))

    # 蒙皮
    if g.get('skins'):
        sk = g['skins'][0]
        print('  skin: 骨 %d  IBM accessor %s' % (len(sk['joints']), sk.get('inverseBindMatrices')))
        if 'JOINTS_0' in prim['attributes']:
            jj = raw(prim['attributes']['JOINTS_0'])
            print('    JOINTS_0 最大 %d（骨数 %d）%s' %
                  (max(jj), len(sk['joints']), 'OK' if max(jj) < len(sk['joints']) else '❌越界'))
        if 'WEIGHTS_0' in prim['attributes']:
            w = raw(prim['attributes']['WEIGHTS_0'])
            suma = g['accessors'][prim['attributes']['WEIGHTS_0']].get('normalized', False)
            scale = 255.0 if suma else 1.0
            s0 = w[0:4]
            print('    WEIGHTS_0 首个顶点 %s  归一化=%s  和=%.3f' %
                  (s0, suma, sum(s0) / scale))
    else:
        print('  无 skin')

    if g.get('animations'):
        an = g['animations'][0]
        print('  动画 %r  采样器 %d  通道 %d' % (an.get('name'), len(an['samplers']), len(an['channels'])))
        t = raw(an['samplers'][0]['input'])
        print('    时间轴 %d 帧  %.3f..%.3f 秒' % (len(t), t[0], t[-1]))
    print('  images %s' % [(im['mimeType'], g['bufferViews'][im['bufferView']]['byteLength']) for im in g.get('images', [])])
    print('  extensionsUsed %s' % g.get('extensionsUsed'))
