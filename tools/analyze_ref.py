"""量出参考资产 Swimming fish.glb 的游动特征，用来对标我们自己的绑定。

输出：脊椎各节旋转角、沿体长累加的总弯曲（C 形弯曲量）、帧间变化率。
用法: python3 tools/analyze_ref.py <glb>
"""
import json
import math
import struct
import sys

path = sys.argv[1]
d = open(path, 'rb').read()
jl = struct.unpack('<I', d[12:16])[0]
g = json.loads(d[20:20 + jl])
o = 20 + jl
blen = struct.unpack('<I', d[o:o + 4])[0]
BIN = d[o + 8:o + 8 + blen]

nodes = g['nodes']
anim = g['animations'][0]
print('片段 %r  通道 %d' % (anim.get('name'), len(anim['channels'])))


def read(ai):
    a = g['accessors'][ai]
    bv = g['bufferViews'][a['bufferView']]
    s = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    nc = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    n = a['count'] * nc
    return list(struct.unpack('<%df' % n, BIN[s:s + n * 4])), a['count'], nc


# 找脊椎骨：名字里含 Spine
spine = []
for i, n in enumerate(nodes):
    nm = (n.get('name') or '')
    if 'Spine' in nm and 'End' not in nm:
        spine.append((i, nm))
spine.sort(key=lambda t: t[1])
print('脊椎骨:', [nm for _, nm in spine])

rot = {}
trans = {}
tlen = None
for ch in anim['channels']:
    tgt = ch['target']
    if tgt['node'] not in [i for i, _ in spine]:
        continue
    sm = anim['samplers'][ch['sampler']]
    vals, cnt, nc = read(sm['output'])
    if tlen is None:
        tlen = cnt
    if tgt['path'] == 'rotation':
        rot[tgt['node']] = vals
    elif tgt['path'] == 'translation':
        trans[tgt['node']] = vals

if not rot:
    print('没找到脊椎旋转通道')
    sys.exit(1)


def quat_angle(x, y, z, w):
    w = max(-1.0, min(1.0, abs(w)))
    return 2.0 * math.acos(w)


# 逐帧统计：总弯曲 = 各节角度之和（同向累加才是 C 形）
tot = []
per_joint_max = [0.0] * len(spine)
for k in range(tlen):
    s = 0.0
    for j, (ni, nm) in enumerate(spine):
        v = rot.get(ni)
        if not v:
            continue
        ang = quat_angle(v[k * 4], v[k * 4 + 1], v[k * 4 + 2], v[k * 4 + 3])
        s += ang
        if ang > per_joint_max[j]:
            per_joint_max[j] = ang
    tot.append(s)

deg = [x * 180 / math.pi for x in tot]
mx = max(deg)
mean = sum(deg) / len(deg)
# 前 10% 分位：代表"大动作"时的弯曲
srt = sorted(deg)
p90 = srt[int(len(srt) * 0.9)]

print('\n总弯曲（沿体长累加）:  最大 %.1f°   平均 %.1f°   P90 %.1f°' % (mx, mean, p90))
print('每节最大角: ' + ', '.join('%.1f°' % (a * 180 / math.pi) for a in per_joint_max))

# 帧间变化率 → 动作有多"猛"
dt = 41.0 / tlen
vel = [abs(deg[i] - deg[i - 1]) / dt for i in range(1, len(deg))]
print('弯曲变化率:  最大 %.0f°/s   平均 %.0f°/s' % (max(vel), sum(vel) / len(vel)))

# 身体长度方向的波动：头部根骨有没有横向位移（判断是不是原地摆）
root = spine[0][0]
if trans.get(root):
    v = trans[root]
    xs = v[0::3]
    zs = v[2::3]
    print('根骨位移范围 x %.4f..%.4f  z %.4f..%.4f' % (min(xs), max(xs), min(zs), max(zs)))
