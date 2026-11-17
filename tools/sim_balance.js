/* 默认设置下的平衡性体检：跑 N 个模拟天，逐日打印水质/溶氧/健康/收益。
 * 用法: node tools/sim_balance.js [天数=60] [种子=1]
 */
const path = require('path');
global.window = {};
require(path.resolve('js/species.js'));
require(path.resolve('js/sim.js'));
const SIM = window.AW_SIM;

const DAYS = Number(process.argv[2] || 60);
const s = SIM.create();
s.speed = 16;

function line(tag) {
  const env = SIM.getEnv(s);
  const fish = s.creatures.filter(c => c.kind !== 'plant');
  const hp = fish.length ? fish.reduce((a, c) => a + c.health, 0) / fish.length : 1;
  const hungry = fish.length ? fish.reduce((a, c) => a + c.hunger, 0) / fish.length : 0;
  console.log(
    tag.padEnd(6),
    '氨氮', String(Math.round(s.ammonia)).padStart(3),
    '硝酸', String(Math.round(s.nitrate)).padStart(3),
    '溶氧', String(Math.round(s.oxygen)).padStart(3), '温', s.temp.toFixed(1),
    '藻', String(Math.round(s.algae)).padStart(3),
    '浑浊', String(Math.round(s.suspended)).padStart(3),
    '水质', String(env.water).padStart(3),
    '健康', hp.toFixed(2),
    '饥饿', hungry.toFixed(2),
    '负载', env.load.toFixed(1) + '/' + env.capacity.toFixed(0),
    '鱼', fish.length,
    '币', Math.round(s.coins)
  );
}

line('day0');
console.log('自动管家:', JSON.stringify({
  feed: s.auto.feed.on, water: s.auto.water.on,
  air: s.auto.air.on, treat: s.auto.treat.on,
  foods: s.auto.feed.foodIds || s.auto.feed.foodId,
  waterEvery: s.auto.water.everyDays
}));
console.log('设备:', JSON.stringify(s.equipment));

let lastDay = s.day;
const t0 = Date.now();
while (s.day < DAYS) {
  SIM.update(s, 0.5);
  if (s.day !== lastDay) {
    lastDay = s.day;
    if (s.day % 5 === 0) line('day' + s.day);
  }
  if (Date.now() - t0 > 60000) { console.log('（超时提前结束）'); break; }
}
line('end');
console.log('事件尾部:');
s.events.slice(0, 8).forEach(e => console.log('  ·', e.text || e.msg || JSON.stringify(e)));
