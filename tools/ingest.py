"""把一个外部 GLB 接入鱼缸：校验 → 压缩 → 绑骨（含鳍骨）→ 生成 Turn 片段 → 挂到品种 → 重建内嵌包。

不管模型是从混元、Meshy、Tripo、Rodin 还是别处来的，走这一条就行。

用法:
  python3 tools/ingest.py <模型.glb> <品种id> [--name 中文名] [--no-config] [--keep-name]

  --no-config   只处理模型，不改 species.js、不重建内嵌包（试跑用）
  --keep-name   不改文件名，用原文件名落盘
"""
import json
import os
import shutil
import struct
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOLS = os.path.join(ROOT, 'tools')
MODELS = os.path.join(ROOT, 'models')
TMP = os.path.join(MODELS, '_tmp')


def sh(cmd):
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr)
        raise SystemExit('失败: ' + ' '.join(cmd))
    return r.stdout.strip()


def glb_info(path):
    d = open(path, 'rb').read()
    assert struct.unpack('<I', d[:4])[0] == 0x46546C67, '不是 GLB'
    jl = struct.unpack('<I', d[12:16])[0]
    g = json.loads(d[20:20 + jl])
    prim = g['meshes'][0]['primitives'][0]
    n = g['accessors'][prim['attributes']['POSITION']]['count']
    a = g['accessors'][prim['attributes']['POSITION']]
    size = [round(a['max'][i] - a['min'][i], 3) for i in range(3)]
    tris = sum(g['accessors'][p['indices']]['count'] // 3
               for m in g['meshes'] for p in m['primitives'] if 'indices' in p)
    return {'verts': n, 'tris': tris, 'size': size,
            'prims': len(g['meshes'][0]['primitives']),
            'anims': len(g.get('animations', [])),
            'skins': len(g.get('skins', []))}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = [a for a in sys.argv[1:] if a.startswith('--')]
    if len(args) < 2:
        print(__doc__)
        raise SystemExit(1)
    src, sid = args[0], args[1]
    cn_name = args[2] if len(args) > 2 else sid
    no_cfg = '--no-config' in flags
    # 大尾鱼（程序化生成）需要把尾鳍起点往前推，透传给 rig_fish.py 第 4 个参数
    tail_u = next((f.split('=', 1)[1] for f in flags if f.startswith('--tail-u=')), None)
    # 模型已是 Y-up（Blender export_yup=True 直出）时，要让 rig_fish 跳过烘焙，
    # 否则 (x,-z,y) 会把背朝 +Z 的模型翻成上下颠倒
    yup = '--yup' in flags

    os.makedirs(TMP, exist_ok=True)
    base = os.path.splitext(os.path.basename(src))[0]
    out_name = (base if '--keep-name' in flags else sid) + '_rigged.glb'
    dst = os.path.join(MODELS, out_name)

    print('① 校验源文件')
    info = glb_info(src)
    print('   顶点 %d  面 %d  尺寸 %s  图元 %d  动画 %d  蒙皮 %d' %
          (info['verts'], info['tris'], info['size'], info['prims'], info['anims'], info['skins']))
    if info['prims'] > 1:
        print('   ⚠ 有多个图元，只处理第 0 个')
    if info['verts'] < 500:
        raise SystemExit('顶点太少，不像一个完整模型')
    if info['skins'] and info['anims']:
        print('   ✓ 自带蒙皮和动画，将直接沿用')
    elif info['skins']:
        print('   ⚠ 自带蒙皮但没有动画，绑骨会覆盖它')

    print('② 压缩贴图')
    packed = os.path.join(TMP, base + '_pack.glb')
    print('   ' + sh(['python3', os.path.join(TOOLS, 'pack_model.py'), src, packed, '1024', '0.5']).splitlines()[-1].strip())

    already = info['skins'] > 0 and info['anims'] > 0
    if already:
        # Tripo / Meshy 的 auto-rig 出品：自带骨骼和动画，别覆盖它
        print('③ 源文件已有骨骼和动画，跳过绑骨与 Turn 生成')
        shutil.copy(packed, dst)
    else:
        print('③ 绑骨（9 脊椎 + 3 鳍骨，Lighthill 包络）')
        rigged = os.path.join(TMP, base + '_rig.glb')
        rig_args = ['python3', os.path.join(TOOLS, 'rig_fish.py'), packed, rigged, '0.105']
        rig_args.append(tail_u if tail_u else '0.93')
        if tail_u:
            print('   尾鳍起点 u=%s（大尾鱼）' % tail_u)
        if yup:
            rig_args.append('nobake')
            print('   模型已是 Y-up，跳过 Z-up→Y-up 烘焙')
        for line in sh(rig_args).splitlines():
            if '骨' in line or '鳍顶点' in line or '摆幅' in line:
                print('   ' + line.strip())

        print('④ 生成 Turn 片段（大摆幅 + 扭转 + C 形弯曲）')
        print('   ' + sh(['python3', os.path.join(TOOLS, 'add_turn_clip.py'), rigged, dst,
                          '1.55', '0.30', '0.22']).splitlines()[-1].strip())

    print('⑤ 质量闸门')
    ok = True
    clips = (('0', 'Swim'),) if already else (('0', 'Swim'), ('1', 'Turn'))
    for clip, label in clips:
        env = dict(os.environ, CLIP=clip)
        r = subprocess.run(['python3', os.path.join(TOOLS, 'check_skin.py'), dst],
                           cwd=ROOT, capture_output=True, text=True, env=env)
        line = (r.stdout or r.stderr).strip()
        print('   ' + line)
        if '异常' in line or 'Traceback' in line:
            ok = False
    if not ok:
        raise SystemExit('   ✗ 蒙皮异常，已中止（文件未接入）')

    size_mb = os.path.getsize(dst) / 1048576
    print('   ✓ %s  %.2f MB' % (out_name, size_mb))

    if no_cfg:
        print('\n(--no-config) 只生成模型，未改品种配置')
        return

    print('⑥ 挂到品种 %s' % sid)
    # 复用 ingest_decor.patch_species：按对象范围定位并替换已有 model 字段。
    # 旧实现用「id 到 look 之间有没有 model」判断，而 attach_models.py 会把 model
    # 插在 look 之后，于是误判成没配置，再插一行 —— 写出重复键（JS 里后者静默覆盖
    # 前者，不报错但会悄悄丢配置）。
    import importlib.util
    _sp = importlib.util.spec_from_file_location(
        'ingest_decor', os.path.join(TOOLS, 'ingest_decor.py'))
    _dec = importlib.util.module_from_spec(_sp)
    _sp.loader.exec_module(_dec)
    print('   ✓ %s model 字段' % _dec.patch_species(sid, out_name))

    print('⑦ 重建内嵌包')
    print('   ' + sh(['node', os.path.join(TOOLS, 'build-models.js')]))

    print('\n完成。刷新页面即可看到「%s」用上新模型（file:// 下会自动带版本号绕缓存）。' % cn_name)
    print('如果朝向反了，把 species.js 里该品种的 yaw 改成 Math.PI 再试。')


main()
