"""抽出参考资产里单条鱼（Clown1）的脊椎角度波形，作为我们绑定的对照标尺。

用法: python3 tools/ref_wave.py <glb> [鱼名前缀=Clown1]
"""
import json
import math
import struct
import sys

path = sys.argv[1]
pref = sys.argv[2] if len(sys.argv) > 2 else 'Clown1'

d = open(path, 'rb').read()
jl = struct.unpack('<I', d[12:16])[0]
g = json.loads(d[20:20 + jl])
o = 20 + jl
BIN = d[o + 8:o + 8 + struct.unpack('<I', d[o:o + 4])[0]]
anim = g['animations'][0]
nodes = g['nodes']


def read(ai):
    a = g['accessors'][ai]
    bv = g['bufferViews'][a['bufferView']]
    s = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    nc = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']]
    n = a['count'] * nc
    return list(struct.unpack('<%df' % n, BIN[s:s + n * 4])), a['count']


targets = []
for i, n in enumerate(nodes):
    nm = n.get('name') or ''
    if nm.startswith(pref) and 'Spine' in nm and 'End' not in nm:
        targets.append((i, nm))
targets.sort(key=lambda t: t[1])
names = [nm for _, nm in targets]
print('骨骼:', names)

data = {}
nfr = None
times = None
for ch in anim['channels']:
    ni = ch['target']['node']
    if ni not in [i for i, _ in targets] or ch['target']['path'] != 'rotation':
        continue
    sm = anim['samplers'][ch['sampler']]
    vals, cnt = read(sm['output'])
    if nfr is None:
        nfr = cnt
        tv, _ = read(sm['input'])
        times = tv
    data[ni] = vals

# 带符号角度：用四元数的 y 分量（绕竖直轴）作为符号，取绕 Y 的分量
def signed_y(x, y, z, w):
    # 投影到 Y 轴：只保留纯 Y 旋转的分量，角度近似 2*asin(y)
    y = max(-1.0, min(1.0, y))
    return 2.0 * math.asin(y) * 180 / math.pi

series = []
for ni, nm in targets:
    v = data.get(ni)
    if not v:
        series.append([0.0] * nfr)
        continue
    series.append([signed_y(v[k * 4], v[k * 4 + 1], v[k * 4 + 2], v[k * 4 + 3]) for k in range(nfr)])

# 找周期：用最后一节脊椎的自相关
last = series[-1]
best, bestlag = -9, 0
for lag in range(10, min(nfr // 3, 400)):
    s = 0.0
    for i in range(nfr - lag):
        s += last[i] * last[i + lag]
    if s > best:
        best, bestlag = s, lag
period = bestlag
dur = times[period] - times[0] if period else 0
print('自相关主周期 ≈ %d 帧 / %.2f 秒' % (period, dur))

# 打印一个周期内的波形（16 个采样点）
print('\n相位   ' + '  '.join('%-9s' % ('S%d' % (i + 1)) for i in range(len(series))))
for k in range(16):
    idx = int(k * period / 16) if period else k
    idx = min(idx, nfr - 1)
    print('%4d   ' % k + '  '.join('%-9.1f' % s[idx] for s in series))

amp = [max(abs(v) for v in s) for s in series]
print('\n各节最大角度: ' + ', '.join('%.1f°' % a for a in amp))
if len(series) >= 3:
    # 相位差：每节峰值出现在周期的第几个采样
    peaks = []
    for s in series:
        seg = s[:period] if period else s[:200]
        pk = max(range(len(seg)), key=lambda i: abs(seg[i]))
        peaks.append(pk * 100.0 / max(1, len(seg)))
    print('峰值相位(%%): ' + ', '.join('%.0f' % p for p in peaks))
