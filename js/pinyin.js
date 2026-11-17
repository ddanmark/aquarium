/* 澄屿 · 轻量拼音检索（零依赖、纯静态）
 *
 * 为什么不用拼音库：项目是 file:// 也能直接打开的纯前端，不想为一个搜索框
 * 引入几十 KB 的字典和构建步骤。这里内置一张「项目词表用字 → 无声调拼音」
 * 的精简表（覆盖 species.js 所有 name 字段 + 常用标签字），运行时只做字符串拼接。
 *
 * 每个条目同时建立三种索引：
 *   raw  原文本（小写、去标点）        → 中文直接搜、英文/拉丁名搜
 *   py   中文逐字换成全拼后的文本      → "chenmu" 搜「沉木」
 *   ab   所有中文字的首字母串          → "qls" 搜「青龙石」
 * 字典外的汉字仍保留在 raw 里（可中文直搜），只是不参与全拼/首字母匹配。
 * 用 `tools/verify_pinyin.js` 可校验字典覆盖率。
 */
(function () {
  'use strict';

  /* 「字拼音」以空格分隔；ü 写作 v（lv = 绿/滤）。 */
  var RAW =
    '一yi 七qi 三san 丑chou 丝si 丽li 云yun 人ren 仙xian 你ni 侧ce 光guang 全quan 冠guan ' +
    '冬dong 冻dong 准zhun 剑jian 加jia 勾gou 化hua 器qi 地di 型xing 壳ke 夏xia 大da ' +
    '孔kong 宝bao 小xiao 尔er 尾wei 干gan 平ping 底di 异yi 形xing 彩cai 性xing 恒heng ' +
    '扁bian 摩mo 斑ban 斗dou 料liao 斯si 旋xuan 春chun 普pu 暹xian 月yue 服fu 木mu ' +
    '果guo 标biao 棍gun 棒bang 椒jiao 榕rong 樱ying 橙cheng 正zheng 毛mao 毡zhan ' +
    '气qi 水shui 沉chen 沙sha 河he 泥ni 泵beng 浮fu 温wen 滤lv 灯deng 灵ling 烈lie ' +
    '热re 焰yan 熊xiong 片pian 牛niu 猫mao 玛ma 珍zhen 珠zhu 球qiu 理li 琉liu ' +
    '生sheng 甲jia 白bai 皇huang 皮pi 眉mei 石shi 礼li 神shen 秋qiu 种zhong 秘mi ' +
    '箭jian 粒li 精jing 红hong 纹wen 纺fang 细xi 绿lv 缸gang 罗luo 色se 花hua ' +
    '苹ping 草cao 莫mo 莲lian 萍ping 落luo 蓝lan 薄bo 藻zao 虎hu 虫chong 虾xia ' +
    '蚣gong 蛇she 蜈wu 螺luo 角jiao 谱pu 豹bao 过guo 迷mi 通tong 道dao 野ye ' +
    '金jin 铜tong 银yin 锤chui 锦jin 间jian 陶tao 雀que 青qing 静jing 音yin 颗ke ' +
    '饲si 马ma 鱼yu 鲤li 鳍qi 黄huang 黑hei 鼠shu 龙long ' +
    /* 名称之外的高频标签 / 描述字，补齐常见搜索词 */
    '造zao 景jing 净jing 控kong 氧yang 增zeng 减jian 酸suan 硝xiao 氮dan 氨an ' +
    '强qiang 弱ruo 群qun 游you 上shang 中zhong 下xia 层ceng 快kuai 慢man 好hao ' +
    '观guan 赏shang 设she 置zhi 布bu 局ju 拖tuo 摆bai 放fang 随sui 机ji ' +
    '状zhuang 颜yan 尺chi 寸cun 范fan 围wei 内nei 外wai 多duo 少shao 高gao ' +
    '低di 长chang 短duan 圆yuan 尖jian 厚hou 亮liang 暗an 清qing 浊zhuo 活huo ' +
    '食shi 喂wei 换huan 药yao 病bing 死si 繁fan 殖zhi 品pin 种zhong 价jia 币bi ' +
    '搜sou 索suo 名ming 称cheng 拼pin 英ying 文wen 中zhong 文wen ' +
    /* 色型 / 鳍型变体名 */
    '蝶die 翼yi 帆fan 半ban 背bei 裙qun';

  var MAP = {};
  RAW.split(/\s+/).forEach(function (tok) {
    if (tok) MAP[tok.charAt(0)] = tok.slice(1);
  });

  function isHan(ch) {
    var c = ch.charCodeAt(0);
    return c >= 0x4e00 && c <= 0x9fff;
  }

  /* 去掉标点/空白并转小写，中文与英文字母都保留 */
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[\s,.;:!?'"()\[\]{}<>\/\\|+=*&^%$#@~`_\-·、，。；：！？（）【】《》「」『』]/g, '');
  }

  function full(s) {
    var out = '';
    String(s == null ? '' : s).split('').forEach(function (ch) {
      out += isHan(ch) ? (MAP[ch] || ch) : ch;
    });
    return norm(out);
  }

  function abbr(s) {
    var out = '';
    String(s == null ? '' : s).split('').forEach(function (ch) {
      if (isHan(ch) && MAP[ch]) out += MAP[ch].charAt(0);
    });
    return out;
  }

  /* 把一个条目的可搜索文本压成索引对象；结果按 id 缓存，避免每次 render 重算 */
  function index(text) {
    return { raw: norm(text), py: full(text), ab: abbr(text) };
  }

  function match(idx, q) {
    var k = norm(q);
    if (!k) return true;
    if (!idx) return false;
    return idx.raw.indexOf(k) >= 0 || idx.py.indexOf(k) >= 0 || idx.ab.indexOf(k) >= 0;
  }

  window.AW_PY = {
    map: MAP, covered: Object.keys(MAP).length,
    norm: norm, full: full, abbr: abbr, index: index, match: match
  };
})();
