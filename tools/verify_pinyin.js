/* 拼音检索门禁：校验字典覆盖率与中/英/全拼/首字母四种匹配。
 * 由 verify_assets.js 第【7】节调用，也可单独 node tools/verify_pinyin.js。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/pinyin.js'), 'utf8'), ctx);
const PY = ctx.window.AW_PY;

let failed = 0;
function ok(cond, label) {
  console.log('  ' + (cond ? '\u2713 ' : '\u2717 ') + label);
  if (!cond) failed++;
}

/* 所有 name 字段里的汉字都必须在字典里，否则该品种的全拼搜不到 */
const src = fs.readFileSync(path.join(ROOT, 'js/species.js'), 'utf8');
const names = [];
const re = /name:\s*'([^']*)'/g;
let m;
while ((m = re.exec(src)) !== null) names.push(m[1]);
const chars = new Set();
names.forEach(n => n.split('').forEach(ch => {
  const c = ch.charCodeAt(0);
  if (c >= 0x4e00 && c <= 0x9fff) chars.add(ch);
}));
const missing = [...chars].filter(ch => !PY.map[ch]);
ok(names.length >= 90, '扫描到 ' + names.length + ' 个名称字段');
ok(missing.length === 0, '名称用字 ' + chars.size + ' 个全部有拼音' +
  (missing.length ? '（缺：' + missing.join('') + '）' : ''));
ok(PY.covered >= chars.size, '字典共 ' + PY.covered + ' 字');

/* 四种输入都要能命中同一条目 */
const cases = [
  ['沉木', ['沉木', 'chenmu', 'cm']],
  ['青龙石', ['青龙石', 'qinglongshi', 'qls']],
  ['红绿灯', ['红绿灯', 'honglvdeng', 'hld']],
  ['孔雀鱼 Poecilia reticulata', ['孔雀', 'kongqueyu', 'kqy', 'poecilia', 'reticulata']],
  ['宝莲灯', ['baoliandeng', 'bld']],
  ['暹罗斗鱼', ['xianluodouyu', 'xldy']]
];
cases.forEach(([text, queries]) => {
  const idx = PY.index(text);
  queries.forEach(q => ok(PY.match(idx, q), '「' + text + '」← ' + q));
});
ok(!PY.match(PY.index('沉木'), 'qinglongshi'), '不相关拼音不会误命中');
ok(PY.match(PY.index('沉木'), ''), '空关键词返回全部');

if (failed) {
  console.log('\u274c 拼音门禁失败 ' + failed + ' 项');
  process.exit(1);
}
console.log('\u2705 拼音门禁通过');
module.exports = { PY, failed };
