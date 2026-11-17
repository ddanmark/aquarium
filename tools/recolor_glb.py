"""从已有 GLB 派生一份「同形体、不同壳色」的模型（用于苹果螺 / 神秘螺等）。

复用基础色贴图，按亮度把纹理重映射到目标双色，保留原有明暗与纹理细节。
会重建 BIN chunk 并修正所有 bufferView 的 byteOffset（贴图长度变化时必需）。

用法: python3 tools/recolor_glb.py <源.glb> <目标.glb> <亮色#RRGGBB> <暗色#RRGGBB> [--strength=0.85]
"""
import io
import json
import os
import struct
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def hexrgb(s):
    h = s.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def remap(im, c1, c2, strength):
    im = im.convert('RGB')
    px = im.load()
    W, H = im.size
    for y in range(H):
        for x in range(W):
            r, g, b = px[x, y]
            lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
            mask = smoothstep(0.10, 0.60, lum)
            k = 0.70 + 0.55 * lum
            tgt = [(c2[i] + (c1[i] - c2[i]) * mask) * k for i in range(3)]
            old = (r, g, b)
            px[x, y] = tuple(max(0, min(255, int(old[i] * (1 - strength) + tgt[i] * strength)))
                             for i in range(3))
    return im


def write_glb(path, gltf, segs, views):
    """按 segs 顺序重建 BIN，并同步修正 bufferView 偏移。"""
    out = bytearray()
    newviews = []
    for i, seg in enumerate(segs):
        while len(out) % 4:
            out.append(0)
        v = dict(views[i])
        v['byteOffset'] = len(out)
        v['byteLength'] = len(seg)
        newviews.append(v)
        out.extend(seg)
    gltf['bufferViews'] = newviews
    gltf['buffers'][0]['byteLength'] = len(out) + (4 - len(out) % 4) % 4
    js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    bn = bytes(out) + b'\0' * ((4 - len(out) % 4) % 4)
    with open(path, 'wb') as fp:
        fp.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(bn)))
        fp.write(struct.pack('<I4s', len(js), b'JSON'))
        fp.write(js)
        fp.write(struct.pack('<I4s', len(bn), b'BIN\0'))
        fp.write(bn)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 4:
        print(__doc__)
        raise SystemExit(1)
    src, dst, c1, c2 = args[0], args[1], hexrgb(args[2]), hexrgb(args[3])
    strength = 0.85
    for a in sys.argv[1:]:
        if a.startswith('--strength='):
            strength = float(a.split('=', 1)[1])

    d = open(src, 'rb').read()
    jl = struct.unpack('<I', d[12:16])[0]
    gltf = json.loads(d[20:20 + jl])
    boff = 20 + jl + 8
    blen = struct.unpack('<I', d[20 + jl:24 + jl])[0]
    bin_data = d[boff:boff + blen]
    views = gltf['bufferViews']
    segs = [bin_data[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in views]

    # 找到基础色贴图所在的 bufferView
    mats = gltf.get('materials', [])
    if not mats:
        raise SystemExit('源 GLB 没有材质')
    tex_idx = mats[0]['pbrMetallicRoughness']['baseColorTexture']['index']
    img_idx = gltf['textures'][tex_idx]['source']
    vi = gltf['images'][img_idx]['bufferView']
    mime = gltf['images'][img_idx].get('mimeType', 'image/png')

    im = Image.open(io.BytesIO(segs[vi]))
    fmt = 'JPEG' if 'jpeg' in mime or 'jpg' in mime else 'PNG'
    out = remap(im, c1, c2, strength)
    buf = io.BytesIO()
    if fmt == 'JPEG':
        out.save(buf, format='JPEG', quality=90)
    else:
        out.save(buf, format='PNG', optimize=True)
    segs[vi] = buf.getvalue()
    write_glb(dst, gltf, segs, views)
    print('%s → %s  (%s, %.1f KB, 贴图 %.1f KB)' %
          (os.path.basename(src), os.path.basename(dst), fmt,
           os.path.getsize(dst) / 1024.0, len(segs[vi]) / 1024.0))


if __name__ == '__main__':
    main()
