"""把 models/*.glb 预渲染成列表用的缩略图（models/thumbs/<名字>.png）。

为什么要预渲染：图鉴/商店的图标如果现场用 WebGL 离屏渲染 45k 面的蒙皮模型，
在软件渲染环境下会把主线程卡住（启动时要画十几张，直接卡死）。
离线渲成 176×120 的小图后，前端只是 drawImage，成本接近 0。

用法: python3 tools/make_thumbs.py [宽] [高]
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, 'models')
OUT = os.path.join(MODELS, 'thumbs')
W = sys.argv[1] if len(sys.argv) > 1 else '176'
H = sys.argv[2] if len(sys.argv) > 2 else '120'

os.makedirs(OUT, exist_ok=True)
BASE_ENV = dict(os.environ, QR_BG='13,60,76')      # 和离屏缩略图同一套深青底色
# 这两个 AI 摆件是 Z-up（长轴 -Z），按默认正面渲只会拍到横截面；
# 浮萍是贴水面的极扁模型，正面看只剩一条线，改用俯视。
# 砂盘底座已由 trim_decor_base.py 从几何删除，无需再按高度裁切。
VIEW_OF = {
    'anubias.glb': {'QR_AXIS': 'z'},      # 砂盘已由 trim_decor_base.py 从几何删除
    'hornwort.glb': {'QR_AXIS': 'z'},
    'duckweed.glb': {'QR_VIEW': 'top'},
    # 11-17 新接入的 4 个 AI 水草同样以 Z 为竖直轴，不扶正会拍成俯视截面
    # （蜈蚣草会被拍成一朵正面莲座、莫斯只剩底下的砂盘）。
    'sword.glb': {'QR_AXIS': 'z'},
    'hairgrass.glb': {'QR_AXIS': 'z'},
    'moss.glb': {'QR_AXIS': 'z'},
    'elodea.glb': {'QR_AXIS': 'z'},
}
files = sorted(f for f in os.listdir(MODELS) if f.endswith('.glb'))
for f in files:
    src = os.path.join(MODELS, f)
    dst = os.path.join(OUT, f + '.png')
    env = {k: v for k, v in BASE_ENV.items() if k not in ('QR_AXIS', 'QR_VIEW', 'QR_CUT')}
    env.update(VIEW_OF.get(f, {}))
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'quick_render.py'),
                        src, dst, W, H], env=env, capture_output=True, text=True)
    if r.returncode == 0:
        print('OK  %-26s %6.1f KB' % (f, os.path.getsize(dst) / 1024))
    else:
        print('FAIL', f, (r.stderr or r.stdout).strip()[:200])

# ---- 共用写实模型的培育品种：派生染色缩略图 ----
# render.js:glbLookOf() 对「共用基础品种 GLB 的 breedGroup 品种」启用 soft 双色重映射，
# 但列表小图标是静态 PNG，不会走 shader。这里离线复刻同一套公式派生一张，
# 让 betta_red / betta_white 在图鉴列表里也能和暹罗斗鱼区分开。
# c1/c2 与 species.js 的 look 一致；权重 0.45 对应 shader 的 soft 分支。
LOOK_ICONS = [
    ('betta_rigged.glb', 'betta_red',   '#d8363f', '#681221', 0.45),
    ('betta_rigged.glb', 'betta_white', '#e8eef0', '#8fa5b4', 0.45),
]

def _rgb(h):
    h = h.lstrip('#')
    return [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]

def _smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)

try:
    from PIL import Image
except ImportError:
    Image = None

if Image:
    bg = tuple(int(v) for v in BASE_ENV['QR_BG'].split(','))
    for glb, sid, c1, c2, weight in LOOK_ICONS:
        src_png = os.path.join(OUT, glb + '.png')
        dst_png = os.path.join(OUT, glb + '__' + sid + '.png')
        if not os.path.exists(src_png):
            print('SKIP look icon', sid, '(基础图标缺失)')
            continue
        ca, cb = _rgb(c1), _rgb(c2)
        im = Image.open(src_png).convert('RGB')
        px = im.load()
        for y in range(im.height):
            for x in range(im.width):
                r, g, bl = px[x, y]
                dist = abs(r - bg[0]) + abs(g - bg[1]) + abs(bl - bg[2])
                if dist < 12:                       # 纯背景，不动
                    continue
                lum = (0.299 * r + 0.587 * g + 0.114 * bl) / 255.0
                mask = _smoothstep(0.10, 0.60, lum)
                scale = 0.70 + 0.55 * lum
                fg = _smoothstep(12, 60, float(dist))   # 抗锯齿边缘渐变，避免硬边
                w = weight * fg
                out = []
                for i, orig in enumerate((r, g, bl)):
                    target = (cb[i] + (ca[i] - cb[i]) * mask) * scale * 255.0
                    out.append(int(max(0, min(255, orig + (target - orig) * w))))
                px[x, y] = tuple(out)
        im.save(dst_png)
        print('OK  %-30s %6.1f KB (look icon)' %
              (os.path.basename(dst_png), os.path.getsize(dst_png) / 1024))
