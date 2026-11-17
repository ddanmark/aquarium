#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修复 GLB 里的零法线（模型渲染成全黑的元凶）。

成因：tools/gen-fish-models.js 的 mergeGeo() 把顶点索引重复乘了 3，
法线累加写到 Float32Array 之外被静默丢弃，导致约 2/3 的顶点法线留在 (0,0,0)。
Three.js 里 normalize(vec3(0)) 得到 NaN / 零向量，dot(N,L) 归零，漫反射全无，
鱼在 WebGL 图鉴展示台里就是纯黑；离线光栅化器有 NaN 兜底所以只是偏暗。

做法：从三角形重新累加面法线 -> 归一化 -> 原地写回 NORMAL bufferView。
只改 NORMAL 的字节，长度/偏移/贴图/骨骼/动画/材质全部不动，因此也适用于
已接入的资产；没有零法线的模型（AI 写实模型）直接跳过，不重写文件。

用法:
    python3 tools/fix_zero_normals.py              # 扫描 models/*.glb
    python3 tools/fix_zero_normals.py --dry-run    # 只报告不写
    python3 tools/fix_zero_normals.py models/a.glb models/b.glb
"""
import os
import sys
import glob
import json
import math
import struct

FMT = {5126: ('f', 4), 5125: ('I', 4), 5123: ('H', 2), 5121: ('B', 1)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def acc_info(j, ai):
    a = j['accessors'][ai]
    bv = j['bufferViews'][a['bufferView']]
    fmt, size = FMT[a['componentType']]
    n = NCOMP[a['type']]
    offset = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or size * n
    return a['count'], offset, stride, '<' + fmt * n, size * n


def read_acc(buf, base, j, ai):
    cnt, off, stride, fmt, _ = acc_info(j, ai)
    start = base + off
    return [struct.unpack_from(fmt, buf, start + i * stride) for i in range(cnt)]


def zero_count(normals):
    return sum(1 for v in normals if math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) < 0.01)


def fix_file(path, dry=False):
    raw = bytearray(open(path, 'rb').read())
    if len(raw) < 28 or raw[:4] != b'glTF':
        return None
    jl = struct.unpack_from('<I', raw, 12)[0]
    j = json.loads(bytes(raw[20:20 + jl]).decode('utf-8'))
    base = 28 + jl
    total_bad = 0
    changed = False

    for mesh in j.get('meshes', []):
        for prim in mesh.get('primitives', []):
            at = prim.get('attributes', {})
            if 'NORMAL' not in at or 'POSITION' not in at or 'indices' not in prim:
                continue
            if prim.get('mode', 4) != 4:
                continue
            try:
                P = read_acc(raw, base, j, at['POSITION'])
                N = read_acc(raw, base, j, at['NORMAL'])
                I = read_acc(raw, base, j, prim['indices'])
            except (KeyError, struct.error) as e:
                print('  ! 跳过 primitive（读取失败 %s）' % e)
                continue
            bad = zero_count(N)
            if not bad:
                continue

            cnt, off, stride, fmt, nbytes = acc_info(j, at['NORMAL'])
            if nbytes != 12:
                print('  ! 跳过：NORMAL 不是 VEC3 float')
                continue

            acc = [[0.0, 0.0, 0.0] for _ in P]
            for k in range(0, len(I) - 2, 3):
                ia, ib, ic = int(I[k][0]), int(I[k + 1][0]), int(I[k + 2][0])
                if ia >= len(P) or ib >= len(P) or ic >= len(P):
                    continue
                ax, ay, az = P[ia][:3]
                bx, by, bz = P[ib][:3]
                cx, cy, cz = P[ic][:3]
                e1 = (bx - ax, by - ay, bz - az)
                e2 = (cx - ax, cy - ay, cz - az)
                nx = e1[1] * e2[2] - e1[2] * e2[1]
                ny = e1[2] * e2[0] - e1[0] * e2[2]
                nz = e1[0] * e2[1] - e1[1] * e2[0]
                nl = math.sqrt(nx * nx + ny * ny + nz * nz)
                if nl < 1e-12:
                    continue
                nx, ny, nz = nx / nl, ny / nl, nz / nl
                for v in (ia, ib, ic):
                    acc[v][0] += nx
                    acc[v][1] += ny
                    acc[v][2] += nz

            start = base + off
            for v in range(cnt):
                x, y, z = acc[v]
                l = math.sqrt(x * x + y * y + z * z)
                # 孤立顶点（无三角形引用）不会被光栅化，但给个非零值防止任何路径算出 NaN
                if l < 1e-8:
                    x, y, z = 0.0, 0.0, 1.0
                else:
                    x, y, z = x / l, y / l, z / l
                if not dry:
                    struct.pack_into('<fff', raw, start + v * stride, x, y, z)
            total_bad += bad
            changed = True

    if not changed:
        return 0
    if not dry:
        open(path, 'wb').write(bytes(raw))
    return total_bad


def main():
    dry = '--dry-run' in sys.argv
    files = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not files:
        files = sorted(glob.glob(os.path.join('models', '*.glb')))
    fixed = 0
    for f in files:
        n = fix_file(f, dry)
        if n:
            fixed += 1
            print('  %s %-40s 修复 %d 个零法线' % ('[预演]' if dry else '[已修]', os.path.basename(f), n))
    print('%s共 %d 个模型%s，%d 个模型无零法线' %
          ('(预演) ' if dry else '', fixed, '需要修复' if dry else '已修复', len(files) - fixed))


if __name__ == '__main__':
    main()
