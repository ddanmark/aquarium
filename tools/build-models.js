/* 打包模型：node tools/build-models.js
 *
 * 把 models/*.glb 拆成「每个模型一个 JS」，再用 js/models.js 当索引：
 *   js/models/clownfish_rigged.glb.js  ->  window.AW_MODELS["clownfish_rigged.glb"] = "<base64>"
 *   js/models.js                       ->  只放文件名清单，几十字节
 *
 * 这样 file:// 打开时只注入实际用到的那一个模型，首屏不会背上十几 MB 的 base64。
 * 往 models/ 里加新 GLB 后重新跑一次即可。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const modelsDir = path.join(root, 'models');
const outDir = path.join(root, 'js', 'models');
const indexPath = path.join(root, 'js', 'models.js');

fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(modelsDir)
  .filter(f => f.toLowerCase().endsWith('.glb'))
  .sort();

let total = 0;
const names = files.map(f => {
  const b64 = fs.readFileSync(path.join(modelsDir, f)).toString('base64');
  total += b64.length;
  const body = '/* 自动生成，勿手改 */ window.AW_MODELS=window.AW_MODELS||{};' +
    'window.AW_MODELS[' + JSON.stringify(f) + ']=' + JSON.stringify(b64) + ';\n';
  fs.writeFileSync(path.join(outDir, f + '.js'), body);
  return f;
});

const VER = String(Date.now());
const index = '/* 自动生成（node tools/build-models.js）：模型清单。' +
  '真正的 base64 在 js/models/<名字>.js 里，按需注入。 */\n' +
  'window.AW_MODELS = window.AW_MODELS || {};\n' +
  'window.AW_MODEL_FILES = ' + JSON.stringify(names, null, 2) + ';\n' +
  'window.AW_MODEL_VER = ' + JSON.stringify(VER) + ';\n';
fs.writeFileSync(indexPath, index);
console.log('打包了 ' + files.length + ' 个模型（合计 ' + (total / 1048576).toFixed(1) +
  ' MB base64，按需加载）→ js/models/ + js/models.js');
