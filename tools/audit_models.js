/* 资产写实度盘点：把 species.js 的品种和实际 GLB 的面数/贴图对齐，
 * 区分「AI 写实模型 / 程序化精修 / 程序化低模」三档。
 *
 * 用法: node tools/audit_models.js [--verbose]
 *
 * 判定口径（写死在这里，避免每次凭感觉）：
 *   AI 写实   ：三角面 >= 30000 且贴图 >= 2 —— 混元那批原始 45000，小丑鱼 12 万、神仙鱼 9 万
 *   程序化精修：>= 10000 面，即 Blender 手写脚本产出的高密度模型（当前只有红礼服）
 *   程序化低模：其余，gen-fish-models.js 那种 786 面的参数化鱼、以及几百面的水草
 *
 * 为什么是 30000 而不是 40000：`trim_decor_base.py` 删掉 AI 摆件的砂质底座后，
 * 头发草 45000→34492、莫斯 45000→30888，用 40000 会把它们从写实档踹进精修档。
 * 而红礼服（Blender 程序化，21056 面）在 30000 下仍被挡在外面，两边都不会错。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = (...a) => path.join(ROOT, ...a);
global.window = global;
global.location = { search: '', protocol: 'http:' };
require(P('js', 'species.js'));
const D = global.AW_DATA;

const AI_MIN_TRIS = 30000;
const FINE_MIN_TRIS = 10000;

function glbInfo(rel) {
  const p = P('models', rel);
  if (!fs.existsSync(p)) return { missing: true };
  const d = fs.readFileSync(p);
  const jl = d.readUInt32LE(12);
  const g = JSON.parse(d.slice(20, 20 + jl).toString());
  let tris = 0;
  for (const m of (g.meshes || [])) {
    for (const pr of (m.primitives || [])) {
      if (pr.indices != null) tris += g.accessors[pr.indices].count / 3;
    }
  }
  const nv = g.meshes && g.meshes[0]
    ? g.accessors[g.meshes[0].primitives[0].attributes.POSITION].count : 0;
  return {
    tris: Math.round(tris), verts: nv,
    tex: (g.images || []).length,
    ext: Object.keys((g.materials && g.materials[0] && g.materials[0].extensions) || {}),
    mb: d.length / 1048576
  };
}

function tierOf(info) {
  if (info.missing) return 'low';
  /* 高面数 + 至少 PBR 基础色/法线两张贴图，才算「AI 写实」。
   * 只堆面数不贴图的程序化件不该被算成写实。 */
  if (info.tris >= AI_MIN_TRIS && info.tex >= 2) return 'ai';
  if (info.tris >= FINE_MIN_TRIS) return 'fine';
  return 'low';
}

const empty = () => ({ ai: [], fine: [], low: [] });
const groups = { fish: empty(), plant: empty(), invert: empty() };

D.creatures.forEach(sp => {
  const g = groups[sp.kind];
  if (!g) return;
  if (!sp.model || !sp.model.file) {
    g.low.push({ sp, info: { missing: true, tris: 0, verts: 0, tex: 0, mb: 0, ext: [] } });
    return;
  }
  const info = glbInfo(sp.model.file);
  g[tierOf(info)].push({ sp, info });
});

const KIND_NAME = { fish: '鱼', plant: '水草', invert: '螺虾' };
const TIER_NAME = { ai: 'AI 写实', fine: '程序化精修', low: '程序化低模' };
const verbose = process.argv.includes('--verbose');

/* 按「模型文件」去重，因为变体是共用同一个 GLB、只靠 shader 染色 */
function byFile(rows) {
  const m = new Map();
  rows.forEach(r => {
    const f = (r.sp.model && r.sp.model.file) || ('(无模型) ' + r.sp.id);
    if (!m.has(f)) m.set(f, { file: f, info: r.info, ids: [] });
    m.get(f).ids.push(r.sp.name);
  });
  return [...m.values()].sort((a, b) => b.ids.length - a.ids.length || a.info.tris - b.info.tris);
}

let totals = { ai: 0, fine: 0, low: 0 };
const lowFiles = [];

for (const k of ['fish', 'plant', 'invert']) {
  const g = groups[k];
  totals.ai += g.ai.length; totals.fine += g.fine.length; totals.low += g.low.length;
  console.log('\n===== ' + KIND_NAME[k] + ' =====');
  console.log('  ' + TIER_NAME.ai + ' ' + g.ai.length + ' 个品种 · '
    + TIER_NAME.fine + ' ' + g.fine.length + ' · '
    + TIER_NAME.low + ' ' + g.low.length);
  if (verbose) {
    ['ai', 'fine', 'low'].forEach(t => {
      if (!g[t].length) return;
      console.log('  [' + TIER_NAME[t] + ']');
      byFile(g[t]).forEach(f => {
        console.log('    ' + String(f.info.tris).padStart(6) + ' 面  ' + f.info.tex + ' 图  '
          + String(f.info.mb).padStart(5) + 'MB  ' + f.file);
        console.log('      → ' + f.ids.join('、'));
      });
    });
  }
  if (g.low.length) lowFiles.push(...byFile(g.low).map(f => ({ kind: k, ...f })));
}

console.log('\n===== 汇总（按品种） =====');
console.log('  ' + TIER_NAME.ai + '   : ' + totals.ai);
console.log('  ' + TIER_NAME.fine + ' : ' + totals.fine);
console.log('  ' + TIER_NAME.low + '   : ' + totals.low);
console.log('  非写实合计 : ' + (totals.fine + totals.low));

console.log('\n===== 待升级的低模文件（按影响品种数排序） =====');
lowFiles.sort((a, b) => b.ids.length - a.ids.length || a.info.tris - b.info.tris)
  .forEach(f => {
    console.log('  ' + KIND_NAME[f.kind] + ' ' + f.file.padEnd(24)
      + String(f.info.tris).padStart(5) + ' 面  ' + f.info.tex + ' 图  '
      + '影响 ' + f.ids.length + ' 个：' + f.ids.join('、'));
  });

