"""把水草 / 石头这类「静态摆件」GLB 接入鱼缸：校验 → 压贴图 → 挂到品种 → 重建内嵌包。

和 ingest.py 的区别：不做绑骨、不生成动画片段，因为水草和石头不需要游动。

用法:
  python3 tools/ingest_decor.py <模型.glb> <品种id> [--rough=0.75] [--edge=1024]
  例: python3 tools/ingest_decor.py models/_raw/anubias.glb anubias
"""
import json
import os
import re
import shutil
import struct
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, 'models')
TMP = os.path.join(MODELS, '_tmp')
SPECIES = os.path.join(ROOT, 'js', 'species.js')


def run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise SystemExit('命令失败: %s\n%s' % (' '.join(cmd), (r.stderr or r.stdout)[:400]))
    return r.stdout


def glb_info(path):
    d = open(path, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    g = json.loads(d[20:20 + jl])
    verts = tris = 0
    for m in g.get('meshes', []):
        for p in m.get('primitives', []):
            verts += g['accessors'][p['attributes']['POSITION']]['count']
            if 'indices' in p:
                tris += g['accessors'][p['indices']]['count'] // 3
    return {'verts': verts, 'tris': tris, 'images': len(g.get('images', [])),
            'anims': len(g.get('animations', [])), 'skins': len(g.get('skins', []))}


def entry_span(text, sid):
    """定位 species.js 里 id: '<sid>' 这个对象字面量的 [start, end)，end 指向闭合的 '}'。"""
    m = re.search(r"id:\s*'%s'" % re.escape(sid), text)
    if not m:
        return None
    start = text.rfind('{', 0, m.start())
    depth = 0
    i = start
    quote = None
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in '\'"':
            quote = ch
        elif ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return start, i
        i += 1
    return None


def patch_species(sid, filename=None, props=None):
    """给品种挂 model 字段。filename 缺省为 <sid>.glb。

    已存在 model 时只替换 file/yaw，并保留 axis / baseCut / pitch 等自定义键，
    避免重复接入 AI 摆件时把手调的朝向与底座参数冲掉。
    props 可显式追加/覆盖键值，值应是 JS 字面量文本，如 {'axis': "'y'"}.
    """
    # 二进制读写：Windows 下文本模式会把 LF 全改成 CRLF，导致整个文件 diff 重写
    text = open(SPECIES, 'rb').read().decode('utf-8')
    span = entry_span(text, sid)
    if not span:
        raise SystemExit('species.js 里没找到 id=%s 的对象' % sid)
    s, e = span                      # e 指向对象自身的闭合 '}'（包含在 text[e:] 里）
    block = text[s:e]               # 因此 block 不含闭合 '}'
    mexist = re.search(r'model:\s*\{([^}]*)\}', block)
    tail = {}
    if mexist:
        for key in ('axis', 'baseCut', 'pitch'):
            km = re.search(r"\b%s:\s*('[^']*'|-?[\d.]+)" % key, mexist.group(1))
            if km:
                tail[key] = km.group(1)
    if props:
        tail.update(props)
    keep = ''.join(', %s: %s' % (k, v) for k, v in tail.items())
    line = "model: { file: '%s', yaw: 0%s }" % (filename or sid + '.glb', keep)
    if mexist:
        # 用函数式替换，防止替换串被 re.sub 当成组引用解析
        new_block = re.sub(r'model:\s*\{[^}]*\}', lambda _m: line, block, count=1)
        status = '已更新'
    else:
        # 只去掉末尾空白与可选尾逗号，绝不能砍掉 block 的最后一个字符
        body = block.rstrip()
        if body.endswith(','):
            body = body[:-1].rstrip()
        indent = re.search(r'\n([ \t]+)\S', body)
        ind = indent.group(1) if indent else '      '
        # 对象闭合括号所在行的缩进（与起始 '{' 同行前缀一致）
        line_start = text.rfind('\n', 0, s) + 1
        close_ind = re.match(r'[ \t]*', text[line_start:s]).group(0) or '    '
        # 关键：这里只插入字段，闭合 '}' 必须留给 text[e:]，否则会写出 '}}'
        new_block = body + ',\n' + ind + line + '\n' + close_ind
        status = '已写入'
    text = text[:s] + new_block + text[e:]
    open(SPECIES, 'wb').write(text.encode('utf-8'))
    return status


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2:
        print(__doc__)
        raise SystemExit(1)
    src, sid = args[0], args[1]
    rough, edge = '0.75', '1024'
    for a in sys.argv[1:]:
        if a.startswith('--rough='):
            rough = a.split('=', 1)[1]
        if a.startswith('--edge='):
            edge = a.split('=', 1)[1]

    print('① 校验源文件')
    info = glb_info(src)
    print('   顶点 %d  面 %d  贴图 %d  动画 %d  蒙皮 %d' %
          (info['verts'], info['tris'], info['images'], info['anims'], info['skins']))
    if not info['verts']:
        raise SystemExit('源文件里没有网格')

    print('② 压缩贴图（法线无损 PNG / 基础色 JPEG，丢掉 MR 图）')
    os.makedirs(TMP, exist_ok=True)
    packed = os.path.join(TMP, sid + '_pack.glb')
    run([sys.executable, os.path.join(ROOT, 'tools', 'pack_model.py'), src, packed, edge, rough])
    dst = os.path.join(MODELS, sid + '.glb')
    shutil.copy(packed, dst)
    print('   -> models/%s.glb  %.2f MB' % (sid, os.path.getsize(dst) / 1048576))

    print('③ 挂到品种 %s' % sid)
    print('   ✓ %s model 字段' % patch_species(sid))

    print('④ 重建内嵌包')
    out = run(['node', os.path.join(ROOT, 'tools', 'build-models.js')], cwd=ROOT)
    print('   ' + out.strip().splitlines()[-1].strip() if out.strip() else '')


if __name__ == '__main__':
    main()
