/* 程序化鱼模型 GLB 生成器：node tools/gen-fish-models.js
 *
 * 每条鱼输出一个带骨骼（spine_00..07 链）+ Swim 摆尾动画 + 程序化 PNG 贴图的 GLB：
 *   体型 = 沿体轴放样（superellipse 透镜截面，背脊/腹圆/脊线下垂）
 *   鳍   = 背/臀/尾/胸鳍参数化网格（顶点色渐变）
 *   贴图 = 逐像素绘制（体色渐变 + 品种花纹 + 鳞片 + 双侧眼睛），鳍区留白用顶点色
 *   蒙皮 = 每顶点绑定 2 根最近骨骼
 * 运行：node tools/gen-fish-models.js   → models/<id>_rigged.glb
 * 之后再跑 node tools/build-models.js   → 更新 file:// 内嵌包
 */
const T = require('../vendor/three.min.js');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ================= PNG 编码 ================= */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])), 0);
  return Buffer.concat([len, typeB, data, crcB]);
}
function pngEncode(w, h, rgba) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 8 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* ================= 颜色 ================= */
function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function mix(a, b, k) {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/* ================= 品种定义 ================= */
const SPECIES = [
  {
    id: 'betta', cn: '斗鱼',
    profile: 'compressiform', bodyH: 0.30, bodyW: 0.72, len: 1.0, flatBelly: false,
    sil: { snout: 0.08, hump: 0.10, pedK: 0.60 },
    pal: { back: '#6a0c20', mid: '#d42040', belly: '#f0705a' },
    paint: function (ub, v) {
      const side = (v > 0.12 && v < 0.42) || (v > 0.58 && v < 0.88);
      if (side && Math.sin(ub * 43) * Math.cos(v * 40) > 0.55) return hexRgb('#3a54b8');
      return null;
    },
    fins: {
      color: '#d42040', edge: '#7a3ac0',
      dorsal: { h: 0.52, from: 0.10, to: 0.52 },
      anal: { h: 0.48, from: 0.40, to: 0.62 },
      tail: { kind: 'veil', len: 0.52, spread: 0.34, lift: -0.10 },
      pectoral: { len: 0.14 }
    }
  },
  {
    id: 'otocinclus', cn: '小精灵',
    profile: 'anguilliform', bodyH: 0.19, bodyW: 0.78, len: 1.0, flatBelly: true,
    sil: { snout: 0.30, pedK: 0.82 },
    pal: { back: '#5a6a4c', mid: '#8a9878', belly: '#d8d8c4' },
    paint: function (ub, v) {
      if ((v > 0.24 && v < 0.36) || (v > 0.64 && v < 0.76)) return hexRgb('#3c4a34');
      return null;
    },
    fins: {
      color: '#9aa888', edge: '#5a6a4c',
      dorsal: { h: 0.34, from: 0.28, to: 0.44 },
      tail: { kind: 'round', len: 0.26, spread: 0.26, lift: 0 },
      pectoral: { len: 0.12 }
    }
  },
  {
    id: 'whitecloud', cn: '白云金丝',
    profile: 'fusiform', bodyH: 0.21, bodyW: 0.76, len: 1.0, flatBelly: false,
    sil: { snout: 0.18, pedK: 0.74 },
    pal: { back: '#6a7448', mid: '#b0a878', belly: '#e0ddd0' },
    paint: function (ub, v) {
      if ((v > 0.22 && v < 0.34) || (v > 0.66 && v < 0.78)) return hexRgb('#d8a828');
      return null;
    },
    fins: {
      color: '#d8a828', edge: '#e05038',
      dorsal: { h: 0.30, from: 0.22, to: 0.44 },
      anal: { h: 0.24, from: 0.52, to: 0.66 },
      tail: { kind: 'fork', len: 0.30, spread: 0.30, lift: 0 },
      pectoral: { len: 0.13 }
    }
  },
  {
    id: 'tigerbarb', cn: '虎皮鱼',
    profile: 'fusiform', bodyH: 0.29, bodyW: 0.78, len: 1.0, flatBelly: false,
    sil: { snout: 0.14, hump: 0.12, pedK: 0.66 },
    pal: { back: '#c08818', mid: '#e8c050', belly: '#f8e8b0' },
    paint: function (ub, v) {
      const bands = [0.24, 0.42, 0.60, 0.78];
      for (var i = 0; i < bands.length; i++) {
        var d = Math.abs(ub - bands[i]);
        if (d < 0.045 && v > 0.04 && v < 0.96) return mix(hexRgb('#181818'), hexRgb('#383028'), d / 0.045);
      }
      if (v > 0.42 && v < 0.60 && ub > 0.3) return hexRgb('#e08040');
      return null;
    },
    fins: {
      color: '#e05030', edge: '#c03018',
      dorsal: { h: 0.36, from: 0.24, to: 0.46 },
      anal: { h: 0.26, from: 0.50, to: 0.64 },
      tail: { kind: 'fork', len: 0.32, spread: 0.32, lift: 0 },
      pectoral: { len: 0.13 }
    }
  },
  {
    id: 'denison', cn: '一眉道人',
    profile: 'fusiform', bodyH: 0.20, bodyW: 0.72, len: 1.15, flatBelly: false,
    sil: { snout: 0.34, pedK: 0.80 },
    pal: { back: '#74806c', mid: '#c0c8c4', belly: '#e8ebe8' },
    paint: function (ub, v) {
      if ((v > 0.16 && v < 0.30) && ub < 0.52) return hexRgb('#d83028');
      if ((v > 0.30 && v < 0.355) && ub > 0.10) return hexRgb('#202828');
      if ((v > 0.40 && v < 0.47) && ub > 0.2) return hexRgb('#c8a830');
      return null;
    },
    fins: {
      color: '#c8ccc8', edge: '#2c3438',
      dorsal: { h: 0.30, from: 0.26, to: 0.44 },
      tail: { kind: 'fork', len: 0.38, spread: 0.34, lift: 0 },
      pectoral: { len: 0.14 }
    }
  }
];

/* ================= 贴图 ================= */
function paintTexture(spec, W, H) {
  const img = Buffer.alloc(W * H * 4);
  const back = hexRgb(spec.pal.back), mid = hexRgb(spec.pal.mid), belly = hexRgb(spec.pal.belly);
  const uFin = 0.80;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    const fromBack = Math.min(v, 1 - v) * 2;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const o = (y * W + x) * 4;
      if (u >= uFin) { img[o] = 255; img[o + 1] = 255; img[o + 2] = 255; img[o + 3] = 255; continue; }
      const ub = u / uFin;
      let c = mix(back, mid, clamp01(fromBack * 1.4));
      c = mix(c, belly, clamp01((fromBack - 0.55) * 2.2));
      if (spec.paint) { const p = spec.paint(ub, v, c); if (p) c = p; }
      const sc = Math.sin(ub * 58 + Math.abs(v - 0.5) * 7) * 0.05;
      c = [c[0] * (1 + sc), c[1] * (1 + sc), c[2] * (1 + sc)];
      c = [c[0] * (1 - (1 - fromBack) * 0.22), c[1] * (1 - (1 - fromBack) * 0.14), c[2] * (1 - (1 - fromBack) * 0.10)];
      img[o] = Math.max(0, Math.min(255, c[0] | 0));
      img[o + 1] = Math.max(0, Math.min(255, c[1] | 0));
      img[o + 2] = Math.max(0, Math.min(255, c[2] | 0));
      img[o + 3] = 255;
    }
  }
  function eye(cx, cy) {
    const px = Math.round(cx * W), py = Math.round(cy * H);
    const r = Math.max(2, Math.round(H * 0.055));
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r * r) continue;
      const gx = px + dx, gy = py + dy;
      if (gx < 0 || gx >= W || gy < 0 || gy >= H) continue;
      const o = (gy * W + gx) * 4;
      if (d2 < r * r * 0.5) { img[o] = 14; img[o + 1] = 18; img[o + 2] = 22; }
      else { img[o] = 42; img[o + 1] = 48; img[o + 2] = 54; }
      if (dx < 0 && dy < 0 && d2 < r * r * 0.16) { img[o] = 232; img[o + 1] = 238; img[o + 2] = 244; }
    }
  }
  eye(0.05, 0.21); eye(0.05, 0.79);
  return pngEncode(W, H, img);
}

/* ================= 几何 ================= */
const SECTION = 14, BODYSEG = 26;
const PROFILES = {
  fusiform: [[0, .46], [.1, .84], [.25, .98], [.4, 1], [.55, .95], [.7, .8], [.85, .55], [1, .16]],
  compressiform: [[0, .5], [.1, .88], [.25, 1], [.45, 1], [.6, .92], [.75, .74], [.88, .45], [1, .14]],
  anguilliform: [[0, .55], [.1, .8], [.3, .95], [.5, 1], [.7, .9], [.88, .62], [1, .2]]
};
function envH(tab, u) {
  if (u <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (u <= tab[i][0]) {
      let t = (u - tab[i - 1][0]) / Math.max(1e-5, tab[i][0] - tab[i - 1][0]);
      t = t * t * (3 - 2 * t);
      return tab[i - 1][1] + (tab[i][1] - tab[i - 1][1]) * t;
    }
  }
  return tab[tab.length - 1][1];
}

function buildBody(spec) {
  const prof = PROFILES[spec.profile];
  const hp = spec.bodyH, len = spec.len;
  const sil = spec.sil || {};
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= BODYSEG; i++) {
    const u = i / BODYSEG;
    const x = (0.5 - u) * len;
    let hE = envH(prof, u);
    if (sil.snout && u < .2) hE *= 1 - sil.snout * Math.pow(1 - u / .2, 1.4);
    if (sil.hump) hE *= 1 + sil.hump * Math.exp(-Math.pow((u - .36) / .2, 2));
    if (sil.pedK != null && u > .78) hE *= 1 + (sil.pedK - 1) * ((u - .78) / .22);
    hE = Math.max(.06, Math.min(1.2, hE)) * hp;
    const nBack = Math.max(1.45, 2.3 - Math.exp(-Math.pow((u - .38) / .24, 2)) * .95);
    for (let j = 0; j <= SECTION; j++) {
      const th = (j / SECTION) * Math.PI * 2;
      const cy = Math.cos(th), cz = Math.sin(th);
      const sy = Math.sign(cy) * Math.pow(Math.abs(cy), 2 / (cy >= 0 ? nBack : 2.5));
      const szp = Math.sign(cz) * Math.pow(Math.abs(cz), 2 / 1.9);
      const yy = sy * hE;
      const spine = -Math.sin(Math.pow(u, .9) * Math.PI) * .07 * hp * (spec.flatBelly ? .45 : 1);
      pos.push(x, yy + spine, szp * hE * (spec.bodyW || .8));
      uv.push(u * 0.78, j / SECTION);
    }
  }
  for (let i = 0; i < BODYSEG; i++) for (let j = 0; j < SECTION; j++) {
    const a = i * (SECTION + 1) + j, b = (i + 1) * (SECTION + 1) + j;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { pos, uv, idx };
}

let finPatch = 0.80;
function addFinMesh(parts, rows, colA, colB) {
  const pu0 = finPatch, pw = Math.min(0.155, 0.985 - pu0);
  finPatch += pw + 0.008;
  const pos = [], uv = [], idx = [], col = [];
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < 2; c++) {
    const p = rows[r][c];
    pos.push(p[0], p[1], p[2]);
    uv.push(pu0 + c * pw, r / (rows.length - 1));
    const t = r / (rows.length - 1);
    const cc = mix(colA, colB, t);
    col.push(cc[0] / 255, cc[1] / 255, cc[2] / 255);
  }
  for (let r = 0; r < rows.length - 1; r++) {
    const a = r * 2, b = a + 1, c2 = a + 2, d = a + 3;
    idx.push(a, b, c2, b, d, c2);
  }
  parts.push({ pos, uv, idx, col });
}
function finRows(x0, y0, dx, dy, len, w0, w1, curl, seg, thick) {
  const rows = [];
  const nl = Math.hypot(dx, dy) || 1;
  dx /= nl; dy /= nl;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const cx = x0 + dx * len * t, cy = y0 + dy * len * t + curl * len * t * t;
    const w = w0 + (w1 - w0) * t;
    const nx = -dy, ny = dx;
    rows.push([[cx + nx * w, cy + ny * w, thick], [cx - nx * w, cy - ny * w, -thick]]);
  }
  return rows;
}

function mergeGeo(parts) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  let vo = 0;
  parts.forEach(p => {
    const nv = p.pos.length / 3;
    const nor2 = new Float32Array(p.pos.length);
    for (let i = 0; i < p.idx.length; i += 3) {
      /* 顶点索引与 float 数组偏移必须分开：叉积用偏移，累加用顶点索引。
       * 旧版把已乘过 3 的偏移再乘 3 写进 nor2，索引被放大 9 倍，
       * 越界写入被 Float32Array 静默丢弃，约 2/3 的法线留在 (0,0,0)。
       * WebGL 里 normalize(0) → NaN，漫反射归零，鱼就是全黑的。 */
      const ia = p.idx[i], ib = p.idx[i + 1], ic = p.idx[i + 2];
      const a = ia * 3, b = ib * 3, c = ic * 3;
      const ax = p.pos[b] - p.pos[a], ay = p.pos[b + 1] - p.pos[a + 1], az = p.pos[b + 2] - p.pos[a + 2];
      const bx = p.pos[c] - p.pos[a], by = p.pos[c + 1] - p.pos[a + 1], bz = p.pos[c + 2] - p.pos[a + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      [ia, ib, ic].forEach(v => { nor2[v * 3] += nx / nl; nor2[v * 3 + 1] += ny / nl; nor2[v * 3 + 2] += nz / nl; });
    }
    for (let v = 0; v < nv; v++) {
      let x = nor2[v * 3], y = nor2[v * 3 + 1], z = nor2[v * 3 + 2];
      const l = Math.hypot(x, y, z);
      // 孤立顶点（无三角形引用）不会被光栅化，但也给非零值兜底
      if (l < 1e-8) { x = 0; y = 0; z = 1; } else { x /= l; y /= l; z /= l; }
      nor.push(x, y, z);
      pos.push(p.pos[v * 3], p.pos[v * 3 + 1], p.pos[v * 3 + 2]);
      uv.push(p.uv[v * 2], p.uv[v * 2 + 1]);
      if (p.col) col.push(p.col[v * 3], p.col[v * 3 + 1], p.col[v * 3 + 2]);
      else col.push(1, 1, 1);
    }
    p.idx.forEach(i2 => idx.push(i2 + vo));
    vo += nv;
  });
  return { pos, nor, uv, col, idx };
}

/* ================= 骨骼 / 蒙皮 ================= */
function buildRig(spec) {
  const NB = 8;
  const len = spec.len;
  const joints = [];
  for (let i = 0; i < NB; i++) joints.push([0.40 - len * 0.92 * (i / (NB - 1)), 0, 0]);
  return { joints, nb: NB };
}
function skinWeights(x, rig) {
  const w = [];
  for (let j = 0; j < rig.nb; j++) {
    const d = x - rig.joints[j][0];
    w.push(1 / (d * d + 0.008));
  }
  let i0 = 0, i1 = 1;
  if (w[1] > w[0]) { i0 = 1; i1 = 0; }
  for (let j = 2; j < rig.nb; j++) {
    if (w[j] > w[i0]) { i1 = i0; i0 = j; }
    else if (w[j] > w[i1]) { i1 = j; }
  }
  const s = (w[i0] + w[i1]) || 1;
  const out = new Array(rig.nb).fill(0);
  out[i0] = w[i0] / s; out[i1] = w[i1] / s;
  return { joints: [i0, i1, 0, 0], weights: [out[i0], out[i1], 0, 0] };
}

/* ================= GLB 序列化 ================= */
function pad4(b) { const r = b.length % 4; return r ? Buffer.concat([b, Buffer.alloc(4 - r)]) : b; }
function f32buf(arr) { const b = Buffer.alloc(arr.length * 4); for (let i = 0; i < arr.length; i++) b.writeFloatLE(arr[i], i * 4); return b; }
function u16buf(arr) { const b = Buffer.alloc(arr.length * 2); for (let i = 0; i < arr.length; i++) b.writeUInt16LE(arr[i], i * 2); return b; }
function u32buf(arr) { const b = Buffer.alloc(arr.length * 4); for (let i = 0; i < arr.length; i++) b.writeUInt32LE(arr[i], i * 4); return b; }
function buildGLB(json, bin) {
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  while (jsonBuf.length % 4) jsonBuf = Buffer.concat([jsonBuf, Buffer.from([0x20])]);
  const binBuf = pad4(bin);
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jc = Buffer.alloc(8); jc.writeUInt32LE(jsonBuf.length, 0); jc.write('JSON', 4, 'ascii');
  const bc = Buffer.alloc(8); bc.writeUInt32LE(binBuf.length, 0); bc.write('BIN\x00', 4, 'ascii');
  return Buffer.concat([header, jc, jsonBuf, bc, binBuf]);
}

function assembleGLB(geo, texPng, rig, animBones) {
  const views = [], accs = [], binParts = [];
  let offset = 0;
  function addBuf(buf, target) {
    const b = pad4(buf);
    const vIdx = views.length;
    const view = { buffer: 0, byteOffset: offset, byteLength: buf.length };
    if (target) view.target = target;
    views.push(view);
    binParts.push(b);
    offset += b.length;
    return vIdx;
  }
  function addAcc(buf, compType, type, count, opts) {
    const vIdx = addBuf(buf, opts && opts.target);
    const acc = { bufferView: vIdx, componentType: compType, type: type, count: count };
    if (opts && opts.min) { acc.min = opts.min; acc.max = opts.max; }
    accs.push(acc);
    return accs.length - 1;
  }
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < geo.pos.length; i += 3) {
    mn[0] = Math.min(mn[0], geo.pos[i]); mx[0] = Math.max(mx[0], geo.pos[i]);
    mn[1] = Math.min(mn[1], geo.pos[i + 1]); mx[1] = Math.max(mx[1], geo.pos[i + 1]);
    mn[2] = Math.min(mn[2], geo.pos[i + 2]); mx[2] = Math.max(mx[2], geo.pos[i + 2]);
  }
  const posAcc = addAcc(f32buf(geo.pos), 5126, 'VEC3', geo.pos.length / 3, { target: 34962, min: mn, max: mx });
  const norAcc = addAcc(f32buf(geo.nor), 5126, 'VEC3', geo.nor.length / 3, { target: 34962 });
  const uvAcc = addAcc(f32buf(geo.uv), 5126, 'VEC2', geo.uv.length / 2, { target: 34962 });
  const colAcc = addAcc(f32buf(geo.col), 5126, 'VEC3', geo.col.length / 3, { target: 34962 });
  const jntAcc = addAcc(u16buf(geo.joints), 5123, 'VEC4', geo.joints.length / 4, { target: 34962 });
  const weiAcc = addAcc(f32buf(geo.weights), 5126, 'VEC4', geo.weights.length / 4, { target: 34962 });
  const idxAcc = addAcc(u32buf(geo.idx), 5125, 'SCALAR', geo.idx.length, { target: 34963 });
  const texView = addBuf(texPng);
  const ibm = [];
  rig.joints.forEach(p => ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1));
  const ibmAcc = addAcc(f32buf(ibm), 5126, 'MAT4', rig.nb);
  const samplers = [], channels = [];
  const KEYS = 9;
  const keyTimes = new Float32Array(KEYS);
  for (let k = 0; k < KEYS; k++) keyTimes[k] = k / (KEYS - 1);
  animBones.forEach(bone => {
    const tAcc = addAcc(f32buf(bone.times), 5126, 'SCALAR', bone.times.length);
    const qAcc = addAcc(f32buf(bone.quats), 5126, 'VEC4', bone.quats.length / 4);
    samplers.push({ input: tAcc, output: qAcc, interpolation: 'LINEAR' });
    channels.push({ sampler: samplers.length - 1, target: { node: bone.nodeIdx, path: 'rotation' } });
  });

  const nodes = [{ name: 'FishRoot', children: [] }];
  for (let b = 0; b < rig.nb; b++) {
    const t = b === 0 ? rig.joints[0] : [+(rig.joints[b][0] - rig.joints[b - 1][0]).toFixed(5), 0, 0];
    nodes.push({ name: 'spine_0' + b, translation: t, children: b + 1 < rig.nb ? [b + 2] : [] });
  }
  nodes.push({ name: 'node_0', mesh: 0, skin: 0 });
  nodes[0].children.push(1);
  nodes[0].children.push(1 + rig.nb);

  const gltf = {
    asset: { version: '2.0', generator: 'chengyu-fishgen-1.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes: [{
      name: 'fish',
      primitives: [{
        attributes: { POSITION: posAcc, NORMAL: norAcc, TEXCOORD_0: uvAcc, COLOR_0: colAcc, JOINTS_0: jntAcc, WEIGHTS_0: weiAcc },
        indices: idxAcc, material: 0, mode: 4
      }]
    }],
    skins: [{ joints: rig.joints.map((_, i) => 1 + i), inverseBindMatrices: ibmAcc, skeleton: 1 }],
    materials: [{
      name: 'fish_mat',
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.12, roughnessFactor: 0.55 },
      doubleSided: true
    }],
    textures: [{ sampler: 0, source: 0 }],
    images: [{ bufferView: texView, mimeType: 'image/png' }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    accessors: accs,
    bufferViews: views,
    animations: [{ name: 'Swim', samplers: samplers, channels: channels }],
    buffers: [{ byteLength: offset }]
  };
  return buildGLB(gltf, Buffer.concat(binParts));
}

/* ================= 单条鱼完整构建 ================= */
function swimTimes() { const t = []; for (let k = 0; k < 9; k++) t.push(k / 8); return t; }
function ampFor(b) { return 0.05 + 0.30 * Math.pow((b + 1) / 8, 1.6); }
function swimQuats(b, amp) {
  const q = [];
  for (let k = 0; k < 9; k++) {
    const th = amp * Math.sin(Math.PI * 2 * (k / 8) - 0.55 * b);
    q.push(0, Math.sin(th / 2), 0, Math.cos(th / 2));
  }
  return q;
}

function buildFish(spec) {
  finPatch = 0.80;
  const body = buildBody(spec);
  const rig = buildRig(spec);
  const parts = [{ pos: body.pos, uv: body.uv, idx: body.idx }];
  const len = spec.len, hp = spec.bodyH;
  const F = spec.fins;
  const colA = hexRgb(F.color), colB = hexRgb(F.edge);
  const backY = (u) => envH(PROFILES[spec.profile], u) * hp * 0.9;
  const bellyY = (u) => -envH(PROFILES[spec.profile], u) * hp * 0.55;

  if (F.dorsal) {
    const rows = finRows((0.5 - F.dorsal.from) * len, backY(F.dorsal.from),
      -1, 0, (F.dorsal.to - F.dorsal.from) * len, 0.02, F.dorsal.h, -0.35, 7, 0.012);
    addFinMesh(parts, rows, colA, colB);
  }
  if (F.anal) {
    const rows = finRows((0.5 - F.anal.from) * len, bellyY(F.anal.from),
      -1, 0.15, (F.anal.to - F.anal.from) * len, 0.02, F.anal.h, 0.25, 6, -0.012);
    addFinMesh(parts, rows, colA, colB);
  }
  {
    const tk = F.tail;
    const x0 = -(0.5 * len) + 0.02;
    const rows = finRows(x0, 0, -1, tk.lift, tk.len, hp * 0.10, tk.spread * hp, tk.kind === 'veil' ? -0.55 : 0, 8, 0.014);
    addFinMesh(parts, rows, hexRgb(F.color), hexRgb(F.tailEdge || F.edge));
  }
  [-1, 1].forEach(side => {
    const rows = finRows(0.28 * len, -hp * 0.18, -0.55, side * 0.75, F.pectoral.len, 0.035, 0.012, 0.1, 4, 0.008);
    addFinMesh(parts, rows, hexRgb(F.color), hexRgb(F.edge));
  });

  const geo = mergeGeo(parts);
  geo.joints = []; geo.weights = [];
  for (let vi = 0; vi < geo.pos.length / 3; vi++) {
    const x = geo.pos[vi * 3];
    const wv = skinWeights(x, rig);
    wv.joints.forEach(j => geo.joints.push(j));
    wv.weights.forEach(w => geo.weights.push(w));
  }
  const texPng = paintTexture(spec, 256, 128);
  const animBones = rig.joints.map((p, i) => ({
    nodeIdx: 1 + i,
    times: swimTimes(),
    quats: swimQuats(i, ampFor(i))
  }));
  return assembleGLB(geo, texPng, rig, animBones);
}

/* ================= 第二批：补齐图鉴里仍缺模型的品种 =================
 * 全部走同一套参数化管线（带 spine 骨骼 + Swim 摆尾循环），零生成额度。
 * ub：沿体长 0=头 1=尾；v：绕体周向，0/1=背脊、0.5=腹中线、0.25/0.75=两侧。
 */
SPECIES.push(
  {
    id: 'neon', cn: '红绿灯',
    profile: 'fusiform', bodyH: 0.17, bodyW: 0.74, len: 1.0, flatBelly: false,
    sil: { snout: 0.22, pedK: 0.78 },
    pal: { back: '#123a78', mid: '#5ec8e5', belly: '#eef4f2' },
    paint: function (ub, v) {
      if (ub > .06 && ub < .80 && ((v > .16 && v < .30) || (v > .70 && v < .84))) return hexRgb('#38d8f0');
      if (ub > .48 && ub < .96 && v > .40 && v < .60) return hexRgb('#f04b52');
      return null;
    },
    fins: { color: '#8fc6d8', edge: '#4a90b8', tailEdge: '#c8dee8',
      dorsal: { h: 0.22, from: 0.30, to: 0.46 }, anal: { h: 0.18, from: 0.56, to: 0.70 },
      tail: { kind: 'fork', len: 0.28, spread: 0.28, lift: 0 }, pectoral: { len: 0.10 } }
  },
  {
    id: 'cardinal', cn: '宝莲灯',
    profile: 'fusiform', bodyH: 0.18, bodyW: 0.74, len: 1.0, flatBelly: false,
    sil: { snout: 0.22, pedK: 0.78 },
    pal: { back: '#102a70', mid: '#5aa9ec', belly: '#f2f0e8' },
    paint: function (ub, v) {
      if (ub > .04 && ub < .84 && ((v > .16 && v < .31) || (v > .69 && v < .84))) return hexRgb('#3ab8f8');
      if (ub > .16 && ub < .97 && v > .40 && v < .60) return hexRgb('#ef3b45');
      return null;
    },
    fins: { color: '#a8d4ea', edge: '#4a80b8',
      dorsal: { h: 0.22, from: 0.30, to: 0.46 }, anal: { h: 0.18, from: 0.56, to: 0.70 },
      tail: { kind: 'fork', len: 0.28, spread: 0.28, lift: 0 }, pectoral: { len: 0.10 } }
  },
  {
    id: 'goldfish', cn: '草种金鱼',
    profile: 'fusiform', bodyH: 0.33, bodyW: 0.86, len: 1.0, flatBelly: false,
    sil: { snout: 0.12, hump: 0.10, pedK: 0.70 },
    pal: { back: '#e2681c', mid: '#ffb23f', belly: '#fff0b0' },
    paint: function (ub, v, c) {
      if (Math.sin(ub * 46 + v * 12) > .72) return mix(c, hexRgb('#fff0b0'), .45);
      return null;
    },
    fins: { color: '#ffb23f', edge: '#d86818', tailEdge: '#ffd07a',
      dorsal: { h: 0.40, from: 0.24, to: 0.52 }, anal: { h: 0.26, from: 0.60, to: 0.74 },
      tail: { kind: 'twin', len: 0.40, spread: 0.42, lift: 0 }, pectoral: { len: 0.16 } }
  },
  {
    id: 'gold_black', cn: '黑摩尔',
    profile: 'fusiform', bodyH: 0.36, bodyW: 0.88, len: 1.0, flatBelly: false,
    sil: { snout: 0.10, hump: 0.14, pedK: 0.68 },
    pal: { back: '#111216', mid: '#3b3a3d', belly: '#6c6a72' },
    paint: function (ub, v, c) {
      if (Math.sin(ub * 40 + v * 10) > .80) return mix(c, hexRgb('#6c6a72'), .30);
      return null;
    },
    fins: { color: '#2a2a30', edge: '#15151a', tailEdge: '#55535c',
      dorsal: { h: 0.44, from: 0.24, to: 0.54 }, anal: { h: 0.28, from: 0.58, to: 0.74 },
      tail: { kind: 'veil', len: 0.46, spread: 0.44, lift: 0 }, pectoral: { len: 0.17 } }
  },
  {
    id: 'koi', cn: '锦鲤',
    profile: 'fusiform', bodyH: 0.22, bodyW: 0.80, len: 1.18, flatBelly: false,
    sil: { snout: 0.28, pedK: 0.82 },
    pal: { back: '#d8d2c6', mid: '#fbf6ee', belly: '#ffffff' },
    paint: function (ub, v) {
      if (Math.sin(ub * 10 + v * 6) * Math.cos(ub * 6 - v * 11) > .38 && v > .10 && v < .90) return hexRgb('#e34b32');
      return null;
    },
    fins: { color: '#f3e9dc', edge: '#d8c8b4',
      dorsal: { h: 0.30, from: 0.26, to: 0.52 }, anal: { h: 0.20, from: 0.62, to: 0.74 },
      tail: { kind: 'fork', len: 0.34, spread: 0.34, lift: 0 }, pectoral: { len: 0.15 } }
  },
  {
    id: 'koi_sanke', cn: '锦鲤·大正三色',
    profile: 'fusiform', bodyH: 0.22, bodyW: 0.80, len: 1.18, flatBelly: false,
    sil: { snout: 0.28, pedK: 0.82 },
    pal: { back: '#d0cabd', mid: '#f7f2e8', belly: '#ffffff' },
    paint: function (ub, v) {
      const r = Math.sin(ub * 11 + v * 7) * Math.cos(ub * 6 - v * 12);
      if (r > .34 && v > .10 && v < .90) return hexRgb('#d8452f');
      if (r < -.62 && v > .14 && v < .86) return hexRgb('#1e1f24');
      return null;
    },
    fins: { color: '#ece3d4', edge: '#cdbda8',
      dorsal: { h: 0.30, from: 0.26, to: 0.52 }, anal: { h: 0.20, from: 0.62, to: 0.74 },
      tail: { kind: 'fork', len: 0.34, spread: 0.34, lift: 0 }, pectoral: { len: 0.15 } }
  },
  {
    id: 'discus', cn: '七彩神仙',
    profile: 'compressiform', bodyH: 0.46, bodyW: 0.78, len: 1.0, flatBelly: false,
    sil: { snout: 0.10, hump: 0.08, pedK: 0.62 },
    pal: { back: '#2d5a64', mid: '#7fb5a6', belly: '#d9793f' },
    paint: function (ub, v) {
      if (Math.sin(ub * 52) > .58 && v > .08 && v < .92) return hexRgb('#2d5a64');
      if ((v > .18 && v < .25) || (v > .75 && v < .82)) return hexRgb('#d9793f');
      return null;
    },
    fins: { color: '#79a99c', edge: '#3e6f6a',
      dorsal: { h: 0.30, from: 0.10, to: 0.72 }, anal: { h: 0.30, from: 0.38, to: 0.80 },
      tail: { kind: 'round', len: 0.20, spread: 0.30, lift: 0 }, pectoral: { len: 0.12 } }
  },
  {
    id: 'guppy_red', cn: '孔雀鱼·红礼服',
    profile: 'fusiform', bodyH: 0.24, bodyW: 0.72, len: 1.0, flatBelly: false,
    sil: { snout: 0.20, pedK: 0.74 },
    pal: { back: '#9b2530', mid: '#e8ddd0', belly: '#f4ece2' },
    paint: function (ub, v, c) {
      if (ub > .40) return mix(c, hexRgb('#9b2530'), Math.min(1, (ub - .40) / .30));
      if (Math.sin(ub * 32 + v * 18) > .80) return hexRgb('#f04a3c');
      return null;
    },
    fins: { color: '#d3323f', edge: '#8e1c28', tailEdge: '#f46a58',
      dorsal: { h: 0.34, from: 0.28, to: 0.52 }, anal: { h: 0.22, from: 0.54, to: 0.70 },
      tail: { kind: 'fan', len: 0.44, spread: 0.46, lift: 0 }, pectoral: { len: 0.12 } }
  },
  {
    id: 'guppy_blue', cn: '孔雀鱼·蓝草尾',
    profile: 'fusiform', bodyH: 0.23, bodyW: 0.72, len: 1.0, flatBelly: false,
    sil: { snout: 0.20, pedK: 0.74 },
    pal: { back: '#1b3f9c', mid: '#8fd4e8', belly: '#e8f2f4' },
    paint: function (ub, v) {
      if (Math.sin(ub * 44 + v * 26) * Math.cos(ub * 18 - v * 9) > .42) return hexRgb('#143b7a');
      return null;
    },
    fins: { color: '#4b78d8', edge: '#1b3f9c', tailEdge: '#7fc0e8',
      dorsal: { h: 0.34, from: 0.28, to: 0.52 }, anal: { h: 0.22, from: 0.54, to: 0.70 },
      tail: { kind: 'fan', len: 0.48, spread: 0.48, lift: 0 }, pectoral: { len: 0.12 } }
  },
  {
    id: 'swordtail', cn: '红箭鱼',
    profile: 'fusiform', bodyH: 0.22, bodyW: 0.72, len: 1.05, flatBelly: false,
    sil: { snout: 0.22, pedK: 0.80 },
    pal: { back: '#8f2c26', mid: '#ef6a4c', belly: '#ffd27a' },
    paint: function (ub, v) {
      if ((v > .34 && v < .40) || (v > .60 && v < .66)) return hexRgb('#8f2c26');
      if (ub > .55 && v > .10 && v < .22) return hexRgb('#ffd27a');
      return null;
    },
    fins: { color: '#e86a4a', edge: '#a83a24', tailEdge: '#ffd27a',
      dorsal: { h: 0.28, from: 0.26, to: 0.50 }, anal: { h: 0.20, from: 0.56, to: 0.70 },
      tail: { kind: 'sword', len: 0.60, spread: 0.16, lift: -0.06 }, pectoral: { len: 0.12 } }
  },
  {
    id: 'clownloach', cn: '三间鼠',
    profile: 'anguilliform', bodyH: 0.24, bodyW: 0.80, len: 1.08, flatBelly: true,
    sil: { snout: 0.30, pedK: 0.84 },
    pal: { back: '#c9872c', mid: '#e8a33d', belly: '#f8e6b8' },
    paint: function (ub, v) {
      const bands = [0.20, 0.47, 0.75];
      for (let i = 0; i < bands.length; i++) {
        const d = Math.abs(ub - bands[i]);
        if (d < .055 && v > .06 && v < .94) return mix(hexRgb('#232323'), hexRgb('#e8a33d'), d / .055);
      }
      if ((v > .16 && v < .30) || (v > .70 && v < .84)) return hexRgb('#e0452a');
      return null;
    },
    fins: { color: '#d95f2b', edge: '#a03a18',
      dorsal: { h: 0.28, from: 0.30, to: 0.48 }, anal: { h: 0.22, from: 0.60, to: 0.72 },
      tail: { kind: 'fork', len: 0.32, spread: 0.30, lift: 0 }, pectoral: { len: 0.13 } }
  },
  {
    id: 'pearlgourami', cn: '珍珠马甲',
    profile: 'compressiform', bodyH: 0.34, bodyW: 0.72, len: 1.0, flatBelly: false,
    sil: { snout: 0.16, pedK: 0.70 },
    pal: { back: '#5a6b4a', mid: '#c9b98f', belly: '#f0e6c8' },
    paint: function (ub, v) {
      if (Math.sin(ub * 68) * Math.cos(v * 58) > .55 && ub > .08 && ub < .92) return hexRgb('#f0e6c8');
      if ((v > .46 && v < .50) || (v > .50 && v < .54)) return hexRgb('#3d4a38');
      if (ub > .60 && v > .30 && v < .70) return mix(hexRgb('#c9b98f'), hexRgb('#c96a3f'), .55);
      return null;
    },
    fins: { color: '#d8c9a2', edge: '#9a8c68',
      dorsal: { h: 0.28, from: 0.40, to: 0.70 }, anal: { h: 0.40, from: 0.30, to: 0.84 },
      tail: { kind: 'fork', len: 0.26, spread: 0.28, lift: 0 }, pectoral: { len: 0.24 } }
  }
);

/* ================= 主流程 ================= */
const outDir = path.join(__dirname, '..', 'models');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
/* 这两个品种后来换成了 AI 写实模型（约 2.2MB），重跑本生成器不能覆盖它们。
 * 需要重新产出参数化版本时传 --all。 */
const AI_REPLACED = new Set([
  'neon', 'goldfish', 'discus', 'betta', 'cardinal', 'koi', 'clownloach',
  'otocinclus', 'whitecloud', 'tigerbarb', 'swordtail', 'denison'
]);
const forceAll = process.argv.indexOf('--all') >= 0;
SPECIES.forEach(spec => {
  if (!forceAll && AI_REPLACED.has(spec.id)) { console.log(spec.cn + ' → 跳过（已写实化，传 --all 可强制生成）'); return; }
  const glb = buildFish(spec);
  const out = path.join(outDir, spec.id + '_rigged.glb');
  fs.writeFileSync(out, glb);
  console.log(spec.cn + ' (' + spec.id + '_rigged.glb) → ' + (glb.length / 1024).toFixed(0) + ' KB');
});
console.log('完成：' + SPECIES.length + ' 条鱼');
