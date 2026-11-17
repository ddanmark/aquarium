"""给已绑骨的鱼 GLB 追加一段「大动作」动画 Turn。

原理：把 Swim 片段里每个关节的关键帧四元数拆成（轴, 角），把角放大 AMP 倍再装回去。
不需要重新绑骨，任何带 swim 循环的 GLB 都能用。

用法: python3 tools/add_turn_clip.py <in.glb> <out.glb> [振幅倍数=1.9]
"""
import json
import math
import struct
import sys

SRC, DST = sys.argv[1], sys.argv[2]
AMP = float(sys.argv[3]) if len(sys.argv) > 3 else 1.9
TWIST = float(sys.argv[4]) if len(sys.argv) > 4 else 0.34
BEND = float(sys.argv[5]) if len(sys.argv) > 5 else 0.24

raw = open(SRC, 'rb').read()
assert struct.unpack('<I', raw[:4])[0] == 0x46546C67
off = 12
chunks = []
while off < len(raw):
    clen, ctype = struct.unpack('<II', raw[off:off + 8])
    chunks.append((ctype, raw[off + 8:off + 8 + clen]))
    off += 8 + clen

gltf = json.loads(chunks[0][1].decode('utf-8'))
bin_blob = bytearray(chunks[1][1])
views = gltf['bufferViews']
acc = gltf['accessors']

names = [a.get('name') for a in gltf.get('animations', [])]
if 'Turn' in names:
    print('已存在 Turn 片段，跳过')
    open(DST, 'wb').write(raw)
    sys.exit(0)

src = gltf['animations'][0]
print('源片段 %r  采样器 %d' % (src.get('name'), len(src['samplers'])))


def read_floats(ai):
    a = acc[ai]
    bv = views[a['bufferView']]
    s = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    n = a['count'] * nc
    return list(struct.unpack('<%df' % n, bin_blob[s:s + n * 4]))


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz)


def twist_quat(angle):
    """绕局部 X 轴（鱼体长轴）旋转——这就是翻身/拧身"""
    h = angle * 0.5
    return (math.sin(h), 0.0, 0.0, math.cos(h))


def scale_quat(x, y, z, w, k):
    """四元数角度乘以 k。w 取绝对值避免符号问题。"""
    w = max(-1.0, min(1.0, w))
    if w < 0:
        x, y, z, w = -x, -y, -z, -w
    ang = 2.0 * math.acos(max(-1.0, min(1.0, w)))
    s = math.sqrt(max(0.0, 1.0 - w * w))
    if s < 1e-7 or ang < 1e-6:
        return (x, y, z, w)
    ax, ay, az = x / s, y / s, z / s
    na = ang * k
    half = na * 0.5
    sn = math.sin(half)
    return (ax * sn, ay * sn, az * sn, math.cos(half))


new_views = []
new_accs = []
bin_parts = bytearray(bin_blob)
base_len = len(bin_blob)


def add_accessor(payload, ctype, atype, count, minmax=False, mn=None, mx=None):
    while len(bin_parts) % 4:
        bin_parts.append(0)
    views.append({'buffer': 0, 'byteOffset': len(bin_parts), 'byteLength': len(payload)})
    a = {'bufferView': len(views) - 1, 'componentType': ctype, 'count': count, 'type': atype}
    if minmax:
        a['min'] = mn
        a['max'] = mx
    acc.append(a)
    bin_parts.extend(payload)
    return len(acc) - 1


samplers = []
channels = []
ch_idx = 0
n_ch = len([c for c in src['channels'] if c['target']['path'] == 'rotation'])
T_DUR = 0.9
for ch in src['channels']:
    if ch['target']['path'] != 'rotation':
        continue
    sm = src['samplers'][ch['sampler']]
    times = read_floats(sm['input'])
    quats = read_floats(sm['output'])
    # 沿体长的扭转幅度：头小尾大，相位滞后形成「拧过去」的波浪
    ramp = min(1.0, ch_idx / max(1, min(8, n_ch - 1)))
    out = []
    for i in range(0, len(quats), 4):
        q = scale_quat(quats[i], quats[i + 1], quats[i + 2], quats[i + 3], AMP)
        tt = times[i // 4]
        ang = TWIST * ramp * math.sin(2 * math.pi * tt / T_DUR - 2.4 * ramp)
        q = qmul(twist_quat(ang), q)
        # 整体弯曲：所有骨同向累加 → 身体连成一道 C。
        # 用 ramp**0.6 让它更均匀（不然只有尾巴弯，看起来像折断）。
        # 半正弦脉冲：一轮里只做「蜷起 → 回弹」，不是来回摆（C-start 建模）
        bend = BEND * (ramp ** 0.6) * math.sin(math.pi * tt / T_DUR)
        q = qmul((0.0, math.sin(bend * 0.5), 0.0, math.cos(bend * 0.5)), q)
        out.extend(q)
    ch_idx += 1
    o_acc = add_accessor(struct.pack('<%df' % len(out), *out), 5126, 'VEC4', len(times))
    samplers.append({'input': sm['input'], 'output': o_acc, 'interpolation': sm.get('interpolation', 'LINEAR')})
    channels.append({'sampler': len(samplers) - 1, 'target': ch['target']})

gltf['animations'].append({'name': 'Turn', 'samplers': samplers, 'channels': channels})
print('新增 Turn：%d 采样器，摆幅 ×%.2f，扭转 %.0f°' % (len(samplers), AMP, math.degrees(TWIST)))

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
open(DST, 'wb').write(glb)
print('写出 %s  %.2f MB' % (DST, len(glb) / 1048576))
