/* 澄屿 · 生态水族箱 —— 模拟引擎
 * 时间：1 现实秒 = 20 模拟分钟（1× 速度），可用 4× / 16× 快进。
 * 生态：鱼便与残饵 -> 氨氮 -> 硝化 -> 硝酸盐 -> 水草吸收 / 换水移出；
 *       光照 -> 光合作用产氧 / 夜间呼吸耗氧；强光 + 高硝酸盐 -> 藻类。
 */
(function () {
  'use strict';
  var D = window.AW_DATA;
  var MIN_PER_SEC = 20;
  var SAVE_KEY = 'aw_aquarium_v1';
  var uid = 0;
  var cap = 0; // 兼容旧存档时的兜底

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function newId() { uid++; return 'c' + Date.now().toString(36) + uid.toString(36); }
  function fmtTime(min) {
    var h = Math.floor(min / 60), m = Math.floor(min % 60);
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function pushEvent(s, text, type) {
    s.events.unshift({ day: s.day, time: fmtTime(s.minutes), text: text, type: type || 'info' });
    if (s.events.length > 70) s.events.length = 70;
  }

  function currentLight(s) {
    var hour = s.minutes / 60;
    // 室内自然光：日出后渐强、日落后归零；夜间只剩极弱的月光
    var sun = clamp(Math.sin((hour - 6) / 12 * Math.PI), 0, 1);
    var daylight = sun * 0.70;
    var lamp = (s.lightOn && s.equipment.light) ? s.lightLevel : 0;
    var shade = 0;
    s.creatures.forEach(function (c) {
      var sp = D.get(c.specId);
      if (sp && sp.kind === 'plant' && sp.shade) shade += sp.shade * (c.h / Math.max(0.1, sp.maxH));
    });
    /* 光照合成：自然光 + 灯具。灯具档位可以超过 1（极强档 1.25），
     * 所以上限放到 1.85 —— 显示层按 lv 线性放大所有灯的强度，
     * 顶档就是真的更亮，而不是像以前那样在 1.0 处被截断。 */
    var base = daylight * 0.72 + lamp * 0.98 + 0.018;
    // 只有浮萍铺满这类情况才明显遮光，普通水草打个折
    return clamp(base * (1 - clamp(shade, 0, 0.78) * 0.55), 0, 1.85);
  }

  function plantMass(s) {
    var m = 0;
    s.creatures.forEach(function (c) {
      var sp = D.get(c.specId);
      if (sp && sp.kind === 'plant') m += (0.25 + c.h / Math.max(0.1, sp.maxH)) * sp.uptake;
    });
    return m;
  }

  function bioLoad(s) {
    var l = 0;
    s.creatures.forEach(function (c) {
      var sp = D.get(c.specId);
      if (!sp || sp.kind === 'plant') return;
      var growth = sp.kind === 'fish' ? c.sizeCm / sp.size[1] : c.sizeCm / sp.size[1];
      l += sp.bioload * clamp(0.45 + growth * 0.55, 0.4, 1.5);
    });
    return l;
  }

  /* 负载上限按「化学平衡真实能撑住多少」标定：
   * 45cm 缸 + 过滤 + 气泵 + 几株水草大约能稳住 16~18 条小型鱼，
   * 旧公式给到 21~29，结果玩家在「负载 8/29 看着很空」的情况下就把氨氮养爆了。
   * 现在 capacity 同时也是繁殖的封顶线，所以数字必须和氮循环能力对齐。 */
  function capacityOf(s) {
    var tank = D.tank(s);
    return (2.4 + (s.filterOn ? 2.4 : 0) + (s.airOn ? 1.5 : 0) + Math.min(2.0, plantMass(s) * 0.8)) * tank.cap;
  }

  /* 水量系数：以 45cm 标准缸为 1，按缸体几何体积换算。
   * 氨氮 / 硝酸盐 / 溶氧都是「浓度」：同样的排泄量倒进更大的水体，浓度增量该更小。
   * 旧版完全不随缸缩放 —— 大缸负载上限翻倍、鱼也翻倍，污染却按小缸算，
   * 于是 90cm 缸挂机到 90 天会氨氮爆表全缸死亡（死因全是「氨氮过高」）。
   * 硝化能力不缩放：过滤器与硝化菌总量按设备算，大缸配得上更大的过滤。
   * 下限压在 1.0：只让比标准缸大的缸拿到稀释收益；若允许 <1，30cm 小缸污染翻倍，
   * 开局就超载会 60 天内全缸死亡（实测回归），小缸难度保持原样不动。 */
  function waterFactor(s) {
    var t = D.tank(s);
    /* 上限从 3.2 放到 10：200cm 缸的水量是 90cm 的十倍以上，
     * 压在 3.2 会让大缸的污染物浓度被算高十倍，白瞎了水体。 */
    return clamp((t.w * t.h * t.d) / (16.8 * 8.4 * 6.2), 1.0, 10.0);
  }

  /* ---------- 创建 ---------- */
  function makeCreature(s, specId, opt) {
    var sp = D.get(specId);
    if (!sp) return null;
    opt = opt || {};
    var c = {
      id: opt.id || newId(), specId: specId, kind: sp.kind,
      x: opt.x != null ? opt.x : rnd(0.12, 0.88),
      y: 0.5, vx: 0, vy: 0, dir: Math.random() < 0.5 ? -1 : 1,
      phase: rnd(0, Math.PI * 2), variant: Math.random(),
      ageDays: opt.ageDays || 0, hunger: opt.hunger != null ? opt.hunger : rnd(0.55, 0.8),
      health: opt.health != null ? opt.health : rnd(0.86, 0.98),
      stress: 0, behavior: '', anim: 0, breedCd: 0, target: null, chase: 0,
      name: opt.name || '', disease: 0, sickDays: 0, oldNoted: false,
      sizeCm: sp.kind === 'plant' ? 0 : (opt.sizeCm || sp.size[0] * rnd(0.92, 1.12)),
      h: sp.kind === 'plant' ? (opt.h || rnd(0.055, 0.10)) : 0,
      yellow: 0, born: s.day, restPhase: rnd(0, 6.28)
    };
    if (sp.kind === 'fish') c.y = rnd(sp.layer[0] + 0.04, sp.layer[1] - 0.04);
    else if (sp.kind === 'plant') { c.y = 0.955; c.vx = 0; }
    else if (sp.layer) {
      /* 螺虾：初始位置必须落在自己的层位里。原来写死 rnd(0.68,0.93)，
       * 比黑壳虾的层位下沿 0.76 还低，出生就在层位外面。 */
      c.y = rnd(sp.layer[0] + 0.01, sp.layer[1] - 0.01);
    }
    else { c.y = rnd(0.86, 0.955); }
    return c;
  }

  function create() {
    var s = {
      version: 2, coins: 10000, day: 1, minutes: 8 * 60, speed: 1, paused: false,
      lightOn: true, lightLevel: 0.62, heaterOn: true, targetTemp: 25,
      filterOn: true, airOn: false,
      equipment: { filter: true, light: true, heater: true, air: true, driftwood: false, rocks: true },
      decorOn: { driftwood: false, rocks: true },
      /* 商店「造景」tab 买到的独立个体。旧版一件沉木/一组石头只是布尔开关，
       * 现在每次添加都会随机出不同的大小与形状，可以重复购买、逐件拖动。 */
      decorItems: { wood: [], rock: [] },
      /* 默认 90cm 缸：鱼的显示比例按 cm 换算，大缸里小鱼才显得合理。 */
      /* 默认 90×30×37cm 缸：鱼的显示比例按 cm 换算，大缸里小鱼才显得合理。 */
      tankSize: 'huge', tankDims: { l: 90, w: 30, h: 37 }, tankMig: 3, substrate: 'sand', subOwned: ['sand'], viewMode: 'flat', vmMig: 2, seasonNote: -1,
      auto: {
        /* 默认开箱可挂机：定时喂食、定时换水、缺氧自动打氧、发现病鱼自动治疗。
         * 自动擦藻和日照开关灯仍留给玩家自己决定（擦藻会花贝壳币，开关灯影响观感）。 */
        feed: { on: true, every: 720, foodId: 'flake', foodIds: ['flake', 'sinking'], acc: 0 },
        water: { on: true, everyDays: 5, acc: 0 },
        scrub: { on: false, acc: 0 },
        light: { on: false }, air: { on: true }, treat: { on: true, acc: 0 }
      },
      aqua: { slope: 'flat', rock: { style: 'pebble', color: '#46595c', size: 1, count: 4 } },
      temp: 23.6, ammonia: 5, nitrate: 10, oxygen: 88, algae: 6, suspended: 0,
      creatures: [], foods: [], events: [], selected: null,
      stats: { fed: 0, births: 0, deaths: 0, changes: 0, trims: 0, sold: 0, sick: 0, cured: 0 },
      lastFeedAt: -999, lastCareAt: -999, lastReal: Date.now(),
      pointer: { x: 0.5, y: 0.5, active: false }, mode: 'feed'
    };
    /* 开局只放「有外置 3D 模型」的鱼虾，避免一进缸就是一堆程序化鱼混在一起 */
    var seed = [
      ['clownfish', { x: 0.30, ageDays: 6, sizeCm: 4.2 }],
      ['angelfish', { x: 0.54, ageDays: 9, sizeCm: 5.0 }],
      ['guppy', { x: 0.22, ageDays: 5, sizeCm: 3.4 }],
      ['guppy', { x: 0.44, ageDays: 3, sizeCm: 3.0 }],
      ['zebra', { x: 0.36, ageDays: 4, sizeCm: 3.2 }],
      ['zebra', { x: 0.71, ageDays: 6, sizeCm: 3.6 }],
      ['blacktetra', { x: 0.58, ageDays: 8, sizeCm: 4.6 }],
      ['molly', { x: 0.79, ageDays: 10, sizeCm: 6.2 }],
      ['cory', { x: 0.26, ageDays: 12, sizeCm: 3.6 }],
      ['bronzecory', { x: 0.83, ageDays: 14, sizeCm: 5.0 }],
      ['shrimp', { x: 0.40, sizeCm: 2.4 }], ['shrimp', { x: 0.47, sizeCm: 2.2 }],
      ['nerite', { x: 0.74, sizeCm: 1.7 }],
      ['anubias', { x: 0.11, h: 0.27 }], ['anubias', { x: 0.31, h: 0.19 }],
      ['hornwort', { x: 0.83, h: 0.40 }], ['elodea', { x: 0.93, h: 0.33 }],
      ['moss', { x: 0.60, h: 0.11 }]
    ];
    seed.forEach(function (it) {
      var c = makeCreature(s, it[0], it[1]);
      if (c) s.creatures.push(c);
    });
    pushEvent(s, '新缸开好了：小丑鱼、神仙鱼、孔雀鱼、斑马鱼都带着 3D 模型住进来了。', 'good');
    pushEvent(s, '记得定期投喂、换水。水清鱼壮，贝壳币才会慢慢攒起来。');
    return s;
  }

  /* ---------- 操作 ---------- */
  function absMinutes(s) { return s.day * 1440 + s.minutes; }

  function addCreature(s, specId) {
    var sp = D.get(specId);
    if (!sp) return { ok: false, msg: '没有这个品种' };
    if (sp.kind === 'gear') return buyGear(s, specId);
    /* 头数上限不能写死 48：s.creatures 里还包含水草，缸里种一片草就能把上限吃光，
     * 表现就是「明明是大缸却提示太挤」。改成只数活体（鱼 / 螺虾），
     * 并按缸体容量缩放——90cm 缸约 27 头，200cm 缸约 65 头。 */
    var animals = 0;
    for (var ai = 0; ai < s.creatures.length; ai++) {
      var asp = D.get(s.creatures[ai].specId);
      if (asp && asp.kind !== 'plant') animals++;
    }
    var headCap = Math.round(clamp(13 * D.tank(s).cap, 12, 80));
    if (animals >= headCap) {
      return { ok: false, msg: '缸里太挤了（' + animals + '/' + headCap + '），先分一些成员出去吧' };
    }
    if (s.coins < sp.price) return { ok: false, msg: '贝壳币不够，再养一会儿就好' };
    var load = bioLoad(s), capacity = capacityOf(s);
    var add = sp.bioload * 0.6;
    if (sp.kind !== 'plant' && load + add > capacity * 1.12) {
      return { ok: false, msg: '生物负载太高了：先加过滤/增氧，或种几株速生水草' };
    }
    /* 大型鱼的水体门槛：缸够大（cap ≥ 1.8，约 75cm 以上），或水体负载余量 ≥ 20
     * （靠过滤 + 速生水草堆出来）才放行。原来写死 capacity < 17，
     * 连「加满过滤的 90cm 缸」都达不到，等于大缸也养不了锦鲤。 */
    if (sp.bioload >= 3 && D.tank(s).cap < 1.8 && capacity < 20) {
      return { ok: false, msg: '大型鱼需要更大的水体：把缸加长，或加装过滤 / 种速生水草' };
    }
    s.coins -= sp.price;
    var opt = {};
    if (sp.kind === 'plant') opt.x = rnd(0.06, 0.94);
    var c = makeCreature(s, specId, opt);
    s.creatures.push(c);
    s.dex = s.dex || {};
    s.dex[specId] = 1;                       // 图鉴收录：入缸即登记（含色型变体）
    if (sp.kind === 'fish') pushEvent(s, '新成员入缸：' + sp.name + '，' + sp.tags[0] + '。', 'good');
    else if (sp.kind === 'plant') pushEvent(s, '种下了一株' + sp.name + '。', 'good');
    else pushEvent(s, sp.name + '沿着缸壁慢慢爬了进来。', 'good');
    return { ok: true, msg: sp.name + ' 已入缸', id: c.id };
  }

  /* ---------- 造景件（沉木 / 青龙石）----------
   * 旧版一件沉木 / 一组石头只是布尔开关，买了就只能有一份。现在改成实例数组：
   * 每次在商店「造景」tab 购买都随机生成一件，大小按当前缸几何自适应，
   * 可重复购买、在布景摆位模式逐件拖动。 */
  var DECOR_MAX = 12;

  function decorList(s, kind) {
    var d = s.decorItems = s.decorItems || {};
    if (!Array.isArray(d[kind])) d[kind] = [];
    return d[kind];
  }

  /* s 是相对系数，渲染层再乘 TANK 尺寸 —— 同一件换到任何缸都等比缩放，
   * 高度不会戳出水面、石径不会穿出缸壁。x/z 也避开边缘留出余量。 */
  function randomDecor(s, kind) {
    var t = D.tank(s);
    var sc = rnd(.62, 1.28);
    var it = {
      x: rnd(.10, .90), z: rnd(.16, .84),
      s: sc, seed: Math.floor(rnd(1, 1000000000)),
      shape: kind === 'wood' ? Math.floor(rnd(0, 4))
        : ['pebble', 'angular', 'slate'][Math.floor(rnd(0, 3))]
    };
    var unitCm = t.cm / t.w;               // 1 个 3D 单位 = 多少厘米
    it.cm = Math.round((kind === 'wood' ? t.h * .26 : t.d * .12) * sc * unitCm * 10) / 10;
    return it;
  }

  function addDecor(s, id) {
    var g = D.get(id);
    if (!g || !g.decor) return { ok: false, msg: '没有这件造景' };
    var kind = id === 'driftwood' ? 'wood' : 'rock';
    var list = decorList(s, kind);
    if (list.length >= DECOR_MAX) return { ok: false, msg: g.name + '最多摆 ' + DECOR_MAX + ' 件，缸里放不下了' };
    if (s.coins < g.price) return { ok: false, msg: '贝壳币不够' };
    s.coins -= g.price;
    var it = randomDecor(s, kind);
    list.push(it);
    s.equipment[id] = true;
    s.decorOn[id] = true;
    pushEvent(s, '新添了一件' + g.name + '（约 ' + it.cm + ' cm），大小和形状都是随机长出来的。', 'good');
    return { ok: true, msg: g.name + ' 已添加 · 约 ' + it.cm + ' cm', rebuild: true };
  }

  /* 布景摆位模式拖动造景件：idx 是 decorItems[kind] 的下标 */
  function setDecorPos(s, kind, idx, nx, nz) {
    var list = decorList(s, kind);
    if (!(idx >= 0 && idx < list.length)) return { ok: false, msg: '' };
    list[idx].x = clamp(nx, .06, .94);
    list[idx].z = clamp(nz, .10, .90);
    return { ok: true, msg: '' };
  }

  function buyGear(s, id) {
    var g = D.get(id);
    if (!g || g.kind !== 'gear') return { ok: false, msg: '没有这件设备' };
    if (g.decor) return addDecor(s, id);     // 造景件：每次都新增一件随机个体
    if (s.equipment[id]) return { ok: false, msg: g.name + ' 已经装好了，可在工具条开关它' };
    if (s.coins < g.price) return { ok: false, msg: '贝壳币不够' };
    s.coins -= g.price;
    s.equipment[id] = true;
    var effect = '';
    if (id === 'filter') { s.filterOn = true; s.ammonia *= 0.65; effect = '氨氮立刻下降，硝化系统开始工作'; }
    if (id === 'air') { s.airOn = true; s.oxygen = clamp(s.oxygen + 14, 0, 100); effect = '气泡升起，溶氧提升了'; }
    if (id === 'light') { s.lightOn = true; effect = '灯亮了，水草开始光合、缸壁也更容易长藻'; }
    if (id === 'heater') {
      s.heaterOn = true; s.temp = clamp(s.temp + 1.2, 12, 34);
      effect = '加热棒启动，正把水温拉向 ' + s.targetTemp + '℃';
    }
    if (id === 'driftwood' || id === 'rocks') {
      s.decorOn[id] = true; effect = '造景已摆进缸里，可在工具条随时隐藏';
    }
    pushEvent(s, '装上了' + g.name + '：' + effect + '。', 'good');
    return { ok: true, msg: g.name + ' 已安装 · ' + effect };
  }

  function toggle(s, key) {
    if (!s.equipment[key]) {
      var gk = D.get(key);
      return { ok: false, msg: gk && gk.decor ? '先在商店「造景」里添加一件' : '先在「设备」里买入并安装' };
    }
    if (key === 'light') s.lightOn = !s.lightOn;
    else if (key === 'filter') s.filterOn = !s.filterOn;
    else if (key === 'air') s.airOn = !s.airOn;
    else if (key === 'heater') s.heaterOn = !s.heaterOn;
    else if (key === 'driftwood' || key === 'rocks') s.decorOn[key] = !s.decorOn[key];
    else return { ok: false, msg: '这件设备没有开关' };
    return { ok: true, msg: '' };
  }

  function feed(s, foodId, x, portions) {
    /* foodId 可以是单个 id，也可以是 id 数组（自动喂食支持勾选多种饲料）。
     * portions 是份数倍率：管家按缸里头数自动加量，手投默认 1 份。 */
    var ids = Array.isArray(foodId) ? foodId : [foodId];
    var foods = [];
    for (var q = 0; q < ids.length; q++) { var f0 = D.food(ids[q]); if (f0) foods.push(f0); }
    if (!foods.length) return { ok: false, msg: '请选择饲料' };
    if (absMinutes(s) - s.lastFeedAt < 18) return { ok: false, msg: '刚撒过，等鱼儿吃一会儿' };
    s.lastFeedAt = absMinutes(s);
    var cx = clamp(x == null ? 0.5 : x, 0.05, 0.95);
    var mult = clamp(Math.round(portions || 1), 1, 4);
    for (var fi = 0; fi < foods.length; fi++) {
      var f = foods[fi];
      // 多种饲料混投时各占一段水面，避免全叠在一起
      var lane = foods.length > 1 ? (fi - (foods.length - 1) / 2) * 0.11 : 0;
      var n = Math.max(1, Math.round(f.n * mult / foods.length));
      for (var i = 0; i < n; i++) {
        s.foods.push({
          x: clamp(cx + lane + rnd(-0.05, 0.05), 0.02, 0.98), y: rnd(0.035, 0.075),
          vy: f.sink, nutrition: f.nutrition, pollution: f.pollution,
          diet: f.diet, color: f.color, age: 0, simAge: 0, rest: 0, state: 'float',
          wob: rnd(0, 6.28), dead: false
        });
      }
    }
    s.stats.fed++;
    s.suspended += 1.5 * mult;
    // 落水声惊扰：饲料砸进水面的瞬间，胆小的鱼先弹开，缓过来再去抢食
    s.startleSeq = (s.startleSeq || 0) + 1;
    s.startle = { id: s.startleSeq, x: cx, clock: .9 };
    var nm = foods.map(function (o) { return o.name; }).join('、');
    if (s.stats.fed % 3 === 1) pushEvent(s, '撒下' + nm + '，水面泛起一阵小小的骚动。');
    return { ok: true, msg: '投喂了' + nm };
  }

  function waterChange(s) {
    if (absMinutes(s) - s.lastCareAt < 10) return { ok: false, msg: '刚维护过，缓一缓' };
    s.lastCareAt = absMinutes(s);
    s.nitrate *= 0.40; s.ammonia *= 0.46; s.suspended *= 0.30;
    s.algae *= 0.86; s.oxygen = clamp(s.oxygen + 12, 0, 100);
    s.temp -= 0.4; s.stats.changes++;
    s.startleSeq = (s.startleSeq || 0) + 1;
    s.startle = { id: s.startleSeq, x: .5, clock: 2.2, all: true };
    pushEvent(s, '换掉了约三分之一的水，硝酸盐明显下降。', 'good');
    return { ok: true, msg: '换水完成，清爽多了' };
  }

  function scrub(s) {
    s.algae = clamp(s.algae * 0.30 - 1, 0, 100);
    s.startleSeq = (s.startleSeq || 0) + 1;
    s.startle = { id: s.startleSeq, x: .5, clock: 1.8, all: true };
    pushEvent(s, '擦掉了缸壁上的藻斑，视野又清亮了。', 'good');
    return { ok: true, msg: '缸壁擦干净了' };
  }

  function trimPlant(s, id) {
    var c = find(s, id), sp = c && D.get(c.specId);
    if (!c || !sp || sp.kind !== 'plant') return { ok: false, msg: '这不是水草' };
    c.h = Math.max(0.04, c.h * 0.48);
    c.yellow = Math.max(0, c.yellow - 0.2);
    s.coins += 4; s.stats.trims++;
    pushEvent(s, '修剪了' + sp.name + '，剪下来的部分换到 4 枚贝壳币。', 'good');
    return { ok: true, msg: sp.name + ' 修剪好了' };
  }

  /* 动态估价：品种基准价 × 体型 × 年龄阶段 × 健康 × 病情 × 季节行情 */
  function appraise(s, c) {
    if (!c) return null;
    var sp = D.get(c.specId);
    if (!sp) return null;
    var season = D.season(s.day);
    var sizeR = c.kind === 'plant' ? clamp(c.h / sp.maxH, 0.08, 1.15) : clamp(c.sizeCm / sp.size[1], 0.08, 1.30);
    var sizeF = 0.42 + 0.88 * sizeR;
    var stage = D.stageOf(c);
    var ageF = stage === '幼体' ? 0.75 : stage === '亚成体' ? 0.95 : stage === '成体' ? 1.18 :
      stage === '老年' ? 0.52 : stage === '成熟' ? 1.14 : 0.92;
    var healthF = 0.35 + 0.65 * clamp(c.health, 0, 1);
    var sickF = c.disease >= 2 ? 0.42 : c.disease === 1 ? 0.70 : 1;
    var nameF = c.name ? 1.06 : 1;
    var price = Math.max(2, Math.round(sp.price * sizeF * ageF * healthF * sickF * season.sell * nameF * 0.62));
    return { price: price, sizeF: sizeF, ageF: ageF, healthF: healthF, sickF: sickF,
      seasonF: season.sell, season: season.name, stage: stage, base: sp.price };
  }

  function sellCreature(s, id) {
    var c = find(s, id), sp = c && D.get(c.specId);
    if (!c || !sp) return { ok: false, msg: '找不到这位成员' };
    var q = appraise(s, c);
    s.coins += q.price;
    s.creatures = s.creatures.filter(function (o) { return o.id !== id; });
    if (s.selected === id) s.selected = null;
    s.stats.sold = (s.stats.sold || 0) + 1;
    pushEvent(s, D.displayName(c) + '（' + sp.name + '）以 ' + q.price + ' 币转出：' +
      q.season + '季行情 ' + Math.round(q.seasonF * 100) + '%、' + q.stage + '、健康 ' + Math.round(c.health * 100) + '%。', 'good');
    return { ok: true, msg: '已转出，' + q.season + '季成交价 ' + q.price + ' 币' };
  }

  function rename(s, id, name) {
    var c = find(s, id);
    if (!c) return { ok: false, msg: '找不到这位成员' };
    var clean = String(name || '').trim().slice(0, 12).replace(/[<>\"'&]/g, '');
    var old = D.displayName(c);
    c.name = clean;
    pushEvent(s, clean ? old + ' 现在叫「' + clean + '」了。' : D.get(c.specId).name + ' 恢复了本名。', 'good');
    return { ok: true, msg: clean ? '已命名为「' + clean + '」' : '已恢复品种名' };
  }

  function setTankDims(s, dims) {
    var t = D.tankFromCm(dims.l, dims.w, dims.h);
    var cur = D.tank(s);
    if (t.cm === cur.cm && t.cmw === cur.cmw && t.cmh === cur.cmh) {
      return { ok: false, msg: '尺寸没有变化' };
    }
    /* 扩容才收费，按新增水体的 cm³ / 9000 计价；缩水免费。 */
    var curV = cur.cm * cur.cmw * cur.cmh;
    var newV = t.cm * t.cmw * t.cmh;
    var cost = newV > curV ? Math.round((newV - curV) / 9000) : 0;
    if (cost > 0 && s.coins < cost) return { ok: false, msg: '扩容需要 ' + cost + ' 币' };
    s.coins -= cost;
    s.tankDims = { l: t.cm, w: t.cmw, h: t.cmh };
    s.tankMig = 3;
    pushEvent(s, '缸体换成了 ' + t.name + '（负载容量 ' + Math.round(t.cap * 100) + '%）' +
      (cost ? '，支出 ' + cost + ' 币。' : '。'), 'good');
    return { ok: true, msg: t.name + ' 已就位' + (cost ? '，支出 ' + cost + ' 币' : ''), rebuild: true };
  }

  /* 旧接口：按预设名切换，内部换算成自定义尺寸（预设间 cm/单位比例不同，
   * 直接搬 3D 尺寸会变形，所以按各自的 cm 标称值转） */
  function setTankSize(s, id) {
    var pt = D.tank(id);
    if (!pt || pt.id === 'custom') return { ok: false, msg: '没有这个预设' };
    var per = pt.cm / pt.w;
    return setTankDims(s, { l: pt.cm, w: Math.round(pt.d * per), h: Math.round(pt.h * per) });
  }

  function setSubstrate(s, id) {
    var sub = D.substrate(id);
    if (sub.id === s.substrate) return { ok: false, msg: '当前就是这个底砂' };
    s.subOwned = s.subOwned || ['sand'];
    var owned = s.subOwned.indexOf(sub.id) >= 0;
    var cost = owned ? 0 : sub.price;
    if (s.coins < cost) return { ok: false, msg: '更换需要 ' + cost + ' 币' };
    s.coins -= cost;
    if (!owned) s.subOwned.push(sub.id);
    s.substrate = sub.id;
    pushEvent(s, '底砂换成了' + sub.name + (cost ? '，支出 ' + cost + ' 币' : '') + '。', 'good');
    return { ok: true, msg: sub.name + ' 已铺好' + (cost ? '，支出 ' + cost + ' 币' : ''), rebuild: true };
  }

  function setViewMode(s, v) {
    s.viewMode = v === 'flat' ? 'flat' : '3d';
    return { ok: true, msg: s.viewMode === 'flat' ? '已切换为平面视角' : '已切换为 3D 视角' };
  }

  /* ---------- 造景 / 摆位 ---------- */
  function setAqua(s, patch) {
    s.aqua = s.aqua || { slope: 'flat', rock: { style: 'pebble', color: '#46595c', size: 1, count: 4 } };
    if (patch.slope) s.aqua.slope = patch.slope;
    if (patch.rock) {
      var t = s.aqua.rock = s.aqua.rock || {};
      ['style', 'color', 'size', 'count'].forEach(function (k) {
        if (patch.rock[k] != null) t[k] = patch.rock[k];
      });
    }
    return { ok: true, msg: '', rebuild: true };
  }

  /* ---------- 造景模板 ----------
   * 每套模板同时决定：底砂坡度、石头的「位置 + 大小 + 数量」、水草的落位槽。
   * 石头坐标是 [横向 0..1, 前后 0..1, 大小倍率]；水草槽是 [横向, 前后]。
   * 这样一键就能把缸摆成有构图的造景，而不是随机撒。 */
  var SCAPES = [
    { id: 'tripeak', name: '三峰式', slope: 'mound',
      rocks: [[.14, .56, 1.20], [.50, .64, .75], [.86, .56, 1.25], [.27, .42, .72], [.73, .42, .78]],
      plants: [[.06, .66], [.22, .74], [.78, .74], [.94, .64], [.36, .58], [.64, .58], [.50, .80]] },
    { id: 'island', name: '岛式', slope: 'flat',
      rocks: [[.44, .54, 1.20], [.57, .58, 1.05], [.50, .42, .85], [.37, .66, .70], [.63, .66, .70]],
      plants: [[.26, .62], [.74, .62], [.18, .72], [.82, .72], [.50, .26], [.50, .74], [.34, .34]] },
    { id: 'diagonal', name: '斜线式', slope: 'riseR',
      rocks: [[.18, .60, 1.25], [.37, .56, .95], [.55, .52, .72], [.71, .48, .55]],
      plants: [[.10, .68], [.29, .62], [.47, .58], [.64, .54], [.80, .50], [.91, .62], [.42, .76]] },
    { id: 'plain', name: '平原式', slope: 'flat',
      rocks: [[.28, .28, .70], [.68, .24, .58], [.48, .32, .50]],
      plants: [[.14, .60], [.30, .70], [.46, .60], [.62, .70], [.78, .58], [.90, .68], [.50, .82]] }
  ];

  function applyScape(s, id) {
    var sc = null;
    if (id === 'random') {
      sc = SCAPES[Math.floor(Math.random() * SCAPES.length)];
      id = sc.id;
    } else {
      for (var i = 0; i < SCAPES.length; i++) if (SCAPES[i].id === id) sc = SCAPES[i];
    }
    if (!sc) return { ok: false, msg: '没有这套造景' };
    s.aqua = s.aqua || {};
    s.aqua.slope = sc.slope;
    var rk = s.aqua.rock = s.aqua.rock || {};
    rk.count = clamp(sc.rocks.length, 2, 7);
    // 随机模板时给每块石头一点抖动，避免每次摆都一样
    var jitter = (id === 'random') ? .05 : 0;
    s.aqua.rockPos = sc.rocks.slice(0, rk.count).map(function (r) {
      return [clamp(r[0] + rnd(-jitter, jitter), .05, .95),
              clamp(r[1] + rnd(-jitter, jitter), .12, .90), r[2]];
    });
    // 水草按槽位重排（只动已有的水草，不新增）
    var plants = s.creatures.filter(function (c) { return c.kind === 'plant' && !D.get(c.specId).floating; });
    plants.forEach(function (c, i) {
      var slot = sc.plants[i % sc.plants.length];
      c.x = clamp(slot[0] + rnd(-.015, .015), .05, .95);
      c.zd = clamp(slot[1] + rnd(-.015, .015), .06, .94);
    });
    return { ok: true, msg: '已套用「' + sc.name + '」造景', rebuild: true };
  }

  /* 拖拽水草：x 为横向归一化坐标，zd 为前后深度 0..1（靠玻璃=0，靠观众=1） */
  function setCreaturePos(s, id, x, zd) {
    var c = find(s, id), sp = c && D.get(c.specId);
    if (!c || !sp || sp.kind !== 'plant') return { ok: false, msg: '只能拖动水草' };
    c.x = clamp(x, .05, .95);
    if (typeof zd === 'number' && isFinite(zd)) c.zd = clamp(zd, .06, .94);
    return { ok: true, msg: '' };
  }

  /* 拖拽石头：位置按归一化坐标存进 aqua.rockPos[idx]，
   * 渲染层重建造景时优先读这里，没记录过的石头仍用默认槽位 */
  function setRockPos(s, idx, x, zd) {
    var a = s.aqua = s.aqua || {};
    var cfg = a.rock || {};
    var n = clamp(Math.round(finite(cfg.count, 4)), 2, 7);
    if (!(idx >= 0 && idx < n)) return { ok: false, msg: '' };
    a.rockPos = a.rockPos || [];
    var prev = a.rockPos[idx] || [];
    a.rockPos[idx] = [clamp(x, .05, .95), clamp(zd, .10, .90), prev[2] || 1];
    return { ok: true, msg: '' };
  }

  /* ---------- 自动化管家 ---------- */
  function setAuto(s, key, patch) {
    s.auto = s.auto || {};
    var a = s.auto[key] = s.auto[key] || {};
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) a[k] = patch[k];
    if (key === 'feed') {
      a.every = clamp(finite(a.every, 720), 120, 1440);
      /* 多选饲料：foodIds 是主数据，foodId 保留为兼容字段（= 第一个） */
      if (a.foodIds != null) {
        var seenF = {};
        a.foodIds = (Array.isArray(a.foodIds) ? a.foodIds : [a.foodIds]).filter(function (id) {
          if (!D.food(id) || seenF[id]) return false;
          seenF[id] = 1; return true;
        });
      }
      if (!a.foodIds || !a.foodIds.length) {
        a.foodIds = (a.foodId && D.food(a.foodId)) ? [a.foodId] : ['flake'];
      }
      a.foodId = a.foodIds[0];
    }
    if (key === 'water' && [3, 5, 7].indexOf(a.everyDays) < 0) a.everyDays = 5;
    return { ok: true, msg: '' };
  }

  function automation(s, mins, days) {
    var a = s.auto;
    if (!a) return;
    var hour = s.minutes / 60;
    // 日照灯光：6:00–19:00 自动开关水草灯
    if (a.light && a.light.on) {
      var want = hour >= 6 && hour < 19;
      if (want !== !!s.lightOn) s.lightOn = want;
    }
    // 智能增氧：溶氧偏低自动开气泵，恢复后自动关
    if (a.air && a.air.on && s.equipment.air) {
      /* 阈值要卡在「鱼开始不适」之前，而不是等快窒息了才开：
       * 多数鱼 oxygenNeed*100+18 落在 78~93，所以 75 就该补氧，90 以上再停。 */
      if (s.oxygen < 75 && !s.airOn) {
        s.airOn = true; s._smartAir = true;
        pushEvent(s, '溶氧偏低，智能增氧自动打开了气泵。', 'info');
      } else if (s._smartAir && s.oxygen > 90 && s.airOn) {
        s.airOn = false; s._smartAir = false;
        pushEvent(s, '溶氧已充足，智能增氧关掉了气泵。', 'info');
      }
    }
    // 定时喂食：按缸里头数自动加量，否则十几条鱼抢 8 片薄片会长期处于半饥饿
    if (a.feed && a.feed.on) {
      a.feed.acc = (a.feed.acc || 0) + mins;
      if (a.feed.acc >= (a.feed.every || 720)) {
        a.feed.acc = 0;
        var heads = 0;
        s.creatures.forEach(function (c) { if (c.kind !== 'plant') heads++; });
        var portions = clamp(Math.round(heads / 5), 1, 4);
        feed(s, a.feed.foodIds && a.feed.foodIds.length ? a.feed.foodIds : [a.feed.foodId || 'flake'],
          rnd(.2, .8), portions);
      }
    }
    // 定时换水
    if (a.water && a.water.on) {
      a.water.acc = (a.water.acc || 0) + days;
      if (a.water.acc >= (a.water.everyDays || 5)) {
        a.water.acc = 0;
        if (waterChange(s).ok) pushEvent(s, '管家按时完成了自动换水。', 'good');
      }
    }
    // 定时擦藻：藻多才擦
    if (a.scrub && a.scrub.on) {
      a.scrub.acc = (a.scrub.acc || 0) + days;
      if (a.scrub.acc >= 4) {
        a.scrub.acc = 0;
        if (s.algae > 22) { scrub(s); pushEvent(s, '管家擦了一遍缸壁的藻。', 'good'); }
      }
    }
    // 自动下药：每两天巡一遍，有病鱼且够钱就治
    if (a.treat && a.treat.on) {
      a.treat.acc = (a.treat.acc || 0) + days;
      if (a.treat.acc >= 2) {
        a.treat.acc = 0;
        var sick = 0;
        s.creatures.forEach(function (c) { if (c.disease > 0) sick++; });
        if (sick > 0 && s.coins >= 40) treatTank(s);
      }
    }
  }

  function treatTank(s) {
    var cost = 40;
    var sick = s.creatures.filter(function (c) { return c.disease > 0; });
    if (!sick.length) return { ok: false, msg: '缸里没有生病的成员' };
    if (s.coins < cost) return { ok: false, msg: '药剂需要 ' + cost + ' 币' };
    s.coins -= cost;
    sick.forEach(function (c) { c.disease = 0; c.sickDays = 0; c.health = clamp(c.health + 0.12, 0, 1); c.stress *= 0.4; });
    s.stats.cured = (s.stats.cured || 0) + sick.length;
    s.startleSeq = (s.startleSeq || 0) + 1;
    s.startle = { id: s.startleSeq, x: .5, clock: 2.0, all: true };
    pushEvent(s, '下了一次药，' + sick.length + ' 位成员恢复活力。', 'good');
    return { ok: true, msg: '治疗完成，' + sick.length + ' 位康复' };
  }

  function find(s, id) {
    for (var i = 0; i < s.creatures.length; i++) if (s.creatures[i].id === id) return s.creatures[i];
    return null;
  }

  function setSpeed(s, v) { s.speed = v; }
  function setPaused(s, v) { s.paused = !!v; }
  function setLightLevel(s, v) { s.lightLevel = clamp(v, 0.18, 1.30); }
  function setTargetTemp(s, v) { s.targetTemp = clamp(v, 20, 30); }

  /* ---------- 环境 ---------- */
  function updateEnvironment(s, mins, days) {
    var hour = s.minutes / 60;
    var light = currentLight(s);
    s.lightNow = light;
    var mass = plantMass(s);
    var load = bioLoad(s);
    s.loadNow = load; s.capacityNow = capacityOf(s);

    // 水温：加热棒把水拉向设定值，否则跟随室温缓慢波动
    var season = D.season(s.day);
    var room = 22.2 + season.temp + 2.4 * Math.sin((hour - 9) / 24 * Math.PI * 2);
    var target = (s.heaterOn && s.equipment.heater) ? s.targetTemp : room;
    s.temp += (target - s.temp) * clamp(mins / 260, 0, 1);
    s.temp = clamp(s.temp, 12, 34);

    // 氨氮来源：鱼便 + 残饵分解
    var waste = 0;
    s.creatures.forEach(function (c) {
      var sp = D.get(c.specId);
      if (!sp || sp.kind === 'plant') return;
      var g = clamp(c.sizeCm / sp.size[1], 0.4, 1.4);
      var wasteRate = sp.waste != null ? sp.waste : (sp.bioload || 0.3) * 0.55;
      waste += wasteRate * g * days * 3.2;
    });
    s.foods.forEach(function (f) {
      if (f.state === 'rest') waste += f.pollution * days * 0.7;
    });
    s.ammonia += waste / waterFactor(s);
    // 硝化作用：过滤器里的硝化菌 + 溶氧
    var nitrify = (s.filterOn ? 2.6 : 0.34) * (0.4 + s.oxygen / 140) * days * 24;
    var conv = Math.min(s.ammonia, nitrify);
    s.ammonia -= conv;
    s.nitrate += conv * 0.42;
    // 水草吸收硝酸盐
    s.nitrate -= mass * (0.45 + light * 0.7) * days * 5.2 / waterFactor(s);
    s.nitrate = clamp(s.nitrate, 0, 100);
    s.ammonia = clamp(s.ammonia, 0, 100);

    // 溶氧：光合 + 水面交换 + 设备 - 呼吸 - 夜间水草耗氧
    var oxyUse = 0, graze = 0;
    s.creatures.forEach(function (c) {
      var sp = D.get(c.specId);
      if (!sp) return;
      if (sp.kind !== 'plant') oxyUse += sp.oxygenNeed * clamp(c.sizeCm / sp.size[1], 0.5, 1.4);
      if (sp.algaeEat) graze += sp.algaeEat;
      if (sp.algae) graze += sp.algae * (sp.graze || 0.6);
    });
    var oxyCap = 100 - Math.max(0, s.temp - 26) * 3.2;
    var photo = mass * light * days * 11;
    var resp = mass * (1 - light) * days * 3.0 + oxyUse * days * 7.0 / waterFactor(s);
    var surface = (oxyCap - s.oxygen) * days * 0.9;
    s.oxygen = clamp(s.oxygen + photo + surface + (s.airOn ? days * 20 : 0) +
      (s.filterOn ? days * 6 : 0) - resp, 0, 100);

    // 藻类：光强 × 营养盐 ×（1 - 水草竞争）- 食藻生物
    var comp = clamp(mass * 0.24, 0, 0.86);
    s.algae = clamp(s.algae + (light * (0.35 + s.nitrate / 70) * (1 - comp) * days * 15) -
      graze * days * 2.4 - (s.filterOn ? days * 0.5 : 0), 0, 100);

    // 悬浮微粒缓慢沉降 / 被过滤
    s.suspended = clamp(s.suspended - days * (s.filterOn ? 12 : 3.5), 0, 100);
  }

  /* ---------- 饲料颗粒 ---------- */
  function updateFoods(s, mins, animDt) {
    var alive = [];
    for (var i = 0; i < s.foods.length; i++) {
      var f = s.foods[i];
      if (f.dead) continue;
      f.age += animDt;          // 可见下沉用动画时钟，快进时鱼才追得上
      f.simAge = (f.simAge || 0) + mins;
      if (f.state === 'float') {
        f.y += f.vy * animDt * (1 + Math.min(f.age / 55, 2.2));
        f.x += Math.sin(f.age * 2 + f.wob) * animDt * 0.008;
        if (f.y >= 0.935) { f.y = 0.935; f.state = 'rest'; }
        if (f.simAge > 2880) { f.dead = true; s.ammonia += f.pollution * 0.8; continue; }
      } else {
        f.rest += mins;
        s.suspended += mins * 0.0008 * f.pollution;
        if (f.rest > 260) { f.dead = true; s.ammonia += f.pollution * 0.7; continue; }
      }
      alive.push(f);
    }
    s.foods = alive;
  }

  function canEat(sp, c, f) {
    if (sp.kind === 'invert') {
      if (f.state === 'rest') return sp.leftover > 0.15;
      return f.diet === 'algae' && sp.algae > 0.25;
    }
    if (f.state === 'rest') {
      // 沉底碎屑：底层鱼会去翻找，上层鱼不会下来
      if (sp.algaeEat > 0.8 && f.diet === 'algae') return true;
      return sp.layer[1] > 0.70;
    }
    return sp.diet.indexOf(f.diet) >= 0;
  }

  /* ---------- 生物 ---------- */
  function waterQuality(s) {
    return clamp(100 - s.ammonia * 1.05 - s.nitrate * 0.34 - s.algae * 0.22 - s.suspended * 0.4, 0, 100);
  }

  function tempComfort(sp, temp) {
    if (temp >= sp.temp[0] && temp <= sp.temp[1]) return 1;
    var d = temp < sp.temp[0] ? sp.temp[0] - temp : temp - sp.temp[1];
    return clamp(1 - d * 0.14, 0.12, 1);
  }

  function updateCreatures(s, mins, days, animDt) {
    var light = s.lightNow != null ? s.lightNow : currentLight(s);
    var hour = s.minutes / 60;
    var night = hour < 6 || hour > 19;
    var wq = waterQuality(s) / 100;
    var crowd = clamp(1 - Math.max(0, s.loadNow / s.capacityNow - 0.75) * 0.8, 0.25, 1);
    var lowOxygen = s.oxygen < 42;
    var pointer = s.pointer || { active: false };
    var dead = [];
    var fishes = s.creatures.filter(function (c) { return c.kind === 'fish'; });
    // 惊扰源（投喂落水 / 换水 / 擦缸 / 下药）随动画时钟消退
    if (s.startle && s.startle.clock > 0) s.startle.clock -= animDt;

    /* 邻居查询用均匀网格空间分区：把「每条鱼扫全缸」的 O(n²) 降到近似 O(n)。
     * 网格按归一化坐标切成 8×8，每条鱼只查自己所在格与相邻 8 格。 */
    var GW = 8, GH = 8, grid = {};
    fishes.forEach(function (f) {
      var key = ((clamp(f.x, 0, .999) * GW) | 0) + '_' + ((clamp(f.y, 0, .999) * GH) | 0);
      (grid[key] || (grid[key] = [])).push(f);
    });
    function neighbors(of, rx, ry) {
      var out = [], cx = (clamp(of.x, 0, .999) * GW) | 0, cy = (clamp(of.y, 0, .999) * GH) | 0;
      for (var gx = cx - 1; gx <= cx + 1; gx++) for (var gy = cy - 1; gy <= cy + 1; gy++) {
        var arr = grid[gx + '_' + gy];
        if (!arr) continue;
        for (var ii = 0; ii < arr.length; ii++) {
          var o = arr[ii];
          if (o === of) continue;
          if (Math.abs(o.x - of.x) <= rx && Math.abs(o.y - of.y) <= ry) out.push(o);
        }
      }
      return out;
    }

    for (var i = 0; i < s.creatures.length; i++) {
      var c = s.creatures[i], sp = D.get(c.specId);
      if (!sp) continue;
      c.ageDays += days;
      c.anim += animDt;
      if (c.breedCd > 0) c.breedCd -= days;
      if (c.chase > 0) c.chase -= days * 6;

      /* ===== 水草 ===== */
      if (sp.kind === 'plant') {
        var lf = clamp(light / Math.max(0.16, sp.lightNeed), 0, 1.25);
        var nutrient = clamp(0.42 + s.nitrate / 34, 0.35, 1.2);
        var tf = tempComfort(sp, s.temp);
        var grazed = 0;
        // 被会啃草的鱼/螺啃食
        s.creatures.forEach(function (o) {
          var os = D.get(o.specId);
          if (os && os.kind !== 'plant' && os.plantBite > 0 && Math.abs(o.x - c.x) < 0.12) grazed += os.plantBite;
        });
        if (grazed > 0) c.h = Math.max(0.03, c.h - grazed * days * 0.035 * sp.grazeRisk);
        if (light < sp.lightNeed * 0.5) {
          c.yellow = clamp(c.yellow + days * 0.055, 0, 1);
          c.health = clamp(c.health - days * 0.045, 0, 1);
        } else {
          c.yellow = clamp(c.yellow - days * 0.035, 0, 1);
          c.health = clamp(c.health + days * 0.03, 0, 1);
        }
        if (c.h < sp.maxH) {
          var soil = D.substrate(s.substrate);
          var soilBoost = sp.root ? soil.plant : 1;
          c.h = Math.min(sp.maxH, c.h + sp.growth * lf * nutrient * tf * c.health * soilBoost * D.season(s.day).growth * days);
        }
        c.behavior = c.h >= sp.maxH * 0.97 ? (sp.floating ? '已铺满水面，正在遮光' : '顶到水面了，该修剪啦')
          : light < sp.lightNeed * 0.5 ? '光照不足，叶片发黄徒长'
            : grazed > 0 ? '正被啃食，生长放缓'
              : sp.growth > 0.035 ? '快速抽新枝' : sp.growth < 0.01 ? '几乎看不出在长' : '稳步长新叶';
        if (c.health <= 0.02) { dead.push(c.id); pushEvent(s, sp.name + ' 长期缺光枯萎了。', 'bad'); }
        continue;
      }

      /* ===== 鱼 / 螺虾：饥饿、健康、生长 ===== */
      var hungerRate = sp.kind === 'fish' ? sp.appetite : 0.55;
      c.hunger = clamp(c.hunger - hungerRate * days * 0.5, 0, 1);

      // 刮藻充饥
      if (sp.algaeEat > 0 && s.algae > 8) c.hunger = clamp(c.hunger + sp.algaeEat * days * 0.42, 0, 1);
      if (sp.kind === 'invert' && sp.algae > 0 && s.algae > 8) c.hunger = clamp(c.hunger + sp.algae * days * 0.34, 0, 1);

      /* ===== 疾病：水质差 / 温差 / 应激 / 过密会诱发，状态好时也能自己缓过来 ===== */
      var pressure = (s.ammonia / 55 + s.nitrate / 150 + (100 - s.oxygen) / 180 +
        (1 - tempComfort(sp, s.temp)) * 0.8 + c.stress * 0.6 +
        Math.max(0, s.loadNow / Math.max(1, s.capacityNow) - 0.85)) *
        (1 - (sp.hardiness || 0.5) * 0.55);
      if (!c.disease && Math.random() < days * pressure * 0.24) {
        c.disease = 1; c.sickDays = 0;
        s.stats.sick = (s.stats.sick || 0) + 1;
        pushEvent(s, D.displayName(c) + ' 状态不对了：体色发暗、食欲下降，像是生病了。', 'warn');
      }
      if (c.disease > 0) {
        c.sickDays = (c.sickDays || 0) + days;
        c.hunger = clamp(c.hunger - c.disease * days * 0.12, 0, 1);
        c.health = clamp(c.health - c.disease * days * 0.045, 0, 1);
        if (c.disease === 1 && c.sickDays > 6 && Math.random() < days * 0.08) {
          c.disease = 2;
          pushEvent(s, D.displayName(c) + ' 病情加重，建议在维护里下药治疗。', 'bad');
        }
        if (pressure < 0.28 && c.hunger > 0.45 && Math.random() < days * 0.22) {
          c.disease = 0; c.sickDays = 0; c.health = clamp(c.health + 0.08, 0, 1);
          s.stats.cured = (s.stats.cured || 0) + 1;
          pushEvent(s, D.displayName(c) + ' 缓过来了，又开始抢食。', 'good');
        }
      }

      var risk = 0;
      if (s.ammonia > 22) risk += (s.ammonia - 22) * 0.0075;
      if (s.nitrate > 65) risk += (s.nitrate - 65) * 0.003;
      if (s.oxygen < sp.oxygenNeed * 100 + 18) risk += (sp.oxygenNeed * 100 + 18 - s.oxygen) * 0.0035;
      risk += (1 - tempComfort(sp, s.temp)) * 0.55;
      if (c.hunger < 0.13) risk += (0.13 - c.hunger) * 0.4;
      risk += c.stress * 0.28 + c.disease * 0.05;
      risk *= (1 - (sp.hardiness || 0.5) * 0.42);
      c.health = clamp(c.health + (risk < 0.02 ? 0.055 : -risk * 1.5) * days, 0, 1);
      c.stress = clamp(c.stress - days * 0.45, 0, 1);

      // 老年：过了 82% 寿命后体色变淡、行动变慢、体质缓慢衰退
      var maxAge = sp.lifespan * (0.82 + c.variant * 0.36);
      if (c.ageDays > maxAge) {
        c.health = clamp(c.health - days * 0.055, 0, 1);
        if (!c.oldNoted) {
          c.oldNoted = true;
          pushEvent(s, D.displayName(c) + ' 进入老年，游得慢了，颜色也淡了。', 'warn');
        }
      }

      // 生长用 von Bertalanffy 方程：L(t) = L∞·(1-e^{-K(t-t₀)})
      // 状态好坏只改变「有效生长年龄 gAge」的推进速度，体型始终由一个标量推出，不会因疾病/饥饿回缩形态
      var Linf = sp.size[2], Lbirth = sp.size[0] * 0.6;
      var K = 3.0 / Math.max(12, sp.growthDays);
      var t0v = Math.log(Math.max(.02, 1 - Lbirth / Linf)) / K;
      if (typeof c.gAge !== 'number' || !isFinite(c.gAge)) {
        var r0 = clamp(c.sizeCm / Linf, 0.02, 0.995);
        c.gAge = t0v - Math.log(1 - r0) / K;   // 由当前体长反解有效年龄，兼容旧存档
      }
      var growQ = clamp(c.hunger, 0, 1) * wq * tempComfort(sp, s.temp) * crowd *
        clamp(c.health, 0, 1) * (c.disease ? 0.35 : 1) * D.season(s.day).growth;
      c.gAge += days * clamp(growQ, 0, 1.2);
      c.sizeCm = clamp(Linf * (1 - Math.exp(-K * (c.gAge - t0v))), 0.2, Linf);

      if (c.health <= 0.001) {
        dead.push(c.id); s.ammonia += (sp.bioload * 4 + 4) / waterFactor(s);
        var cause = c.disease >= 2 ? '病重不治' : c.ageDays > maxAge ? '寿终正寝' :
          lowOxygen ? '溶氧不足' : s.ammonia > 35 ? '氨氮过高' : c.disease ? '久病体衰' : '体质衰竭';
        pushEvent(s, D.displayName(c) + '（' + sp.name + '）' + cause + '，活了 ' + Math.floor(c.ageDays) + ' 天。', 'bad');
        s.stats.deaths++;
        continue;
      }

      /* ===== 运动 / 行为 ===== */
      c.target = null;
      if (sp.kind === 'fish') {
        var best = null, bestD = 1e9;
        if (c.hunger < 0.96) {
          for (var fi = 0; fi < s.foods.length; fi++) {
            var f = s.foods[fi];
            if (!canEat(sp, c, f)) continue;
            if (Math.abs(f.y - c.y) > sp.reach) continue;
            var dx = f.x - c.x, dy = (f.y - c.y) * 1.4;
            var dd = Math.sqrt(dx * dx + dy * dy);
            if (dd < bestD) { bestD = dd; best = f; }
          }
        }
        if (best) {
          c.target = best;
          if (bestD < 0.042) {
            best.dead = true;
            c.hunger = clamp(c.hunger + best.nutrition * (sp.kind === 'fish' ? 1.05 : 1), 0, 1);
            c.health = clamp(c.health + 0.004, 0, 1);
          }
        }

        // 群游（Boids）：向同种邻居聚拢 + 对齐速度方向 + 保持个体间距；邻居来自网格，不再全缸遍历
        var sx = 0, sy = 0, n = 0, sepX = 0, sepY = 0, sepN = 0, alVx = 0;
        var mates = neighbors(c, .32, .34);
        for (var k = 0; k < mates.length; k++) {
          var o = mates[k];
          if (o.specId === c.specId && sp.schooling > 0.3) { sx += o.x; sy += o.y; n++; alVx += o.vx; }
          // 分离：贴得过近时互相推开，鱼不会叠在一起
          var ddx = c.x - o.x, ddy = c.y - o.y, dist2 = ddx * ddx + ddy * ddy;
          if (dist2 < 0.0049 && dist2 > 1e-7) {
            var dist = Math.sqrt(dist2);
            sepX += ddx / dist * (1 - dist / .07);
            sepY += ddy / dist * (1 - dist / .07) * .7;
            sepN++;
          }
        }

        // 目标水层：缺氧浮头 / 追食 / 昼夜节律
        var ty = clamp((sp.layer[0] + sp.layer[1]) / 2 + Math.sin(c.anim * 0.35 + c.phase) * 0.075, 0.06, 0.94);
        if (lowOxygen && s.oxygen < sp.oxygenNeed * 100 + 8) ty = 0.075;
        if (c.target) ty = c.target.y;
        if (night && sp.activity === 'day') ty = clamp(ty + 0.10, 0, 0.94);
        if (sp.activity === 'night' && !night) ty = Math.min(0.95, ty + 0.06);
        if (c.state === 'forage') ty = clamp(Math.min(sp.layer[0], 0.82) - 0.06, 0.05, 0.94);
        if (c.state === 'breathe') ty = 0.055;
        if (c.state === 'rest') ty = clamp(ty + 0.10, 0.05, 0.94);
        if (n > 0 && !c.target && sp.schooling > 0.5) ty = ty * (1 - sp.schooling * 0.5) + (sy / n) * sp.schooling * 0.5;

        // 领域行为：斗鱼驱赶同类 / 长鳍鱼
        var chaseTarget = null;
        if (sp.territory > 0 && c.chase <= 0) {
          for (var q = 0; q < mates.length; q++) {
            var Other = mates[q];
            var osp = D.get(Other.specId);
            if (!osp) continue;
            var threat = Other.specId === c.specId ? 1 : (osp.finRisk > 0.6 ? 0.5 : 0);
            if (threat && Math.abs(Other.x - c.x) < 0.26 && Math.abs(Other.y - c.y) < 0.22) {
              chaseTarget = Other; break;
            }
          }
          if (chaseTarget) {
            c.chase = 1.2; chaseTarget.stress = clamp(chaseTarget.stress + days * 1.6, 0, 1);
            chaseTarget.health = clamp(chaseTarget.health - days * 0.07, 0, 1);
            var victim = D.get(chaseTarget.specId);
            pushEvent(s, sp.name + ' 张开鳃盖，驱赶靠近领地的' + victim.name + '。', 'warn');
          }
        }

        /* ===== 受惊（状态机的第三层）：落水声 / 换水 / 擦缸惊扰 =====
         * 胆小的鱼弹开躲远再回来，胆大的照旧；整缸惊扰时谁都躲。
         * 每个惊扰源只对同一条鱼生效一次（lastStartle 记住已响应的源）。 */
        if (s.startle && s.startle.clock > 0 && c.lastStartle !== s.startle.id) {
          var skittish = s.startle.all || sp.bold < .72;
          var near = s.startle.all || Math.abs(c.x - s.startle.x) < .52;
          if (skittish && near) {
            c.lastStartle = s.startle.id;
            c.state = 'dart'; c.stateT = rnd(.5, 1.0); c.startledT = 2.2;
            c.dir = c.x < s.startle.x ? -1 : 1;
            c.vx = c.dir * sp.speed * .30;
            c.vy = rnd(-.05, .02);
            c.stress = clamp(c.stress + .08, 0, 1);
          }
        }
        if (c.startledT > 0) c.startledT -= animDt;

        /* ===== 行为状态机：巡游 / 悬停 / 急窜 / 底层觅食 / 休息 / 上浮换气 ===== */
        var feeding = !!(c.target || chaseTarget);
        var labyrinth = !!(sp.labyrinth || sp.id === 'betta' || sp.id === 'betta_red' || sp.id === 'betta_white');
        c.stateT = (c.stateT || 0) - animDt;
        if (c.startledT > 1.2) { c.state = 'dart'; }            // 受惊优先：先逃命再回来吃
        else if (feeding) { c.state = c.target ? 'feed' : 'chase'; }
        else if (c.stateT <= 0) {
          var rr = Math.random(), bottomish = sp.layer[1] > 0.7 || sp.plantBite > 0.3;
          if (night && sp.activity === 'day') { c.state = 'rest'; c.stateT = rnd(4, 10); }
          else if (sp.activity === 'night' && !night) { c.state = 'rest'; c.stateT = rnd(5, 12); }
          else if (labyrinth && rr < 0.20) { c.state = 'breathe'; c.stateT = rnd(0.9, 1.8); }
          else if (sp.territory > 0 && rr < 0.45) { c.state = 'hover'; c.stateT = rnd(1.2, 3); }
          else if (bottomish && rr < 0.42) { c.state = 'forage'; c.stateT = rnd(2, 4.5); }
          else if (rr < 0.10 && c.hunger > 0.4 && c.health > 0.55) { c.state = 'dart'; c.stateT = rnd(0.5, 0.9); c.dir = Math.random() < 0.5 ? -1 : 1; }
          else if (rr < 0.24 && sp.speed < 1.0) { c.state = 'hover'; c.stateT = rnd(0.8, 2.2); }
          else { c.state = 'cruise'; c.stateT = rnd(1.2, 3.2); }
        }

        var desiredVx = 0, desiredVy = 0, desiredVz = 0;
        /* 深度状态必须在状态机之前初始化：积分在分支外跑，
         * 如果只在巡航分支里初始化，鱼一旦进过 hover 就再也不会补，wz 会一直是 undefined → NaN。 */
        if (c.zw == null) { c.zw = rnd(0.35, 0.65); c.vzw = 0; }
        if (c.wz == null) { c.wz = rnd(0.18, 0.82); c.wzT = rnd(4, 8); }
        c.wzT -= animDt;
        if (c.wzT <= 0) { c.wz = rnd(0.18, 0.82); c.wzT = rnd(6, 12); }
        var stMul = c.state === 'rest' ? 0.13 : c.state === 'dart' ? 3.1 : c.state === 'hover' ? 0.16 :
          c.state === 'forage' ? 0.5 : c.state === 'breathe' ? 0.9 : 1;
        /* 昼夜习性：夜行鱼白天懒散、夜里活跃；日行鱼反过来 */
        var dayMul = 1;
        if (sp.activity === 'night') dayMul = night ? 1.0 : 0.45;
        else if (sp.activity === 'day') dayMul = night ? 0.55 : 1.0;
        var spd = sp.speed * 0.085 * (0.55 + c.hunger * 0.55) * dayMul *
          (c.ageDays > maxAge ? 0.60 : 1) * (c.disease >= 2 ? 0.45 : c.disease ? 0.72 : 1) * stMul;
        if (c.chase > 0 && chaseTarget) spd *= 2.1;
        if (c.target && !(c.startledT > 1.2)) {
          var tdx = c.target.x - c.x;
          desiredVx = Math.sign(tdx) * spd * 2.4;
          desiredVy = (c.target.y - c.y) * 0.9;
          if (Math.abs(tdx) < 0.01) desiredVx *= 0.2;
        } else if (chaseTarget) {
          desiredVx = Math.sign(chaseTarget.x - c.x || 1) * spd * 1.8;
          desiredVy = (chaseTarget.y - c.y) * 0.8;
        } else if (c.state === 'hover') {
          // 悬停：几乎原地不动，只有胸鳍和身体的小幅摆动
          desiredVx = Math.sin(c.anim * 0.9 + c.phase) * 0.0045;
          desiredVy = (ty - c.y) * 0.4;
        } else {
          /* 漫游：不再「直线巡航 + 随机翻转方向」，而是每几秒挑一个目标点游过去。
           * 目标点在身后时主动减速，转身就变成了「拐弯」而不是「急停掉头」。 */
          if (c.wx == null || c.wy == null) {
            c.wx = clamp(c.x + rnd(-0.3, 0.3), 0.08, 0.92);
            c.wy = clamp(c.y + rnd(-0.18, 0.18), Math.max(0.06, sp.layer[0] - 0.05),
                         Math.min(0.94, sp.layer[1] + 0.05));
            c.wanderT = rnd(2.0, 3.6) * (2.6 / (0.7 + Math.max(0.4, sp.speed)));
          }
          c.wanderT -= animDt;
          var wdx = c.wx - c.x, wdy = c.wy - c.y;
          var wdist = Math.sqrt(wdx * wdx + wdy * wdy);
          if (c.wanderT <= 0 || wdist < 0.06) {
            /* 好动的鱼换目标快、跑得远；慢吞吞的鱼一个方向游很久 */
            var tempo = Math.max(0.4, sp.speed);
            var spanX = rnd(0.18, 0.46) * (0.55 + tempo * 0.5) * (Math.random() < 0.5 ? -1 : 1);
            c.wx = clamp(c.x + spanX, 0.08, 0.92);
            c.wy = clamp(c.y + rnd(-0.22, 0.22), Math.max(0.06, sp.layer[0] - 0.05),
                         Math.min(0.94, sp.layer[1] + 0.05));
            c.wanderT = rnd(2.0, 3.6) * (2.6 / (0.7 + tempo));
            wdx = c.wx - c.x; wdy = c.wy - c.y;
            wdist = Math.sqrt(wdx * wdx + wdy * wdy) || 1e-6;
          }
          var wdz = c.wz - c.zw;
          var wdist3 = Math.sqrt(wdx * wdx + wdy * wdy + wdz * wdz) || 1e-6;
          var ease = Math.min(1, wdist / 0.20);            // 接近目标自然减速
          var reverse = (wdx * c.vx < 0 && Math.abs(c.vx) > 0.008);  // 目标在身后
          var slowTurn = reverse ? 0.32 : 1;
          desiredVx = (wdx / wdist) * spd * (0.50 + 0.50 * ease) * slowTurn;
          desiredVy = (wdy / wdist) * spd * 1.25 * ease * slowTurn;
          /* 按缸的宽深比补偿：横向每单位是 16.8/6.2 ≈ 2.7 倍的世界距离，
           * 不给 z 更大速度的话，鱼永远只是侧脸平移。 */
          // z 方向和 x/y 用同一个量纲（单位方向 × 速度），否则离目标越远冲得越猛
          desiredVz = (wdz / wdist3) * spd * 1.15 * slowTurn;
          if (n > 0 && sp.schooling > 0.45) {
            // 群游种叠加一点对齐牵引，但仍朝自己的目标点走
            desiredVx += clamp((sx / n - c.x) * 0.9, -spd * 0.5, spd * 0.5);
          }
          // 光标反应：胆大的凑过来，胆小的躲开
          if (pointer.active) {
            var pdx = pointer.x - c.x, pdy = pointer.y - c.y;
            if (Math.abs(pdx) < 0.16 && Math.abs(pdy) < 0.16) {
              var sign = sp.bold > 0.6 ? 1 : -1;
              desiredVx += Math.sign(pdx || 1) * sign * spd * 0.9;
              desiredVy += Math.sign(pdy || 1) * sign * spd * 0.35;
            }
          }
        }
        // Boids 的分离力：贴太近时互相让开，避免两条鱼穿模
        if (sepN > 0) {
          desiredVx += (sepX / sepN) * spd * 2.4;
          desiredVy += (sepY / sepN) * spd * 1.8;
        }
        // Boids 的对齐力：群游种与邻居速度趋同，整群换向时像一片鱼在转，而不是各自为政
        if (n > 0 && sp.schooling > 0.45) {
          desiredVx += clamp((alVx / n - c.vx) * .55 * sp.schooling, -spd * 1.1, spd * 1.1);
        }
        desiredVy += Math.sin(c.anim * 1.5 + c.phase) * 0.012;
        /* 螺虾贴底：它们不该像鱼那样上下浮游。垂直速度压到很小，
         * 只保留「爬行时的轻微起伏」。虾在 dart（弹跳）时例外，能窜一下。 */
        if (sp.kind === 'invert') {
          var isShrimp = sp.look && sp.look.shell === 'shrimp';
          desiredVy *= (isShrimp && c.state === 'dart') ? 0.9 : 0.12;
        }
        c.vx += (desiredVx - c.vx) * clamp(animDt * 3.4, 0, 1);
        c.vy += (desiredVy - c.vy) * clamp(animDt * 3.0, 0, 1);
        c.vzw = (c.vzw || 0) + (desiredVz - (c.vzw || 0)) * clamp(animDt * 2.6, 0, 1);
        c.zw = clamp((c.zw == null ? 0.5 : c.zw) + c.vzw * animDt, 0.10, 0.90);
        c.x += c.vx * animDt; c.y += c.vy * animDt;
        var lo = Math.max(0.035, sp.layer[0] - 0.12), hi = Math.min(0.965, sp.layer[1] + 0.16);
        if (c.target) { lo = 0.035; hi = 0.965; }
        if (sp.kind === 'invert') {
          /* 螺虾贴底：把允许的垂直范围收紧到层位附近。
           * 之前这里用 sp.layer 算边界，而螺虾没有 layer 字段，
           * 算出 NaN 后被 finite(c.y, 0.6) 兜到中层——表现就是「螺漂在水中」。 */
          lo = Math.max(lo, sp.layer[0] - 0.03);
          hi = Math.min(0.962, sp.layer[1] + 0.02);
          if (c.state === 'dart' && sp.look && sp.look.shell === 'shrimp') {
            hi = Math.min(0.90, hi + 0.12);      // 虾弹跳时允许窜高一点
          }
        }
        if (c.y < lo) { c.y = lo; c.vy = Math.abs(c.vy) * 0.5; }
        if (c.y > hi) { c.y = hi; c.vy = -Math.abs(c.vy) * 0.5; }
        if (c.x < 0.035) { c.x = 0.035; c.dir = 1; c.vx = Math.abs(c.vx); c.wx = null; }
        if (c.x > 0.965) { c.x = 0.965; c.dir = -1; c.vx = -Math.abs(c.vx); c.wx = null; }
        if (Math.abs(c.vx) > 0.003) c.dir = c.vx > 0 ? 1 : -1;

        if (c.disease >= 2) c.behavior = '病重：离群独游、几乎不进食';
        else if (c.disease === 1) c.behavior = '患病：体色发暗、食欲不振';
        else if (c.ageDays > maxAge) c.behavior = '老了，鳍摆得慢了';
        else if (lowOxygen && s.oxygen < sp.oxygenNeed * 100 + 8) c.behavior = '浮到水面换气（缺氧）';
        else if (c.startledT > 1.0) c.behavior = '受惊弹开，一口气游出去老远';
        else if (c.chase > 0) c.behavior = '张开鳍示威，驱赶入侵者';
        else if (c.target) c.behavior = '追食' + (c.target.state === 'rest' ? '沉底残饵' : foodName(c.target.diet));
        else if (c.state === 'breathe') c.behavior = '游上水面，用迷鳃换了一口气';
        else if (c.state === 'rest') c.behavior = night ? '夜里贴在草边慢慢休息' : '躲在阴影里歇着';
        else if (c.state === 'hover') c.behavior = '悬在原地，鱼鳍轻轻划水';
          else if (c.state === 'dart') c.behavior = '猛地窜了出去，又慢了下来';
        else if (c.state === 'forage') c.behavior = '拱着底砂翻找食物';
        else if (sp.activity === 'night' && night) c.behavior = '夜间翻砂找食';
        else if (sp.algaeEat > 0.8) c.behavior = '贴着缸壁刮食藻膜';
        else if (sp.plantBite > 0.4) c.behavior = c.hunger < 0.55 ? '拱着底砂、啃两口水草' : '慢悠悠翻砂巡游';
        else if (n > 0 && sp.schooling > 0.6) c.behavior = '和同伴保持队形群游';
        else if (c.hunger < 0.3) c.behavior = '四处觅食，有点饿了';
        else if (sp.territory > 0) c.behavior = '巡视自己的水面领地';
        else if (sp.layer[1] > 0.85) c.behavior = '贴着底砂慢慢探索';
        else if (sp.speed > 1.3) c.behavior = '一刻不停地快速巡游';
        else c.behavior = '悠然巡游';
      } else {
        // 螺虾：边爬边滤食沉底碎屑（按模拟天结算，避免快进时追不上颗粒）
        if (c.hunger < 0.92) {
          var leftovers = [];
          for (var li = 0; li < s.foods.length; li++) {
            if (s.foods[li].state === 'rest' && !s.foods[li].dead) leftovers.push(s.foods[li]);
          }
          if (leftovers.length && Math.random() < days * (sp.leftover + 0.25) * 3) {
            var lucky = leftovers[Math.floor(Math.random() * leftovers.length)];
            lucky.dead = true;
            c.hunger = clamp(c.hunger + 0.18 + lucky.nutrition * (sp.leftover + 0.3), 0, 1);
          }
        }
        var targetF = null, bd = 1e9;
        for (var z = 0; z < s.foods.length; z++) {
          var ff = s.foods[z];
          if (!canEat(sp, c, ff)) continue;
          var d3 = Math.abs(ff.x - c.x) + Math.abs(ff.y - c.y) * 0.4;
          if (d3 < bd) { bd = d3; targetF = ff; }
        }
        if (targetF) {
          c.target = targetF;
          if (Math.abs(targetF.x - c.x) < 0.03 && Math.abs(targetF.y - c.y) < 0.12) {
            targetF.dead = true; c.hunger = clamp(c.hunger + targetF.nutrition, 0, 1);
          }
        }
        // 螺虾：休息/爬行交替，虾受惊还会向后弹射
        c.stateT = (c.stateT || 0) - animDt;
        if (c.stateT <= 0) {
          if (!targetF && Math.random() < 0.34) { c.state = 'rest'; c.stateT = rnd(1.5, 4); }
          else if (sp.look && sp.look.shell === 'shrimp' && Math.random() < 0.18) { c.state = 'dart'; c.stateT = rnd(0.3, 0.5); c.dartDir = -(c.dir || 1); }
          else { c.state = 'crawl'; c.stateT = rnd(2, 6); }
        }
        var crawl = sp.speed * 0.045 * (night ? 1.3 : 0.8);
        if (targetF) c.vx = Math.sign(targetF.x - c.x || 1) * crawl * 2.4;
        else if (c.state === 'rest') c.vx = 0;
        else if (c.state === 'dart') c.vx = (c.dartDir || -(c.dir || 1)) * 0.30;
        else c.vx = Math.sin(c.anim * 0.22 + c.phase) * crawl;
        c.x = clamp(c.x + c.vx * animDt, 0.03, 0.97);
        c.dir = c.vx >= 0 ? 1 : -1;
        /* 贴底爬行的目标高度。原来写死成 0.86±0.07，等于让螺在离缸底 17% 的位置
         * 上下浮——这正是「螺漂在水中」的第二个来源，而且和上面的层位夹取互相打架。
         * 改成按 layer 推：螺贴着缸底（上沿往下 0.02），虾在底层活动。 */
        var isShrimpSp = !!(sp.look && sp.look.shell === 'shrimp');
        var wallC = isShrimpSp ? (sp.layer[0] + 0.12) : (sp.layer[1] - 0.02);
        var wallA = isShrimpSp ? 0.040 : 0.012;
        var wall = wallC + Math.sin(c.anim * 0.14 + c.phase) * wallA;
        c.y += (clamp(wall, 0.6, 0.955) - c.y) * clamp(animDt * 0.7, 0, 1);
        if (targetF) c.behavior = '爬向' + (targetF.state === 'rest' ? '沉底残饵' : '藻片');
        else if (c.state === 'rest') c.behavior = '趴在砂面上歇着';
        else if (c.state === 'dart') c.behavior = '尾扇一弹，向后弹射了一小段';
        else if (s.algae > 18 && sp.algae > 0.4) c.behavior = '沿缸壁刮食藻膜';
        else if (sp.plantBite > 0.2) c.behavior = '啃食柔嫩的水草叶片';
        else if (sp.leftover > 0.5) c.behavior = '在底砂上清理碎屑';
        else c.behavior = '慢慢爬行';
        if (c.disease) c.behavior = c.disease >= 2 ? '病重，缩着不动' : '状态不佳，行动迟缓';
        else if (c.ageDays > maxAge) c.behavior = '年事已高，爬得很慢';
      }
    }
    if (dead.length) {
      s.creatures = s.creatures.filter(function (c) { return dead.indexOf(c.id) < 0; });
      if (s.selected && dead.indexOf(s.selected) >= 0) s.selected = null;
    }
    // 清掉被吃掉的食物
    s.foods = s.foods.filter(function (f) { return !f.dead; });
  }

  function foodName(diet) {
    var f = D.foods.filter(function (o) { return o.diet === diet; })[0];
    return f ? f.name : '饲料';
  }

  function stageRatio(c, sp) {
    if (sp.kind === 'plant') return c.h / sp.maxH;
    return c.sizeCm / sp.size[1];
  }

  /* ---------- 每日事件：繁殖 / 提示 ---------- */
  function onNewDay(s) {
    var babies = [];
    var crowded = s.creatures.length >= 28; // 密度上限，避免快进时爆缸
    var byGroup = {};
    s.creatures.forEach(function (c) {
      var gsp = D.get(c.specId);
      var key = gsp && gsp.breedGroup ? gsp.breedGroup : c.specId;
      byGroup[key] = (byGroup[key] || 0) + 1;
    });
    var wq = waterQuality(s) / 100;
    s.creatures.forEach(function (c) {
      var sp = D.get(c.specId);
      if (!sp || !sp.breed || sp.breed.mode === 'none') return;
      if (crowded) return;
      if (c.breedCd > 0 || c.health < 0.7 || c.hunger < 0.55 || wq < 0.55) return;
      if (c.ageDays < (sp.breed.minAge || 30)) return;
      if (stageRatio(c, sp) < 0.82) return;
      var gkey = sp.breedGroup || c.specId;
      var pair = sp.breed.mode === 'self' ? byGroup[gkey] >= 1 : byGroup[gkey] >= 2;
      if (!pair) return;
      /* 留 15% 余量：一次可能有好几条同时繁殖，卡在 100% 会冲过负载上限，
       * 接着就是爆氨氮 → 集体生病 → 大批死亡，形成过山车。 */
      if (s.loadNow + babies.length * 0.35 + 0.6 > s.capacityNow * 0.85) return;
      if (Math.random() > sp.breed.chance) return;
      var count = Math.min(sp.breed.max || 1, 48 - s.creatures.length - babies.length);
      if (count <= 0) return;
      for (var i = 0; i < count; i++) {
        var baby = makeCreature(s, c.specId, {
          x: clamp(c.x + rnd(-0.08, 0.08), 0.05, 0.95),
          ageDays: 0, sizeCm: sp.size[0] * rnd(0.7, 0.95), hunger: 0.7, health: 0.9
        });
        babies.push(baby);
      }
      c.breedCd = sp.breed.cooldown || 15;
      c.hunger *= 0.72;
      s.stats.births += count;
      pushEvent(s, sp.name + (sp.breed.mode === 'livebearer' ? ' 生下了 ' : ' 繁殖出 ') + count + ' 只小家伙。', 'good');
    });
    if (babies.length) {
      s.creatures = s.creatures.concat(babies);
      s.dex = s.dex || {};
      babies.forEach(function (b) { s.dex[b.specId] = 1; });   // 繁殖的后代也收录进图鉴
    }

    // 状态提醒（按天限流）
    if (s.ammonia > 30 && s.day % 2 === 0) pushEvent(s, '氨氮偏高，鱼有点喘：换水或检查过滤器。', 'warn');
    if (s.oxygen < 35 && s.day % 2 === 1) pushEvent(s, '溶氧很低，有鱼开始浮头了。开气泵或关灯降温。', 'warn');
    if (s.algae > 62 && s.day % 3 === 0) pushEvent(s, '缸壁绿了一片：光照太强或硝酸盐太多。', 'warn');
    s.creatures.forEach(function (c) {
      var sp = D.get(c.specId);
      if (sp && sp.kind === 'plant' && c.h >= sp.maxH * 0.99 && !c._topNoted) {
        c._topNoted = true;
        pushEvent(s, sp.name + ' 长到水面了，可以修剪换点贝壳币。', 'good');
      }
    });

    // 换季：温度、生长与活体行情都跟着变
    var season = D.season(s.day);
    if (s.seasonNote !== season.id) {
      if (s.seasonNote >= 0) {
        pushEvent(s, '入' + season.name + '了：' + season.desc + ' 活体行情 ' + Math.round(season.sell * 100) + '%。', 'info');
      }
      s.seasonNote = season.id;
    }
    var sickCount = 0;
    s.creatures.forEach(function (c) { if (c.disease > 0) sickCount++; });
    if (sickCount && s.day % 3 === 0) pushEvent(s, '缸里还有 ' + sickCount + ' 位成员在生病，可在维护里下药治疗。', 'warn');
  }

  /* 数值兜底：任何异常都不要让 NaN 扩散到整个生态 */
  function finite(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }
  function sanitize(s) {
    s.ammonia = clamp(finite(s.ammonia, 5), 0, 100);
    s.nitrate = clamp(finite(s.nitrate, 10), 0, 100);
    s.oxygen = clamp(finite(s.oxygen, 82), 0, 100);
    s.algae = clamp(finite(s.algae, 6), 0, 100);
    s.suspended = clamp(finite(s.suspended, 0), 0, 100);
    s.temp = clamp(finite(s.temp, 24), 12, 34);
    s.coins = clamp(finite(s.coins, 200), 0, 99999);
    s.lightNow = clamp(finite(s.lightNow, 0.5), 0, 1);
    s.loadNow = finite(s.loadNow, 0); s.capacityNow = finite(s.capacityNow, 15);
    /* 一次性迁移到 90cm 默认缸：旧存档大多显式存着 medium（旧默认值），光改 create()
     * 的话玩家打开页面仍看到 45cm 缸。只升级 medium / 缺字段两种，主动选过
     * small / large / huge 的存档保持原样；tankMig 打标记，之后玩家再换缸不会被覆盖。 */
    if (s.tankMig == null) {
      if (!s.tankSize || s.tankSize === 'medium') s.tankSize = 'huge';
      s.tankMig = 2;
    }
    if (!s.tankSize) s.tankSize = 'huge';
    /* 迁移到自定义尺寸：旧存档只有 tankSize（预设 id），按该预设自己的 cm/单位比例
     * 换算成厘米，这样视觉大小不变。tankMig < 3 才做，玩家之后改的值不会被覆盖。 */
    if (!s.tankDims && (s.tankMig || 0) < 3) {
      var pt = D.tank(s.tankSize);
      var per = pt.cm / pt.w;                 // 该预设自己的 cm/单位比例
      s.tankDims = {
        l: Math.round(pt.cm),
        w: Math.round(pt.d * per),
        h: Math.round(pt.h * per)
      };
      s.tankMig = 3;
    }
    if (!s.tankDims) s.tankDims = { l: 90, w: 30, h: 37 };
    /* 越界 / 非数字一律夹回合法区间（用户可以在设置里手填，也可能改存档） */
    var tlim = D.tankLimits;
    s.tankDims.l = Math.min(tlim.l[1], Math.max(tlim.l[0], Math.round(finite(s.tankDims.l, 90))));
    s.tankDims.w = Math.min(tlim.w[1], Math.max(tlim.w[0], Math.round(finite(s.tankDims.w, 30))));
    s.tankDims.h = Math.min(tlim.h[1], Math.max(tlim.h[0], Math.round(finite(s.tankDims.h, 37))));
    s.substrate = s.substrate || 'sand';
    if (!Array.isArray(s.subOwned)) s.subOwned = ['sand'];
    s.viewMode = s.viewMode === 'flat' ? 'flat' : '3d';
    s.decorOn = s.decorOn || { driftwood: false, rocks: true };
    /* 造景实例：旧存档没有这个字段；损坏数据一律剔除，避免渲染层读到 NaN */
    var di = s.decorItems = s.decorItems || {};
    ['wood', 'rock'].forEach(function (k) {
      if (!Array.isArray(di[k])) { di[k] = []; return; }
      di[k] = di[k].filter(function (it) {
        /* 必须显式判 typeof：全局 isFinite(null) / isFinite('0.5') 都是 true，
         * JSON 里的 NaN 反序列化成 null，混进来会被静默夹成边界值而不是剔除。 */
        return it && ['x', 'z', 's', 'seed'].every(function (f) {
          return typeof it[f] === 'number' && isFinite(it[f]);
        });
      }).slice(0, DECOR_MAX).map(function (it) {
        it.x = clamp(it.x, .06, .94); it.z = clamp(it.z, .10, .90);
        it.s = clamp(it.s, .5, 1.4);
        if (!isFinite(it.cm)) it.cm = 0;
        if (k === 'wood') it.shape = clamp(Math.round(finite(it.shape, 0)), 0, 3);
        else if (['pebble', 'angular', 'slate'].indexOf(it.shape) < 0) it.shape = 'pebble';
        return it;
      });
    });
    s.seasonNote = finite(s.seasonNote, -1);
    s.dex = s.dex || {};   // 图鉴收录记录
    // 造景 / 自动化管家兜底
    var SLOPES = ['flat', 'riseL', 'riseR', 'mound', 'valley'];
    s.aqua = s.aqua || {};
    if (SLOPES.indexOf(s.aqua.slope) < 0) s.aqua.slope = 'flat';
    var rk = s.aqua.rock = s.aqua.rock || {};
    if (['pebble', 'angular', 'slate'].indexOf(rk.style) < 0) rk.style = 'pebble';
    rk.color = typeof rk.color === 'string' ? rk.color : '#46595c';
    rk.size = clamp(finite(rk.size, 1), .6, 1.6);
    rk.count = clamp(Math.round(finite(rk.count, 4)), 2, 7);
    s.auto = s.auto || {};
    ['feed', 'water', 'scrub', 'light', 'air', 'treat'].forEach(function (k) {
      s.auto[k] = s.auto[k] || {};
      s.auto[k].on = !!s.auto[k].on;
      if (k === 'feed') {
        s.auto[k].every = clamp(finite(s.auto[k].every, 720), 120, 1440);
        // 老存档只有单个 foodId，迁成数组；非法 id 一律剔除，至少留一种
        if (!Array.isArray(s.auto[k].foodIds)) {
          s.auto[k].foodIds = D.food(s.auto[k].foodId) ? [s.auto[k].foodId] : ['flake'];
        }
        s.auto[k].foodIds = s.auto[k].foodIds.filter(function (id) { return !!D.food(id); });
        if (!s.auto[k].foodIds.length) s.auto[k].foodIds = ['flake'];
        s.auto[k].foodId = s.auto[k].foodIds[0];
        s.auto[k].acc = finite(s.auto[k].acc, 0);        // 累计器只做兜底，不能清零（否则定时任务永远攒不满）
      }
      if (k === 'water') {
        if ([3, 5, 7].indexOf(s.auto[k].everyDays) < 0) s.auto[k].everyDays = 5;
        s.auto[k].acc = finite(s.auto[k].acc, 0);
      }
      if (k === 'scrub' || k === 'treat') s.auto[k].acc = finite(s.auto[k].acc, 0);
    });
    /* 一次性迁移（带版本号，逐步升级）：
     * v1 —— 老存档里四项自动化默认是关的，首次载入时打开一次；
     * v2 —— 默认饲料改成「浮性 + 沉底」混投：只喂薄片时中下层鱼够不着，
     *       饲料沉底腐烂，是默认缸水质恶化的主要原因。 */
    if (s.autoV !== 2) {
      if (s.autoV !== 1) {
        ['feed', 'water', 'air', 'treat'].forEach(function (k) { s.auto[k].on = true; });
      }
      var fd = s.auto.feed.foodIds;
      if (fd && fd.length === 1 && fd[0] === 'flake') fd.push('sinking');
      s.autoV = 2;
    }
    s.stats = s.stats || {};
    s.creatures.forEach(function (c) {
      var sp = D.get(c.specId) || { size: [1, 2, 3] };
      c.sizeCm = clamp(finite(c.sizeCm, sp.size ? sp.size[0] : 1), 0.1, 60);
      c.h = clamp(finite(c.h, 0.08), 0.01, 1);
      c.health = clamp(finite(c.health, 0.9), 0, 1);
      c.hunger = clamp(finite(c.hunger, 0.6), 0, 1);
      c.x = clamp(finite(c.x, 0.5), 0.03, 0.97);
      c.y = clamp(finite(c.y, 0.6), 0.03, 0.97);
      c.zd = (typeof c.zd === 'number' && isFinite(c.zd)) ? clamp(c.zd, 0.02, 0.98) : null;
      c.ageDays = finite(c.ageDays, 0);
      c.gAge = (typeof c.gAge === 'number' && isFinite(c.gAge)) ? c.gAge : null;
      c.name = typeof c.name === 'string' ? c.name.slice(0, 12) : '';
      c.disease = clamp(Math.round(finite(c.disease, 0)), 0, 2);
      c.sickDays = finite(c.sickDays, 0);
      c.oldNoted = !!c.oldNoted;
    });
  }

  /* ---------- 主循环 ---------- */
  function update(s, dtReal) {
    if (s.paused) return;
    dtReal = clamp(dtReal, 0, 0.5);
    var mins = dtReal * MIN_PER_SEC * s.speed;
    var days = mins / 1440;
    s.minutes += mins;
    var newDays = 0;
    while (s.minutes >= 1440) { s.minutes -= 1440; s.day++; newDays++; }
    // 可见运动统一用一个随快进倍率放大的动画时钟，避免「饲料瞬间沉底、鱼还在慢慢游」
    var animDt = clamp(dtReal, 0, 0.06) * (1 + Math.min(s.speed - 1, 15) * 0.28);
    updateEnvironment(s, mins, days);
    updateFoods(s, mins, animDt);
    updateCreatures(s, mins, days, animDt);
    automation(s, mins, days);
    for (var i = 0; i < newDays && i < 40; i++) onNewDay(s);
    sanitize(s);
    // 观赏收益：水越清、居民越健康，攒得越快
    var healthy = 0;
    s.creatures.forEach(function (c) { if (c.health > 0.6) healthy++; });
    var gain = (0.07 + healthy * 0.032 + waterQuality(s) * 0.0022) * (mins / 60);
    s.coins = clamp(s.coins + finite(gain, 0), 0, 99999);
  }

  function fastForward(s, realSeconds) {
    var total = clamp(realSeconds, 0, 1800);
    var step = 0.25;
    while (total > 0) {
      var d = Math.min(step, total);
      update(s, d);
      total -= d;
    }
  }

  /* ---------- 对外查询 ---------- */
  function getEnv(s) {
    var wq = waterQuality(s);
    var mass = plantMass(s);
    var load = s.loadNow != null ? s.loadNow : bioLoad(s);
    var capacity = s.capacityNow != null ? s.capacityNow : capacityOf(s);
    var hour = s.minutes / 60;
    var avg = 0, cnt = 0;
    s.creatures.forEach(function (c) { if (c.kind !== 'plant') { avg += c.health; cnt++; } });
    return {
      water: Math.round(wq), ammonia: Math.round(s.ammonia), nitrate: Math.round(s.nitrate),
      oxygen: Math.round(s.oxygen), temp: s.temp, algae: Math.round(s.algae),
      load: load, capacity: capacity, light: currentLight(s),
      hour: hour, isDay: hour >= 6 && hour <= 19, time: fmtTime(s.minutes), day: s.day,
      clarity: Math.round(clamp(100 - s.suspended * 0.8 - s.algae * 0.35, 12, 100)),
      plantMass: mass, health: cnt ? avg / cnt : 1, count: s.creatures.length,
      season: D.season(s.day), tank: D.tank(s), substrate: D.substrate(s.substrate),
      viewMode: s.viewMode, lightOn: s.lightOn, lightLevel: s.lightLevel,
      sick: s.creatures.filter(function (c) { return c.disease > 0; }).length
    };
  }

  /* ---------- 存档 ---------- */
  function serialize(s) {
    s.lastReal = Date.now();
    var copy = {};
    for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k) && k !== 'pointer') copy[k] = s[k];
    return JSON.stringify(copy);
  }

  function load(raw) {
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      if (!s || (s.version !== 1 && s.version !== 2) || !Array.isArray(s.creatures)) return null;
      var wasV1 = s.version === 1;
      s.version = 2;
      if (wasV1) s.coins = Math.max(finite(s.coins, 10000), 10000); // 旧存档迁移到新经济起点
      s.pointer = { x: 0.5, y: 0.5, active: false };
      s.paused = false;
      s.speed = 1; // 重开页面从 1× 开始，避免一打开就全速快进占用 CPU
      s.foods = s.foods || []; s.events = s.events || [];
      s.equipment = s.equipment || { filter: true, light: true };
      s.stats = s.stats || { fed: 0, births: 0, deaths: 0, changes: 0, trims: 0 };
      s.creatures = s.creatures.filter(function (c) {
        var sp = c && D.get(c.specId);
        return sp && (sp.kind === 'fish' || sp.kind === 'plant' || sp.kind === 'invert');
      });
      s.creatures.forEach(function (c) {
        c.target = null; c.chase = 0; c.behavior = c.behavior || '';
        c.yellow = c.yellow || 0; c.variant = c.variant || Math.random();
      });
      sanitize(s);
      // 一次性迁移：默认改为隐藏缸体的平面视角；此后用户在设置里选的视角会被保留
      if (s.vmMig !== 2) { s.viewMode = 'flat'; s.vmMig = 2; }
      return s;
    } catch (e) { return null; }
  }

  window.AW_SIM = {
    SAVE_KEY: SAVE_KEY, create: create, update: update, fastForward: fastForward,
    addCreature: addCreature, buyGear: buyGear, toggle: toggle, feed: feed,
    addDecor: addDecor, setDecorPos: setDecorPos, decorList: decorList, decorMax: DECOR_MAX,
    waterChange: waterChange, scrub: scrub, trimPlant: trimPlant, sellCreature: sellCreature,
    appraise: appraise, rename: rename, treatTank: treatTank,
    setSpeed: setSpeed, setPaused: setPaused, setLightLevel: setLightLevel, setTargetTemp: setTargetTemp,
    setTankDims: setTankDims, setTankSize: setTankSize, setSubstrate: setSubstrate, setViewMode: setViewMode,
    setAqua: setAqua, setAuto: setAuto, setCreaturePos: setCreaturePos, setRockPos: setRockPos,
    applyScape: applyScape, scapes: SCAPES,
    getEnv: getEnv, currentLight: currentLight, find: find,
    weight: function (c) { var sp = c && D.get(c.specId); return sp ? D.weightOf(sp, c.sizeCm) : 0; },
    shapeOf: function (c) { var sp = c && D.get(c.specId); return sp ? D.shapeOf(sp) : ''; },
    serialize: serialize, load: load, pushEvent: pushEvent, fmtTime: fmtTime,
    stageOf: function (c) { return D.stageOf(c); }
  };
})();
