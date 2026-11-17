"""给外置鱼模型绑骨：9 节脊椎 + 3 根鳍骨（背鳍 / 臀鳍 / 尾鳍），并写入游动循环。

前提：模型由 Hunyuan/Tripo 一类服务导出，节点上带 +90°X 四元数（Z-up → Y-up）。
蒙皮网格会忽略节点自身变换，所以必须把旋转烘焙进顶点，否则鱼会侧躺。

用法: python3 tools/rig_fish.py <src.glb> <dst.glb> [摆尾幅度比=0.077]
"""
import json
import math
import struct
import sys

SRC, DST = sys.argv[1], sys.argv[2]
TIP_RATIO = float(sys.argv[3]) if len(sys.argv) > 3 else 0.105
# 尾鳍起点（沿 bbox 的 X 跨度归一化）。AI 生成的鱼尾鳍占比小，0.93 就够；
# 程序化生成的大尾鱼（Blender 孔雀鱼尾鳍占体长 36%）必须调小，否则尾鳍顶点
# 几乎全部落不进判定窗口，尾鳍骨还会被放到扇面最外缘，摆尾会把尾巴甩飞。
# 默认值与旧行为完全一致（0.93 / 0.965），不影响已接入的 AI 模型。
TAIL_U = float(sys.argv[4]) if len(sys.argv) > 4 else 0.93
TAIL_BONE_U = (TAIL_U + 1.0) * 0.5
# 第 5 个参数 nobake：输入已经是 Y-up（Blender export_yup=True 直出）时跳过烘焙。
# 烘焙 (x,y,z)→(x,-z,y) 会把「背朝 +Z」翻成「背朝 -Y」；
# AI 模型约定是「背朝 -Z」，烘完正好翻正，所以要保留默认烘焙。
NO_BAKE = len(sys.argv) > 5 and sys.argv[5] == 'nobake'

K = 9
U_CUTS = [0.0, 0.13, 0.27, 0.41, 0.55, 0.68, 0.79, 0.89, 1.0]
N_KEYS = 32
CYCLE = 0.9
WAVES = 1.05

raw = open(SRC, 'rb').read()
assert struct.unpack("<I", raw[:4])[0] == 0x46546C67
off = 12
chunks = []
while off < len(raw):
    clen, ctype = struct.unpack("<II", raw[off:off + 8])
    chunks.append((ctype, raw[off + 8:off + 8 + clen]))
    off += 8 + clen

gltf = json.loads(chunks[0][1].decode("utf-8"))
bin_blob = bytearray(chunks[1][1])
views = gltf["bufferViews"]
acc = gltf["accessors"]
prim = gltf["meshes"][0]["primitives"][0]
nverts = acc[prim["attributes"]["POSITION"]]["count"]
print("顶点", nverts)


def view_slice(a):
    bv = views[a["bufferView"]]
    assert "byteStride" not in bv
    return bv.get("byteOffset", 0) + a.get("byteOffset", 0)


# ---------- 1. 烘焙节点旋转 (x,y,z) -> (x,-z,y) ----------
gltf["nodes"][0].pop("rotation", None)


def read_attr(attr):
    a = acc[prim["attributes"][attr]]
    start = view_slice(a)
    n = nverts * 3
    return list(struct.unpack("<%df" % n, bin_blob[start:start + n * 4])), start, a


def write_attr(vals, start, a):
    bin_blob[start:start + len(vals) * 4] = struct.pack("<%df" % len(vals), *vals)
    a["min"] = [min(vals[0::3]), min(vals[1::3]), min(vals[2::3])]
    a["max"] = [max(vals[0::3]), max(vals[1::3]), max(vals[2::3])]


raw_pos, pos_start, pos_acc = read_attr("POSITION")
if NO_BAKE:
    print("   跳过 Z-up→Y-up 烘焙（输入已是 Y-up）")
    baked = list(raw_pos)
else:
    baked = [0.0] * (nverts * 3)
    for i in range(nverts):
        x, y, z = raw_pos[i * 3], raw_pos[i * 3 + 1], raw_pos[i * 3 + 2]
        baked[i * 3] = x
        baked[i * 3 + 1] = -z
        baked[i * 3 + 2] = y


def head_is_plus_x(px, py, pz):
    """判断鱼头在 +X 还是 -X。

    按 x 分箱，箱内用 5~95 分位估截面高（z）与厚（y），面积=高×厚。
    鱼的体积重心在几何中心偏头部（尾部细），所以面积加权重心偏向哪端，头就在哪端。
    """
    lo, hi = min(px), max(px)
    span_x = hi - lo
    if span_x < 1e-6:
        return True
    NB2 = 24
    buckets = [[] for _ in range(NB2)]
    for i in range(nverts):
        k = min(NB2 - 1, max(0, int((px[i] - lo) / span_x * NB2)))
        buckets[k].append(i)

    def pct(v, q):
        if not v:
            return 0.0
        s = sorted(v)
        return s[min(len(s) - 1, max(0, int(q * (len(s) - 1))))]

    wsum = 0.0
    xsum = 0.0
    for k, idx in enumerate(buckets):
        if len(idx) < 8:
            continue
        zs_ = [pz[i] for i in idx]
        ys_ = [py[i] for i in idx]
        area = (pct(zs_, .95) - pct(zs_, .05)) * (pct(ys_, .95) - pct(ys_, .05))
        xc = lo + (k + .5) / NB2 * span_x
        wsum += area
        xsum += area * xc
    if wsum <= 0:
        return True
    return (xsum / wsum) > (lo + hi) * .5


px = baked[0::3]
did_flip = not head_is_plus_x(px, baked[1::3], baked[2::3])
if did_flip:
    print("   检测到头朝 -X，绕竖轴旋转 180° 后再绑骨")
    for i in range(nverts):
        baked[i * 3] = -baked[i * 3]
        baked[i * 3 + 2] = -baked[i * 3 + 2]
write_attr(baked, pos_start, pos_acc)
POS = baked[:]

if "NORMAL" in prim["attributes"]:
    raw_nrm, nrm_start, nrm_acc = read_attr("NORMAL")
    nb = [0.0] * (nverts * 3)
    for i in range(nverts):
        x, y, z = raw_nrm[i * 3], raw_nrm[i * 3 + 1], raw_nrm[i * 3 + 2]
        if NO_BAKE:
            nx, ny, nz = x, y, z
        else:
            nx, ny, nz = x, -z, y
        nb[i * 3] = -nx if did_flip else nx
        nb[i * 3 + 1] = ny
        nb[i * 3 + 2] = -nz if did_flip else nz
    write_attr(nb, nrm_start, nrm_acc)

xs, ys, zs = POS[0::3], POS[1::3], POS[2::3]
x_head, x_tail = max(xs), min(xs)
span = x_head - x_tail
half_w = max(max(zs), -min(zs))
print("bbox x %.3f..%.3f  y %.3f..%.3f  z %.3f..%.3f" %
      (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)))

thick = half_w * 0.35
NB = 32


def station(u):
    return min(NB - 1, max(0, int(u * NB)))


def u_of(i):
    return min(max((x_head - xs[i]) / span, 0.0), 1.0)


# ---------- 2. 每段躯干的上下缘（只用有厚度的顶点，避开鳍膜） ----------
top = [None] * NB
bot = [None] * NB
hw = [0.0] * NB
for i in range(nverts):
    if abs(zs[i]) < thick:
        continue
    k = station(u_of(i))
    top[k] = ys[i] if top[k] is None else max(top[k], ys[i])
    bot[k] = ys[i] if bot[k] is None else min(bot[k], ys[i])
    hw[k] = max(hw[k], abs(zs[i]))

for k in range(NB):
    if top[k] is None:
        nk = next((j for j in range(k + 1, NB) if top[j] is not None), None)
        pk = next((j for j in range(k - 1, -1, -1) if top[j] is not None), None)
        if nk is not None:
            top[k], bot[k], hw[k] = top[nk], bot[nk], hw[nk]
        elif pk is not None:
            top[k], bot[k], hw[k] = top[pk], bot[pk], hw[pk]
        else:
            top[k], bot[k] = max(ys), min(ys)

# ---------- 3. 脊线 ----------
def mean_y(lo, hi):
    v = [ys[i] for i in range(nverts) if abs(zs[i]) >= thick and lo <= u_of(i) <= hi]
    return sum(v) / max(1, len(v)) if v else (min(ys) + max(ys)) / 2


y_head, y_tail = mean_y(0.04, 0.28), mean_y(0.72, 0.96)
print("脊线 head y=%.3f  tail y=%.3f" % (y_head, y_tail))
spine = [(x_head - u * span, y_head + (y_tail - y_head) * u, 0.0) for u in U_CUTS]

# ---------- 4. 鳍顶点分类 ----------
G_BODY, G_DORSAL, G_ANAL, G_CAUDAL = 0, 1, 2, 3
grp = [G_BODY] * nverts
for i in range(nverts):
    u = u_of(i)
    k = station(u)
    thin = abs(zs[i]) <= max(hw[k] * 0.55, thick * 1.15)
    if u > TAIL_U and thin:
        grp[i] = G_CAUDAL
    elif thin and ys[i] > top[k] + 0.012:
        grp[i] = G_DORSAL
    elif thin and ys[i] < bot[k] - 0.012:
        grp[i] = G_ANAL

cnt = {G_DORSAL: 0, G_ANAL: 0, G_CAUDAL: 0}
for g in grp:
    if g:
        cnt[g] += 1
print("鳍顶点 背鳍 %d  臀鳍 %d  尾鳍 %d" % (cnt[G_DORSAL], cnt[G_ANAL], cnt[G_CAUDAL]))

# ---------- 5. 骨骼表 ----------
bones = [{"name": "spine_%02d" % k, "pos": spine[k], "parent": (k - 1 if k else -1),
          "kind": "spine"} for k in range(K)]
G2NAME = {G_DORSAL: "fin_dorsal", G_ANAL: "fin_anal", G_CAUDAL: "fin_caudal"}

for g, name in ((G_DORSAL, "fin_dorsal"), (G_ANAL, "fin_anal"), (G_CAUDAL, "fin_caudal")):
    idx = [i for i in range(nverts) if grp[i] == g]
    if not idx:
        print("跳过 %s（没找到顶点）" % name)
        continue
    if g == G_CAUDAL:
        px = x_head - TAIL_BONE_U * span
        by = y_head + (y_tail - y_head) * 0.98
    else:
        px = sum(xs[i] for i in idx) / len(idx)
        ku = station(min(max((x_head - px) / span, 0), 1))
        by = top[ku] if g == G_DORSAL else bot[ku]
    pk = min(range(K), key=lambda k: abs(spine[k][0] - px))
    bones.append({"name": name, "pos": (px, by, 0.0), "parent": pk,
                  "kind": "fin", "fins": idx, "gi": g})

NBONE = len(bones)
print("骨骼共 %d 根" % NBONE)

# ---------- 6. 蒙皮权重（相邻两节脊椎 + 一根鳍骨） ----------
fin_ramp = {}
for bi, b in enumerate(bones):
    if b["kind"] != "fin":
        continue
    if b["gi"] == G_CAUDAL:
        vals = [u_of(i) for i in b["fins"]]
    else:
        vals = [ys[i] for i in b["fins"]]
    fin_ramp[b["gi"]] = (min(vals), max(vals))

JOINTS, WEIGHTS = bytearray(), bytearray()
for i in range(nverts):
    u = u_of(i)
    seg = K - 2
    for k in range(K - 1):
        if u <= U_CUTS[k + 1] or k == K - 2:
            seg = k
            break
    t = min(max((u - U_CUTS[seg]) / max(U_CUTS[seg + 1] - U_CUTS[seg], 1e-6), 0.0), 1.0)

    wf, fin_idx = 0.0, 0
    g = grp[i]
    if g:
        for bi, b in enumerate(bones):
            if b["kind"] == "fin" and b["gi"] == g:
                fin_idx = bi
                break
        lo, hi = fin_ramp[g]
        if hi - lo > 1e-6:
            v = u if g == G_CAUDAL else ys[i]
            ramp = (hi - v) / (hi - lo) if g == G_ANAL else (v - lo) / (hi - lo)
            wf = min(max(ramp, 0.0), 1.0) * 0.88

    a = int(round((1.0 - t) * (1.0 - wf) * 255))
    b2 = int(round(t * (1.0 - wf) * 255))
    c2 = 255 - a - b2
    if c2 < 0:
        a = max(0, a + c2)
        b2 = 255 - a
        c2 = 0
    JOINTS += bytes((seg, seg + 1, fin_idx, 0))
    WEIGHTS += bytes((a, b2, c2, 0))

IBM = bytearray()
for b in bones:
    p = b["pos"]
    IBM += struct.pack("<16f", 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1)


# ---------- 7. 动画：脊椎行波 + 鳍骨摆动 ----------
# Lighthill 轨迹近似的振幅包络 A(s) = c1·s + c2·s²（仿生鱼通用形式）。
# 骨转角取包络的导数（UBC TR-2001-19：θ = atan(∂F/∂x)），归一化到尾部为 1。
C1, C2 = 0.10, 0.55


def envelope(u):
    return (C1 + 2 * C2 * u) / (C1 + 2 * C2)


def spine_angles(phase, base):
    return [base * envelope(U_CUTS[k]) * math.sin(phase - 2 * math.pi * WAVES * U_CUTS[k])
            for k in range(K)]


def tip_z(th):
    pos = list(spine[0])
    a = 0.0
    for k in range(1, K):
        a += th[k]
        dx = spine[k][0] - spine[k - 1][0]
        pos[0] += dx * math.cos(a)
        pos[2] += -dx * math.sin(a)
    return pos[2]


peak = max(abs(tip_z(spine_angles(k * 2 * math.pi / 24, 1.0))) for k in range(24))
BASE = (TIP_RATIO * span) / max(peak, 1e-9)
print("脊椎每节摆幅 %.2f°" % math.degrees(BASE))

FIN_AMP = {"fin_dorsal": 0.14, "fin_anal": 0.12, "fin_caudal": 0.18}
FIN_PHASE = {"fin_dorsal": 0.9, "fin_anal": 2.4, "fin_caudal": 0.3}
FIN_RATE = {"fin_dorsal": 1.45, "fin_anal": 1.45, "fin_caudal": 1.0}

times, quats = [], [[] for _ in range(NBONE)]
for kk in range(N_KEYS + 1):
    tt = CYCLE * kk / N_KEYS
    times.append(tt)
    ph = 2 * math.pi * tt / CYCLE
    th = spine_angles(ph, BASE)
    for bi, b in enumerate(bones):
        if b["kind"] == "spine":
            ang = th[bi]
        else:
            nm = b["name"]
            ang = FIN_AMP.get(nm, .1) * math.sin(ph * FIN_RATE.get(nm, 1.4) + FIN_PHASE.get(nm, 0))
        quats[bi] += [0.0, math.sin(ang * 0.5), 0.0, math.cos(ang * 0.5)]

tail_bytes = bytearray()
base_len = len(bin_blob)


def add_acc(payload, ctype, atype, count, target=None, mn=None, mx=None, normalized=False):
    while len(tail_bytes) % 4:
        tail_bytes.append(0)
    views.append({"buffer": 0, "byteOffset": base_len + len(tail_bytes), "byteLength": len(payload)})
    a = {"bufferView": len(views) - 1, "componentType": ctype, "count": count, "type": atype}
    if target:
        views[-1]["target"] = target
    if normalized:
        a["normalized"] = True
    if mn is not None:
        a["min"] = mn
        a["max"] = mx
    acc.append(a)
    tail_bytes.extend(payload)
    return len(acc) - 1


j_acc = add_acc(bytes(JOINTS), 5121, "VEC4", nverts, 34962)
w_acc = add_acc(bytes(WEIGHTS), 5121, "VEC4", nverts, 34962, normalized=True)
ibm_acc = add_acc(bytes(IBM), 5126, "MAT4", NBONE)
t_acc = add_acc(struct.pack("<%df" % len(times), *times), 5126, "SCALAR", len(times),
                mn=[times[0]], mx=[times[-1]])
q_accs = [add_acc(struct.pack("<%df" % len(quats[b]), *quats[b]), 5126, "VEC4", len(times))
          for b in range(NBONE)]

# ---------- 8. 节点 / skin / animation ----------
first_node = len(gltf["nodes"])
for b in bones:
    n = {"name": b["name"]}
    if b["parent"] >= 0:
        pp = bones[b["parent"]]["pos"]
        n["translation"] = [b["pos"][0] - pp[0], b["pos"][1] - pp[1], b["pos"][2] - pp[2]]
    else:
        n["translation"] = list(b["pos"])
    gltf["nodes"].append(n)
for bi, b in enumerate(bones):
    if b["parent"] >= 0:
        gltf["nodes"][first_node + b["parent"]].setdefault("children", []).append(first_node + bi)

gltf["skins"] = [{"name": "fish_rig",
                  "joints": [first_node + b for b in range(NBONE)],
                  "inverseBindMatrices": ibm_acc,
                  "skeleton": first_node}]
gltf["nodes"][0]["skin"] = 0
gltf["scenes"][0]["nodes"] = [0, first_node]
gltf["animations"] = [{
    "name": "Swim",
    "samplers": [{"input": t_acc, "output": q_accs[b], "interpolation": "LINEAR"} for b in range(NBONE)],
    "channels": [{"sampler": b, "target": {"node": first_node + b, "path": "rotation"}} for b in range(NBONE)],
}]
prim["attributes"]["JOINTS_0"] = j_acc
prim["attributes"]["WEIGHTS_0"] = w_acc

bin_blob += tail_bytes
while len(bin_blob) % 4:
    bin_blob.append(0)
gltf["bufferViews"] = views
gltf["buffers"] = [{"byteLength": len(bin_blob)}]

js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
while len(js) % 4:
    js += b" "
glb = bytearray()
glb += struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_blob))
glb += struct.pack("<II", len(js), 0x4E4F534A) + js
glb += struct.pack("<II", len(bin_blob), 0x004E4942) + bytes(bin_blob)
open(DST, "wb").write(glb)
print("写出 %s  %.2f MB（骨 %d 根）" % (DST, len(glb) / 1048576, NBONE))
