/* 资源一致性门禁：模型文件 / 内嵌包清单 / 静态图标 / 造景模板 / 水草轴向 /
 * 顶点法线 / 拼音检索 / 造景实例。
 * 用法: node tools/verify_assets.js
 * 不依赖浏览器，可在每次批量接入模型后直接跑。
 * 【7】【8】以子进程调用独立门禁，避免脚本各自覆盖 global.window / localStorage。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = (...a) => path.join(ROOT, ...a);
global.window = global;
global.location = { search: '', protocol: 'http:' };
require(P('js', 'species.js'));
require(P('js', 'sim.js'));
const D = global.AW_DATA, SIM = global.AW_SIM;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  \u2713 ' : '  \u2717 ') + msg); if (!cond) fail++; };

console.log('\u30101\u3011模型文件 / 内嵌包 / 图标 三者一致性');
const manifest = JSON.parse(fs.readFileSync(P('js', 'models.js'), 'utf8')
  .match(/AW_MODEL_FILES\s*=\s*(\[[\s\S]*?\])/)[1]);
const ROCK_GLB = ['rock_pebble.glb', 'rock_lava.glb', 'rock_slate.glb'];
const used = new Set(D.creatures.filter(s => s.model).map(s => s.model.file));
ROCK_GLB.forEach(f => used.add(f));
const missing = [], noPack = [], noThumb = [];
for (const f of used) {
  if (!fs.existsSync(P('models', f))) missing.push(f);
  if (!manifest.includes(f)) noPack.push(f);
  if (!fs.existsSync(P('models', 'thumbs', f + '.png'))) noThumb.push(f);
}
ok(missing.length === 0, '实际使用的 ' + used.size + ' 个模型，缺文件: ' + (missing.join(',') || '无'));
ok(noPack.length === 0, '内嵌清单缺失: ' + (noPack.join(',') || '无'));
ok(noThumb.length === 0, '静态图标缺失: ' + (noThumb.join(',') || '无'));
ok(manifest.length >= used.size, '内嵌包共 ' + manifest.length + ' 个模型（允许有未引用的历史资产）');

console.log('\u30102\u3011基础品种模型覆盖');
const base = D.creatures.filter(s => !s.variantOf);
ok(base.every(s => !!s.model), base.length + ' 个基础品种全部有 3D 模型');
const badAxis = base.filter(s => s.model && s.model.axis &&
  ['y', 'z', 'x'].indexOf(s.model.axis) < 0);
ok(badAxis.length === 0, 'model.axis 取值合法' + (badAxis.length ? '（异常: ' + badAxis.map(s => s.id) + '）' : ''));

console.log('\u30103\u3011造景模板');
const s = SIM.create();
for (const sc of SIM.scapes.concat([{ id: 'random', name: '随机' }])) {
  const r = SIM.applyScape(s, sc.id);
  const a = s.aqua;
  const good = r.ok && ['flat', 'riseL', 'riseR', 'mound', 'valley'].indexOf(a.slope) >= 0
    && a.rockPos.length === a.rock.count && a.rock.count >= 2 && a.rock.count <= 7
    && a.rockPos.every(p => p[0] >= .05 && p[0] <= .95 && p[1] >= .10 && p[1] <= .90 && p[2] > 0);
  ok(good, sc.name + ' \u2192 slope=' + a.slope + ' 石头 ' + a.rock.count + ' 块（含单块缩放）');
}
const prevScale = s.aqua.rockPos[0][2];
SIM.setRockPos(s, 0, .33, .44);
ok(s.aqua.rockPos[0][0] === .33 && s.aqua.rockPos[0][2] === prevScale,
  '拖拽石头只改坐标、保留单块缩放 ' + prevScale);

console.log('\u30104\u3011水草轴向与扁草缩放');
/* 只读 accessor 的 min/max 会漏掉 scene 根节点的 rotation：AI 产物常自带
 * 绕 X +90° 的 root 旋转，加载后已经是 Y-up，逐轴尺寸与局部坐标不同。
 * 金鱼藻「躺平」正是这么漏过去的（本地读 z 最长 → 判 axis=z 合理，运行时却多转一次）。 */
function glbPlantInfo(file) {
  const d = fs.readFileSync(P('models', file));
  const jl = d.readUInt32LE(12);
  const g = JSON.parse(d.slice(20, 20 + jl).toString());
  const a = g.accessors[g.meshes[0].primitives[0].attributes.POSITION];
  if (!a.min || !a.max) return null;
  const mn = a.min.slice(), mx = a.max.slice();
  const rootIdx = (g.scenes && g.scenes[0] && g.scenes[0].nodes && g.scenes[0].nodes[0]) || 0;
  const rq = (g.nodes && g.nodes[rootIdx] && g.nodes[rootIdx].rotation) || [0, 0, 0, 1];
  const [qx, qy, qz, qw] = rq;
  const m = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw),
    2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw),
    2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)
  ];
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < 8; i++) {
    const p = [i & 1 ? mx[0] : mn[0], i & 2 ? mx[1] : mn[1], i & 4 ? mx[2] : mn[2]];
    for (let r = 0; r < 3; r++) {
      const v = m[r * 3] * p[0] + m[r * 3 + 1] * p[1] + m[r * 3 + 2] * p[2];
      lo[r] = Math.min(lo[r], v); hi[r] = Math.max(hi[r], v);
    }
  }
  return { size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], rotated: !!(m[4] !== 1 || m[0] !== 1) };
}

const plants = D.creatures.filter(s => !s.variantOf && s.kind === 'plant' && s.model);
for (const sp of plants) {
  const info = glbPlantInfo(sp.model.file);
  if (!info) { ok(false, sp.id + ' 缺少 POSITION min/max'); continue; }
  const size = info.size;
  const auto = size[2] > size[1] * 1.10 && size[2] >= size[0] ? 'z'
    : size[0] > size[1] * 1.10 && size[0] > size[2] ? 'x' : 'y';
  const flat = !!(sp.floating || sp.shape === 'float');
  /* 门禁按「声明的 axis」强制扶正来算，而不是复刻 render.js 的运行时校验：
   * 声明写错时这里就必须算出躺倒并报错，否则门禁永远绿、抓不到配置退化。 */
  const axis = flat ? 'y' : (sp.model.axis || auto);
  /* 扶正后的世界三轴：z→绕X转(y,z 互换)；x→绕Z转(x,y 互换) */
  const after = axis === 'z' ? [size[0], size[2], size[1]]
    : axis === 'x' ? [size[1], size[0], size[2]] : size.slice();
  const ref = flat ? Math.max(after[0], after[2]) : after[1];
  const k = 0.7 / Math.max(ref, .001);     // full 的下限是 .7，用它估最坏放大倍数
  const sane = ref > .05 && ref < 3 && k > .1 && k < 30;
  /* 朝向：细长草必须立着；浮萍/苔垫/草毯本来就贴地或贴水面，不检查 */
  const flatLike = flat || sp.shape === 'moss' || sp.shape === 'carpet';
  const elong = Math.max(after[0], after[1], after[2]) / Math.max(Math.min(after[0], after[1], after[2]), 1e-6);
  const upright = flatLike || elong < 1.6 || after[1] >= Math.max(after[0], after[2]) * 0.85;
  const shape = flatLike ? '贴地型' : elong < 1.6 ? '矮宽型'
    : after[1] >= Math.max(after[0], after[2]) ? '立着' : '躺倒!';
  ok(sane && upright,
    sp.id.padEnd(10) + ' 声明=' + (sp.model.axis || 'auto').padEnd(4) + ' 实际=' + axis.padEnd(2)
    + ' 世界 ' + after.map(v => v.toFixed(3)).join('/')
    + ' ' + shape
    + ' 最坏放大≈' + k.toFixed(2) + '\u00d7'
    + (info.rotated ? ' [root旋转已计入]' : ''));
}

console.log('\u30105\u3011自定义缸体尺寸与真实比例');
const lim = D.tankLimits;
ok(lim && lim.l[0] === 30 && lim.l[1] === 200, '长度范围 30–200cm');
ok(lim.w[0] === 20 && lim.w[1] === 80 && lim.h[0] === 20 && lim.h[1] === 80,
  '宽高范围 20–80cm');

/* 统一尺度：任意长宽高的缸，5cm 鱼占缸宽的比例都必须恒等于 5/长 */
const samples = [[30, 20, 20], [45, 25, 30], [90, 30, 37], [150, 60, 60], [200, 80, 80]];
let ratioBad = 0;
for (const [l, w, h] of samples) {
  const t = D.tankFromCm(l, w, h);
  const ratio = 5 * (t.w / t.cm) / t.w * 100;
  const want = 5 / l * 100;
  if (Math.abs(ratio - want) > 1e-6) ratioBad++;
  ok(Math.abs(ratio - want) <= 1e-6,
    (l + '×' + w + '×' + h).padEnd(12) + ' PXCM=' + (t.w / t.cm).toFixed(3)
    + '  5cm 鱼占缸宽 ' + ratio.toFixed(1) + '%  cap=' + t.cap);
}
ok(ratioBad === 0, '所有尺寸下鱼占缸宽的比例都守恒');

/* 越界夹取 */
const lo = D.tankFromCm(1, 1, 1), hi = D.tankFromCm(999, 999, 999);
ok(lo.cm === 30 && lo.cmw === 20 && lo.cmh === 20, '低于下限被夹到 30×20×20cm');
ok(hi.cm === 200 && hi.cmw === 80 && hi.cmh === 80, '高于上限被夹到 200×80×80cm');

/* 容量随体积增长但不线性爆炸 */
const c30 = D.tankFromCm(30, 20, 20).cap, c90 = D.tankFromCm(90, 30, 37).cap, c200 = D.tankFromCm(200, 80, 80).cap;
ok(c30 < c90 && c90 < c200, '容量随缸体增大：' + c30 + ' < ' + c90 + ' < ' + c200);
ok(c200 <= 5.0, '容量有上限，不会随体积线性爆炸（200cm 缸 cap=' + c200 + '）');

/* 默认开局与存档迁移 */
const fresh = SIM.create();
ok(fresh.tankDims && fresh.tankDims.l === 90 && fresh.tankDims.w === 30 && fresh.tankDims.h === 37,
  '默认开局为 90×30×37cm');
const legacy = SIM.create();
delete legacy.tankDims;
legacy.tankSize = 'large';
legacy.tankMig = 2;
const migrated = SIM.load(JSON.stringify(legacy));
ok(!!migrated && !!migrated.tankDims && migrated.tankDims.l === 60,
  '旧存档 tankSize 迁移成 tankDims（large → ' + (migrated && migrated.tankDims && migrated.tankDims.l) + 'cm）');

const sCustom = SIM.create();
sCustom.tankDims = { l: 123, w: 45, h: 55 };
sCustom.tankMig = 3;
const custom = SIM.load(JSON.stringify(sCustom));
ok(!!custom && custom.tankDims.l === 123 && custom.tankDims.w === 45, '自定义尺寸随存档保存并回读');

const sBroken = SIM.create();
sBroken.tankDims = { l: 9999, w: -5, h: null };
sBroken.tankMig = 3;
const broken = SIM.load(JSON.stringify(sBroken));
ok(!!broken && broken.tankDims.l === 200 && broken.tankDims.w === 20 && broken.tankDims.h === 37,
  '越界 / 非数字尺寸被夹回合法值');

const renderSrc = fs.readFileSync(P('js', 'render.js'), 'utf8');
ok(/PXCM\s*=\s*\(t\.cm\s*\?/.test(renderSrc), '渲染层 PXCM 按缸宽/标称cm 动态计算');
ok(/D\.tank\(s \|\| \{ l: 90/.test(renderSrc), '渲染层 applyDims 走自定义尺寸（D.tank(state)）');
ok(!/PXCM\s*=\s*0\.42/.test(renderSrc), '渲染层不再写死 0.42');
const appSrc = fs.readFileSync(P('js', 'app.js'), 'utf8');
ok(/SIM\.setTankDims\(state/.test(appSrc), 'UI 通过 setTankDims 应用三个滑块');
ok(!/Math\.round\((?:c\.h|sp\.maxH)\s*\*\s*45\)/.test(appSrc), 'UI 株高换算不再硬编码 45cm');

console.log('\u30106\u3011顶点法线健康度（零法线会让 WebGL 模型全黑）');
function zeroNormalsOf(file) {
  const d = fs.readFileSync(P('models', file));
  const jl = d.readUInt32LE(12);
  const g = JSON.parse(d.slice(20, 20 + jl).toString());
  const base = 28 + jl;
  let bad = 0;
  for (const m of (g.meshes || [])) for (const pr of (m.primitives || [])) {
    const ai = pr.attributes && pr.attributes.NORMAL;
    if (ai == null) continue;
    const a = g.accessors[ai], bv = g.bufferViews[a.bufferView];
    const off = base + (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || 12;
    for (let i = 0; i < a.count; i++) {
      const p = off + i * stride;
      const x = d.readFloatLE(p), y = d.readFloatLE(p + 4), z = d.readFloatLE(p + 8);
      if (Math.sqrt(x * x + y * y + z * z) < 0.01) bad++;
    }
  }
  return bad;
}
const glbs = fs.readdirSync(P('models')).filter(f => f.endsWith('.glb'));
const badNormals = [];
for (const f of glbs) { const n = zeroNormalsOf(f); if (n) badNormals.push(f + ':' + n); }
ok(badNormals.length === 0, glbs.length + ' 个 GLB 无零法线'
  + (badNormals.length ? '（异常: ' + badNormals.join(', ') + '）' : ''));

/* 【7】【8】子进程跑独立门禁：它们会自己设置 global.window 与 localStorage，
 * 同进程 require 会污染本文件的数据源，而且子脚本自带 process.exit。 */
function gate(file, title) {
  let code = 0, out = '';
  try {
    out = require('child_process').execFileSync(process.execPath, [P('tools', file)],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    code = e.status == null ? 1 : e.status;
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  const lines = out.trim().split('\n');
  const bad = lines.filter(l => l.indexOf('\u2717') >= 0).map(l => l.trim());
  const last = lines.length ? lines[lines.length - 1].trim() : '(无输出)';
  ok(code === 0 && bad.length === 0, title + '：' + last +
    (bad.length ? ' → ' + bad.join(' / ') : ''));
}
console.log('\u30107\u3011中文 / 英文 / 拼音检索');
gate('verify_pinyin.js', '拼音门禁');
console.log('\u30108\u3011造景实例随机尺寸 / 缸内边界 / 存档兼容');
gate('verify_decor.js', '造景门禁');
console.log('\u30109\u3011螺虾层位字段与贴底行为');
gate('verify_inverts.js', '螺虾门禁');

console.log('\u301010\u3011生物头数上限（水草不占名额、上限随缸体增长）');
{
  /* 曾经写死 s.creatures.length >= 48：而 creatures 里含全部水草，
   * 缸里种一片草就把名额吃光，表现就是「明明是大缸却提示太挤」。 */
  /* 清空初始生物，否则 animals 里会混进 create() 自带的那批，断言算不准 */
  const mk = (l, w, h) => {
    const s = SIM.create();
    s.tankDims = { l, w, h }; s.tankMig = 3; s.coins = 999999; s.creatures = [];
    return s;
  };
  const fill = s => { for (let i = 0; i < 40; i++) if (!SIM.addCreature(s, 'anubias').ok) break; };
  const heads = l => {
    const s = mk(l, 30, 37);
    fill(s);
    const plants = s.creatures.filter(c => D.get(c.specId).kind === 'plant').length;
    let n = 0;
    for (let i = 0; i < 200; i++) { if (SIM.addCreature(s, 'neon').ok) n++; else break; }
    return { plants, fish: n, animals: s.creatures.length - plants, msg: '' };
  };
  const a = heads(90), b = heads(136), c = heads(200);
  ok(a.plants > 20, '水草能大量种入（' + a.plants + ' 株未被头数上限挡住）');
  ok(a.animals === a.fish, '水草不计入活体名额（活体 ' + a.animals + ' = 鱼 ' + a.fish + '）');
  ok(a.fish < b.fish && b.fish < c.fish,
    '活体上限随缸体增大：90cm→' + a.fish + '  136cm→' + b.fish + '  200cm→' + c.fish);

  /* 大型鱼：大缸应放行，小缸应拦住，且拦下时提示要说得清 */
  const small = mk(45, 25, 30);
  const rSmall = SIM.addCreature(small, 'koi');
  const big = mk(136, 28, 37);
  const rBig = SIM.addCreature(big, 'koi');
  ok(rBig.ok, '136cm 缸能买大型鱼（锦鲤）');
  ok(!rSmall.ok, '45cm 缸会拦住大型鱼（' + (rSmall.msg || '') + '）');
}

console.log(fail ? '\n\u274c 失败 ' + fail + ' 项' : '\n\u2705 全部通过');
process.exit(fail ? 1 : 0);
