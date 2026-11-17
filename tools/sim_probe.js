/* 在 Node 里跑模拟层，量化对比「游动是否自然」。
 * 用法: node tools/sim_probe.js <sim.js 路径> [秒数]
 */
const path = require('path');

global.window = {};
const simPath = path.resolve(process.argv[2] || 'js/sim.js');
require(path.resolve('js/species.js'));
require(simPath);
const SIM = window.AW_SIM;

const SECONDS = Number(process.argv[3] || 40);
const DT = 1 / 60;

const s = SIM.create();
// 只留一条小丑鱼，排除群游干扰
s.creatures = [];
s.foods = [];
const SPID = process.argv[4] || 'clownfish';
const r = SIM.addCreature(s, SPID);
if (!r || r.ok === false) {
  console.log('加鱼失败', r);
  process.exit(1);
}
const c = s.creatures[s.creatures.length - 1];

const rec = [];
for (let i = 0; i < SECONDS / DT; i++) {
  SIM.update(s, DT);
  rec.push({ x: c.x, y: c.y, vx: c.vx, vy: c.vy, zw: c.zw, vzw: c.vzw || 0 });
}

let travelled = 0, maxAcc = 0, still = 0, reversals = 0, lastSign = 0;
const speeds = [];
for (let i = 1; i < rec.length; i++) {
  const a = rec[i - 1], b = rec[i];
  const dx = b.x - a.x, dy = b.y - a.y;
  travelled += Math.hypot(dx, dy);
  const speed = Math.hypot(b.vx, b.vy) / DT;
  speeds.push(speed);
  const dvx = (b.vx - a.vx) / DT, dvy = (b.vy - a.vy) / DT;
  maxAcc = Math.max(maxAcc, Math.hypot(dvx, dvy));
  if (Math.hypot(b.vx, b.vy) < 0.002) still++;
  const sg = Math.abs(b.vx) < 0.002 ? 0 : Math.sign(b.vx);
  if (sg && lastSign && sg !== lastSign) reversals++;
  if (sg) lastSign = sg;
}
speeds.sort((p, q) => p - q);
const mean = speeds.reduce((p, q) => p + q, 0) / speeds.length;

let nan = 0;
rec.forEach(function (p) { if (!isFinite(p.x) || !isFinite(p.y)) nan++; });

console.log('品种: ' + SPID);
console.log('平均速度 ' + mean.toFixed(4) + '   最高 ' + speeds[speeds.length-1].toFixed(4) +
  '   中位 ' + speeds[speeds.length >> 1].toFixed(4));
console.log('路径长度 ' + travelled.toFixed(3) + '   最大瞬时加速度 ' + maxAcc.toFixed(2) +
  '   完全静止帧占比 ' + (still / rec.length * 100).toFixed(1) + '%   掉头次数 ' + reversals + '   NaN ' + nan);
// 朝向：glTF 里 yaw = atan2(-vz世界, vx世界)，缸 16.8 宽 × 6.2 深 × 0.88
var yaws = rec.map(function (p) {
  var vxW = p.vx * 16.8, vzW = p.vzw * 6.2 * 0.88;
  if (Math.sqrt(vxW * vxW + vzW * vzW) < 0.05) return null;
  var y = Math.atan2(-vzW, vxW);
  y = Math.max(-0.85, Math.min(0.85, y));
  return Math.abs(y) * 180 / Math.PI;
}).filter(function (v) { return v !== null; });
var meanYaw = yaws.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, yaws.length);
var big = yaws.filter(function (v) { return v > 30; }).length / Math.max(1, yaws.length) * 100;
var huge = yaws.filter(function (v) { return v > 60; }).length / Math.max(1, yaws.length) * 100;
// 偏航角速度/角加速度：转身是否"甩头"
var ys = rec.map(function (p) {
  var vxW = p.vx * 16.8, vzW = p.vzw * 6.2 * 0.88;
  var y = Math.atan2(vxW >= 0 ? -vzW : vzW, Math.max(Math.abs(vxW), 1e-4));
  return Math.max(-0.85, Math.min(0.85, y));
});
var rates = [];
for (var i = 1; i < ys.length; i++) {
  var d = ys[i] - ys[i - 1];
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  rates.push(d / (1 / 60));
}
var mr = rates.map(Math.abs);
var accs = [];
for (var j = 1; j < rates.length; j++) accs.push(Math.abs(rates[j] - rates[j - 1]) / (1 / 60));
console.log('偏航角速度峰值 ' + Math.max.apply(null, mr).toFixed(2) + ' rad/s   角加速度峰值 ' +
  Math.max.apply(null, accs).toFixed(1) + ' rad/s²');
console.log('平均偏航角 ' + meanYaw.toFixed(1) + '°   超过 30° 的时间占比 ' + big.toFixed(1) +
  '%   超过 60° 占比 ' + huge.toFixed(1) + '%');
console.log('深度 z 范围 ' + Math.min.apply(null, rec.map(p => p.zw)).toFixed(3) + '..' +
  Math.max.apply(null, rec.map(p => p.zw)).toFixed(3) + '   （0..1 归一化，0.5 为缸中心）');
console.log('x 范围 ' + Math.min.apply(null, rec.map(p => p.x)).toFixed(3) + '..' +
  Math.max.apply(null, rec.map(p => p.x)).toFixed(3) + '   y 范围 ' +
  Math.min.apply(null, rec.map(p => p.y)).toFixed(3) + '..' +
  Math.max.apply(null, rec.map(p => p.y)).toFixed(3));
