"""离线验证蒙皮：按 glTF 规则算 world*IBM，把顶点变换到动画姿态，
再比较姿态包围盒与绑定包围盒。

判据（v2，物理感知）：
  旧版只看「最大单轴相对比例」0.7~1.6，对侧扁薄体鱼会系统性误杀 ——
  Lighthill 摆尾包络会让侧向 bbox 增加一个几乎恒定的绝对量（本项目
  写实鱼约 0.07~0.11 个 3D 单位），身体越薄相对比例越夸张。红箭鱼
  体厚仅 0.19、剑尾又长，侧向增量 0.17 就算出 1.84，但体长/体高稳定，
  蒙皮权重其实完全正常。

  真蒙皮错误的特征是「塌缩」「数量级爆炸」「体积失控」，所以改为：
    ① 塌缩   任一轴 < 0.65 倍                     → 异常
    ② 爆炸   任一轴 > 2.2 倍 或 体积比 > 2.4     → 异常
    ③ 形变   任一轴增量 > 0.22 × 最长轴          → 异常
  ③ 用绝对增量（按体长归一化），不再被薄轴的相对比例误导；
  阈值 0.22 覆盖正常摆尾（实测最大 0.18）又能抓住 IBM/权重翻转。

用法: python3 tools/check_skin.py <a.glb> [b.glb ...]
      CLIP=0|1 选择要检查的动画片段（默认 Swim）
"""
import json
import math
import struct
import sys


def mat_mul(a, b):
    return [sum(a[r + 4 * k] * b[k + 4 * c] for k in range(4)) for c in range(4) for r in range(4)]


def trs(t, q):
    x, y, z, w = q
    xx, yy, zz = x * x, y * y, z * z
    xy, xz, yz = x * y, x * z, y * z
    wx, wy, wz = w * x, w * y, w * z
    return [
        1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
        2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
        2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
        t[0], t[1], t[2], 1,
    ]


def ident():
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


for path in sys.argv[1:]:
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    g = json.loads(d[20:20 + jl])
    o = 20 + jl
    blen = struct.unpack('<I', d[o:o + 4])[0]
    BIN = d[o + 8:o + 8 + blen]

    def acc(i):
        a = g['accessors'][i]
        bv = g['bufferViews'][a['bufferView']]
        s = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        f = {5126: 'f', 5123: 'H', 5125: 'I', 5121: 'B'}[a['componentType']]
        sz = {5126: 4, 5123: 2, 5125: 4, 5121: 1}[a['componentType']]
        n = a['count'] * nc
        return struct.unpack('<%d%s' % (n, f), BIN[s:s + n * sz]), a

    prim = g['meshes'][0]['primitives'][0]
    P, _ = acc(prim['attributes']['POSITION'])
    J, ja = acc(prim['attributes']['JOINTS_0'])
    W, wa = acc(prim['attributes']['WEIGHTS_0'])
    IBM, _ = acc(g['skins'][0]['inverseBindMatrices'])
    joints = g['skins'][0]['joints']

    an = g['animations'][int(__import__('os').environ.get('CLIP','0'))]
    times, _ = acc(an['samplers'][0]['input'])
    # 取 1/4 周期的姿态
    k = min(len(times) // 4, len(times) - 1)

    parent = {}
    for ni, n in enumerate(g['nodes']):
        for c in n.get('children', []):
            parent[c] = ni

    rot = {}
    for ch in an['channels']:
        if ch['target']['path'] != 'rotation':
            continue
        q, _ = acc(an['samplers'][ch['sampler']]['output'])
        rot[ch['target']['node']] = q[k * 4:(k + 1) * 4]

    def world(ni):
        n = g['nodes'][ni]
        local = trs(n.get('translation', [0, 0, 0]), rot.get(ni, (0, 0, 0, 1)))
        return local if ni not in parent else mat_mul(world(parent[ni]), local)

    skin = []
    for bi, jn in enumerate(joints):
        ib = IBM[bi * 16:(bi + 1) * 16]
        skin.append(mat_mul(world(jn), list(ib)))

    wscale = 255.0 if wa.get('normalized') else 1.0
    nv = len(P) // 3
    step = max(1, nv // 3000)
    bmin = [1e9] * 3
    bmax = [-1e9] * 3
    pmin = [1e9] * 3
    pmax = [-1e9] * 3
    for v in range(0, nv, step):
        px, py, pz = P[v * 3], P[v * 3 + 1], P[v * 3 + 2]
        for i, c in enumerate((px, py, pz)):
            bmin[i] = min(bmin[i], c)
            bmax[i] = max(bmax[i], c)
        ox = oy = oz = 0.0
        for t in range(4):
            jj = J[v * 4 + t]
            w = W[v * 4 + t] / wscale
            if w <= 0:
                continue
            m = skin[jj]
            ox += w * (m[0] * px + m[4] * py + m[8] * pz + m[12])
            oy += w * (m[1] * px + m[5] * py + m[9] * pz + m[13])
            oz += w * (m[2] * px + m[6] * py + m[10] * pz + m[14])
        for i, c in enumerate((ox, oy, oz)):
            pmin[i] = min(pmin[i], c)
            pmax[i] = max(pmax[i], c)

    sb = [bmax[i] - bmin[i] for i in range(3)]
    sp = [pmax[i] - pmin[i] for i in range(3)]
    grow = [sp[i] / max(sb[i], 1e-6) for i in range(3)]
    ratio = max(grow)
    longest = max(sb)
    vol = (sp[0] * sp[1] * sp[2]) / max(sb[0] * sb[1] * sb[2], 1e-9)

    bad = []
    if min(grow) < 0.65:
        bad.append('塌缩')
    if max(grow) > 2.2 or vol > 2.4:
        bad.append('爆炸')
    # 摆尾会让侧向包围盒变宽，用「按体长归一化的绝对增量」衡量才公平
    delta = [(sp[i] - sb[i]) / max(longest, 1e-6) for i in range(3)]
    if max(delta) > 0.22:
        bad.append('形变增量过大')

    verdict = 'OK' if not bad else '❌ 异常(' + '/'.join(bad) + ')'
    print('%-34s 绑定 %.2f×%.2f×%.2f → 姿态 %.2f×%.2f×%.2f  比例 %.2f  Δ %.2f  %s' %
          (path.split('/')[-1], sb[0], sb[1], sb[2], sp[0], sp[1], sp[2],
           ratio, max(delta), verdict))
