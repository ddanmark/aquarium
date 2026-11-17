"""批量把 models/ 下的 GLB 挂到 species.js 的品种上。

复用 ingest_decor.patch_species（它会保留 axis / baseCut 等手调参数，且不会写坏对象闭合）。
用法: python3 tools/attach_models.py
"""
import importlib.util
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, 'models')
spec = importlib.util.spec_from_file_location('ingest', os.path.join(ROOT, 'tools', 'ingest_decor.py'))
ing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ing)

# 第二批参数化鱼（gen-fish-models.js 产出）
FISH = ['neon', 'cardinal', 'goldfish', 'gold_black', 'koi', 'koi_sanke',
        'discus', 'guppy_red', 'guppy_blue', 'swordtail', 'clownloach', 'pearlgourami']
# 参数化水草（gen_decor_glb.py 产出）
PLANTS = ['moss', 'elodea', 'sword', 'duckweed', 'hairgrass']
# 重着色螺（recolor_glb.py 产出）
INVERTS = ['apple', 'mystery']

MAP = {}
for sid in FISH:
    MAP[sid] = sid + '_rigged.glb'
for sid in PLANTS + INVERTS:
    MAP[sid] = sid + '.glb'


def main():
    missing = [f for f in MAP.values() if not os.path.exists(os.path.join(MODELS, f))]
    if missing:
        raise SystemExit('缺少模型文件: ' + ', '.join(missing))
    for sid, fn in MAP.items():
        # 参数化水草本来就是 Y-up；矮而横铺的品种（moss/duckweed）不能被
        # buildGlbPlant 的「最长轴」自动扶正误判成 Z-up，这里显式声明轴向。
        extra = {'axis': "'y'"} if sid in PLANTS else None
        try:
            print('  %-16s → %-26s %s' % (sid, fn, ing.patch_species(sid, fn, extra)))
        except SystemExit as e:
            print('  [跳过] %s: %s' % (sid, e))
    r = subprocess.run(['node', '--check', os.path.join(ROOT, 'js', 'species.js')],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('species.js 语法损坏:\n' + r.stderr[:500])
    print('species.js 语法检查 PASS，共挂载 %d 个品种' % len(MAP))


if __name__ == '__main__':
    main()
