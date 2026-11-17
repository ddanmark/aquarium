"""探测 Blender 5.3 glTF 导出器对 KHR_materials_* 扩展与逐像素贴图的支持。

只做一件事：造一个带 clearcoat / transmission / volume / iridescence 的材质，
各输入都接上 Image Texture，导出 GLB，然后打印材质 extensions 与贴图槽。
用来决定「靠导出器」还是「导出后手工注入 JSON」。

  blender.exe -b --factory-startup --python tools/blender/_probe_ext.py -- <out.glb>
"""
import os
import sys

import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(args[0]) if args else os.path.abspath('probe_ext.glb')
TEX_DIR = os.path.dirname(OUT)
os.makedirs(TEX_DIR, exist_ok=True)


def make_img(name, rgb):
    """生成一张纯色小图，作为各输入的贴图源。"""
    W = H = 8
    px = np.zeros((H, W, 4), dtype=np.float32)
    px[..., 0] = rgb[0]
    px[..., 1] = rgb[1]
    px[..., 2] = rgb[2]
    px[..., 3] = 1.0
    img = bpy.data.images.new(name, W, H, alpha=True)
    img.pixels.foreach_set(px.ravel())
    p = os.path.join(TEX_DIR, name + '.png')
    img.filepath_raw = p
    img.file_format = 'PNG'
    img.save()
    return img


for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob, do_unlink=True)

bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=16, ring_count=8)
obj = bpy.context.active_object

# 贴图源：分开的几张，避免通道互相干扰，便于看清导出器行为
tex_base = make_img('probe_base', (0.8, 0.2, 0.2))
tex_nrm = make_img('probe_nrm', (0.5, 0.5, 1.0))
tex_ao = make_img('probe_ao', (0.9, 0.9, 0.9))
tex_mr = make_img('probe_mr', (0.0, 0.45, 0.0))       # G=roughness B=metallic
tex_tr = make_img('probe_tr', (1.0, 0.1, 0.0))        # R=transmission
tex_cc = make_img('probe_cc', (0.7, 0.1, 0.0))        # R=clearcoat G=clearcoatRough

mat = bpy.data.materials.new('probe_mat')
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes.get('Principled BSDF')


def tex_node(img, loc):
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = img
    n.location = loc
    return n


tex_node(tex_base, (-800, 400))
nt.links.new(nt.nodes[-1].outputs['Color'], bsdf.inputs['Base Color'])

n_nrm = tex_node(tex_nrm, (-800, 100))
nmap = nt.nodes.new('ShaderNodeNormalMap')
nmap.location = (-500, 100)
nt.links.new(n_nrm.outputs['Color'], nmap.inputs['Color'])
nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])

# metallicRoughness：Blender 侧用 Separate Color 拆通道
n_mr = tex_node(tex_mr, (-800, -160))
sep = nt.nodes.new('ShaderNodeSeparateColor')
sep.location = (-560, -160)
nt.links.new(n_mr.outputs['Color'], sep.inputs['Color'])
nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])

# transmission
n_tr = tex_node(tex_tr, (-800, -420))
if 'Transmission Weight' in bsdf.inputs:
    nt.links.new(n_tr.outputs['Color'], bsdf.inputs['Transmission Weight'])
elif 'Transmission' in bsdf.inputs:
    nt.links.new(n_tr.outputs['Color'], bsdf.inputs['Transmission'])

# clearcoat
n_cc = tex_node(tex_cc, (-800, -680))
cc_key = 'Coat Weight' if 'Coat Weight' in bsdf.inputs else 'Clearcoat'
if cc_key in bsdf.inputs:
    nt.links.new(n_cc.outputs['Color'], bsdf.inputs[cc_key])
cc_r_key = 'Coat Roughness' if 'Coat Roughness' in bsdf.inputs else 'Clearcoat Roughness'
if cc_r_key in bsdf.inputs:
    bsdf.inputs[cc_r_key].default_value = 0.1

for k, v in (('IOR', 1.36),):
    if k in bsdf.inputs:
        bsdf.inputs[k].default_value = v

obj.data.materials.append(mat)

print('BSDF inputs:', [i.name for i in bsdf.inputs])
print('has Thin Film:', 'Thin Film Thickness' in bsdf.inputs)

kwargs = dict(filepath=OUT, export_format='GLB', export_yup=False,
              use_selection=False, export_apply=True)
try:
    bpy.ops.export_scene.gltf(**kwargs)
except TypeError as e:
    print('参数不兼容:', e)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB')

print('PROBE_WROTE', OUT, os.path.getsize(OUT), 'bytes')
