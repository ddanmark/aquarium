"""Blender 程序化生成「孔雀鱼 · 红礼服」（Poecilia reticulata, Red Tuxedo），导出 GLB。

为什么是这条路线：hy-3d 额度用尽时，AI 生成断供，但项目里的写实模型链路
（ingest.py → pack_model → rig_fish → add_turn_clip → check_skin）完全不依赖 AI，
只要给一个合格的 GLB 就能跑通。本脚本负责产出那个 GLB。

硬约束（来自 tools/rig_fish.py 与 tools/ingest.py，改脚本时必须守住）：
  1. 整条鱼必须合并成「单 mesh + 单 primitive」——rig_fish.py 只读 meshes[0].primitives[0]。
     所以身体、鳍、眼全部累积到同一个 verts/faces 列表，且只用一个材质、一张贴图。
  2. 体长主轴必须沿 X，rig_fish.py 按 X 分箱判断头尾，再统一摆正到 +X。
  3. 必须 Z-up 导出（export_yup=False）：rig_fish.py 会先 pop 掉节点旋转，
     再手工做 (x,y,z) → (x,-z,y) 的 Z-up → Y-up 烘焙。若这里导出成 Y-up，鱼会侧躺。
  4. 顶点数要 > 500（ingest.py 会拒绝过小的模型）。
  5. 不能有退化面：蒙皮闸门会按形变判定「塌缩 / 爆炸」，零点收口很容易被误判。

用法：
  blender.exe -b --factory-startup --python tools/blender/guppy_tuxedo.py -- <out.glb> [preview.png]
"""
import math
import os
import sys

import bpy
import numpy as np

# ---------------------------------------------------------------- 参数

LX = 1.60          # 吻端 x（头朝 +X）
X_TAIL = -1.60     # 尾柄 x，体长 3.2
HS = 0.64          # 体高半径系数（乘剖面后得到半径）→ 全高约 0.95
WS = 0.46          # 体厚半径系数 → 全厚约 0.41，厚/高 ≈ 0.43（侧扁）
NT = 56            # 体长方向段数
NU = 30            # 周向段数（不含接缝重复顶点）

# 沿体长归一化 t（0 吻 → 1 尾柄）的体高 / 体厚轮廓
T_H = [(0.00, 0.10), (0.05, 0.30), (0.12, 0.50), (0.22, 0.66), (0.34, 0.735),
       (0.44, 0.740), (0.55, 0.670), (0.68, 0.545), (0.82, 0.350), (0.93, 0.235),
       (1.00, 0.170)]
T_W = [(0.00, 0.06), (0.05, 0.20), (0.12, 0.34), (0.22, 0.42), (0.34, 0.445),
       (0.44, 0.440), (0.55, 0.385), (0.68, 0.300), (0.82, 0.205), (0.93, 0.150),
       (1.00, 0.105)]


def _interp(table, t):
    xs = [p[0] for p in table]
    ys = [p[1] for p in table]
    return float(np.interp(t, xs, ys))


def body_h(t):
    return _interp(T_H, t) * HS


def body_w(t):
    return _interp(T_W, t) * WS


def spine_z(t):
    """脊椎线：背部略拱，腹部略平，让侧面轮廓不是对称椭圆。"""
    return 0.045 * math.sin(math.pi * t) - 0.02 * t


def surf_top(t):
    return spine_z(t) + body_h(t) * 1.06


def surf_bot(t):
    return spine_z(t) - body_h(t) * 0.94


def x_of(t):
    return LX + (X_TAIL - LX) * t


def t_of(x):
    return (LX - x) / (LX - X_TAIL)


# ---------------------------------------------------------------- 网格累积

V = []      # 顶点 (x, y, z)
UV = []     # 每顶点 UV，与 V 一一对应
F = []      # 面，索引指向 V


def add_vert(x, y, z, u, v):
    V.append((x, y, z))
    UV.append((u, v))
    return len(V) - 1


def quad(a, b, c, d):
    F.append((a, b, c, d))


def tri(a, b, c):
    F.append((a, b, c))


# 贴图纵向条带（v 轴），彼此不重叠，避免采样串色
BAND_BODY = (0.000, 0.560)
BAND_TAIL = (0.575, 0.790)
BAND_DORSAL = (0.800, 0.845)
BAND_ANAL = (0.800, 0.845)
BAND_PECT = (0.855, 0.885)
BAND_EYE = (0.895, 0.990)


def band_v(band, s):
    return band[0] + (band[1] - band[0]) * s


# ---------------------------------------------------------------- 身体

def build_body():
    """沿 X 放样椭圆截面，两端封口，形成闭合体积，法线一致化才可靠。"""
    rings = []
    for i in range(NT + 1):
        t = i / NT
        x = x_of(t)
        h = body_h(t)
        w = body_w(t)
        zc = spine_z(t)
        ring = []
        for j in range(NU + 1):
            vt = j / NU
            th = 2.0 * math.pi * vt
            cz = math.cos(th)
            cy = math.sin(th)
            # 背高腹扁：上半 1.06，下半 0.94
            k = 1.06 if cz >= 0 else 0.94
            z = zc + h * k * cz
            y = w * cy
            ring.append(add_vert(x, y, z, t, band_v(BAND_BODY, vt)))
        rings.append(ring)

    for i in range(NT):
        for j in range(NU):
            a = rings[i][j]
            b = rings[i][j + 1]
            c = rings[i + 1][j + 1]
            d = rings[i + 1][j]
            quad(a, b, c, d)

    # 两端封口：用环心做扇形，半径不为 0，避免退化三角形
    for end, ring in ((0, rings[0]), (1, rings[-1])):
        t = 0.0 if end == 0 else 1.0
        x = x_of(t) + (0.02 if end == 0 else -0.02)
        ctr = add_vert(x, 0.0, spine_z(t), 0.0 if end == 0 else 1.0, band_v(BAND_BODY, 0.5))
        for j in range(NU):
            a, b = ring[j], ring[j + 1]
            if end == 0:
                tri(ctr, b, a)
            else:
                tri(ctr, a, b)


# ---------------------------------------------------------------- 鳍

def build_tail():
    """尾鳍：XZ 平面内的大扇面，扇缘带波浪，沿 Y 有褶皱（红礼服的大尾巴）。"""
    Lf = 1.95
    PHI = 1.02
    NR, NA = 16, 34
    # 根部插进尾柄内部 0.18，让尾鳍看起来是从身体里长出来的，
    # 否则零厚度的蜻面直接接在圆锥尖上，就像「棍子插扇子」。
    X_ROOT = X_TAIL + 0.18
    grid = []
    for i in range(NR + 1):
        R = i / NR
        row = []
        for j in range(NA + 1):
            ph = -PHI + 2.0 * PHI * j / NA
            edge = 1.0 + 0.045 * math.sin(ph * 9.0) + 0.020 * math.sin(ph * 21.0 + 1.3)
            rr = 0.055 + 0.945 * R * edge
            x = X_ROOT - Lf * rr * math.cos(ph)
            z = Lf * rr * math.sin(ph)
            y = 0.085 * R * math.sin(R * 7.2 + ph * 3.1)
            row.append(add_vert(x, y, z, 0.02 + 0.96 * R, band_v(BAND_TAIL, (ph + PHI) / (2 * PHI))))
        grid.append(row)
    for i in range(NR):
        for j in range(NA):
            quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j])


def build_dorsal():
    """背鳍：沿背部根线向后展开的梯形扇，后缘更高更尖。"""
    NB_C, NB_R = 12, 10
    x0, x1 = 0.70, -0.42
    grid = []
    for i in range(NB_C + 1):
        s = i / NB_C
        xb = x0 + (x1 - x0) * s
        t = t_of(xb)
        zb = surf_top(t)
        row = []
        for j in range(NB_R + 1):
            R = j / NB_R
            hf = 1.02 - 0.40 * s ** 1.8
            x = xb - 0.34 * s * R
            z = zb + hf * R * (1.0 - 0.06 * math.sin(s * 7.0))
            y = 0.045 * R * math.sin(s * 9.0 + R * 4.0)
            row.append(add_vert(x, y, z, 0.02 + 0.46 * s, band_v(BAND_DORSAL, R)))
        grid.append(row)
    for i in range(NB_C):
        for j in range(NB_R):
            quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j])


def build_anal():
    """臀鳍：腹侧向后下方展开，红礼服的臀鳍是深红黑的重色块。"""
    NB_C, NB_R = 10, 9
    x0, x1 = -0.28, -0.96
    grid = []
    for i in range(NB_C + 1):
        s = i / NB_C
        xb = x0 + (x1 - x0) * s
        t = t_of(xb)
        zb = surf_bot(t)
        row = []
        for j in range(NB_R + 1):
            R = j / NB_R
            hf = 0.62 - 0.14 * s
            x = xb - 0.24 * s * R
            z = zb - hf * R
            y = 0.035 * R * math.sin(s * 8.0 + R * 3.0)
            row.append(add_vert(x, y, z, 0.52 + 0.46 * s, band_v(BAND_ANAL, R)))
        grid.append(row)
    for i in range(NB_C):
        for j in range(NB_R):
            quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j])


def build_pectoral(side):
    """胸鳍：体侧的小扇，先在 XY 平面建好再绕 X 轴下压，左右镜像。"""
    NR, NA = 7, 9
    Lp = 0.62
    SPAN = 0.62
    t0 = 0.17
    bx = x_of(t0)
    by = body_w(t0) * 0.92
    bz = spine_z(t0) + 0.015
    tilt = math.radians(-26.0)
    ct, st = math.cos(tilt), math.sin(tilt)
    u_lo = 0.02 if side > 0 else 0.52
    grid = []
    for i in range(NR + 1):
        R = i / NR
        row = []
        for j in range(NA + 1):
            ph = -SPAN / 2 + SPAN * j / NA
            lx = -Lp * R * math.cos(ph)
            ly = Lp * R * math.sin(ph)
            # 绕 X 轴下压，再放到体侧
            ry = ly * ct - 0.0 * st
            rz = ly * st
            x = bx + lx
            y = side * (by + ry)
            z = bz + rz
            row.append(add_vert(x, y, z, u_lo + 0.46 * R, band_v(BAND_PECT, (ph + SPAN / 2) / SPAN)))
        grid.append(row)
    for i in range(NR):
        for j in range(NA):
            quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j])


def build_eye(side):
    """眼球：球心嵌在头侧肌肉里，只露出一小段；UV 用等距柱面展开到贴图眼块。"""
    cx = 1.30
    t0 = t_of(cx)
    cz = spine_z(t0) + 0.072
    cy = side * body_w(t0) * 0.66
    r = 0.078
    NR, NA = 8, 12
    u0 = 0.02 if side > 0 else 0.28
    grid = []
    for i in range(NR + 1):
        v = i / NR
        th = math.pi * v
        row = []
        for j in range(NA + 1):
            u = j / NA
            ph = 2.0 * math.pi * u
            x = cx + r * math.sin(th) * math.cos(ph) * 0.94
            y = cy + side * r * math.sin(th) * math.sin(ph)
            z = cz + r * math.cos(th)
            row.append(add_vert(x, y, z, u0 + 0.24 * u, band_v(BAND_EYE, v)))
        grid.append(row)
    for i in range(NR):
        for j in range(NA):
            a, b = grid[i][j], grid[i][j + 1]
            c, d = grid[i + 1][j + 1], grid[i + 1][j]
            if i == 0:
                tri(a, c, d)
            elif i == NR - 1:
                tri(a, b, c)
            else:
                quad(a, b, c, d)


# ---------------------------------------------------------------- 贴图

RW, RH = 1024, 1024


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h):
    h = h.lstrip('#')
    return np.array([srgb_to_lin(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)], dtype=np.float32)


def mix(a, b, k):
    k = np.clip(k, 0.0, 1.0)
    if k.ndim == a.ndim - 1:
        k = k[..., None]
    return a * (1.0 - k) + b * k


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / max(e1 - e0, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def make_texture(path):
    """红礼服配色：前半银蓝、后半深红转黑（tuxedo），尾鳍红底黑缘带斑。"""
    W, H = RW, RH
    px = np.zeros((H, W, 4), dtype=np.float32)
    px[..., 3] = 1.0

    ys, xs = np.mgrid[0:H, 0:W]
    u = xs.astype(np.float32) / (W - 1)
    vv = ys.astype(np.float32) / (H - 1)

    # ---------------- 身体条带 ----------------
    m = (vv >= BAND_BODY[0]) & (vv <= BAND_BODY[1])
    vt = (vv - BAND_BODY[0]) / (BAND_BODY[1] - BAND_BODY[0])   # 0 背 → 0.5 腹

    SILVER_F = hex_lin('#cdd9dc')   # 吻端银灰
    SILVER_B = hex_lin('#9fb6be')   # 体侧银蓝
    CRIMSON = hex_lin('#a8151d')    # 礼服红
    DEEP = hex_lin('#3a0a10')       # 近黑酒红
    BELLY = hex_lin('#e6ecec')      # 腹部银白

    c = np.zeros((H, W, 3), dtype=np.float32)
    k1 = smoothstep(0.00, 0.40, u)
    c = mix(np.broadcast_to(SILVER_F, (H, W, 3)), np.broadcast_to(SILVER_B, (H, W, 3)), k1)
    k2 = smoothstep(0.28, 0.55, u)
    c = mix(c, np.broadcast_to(CRIMSON, (H, W, 3)), k2)
    k3 = smoothstep(0.55, 0.90, u)
    c = mix(c, np.broadcast_to(DEEP, (H, W, 3)), k3)

    # 腹部提亮、背部压暗：vt=0.5 是腹部。提亮只作用于前半身，
    # 否则会把后半身的礼服红冲成灰白（第一版就是这个毛病）。
    tail_fade = 1.0 - smoothstep(0.42, 0.72, u)
    belly = np.clip((1.0 - np.cos(2.0 * np.pi * vt)) * 0.5, 0.0, 1.0)
    c = mix(c, np.broadcast_to(BELLY, (H, W, 3)), belly ** 1.7 * 0.34 * tail_fade)
    back = np.clip((1.0 + np.cos(2.0 * np.pi * vt)) * 0.5, 0.0, 1.0)
    c = mix(c, np.broadcast_to(hex_lin('#1e333a'), (H, W, 3)), back ** 2.2 * 0.24)

    # 鳞片：沿体长/周向的双频网纹，弱对比
    scal = (np.sin(u * 168.0 + np.sin(vt * 26.0) * 1.7) *
            np.sin(vt * 52.0 + u * 5.0))
    c = c * (1.0 + 0.085 * scal[..., None])

    # 侧线：体侧一条淡亮带
    lat = np.exp(-((vt - 0.30) ** 2) / (2 * 0.012 ** 2))
    c = c + lat[..., None] * 0.06

    # 鳃盖后缘：一条随周向轻微弯曲的暗线，是「看起来像鱼」最廉价的一笔
    gill_u = 0.118 + 0.016 * np.cos((vt - 0.30) * math.pi * 2.0)
    gill = np.exp(-((u - gill_u) ** 2) / (2 * 0.0055 ** 2))
    c = c * (1.0 - 0.24 * gill[..., None])
    # 鳃盖前沿的一点亮边，避免整块发死
    gill_hi = np.exp(-((u - gill_u - 0.020) ** 2) / (2 * 0.0060 ** 2))
    c = c + gill_hi[..., None] * 0.05
    px[..., :3][m] = c[m]

    # ---------------- 尾鳍条带 ----------------
    m = (vv >= BAND_TAIL[0]) & (vv <= BAND_TAIL[1])
    tr = (vv - BAND_TAIL[0]) / (BAND_TAIL[1] - BAND_TAIL[0])   # 0 根 → 1 缘
    tR = np.clip((u - 0.02) / 0.96, 0.0, 1.0)                   # 0 根 → 1 缘
    c = mix(np.broadcast_to(hex_lin('#cf1a1e'), (H, W, 3)),
            np.broadcast_to(hex_lin('#22060a'), (H, W, 3)), smoothstep(0.38, 1.0, tR))
    # 放射细纹
    ray = np.sin(tr * 150.0) * 0.5 + 0.5
    c = c * (1.0 + 0.10 * (ray[..., None] - 0.5))
    # 斑点：确定性伪随机，只在中段
    spot = ((np.sin(tR * 61.0 + 0.7) * np.sin(tr * 47.0 + 2.1)) > 0.55).astype(np.float32)
    spot *= smoothstep(0.15, 0.45, tR) * (1.0 - smoothstep(0.72, 0.95, tR))
    c = c * (1.0 - 0.45 * spot[..., None])
    # 根部过渡
    c = mix(np.broadcast_to(hex_lin('#7c1119'), (H, W, 3)), c, smoothstep(0.0, 0.18, tR))
    px[..., :3][m] = c[m]

    # ---------------- 背鳍 / 臀鳍条带 ----------------
    m = (vv >= BAND_DORSAL[0]) & (vv <= BAND_DORSAL[1])
    fr = (vv - BAND_DORSAL[0]) / (BAND_DORSAL[1] - BAND_DORSAL[0])   # 0 根 → 1 缘
    c = mix(np.broadcast_to(hex_lin('#c2262c'), (H, W, 3)),
            np.broadcast_to(hex_lin('#20060a'), (H, W, 3)), smoothstep(0.30, 1.0, fr))
    c = c * (1.0 + 0.08 * np.sin(u * 190.0)[..., None])
    px[..., :3][m] = c[m]

    # ---------------- 胸鳍条带 ----------------
    m = (vv >= BAND_PECT[0]) & (vv <= BAND_PECT[1])
    pr = (vv - BAND_PECT[0]) / (BAND_PECT[1] - BAND_PECT[0])
    c = mix(np.broadcast_to(hex_lin('#e0a6a2'), (H, W, 3)),
            np.broadcast_to(hex_lin('#a86463'), (H, W, 3)), smoothstep(0.2, 1.0, pr))
    c = c * (1.0 + 0.06 * np.sin(u * 230.0)[..., None])
    px[..., :3][m] = c[m]

    # ---------------- 眼睛条带（等距柱面展开） ----------------
    # 球面 UV 是「经度×纬度」，贴图块必须按 2:1 左右的矩形铺开；
    # 第一版把整圈经度压进 0.08 宽度，横向压扁 12 倍，渲染出来是两个黄球。
    m = (vv >= BAND_EYE[0]) & (vv <= BAND_EYE[1])
    er = (vv - BAND_EYE[0]) / (BAND_EYE[1] - BAND_EYE[0])
    c = np.broadcast_to(hex_lin('#0b0b0d'), (H, W, 3)).copy()
    for u0 in (0.02, 0.28):
        cu = (u - u0) / 0.24 * 2.0 - 1.0
        cv = (er - 0.5) * 2.0
        rr = np.sqrt((cu * 0.80) ** 2 + cv ** 2)
        iris = np.clip(1.0 - smoothstep(0.52, 0.96, rr), 0.0, 1.0)
        c = mix(c, np.broadcast_to(hex_lin('#c4922e'), (H, W, 3)), iris * 0.92)
        pupil = np.clip(1.0 - smoothstep(0.40, 0.60, rr), 0.0, 1.0)
        c = mix(c, np.broadcast_to(hex_lin('#050507'), (H, W, 3)), pupil)
        g = np.sqrt((cu + 0.30) ** 2 + (cv - 0.28) ** 2)
        glint = np.clip(1.0 - smoothstep(0.0, 0.30, g), 0.0, 1.0)
        c = mix(c, np.broadcast_to(hex_lin('#ffffff'), (H, W, 3)), glint * 0.85)
    px[..., :3][m] = c[m]

    img = bpy.data.images.new('guppy_tuxedo_tex', width=W, height=H, alpha=True)
    img.colorspace_settings.name = 'sRGB'
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def make_normal_texture(path):
    """程序化法线贴图：鳞片网格 + 鳍条细纹。

    tools/pack_model.py 假定材质带 normalTexture，缺了会直接 KeyError；
    而且刻上鳞片法线后侧光下的质感比纯 baseColor 高一档，所以这张图不是为了绕过检查，
    是确实需要的。
    """
    W, H = RW, RH
    ys, xs = np.mgrid[0:H, 0:W]
    u = xs.astype(np.float32) / (W - 1)
    vv = ys.astype(np.float32) / (H - 1)
    h = np.full((H, W), 0.5, dtype=np.float32)

    m = (vv >= BAND_BODY[0]) & (vv <= BAND_BODY[1])
    vt = (vv - BAND_BODY[0]) / (BAND_BODY[1] - BAND_BODY[0])
    scale = (np.sin(u * 168.0 + np.sin(vt * 26.0) * 1.7) *
             np.sin(vt * 52.0 + u * 5.0)) * 0.5 + 0.5
    h = np.where(m, 0.5 + 0.30 * (scale - 0.5), h)

    for band, amp, freq in ((BAND_TAIL, 0.26, 92.0), (BAND_DORSAL, 0.24, 64.0),
                            (BAND_PECT, 0.18, 48.0)):
        mm = (vv >= band[0]) & (vv <= band[1])
        fr = (vv - band[0]) / (band[1] - band[0])
        h = np.where(mm, 0.5 + amp * (np.sin(fr * freq) * 0.5) * 0.5, h)

    gy, gx = np.gradient(h)
    nx, ny = -gx * 7.0, -gy * 7.0
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5

    px = np.ones((H, W, 4), dtype=np.float32)
    px[..., :3] = n
    img = bpy.data.images.new('guppy_tuxedo_nrm', W, H, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def _save_linear(name, chans, path, gray=False):
    """写一张 Non-Color 的线性数据贴图（遮罩/粗糙度都不能被 sRGB 编码）。

    gray=True 时把首通道复制到 G/B：Blender 把颜色输出接到标量输入（Transmission
    Weight / Coat Weight 等）会取亮度，R=G=B 才能让亮度等于目标值。
    第一版未用通道默认填 1，导致 transmission 0.04 被算成 0.79、整条鱼变玻璃。
    """
    H, W = chans[0].shape
    px = np.zeros((H, W, 4), dtype=np.float32)
    px[..., 3] = 1.0
    for i, c in enumerate(chans):
        px[..., i] = c
    if gray:
        for i in range(1, 3):
            px[..., i] = chans[0]
    img = bpy.data.images.new(name, W, H, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    return img


def make_control_textures(tex_path):
    """三张 512 控制贴图，全部按 UV 条带分区。

    这是「单材质也能有局部透光/湿润」的关键：glTF 的 transmissionTexture、
    clearcoatTexture、metallicRoughnessTexture 都是逐像素的，不需要多材质。
    512 足够——它们只控制强度，不含细节。
    """
    W = H = 512
    ys, xs = np.mgrid[0:H, 0:W]
    u = xs.astype(np.float32) / (W - 1)
    vv = ys.astype(np.float32) / (H - 1)
    in_band = lambda b: (vv >= b[0]) & (vv <= b[1])
    # 鳍膜透光不能太高：Cycles/Three.js 的 transmission 是直接穿过不加吸收色，
    # 开到 0.86 会把鳍洗成灰青薄纱。真实鱼鳍是「半透 + 自身色素」，0.5 左右刚好。
    fins = ((BAND_TAIL, 0.38), (BAND_DORSAL, 0.34), (BAND_PECT, 0.30))

    # 透光：鳍膜高，体表只留极薄一层（否则整条鱼像玻璃）
    tr = np.zeros((H, W), dtype=np.float32)
    tr = np.where(in_band(BAND_BODY), 0.04, tr)
    for b, val in fins:
        tr = np.where(in_band(b), val, tr)

    # 清漆：湿润感的来源，但鱼体表不是瓷器。0.55 会出一层镜面把红色全盖住
    cc = np.zeros((H, W), dtype=np.float32)
    cc = np.where(in_band(BAND_BODY), 0.20, cc)
    for b, _ in fins:
        cc = np.where(in_band(b), 0.10, cc)
    cc = np.where(in_band(BAND_EYE), 0.85, cc)

    # 粗糙度：鳞片处再叠一层起伏，比常量更像真实皮肤；金属度恒 0
    rough = np.full((H, W), 0.34, dtype=np.float32)
    for b, _ in fins:
        rough = np.where(in_band(b), 0.15, rough)
    rough = np.where(in_band(BAND_EYE), 0.05, rough)
    rough = np.where(in_band(BAND_BODY),
                     rough + 0.05 * np.sin(u * 168.0) * np.sin(vv * 60.0), rough)
    rough = np.clip(rough, 0.02, 1.0)
    metal = np.zeros((H, W), dtype=np.float32)

    stem = os.path.splitext(tex_path)[0]
    return (
        _save_linear('guppy_tr', [tr], stem + '_tr.png', gray=True),
        _save_linear('guppy_cc', [cc], stem + '_cc.png', gray=True),
        _save_linear('guppy_mr', [np.zeros_like(rough), rough, metal], stem + '_mr.png'),
    )


# ---------------------------------------------------------------- 场景组装

def build_scene(tex_path):
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)

    build_body()
    build_tail()
    build_dorsal()
    build_anal()
    build_pectoral(+1)
    build_pectoral(-1)
    build_eye(+1)
    build_eye(-1)

    me = bpy.data.meshes.new('guppy_tuxedo')
    me.from_pydata(V, [], F)
    me.validate(verbose=False)
    me.update()

    uv_layer = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uv_layer.data[li].uv = UV[vi]

    obj = bpy.data.objects.new('guppy_tuxedo', me)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    # 法线朝外 + 平滑
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for poly in me.polygons:
        poly.use_smooth = True

    img = make_texture(tex_path)
    nimg = make_normal_texture(os.path.splitext(tex_path)[0] + '_nrm.png')
    trimg, ccimg, mrimg = make_control_textures(tex_path)
    mat = bpy.data.materials.new('guppy_tuxedo_mat')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
    bsdf.inputs['Roughness'].default_value = 0.36
    bsdf.inputs['Metallic'].default_value = 0.0
    if 'IOR' in bsdf.inputs:
        bsdf.inputs['IOR'].default_value = 1.36
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.location = (-460, 240)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])

    ntex = nt.nodes.new('ShaderNodeTexImage')
    ntex.image = nimg
    ntex.location = (-460, -140)
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    nmap.location = (-200, -140)
    nmap.inputs['Strength'].default_value = 1.10
    nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])

    # 透光（鳍膜）：KHR_materials_transmission + transmissionTexture
    trn = nt.nodes.new('ShaderNodeTexImage')
    trn.image = trimg
    trn.location = (-460, -420)
    nt.links.new(trn.outputs['Color'], bsdf.inputs['Transmission Weight'])

    # 清漆（湿润高光）：KHR_materials_clearcoat + clearcoatTexture
    ccn = nt.nodes.new('ShaderNodeTexImage')
    ccn.image = ccimg
    ccn.location = (-460, -680)
    nt.links.new(ccn.outputs['Color'], bsdf.inputs['Coat Weight'])
    bsdf.inputs['Coat Roughness'].default_value = 0.16
    if 'Coat IOR' in bsdf.inputs:
        bsdf.inputs['Coat IOR'].default_value = 1.5

    # 粗糙度 / 金属度：metallicRoughnessTexture（G=roughness B=metallic）
    mrn = nt.nodes.new('ShaderNodeTexImage')
    mrn.image = mrimg
    mrn.location = (-460, -940)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    sep.location = (-190, -940)
    nt.links.new(mrn.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    me.materials.append(mat)

    return obj, mat


def export_glb(obj, path):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    kwargs = dict(
        filepath=path,
        export_format='GLB',
        export_apply=True,
        use_selection=True,
        export_materials='EXPORT',
        export_yup=False,          # 关键：保持 Z-up，交给 rig_fish.py 烘焙
        export_animations=False,
        export_skins=False,
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError as e:
        print('glTF 导出参数不兼容，回退最小参数：', e)
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB',
                                  export_apply=True, use_selection=True)
    size = os.path.getsize(path)
    print('EXPORT_OK %s  %.2f MB  verts=%d  faces=%d' % (path, size / 1048576, len(V), len(F)))


def render_preview(path):
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.device = 'CPU'
    scn.cycles.samples = 48
    scn.render.resolution_x = 960
    scn.render.resolution_y = 640
    scn.render.film_transparent = False
    scn.render.filepath = path
    # 预览用 Standard：AgX 会把饱和红压成粉白，没法判断配色是否到位
    try:
        scn.view_settings.view_transform = 'Standard'
        scn.view_settings.look = 'None'
    except Exception as e:
        print('色彩变换设置失败：', e)

    world = bpy.data.worlds.new('w') if not scn.world else scn.world
    scn.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.035, 0.16, 0.21, 1.0)
    bg.inputs[1].default_value = 0.85

    def lamp(name, loc, energy, size, color=(1, 1, 1)):
        d = bpy.data.lights.new(name, 'AREA')
        d.energy = energy
        d.size = size
        d.color = color
        o = bpy.data.objects.new(name, d)
        o.location = loc
        bpy.context.collection.objects.link(o)
        o.rotation_euler = (math.atan2(math.hypot(loc[0], loc[1]), loc[2]) if loc[2] else 0, 0, 0)
        return o

    k = lamp('key', (2.4, -2.6, 3.0), 240, 3.0)
    f = lamp('fill', (-2.6, -1.8, 0.8), 90, 3.5, (0.75, 0.88, 1.0))
    r = lamp('rim', (-1.0, 2.8, 2.2), 150, 2.5, (1.0, 0.92, 0.82))
    for lo, tgt in ((k, (0, 0, 0)), (f, (0, 0, 0)), (r, (0, 0, 0))):
        pass

    cam_d = bpy.data.cameras.new('cam')
    cam_d.lens = 52
    cam = bpy.data.objects.new('cam', cam_d)
    target = (-0.90, 0.0, 0.02)          # 鱼的中心偏 -X（含尾鳍）
    cam.location = (5.6, -6.8, 2.5)
    bpy.context.collection.objects.link(cam)
    scn.camera = cam
    import mathutils
    aim = mathutils.Vector(target) - mathutils.Vector(cam.location)
    cam.rotation_euler = aim.to_track_quat('-Z', 'Y').to_euler()

    # 三点光：都指向鱼的中心
    for o in (k, f, r):
        d = mathutils.Vector(target) - o.location
        o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

    bpy.ops.render.render(write_still=True)
    print('PREVIEW_OK %s' % path)


def main():
    argv = sys.argv
    args = argv[argv.index('--') + 1:] if '--' in argv else []
    if not args:
        print('用法: -- <out.glb> [preview.png]')
        raise SystemExit(1)
    out_glb = os.path.abspath(args[0])
    tex_dir = os.path.dirname(out_glb)
    os.makedirs(tex_dir, exist_ok=True)
    tex_path = os.path.join(tex_dir, os.path.splitext(os.path.basename(out_glb))[0] + '_tex.png')
    preview = os.path.abspath(args[1]) if len(args) > 1 else None

    obj, mat = build_scene(tex_path)
    print('MESH verts=%d faces=%d' % (len(V), len(F)))
    export_glb(obj, out_glb)
    if preview:
        render_preview(preview)


main()
