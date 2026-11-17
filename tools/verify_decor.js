/* 造景实例门禁：随机尺寸/形状、缸体内余量、数量上限、拖拽边界、旧存档兼容。
 * 由 verify_assets.js 第【8】节调用，也可单独 node tools/verify_decor.js。 */
const path = require('path');

/* load() 会读 localStorage，Node 里给一个内存版 */
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
global.window = {};
require(path.resolve('js/species.js'));
require(path.resolve('js/sim.js'));
const D = window.AW_DATA, SIM = window.AW_SIM;

let failed = 0;
function ok(cond, label) {
  console.log('  ' + (cond ? '\u2713 ' : '\u2717 ') + label);
  if (!cond) failed++;
}
const finite = v => typeof v === 'number' && isFinite(v);

const s0 = SIM.create();
ok(!!s0.decorItems && Array.isArray(s0.decorItems.wood) && Array.isArray(s0.decorItems.rock),
  '新存档带空的造景实例表');

/* 四档缸各买若干件，逐件检查字段与「不越界」的几何余量。
 * 缸尺寸改成自定义长宽高之后，这里必须直接写 tankDims——
 * 只设 tankSize 的话 D.tank(state) 会优先读 create() 自带的默认 tankDims。 */
const sizes = [
  { name: '30cm', dims: { l: 30, w: 20, h: 20 } },
  { name: '45cm', dims: { l: 45, w: 25, h: 30 } },
  { name: '60cm', dims: { l: 60, w: 30, h: 32 } },
  { name: '90cm', dims: { l: 90, w: 30, h: 37 } }
];
let badField = 0, badBound = 0, badCm = 0;
sizes.forEach(c => {
  const s = SIM.create();
  s.tankDims = c.dims;
  s.tankMig = 3;
  s.coins = 999999;
  const t = D.tank(s);
  const cm = [];
  ['driftwood', 'rocks'].forEach(id => {
    const kind = id === 'driftwood' ? 'wood' : 'rock';
    for (let i = 0; i < 6; i++) {
      const r = SIM.addDecor(s, id);
      if (!r.ok || !r.rebuild) { badField++; continue; }
      const it = SIM.decorList(s, kind).slice(-1)[0];
      if (!finite(it.x) || it.x < .06 || it.x > .94 ||
          !finite(it.z) || it.z < .10 || it.z > .90 ||
          !finite(it.s) || it.s < .5 || it.s > 1.4 ||
          !finite(it.seed) || !finite(it.cm) || it.cm <= 0 ||
          (kind === 'wood' && !(it.shape >= 0 && it.shape <= 3)) ||
          (kind === 'rock' && ['pebble', 'angular', 'slate'].indexOf(it.shape) < 0)) {
        badField++;
      }
      /* 渲染层的实际尺寸，必须留出水面/缸壁余量 */
      const woodH = t.h * .26 * it.s;
      const rockR = Math.min(t.w, t.d) * .06 * it.s;
      const edgeX = Math.min(it.x, 1 - it.x) * t.w;
      const edgeZ = Math.min(it.z, 1 - it.z) * t.d * .62;
      if (woodH >= t.h * .5 || rockR >= edgeX || rockR >= edgeZ) badBound++;
      /* cm 展示值必须真的是「渲染层尺寸 × 随机系数 × 缸的真实厘米换算」，
       * 否则商店里显示的尺寸会和缸里看到的大小脱节。允许 0.06cm 的四舍五入误差。 */
      const baseCm = (kind === 'wood' ? t.h * .26 : t.d * .12) * it.s * (t.cm / t.w);
      if (Math.abs(it.cm - baseCm) > .06) badCm++;
      cm.push(it.cm);
    }
  });
  ok(badField === 0 && badBound === 0 && badCm === 0,
    t.cm + 'cm 缸 12 件造景字段合法且不越界' +
    (badField || badBound || badCm ? '（字段' + badField + '/越界' + badBound + '/尺寸' + badCm + '）' : ''));
  badField = badBound = badCm = 0;
});

/* 随机系数 s∈[.62,1.28] 的波动（最大 2.06 倍）远大于相邻缸的 1.19~1.37 倍尺寸差，
 * 用随机样本直接比大小会偶发倒挂。这里临时固定随机源，只验证「缸尺寸」这一条因果；
 * 随机性本身由下面两项专门负责。 */
{
  const base = {};
  sizes.forEach(c => {
    const s = SIM.create();
    s.tankDims = c.dims; s.tankMig = 3; s.coins = 999999;
    const real = Math.random;
    let r;
    try { Math.random = () => .5; r = SIM.addDecor(s, 'driftwood'); }
    finally { Math.random = real; }
    base[c.name] = r.ok ? SIM.decorList(s, 'wood')[0].cm : NaN;
  });
  const vals = sizes.map(c => base[c.name]);
  ok(vals.every(finite) && vals.every((v, i) => i === 0 || v > vals[i - 1]),
    '同一随机系数下件尺寸随缸增大：' + sizes.map((c, i) => c.dims.l + 'cm→' + vals[i] + 'cm').join('  '));
}

/* 随机性：同一缸连续 8 件不能全是一个尺寸/形状 */
{
  const s = SIM.create(); s.coins = 999999;
  for (let i = 0; i < 8; i++) SIM.addDecor(s, 'driftwood');
  const ws = SIM.decorList(s, 'wood');
  const uniqS = new Set(ws.map(i => i.s.toFixed(3))).size;
  const uniqShape = new Set(ws.map(i => i.shape)).size;
  ok(uniqS >= 6, '连续 8 根沉木尺寸各不相同（' + uniqS + ' 种）');
  ok(uniqShape >= 2, '连续 8 根沉木出现多种枝形（' + uniqShape + ' 种）');
  for (let i = 0; i < 8; i++) SIM.addDecor(s, 'rocks');
  const rs = SIM.decorList(s, 'rock');
  const uniqRock = new Set(rs.map(i => i.shape)).size;
  ok(uniqRock >= 2, '连续 8 块青龙石出现多种石形（' + uniqRock + ' 种）');
}

/* 数量上限与拖拽边界 */
{
  const s = SIM.create(); s.coins = 999999;
  let last;
  for (let i = 0; i < SIM.decorMax + 2; i++) last = SIM.addDecor(s, 'rocks');
  ok(!last.ok && SIM.decorList(s, 'rock').length === SIM.decorMax,
    '同类造景上限 ' + SIM.decorMax + ' 件后拒绝继续添加');
  SIM.setDecorPos(s, 'rock', 0, -3, 9);
  const it = SIM.decorList(s, 'rock')[0];
  ok(it.x >= .06 && it.x <= .94 && it.z >= .10 && it.z <= .90, '拖拽落点被夹在缸内');
}

/* 旧存档：没有 decorItems 要能补出空表；损坏实例要被剔除；正常实例可序列化回读 */
{
  const s = SIM.create(); s.coins = 999999;
  SIM.addDecor(s, 'driftwood'); SIM.addDecor(s, 'rocks');
  const loaded = SIM.load(SIM.serialize(s));
  ok(!!loaded && loaded.decorItems.wood.length === 1 && loaded.decorItems.rock.length === 1,
    '造景实例随存档保存并回读');

  delete loaded.decorItems;
  const migrated = SIM.load(JSON.stringify(loaded));
  ok(!!migrated && Array.isArray(migrated.decorItems.wood) && migrated.decorItems.wood.length === 0,
    '旧存档无 decorItems 时自动迁移为空表');

  const broken = SIM.create();
  broken.decorItems = { wood: [{ x: NaN, z: .5, s: 1, seed: 1 }, null], rock: 'oops' };
  const fixed = SIM.load(JSON.stringify(broken));
  ok(!!fixed && fixed.decorItems.wood.length === 0 && Array.isArray(fixed.decorItems.rock),
    '损坏 / NaN 造景数据被清理');
}

if (failed) {
  console.log('\u274c 造景门禁失败 ' + failed + ' 项');
  process.exit(1);
}
console.log('\u2705 造景门禁通过');
