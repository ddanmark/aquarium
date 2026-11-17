/* 澄屿 · 3D 生态水族箱 —— 界面与交互 */
(function () {
  'use strict';
  var D = window.AW_DATA, SIM = window.AW_SIM, R = window.AW_RENDER;
  var $ = function (id) { return document.getElementById(id); };
  var state, shopTab = 'fish', shopQuery = '', dexQuery = '', iconCache = {}, searchCache = {}, lastSig = '', lastLogKey = '';
  var lastFrame = performance.now(), uiClock = 0, saveClock = 0, toastTimer = null, lastView = '', lastDetailKey = '';

  var TABS = {
    fish: D.fish.filter(function (s) { return !s.hideInShop && s.model; }),
    plant: D.plants,
    invert: D.inverts.filter(function (s) { return s.model; }),
    gear: D.gear.filter(function (g) { return !g.decor; }),   // 沉木 / 青龙石搬去造景 tab
    decor: D.decor
  };
  var shopPick = {};   // 每个品种当前选中的色型/鳍型索引
  var HINTS = {
    fish: '分层是关键：浮料给上层鱼，沉料给底层鱼。斗鱼有强领域性，别和另一只斗鱼同缸。',
    plant: '阴性草（水榕、莫斯）低光也能活，速生草（金鱼藻、浮萍）几天就长满，但会抢光。',
    invert: '黑壳虾清理残饵，斑马螺刮食缸壁藻膜，都是缸里的保洁员。',
    gear: '过滤建立硝化系统，加热棒稳定水温，灯强了长草也长藻，气泵给高密度缸补氧。',
    decor: '沉木和青龙石按当前缸大小随机生成，每件的尺寸与形状都不同；切到「布景摆位」可逐件拖动。'
  };

  /* ---------- 搜索：中文 / 英文 / 全拼 / 拼音首字母 ---------- */
  /* 索引按 id 缓存：品种数据是静态的，没必要每次 render 都重拼一遍字符串。 */
  function searchOf(sp) {
    if (searchCache[sp.id]) return searchCache[sp.id];
    var parts = [sp.name, sp.latin || '', sp.en || '', sp.id,
      (sp.tags || []).join(' '), sp.tag || '', sp.desc || ''];
    return (searchCache[sp.id] = window.AW_PY.index(parts.join(' ')));
  }
  function filterList(list, q) {
    if (!q) return list;
    return list.filter(function (sp) { return window.AW_PY.match(searchOf(sp), q); });
  }
  function emptyHint(q) {
    return '<div class="empty-log">没有找到「' + esc(q) + '」相关的条目' +
      '<br><small>可试试中文名、英文名、全拼（chenmu）或首字母（cm）</small></div>';
  }

  function toast(msg) {
    var el = $('toast');
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2100);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function barColor(v, reverse) { var good = reverse ? 100 - v : v; return good > 65 ? '#48c79a' : good > 38 ? '#e8b34c' : '#ef7b6c'; }
  function result(r) { if (r && r.msg) toast(r.msg); return r; }
  /* 水草高度在模拟层是「占缸高的比例」，换算成厘米要按当前缸的实际高度：
   * 1 个 3D 单位 = cm / w 厘米，缸高 h 个单位即 cm * h / w 厘米。
   * 旧版写死 45（默认缸宽），换到 90cm 缸后株高数字就完全对不上了。 */
  function tankCmH() {
    var t = D.tank(state);
    return t.cm ? t.cm * t.h / t.w : 45;
  }

  /* ---------- 3D 缩略图 ---------- */
  function iconURL(spec, w, h) {
    // 有外置模型的品种：缩略图直接用预渲染 PNG 的文件路径。
    // file:// 下把本地 PNG 画进 canvas 会污染画布，toDataURL 抛错导致图标空白，
    // 直路径的 <img> 在 http 与 file 下都可靠，也不再依赖 toDataURL。
    if (spec.model) {
      /* 共用基础品种 GLB 的培育品种（斗鱼·烈焰红 / 月光白）在展示台靠 shader
       * 双色重映射区分，列表静态图标则用 make_thumbs.py 派生的染色 PNG。
       * 独立 GLB 的品种（黑摩尔 / 大正三色 / 孔雀鱼礼服等）贴图自带正确颜色，不走这里。 */
      var baseId = spec.variantOf || spec.breedGroup;
      var bsp = baseId ? D.get(baseId) : null;
      if (spec.breedGroup && bsp && bsp.model && bsp.model.file === spec.model.file) {
        return 'models/thumbs/' + spec.model.file + '__' + spec.id + '.png' +
          (window.AW_MODEL_VER ? '?v=' + window.AW_MODEL_VER : '');
      }
      return 'models/thumbs/' + spec.model.file + '.png' +
        (window.AW_MODEL_VER ? '?v=' + window.AW_MODEL_VER : '');
    }
    // 有预渲染静态图的品种直接走图片，不必触发 WebGL 离屏渲染
    var hasStatic = spec.model && R && R.hasIcon && R.hasIcon(spec.model.file);
    // 缩略图缺失时先补画一张，否则会拿到占位空图并永久缓存
    if (!hasStatic && R && R.thumbState) {
      var st = R.thumbState(spec.id);
      if ((st === 'undefined' || st === 'null') && R.redrawThumb) R.redrawThumb(spec);
    }
    var key = spec.id + '_' + w + 'x' + h + '_' + (window.__thumbVer || 0);
    if (iconCache[key]) return iconCache[key];
    var cv = document.createElement('canvas');
    R.drawIcon(cv, spec, w, h);
    try { iconCache[key] = cv.toDataURL('image/png'); }
    catch (e) { iconCache[key] = ''; }
    return iconCache[key];
  }

  /* 色型/鳍型选择 → 变体品种 id；默认组合就是原品种 */
  function variantIdOf(sp, pick) {
    if (!sp.vColors && !sp.vFins) return sp.id;
    var ci = pick.color || 0, fi = pick.fin || 0;
    if (!ci && !fi) return sp.id;
    /* 与 species.js 的 buildVariants 保持一致：非默认组合一律带上色型段，
     * 即 base + '__' + 色型key + （非默认鳍时）'_' + 鳍key。
     * 之前漏了色型段，算成 zebra_lf，而实际 id 是 zebra__wild_lf，点击完全查不到。 */
    var cKey = sp.vColors ? (sp.vColors[ci] || sp.vColors[0]).key : 'std';
    var id = sp.id + '__' + cKey;
    if (sp.vFins && fi > 0) id += '_' + sp.vFins[fi].key;
    return id;
  }
  function chipRow(label, list, pick, axis, baseId) {
    if (!list || list.length < 2) return '';
    var html = '<div class="chip-row"><span class="chip-lab">' + label + '</span>';
    list.forEach(function (o, i) {
      html += '<button class="chip' + (i === (pick[axis] || 0) ? ' on' : '') + '" data-pick="' + baseId +
        '" data-axis="' + axis + '" data-i="' + i + '">' + esc(o.name) + '</button>';
    });
    return html + '</div>';
  }

  /* ---------- 商店 ---------- */
  function decorCount(sp) {
    return SIM.decorList(state, sp.id === 'driftwood' ? 'wood' : 'rock').length;
  }
  function renderShop() {
    // 有外置 3D 模型的品种排前面（sort 是稳定排序，同组内维持原顺序）
    var all = (TABS[shopTab] || []).slice().sort(function (x, y) {
      return (x.model ? 0 : 1) - (y.model ? 0 : 1);
    });
    var list = filterList(all, shopQuery);
    if (!list.length) {
      $('shopList').innerHTML = emptyHint(shopQuery);
      $('shopHint').textContent = HINTS[shopTab] || '';
      return;
    }
    $('shopList').innerHTML = list.map(function (sp) {
      var isDecor = !!sp.decor;
      var n = isDecor ? decorCount(sp) : 0;
      var owned = sp.kind === 'gear' && !isDecor && state.equipment[sp.id];
      var tags = (sp.tags || [sp.tag]).slice(0, 4).map(function (t, i) {
        return '<span class="tag' + (t.indexOf('强') >= 0 || t.indexOf('领域') >= 0 || t.indexOf('爆') >= 0 ? ' warn' : i > 2 ? ' plain' : '') + '">' + esc(t) + '</span>';
      }).join('');
      if (sp.kind === 'gear') {
        if (isDecor) {
          tags += '<span class="tag' + (n ? '' : ' plain') + '">已摆 ' + n + ' / ' + SIM.decorMax + ' 件</span>';
        } else {
          var gOn = sp.id === 'filter' ? state.filterOn : sp.id === 'light' ? state.lightOn :
            sp.id === 'heater' ? state.heaterOn : sp.id === 'air' ? state.airOn :
              !!(state.decorOn && state.decorOn[sp.id]);
          tags += '<span class="tag' + (owned && gOn ? '' : ' plain') + '">' +
            (owned ? (gOn ? '运行中' : '已关闭') : '未安装') + '</span>';
        }
      }
      var chips = '';
      var buyId = sp.id, price = sp.price;
      if (sp.kind === 'fish' && (sp.vColors || sp.vFins)) {
        var pick = shopPick[sp.id] || (shopPick[sp.id] = { color: 0, fin: 0 });
        chips = chipRow('色型', sp.vColors, pick, 'color', sp.id) + chipRow('鳍型', sp.vFins, pick, 'fin', sp.id);
        buyId = variantIdOf(sp, pick);
        var vs = D.get(buyId);
        if (vs) price = vs.price;
      }
      var afford = state.coins >= price;
      var btn;
      if (isDecor) {
        /* 造景件可以反复购买：每次都由 addDecor 生成一件随机大小/形状的个体 */
        btn = '<button class="buy-btn" data-buy="' + buyId + '"' +
          (afford && n < SIM.decorMax ? '' : ' disabled') + '>' +
          (n ? '再添一件' : '添加一件') + '</button>';
      } else {
        btn = owned
          ? '<button class="buy-btn owned-btn" disabled>已安装</button>'
          : '<button class="buy-btn" data-buy="' + buyId + '"' + (afford ? '' : ' disabled') + '>' + (sp.kind === 'gear' ? '安装' : '入缸') + '</button>';
      }
      var sizeNote = '';
      if (isDecor && n) {
        var last = SIM.decorList(state, sp.id === 'driftwood' ? 'wood' : 'rock')[n - 1];
        sizeNote = '<div class="shop-size">最近一件约 ' + last.cm + ' cm · 随机造型</div>';
      }
      return '<div class="shop-card' + (owned ? ' owned' : '') + '">' +
        '<img class="shop-thumb" src="' + iconURL(sp, 66, 52) + '" alt="">' +
        '<div class="shop-info"><div class="shop-title"><b>' + esc(sp.name) + '</b>' +
        (sp.latin ? '<i>' + esc(sp.latin) + '</i>' : (sp.en ? '<i>' + esc(sp.en) + '</i>' : '')) + '</div>' +
        '<div class="tag-row">' + tags + '</div>' + chips +
        '<div class="shop-desc">' + esc(sp.desc) + '</div>' + sizeNote +
        '<div class="shop-buy"><span class="price">' + price + ' 币</span>' + btn + '</div></div></div>';
    }).join('');
    $('shopHint').textContent = HINTS[shopTab] || '';
  }

  /* ---------- 设备 / 指标 ---------- */
  var GEAR_LABELS = { light: '水草灯', filter: '过滤器', heater: '加热棒', air: '气泵', driftwood: '沉木', rocks: '石景' };
  function gearOn(k) {
    if (k === 'light') return !!state.lightOn;
    if (k === 'filter') return !!state.filterOn;
    if (k === 'heater') return !!state.heaterOn;
    if (k === 'air') return !!state.airOn;
    return !!(state.decorOn && state.decorOn[k]);
  }
  function renderGearBar() {
    var keys = ['light', 'filter', 'heater', 'air', 'driftwood', 'rocks'];
    var html = '<span class="gear-label">设备</span>';
    keys.forEach(function (k) {
      /* 沉木 / 青龙石在分类上已从设备独立成「造景」，工具条也用分隔标出来 */
      if (k === 'driftwood') html += '<span class="gear-sep"></span><span class="gear-label">造景</span>';
      var has = !!state.equipment[k], on = gearOn(k);
      html += '<button class="gear-btn ' + (has ? (on ? 'on' : '') : 'locked') + '" data-gear="' + k + '">' +
        '<span class="dot"></span>' + GEAR_LABELS[k] + (has ? (on ? ' 开' : ' 关') : ' +') + '</button>';
    });
    html += '<span class="gear-sep"></span><span class="gear-label">光强</span>' +
      '<select class="mini-select" id="lightLevel">' +
      '<option value="0.18">微光</option><option value="0.35">弱</option>' +
      '<option value="0.62">中</option><option value="1">强</option>' +
      '<option value="1.25">极强</option></select>' +
      '<span class="gear-label">水温</span>' +
      '<select class="mini-select" id="targetTemp"><option value="22">22℃</option><option value="24">24℃</option><option value="26">26℃</option><option value="28">28℃</option></select>';
    $('gearBar').innerHTML = html;
    $('lightLevel').value = String(state.lightLevel);
    var tsel = $('targetTemp');
    tsel.value = String(state.targetTemp);
    if (tsel.value !== String(state.targetTemp)) {
      var o = document.createElement('option');
      o.value = String(state.targetTemp); o.textContent = Math.round(state.targetTemp) + '℃';
      tsel.appendChild(o); tsel.value = String(state.targetTemp);
    }
  }

  function syncGearBar() {
    Array.prototype.forEach.call($('gearBar').querySelectorAll('[data-gear]'), function (b) {
      var k = b.getAttribute('data-gear'), has = !!state.equipment[k], on = gearOn(k);
      b.className = 'gear-btn ' + (has ? (on ? 'on' : '') : 'locked');
      b.innerHTML = '<span class="dot"></span>' + GEAR_LABELS[k] + (has ? (on ? ' 开' : ' 关') : ' +');
    });
  }

  function renderEnvGrid() {
    var defs = [
      { k: 'water', n: '综合水质', note: '氨氮 / 硝酸盐 / 浑浊' },
      { k: 'oxygen', n: '溶氧', note: '水草光合与气泵供氧' },
      { k: 'temp', n: '水温', note: '各品种适温不同' },
      { k: 'algae', n: '藻类', note: '强光与硝酸盐助长' },
      { k: 'load', n: '生物负载', note: '过滤 / 增氧 / 水草扩容' }
    ];
    $('envGrid').innerHTML = defs.map(function (d) {
      return '<div class="env-card" data-env="' + d.k + '"><div class="env-top"><span>' + d.n + '</span><b>--</b></div>' +
        '<div class="env-bar"><i style="width:0%"></i></div><div class="env-note">' + d.note + '</div></div>';
    }).join('');
  }

  function syncEnv(env) {
    var vals = {
      water: { v: env.water, txt: env.water + ' 分', w: env.water, c: barColor(env.water), note: '氨 ' + env.ammonia + ' · 硝酸盐 ' + env.nitrate },
      oxygen: { v: env.oxygen, txt: env.oxygen + '%', w: env.oxygen, c: barColor(env.oxygen), note: env.oxygen < 40 ? '偏低：鱼会浮头' : '水面交换 + 光合产氧' },
      temp: { v: env.temp, txt: env.temp.toFixed(1) + '℃', w: Math.max(4, 100 - Math.abs(env.temp - 24) * 9), c: barColor(100 - Math.abs(env.temp - 24) * 9), note: state.heaterOn ? '加热棒设定 ' + state.targetTemp + '℃' : '跟随室温波动' },
      algae: { v: env.algae, txt: env.algae + '%', w: env.algae, c: barColor(env.algae, true), note: env.algae > 55 ? '该擦缸或加食藻生物' : '缸壁藻膜' },
      load: { v: env.load, txt: env.load.toFixed(1) + '/' + env.capacity.toFixed(0), w: env.load / env.capacity * 100, c: barColor(100 - env.load / env.capacity * 90), note: env.load > env.capacity ? '超载！先扩容或减密' : '过滤 / 水草决定容量' }
    };
    Array.prototype.forEach.call($('envGrid').children, function (card) {
      var k = card.getAttribute('data-env'), o = vals[k];
      card.querySelector('b').textContent = o.txt;
      var i = card.querySelector('.env-bar i');
      i.style.width = Math.max(2, Math.min(100, o.w)) + '%'; i.style.background = o.c;
      var note = card.querySelector('.env-note');
      note.textContent = o.note;
      note.style.color = (k === 'algae' && o.v > 55) || (k === 'load' && o.v > env.capacity) || (k === 'oxygen' && o.v < 40) ? '#ffc98c' : '';
    });
  }

  /* ---------- 居民 / 详情 / 日志 ---------- */
  function residentSig() {
    return state.creatures.map(function (c) {
      return c.id + ':' + D.stageOf(c) + ':' + (c.name || '') + ':' + (c.disease || 0);
    }).join('|') + '#' + state.selected;
  }

  function renderResidents() {
    $('residentList').innerHTML = state.creatures.map(function (c) {
      var sp = D.get(c.specId), stage = D.stageOf(c);
      var sub = c.kind === 'plant' ? '株高 ' + Math.round(c.h * tankCmH()) + 'cm · 第 ' + Math.floor(c.ageDays) + ' 天'
        : c.sizeCm.toFixed(1) + 'cm · 第 ' + Math.floor(c.ageDays) + ' 天';
      var hp = Math.round(c.health * 100);
      var display = c.name ? esc(c.name) : esc(sp.name);
      var species = c.name ? esc(sp.name) + ' · ' : '';
      var flags = (c.disease ? '<span class="sick-tag">' + (c.disease >= 2 ? '重症' : '患病') + '</span>' : '') +
        (stage === '老年' ? '<span class="age-tag">老年</span>' : '');
      return '<div class="resident' + (state.selected === c.id ? ' sel' : '') + '" data-id="' + c.id + '">' +
        '<img src="' + iconURL(sp, 44, 31) + '" alt="" width="44" height="31">' +
        '<div class="res-info"><div class="res-name">' + display + '<em>' + stage + '</em>' + flags + '</div>' +
        '<div class="res-sub">' + species + sub + ' · ' + esc(c.behavior || '安顿中') + '</div></div>' +
        '<div class="res-hp"><small>' + hp + '%</small><i><b style="width:' + hp + '%;background:' + barColor(hp) + '"></b></i></div></div>';
    }).join('') || '<div class="empty-log">缸里空空的，去左边挑几位成员吧。</div>';
    $('residentCount').textContent = state.creatures.length + ' 位';
  }

  function syncResidentText() {
    Array.prototype.forEach.call($('residentList').children, function (row) {
      var id = row.getAttribute('data-id');
      if (!id) return;
      var c = SIM.find(state, id), sp = c && D.get(c.specId);
      if (!c || !sp) return;
      var sub = c.kind === 'plant' ? '株高 ' + Math.round(c.h * tankCmH()) + 'cm · 第 ' + Math.floor(c.ageDays) + ' 天'
        : c.sizeCm.toFixed(1) + 'cm · 第 ' + Math.floor(c.ageDays) + ' 天';
      var e = row.querySelector('.res-sub');
      if (e) e.textContent = sub + ' · ' + (c.behavior || '安顿中');
      var small = row.querySelector('.res-hp small'), b = row.querySelector('.res-hp b');
      var hp = Math.round(c.health * 100);
      if (small) small.textContent = hp + '%';
      if (b) { b.style.width = hp + '%'; b.style.background = barColor(hp); }
      var st = row.querySelector('.res-name em');
      if (st) st.textContent = D.stageOf(c);
    });
  }

  function row(k, v, key) { return '<div' + (key ? ' data-k="' + key + '"' : '') + '><span>' + k + '</span><b>' + esc(v) + '</b></div>'; }

  /* ---------- 图鉴 ---------- */
  var dexFilter = 'all', dexSel = null, dexPick = {};

  function dexPool() {
    /* 只收录基础品种：色型/鳍型变体不再单独占一行，
     * 改成选中后由展示台下方的芯片切换（否则同一条鱼会在列表里重复出现五六次）。 */
    var all = D.creatures.filter(function (sp) {
      return !sp.variantOf && (sp.kind === 'plant' || sp.model);
    });
    var list = dexFilter === 'all' ? all.slice() : all.filter(function (sp) { return sp.kind === dexFilter; });
    list = filterList(list, dexQuery);
    // 有外置 3D 模型的排前面（稳定排序，同组内维持原顺序）
    return list.sort(function (x, y) { return (x.model ? 0 : 1) - (y.model ? 0 : 1); });
  }
  function layerName(sp) {
    var m = (sp.layer[0] + sp.layer[1]) / 2;
    return m < .22 ? '上层' : m < .42 ? '中上层' : m < .62 ? '中层' : m < .82 ? '中下层' : '底层';
  }
  function dietNames(sp) {
    return (sp.diet || []).map(function (d) {
      var f = D.foods.filter(function (o) { return o.diet === d; })[0];
      return f ? f.name.replace(/饲料|颗粒|片/g, '') : d;
    }).join('、');
  }
  function breedName(sp) {
    var b = sp.breed; if (!b || b.mode === 'none') return '缸内不可繁殖';
    return { livebearer: '卵胎生，直接生小鱼', egg: '产卵繁殖', self: '雌雄同体，两只就能繁殖', pair: '需要配偶，繁殖较慢' }[b.mode] || '可繁殖';
  }
  function skillList(sp) {
    var arr = [];
    if (sp.labyrinth || sp.oxygenNeed < .3) arr.push('迷宫鳃：能到水面直接换气');
    if (sp.algaeEat > .5) arr.push('刮食缸壁藻膜');
    if (sp.leftover > .5) arr.push('清理沉底残饵');
    if (sp.plantBite > .3) arr.push('会啃食水草嫩叶');
    if (sp.finRisk > .6) arr.push('鳍漂亮但容易被咬');
    if (sp.territory) arr.push('强领域性，不可同种混养');
    if (sp.hardiness > .85) arr.push('皮实好养');
    if (sp.hardiness < .3) arr.push('娇贵，对水质敏感');
    return arr;
  }
  function dexInfoHTML(sp) {
    var rows = '';
    if (sp.kind === 'fish') {
      rows += row('体型族', (D.bodyShapes[D.shapeOf(sp)] || {}).name || '—');
      rows += row('成体尺寸', sp.size[1] + ' – ' + sp.size[2] + ' cm');
      rows += row('寿命', '约 ' + Math.round(sp.lifespan / 28) + ' 个月（' + sp.lifespan + ' 模拟天）');
      rows += row('适温', sp.temp[0] + ' – ' + sp.temp[1] + ' ℃');
      rows += row('活动水层', layerName(sp));
      rows += row('食性', dietNames(sp));
      rows += row('群游性', sp.schooling > .75 ? '强，成群才安心' : sp.schooling > .4 ? '中等' : sp.schooling > 0 ? '弱' : '独来独往');
      rows += row('繁殖', breedName(sp));
      rows += row('含氧需求', sp.oxygenNeed > .7 ? '高，需要好过滤或气泵' : sp.oxygenNeed > .45 ? '中等' : '低，耐低氧');
      rows += row('生物负载', sp.bioload >= 2 ? '大，需要大水体' : sp.bioload >= .8 ? '中等' : '小');
    } else if (sp.kind === 'plant') {
      rows += row('生长速度', sp.growth > .035 ? '速生，几天就见长' : sp.growth < .01 ? '极慢，一周动一点' : '中等');
      rows += row('成熟高度', Math.round(sp.maxH * tankCmH()) + ' cm');
      rows += row('需光', sp.lightNeed > .65 ? '强光（阳性草）' : sp.lightNeed > .35 ? '中光' : '低光可活（阴性草）');
      rows += row('需肥', sp.nutrientNeed > .7 ? '重肥，建议水草泥' : sp.nutrientNeed > .4 ? '中等' : '要求不高');
      rows += row('种法', sp.floating ? '漂浮水面，无需底砂' : sp.root ? '扎根底砂' : '绑在沉木/石上或随意放置');
      rows += row('功能', (sp.oxygen > .6 ? '产氧强 · ' : '') + (sp.uptake > .6 ? '吸硝酸盐强 · ' : '') + (sp.shade > .5 ? '会遮光' : '不遮光'));
    } else {
      rows += row('除藻能力', sp.algae > .6 ? '强' : sp.algae > .25 ? '中等' : '弱');
      rows += row('清残饵', sp.leftover > .5 ? '在行' : sp.leftover > .15 ? '会顺手吃一点' : '基本不吃');
      rows += row('繁殖', breedName(sp));
      rows += row('寿命', '约 ' + Math.round(sp.lifespan / 28) + ' 个月');
      rows += row('适温', sp.temp[0] + ' – ' + sp.temp[1] + ' ℃');
    }
    var skills = skillList(sp);
    var html = '<div class="dex-head"><b>' + esc(sp.name) + '</b>' +
      (sp.latin ? '<i>' + esc(sp.latin) + '</i>' : '') +
      (state.dex && state.dex[sp.id] ? '<span class="tag">已收录</span>' : '<span class="tag plain">未收录</span>') + '</div>' +
      '<div class="tag-row">' + (sp.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>' +
      '<p class="dex-desc">' + esc(sp.desc || '') + '</p>' +
      '<div class="dex-rows">' + rows + '</div>' +
      (skills.length ? '<div class="dex-skills">' + skills.map(function (s) { return '<span>' + esc(s) + '</span>'; }).join('') + '</div>' : '') +
      '<div class="dex-price">参考价 <b>' + sp.price + '</b> 贝壳币</div>';
    return html;
  }
  function dexVariantChips(sp) {
    if (sp.kind !== 'fish' || (!sp.vColors && !sp.vFins)) { $('dexVarChips').innerHTML = ''; return; }
    var pick = dexPick[sp.variantOf || sp.id] || (dexPick[sp.variantOf || sp.id] = { color: 0, fin: 0 });
    var base = sp.variantOf ? D.get(sp.variantOf) : sp;
    var html = '';
    if (base.vColors) {
      html += '<span class="chip-lab">色型</span>';
      base.vColors.forEach(function (c, i) {
        html += '<button class="chip' + (i === pick.color ? ' on' : '') + '" data-dexvar="color" data-i="' + i + '">' + esc(c.name) + '</button>';
      });
    }
    if (base.vFins) {
      html += '<span class="chip-lab">鳍型</span>';
      base.vFins.forEach(function (f, i) {
        html += '<button class="chip' + (i === pick.fin ? ' on' : '') + '" data-dexvar="fin" data-i="' + i + '">' + esc(f.name) + '</button>';
      });
    }
    $('dexVarChips').innerHTML = html;
  }
  /* 从某个变体反查它对应的色型/鳍型下标，这样从商店、居民卡跳进图鉴也能对上芯片 */
  function pickOfVariant(base, sp) {
    if (!sp || !sp.variantOf || !base || !base.vColors) return null;
    var fins = base.vFins || [];
    for (var ci = 0; ci < base.vColors.length; ci++) {
      for (var fi = 0; fi < Math.max(1, fins.length); fi++) {
        if (variantIdOf(base, { color: ci, fin: fi }) === sp.id) return { color: ci, fin: fi };
      }
    }
    return null;
  }
  function selectDex(id) {
    var sp0 = D.get(id);
    if (!sp0) return;
    var baseId = sp0.variantOf || sp0.id;
    var base = D.get(baseId) || sp0;
    dexSel = baseId;                       // 列表选中态永远落在基础品种上
    var pick = dexPick[baseId] || (dexPick[baseId] = { color: 0, fin: 0 });
    var pv = pickOfVariant(base, sp0);
    if (pv) { pick.color = pv.color; pick.fin = pv.fin; }
    var view = D.get(variantIdOf(base, pick)) || base;
    renderDexList();
    dexVariantChips(base);
    $('dexInfo').innerHTML = dexInfoHTML(view);
    R.viewerShow(view.id);
  }
  function renderDexList() {
    $('dexList').innerHTML = dexPool().map(function (sp) {
      var owned = state.dex && state.dex[sp.id];
      return '<div class="dex-item' + (dexSel === sp.id ? ' sel' : '') + '" data-dexid="' + sp.id + '">' +
        '<img src="' + iconURL(sp, 56, 42) + '" alt="" width="56" height="42">' +
        '<span>' + esc(sp.name) + (owned ? '<em class="own-dot" title="已收录"></em>' : '') +
        (sp.model ? '<i class="mdl-badge" title="外置 3D 模型">3D</i>' : '') + '</span></div>';
    }).join('') || emptyHint(dexQuery || '这个分类');
    var pool = dexPool();
    var owned = pool.filter(function (sp) { return state.dex && state.dex[sp.id]; }).length;
    $('dexCount').textContent = '已收录 ' + owned + ' / ' + pool.length + ' 种' +
      (dexQuery ? '（搜索结果）' : '');
  }
  function openDex() {
    R.viewerAttach($('dexCanvas'));
    if (!dexSel || !D.get(dexSel)) dexSel = D.fish[0].id;
    renderDexList();
    selectDex(dexSel);
    $('dexModal').hidden = false;
    R.viewerShow(dexSel);   // 弹窗展开后再刷新一次尺寸
  }

  /* 体重来自体长-体重关系 W = a·L^b；体型族决定截面轮廓 */
  function weightText(c) {
    var g = SIM.weight(c);
    if (!g) return '—';
    return g < 10 ? g.toFixed(1) + ' g' : Math.round(g) + ' g';
  }
  function shapeName(c) {
    var key = SIM.shapeOf(c), bs = D.bodyShapes && D.bodyShapes[key];
    return bs ? bs.name : '—';
  }

  function renderDetail() {
    var c = state.selected && SIM.find(state, state.selected);
    if (!c) {
      $('detailCard').innerHTML = '<div class="detail-empty">切到「观察点选」再点缸里的鱼，或在上面列表选一位成员，<br>就能看到它的习性、生长阶段、当前估价，还能给它取名。</div>';
      lastDetailKey = '';
      return;
    }
    var sp = D.get(c.specId), stage = D.stageOf(c);
    var key = c.id + '|' + stage + '|' + (c.disease || 0) + '|' + (c.name || '') + '|' + c.kind;
    if (key === lastDetailKey) { updateDetailValues(c, sp); return; }
    lastDetailKey = key;

    var tags = (sp.tags || [sp.tag] || []).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('');
    var rows = '';
    if (c.kind === 'plant') {
      rows += row('株高', Math.round(c.h * tankCmH()) + ' cm / ' + Math.round(sp.maxH * tankCmH()) + ' cm', 'size');
      rows += row('生长速度', sp.growth > .035 ? '速生' : sp.growth < .01 ? '极慢' : '中等');
      rows += row('需光', sp.lightNeed > .65 ? '强光' : sp.lightNeed > .35 ? '中光' : '低光可活');
      rows += row('黄化程度', Math.round(c.yellow * 100) + '%', 'yellow');
    } else {
      rows += row('体长', c.sizeCm.toFixed(1) + ' cm', 'size');
      rows += row('体重', weightText(c), 'weight');
      rows += row('体型', shapeName(c), 'shape');
      rows += row('年龄 / 寿命', Math.floor(c.ageDays) + ' / ' + Math.round(sp.lifespan) + ' 天', 'age');
      rows += row('饱食度', Math.round(c.hunger * 100) + '%', 'hunger');
      rows += row('健康', Math.round(c.health * 100) + '%', 'health');
      rows += row('状态', c.disease ? (c.disease >= 2 ? '重症' : '轻症') : '健康', 'disease');
    }
    var q = SIM.appraise(state, c);
    var nameVal = c.name ? esc(c.name) : '';
    $('detailCard').innerHTML =
      '<div class="detail-head"><b>' + (c.name ? esc(c.name) : esc(sp.name)) + '</b>' +
      '<span>' + esc(sp.name) + ' · ' + stage + '</span>' +
      (c.disease ? '<span class="sick-tag">' + (c.disease >= 2 ? '重症' : '患病') + '</span>' : '') +
      (stage === '老年' ? '<span class="age-tag">老年</span>' : '') + '</div>' +
      '<div class="detail-tags">' + tags + '</div><div class="detail-grid">' + rows + '</div>' +
      '<div class="detail-behavior">此刻：' + esc(c.behavior || '正在安顿') + '</div>' +
      '<div class="name-row"><input id="nameInput" maxlength="12" placeholder="给它取个名字" value="' + nameVal + '">' +
      '<button data-act="rename">命名</button></div>' +
      '<div class="sell-box"><div class="sell-info"><span>当前估价 · ' + q.season + '季</span>' +
      '<b>' + q.price + ' 币</b><small>' + q.stage + ' · 健康 ' + Math.round(c.health * 100) + '% · 行情 ' + Math.round(q.seasonF * 100) + '%</small></div>' +
      '<button data-act="sell">卖出</button></div>' +
      '<div class="detail-actions">' + (c.kind === 'plant' ? '<button data-act="trim">修剪（+4 币）</button>' : '') +
      '<button data-act="focus">切到点选模式</button></div>';
  }

  function updateDetailValues(c, sp) {
    var card = $('detailCard');
    var bh = card.querySelector('.detail-behavior');
    if (bh) bh.textContent = '此刻：' + (c.behavior || '正在安顿');
    Array.prototype.forEach.call(card.querySelectorAll('[data-k]'), function (r) {
      var k = r.getAttribute('data-k'), v = '';
      if (k === 'size') v = c.kind === 'plant' ? Math.round(c.h * tankCmH()) + ' cm / ' + Math.round(sp.maxH * tankCmH()) + ' cm' : c.sizeCm.toFixed(1) + ' cm';
      else if (k === 'weight') v = weightText(c);
      else if (k === 'shape') v = shapeName(c);
      else if (k === 'age') v = Math.floor(c.ageDays) + ' / ' + Math.round(sp.lifespan) + ' 天';
      else if (k === 'hunger') v = Math.round(c.hunger * 100) + '%';
      else if (k === 'health') v = Math.round(c.health * 100) + '%';
      else if (k === 'disease') v = c.disease ? (c.disease >= 2 ? '重症' : '轻症') : '健康';
      else if (k === 'yellow') v = Math.round((c.yellow || 0) * 100) + '%';
      var b = r.querySelector('b');
      if (b) b.textContent = v;
    });
    var q = SIM.appraise(state, c);
    var price = card.querySelector('.sell-info b');
    var note = card.querySelector('.sell-info small');
    if (price) price.textContent = q.price + ' 币';
    if (note) note.textContent = q.stage + ' · 健康 ' + Math.round(c.health * 100) + '% · 行情 ' + Math.round(q.seasonF * 100) + '%';
  }

  function renderLog() {
    var key = state.events.length + ':' + (state.events[0] ? state.events[0].text : '');
    if (key === lastLogKey) return;
    lastLogKey = key;
    $('logList').innerHTML = state.events.slice(0, 14).map(function (e) {
      return '<div class="log-item ' + (e.type || '') + '"><time>D' + e.day + ' ' + e.time + '</time><span>' + esc(e.text) + '</span></div>';
    }).join('') || '<div class="empty-log">还没有故事发生。</div>';
  }

  function syncTop(env) {
    $('dayLabel').textContent = '第 ' + state.day + ' 天';
    $('seasonLabel').textContent = env.season.name;
    $('seasonLabel').title = env.season.desc + ' 活体行情 ' + Math.round(env.season.sell * 100) + '%';
    $('timeLabel').textContent = env.time;
    $('lightLabel').textContent = (env.isDay ? '白昼' : '夜间') + ' · 灯光' + (state.lightOn ? '开启' : '关闭') + ' · 光照 ' + Math.round(env.light * 100) + '%';
    $('coinValue').textContent = Math.floor(state.coins);
    $('pauseBtn').textContent = state.paused ? '继续' : '暂停';
    $('pauseBtn').classList.toggle('on', state.paused);
    Array.prototype.forEach.call($('speedGroup').children, function (b) {
      b.classList.toggle('active', Number(b.getAttribute('data-speed')) === state.speed);
    });
    var warn = env.oxygen < 40 ? '溶氧不足 · 鱼在浮头' : env.ammonia > 32 ? '氨氮偏高 · 需要换水' : env.algae > 65 ? '藻类爆发 · 建议擦缸' : '';
    $('tankBadge').textContent = warn || ('第 ' + state.day + ' 天 · ' + env.time + ' · ' + env.temp.toFixed(1) + '℃ · ' + state.creatures.length + ' 位居民');
    $('tankBadge').style.color = warn ? '#ffd9a0' : '';
  }

  function updateUI(force) {
    var env = SIM.getEnv(state);
    syncTop(env); syncEnv(env); syncGearBar();
    var sig = residentSig();
    if (force || sig !== lastSig) { lastSig = sig; renderResidents(); renderShop(); }
    else syncResidentText();
    renderDetail(); renderLog();
  }

  /* ---------- 设置面板 ---------- */
  function renderSettings() {
    var env = SIM.getEnv(state);
    var curTank = D.tank(state);
    /* 三个滑块：值来自 state.tankDims（厘米），实时显示体积与负载容量 */
    var dims = state.tankDims || { l: 90, w: 30, h: 37 };
    [['tankL', 'l'], ['tankW', 'w'], ['tankH', 'h']].forEach(function (p) {
      var el = $(p[0]); if (!el) return;
      el.value = dims[p[1]];
      var out = $(p[0] + 'v'); if (out) out.textContent = dims[p[1]];
    });
    var litres = Math.round(curTank.cm * curTank.cmw * curTank.cmh / 1000);
    if ($('tankInfo')) {
      $('tankInfo').textContent = '当前 ' + curTank.name + ' · 约 ' + litres + ' 升 · 负载容量 '
        + Math.round(curTank.cap * 100) + '%';
    }
    var ownedSubs = state.subOwned || ['sand'];
    $('subOptions').innerHTML = D.substrates.map(function (sub) {
      var cur = state.substrate === sub.id;
      var owned = ownedSubs.indexOf(sub.id) >= 0;
      var priceTxt = cur ? '' : (owned ? '已拥有' : sub.price + ' 币');
      return '<button class="option-card' + (cur ? ' on' : '') + '" data-sub="' + sub.id + '">' +
        '<b>' + sub.name + (cur ? '<em>使用中</em>' : '') + '<i>' + priceTxt + '</i></b>' +
        '<span>' + sub.desc + '</span></button>';
    }).join('');
    Array.prototype.forEach.call($('viewOptions').children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-view') === (state.viewMode || '3d'));
    });
    /* 布景：底砂地形 / 石头 / 自动化管家 */
    var aq = state.aqua || { slope: 'flat', rock: {} };
    var slopeDefs = [['flat', '平坦床面'], ['riseL', '左高右低'], ['riseR', '右高左低'], ['mound', '中央沙丘'], ['valley', '两高夹谷']];
    $('slopeOptions').innerHTML = slopeDefs.map(function (d) {
      return '<button class="option-card slim' + (aq.slope === d[0] ? ' on' : '') + '" data-slope="' + d[0] + '"><b>' + d[1] + '</b></button>';
    }).join('');
    $('scapeOptions').innerHTML = (SIM.scapes || []).map(function (sc) {
      return '<button class="chip" data-scape="' + sc.id + '">' + sc.name + '</button>';
    }).join('') + '<button class="chip" data-scape="random">随机</button>';
    var rk = aq.rock || {};
    var styleDefs = [['pebble', '鹅卵石'], ['angular', '棱角碎石'], ['slate', '板岩叠层']];
    $('rockStyles').innerHTML = styleDefs.map(function (d) {
      return '<button class="chip' + (rk.style === d[0] ? ' on' : '') + '" data-rockstyle="' + d[0] + '">' + d[1] + '</button>';
    }).join('');
    var colorDefs = [['#46595c', '灰青'], ['#6b5645', '暖褐'], ['#2e3336', '墨黑'], ['#7a4a3d', '赤红'], ['#b9b6ab', '白玉']];
    $('rockColors').innerHTML = colorDefs.map(function (d) {
      return '<button class="swatch' + (rk.color === d[0] ? ' on' : '') + '" data-rockcolor="' + d[0] + '" style="background:' + d[0] + '" title="' + d[1] + '"></button>';
    }).join('');
    $('rockSize').value = String(rk.size || 1);
    $('rockCount').value = String(rk.count || 4);
    var au = state.auto || {};
    function onOf(k) { return au[k] && au[k].on ? ' checked' : ''; }
    var feedSel = au.feed || {}, waterSel = au.water || {};
    var feedIds = feedSel.foodIds && feedSel.foodIds.length ? feedSel.foodIds : [feedSel.foodId || 'flake'];
    var foodChips = D.foods.map(function (f) {
      var on = feedIds.indexOf(f.id) >= 0;
      return '<button class="chip' + (on ? ' on' : '') + '" data-feedfood="' + f.id + '" title="' + f.desc + '">' + f.name + '</button>';
    }).join('');
    $('autoOptions').innerHTML =
      '<div class="auto-row"><label><input type="checkbox" data-auto="feed"' + onOf('feed') + '> 自动喂食</label>' +
      '<span class="auto-opts"><select class="mini-select" data-feedevery>' +
      '<option value="480"' + (feedSel.every === 480 ? ' selected' : '') + '>每 8 小时</option>' +
      '<option value="720"' + (!feedSel.every || feedSel.every === 720 ? ' selected' : '') + '>每 12 小时</option>' +
      '<option value="1440"' + (feedSel.every === 1440 ? ' selected' : '') + '>每天一次</option>' +
      '</select></span></div>' +
      '<div class="auto-foods"><span class="auto-note">饲料（可多选）</span>' + foodChips + '</div>' +
      '<div class="auto-row"><label><input type="checkbox" data-auto="water"' + onOf('water') + '> 自动换水</label>' +
      '<span class="auto-opts"><select class="mini-select" data-waterevery>' +
      '<option value="3"' + (waterSel.everyDays === 3 ? ' selected' : '') + '>每 3 天</option>' +
      '<option value="5"' + (!waterSel.everyDays || waterSel.everyDays === 5 ? ' selected' : '') + '>每 5 天</option>' +
      '<option value="7"' + (waterSel.everyDays === 7 ? ' selected' : '') + '>每 7 天</option>' +
      '</select></span></div>' +
      '<div class="auto-row"><label><input type="checkbox" data-auto="scrub"' + onOf('scrub') + '> 自动擦藻</label><span class="auto-note">每 4 天巡一遍，藻多才擦</span></div>' +
      '<div class="auto-row"><label><input type="checkbox" data-auto="light"' + onOf('light') + '> 日照灯光</label><span class="auto-note">6:00–19:00 自动开关水草灯</span></div>' +
      '<div class="auto-row"><label><input type="checkbox" data-auto="air"' + onOf('air') + '> 智能增氧</label><span class="auto-note">溶氧偏低自动开气泵，需先安装气泵</span></div>' +
      '<div class="auto-row"><label><input type="checkbox" data-auto="treat"' + onOf('treat') + '> 自动下药</label><span class="auto-note">发现病鱼且贝壳币够时自动治疗</span></div>';
    $('seasonInfo').textContent = '第 ' + state.day + ' 天 · ' + env.season.name + '季：' + env.season.desc +
      ' 活体行情 ' + Math.round(env.season.sell * 100) + '%。当前 ' + D.tank(state).name +
      ' / ' + D.substrate(state.substrate).name + '。';
  }

  /* ---------- 侧栏（缸体两侧，不遮挡画面） ---------- */
  function scheduleResize() {
    R.resize();                       // 立即按当前尺寸重算
    setTimeout(function () { R.resize(); }, 330);   // 过渡结束后再校准一次
  }
  function closeDrawers() {
    $('shopDrawer').classList.remove('open');
    $('infoDrawer').classList.remove('open');
    $('shopBtn').classList.remove('on');
    $('residentBtn').classList.remove('on');
    scheduleResize();
  }
  function toggleDrawer(which) {
    var panel = which === 'shop' ? $('shopDrawer') : $('infoDrawer');
    var btn = which === 'shop' ? $('shopBtn') : $('residentBtn');
    var otherPanel = which === 'shop' ? $('infoDrawer') : $('shopDrawer');
    var otherBtn = which === 'shop' ? $('residentBtn') : $('shopBtn');
    if (panel.classList.contains('open')) { closeDrawers(); return; }
    otherPanel.classList.remove('open');
    otherBtn.classList.remove('on');
    panel.classList.add('open');
    btn.classList.add('on');
    scheduleResize();
  }

  /* ---------- 存档 ---------- */
  function save() {
    try {
      localStorage.setItem(SIM.SAVE_KEY, SIM.serialize(state));
      $('saveState').textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { $('saveState').textContent = '本机存储不可用，进度暂未保存'; }
  }

  function confirmBox(title, text, fn) {
    $('confirmTitle').textContent = title; $('confirmText').textContent = text;
    $('confirmModal').hidden = false;
    $('confirmOk').onclick = function () { $('confirmModal').hidden = true; fn(); };
  }

  /* ---------- 启动 ---------- */
  function boot() {
    var raw = null;
    try { raw = localStorage.getItem(SIM.SAVE_KEY); } catch (e) { }
    var loaded = SIM.load(raw);
    state = loaded || SIM.create();
    if (loaded && state.lastReal) {
      var gap = (Date.now() - state.lastReal) / 1000;
      if (gap > 60) {
        var mins = Math.min(2880, gap * 20);
        var wasPaused = state.paused; state.paused = false;
        SIM.fastForward(state, mins / (20 * state.speed));
        state.paused = wasPaused;
        SIM.pushEvent(state, '你离开的这段时间里，缸里自己过了 ' + Math.max(1, Math.round(mins / 1440)) + ' 天。');
        toast('欢迎回来，水族箱自己过了 ' + Math.max(1, Math.round(mins / 1440)) + ' 天');
      }
    }
    if (!state.pointer) state.pointer = { x: .5, y: .5, active: false };
    if (!state.mode) state.mode = 'feed';

    $('foodSelect').innerHTML = D.foods.map(function (f) { return '<option value="' + f.id + '">' + f.name + '</option>'; }).join('');
    function syncFoodDesc() { var f = D.food($('foodSelect').value); $('foodDesc').textContent = f ? f.desc : ''; }
    $('foodSelect').addEventListener('change', syncFoodDesc); syncFoodDesc();

    R.attach($('tank'), state);
    R.on({
      feed: function (nx) {
        var r = SIM.feed(state, $('foodSelect').value, nx);
        if (!r.ok) toast(r.msg);
        save();
      },
      select: function (id) { state.selected = id || null; updateUI(true); save(); },
      layout: function (id, nx, nz, final) {
        SIM.setCreaturePos(state, id, nx, nz);
        if (final) save();
      },
      layoutRock: function (idx, nx, nz, final) {
        SIM.setRockPos(state, idx, nx, nz);
        if (final) save();
      },
      /* 商店造景 tab 买到的独立个体：落点写回 decorItems，不占用设置面板那组石头的槽位 */
      layoutDecor: function (kind, idx, nx, nz, final) {
        SIM.setDecorPos(state, kind, idx, nx, nz);
        if (final) save();
      },
      modelsLoaded: function () {
        try { if (window.__perf) __perf.marks.modelsReady = Math.round(performance.now() - __perf.t0); } catch (e) { }
        iconCache = {};          // GLB 加载完成：清掉程序化兜底缩略图缓存并重绘
        updateUI(true);
        if (dexSel && !$('dexModal').hidden) { renderDexList(); selectDex(dexSel); }
      },
      view: function (az, el, zoom) {
        var key = az + '/' + el + '/' + zoom.toFixed(2);
        if (key === lastView) return;
        lastView = key;
        $('viewTip').textContent = '方位 ' + az + '° · 俯仰 ' + el + '° · ' + zoom.toFixed(2) + '×';
      }
    });

    renderEnvGrid(); renderGearBar(); renderShop(); updateUI(true);

    /* 侧栏开关（工具条按钮） */
    $('shopBtn').addEventListener('click', function () { toggleDrawer('shop'); });
    $('residentBtn').addEventListener('click', function () { toggleDrawer('info'); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-drawer-close]'), function (b) {
      b.addEventListener('click', closeDrawers);
    });

    /* 图鉴 */
    $('dexBtn').addEventListener('click', openDex);
    $('dexModal').addEventListener('click', function (e) {
      if (e.target === this || e.target.closest('[data-close]')) { this.hidden = true; return; }
      var t = e.target.closest('[data-dex]');
      if (t) {
        dexFilter = t.getAttribute('data-dex');
        Array.prototype.forEach.call($('dexTabs').children, function (x) { x.classList.toggle('active', x === t); });
        renderDexList();
        return;
      }
      var item = e.target.closest('[data-dexid]');
      if (item) { selectDex(item.getAttribute('data-dexid')); return; }
      var chip = e.target.closest('[data-dexvar]');
      if (chip) {
        var sp = D.get(dexSel);
        var baseId = (sp && (sp.variantOf || sp.id)) || dexSel;
        var pick = dexPick[baseId] || (dexPick[baseId] = { color: 0, fin: 0 });
        pick[chip.getAttribute('data-dexvar')] = Number(chip.getAttribute('data-i')) || 0;
        var base = D.get(baseId);
        var vid = variantIdOf(base, pick);
        if (D.get(vid)) selectDex(vid);
      }
    });
    /* 搜索框作用于「当前 tab」，切换 tab 时保留关键词，方便跨类目比对 */
    $('shopSearch').addEventListener('input', function () { shopQuery = this.value; renderShop(); });
    $('dexSearch').addEventListener('input', function () { dexQuery = this.value; renderDexList(); });
    $('shopTabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]'); if (!b) return;
      shopTab = b.getAttribute('data-tab');
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); });
      renderShop();
    });
    $('shopList').addEventListener('click', function (e) {
      var chip = e.target.closest('[data-pick]');
      if (chip) {
        var baseId = chip.getAttribute('data-pick');
        var pick = shopPick[baseId] || (shopPick[baseId] = { color: 0, fin: 0 });
        pick[chip.getAttribute('data-axis')] = Number(chip.getAttribute('data-i')) || 0;
        renderShop();
        return;
      }
      var b = e.target.closest('[data-buy]'); if (!b) return;
      var r = SIM.addCreature(state, b.getAttribute('data-buy'));
      result(r);
      /* 造景件是新增几何，addDecor 返回 rebuild:true，必须重建静态组才会立刻出现在缸里 */
      if (r.ok) { if (r.rebuild) R.rebuild(state); updateUI(true); save(); } else renderShop();
    });
    $('residentList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-id]'); if (!row) return;
      state.selected = row.getAttribute('data-id'); updateUI(true); save();
    });
    $('detailCard').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'trim') { result(SIM.trimPlant(state, state.selected)); updateUI(true); save(); return; }
      if (act === 'rename') {
        var inp = $('nameInput');
        result(SIM.rename(state, state.selected, inp ? inp.value : ''));
        updateUI(true); save(); return;
      }
      if (act === 'focus') {
        setMode('inspect'); closeDrawers(); toast('已切到点选模式，点缸里的成员即可查看'); return;
      }
      if (act === 'sell') {
        var c = SIM.find(state, state.selected), sp = c && D.get(c.specId);
        if (!c) return;
        var q = SIM.appraise(state, c);
        confirmBox('卖出成员', '「' + (c.name || sp.name) + '」当前估价 ' + q.price + ' 币：' +
          q.season + '季行情 ' + Math.round(q.seasonF * 100) + '%、' + q.stage + '、健康 ' + Math.round(c.health * 100) + '%。卖出后不可撤销。',
          function () {
            result(SIM.sellCreature(state, state.selected));
            lastDetailKey = '';
            updateUI(true); save();
          });
        return;
      }
    });
    $('detailCard').addEventListener('keydown', function (e) {
      if (e.target.id === 'nameInput' && e.key === 'Enter') {
        result(SIM.rename(state, state.selected, e.target.value));
        updateUI(true); save();
      }
    });

    /* 投喂 / 模式 */
    $('feedBtn').addEventListener('click', function () {
      var r = SIM.feed(state, $('foodSelect').value, .5);
      if (!r.ok) toast(r.msg);
      save();
    });
    function setMode(m) {
      state.mode = m;
      $('modeFeed').classList.toggle('active', m === 'feed');
      $('modeInspect').classList.toggle('active', m === 'inspect');
      $('modeLayout').classList.toggle('active', m === 'layout');
      $('stage').classList.toggle('inspect', m === 'inspect');
      $('stage').classList.toggle('layout', m === 'layout');
      $('tankHint').textContent = m === 'feed'
        ? '单击水面投喂 · 按住拖动旋转视角 · 滚轮缩放 · 双击复位'
        : m === 'layout'
          ? '按住水草或石头拖到心仪的位置 · 双击复位视角'
          : '单击成员查看习性 · 按住拖动旋转视角 · 滚轮缩放 · 双击复位';
    }
    $('modeFeed').addEventListener('click', function () { setMode('feed'); });
    $('modeInspect').addEventListener('click', function () { setMode('inspect'); });
    $('modeLayout').addEventListener('click', function () { setMode('layout'); });
    setMode(state.mode || 'feed');
    $('stage').classList.toggle('flat-view', state.viewMode === 'flat');

    /* 设备 / 维护 */
    $('gearBar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-gear]'); if (!b) return;
      var k = b.getAttribute('data-gear');
      var r = state.equipment[k] ? SIM.toggle(state, k) : SIM.buyGear(state, k);
      if (!r.ok) toast(r.msg); else if (r.msg) toast(r.msg);
      if (r.rebuild) R.rebuild(state);
      renderGearBar(); updateUI(true); save();
    });
    $('gearBar').addEventListener('change', function (e) {
      if (e.target.id === 'lightLevel') {
        if (!state.equipment.light) { toast('先安装水草灯'); return; }
        SIM.setLightLevel(state, Number(e.target.value)); toast('光强已调整');
      }
      if (e.target.id === 'targetTemp') {
        if (!state.equipment.heater) { toast('先安装加热棒'); renderGearBar(); return; }
        SIM.setTargetTemp(state, Number(e.target.value)); toast('目标水温 ' + e.target.value + '℃');
      }
      save();
    });
    $('waterBtn').addEventListener('click', function () { result(SIM.waterChange(state)); updateUI(true); save(); });
    $('scrubBtn').addEventListener('click', function () { result(SIM.scrub(state)); updateUI(true); save(); });
    $('treatBtn').addEventListener('click', function () { result(SIM.treatTank(state)); updateUI(true); save(); });
    $('resetViewBtn').addEventListener('click', function () { R.resetView(); toast('视角已复位'); });

    /* 设置：缸体尺寸 / 底砂 / 观看方式 */
    $('settingsBtn').addEventListener('click', function () { renderSettings(); $('settingsModal').hidden = false; });
    $('settingsModal').addEventListener('click', function (e) {
      if (e.target === this || e.target.closest('[data-close]')) { this.hidden = true; return; }
      var ff = e.target.closest('[data-feedfood]');
      if (ff) {
        var fid = ff.getAttribute('data-feedfood');
        var cur = ((state.auto.feed && state.auto.feed.foodIds) || []).slice();
        var at = cur.indexOf(fid);
        if (at >= 0) { if (cur.length > 1) cur.splice(at, 1); }   // 至少留一种，否则管家没得喂
        else cur.push(fid);
        SIM.setAuto(state, 'feed', { foodIds: cur });
        renderSettings(); save(); return;
      }
      // 布景选项：地形 / 石头风格与颜色（改完立即重建缸体）
      var b = e.target.closest('[data-slope]');
      if (b) { SIM.setAqua(state, { slope: b.getAttribute('data-slope') }); R.rebuild(state); renderSettings(); save(); return; }
      var scB = e.target.closest('[data-scape]');
      if (scB) {
        var scR = SIM.applyScape(state, scB.getAttribute('data-scape'));
        if (!scR.ok) { toast(scR.msg); return; }
        R.rebuild(state); renderSettings(); updateUI(true); save(); toast(scR.msg); return;
      }
      b = e.target.closest('[data-rockstyle]');
      if (b) { SIM.setAqua(state, { rock: { style: b.getAttribute('data-rockstyle') } }); R.rebuild(state); renderSettings(); save(); return; }
      b = e.target.closest('[data-rockcolor]');
      if (b) { SIM.setAqua(state, { rock: { color: b.getAttribute('data-rockcolor') } }); R.rebuild(state); renderSettings(); save(); return; }
    });
    $('settingsModal').addEventListener('change', function (e) {
      if (e.target.id === 'rockSize') { SIM.setAqua(state, { rock: { size: Number(e.target.value) } }); R.rebuild(state); save(); return; }
      if (e.target.id === 'rockCount') { SIM.setAqua(state, { rock: { count: Number(e.target.value) } }); R.rebuild(state); save(); return; }
      var cb = e.target.closest('[data-auto]');
      if (cb) { SIM.setAuto(state, cb.getAttribute('data-auto'), { on: cb.checked }); save(); return; }
      if (e.target.hasAttribute && e.target.hasAttribute('data-feedevery')) { SIM.setAuto(state, 'feed', { every: Number(e.target.value) }); save(); return; }
      if (e.target.hasAttribute && e.target.hasAttribute('data-waterevery')) { SIM.setAuto(state, 'water', { everyDays: Number(e.target.value) }); save(); return; }
    });
    /* 自定义缸体：滑块拖动只更新数字，松手（change）才真正换缸，
     * 否则每拖一格都 rebuild 一次场景会卡。 */
    function applyTankDims() {
      var dims = {
        l: Number($('tankL').value),
        w: Number($('tankW').value),
        h: Number($('tankH').value)
      };
      var r = SIM.setTankDims(state, dims);
      if (!r.ok) { toast(r.msg); renderSettings(); return; }
      R.rebuild(state); renderSettings(); updateUI(true); save(); toast(r.msg);
    }
    ['tankL', 'tankW', 'tankH'].forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('input', function () {
        var out = $(id + 'v'); if (out) out.textContent = this.value;
      });
      el.addEventListener('change', applyTankDims);
    });
    $('subOptions').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sub]'); if (!b) return;
      var r = SIM.setSubstrate(state, b.getAttribute('data-sub'));
      if (!r.ok) { toast(r.msg); return; }
      R.rebuild(state); renderSettings(); updateUI(true); save(); toast(r.msg);
    });
    $('viewOptions').addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]'); if (!b) return;
      var r = SIM.setViewMode(state, b.getAttribute('data-view'));
      R.applyViewMode(state.viewMode); R.resetView();
      $('stage').classList.toggle('flat-view', state.viewMode === 'flat');
      renderSettings(); updateUI(true); save(); toast(r.msg);
    });

    /* 顶栏 */
    $('speedGroup').addEventListener('click', function (e) {
      var b = e.target.closest('[data-speed]'); if (!b) return;
      SIM.setSpeed(state, Number(b.getAttribute('data-speed'))); updateUI(true); save();
    });
    $('pauseBtn').addEventListener('click', function () { SIM.setPaused(state, !state.paused); updateUI(true); });
    function toggleFull() {
      var el = $('stage');
      if (!document.fullscreenElement) { if (el.requestFullscreen) el.requestFullscreen(); }
      else if (document.exitFullscreen) document.exitFullscreen();
    }
    $('fullBtn').addEventListener('click', toggleFull);
    document.addEventListener('fullscreenchange', function () { setTimeout(function () { R.resize(); }, 80); });
    $('helpBtn').addEventListener('click', function () { $('helpModal').hidden = false; });
    $('helpModal').addEventListener('click', function (e) { if (e.target === this || e.target.closest('[data-close]')) this.hidden = true; });
    $('confirmModal').addEventListener('click', function (e) { if (e.target === this || e.target.closest('[data-close]')) this.hidden = true; });
    $('resetBtn').addEventListener('click', function () {
      confirmBox('重置水族箱', '会清空当前所有成员、设备与进度，从新缸重新开始。此操作无法撤销。', function () {
        state = SIM.create(); iconCache = {}; lastSig = ''; lastLogKey = '';
        renderGearBar(); updateUI(true); save(); toast('新缸已经布置好了');
      });
    });
    $('exportBtn').addEventListener('click', function () {
      var blob = new Blob([SIM.serialize(state)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'chengyu-aquarium-3d-day' + state.day + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('存档已导出');
    });
    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); SIM.setPaused(state, !state.paused); updateUI(true); }
      if (e.key === '1' || e.key === '2' || e.key === '3') { SIM.setSpeed(state, [1, 4, 16][Number(e.key) - 1]); updateUI(true); }
      if (e.key === 'f' || e.key === 'F') toggleFull();
      if (e.key === 'Escape') { closeDrawers(); $('helpModal').hidden = true; $('confirmModal').hidden = true; $('dexModal').hidden = true; }
    });
    window.addEventListener('beforeunload', save);
    window.addEventListener('resize', function () { R.resize(); });

    /* 选中成员的 3D 投影标签 */
    function syncSelLabel() {
      var el = $('selLabel'), p = state.selected ? R.projectSelected(state) : null;
      if (!p || !p.visible) { el.hidden = true; return; }
      var c = SIM.find(state, state.selected);
      if (!c) { el.hidden = true; return; }
      var sp = D.get(c.specId);
      el.hidden = false;
      el.textContent = D.displayName(c) + ' · ' + D.stageOf(c);
      el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    }

    /* 主循环 */
    function frame(now) {
      var dt = Math.min(.1, (now - lastFrame) / 1000);
      lastFrame = now;
      SIM.update(state, dt);
      var env = R.draw(state, dt) || SIM.getEnv(state);
      if (!$('dexModal').hidden) R.viewerFrame(dt);   // 图鉴 3D 展示台跟随主循环渲染
      $('nightVeil').style.opacity = ((1 - env.light) * 0.72).toFixed(3);
      syncSelLabel();
      uiClock += dt; saveClock += dt;
      if (uiClock > .35) { uiClock = 0; updateUI(false); }
      if (saveClock > 6) { saveClock = 0; save(); }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    save();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
