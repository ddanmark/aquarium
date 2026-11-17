/* 螺虾行为门禁：层位字段完整、贴底不上浮、不出现 NaN。
 *
 * 背景：sim.js 的漫游逻辑用 sp.layer[0]/[1] 算垂直边界，
 * 而螺虾（kind: 'invert'）原先没有 layer 字段，算出 NaN 后被
 * finite(c.y, 0.6) 兜到中层——表现就是「螺漂在水中」。
 * 这个脚本把「所有 invert 必须有 layer」和「实际 y 必须贴底」都钉成断言。
 *
 * 用法: node tools/verify_inverts.js
 */
const path = require('path');

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

let fail = 0;
const ok = (cond, msg) => {
  console.log('  ' + (cond ? '\u2713 ' : '\u2717 ') + msg);
  if (!cond) fail++;
};

const inverts = D.creatures.filter(s => s.kind === 'invert');
ok(inverts.length > 0, '找到 ' + inverts.length + ' 种螺虾');

/* 1. 每种螺虾都必须有合法的 layer */
const badLayer = inverts.filter(s =>
  !Array.isArray(s.layer) || s.layer.length !== 2 ||
  !isFinite(s.layer[0]) || !isFinite(s.layer[1]) ||
  s.layer[0] >= s.layer[1]);
ok(badLayer.length === 0,
  '螺虾 layer 字段完整合法' + (badLayer.length ? '（异常: ' + badLayer.map(s => s.name).join('、') + '）' : ''));

/* 2. 每种螺虾各买 4 只，跑模拟，统计 y 的落点 */
const s = SIM.create();
s.coins = 999999;
s.paused = false;
s.speed = 1;
const bought = {};
inverts.forEach(sp => {
  bought[sp.id] = 0;
  for (let i = 0; i < 4; i++) {
    const r = SIM.addCreature(s, sp.id);
    if (r && r.ok) bought[sp.id]++;
  }
});

inverts.forEach(sp => {
  const mine = s.creatures.filter(c => c.specId === sp.id);
  ok(mine.length > 0, sp.name + ' 成功入缸 ' + mine.length + ' 只');
  if (!mine.length) return;
  /* 初始位置就该在层位内 */
  const bad0 = mine.filter(c => !(c.y >= sp.layer[0] - 0.06 && c.y <= sp.layer[1] + 0.04));
  ok(bad0.length === 0, sp.name + ' 初始 y 落在层位内（' +
    sp.layer[0] + '~' + sp.layer[1] + '）' +
    (bad0.length ? '（越界 ' + bad0.length + ' 只: ' + bad0.map(c => c.y.toFixed(3)).join(',') + '）' : ''));
});

/* 跑 240 秒模拟（每步 0.1s），持续采样 */
const mins = {};
inverts.forEach(sp => { mins[sp.id] = { lo: 1, hi: 0, nan: 0 }; });
for (let step = 0; step < 2400; step++) {
  SIM.update(s, 0.1);
  s.creatures.forEach(c => {
    if (!mins[c.specId]) return;
    const m = mins[c.specId];
    if (!isFinite(c.y)) { m.nan++; return; }
    if (c.y < m.lo) m.lo = c.y;
    if (c.y > m.hi) m.hi = c.y;
  });
}

inverts.forEach(sp => {
  const m = mins[sp.id];
  const slack = (sp.look && sp.look.shell === 'shrimp') ? 0.05 : 0.02;
  ok(m.nan === 0, sp.name + ' 全程无 NaN y');
  /* 贴底：螺只允许 0.02 的余量（几乎贴着缸底），虾 0.05（底层活动） */
  ok(m.lo >= sp.layer[0] - slack,
    sp.name + ' 贴底不上浮（最低 y ' + m.lo.toFixed(3) + '，层位下沿 ' + sp.layer[0] + '）');
  ok(m.hi <= Math.min(0.97, sp.layer[1] + 0.06),
    sp.name + ' 不超过上沿（最高 y ' + m.hi.toFixed(3) + '）');
});

if (fail) {
  console.log('\u274c 螺虾门禁失败 ' + fail + ' 项');
  process.exit(1);
}
console.log('\u2705 螺虾门禁通过');
