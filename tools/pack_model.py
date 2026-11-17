"""把生成出来的原始 GLB 压到适合网页的体积。

- 0 号贴图是法线图，必须无损（PNG），压成 JPEG 会在高光边缘出现块状伪影
- 1 号是基础色，用 JPEG
- 2 号是 metallicRoughness，原产物常常是一张纯红（roughness=0），直接丢掉，
  改用 roughnessFactor 控制，否则会渲染成釉面/镜面

用法: python3 tools/pack_model.py <src.glb> <dst.glb> [边缘像素=1024] [粗糙度=0.5]
"""
import io
import json
import struct
import sys

from PIL import Image

SRC, DST = sys.argv[1], sys.argv[2]
EDGE = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
ROUGH = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
DROP_IMAGES = {2}

raw = open(SRC, "rb").read()
assert struct.unpack("<I", raw[:4])[0] == 0x46546C67, "not a glb"
off = 12
chunks = []
while off < len(raw):
    clen, ctype = struct.unpack("<II", raw[off:off + 8])
    chunks.append((ctype, raw[off + 8:off + 8 + clen]))
    off += 8 + clen

gltf = json.loads(chunks[0][1].decode("utf-8"))
bin_blob = chunks[1][1]
views = gltf["bufferViews"]

new_blobs = {i: bin_blob[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
             for i, bv in enumerate(views)}

# ---------------------------------------------------------------- 材质与贴图槽
# 旧实现按「0 号法线 / 1 号基础色 / 2 号丢弃」猜索引。程序化模型（tools/blender/*.py）
# 会多出 transmission / clearcoat / metallicRoughness 贴图，按索引猜必然错位删图。
# 现在改成按槽位语义处理，并用材质扩展自动区分两类来源：
#   - AI 产物（无 KHR_materials_transmission/clearcoat/volume）：沿用旧行为，
#     丢掉常为纯红的 metallicRoughness 贴图、统一 roughnessFactor，避免渲成釉面。
#   - 程序化 PBR（带上述扩展）：保留 metallicRoughness 与原参数。
mat = gltf["materials"][0]
pbr = mat.setdefault("pbrMetallicRoughness", {})
EXT = mat.get("extensions", {})
FANCY = any(k in EXT for k in ("KHR_materials_transmission",
                               "KHR_materials_clearcoat",
                               "KHR_materials_volume"))

if not FANCY:
    pbr.pop("metallicRoughnessTexture", None)
    pbr["metallicFactor"] = 0.0
    pbr["roughnessFactor"] = ROUGH
    spec = EXT.get("KHR_materials_specular")
    if spec:
        spec["specularColorFactor"] = [1.0, 1.0, 1.0]
else:
    print("  材质带扩展 %s，保留 metallicRoughness 与原粗糙度" % sorted(EXT.keys()))

slots = []


def _collect(node):
    if isinstance(node, dict):
        for k, v in node.items():
            if k.endswith("Texture") and isinstance(v, dict) and "index" in v:
                slots.append((v, k))
            else:
                _collect(v)
    elif isinstance(node, list):
        for v in node:
            _collect(v)


_collect(mat)


def _role(key):
    # 只有基础色 / 自发光可以用有损 JPEG；法线与各类遮罩必须无损，
    # 否则 8x8 块会让法线出方格、遮罩边缘出毛刺。
    return "color" if key in ("baseColorTexture", "emissiveTexture") else "linear"


img_role = {}
for slot, key in slots:
    ti = slot.get("index")
    if ti is None or ti >= len(gltf.get("textures", [])):
        continue
    src = gltf["textures"][ti].get("source")
    if src is None:
        continue
    r = _role(key)
    if src not in img_role or r == "color":
        img_role[src] = r

used_images = set(img_role)

# ---------------------------------------------------------------- 压缩被引用的贴图
for src in sorted(img_role):
    role = img_role[src]
    im = gltf["images"][src]
    vi = im["bufferView"]
    img = Image.open(io.BytesIO(new_blobs[vi]))
    src_size = img.size
    if max(img.size) > EDGE:
        r = EDGE / max(img.size)
        img = img.resize((max(1, round(img.size[0] * r)), max(1, round(img.size[1] * r))), Image.LANCZOS)
    buf = io.BytesIO()
    if role == "color":
        img.convert("RGB").save(buf, "JPEG", quality=92, optimize=True, progressive=True)
        mime = "image/jpeg"
    else:
        img.save(buf, "PNG", optimize=True)
        mime = "image/png"
    new_blobs[vi] = buf.getvalue()
    im["mimeType"] = mime
    print("  img%d[%-6s] %dx%d -> %dx%d  %dKB  %s" % (src, role, src_size[0], src_size[1],
                                                     img.size[0], img.size[1],
                                                     len(buf.getvalue()) // 1024, mime))

# ---------------------------------------------------------------- 只留被引用的图，按语义重排索引
dropped_views = set()
for i, im in enumerate(gltf["images"]):
    if i not in used_images:
        dropped_views.add(im["bufferView"])

img_remap = {}
new_images = []
for old in sorted(used_images):
    img_remap[old] = len(new_images)
    new_images.append(gltf["images"][old])
gltf["images"] = new_images

tex_remap = {}
new_textures = []
for old_ti, t in enumerate(gltf.get("textures", [])):
    src = t.get("source")
    if src not in img_remap:
        continue
    tex_remap[old_ti] = len(new_textures)
    nt = dict(t)
    nt["source"] = img_remap[src]
    new_textures.append(nt)
gltf["textures"] = new_textures

for slot, key in slots:
    old = slot.get("index")
    if old in tex_remap:
        slot["index"] = tex_remap[old]
    else:
        print("  \u26a0 %s 指向已丢弃的贴图 %s，回退 0" % (key, old))
        slot["index"] = 0

out = bytearray()
new_views = []
view_remap = {}
for vi in sorted(new_blobs):
    if vi in dropped_views:
        continue
    payload = new_blobs[vi]
    while len(out) % 4:
        out.append(0)
    nbv = dict(views[vi])
    nbv["buffer"] = 0
    nbv["byteOffset"] = len(out)
    nbv["byteLength"] = len(payload)
    view_remap[vi] = len(new_views)
    new_views.append(nbv)
    out.extend(payload)

gltf["bufferViews"] = new_views
for im in gltf["images"]:
    im["bufferView"] = view_remap[im["bufferView"]]
for a in gltf["accessors"]:
    if "bufferView" in a:
        a["bufferView"] = view_remap[a["bufferView"]]

while len(out) % 4:
    out.append(0)
gltf["buffers"] = [{"byteLength": len(out)}]

js = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
while len(js) % 4:
    js += b" "
glb = bytearray()
glb += struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out))
glb += struct.pack("<II", len(js), 0x4E4F534A) + js
glb += struct.pack("<II", len(out), 0x004E4942) + bytes(out)
open(DST, "wb").write(glb)
print("  -> %s  %.2f MB (was %.2f MB)" % (DST, len(glb) / 1048576, len(raw) / 1048576))
