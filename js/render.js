/* 澄屿 · 3D 生态水族箱 —— Three.js 实时渲染
 * 所有模型均为程序化生成的写实几何：纺锤形鱼体 + 鳞片/斑纹贴图 + 半透明鳍片，
 * 水草、螺虾、底砂、沉木同理。不依赖任何图片模型资源。
 */
(function () {
  'use strict';
  var D = window.AW_DATA, T = window.THREE;
  var canvas, renderer, scene, camera, raycaster, W = 1200, H = 600;
  var TANK = { w: 16.8, h: 8.4, d: 6.2 };
  var BASE_Y = -TANK.h / 2 + 0.5;      // 底砂表面
  var WATER_Y = TANK.h / 2 - 0.22;
  /* 1 厘米对应的 3D 单位。旧版写死 0.42、与缸宽无关：缸越大，鱼相对缸就越偏大
   * （45cm 缸偏大约 13%，90cm 缸偏大约 48%），这就是「鱼比例不对」的根因。
   * 现在由 applyDims() 按 TANK.w / 标称cm 动态计算，任意缸都满足
   * 鱼占缸宽比例 = sizeCm / cm。初值按默认 90cm 缸给，避免 rebuild 前首帧异常。
   * FISH_VIS 是纯观赏放大系数：1.0 = 严格真实比例；若想让鱼在画面里更醒目，
   * 调到 1.15~1.25 即可（所有缸等比放大，不会破坏缸与缸之间的比例关系）。 */
  var FISH_VIS = 1.0;
  var PXCM = 25.5 / 90 * FISH_VIS;
  var t = 0, curState = null, ready = false, quality = 1, slowFrames = 0, frameTick = 0;
  var objs = {}, pickables = [], rockPickables = [], foodPool = [], bubbles = null, bubbleData = [];
  var __T0 = (window.performance && performance.now) ? performance.now() : 0;
  var __perf = window.__perf = { t0: __T0, marks: {} };
  function __mark(k) { try { __perf.marks[k] = Math.round(performance.now() - __T0); } catch (e) { } }
  var texCache = {}, leafCache = {}, thumbCache = {};
  /* 外置模型品种的列表图标：用 tools/make_thumbs.py 预渲染好的 PNG。
   * 现场用 WebGL 离屏渲染 45k 面的蒙皮模型 + readPixels 会卡死主线程，
   * 而 drawImage 一张 176×120 的 PNG 几乎免费。 */
  var thumbImgs = {}, thumbImgTimer = 0;
  function loadThumbImages() {
    var seen = {};
    D.creatures.forEach(function (sp) {
      if (!sp.model || seen[sp.model.file]) return;
      seen[sp.model.file] = true;
      var img = new Image();
      img.onload = function () {
        thumbImgs[sp.model.file] = img;
        window.__thumbVer = (window.__thumbVer || 0) + 1;
        // 16 张图几乎同时回来，攒一下再让列表重画一次
        clearTimeout(thumbImgTimer);
        thumbImgTimer = setTimeout(function () {
          if (handlers.modelsLoaded) handlers.modelsLoaded();
        }, 140);
      };
      /* 带模型包版本号：换模型 / 重跑 make_thumbs.py 后浏览器不会继续吃旧图标 */
      img.src = 'models/thumbs/' + sp.model.file + '.png' +
        (window.AW_MODEL_VER ? '?v=' + window.AW_MODEL_VER : '');
    });
  }
  /* 色型变体的图标着色：按 look.c1 与基础品种的比值做乘法（图标尺寸下够看） */
  function iconTintOf(sp) {
    if (!sp.variantOf || !sp.look || !sp.look.c1) return null;
    var base = D.get(sp.variantOf);
    if (!base || !base.look || !base.look.c1) return null;
    var a = hex01(sp.look.c1), r = hex01(base.look.c1);
    if (!a || !r) return null;
    var t = [0, 1, 2].map(function (i) {
      return Math.round(clamp(a[i] / Math.max(r[i], .02), .5, 1.7) * 255);
    });
    if (Math.abs(t[0] - 255) < 6 && Math.abs(t[1] - 255) < 6 && Math.abs(t[2] - 255) < 6) return null;
    return t;
  }
  var handlers = { feed: null, select: null, view: null, layout: null, layoutRock: null, modelsLoaded: null };
  var cam = { az: 0, el: 0.03, zoom: 1, taz: 0, tel: 0.03, tzoom: 1, baseDist: 16 };
  var drag = { active: false, moved: false, x0: 0, y0: 0, x: 0, y: 0, place: null };
  var lights = {}, water = null, caustic = null, beams = [];
  var staticGroup = null, shellObjs = [];
  /* 底床地形：默认平坦；buildStatic 按存档里的坡度设置重写这两个函数 */
  var terrain = { prof: function () { return 0; }, top: function () { return BASE_Y + .012; } };
  var fishEnv = null, sharpZoom = false;   // 鱼体环境反射贴图 / 近景高清渲染标记
  var glbLoader = null, glbModels = {}, glbFilesDone = {};   // 外部 GLB 模型缓存
  var thumbRig = null;   // 缩略图离屏渲染装置（可重复使用）

  /* 简易环境立方体贴图：上方亮、下方暗的渐变，让金属鳞片随转动泛出虹彩高光 */
  function makeEnvCube() {
    try {
      var faces = [];
      for (var i = 0; i < 6; i++) {
        var cv = cv2d(32, 32), c = cv.getContext('2d');
        var bright = i === 2 ? .95 : (i === 3 ? .10 : .5);   // +Y 亮，-Y 暗
        var g = c.createLinearGradient(0, 0, 0, 32);
        g.addColorStop(0, 'rgb(' + Math.round(140 + 100 * bright) + ',' + Math.round(195 + 45 * bright) + ',' + Math.round(210 + 40 * bright) + ')');
        g.addColorStop(1, 'rgb(10,32,42)');
        c.fillStyle = g; c.fillRect(0, 0, 32, 32);
        faces.push(cv);
      }
      var ct = new T.CubeTexture(faces); ct.needsUpdate = true; ct.encoding = T.sRGBEncoding;
      return ct;
    } catch (e) { return null; }
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function simpleCopy(o, patch) {
    var r = {}, k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k];
    if (patch) for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) r[k] = patch[k];
    return r;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function hash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
  function col(hex) { return new T.Color(hex); }
  function shade(hex, dl) { return col(hex).offsetHSL(0, 0, dl); }
  function mixC(a, b, k) { return col(a).lerp(col(b), k); }
  function rgbOf(hex) { var c = col(hex); return Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' + Math.round(c.b * 255); }

  /* ================= 程序化纹理 ================= */
  function cv2d(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  function backgroundTexture() {
    var cv = cv2d(256, 256), c = cv.getContext('2d');
    var g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#1a5b68'); g.addColorStop(.45, '#0b3543'); g.addColorStop(1, '#03141e');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
    var r = c.createRadialGradient(128, -30, 8, 128, 70, 230);
    r.addColorStop(0, 'rgba(170,238,235,.42)'); r.addColorStop(1, 'rgba(170,238,235,0)');
    c.fillStyle = r; c.fillRect(0, 0, 256, 256);
    var tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; return tex;
  }

  function noiseTexture(base, dark, n) {
    var cv = cv2d(256, 256), c = cv.getContext('2d');
    c.fillStyle = base; c.fillRect(0, 0, 256, 256);
    for (var i = 0; i < n; i++) {
      var x = Math.random() * 256, y = Math.random() * 256, r = Math.random() * 2.4 + 0.5;
      c.fillStyle = Math.random() > .5 ? 'rgba(255,248,220,.20)' : dark;
      c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
    }
    var tex = new T.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(5, 2);
    tex.encoding = T.sRGBEncoding; return tex;
  }

  function rippleTexture() {
    var cv = cv2d(512, 256), c = cv.getContext('2d');
    c.fillStyle = 'rgba(180,235,240,.13)'; c.fillRect(0, 0, 512, 256);
    c.strokeStyle = 'rgba(225,255,255,.30)'; c.lineWidth = 1.4;
    for (var k = 0; k < 12; k++) {
      c.beginPath();
      for (var x = 0; x <= 512; x += 8) {
        var y = 12 + k * 21 + Math.sin(x * .022 + k * 1.3) * 4 + Math.sin(x * .061 - k) * 1.6;
        if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    var tex = new T.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.encoding = T.sRGBEncoding; return tex;
  }

  function beamTexture() {
    var cv = cv2d(64, 256), c = cv.getContext('2d');
    var g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, 'rgba(215,255,250,.65)'); g.addColorStop(.55, 'rgba(180,240,240,.20)'); g.addColorStop(1, 'rgba(180,240,240,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 256);
    var hm = c.createLinearGradient(0, 0, 64, 0);
    hm.addColorStop(0, 'rgba(0,0,0,0)'); hm.addColorStop(.5, 'rgba(0,0,0,1)'); hm.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalCompositeOperation = 'destination-in'; c.fillStyle = hm; c.fillRect(0, 0, 64, 256);
    var tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; return tex;
  }

  function bubbleTexture() {
    var cv = cv2d(32, 32), c = cv.getContext('2d');
    var g = c.createRadialGradient(13, 12, 1, 16, 16, 15);
    g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.55, 'rgba(215,250,255,.35)'); g.addColorStop(1, 'rgba(215,250,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(16, 16, 15, 0, 6.283); c.fill();
    c.strokeStyle = 'rgba(240,255,255,.6)'; c.lineWidth = 1; c.beginPath(); c.arc(16, 16, 12, 0, 6.283); c.stroke();
    return new T.CanvasTexture(cv);
  }

  /* 鱼皮：纵轴 = 体长方向，横轴 = 圆周（0/1 为背，0.5 为腹，0.25/0.75 为两侧） */
  /* 图灵斑图：Gray-Scott 反应扩散。两种化学物质在体表扩散、互相催化抑制，
   * 迭代几百步后收敛成稳定的斑点/虫蚀纹，比手画斑点更有生物感。 */
  function turingCanvas(w, h, seed) {
    var a = new Float32Array(w * h), b = new Float32Array(w * h), i, x, y;
    for (i = 0; i < a.length; i++) { a[i] = 1; b[i] = 0; }
    var s = seed || 12345;
    function rnd2() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    for (i = 0; i < 24; i++) {
      var cx = (rnd2() * w) | 0, cy = (rnd2() * h) | 0, r = 2 + ((rnd2() * 3) | 0);
      for (y = -r; y <= r; y++) for (x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r) {
          var px = (cx + x + w) % w, py = (cy + y + h) % h;
          a[py * w + px] = .2; b[py * w + px] = .9;
        }
      }
    }
    var da = 1.0, db = .5, feed = .037, kill = .061;
    var a2 = new Float32Array(a), b2 = new Float32Array(b);
    for (var it = 0; it < 620; it++) {
      for (y = 0; y < h; y++) {
        var yu = Math.min(h - 1, y + 1) * w, yd = Math.max(0, y - 1) * w, yc = y * w;
        for (x = 0; x < w; x++) {
          var xi = yc + x, xr = yc + (x + 1) % w, xl = yc + (x - 1 + w) % w;
          var av = a[xi], bv = b[xi];
          var la = a[xr] + a[xl] + a[yu + x] + a[yd + x] - 4 * av;
          var lb = b[xr] + b[xl] + b[yu + x] + b[yd + x] - 4 * bv;
          a2[xi] = av + (da * la - av * bv * bv + feed * (1 - av));
          b2[xi] = bv + (db * lb + av * bv * bv - (kill + feed) * bv);
        }
      }
      a.set(a2); b.set(b2);
    }
    var cv = cv2d(w, h), c = cv.getContext('2d'), img = c.createImageData(w, h);
    for (i = 0; i < w * h; i++) {
      var v = clamp((b[i] - .12) / .55, 0, 1);
      img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = Math.pow(v, .82) * 255;
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  function turingPattern(hex, seed) {
    var key = 'tur' + hex + seed;
    if (texCache[key]) return texCache[key];
    var small = turingCanvas(72, 36, seed);
    var cv = cv2d(512, 256), c = cv.getContext('2d');
    c.imageSmoothingEnabled = true;
    c.drawImage(small, 0, 0, 512, 256);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = hex; c.fillRect(0, 0, 512, 256);
    texCache[key] = cv; return cv;
  }

  function fishTexture(sp) {
    if (texCache[sp.id]) return texCache[sp.id];
    var cv = cv2d(512, 256), c = cv.getContext('2d'), lk = sp.look;
    var g = c.createLinearGradient(0, 0, 0, 256);
    var side = '#' + mixC(lk.c1, lk.c2, .24).getHexString();
    g.addColorStop(0, '#' + shade(lk.c2, -.14).getHexString());
    g.addColorStop(.22, side);
    g.addColorStop(.5, '#' + mixC(lk.c1, '#f2f4ea', .52).getHexString());
    g.addColorStop(.78, side);
    g.addColorStop(1, '#' + shade(lk.c2, -.14).getHexString());
    c.fillStyle = g; c.fillRect(0, 0, 512, 256);

    // 细密鳞片：双层弧线（上缘亮、下缘暗），交错排列出立体感
    c.lineWidth = 1;
    for (var x = 6; x < 512; x += 12) {
      for (var y = 4; y < 256; y += 9) {
        var ox = ((y / 9) % 2) * 6;
        c.strokeStyle = 'rgba(255,255,255,.20)';
        c.beginPath(); c.arc(x + ox, y, 5, .15 * Math.PI, .85 * Math.PI); c.stroke();
        c.strokeStyle = 'rgba(10,30,40,.15)';
        c.beginPath(); c.arc(x + ox, y + 1.7, 5, .15 * Math.PI, .85 * Math.PI); c.stroke();
      }
    }
    c.globalAlpha = 1;
    var p = lk.pattern;
    if (p === 'neon') {
      c.fillStyle = 'rgba(70,205,240,.92)'; c.fillRect(0, 58, 512, 12); c.fillRect(0, 186, 512, 12);
      c.fillStyle = 'rgba(232,60,70,.88)'; c.fillRect(150, 72, 340, 22); c.fillRect(150, 162, 340, 22);
      c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(0, 44, 512, 8); c.fillRect(0, 204, 512, 8);
    } else if (p === 'zebra') {
      c.strokeStyle = 'rgba(' + rgbOf(lk.c2) + ',.80)'; c.lineWidth = 9;
      [70, 96, 160, 186].forEach(function (y) {
        c.beginPath(); c.moveTo(40, y); c.bezierCurveTo(180, y - 7, 330, y + 8, 500, y - 3); c.stroke();
      });
    } else if (p === 'leopard') {
      // 豹纹斑马：金色底上成串的深色圆点
      c.fillStyle = 'rgba(' + rgbOf(lk.c2) + ',.55)';
      for (var lpx = 30; lpx < 500; lpx += 34) for (var lpy = 20; lpy < 240; lpy += 26) {
        var jig = Math.sin(lpx * 12.9 + lpy * 78.2) * 6;
        c.beginPath(); c.ellipse(lpx + jig, lpy + jig * .5, 6, 4.5, 0, 0, 6.283); c.fill();
      }
    } else if (p === 'speckle') {
      // 花椒鼠：细密的胡椒点
      c.fillStyle = 'rgba(' + rgbOf(lk.c2) + ',.42)';
      for (var spx = 14; spx < 512; spx += 19) for (var spy = 12; spy < 250; spy += 15) {
        var sj = Math.sin(spx * 3.7 + spy * 11.3) * 4;
        c.beginPath(); c.arc(spx + sj, spy + sj, 1.8 + Math.abs(Math.sin(spx * 7.1 + spy)) * 1.6, 0, 6.283); c.fill();
      }
    } else if (p === 'albino') {
      // 白化：奶白身体 + 顶部橙色腮红与鳍根泛橙
      var abg = c.createLinearGradient(0, 0, 0, 256);
      abg.addColorStop(0, 'rgba(226,120,52,.30)'); abg.addColorStop(.42, 'rgba(226,120,52,.06)'); abg.addColorStop(1, 'rgba(226,120,52,.20)');
      c.fillStyle = abg; c.fillRect(0, 0, 512, 256);
      c.fillStyle = 'rgba(240,150,80,.30)'; c.fillRect(30, 108, 60, 42); c.fillRect(30, 108, 60, 42);
    } else if (p === 'marble') {
      // 大理石斗鱼：图灵斑图生成的不规则色块
      c.globalAlpha = .55;
      c.drawImage(turingPattern('#' + col(lk.c2).getHexString(), 7717), 0, 0);
      c.globalAlpha = .30;
      c.drawImage(turingPattern('#' + col(lk.c3).getHexString(), 3313), 0, 0);
      c.globalAlpha = 1;
    } else if (p === 'guppy') {
      [[110, 82, 18], [190, 150, 13], [280, 70, 22], [350, 176, 12]].forEach(function (q) {
        var rg = c.createRadialGradient(q[0], q[1], 2, q[0], q[1], q[2]);
        rg.addColorStop(0, 'rgba(20,30,40,.85)'); rg.addColorStop(.55, lk.c3); rg.addColorStop(1, 'rgba(255,190,90,0)');
        c.fillStyle = rg; c.beginPath(); c.arc(q[0], q[1], q[2], 0, 6.283); c.fill();
      });
      c.fillStyle = 'rgba(120,210,225,.3)'; c.fillRect(0, 30, 512, 20); c.fillRect(0, 206, 512, 20);
    } else if (p === 'betta') {
      var bg = c.createLinearGradient(0, 0, 512, 0);
      bg.addColorStop(0, 'rgba(20,25,90,.55)'); bg.addColorStop(.5, 'rgba(120,60,180,.28)'); bg.addColorStop(1, 'rgba(230,70,120,.2)');
      c.fillStyle = bg; c.fillRect(0, 0, 512, 256);
      c.strokeStyle = 'rgba(190,225,255,.18)'; c.lineWidth = 3;
      for (var b = 0; b < 22; b++) { c.beginPath(); c.moveTo(b * 24, 0); c.lineTo(b * 24 + 14, 256); c.stroke(); }
    } else if (p === 'gold') {
      var gg = c.createLinearGradient(0, 0, 0, 256);
      gg.addColorStop(0, 'rgba(196,86,16,.55)'); gg.addColorStop(.4, 'rgba(255,205,90,.12)'); gg.addColorStop(1, 'rgba(255,248,210,.4)');
      c.fillStyle = gg; c.fillRect(0, 0, 512, 256);
      c.globalAlpha = .22; c.strokeStyle = '#fff3c0'; c.lineWidth = 1.2;
      for (var gx = 8; gx < 512; gx += 18) for (var gy = 6; gy < 256; gy += 15) {
        c.beginPath(); c.arc(gx + (gy / 15 % 2) * 9, gy, 7, .1 * Math.PI, .9 * Math.PI); c.stroke();
      }
      c.globalAlpha = 1;
    } else if (p === 'koi') {
      c.fillStyle = 'rgba(250,248,242,.85)'; c.fillRect(0, 0, 512, 256);
      [[90, 70, 48, 34, '#d9482f'], [230, 170, 62, 40, '#e45a35'], [370, 60, 40, 30, '#26262c'], [450, 150, 34, 26, '#d9482f']].forEach(function (q, qi) {
        // 一块斑 = 多个错位椭圆聚合成不规则形，边缘不再像盖章
        for (var pi = 0; pi < 4; pi++) {
          var jx = (hash('kp' + qi + '_' + pi) - .5) * q[2] * .8;
          var jy = (hash('kq' + qi + '_' + pi) - .5) * q[3] * .8;
          var k2 = .5 + hash('kr' + qi + '_' + pi) * .55;
          c.fillStyle = q[4];
          c.beginPath();
          c.ellipse(q[0] + jx, q[1] + jy, q[2] * k2, q[3] * k2, hash('ka' + qi + '_' + pi) * .7, 0, 6.283);
          c.fill();
        }
      });
      c.globalAlpha = .1; c.strokeStyle = '#ffffff';
      for (var kx = 8; kx < 512; kx += 13) for (var ky = 4; ky < 256; ky += 11) {
        c.beginPath(); c.arc(kx, ky, 5, 0, Math.PI); c.stroke();
      }
      c.globalAlpha = 1;
    } else if (p === 'cory') {
      // 鼠鱼：图灵虫蚀纹（参考照片的细碎斑驳）+ 背部鞍状斑 + 尾柄黑斑
      c.globalAlpha = .5;
      c.drawImage(turingPattern('#' + col(lk.c2).getHexString(), 5231), 0, 0);
      c.globalAlpha = 1;
      c.fillStyle = 'rgba(' + rgbOf(lk.c2) + ',.78)';
      c.beginPath(); c.ellipse(96, 60, 94, 42, .1, 0, 6.283); c.fill();
      c.beginPath(); c.ellipse(300, 54, 102, 38, .1, 0, 6.283); c.fill();
      c.fillStyle = 'rgba(' + rgbOf(lk.c2) + ',.42)';
      c.fillRect(434, 40, 78, 74);
      // 金属虹彩侧带（青铜鼠偏青绿）
      var metal = (sp.id && sp.id.indexOf('bronze') >= 0) ? '#66d8c4' : '#7fae9a';
      var band = c.createLinearGradient(120, 0, 470, 0);
      band.addColorStop(0, 'rgba(' + rgbOf(metal) + ',0)');
      band.addColorStop(.25, 'rgba(' + rgbOf(metal) + ',.36)');
      band.addColorStop(.8, 'rgba(' + rgbOf(metal) + ',.22)');
      band.addColorStop(1, 'rgba(' + rgbOf(metal) + ',0)');
      c.fillStyle = band; c.fillRect(110, 98, 380, 34);
      c.fillStyle = band; c.fillRect(110, 132, 380, 10);
      // 鳃盖粉晕（照片里泛红的脸颊）
      var gillg = c.createRadialGradient(42, 130, 4, 42, 130, 58);
      gillg.addColorStop(0, 'rgba(212,92,108,.42)'); gillg.addColorStop(1, 'rgba(212,92,108,0)');
      c.fillStyle = gillg; c.beginPath(); c.arc(42, 130, 58, 0, 6.283); c.fill();
    } else if (p === 'oto') {
      c.fillStyle = 'rgba(35,52,42,.75)'; c.fillRect(0, 108, 512, 40);
      c.fillStyle = 'rgba(222,214,170,.4)'; c.fillRect(0, 34, 512, 14); c.fillRect(0, 208, 512, 14);
      c.fillStyle = 'rgba(50,62,48,.35)';
      for (var ox = 40; ox < 512; ox += 70) { c.beginPath(); c.ellipse(ox, 76, 16, 8, 0, 0, 6.283); c.fill(); }
    } else if (p === 'blacktail') {
      c.fillStyle = 'rgba(20,28,34,.88)';
      c.beginPath(); c.ellipse(438, 128, 74, 64, 0, 0, 6.283); c.fill();
      c.fillStyle = 'rgba(255,255,255,.16)'; c.fillRect(0, 96, 512, 10);
      c.fillStyle = 'rgba(40,60,70,.22)'; c.fillRect(0, 196, 512, 12);
    } else if (p === 'tiger') {
      c.fillStyle = 'rgba(32,30,28,.84)';
      [64, 148, 232, 316].forEach(function (bx) {
        c.beginPath(); c.moveTo(bx, 14);
        c.bezierCurveTo(bx + 20, 78, bx - 12, 176, bx + 8, 242);
        c.lineTo(bx + 36, 242);
        c.bezierCurveTo(bx + 16, 176, bx + 46, 78, bx + 28, 14);
        c.closePath(); c.fill();
      });
      c.fillStyle = 'rgba(220,110,40,.20)'; c.fillRect(0, 60, 512, 18);
    } else if (p === 'discus') {
      c.strokeStyle = 'rgba(18,66,86,.34)'; c.lineWidth = 7;
      for (var dx2 = 12; dx2 < 512; dx2 += 36) {
        c.beginPath(); c.moveTo(dx2, 0); c.lineTo(dx2 + 16, 256); c.stroke();
      }
      c.fillStyle = 'rgba(222,124,54,.26)'; c.fillRect(0, 118, 512, 76);
      c.fillStyle = 'rgba(40,90,110,.18)'; c.fillRect(0, 40, 512, 30);
      // 图灵斑图叠加：体侧稳定的斑块与虫蚀纹
      c.globalAlpha = .34;
      c.drawImage(turingPattern('#' + col(lk.c3).getHexString(), 9137), 0, 0);
      c.globalAlpha = 1;
    } else if (p === 'clownfish') {
      // 小丑鱼：橙底 + 三道白带黑边（GLB 加载前的兜底外观）
      c.fillStyle = 'rgba(255,116,34,.55)'; c.fillRect(0, 0, 512, 256);
      [96, 236, 384].forEach(function (bx, bi) {
        var w2 = 46 - bi * 5;
        c.fillStyle = 'rgba(22,26,30,.92)';
        c.beginPath(); c.ellipse(bx, 128, w2 / 2 + 5, 106, 0, 0, 6.283); c.fill();
        c.fillStyle = '#f8f6f2';
        c.beginPath(); c.ellipse(bx, 128, w2 / 2, 100, 0, 0, 6.283); c.fill();
      });
    } else if (p === 'angel') {
      // 神仙鱼：银底 + 三四道竖直黑带（带色随品种配色），带端在背腹渐隐
      [86, 200, 318, 428].forEach(function (bx, bi) {
        var wdt = 26 - bi * 2, alpha = .58 - bi * .06;
        var lg = c.createLinearGradient(bx, 0, bx + wdt, 0);
        lg.addColorStop(0, 'rgba(' + rgbOf(lk.c3) + ',0)');
        lg.addColorStop(.5, 'rgba(' + rgbOf(lk.c3) + ',' + alpha + ')');
        lg.addColorStop(1, 'rgba(' + rgbOf(lk.c3) + ',0)');
        c.fillStyle = lg;
        c.fillRect(bx, 8, wdt, 240);
      });
      c.fillStyle = 'rgba(' + rgbOf(lk.c3) + ',.30)'; c.fillRect(0, 96, 40, 64);   // 眼后暗带
    } else if (p === 'clown') {
      // 三间鼠：橙底 + 三道前倾黑带，头颈一道红
      var cg = c.createLinearGradient(0, 0, 0, 256);
      cg.addColorStop(0, 'rgba(255,208,120,.35)'); cg.addColorStop(.5, 'rgba(255,190,90,.12)'); cg.addColorStop(1, 'rgba(220,120,40,.25)');
      c.fillStyle = cg; c.fillRect(0, 0, 512, 256);
      [92, 232, 372].forEach(function (bx) {
        c.fillStyle = 'rgba(24,24,26,.88)';
        c.beginPath(); c.moveTo(bx, 6);
        c.bezierCurveTo(bx + 22, 80, bx - 10, 176, bx + 14, 250);
        c.lineTo(bx + 46, 250);
        c.bezierCurveTo(bx + 20, 176, bx + 52, 80, bx + 32, 6);
        c.closePath(); c.fill();
      });
      c.fillStyle = 'rgba(214,66,42,.55)'; c.fillRect(0, 30, 54, 196); // 头部红区
    } else if (p === 'denison') {
      // 一眉道人：眼上一道红眉 + 贯穿体侧的黑线，后半银亮
      c.fillStyle = 'rgba(226,62,48,.85)';
      c.fillRect(0, 46, 210, 13); c.fillRect(0, 197, 210, 13);
      c.fillStyle = 'rgba(28,38,44,.78)';
      c.fillRect(110, 62, 402, 11); c.fillRect(110, 183, 402, 11);
      c.fillStyle = 'rgba(255,255,255,.20)'; c.fillRect(240, 84, 272, 22); c.fillRect(240, 150, 272, 22);
    } else if (p === 'pearl') {
      // 珍珠马甲：琥珀底 + 图灵喷点（珍珠）+ 腹侧一条深色蕾丝线
      var pg = c.createLinearGradient(0, 0, 0, 256);
      pg.addColorStop(0, 'rgba(120,110,70,.30)'); pg.addColorStop(.5, 'rgba(255,244,214,.10)'); pg.addColorStop(1, 'rgba(96,88,52,.30)');
      c.fillStyle = pg; c.fillRect(0, 0, 512, 256);
      c.globalAlpha = .40;
      c.drawImage(turingPattern('#f2e8cd', 4211), 0, 0);
      c.globalAlpha = 1;
      c.fillStyle = 'rgba(52,62,44,.66)'; c.fillRect(0, 70, 512, 9); c.fillRect(0, 177, 512, 9);
      c.fillStyle = 'rgba(198,90,52,.34)'; c.fillRect(300, 60, 212, 26); c.fillRect(300, 170, 212, 26);
    } else if (p === 'swordtail') {
      // 红箭：橙红底 + 两道浅金侧线，靠近尾部颜色更浓
      var sg = c.createLinearGradient(120, 0, 512, 0);
      sg.addColorStop(0, 'rgba(255,120,80,0)'); sg.addColorStop(1, 'rgba(255,214,160,.16)');
      c.fillStyle = sg; c.fillRect(0, 0, 512, 256);
      c.fillStyle = 'rgba(255,236,190,.30)'; c.fillRect(30, 84, 400, 8); c.fillRect(30, 164, 400, 8);
    }
    // 嘴缝：头部两侧一道浅浅的暗线（张开方向沿头侧），比纯贴图多一分「有嘴」的实感
    c.strokeStyle = 'rgba(18,26,30,.38)'; c.lineWidth = 3; c.lineCap = 'round';
    [64, 192].forEach(function (my) {
      c.beginPath(); c.moveTo(6, my - 10); c.quadraticCurveTo(22, my, 8, my + 14); c.stroke();
    });
    // 背部高光 + 腹部阴影，增强体积感
    var hg = c.createLinearGradient(0, 0, 0, 256);
    hg.addColorStop(0, 'rgba(255,255,255,.14)'); hg.addColorStop(.18, 'rgba(255,255,255,0)');
    hg.addColorStop(.82, 'rgba(0,20,30,0)'); hg.addColorStop(1, 'rgba(0,20,30,.18)');
    c.fillStyle = hg; c.fillRect(0, 0, 512, 256);
    var tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; tex.anisotropy = 8;
    texCache[sp.id] = tex; return tex;
  }

  /* 鳞片凹凸贴图（bumpMap）：灰度图——鳞片上缘亮、下缘暗出立体鳞感，中线一条侧线凹槽。
   * 全部鱼共用一张，成本近乎为零但拉近后鳞片有真实浮雕。 */
  function scaleBumpTexture() {
    var key = 'scaleBump';
    if (texCache[key]) return texCache[key];
    var cv = cv2d(512, 256), c = cv.getContext('2d');
    c.fillStyle = '#808080'; c.fillRect(0, 0, 512, 256);
    for (var x = 6; x < 512; x += 12) {
      for (var y = 4; y < 256; y += 9) {
        var ox = ((y / 9) % 2) * 6;
        c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 1.6;
        c.beginPath(); c.arc(x + ox, y, 5, .15 * Math.PI, .85 * Math.PI); c.stroke();
        c.strokeStyle = 'rgba(0,0,0,.45)';
        c.beginPath(); c.arc(x + ox, y + 1.8, 5, .15 * Math.PI, .85 * Math.PI); c.stroke();
      }
    }
    // 侧线：从头后到尾柄的一条浅凹槽
    c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath();
    for (var lx = 30; lx <= 500; lx += 20) {
      var ly = 128 + Math.sin(lx * .045) * 5 + (lx - 30) * .02;
      if (lx === 30) c.moveTo(lx, ly); else c.lineTo(lx, ly);
    }
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.3)'; c.lineWidth = 2;
    c.beginPath();
    for (var lx2 = 30; lx2 <= 500; lx2 += 20) {
      var ly2 = 124 + Math.sin(lx2 * .045) * 5 + (lx2 - 30) * .02;
      if (lx2 === 30) c.moveTo(lx2, ly2); else c.lineTo(lx2, ly2);
    }
    c.stroke();
    var tex = new T.CanvasTexture(cv); tex.anisotropy = 8;
    texCache[key] = tex; return tex;
  }

  function finTexture(hex) {
    var key = 'fin2_' + hex;
    if (texCache[key]) return texCache[key];
    var cv = cv2d(256, 256), c = cv.getContext('2d');
    // 底色 + 根部到边缘的明暗渐变（真实鳍膜：根部厚、边缘薄）
    c.fillStyle = hex; c.fillRect(0, 0, 256, 256);
    var fade = c.createLinearGradient(256, 0, 0, 0);
    fade.addColorStop(0, 'rgba(255,255,255,.30)');
    fade.addColorStop(.55, 'rgba(255,255,255,.04)');
    fade.addColorStop(1, 'rgba(6,22,30,.20)');
    c.fillStyle = fade; c.fillRect(0, 0, 256, 256);
    // 鳍条：从右侧根部呈扇形发出、边缘分叉的细条，条间透光
    c.lineCap = 'round';
    for (var i = 0; i < 15; i++) {
      var t0 = i / 14, y0 = 22 + t0 * 212, y1 = 128 + (y0 - 128) * 1.72;
      var edge = .30 - Math.abs(t0 - .5) * .20;
      c.strokeStyle = 'rgba(255,255,255,' + edge.toFixed(3) + ')';
      c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(256, y0);
      c.quadraticCurveTo(120, y0 + (y1 - y0) * .32, 4, y1);
      c.stroke();
      // 鳍条分节（透光的骨节感）
      c.strokeStyle = 'rgba(24,44,56,.22)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(256, y0);
      c.quadraticCurveTo(120, y0 + (y1 - y0) * .32, 4, y1);
      c.stroke();
      // 分叉小刺
      c.strokeStyle = 'rgba(255,255,255,' + (edge * .5).toFixed(3) + ')';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(46, y1); c.lineTo(4, y1 - 7); c.stroke();
      c.beginPath(); c.moveTo(46, y1); c.lineTo(4, y1 + 7); c.stroke();
    }
    var tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; tex.anisotropy = 8;
    texCache[key] = tex; return tex;
  }

  /* ================= 几何 ================= */
  /* 沿体轴放样：u∈[0,1] 逐段取体型族的体高/体宽包络，画一圈 M 个顶点的椭圆环，相邻环连成 quad strip。
   * 换一组 profile 就从金鱼（球形）变到异型（棍棒形），几何永远是再生成的，不是固定网格。 */
  function bodyGeometry(sp) {
    var sx = 40, sr = 20, lk = sp.look;   // 细分提高一档，侧影和摆尾的过渡更顺滑
    var shapeKey = D.shapeOf(sp), S = D.bodyShape(sp) || D.bodyShapes.fusiform;
    var baseH = lk.body === 'deep' ? .34 : lk.body === 'stout' ? .26 : lk.body === 'long' ? .145 : .19;
    var hp = baseH * (shapeKey === 'compressiform' ? 1.24 : shapeKey === 'globiform' ? 1.30 :
      shapeKey === 'depressiform' ? .84 : shapeKey === 'anguilliform' ? .74 : 1);
    var wp = S.w * (lk.body === 'deep' ? 1.04 : 1);
    var lenX = S.longBody || 1;

    function env(tab, u) {
      if (u <= tab[0][0]) return tab[0][1];
      for (var i = 1; i < tab.length; i++) {
        if (u <= tab[i][0]) {
          var t = (u - tab[i - 1][0]) / Math.max(1e-5, tab[i][0] - tab[i - 1][0]);
          t = t * t * (3 - 2 * t); // smoothstep，避免截面折角
          return tab[i - 1][1] + (tab[i][1] - tab[i - 1][1]) * t;
        }
      }
      return tab[tab.length - 1][1];
    }

    /* 品种轮廓签名变形：吻尖 / 头高 / 背弓 / 尾柄粗细，叠加在体型族包络上，
     * 让「同族不同种」的侧影各有性格（参考每种动物独立塑形的博物馆式建模思路） */
    var sil = (D.silOf && D.silOf(sp)) || {};
    function wEnv(u) {
      var h = env(S.h, u);
      if (sil.snout && u < .2) h *= 1 - sil.snout * Math.pow(1 - u / .2, 1.4);       // 吻端收窄
      if (sil.headH != null && u < .3) h *= 1 + (sil.headH - 1) * (1 - u / .3);      // 头部高度
      if (sil.hump) h *= 1 + sil.hump * Math.exp(-Math.pow((u - .36) / .2, 2));      // 背部弓起
      if (sil.pedK != null && u > .78) h *= 1 + (sil.pedK - 1) * ((u - .78) / .22);  // 尾柄粗细
      return clamp(h, .03, 1.35);
    }

    var pos = [], uv = [], idx = [];
    var noseX = .5 * lenX;
    for (var i = 0; i <= sx; i++) {
      var u = i / sx, x = (.5 - u) * lenX;
      var hE = wEnv(u);
      var r = hE * (1 + (S.bulge || 0) * Math.exp(-Math.pow((u - .34) / .24, 2)));
      r = clamp(r, .04, 1.2);
      /* superellipse 透镜截面：背部「脊线」锋利（n<2）、腹部圆钝（n>2），
       * 中段最扁、头尾趋圆——真实鱼体不是椭圆，是有棱的透镜 */
      var nBack = Math.max(1.45, 2.3 - Math.exp(-Math.pow((u - .38) / .24, 2)) * .95);
      for (var j = 0; j <= sr; j++) {
        var th = j / sr * Math.PI * 2;
        var cy = Math.cos(th), cz = Math.sin(th);
        var sy = Math.sign(cy) * Math.pow(Math.abs(cy), 2 / (cy >= 0 ? nBack : 2.5));
        var szp = Math.sign(cz) * Math.pow(Math.abs(cz), 2 / 1.9);
        var yy = sy * r * hp;
        if (S.belly && cy < 0) yy *= S.belly;   // 平扁体型：腹部压平，贴住底砂
        // 脊线沿体轴轻微下垂（腹部自然下垂，头尾上收）
        var spine = -Math.sin(Math.pow(u, .9) * Math.PI) * .07 * hp * (S.belly ? .45 : 1);
        pos.push(x, yy + spine, szp * r * hp * wp);
        uv.push(u, j / sr);
      }
    }
    for (var a1 = 0; a1 < sx; a1++) for (var b1 = 0; b1 < sr; b1++) {
      var p = a1 * (sr + 1) + b1, q = p + sr + 1;
      idx.push(p, q, p + 1, q, q + 1, p + 1);
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    // 记录头部（眼睛/胸鳍挂点）与中段截面的实际尺寸，避免换体型后部件飘出体外
    var uHead = .155, rHead = clamp(wEnv(uHead) * (1 + (S.bulge || 0) *
      Math.exp(-Math.pow((uHead - .34) / .24, 2))), .04, 1.2);
    g.userData.hp = hp; g.userData.wp = wp; g.userData.shape = shapeKey; g.userData.noseX = noseX;
    g.userData.headH = rHead * hp;
    g.userData.headW = rHead * hp * wp;
    g.userData.midH = clamp(wEnv(.42), .04, 1.2) * hp;
    return g;
  }

  /* 把 ShapeGeometry 的 UV 从原始 x,y 坐标归一化到 0..1（否则鳍纹理采样越界，只能显示纯色） */
  function normalizeUV(geo) {
    geo.computeBoundingBox();
    var bb = geo.boundingBox, p = geo.attributes.position, uv = new Float32Array(p.count * 2);
    var dx = Math.max(1e-6, bb.max.x - bb.min.x), dy = Math.max(1e-6, bb.max.y - bb.min.y);
    for (var i = 0; i < p.count; i++) {
      uv[i * 2] = (p.getX(i) - bb.min.x) / dx;
      uv[i * 2 + 1] = (p.getY(i) - bb.min.y) / dy;
    }
    geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
    return geo;
  }

  /* 给鳍面做出弧度：根部到边缘的杯状弯曲 + 边缘细碎起伏，鳍不再是一张纸 */
  function cupFin(g, amt) {
    var p = g.attributes.position, uv = g.attributes.uv;
    if (!uv) return g;
    for (var i = 0; i < p.count; i++) {
      var uu = uv.getX(i), vv = uv.getY(i);
      p.setZ(i, p.getZ(i) + Math.sin(uu * Math.PI) * amt + Math.sin(vv * 6.28) * amt * .35);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  }

  /* 尾鳍形状：fL 为品种鳍长系数。
   * 长度按幂增长（蝶翼 fL≈2.1 时尾幅接近体长），fL>1.45 进入「飘逸」形态：
   * 尾尖下垂、轮廓变成 flowing 的纱裙，而不是把标准尾等比放大 */
  function finShape(kind, hp, fL) {
    fL = fL || 1;
    var flow = clamp((fL - 1.45) / .8, 0, 1);                        // 飘逸度
    var vflow = kind === 'veil' ? .5 + flow * .5 : flow;             // 纱尾天生飘逸
    var L = Math.min(.34 * (.5 + .85 * Math.pow(fL, 1.3)), .95);
    var h = hp * (.6 + .45 * Math.pow(fL, .95));
    var drop = vflow * .55 * h;
    var sh = new T.Shape();
    if (kind === 'fork') {
      // 叉尾：两叶分明、深 V 叉口
      sh.moveTo(-.48, 0);
      sh.bezierCurveTo(-.60, h * .45, -.48 - L * .55, h * .8, -.48 - L, h * 1.12);
      sh.quadraticCurveTo(-.48 - L * .5, 0, -.48 - L, -h * 1.12);
      sh.bezierCurveTo(-.48 - L * .55, -h * .8, -.60, -h * .45, -.48, 0);
    } else if (kind === 'fan') {
      // 扇尾：圆整的大扇面（孔雀鱼）
      sh.moveTo(-.48, 0);
      sh.bezierCurveTo(-.58, h * .95, -.48 - L * .75, h * 1.2, -.48 - L, h * .95);
      sh.quadraticCurveTo(-.48 - L * 1.14, 0, -.48 - L, -h * .95);
      sh.bezierCurveTo(-.48 - L * .75, -h * 1.2, -.58, -h * .95, -.48, 0);
    } else if (kind === 'veil') {
      // 纱尾：整体拖长、上下摆向后下垂（斗鱼半月）
      var vtip = -.48 - L * (1 + vflow * .5);
      sh.moveTo(-.48, 0);
      sh.bezierCurveTo(-.62, h * 1.5, -.82, h * (1.9 - vflow * .6), vtip, h * (1.35 - vflow * 1.1) - drop * .35);
      sh.bezierCurveTo(-.86, h * .5 - drop * .8, -.86, -h * .7 - drop, vtip, -h * (1.28 - vflow) - drop);
      sh.bezierCurveTo(-.82, -h * (1.75 - vflow * .7), -.62, -h * 1.4, -.48, 0);
    } else if (kind === 'sword') {
      // 剑尾：上叶短、下叶拖出长剑（红箭）
      sh.moveTo(-.48, 0);
      sh.quadraticCurveTo(-.66, h * .55, -.48 - L * .55, h * .8);
      sh.quadraticCurveTo(-.72, 0, -.48 - L * 1.9, -h * .45 - drop * .4);
      sh.quadraticCurveTo(-.64, -h * .58, -.48, 0);
    } else if (kind === 'twin') {
      // 双尾：中央凹口分出两瓣（金鱼）
      sh.moveTo(-.48, 0);
      sh.bezierCurveTo(-.60, h * .7, -.84, h * 1.55, -.48 - L, h * 1.4);
      sh.quadraticCurveTo(-.48 - L * .62, h * .3, -.48 - L * .58, 0);
      sh.quadraticCurveTo(-.48 - L * .62, -h * .3, -.48 - L, -h * 1.4);
      sh.bezierCurveTo(-.84, -h * 1.55, -.60, -h * .7, -.48, 0);
    } else {
      // 圆尾：紧凑的圆桨（珍珠马甲）
      var L2 = L * .78;
      sh.moveTo(-.48, 0);
      sh.bezierCurveTo(-.56, h * .8, -.48 - L2 * .7, h, -.48 - L2, h * .62);
      sh.quadraticCurveTo(-.48 - L2 * 1.16, 0, -.48 - L2, -h * .62);
      sh.bezierCurveTo(-.48 - L2 * .7, -h, -.56, -h * .8, -.48, 0);
    }
    var g = new T.ShapeGeometry(sh, 14);
    normalizeUV(g);
    cupFin(g, .05 + vflow * .09);
    var p = g.attributes.position, cs = [];
    for (var i = 0; i < p.count; i++) {
      var u = clamp((-p.getX(i) - .48) / L, 0, 1);
      var cc = mixC(col('#ffffff'), col('#8db6bd'), u * .28);
      cs.push(cc.r, cc.g, cc.b);
    }
    g.setAttribute('color', new T.Float32BufferAttribute(cs, 3));
    return g;
  }

  /* 胸鳍扇面：形状画在 XY 平面再放平到 XZ，side=1 伸向 +z、-1 伸向 -z，
   * fL 为鳍长系数（鼠鱼类的长尖胸鳍靠它拉长拉尖），两只各自做镜像划水 */
  function pectoralFinGeo(hp, side, fL) {
    fL = fL || 1;
    var sh = new T.Shape();
    sh.moveTo(0, 0);
    sh.quadraticCurveTo(-hp * .18 * fL, side * hp * .34,
      -hp * (.18 + .34 * fL), side * hp * .26 * (.8 + .2 * fL));
    sh.quadraticCurveTo(-hp * .30 * fL, side * hp * .04, 0, 0);
    var g = new T.ShapeGeometry(sh, 8);
    normalizeUV(g);
    cupFin(g, .06);
    g.rotateX(Math.PI / 2);
    return g;
  }

  function sheetGeometry(x0, x1, y0, y1, hp) {
    var sh = new T.Shape();
    sh.moveTo(x0, y0);
    sh.bezierCurveTo(x0 + (x1 - x0) * .25, y1 * 1.05, x0 + (x1 - x0) * .7, y1, x1, y0 * .7);
    sh.lineTo(x1, y0 * .45); sh.lineTo(x0, y0 * .45); sh.closePath();
    return cupFin(normalizeUV(new T.ShapeGeometry(sh, 10)), .045);
  }

  /* 叶片纹理：白色底 + 深色叶脉（中脉/侧脉/边缘阴影），与顶点色相乘得到带脉络的叶片 */
  function leafTexture() {
    var key = 'leafveins';
    if (texCache[key]) return texCache[key];
    var cv = cv2d(64, 256), c = cv.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 64, 256);
    // 中脉：略微起伏的粗线
    c.strokeStyle = 'rgba(26,66,38,.55)'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.moveTo(32, 2);
    for (var y = 16; y <= 254; y += 16) c.lineTo(32 + Math.sin(y * .05) * 3, y);
    c.stroke();
    // 侧脉：从中脉斜向叶缘的细线
    c.lineWidth = 1.2; c.strokeStyle = 'rgba(26,66,38,.30)';
    for (var v = 1; v < 14; v++) {
      var vy = v * 18;
      [-1, 1].forEach(function (sg) {
        c.beginPath(); c.moveTo(32, vy);
        c.quadraticCurveTo(32 + sg * 14, vy + 6, 32 + sg * 28, vy + 16); c.stroke();
      });
    }
    // 叶缘阴影
    var eg = c.createLinearGradient(0, 0, 64, 0);
    eg.addColorStop(0, 'rgba(16,48,28,.32)'); eg.addColorStop(.2, 'rgba(16,48,28,0)');
    eg.addColorStop(.8, 'rgba(16,48,28,0)'); eg.addColorStop(1, 'rgba(16,48,28,.32)');
    c.fillStyle = eg; c.fillRect(0, 0, 64, 256);
    var tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding; tex.anisotropy = 8;
    texCache[key] = tex; return tex;
  }

  function leafGeometry(len, wid) {
    var key = 'lv2_' + len.toFixed(2) + '_' + wid.toFixed(2);
    if (leafCache[key]) return leafCache[key];
    var seg = 8, pos = [], uv = [], idx = [], cs = [];
    for (var i = 0; i <= seg; i++) {
      var u = i / seg;
      var w = Math.pow(Math.max(.001, Math.sin(Math.PI * Math.pow(u, .72))), .72) * wid;
      var y = u * len, x = Math.sin(u * 1.6) * len * .09, z = Math.sin(u * 1.6) * wid * .35;
      pos.push(x - w, y, z, x + w, y, z);
      uv.push(0, u, 1, u);
      var c = mixC(col('#194a2c'), col('#58a15a'), u * .70 + .08);
      cs.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i < seg) { var p = i * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
    }
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new T.Float32BufferAttribute(cs, 3));
    g.setIndex(idx); g.computeVertexNormals();
    leafCache[key] = g; return g;
  }

  /* 把同材质的小网格合并，显著降低 draw call */
  function mergeGeos(items) {
    var pos = [], nor = [], uvs = [], cls = [], idx = [], offset = 0;
    items.forEach(function (it) {
      var geo = it.g.clone();
      if (it.m) geo.applyMatrix4(it.m);
      var p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv, c = geo.attributes.color;
      var tint = it.tint || [1, 1, 1];
      for (var i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n ? n.getX(i) : 0, n ? n.getY(i) : 0, n ? n.getZ(i) : 1);
        uvs.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
        cls.push((c ? c.getX(i) : 1) * tint[0], (c ? c.getY(i) : 1) * tint[1], (c ? c.getZ(i) : 1) * tint[2]);
      }
      if (geo.index) { for (var j = 0; j < geo.index.array.length; j++) idx.push(geo.index.array[j] + offset); }
      else { for (var j2 = 0; j2 < p.count; j2++) idx.push(j2 + offset); }
      offset += p.count;
      geo.dispose();
    });
    var out = new T.BufferGeometry();
    out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    out.setAttribute('color', new T.Float32BufferAttribute(cls, 3));
    out.setIndex(idx);
    return out;
  }
  function mat4(p, r, s) {
    return new T.Matrix4().compose(
      new T.Vector3(p[0], p[1], p[2]),
      new T.Quaternion().setFromEuler(new T.Euler(r[0], r[1], r[2])),
      new T.Vector3(s[0], s[1], s[2]));
  }
  function disposeItems(items) {
    items.forEach(function (it) {
      var shared = false;
      for (var k in leafCache) if (leafCache[k] === it.g) { shared = true; break; }
      if (!shared) { try { it.g.dispose(); } catch (e) { } }
    });
  }

  /* ================= 鱼模型 ================= */
  function buildFish(sp) {
    if (sp.model && glbModels[sp.model.file]) return buildGlbFish(sp);
    var g = new T.Group(), lk = sp.look;
    var finL = D.finLenOf ? D.finLenOf(sp) : 1;   // 品种鳍长系数
    var bodyGeo = bodyGeometry(sp);
    var hp = bodyGeo.userData.hp;
    var bodyMat = new T.MeshStandardMaterial({
      map: fishTexture(sp), roughness: .5, metalness: .16, side: T.DoubleSide,
      bumpMap: scaleBumpTexture(), bumpScale: .02,
      envMap: fishEnv || null, envMapIntensity: .5
    });
    // 灯科鱼的荧蓝条带在幽暗水体里微微发光
    if (lk.pattern === 'neon') {
      bodyMat.emissive = new T.Color(0x9fe8ff);
      bodyMat.emissiveMap = bodyMat.map;
      bodyMat.emissiveIntensity = .20;
    }
    /* 摆尾放到 GPU：顶点着色器做行波（Lighthill 细长体理论的简化形），
     * 头部包络趋零、尾柄最大，CPU 每帧只更新几个 uniform，不再逐顶点改坐标。
     * uWavePow 是振幅包络指数：棍棒形整条鱼都在做波（1.35），球形只有尾柄在甩（2.4）。 */
    var wavePow = bodyGeo.userData.shape === 'anguilliform' ? 1.35 :
      bodyGeo.userData.shape === 'compressiform' ? 2.2 :
      bodyGeo.userData.shape === 'globiform' ? 2.4 : 2.0;
    bodyMat.onBeforeCompile = function (sh) {
      sh.uniforms.uWaveTime = { value: 0 };
      sh.uniforms.uWaveFreq = { value: 6 };
      sh.uniforms.uWaveAmp = { value: .125 };
      sh.uniforms.uWavePhase = { value: 0 };
      sh.uniforms.uWavePow = { value: wavePow };
      sh.vertexShader = 'uniform float uWaveTime;\nuniform float uWaveFreq;\nuniform float uWaveAmp;\nuniform float uWavePhase;\nuniform float uWavePow;\n' + sh.vertexShader;
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'float uBody = uv.x;',
        'float kBody = pow(uBody, uWavePow);',
        'float phBody = uWaveTime * uWaveFreq - (1.0 - uBody) * 4.3 + uWavePhase;',
        'transformed.z += sin(phBody) * uWaveAmp * kBody;',
        'transformed.y += sin(uWaveTime * uWaveFreq * 0.5 + uWavePhase) * 0.012 * kBody;'
      ].join('\n'));
      bodyMat.userData.shader = sh;
    };
    var body = new T.Mesh(bodyGeo, bodyMat);
    g.add(body);
    // 头部/中段的实际截面尺寸，供眼睛、鳃盖、胸鳍挂点使用
    var headH = bodyGeo.userData.headH, headW = bodyGeo.userData.headW, midH = bodyGeo.userData.midH;

    var finMat = new T.MeshStandardMaterial({
      map: finTexture(lk.fin), transparent: true, opacity: .82,
      side: T.DoubleSide, roughness: .55, metalness: .04, depthWrite: false
    });
    var tailGroup = new T.Group();
    var tail = new T.Mesh(finShape(lk.tail === 'fan' ? 'fan' : lk.tail, hp, finL), finMat);
    tailGroup.add(tail); g.add(tailGroup);

    // 背鳍形态分化：普通 / 高帆（神仙）/ 尖棘（鼠鳅）/ 低平（七彩）/ 飘长（斗鱼·马甲）
    var dorsal = (D.dorsalOf && D.dorsalOf(sp)) || 'normal';
    var finGrow = .55 + .45 * Math.pow(finL, 1.6);
    var dSpec = {
      normal: { x0: .16, x1: -.30, k: 1.55 },
      sail:   { x0: .20, x1: -.46, k: 2.35 },
      spike:  { x0: .34, x1: .02, k: 2.0 },
      low:    { x0: .14, x1: -.26, k: 1.0 },
      flow:   { x0: .16, x1: -.36, k: 2.1 }
    }[dorsal] || { x0: .16, x1: -.30, k: 1.55 };
    var analK = (dorsal === 'sail' || dorsal === 'flow') ? 1.85 : dorsal === 'low' ? .95 : 1.1;
    var finItems = [];
    finItems.push({ g: sheetGeometry(dSpec.x0, dSpec.x1, 0, midH * dSpec.k * finGrow, hp) });
    finItems.push({ g: sheetGeometry(-.16, -.42, 0, -midH * analK * finGrow, hp) });
    [-1, 1].forEach(function (side) {
      var pv = new T.Shape();
      pv.moveTo(-.02, 0); pv.quadraticCurveTo(-.10, -hp * .30, -.24, -hp * .22);
      pv.quadraticCurveTo(-.09, -hp * .05, -.02, 0);
      var pvs = .8 + .25 * Math.pow(finL, 1.2);
      finItems.push({ g: new T.ShapeGeometry(pv, 6),
        m: mat4([-.04, -midH * .52, side * headW * .38], [0, 0, -.45], [pvs, pvs, 1]) });
    });
    var finsMesh = new T.Mesh(mergeGeos(finItems), finMat);
    g.add(finsMesh); disposeItems(finItems);

    // 胸鳍：单独成对挂在鳃后，扇面朝侧后方，逐帧做「划水」动画（悬停勤划、冲刺贴身）
    var pectLen = Math.min(finL, 1.8);   // 胸鳍长度封顶，别抢了尾鳍的戏
    var pectR = new T.Mesh(pectoralFinGeo(hp, 1, pectLen), finMat);
    var pectL = new T.Mesh(pectoralFinGeo(hp, -1, pectLen), finMat);
    pectR.position.set(.13, -midH * .36, headW * .48);
    pectL.position.set(.13, -midH * .36, -headW * .48);
    pectR.rotation.x = .38; pectR.rotation.y = -.30;
    pectL.rotation.x = -.38; pectL.rotation.y = .30;
    g.add(pectR); g.add(pectL);

    // 眼睛：大而有神——深色眼窝 + 金属虹膜环 + 黑瞳孔 + 高光点；白化品系给红瞳
    var eyeR = hp * .15;
    var eyeY = headH * .40, eyeZ = headW * .82;
    var irisC = lk.eye || '#a8b06a';
    var noseX = bodyGeo.userData.noseX || .5;
    var eyeItems = [], irisItems = [], pupilItems = [], glintItems = [], gillItems = [];
    [-1, 1].forEach(function (side) {
      eyeItems.push({ g: new T.SphereGeometry(eyeR * 1.05, 12, 10),
        m: mat4([.345, eyeY, side * headW * .76], [0, 0, 0], [1, 1, .8]) });
      // 眼窝环：一圈深色棱环包住眼球，眼睛「长」在头上而不是贴在头上
      eyeItems.push({ g: new T.TorusGeometry(eyeR * 1.22, eyeR * .2, 8, 18),
        m: mat4([.345 + eyeR * .05, eyeY, side * headW * .80], [0, 0, 0], [1, 1, .7]) });
      irisItems.push({ g: new T.TorusGeometry(eyeR * .74, eyeR * .30, 8, 18),
        m: mat4([.345 + eyeR * .16, eyeY, side * (headW * .82)], [0, Math.PI / 2, 0], [1, 1, 1]) });
      pupilItems.push({ g: new T.SphereGeometry(eyeR * .50, 10, 8),
        m: mat4([.345 + eyeR * .28, eyeY, side * (headW * .88)], [0, 0, 0], [1, 1, .62]) });
      glintItems.push({ g: new T.SphereGeometry(eyeR * .22, 6, 6),
        m: mat4([.345 + eyeR * .32, eyeY + eyeR * .40, side * (headW * .94)], [0, 0, 0], [1, 1, 1]) });
      gillItems.push({ g: new T.TorusGeometry(midH * .92, .006, 4, 16, Math.PI * .95),
        m: mat4([.235, 0, side * headW * .55], [0, Math.PI / 2, -.35], [1, 1, 1]) });
    });
    // 吻端的嘴：一小块压扁的暗色唇部，头不再是无嘴的锥
    pupilItems.push({ g: new T.SphereGeometry(hp * .17, 10, 8),
      m: mat4([noseX * .99, -headH * .30, 0], [0, 0, 0], [1.7, .55, .8]) });
    function addMerged(list, material) {
      g.add(new T.Mesh(mergeGeos(list), material)); disposeItems(list);
    }
    addMerged(eyeItems, new T.MeshStandardMaterial({ color: 0x1a2428, roughness: .35, metalness: .1 }));
    addMerged(irisItems, new T.MeshStandardMaterial({
      color: new T.Color(irisC), roughness: .28, metalness: .6,
      envMap: fishEnv || null, envMapIntensity: .7
    }));
    addMerged(pupilItems, new T.MeshStandardMaterial({ color: 0x05080a, roughness: .16, metalness: .3 }));
    addMerged(glintItems, new T.MeshBasicMaterial({ color: 0xffffff }));
    addMerged(gillItems, new T.MeshBasicMaterial({ color: 0x20363c, transparent: true, opacity: .28 }));

    // 鼠鱼/鳅类的口须：两对小弯管，只有拉近镜头才显现（LOD 细节），并轻轻摆动
    var barbels = null;
    if (lk.barbel) {
      barbels = new T.Group();
      var bm = new T.MeshStandardMaterial({ color: 0xd9c9b0, roughness: .55, transparent: true, opacity: .85 });
      [-1, 1].forEach(function (side) {
        for (var bI = 0; bI < 2; bI++) {
          var pts = [new T.Vector3(0, 0, 0),
            new T.Vector3(-.07 - bI * .05, -.10 - bI * .07, side * .06),
            new T.Vector3(-.17 - bI * .07, -.24 - bI * .11, side * .10 + bI * .05)];
          var tube = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 8, .010, 4, false), bm);
          tube.position.set(.33, -headH * .18, side * headW * .40);
          barbels.add(tube);
        }
      });
      g.add(barbels);
    }

    g.userData = {
      sp: sp, body: body, bodyShape: bodyGeo.userData.shape,
      tailGroup: tailGroup, fins: finsMesh, pectL: pectL, pectR: pectR, barbels: barbels,
      bodyMat: bodyMat, finMat: finMat, hp: hp
    };
    return g;
  }

  /* ---------- 外部 GLB 模型 ----------
   * 品种配置 model: { file, yaw, pitch } 即改用 models/ 目录下的 GLB 文件。
   * 模型归一化到「单位体长」（与程序化模型同一坐标系），加载失败自动回退程序化。 */
  function hex01(h) {
    if (typeof h !== 'string' || h.charAt(0) !== '#') return null;
    var v = parseInt(h.substr(1), 16);
    if (isNaN(v)) return null;
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  /* 色型变体的「双色重映射」参数。
   * 旧的乘法染色只拿 look.c1 做比值，像熊猫鼠（淡粉白）→白鼠（淡黄白）这种
   * 主色几乎一样的色型，比值≈1，等于完全没染，所以三种鼠鱼长得一模一样。
   * 现在改用亮度做遮罩：亮部映射到 c1、暗部映射到 c2，
   * 于是「熊猫的黑白块」能变成「白鼠的红眼琥珀块」「花椒的褐色麻点」。 */
  function glbLookOf(sp) {
    if (!sp.look) return null;
    /* variantOf 是图鉴里合并掉的色型/鳍型变体；breedGroup 是商店里独立出售的
     * 培育品种（斗鱼·烈焰红 / 月光白等）。两者都可能是「共用基础品种 GLB、
     * 只靠 look 配色区分」。旧版只认 variantOf，breedGroup 品种完全不染色，
     * 于是写实化之后烈焰红 / 月光白和暹罗斗鱼长得一模一样。 */
    var baseId = sp.variantOf || sp.breedGroup;
    if (!baseId) return null;
    var base = D.get(baseId);
    if (!base || !base.look) return null;
    /* 有自己独立 GLB 的培育品种（黑摩尔 / 大正三色 / 孔雀鱼红礼服·蓝草尾）
     * 贴图本来就带正确颜色，再重映射反而会毁掉原色，直接跳过。 */
    if (base.model && sp.model && base.model.file !== sp.model.file) return null;
    var a = hex01(sp.look.c1), b = hex01(sp.look.c2 || sp.look.c1);
    if (!a || !b) return null;
    if (sp.look.c1 === base.look.c1 && (sp.look.c2 || '') === (base.look.c2 || '')) return null;
    /* breedGroup 共用的是写实 PBR 模型，用低权重只做色调偏移，保留鳞片纹理。
     * variantOf 变体维持原来的 0.88 强重映射，行为不变、零回归。 */
    return { a: a, b: b, soft: !sp.variantOf };
  }

  function applyGlbLook(mat, look) {
    mat.color = new T.Color(1, 1, 1);           // 染色交给 shader，避免重复相乘
    var ca = new T.Color(look.a[0], look.a[1], look.a[2]);
    var cb = new T.Color(look.b[0], look.b[1], look.b[2]);
    /* 每种配色单独一份程序缓存键。
     * 实测共用程序时，第二个材质拿不到自己的 tint uniform（光照管线里 uniform
     * 是按 program 缓存的），会出现「只有第一个色型染上色」—— 宁可多编译几份。 */
    var key = 'look:' + look.a.join('_') + '|' + look.b.join('_') + (look.soft ? '|soft' : '');
    mat.customProgramCacheKey = function () { return key; };
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.tintA = { value: ca };
      shader.uniforms.tintB = { value: cb };
      /* 挂在最后一个 chunk 上直接改 gl_FragColor：
       * 不依赖 map_fragment 之类中间变量，光照/贴图管线怎么改都不会失效。 */
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nuniform vec3 tintA;\nuniform vec3 tintB;')
        .replace('#include <dithering_fragment>', [
          '#include <dithering_fragment>',
          '{',
          '  float lumT = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));',
          '  float maskT = smoothstep(0.10, 0.60, lumT);',
          '  vec3 rcT = mix(tintB, tintA, maskT) * (0.70 + 0.55 * lumT);',
          '  gl_FragColor.rgb = mix(gl_FragColor.rgb, rcT, ' + (look.soft ? '0.45' : '0.88') + ');',
          '}'
        ].join('\n'));
    };
    mat.needsUpdate = true;
  }

  function buildGlbFish(sp) {
    var mc = glbModels[sp.model.file];
    var g = new T.Group();
    // 骨骼网格必须用 SkeletonUtils 深拷贝（每条鱼独立骨架），普通 clone 会共享骨架出鬼影
    var cloneFn = (T.SkeletonUtils && T.SkeletonUtils.clone) ? T.SkeletonUtils.clone : function (o) { return o.clone(true); };
    var inst = cloneFn(mc.root);
    /* 蒙皮网格的包围球是按绑定姿势算的，缩放/摆位后容易落在视锥外被剔除
     * （缩略图里会渲染成空白），外置模型一律关掉剔除。 */
    inst.traverse(function (o) { if (o.isMesh) { o.frustumCulled = false; if (o.material) o.material.side = T.DoubleSide; } });

    /* 色型共用同一份 GLB 网格，靠 shader 双色重映射区分（黑仙/金仙/银仙、白鼠/花椒、绿铜/白化）。
     * 材质必须 clone，否则会把所有实例一起染掉。 */
    var look = glbLookOf(sp);
    if (look) {
      inst.traverse(function (o) {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          applyGlbLook(o.material, look);
        }
      });
    }
    inst.rotation.y = mc.yaw;
    inst.rotation.x = mc.pitch || 0;
    inst.scale.setScalar(1 / mc.len);

    /* 螺虾的 GLB 是纯静态网格（骨骼 0 / 动画 0），整只是刚性几何。
     * 用顶点着色器按位置驱动摆动：虾的腿在腹部（几何仍是 Z-up，z 负侧），
     * 按 z 做掩码、相位随 x 错开，看起来就是在划水；螺只需要一点极缓的呼吸。
     * 注意不能改 GLB 本身——这里只动渲染期的顶点位移。 */
    var invertKind = sp.kind === 'invert'
      ? ((sp.look && sp.look.shell === 'shrimp') ? 'shrimp' : 'snail') : null;
    if (invertKind) {
      var waveShaders = [];
      inst.traverse(function (o) {
        if (!o.isMesh || !o.material) return;
        var mat = o.material.clone();
        mat.onBeforeCompile = function (shader) {
          shader.uniforms.uTime = { value: 0 };
          shader.uniforms.uAmp = { value: invertKind === 'shrimp' ? 0.030 : 0.008 };
          shader.vertexShader = 'uniform float uTime;\nuniform float uAmp;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            [
              '#include <begin_vertex>',
              'float legMask = smoothstep(0.16, -0.10, transformed.z);',
              'float wph = uTime * (uAmp > 0.02 ? 8.0 : 1.6) + transformed.x * 7.0;',
              'transformed.z += sin(wph) * uAmp * legMask;',
              'transformed.y += cos(wph * 0.9) * uAmp * 0.55 * legMask;'
            ].join('\n')
          );
          waveShaders.push(shader);
        };
        mat.needsUpdate = true;
        o.material = mat;
      });
      /* onBeforeCompile 要等首帧渲染才触发，所以先挂一个空数组的引用，
       * 之后 shader 编译时 push 进来，动画循环就能拿到 uniform 更新 uTime。 */
      g.userData.waveShaders = waveShaders;
    }
    /* 鳍长变体（长鳍蝶翼 / 大背鳍 / 半月大鳍…）：GLB 只有一套网格，靠拉伸鳍骨把鳍膜拉长。
     * 关键：只能沿「鳍的生长方向」单轴拉伸 —— 背鳍/臀鳍沿 Y，尾鳍沿 X。
     * 早先用了等比缩放，等于把薄薄的鳍膜往外均匀吹大，鳍会摊成一片平板，
     * 而且权重混合区的顶点被拉向两个方向，转动时就出现撕扯感（就是看到的那种失真）。 */
    var finMul = sp.finMul || 1;
    if (finMul > 1.01) {
      var fk = Math.min(2.6, 1 + (finMul - 1) * 2.4);   // 长鳍蝶翼 1.55 → 约 2.3 倍长度，蝶翼更舒展
      inst.traverse(function (o) {
        if (!o.isBone || !o.name) return;
        if (o.name === 'fin_dorsal' || o.name === 'fin_anal') o.scale.y *= fk;
        else if (o.name === 'fin_caudal') o.scale.x *= fk;
      });
    }
    var box = new T.Box3().setFromObject(inst), ctr = box.getCenter(new T.Vector3());
    inst.position.set(-ctr.x, -ctr.y, -ctr.z);
    g.add(inst);
    /* 两段动画：Swim 巡航、Turn 大摆幅（GLB 里由 add_turn_clip.py 生成）。
     * 转弯/加速时把权重切到 Turn，身体摆幅才会明显变大，而不是永远一个幅度。 */
    var mixer = null, clipAction = null, clipActionTurn = null, clipOmega = 0;
    if (mc.animations && mc.animations.length) {
      var clip = null, clipTurn = null;
      for (var ci = 0; ci < mc.animations.length; ci++) {
        if (mc.animations[ci].name === 'Turn') clipTurn = mc.animations[ci];
        else if (!clip) clip = mc.animations[ci];
      }
      if (!clip) clip = mc.animations[0];
      mixer = new T.AnimationMixer(inst);
      clipAction = mixer.clipAction(clip);
      clipAction.play();
      // 每条鱼错开相位：否则一群鱼尾巴同频同步，看着像机械装置
      clipAction.time = Math.random() * clip.duration;
      if (clipTurn) {
        clipActionTurn = mixer.clipAction(clipTurn);
        clipActionTurn.play();
        clipActionTurn.time = clipAction.time;
        clipActionTurn.timeScale = .5;   // 转身姿态慢一倍展开，避免和尾拍同频抽搐
        clipActionTurn.setEffectiveWeight(0);
      }
      clipOmega = Math.PI * 2 / Math.max(1e-3, clip.duration);
    }
    g.userData = {
      sp: sp, isModel: true, mixer: mixer, action: clipAction, actTurn: clipActionTurn,
      clipOmega: clipOmega, tScale: 1, weight: 1, turnW: 0, bodyShape: D.shapeOf(sp),
      tailGroup: null, fins: null, pectL: null, pectR: null, barbels: null, bodyMat: null, hp: .18
    };
    return g;
  }

  function loadExternalModels() {
    if (!glbLoader) return;
    var forceEmbed = location.search.indexOf('embed=1') >= 0;   // 测试内嵌路径用
    /* 串行队列：GLTF 解码/贴图是重活，并行会把主线程冻住好几秒（图鉴/页面卡顿），
     * 一个加载完歇 30ms 再下一个，页面全程保持响应 */
    var queue = [];
    var seen = {};
    D.creatures.forEach(function (sp) {
      if (!sp.model || seen[sp.model.file]) return;
      seen[sp.model.file] = true;
      if (glbModels[sp.model.file] || glbFilesDone[sp.model.file]) return;
      glbFilesDone[sp.model.file] = true;
      queue.push(sp);
    });
    /* 布景石头不属于 creatures，单独补进加载队列（用最简的伪品种条目，
     * onLoaded 只用到 model.file，swapCreatureModel 不会匹配到任何生物）。 */
    Object.keys(ROCK_GLB).forEach(function (st) {
      var f = ROCK_GLB[st];
      if (seen[f] || glbModels[f] || glbFilesDone[f]) return;
      seen[f] = true;
      glbFilesDone[f] = true;
      queue.push({ model: { file: f, yaw: 0 } });
    });
    /* 缸里真正用到的模型文件（当前缸内的品种 + 当前风格的石头），其余是图鉴品种 */
    var inTankFile = {};
    if (curState && curState.creatures) {
      curState.creatures.forEach(function (c) {
        var s2 = D.get(c.specId);
        if (s2 && s2.model) inTankFile[s2.model.file] = true;
      });
    }
    if (curState && curState.aqua && curState.aqua.rock) {
      var st0 = curState.aqua.rock.style || 'pebble';
      if (ROCK_GLB[st0]) inTankFile[ROCK_GLB[st0]] = true;
    }
    queue.sort(function (a, b) {
      return (inTankFile[a.model.file] ? 0 : 1) - (inTankFile[b.model.file] ? 0 : 1);
    });

    /* 注意：不在这里用 GLB 重画缩略图。
     * 离屏渲染 45k 面的蒙皮模型 + readPixels 在软件渲染环境下会长时间卡住主线程，
     * 十几张连着做能把首屏拖死（实测直接卡住不动）。
     * 图鉴/商店的图标改用 tools/make_thumbs.py 预渲染的静态 PNG（见 drawIcon），
     * 成本为零，而且和展示台里的模型是同一份模型渲出来的。 */
    function drainThumbs() {
      /* 石头 GLB 是在 buildStatic 之后才到位的，队列跑完统一重建一次静态场景换装。
       * 只做一次，避免每个模型加载完都 rebuild 造成连续卡顿。 */
      try { if (curState) rebuild(curState); } catch (err) { console.warn('布景石头换装失败', err); }
      if (handlers.modelsLoaded) handlers.modelsLoaded();
    }

    /* 只把「缸里真正用到的模型」放进第一波；图鉴里才会出现的品种
     * 等鱼缸稳定下来再慢慢补，首屏不用为它们等十几个解析。 */
    var tailDelayed = false;
    function processNext() {
      if (!queue.length) { __mark('allModels'); drainThumbs(); return; }
      var nextSp = queue[0];
      if (!inTankFile[nextSp.model.file] && !tailDelayed) {
        tailDelayed = true;                 // 剩下的都是图鉴品种，让鱼缸先跑起来
        setTimeout(processNext, 2600);
        return;
      }
      var sp = queue.shift();
      var onLoaded = function (gltf) {
        /* 任何一个模型解析出错都不能让队列断掉：
         * 以前这里没有 try/catch，某个坏文件一抛异常，后面的模型就再也不加载，
         * modelsLoaded 也永远不触发（图标、图鉴都停在半成品状态）。 */
        try {
          var root = gltf.scene;
          var box = new T.Box3().setFromObject(root), size = box.getSize(new T.Vector3());
          var len = Math.max(size.x, size.y, size.z, .001);
          var anims = sanitizeClips(gltf.animations);   // 乱序轨道会导致 mixer.update 卡死，先消毒
          glbModels[sp.model.file] = {
            root: root, len: len, yaw: sp.model.yaw || 0, pitch: sp.model.pitch || 0,
            animations: anims
          };
          if (!__perf.marks.firstModel) __mark('firstModel');
          // 已入缸的实例换装
          Object.keys(objs).forEach(function (id) {
            if (objs[id].sp && objs[id].sp.model && objs[id].sp.model.file === sp.model.file) swapCreatureModel(id);
          });
        } catch (err) {
          glbFilesDone[sp.model.file] = true;
          window.__modelErr = window.__modelErr || {};
          window.__modelErr[sp.model.file] = (err && err.message ? err.message : String(err));
        }
        setTimeout(processNext, 30);
      };
      /* 三级加载：http(s) 走 models/ URL；file://（或 URL 失败、?embed=1）注入
       * js/models/<名字>.js 再解码；都没有则回退程序化模型 */
      var isFile = location.protocol === 'file:';
      if (isFile || forceEmbed) {
        ensureEmbedded(sp.model.file, function (ok) {
          if (ok) loadEmbedded(sp.model.file, onLoaded);
          else {
            console.warn('模型 ' + sp.model.file + ' 缺少内嵌包：node tools/build-models.js');
            setTimeout(processNext, 30);
          }
        });
        return;
      }
      /* 同样带版本号：否则 http 下替换了 GLB，Chrome 仍拿缓存里的旧模型
       * （实测表现为「模型明明改了，缸里还挂着旧砂盘」）。 */
      var glbUrl = 'models/' + sp.model.file +
        (window.AW_MODEL_VER ? '?v=' + window.AW_MODEL_VER : '');
      glbLoader.load(glbUrl, function (gltf) { onLoaded(gltf); }, undefined, function () {
        ensureEmbedded(sp.model.file, function (ok) {
          if (ok) loadEmbedded(sp.model.file, onLoaded);
          else setTimeout(processNext, 30);
        });
      });
    }
    processNext();
  }

  /* 按需注入 js/models/<名字>.js —— file:// 下唯一可行的读取方式。
   * 每个模型单独一个脚本，首屏只加载真正用到的那一个。 */
  var embedding = {};
  function ensureEmbedded(file, cb) {
    if (window.AW_MODELS && window.AW_MODELS[file]) return cb(true);
    if (embedding[file]) { embedding[file].push(cb); return; }
    embedding[file] = [cb];
    var done = function (ok) {
      var list = embedding[file] || [];
      delete embedding[file];
      list.forEach(function (fn) { fn(ok); });
    };
    /* 带版本号注入，绕开 file:// 下 js 被缓存导致模型停在旧版本的问题；
     * 万一某些环境不接受带参数的 file 路径，再退回不带参数的地址。 */
    var el = document.createElement('script');
    var ver = window.AW_MODEL_VER ? ('?v=' + window.AW_MODEL_VER) : '';
    el.src = 'js/models/' + file + '.js' + ver;
    el.onload = function () { done(!!(window.AW_MODELS && window.AW_MODELS[file])); };
    el.onerror = function () {
      if (ver) {
        var el2 = document.createElement('script');
        el2.src = 'js/models/' + file + '.js';
        el2.onload = function () { done(!!(window.AW_MODELS && window.AW_MODELS[file])); };
        el2.onerror = function () { done(false); };
        document.head.appendChild(el2);
      } else {
        done(false);
      }
    };
    document.head.appendChild(el);
  }

  /* 动画轨道消毒：部分导出器会把时间轴交错写入（0, 0.5, 0.04, 0.54…），
   * 升序假定被破坏后 mixer.update 永不返回（卡死整个页面）。
   * 这里按时间重排每条轨道（values 同步换位），并丢弃空/畸形轨道。 */
  /* 动画轨道消毒：
   * 1) 部分导出器把时间轴交错写入（t0,t16,t1,t17…），排序修复插值器区间搜索；
   * 2) 神仙鱼这类导出器的 input(132) 与 output(33×4) 数量不一致 → valueSize=1，
   *    而 QuaternionLinearInterpolant 采样步长硬编码 4 → l 永远追不上目标 →
   *    mixer.update 永不返回（整页卡死）。按四元数步长 4 截齐 times/values。
   * 3) 丢弃空/畸形轨道，重算 clip.duration。 */
  function sanitizeClips(anims) {
    if (!anims || !anims.length) return [];
    var good = [];
    anims.forEach(function (clip) {
      var bad = false;
      (clip.tracks || []).forEach(function (tr) {
        var n = tr.times.length;
        if (n < 2) { bad = true; return; }
        // 1) 时间轴排序
        var idx = [];
        for (var k = 0; k < n; k++) idx.push(k);
        idx.sort(function (a, b) { return tr.times[a] - tr.times[b]; });
        var stride = Math.max(1, Math.floor(tr.values.length / n));
        var st = new Float32Array(n), sv = new Float32Array(n * stride);
        for (var k2 = 0; k2 < n; k2++) {
          st[k2] = tr.times[idx[k2]];
          for (var c2 = 0; c2 < stride; c2++) sv[k2 * stride + c2] = tr.values[idx[k2] * stride + c2];
        }
        tr.times = st; tr.values = sv;
        // 2) 四元数轨道 valueSize 必须 = 4（插值器步长硬编码），不符则按 4 截齐
        //    压缩版 three 里 ValueTypeName 挂在实例上（constructor 上取不到）
        var isQuat = tr.ValueTypeName === 'quaternion' || (tr.name || '').slice(-11) === '.quaternion';
        if (isQuat && tr.values.length !== tr.times.length * 4) {
          var samples = Math.floor(tr.values.length / 4);
          if (samples < 2) { bad = true; return; }
          if (tr.times.length > samples) tr.times = tr.times.slice(0, samples);
          tr.values = tr.values.slice(0, tr.times.length * 4);
          if (tr.values.length !== tr.times.length * 4) { bad = true; return; }
        }
      });
      if (bad) { console.warn('丢弃畸形动画轨道:', clip.name || '(未命名)'); return; }
      // 3) 重算 duration（导出器可能没写，NaN/0 时长会让动画状态机死循环）
      var dur = 0;
      clip.tracks.forEach(function (tr) { var n = tr.times.length; if (n) dur = Math.max(dur, tr.times[n - 1]); });
      if (isFinite(dur) && dur > 0) clip.duration = dur;
      if (!(clip.duration > 0)) { console.warn('丢弃无有效时长的动画:', clip.name || '(未命名)'); return; }
      good.push(clip);
    });
    return good;
  }

  function loadEmbedded(file, onLoaded) {
    try {
      var b64 = window.AW_MODELS[file];
      var bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      glbLoader.parse(bytes.buffer, '', onLoaded, function () {
        console.warn('内嵌模型解析失败:', file);
      });
    } catch (e) {
      console.warn('内嵌模型解码失败:', file, e);
    }
  }

  function swapCreatureModel(id) {
    var rec = objs[id];
    if (!rec || !rec.sp || !rec.sp.model) return;
    var parent = rec.group.parent;
    if (!parent) return;
    parent.remove(rec.group);
    var pi = pickables.indexOf(rec.group);
    if (pi >= 0) pickables.splice(pi, 1);
    var sp = rec.sp;
    rec.group = sp.kind === 'fish' ? buildFish(sp) : sp.kind === 'plant' ? buildPlant(sp) : buildInvert(sp);
    rec.group.userData.creatureId = id;
    parent.add(rec.group);
    pickables.push(rec.group);
  }

  /* ================= 水草模型 ================= */
  /* 外置水草模型：GLB 只有一棵，按品种归一化到「高度 = full、底部贴 y=0」，
   * 之后 syncCreatures 那套按生长比例缩放的逻辑可以原样复用。
   *
   * 注意两套坐标系：AI 文生 3D 的摆件多以 Z 为竖直轴（长轴在 -Z），
   * 而 three 场景是 Y-up。这里用独立的 fix 层扶正，不能改 GLB 根节点自带的旋转。
   * model.axis 可显式指定 'y' / 'z' / 'x'，缺省时按包围盒最长轴推断。
   * AI 摆件自带的砂盘底座已由 tools/trim_decor_base.py 从几何里删除——
   * 早先用 model.baseCut 把整株下沉是错的：syncCreatures 按生长比例缩放
   * g.scale.y = r，幼株会把下沉量一起缩小，圆盘又露在砂面上。
   * baseCut 仍保留为可选参数（默认 0），供以后未裁剪的摆件临时使用。 */
  function buildGlbPlant(sp) {
    var mc = glbModels[sp.model.file];
    var g = new T.Group();
    var cloneFn = (T.SkeletonUtils && T.SkeletonUtils.clone) ? T.SkeletonUtils.clone : function (o) { return o.clone(true); };
    var inst = cloneFn(mc.root);
    inst.traverse(function (o) { if (o.isMesh) { o.frustumCulled = false; if (o.material) o.material.side = T.DoubleSide; } });

    var fix = new T.Group();
    fix.add(inst);
    inst.updateMatrixWorld(true);
    var b0 = new T.Box3().setFromObject(inst);
    var s0 = b0.getSize(new T.Vector3());
    var axis = (sp.model.axis || '').toLowerCase();
    if (!axis) {
      if (s0.z > s0.y * 1.10 && s0.z >= s0.x) axis = 'z';
      else if (s0.x > s0.y * 1.10 && s0.x > s0.z) axis = 'x';
      else axis = 'y';
    }
    /* AI 产物的 GLB 常自带 root 旋转（node[0] 四元数 = 绕 X +90°），
     * 加载后 bbox 其实已经是 Y-up。这时再按声明的 axis 扶正就会多转一次，
     * 金鱼藻这类细长草会直接躺平。所以声明轴必须真的是当前最长轴才扶正。 */
    var isFlatPl = !!(sp.floating || sp.shape === 'float');
    if (isFlatPl) {
      axis = 'y';
    } else {
      var mx0 = Math.max(s0.x, s0.y, s0.z);
      var declaredLen = axis === 'z' ? s0.z : axis === 'x' ? s0.x : s0.y;
      if (declaredLen < mx0 * 0.98) axis = 'y';
    }
    // 绕 X：y' = -z（-Z 长轴 → +Y）；绕 Z：y' = -x（-X 长轴 → +Y）
    if (axis === 'z') fix.rotation.x = (Math.abs(b0.min.z) > Math.abs(b0.max.z)) ? Math.PI / 2 : -Math.PI / 2;
    else if (axis === 'x') fix.rotation.z = (Math.abs(b0.min.x) > Math.abs(b0.max.x)) ? -Math.PI / 2 : Math.PI / 2;
    fix.updateMatrixWorld(true);

    var box = new T.Box3().setFromObject(fix);
    var size = box.getSize(new T.Vector3()), ctr = box.getCenter(new T.Vector3());
    var full = Math.max(.7, sp.maxH * TANK.h);
    /* 浮萍这类贴水面的极扁模型（高度只有 .01 量级）若按 Y 归一化会放大几十倍，
     * 整片变成巨盘；改用横向尺寸作参考轴。 */
    var flat = !!(sp.floating || sp.shape === 'float');
    var ref = flat ? Math.max(size.x, size.z) : size.y;
    var k = full / Math.max(ref, .001);
    var cut = flat ? 0 : Math.max(0, Math.min(.35, sp.model.baseCut || 0));
    var body = new T.Group();
    body.scale.setScalar(k);
    body.position.set(-ctr.x * k, (-box.min.y - size.y * cut) * k, -ctr.z * k);
    body.add(fix);
    // yaw 放在最外层，绕世界 Y 轴，不会被轴向扶正带偏
    var yawG = new T.Group();
    yawG.rotation.y = (sp.model.yaw || 0) + rnd(-.5, .5);
    yawG.add(body);
    g.add(yawG);
    g.userData = { sp: sp, isModel: true, full: full };
    return g;
  }

  function buildPlant(sp) {
    if (sp.model && glbModels[sp.model.file]) return buildGlbPlant(sp);
    var g = new T.Group();
    var full = Math.max(.7, sp.maxH * TANK.h);
    var mat = new T.MeshStandardMaterial({ vertexColors: true, map: leafTexture(), side: T.DoubleSide, roughness: .8, transparent: true, opacity: .96 });
    var items = [], tint, i;

    if (sp.shape === 'float') {
      tint = [.85, 1.10, .70];
      for (i = 0; i < 30; i++) {
        items.push({ g: new T.CircleGeometry(rnd(.10, .20), 7),
          m: mat4([rnd(-2.4, 2.4), rnd(-.02, .02), rnd(-1.3, 1.3)], [-Math.PI / 2, 0, 0], [rnd(1.1, 1.7), 1, 1]), tint: tint });
      }
    } else if (sp.shape === 'moss') {
      tint = [.58, .88, .60];
      for (i = 0; i < 14; i++) {
        items.push({ g: new T.IcosahedronGeometry(rnd(.22, .40), 1),
          m: mat4([rnd(-.8, .8), rnd(.08, .7), rnd(-.55, .55)], [0, 0, 0], [1, rnd(.55, .9), .8]), tint: tint });
      }
    } else if (sp.shape === 'carpet') {
      tint = [.80, 1.05, .70];
      for (i = 0; i < 42; i++) {
        items.push({ g: new T.CylinderGeometry(.004, .018, rnd(.35, 1) * full, 3),
          m: mat4([rnd(-1, 1), full * .35, rnd(-.5, .5)], [rnd(-.2, .2), 0, rnd(-.30, .30)], [1, 1, 1]), tint: tint });
      }
    } else if (sp.shape === 'needle' || sp.shape === 'stem') {
      tint = [.72, 1.0, .75];
      items.push({ g: new T.CylinderGeometry(.018, .038, full, 6),
        m: mat4([0, full / 2, 0], [0, 0, 0], [1, 1, 1]), tint: [.35, .62, .38] });
      var tiers = Math.max(5, Math.round(full / .48));
      for (var ti = 1; ti <= tiers; ti++) {
        var y = full * ti / (tiers + 1);
        var count = sp.shape === 'needle' ? 7 : 2;
        for (var a = 0; a < count; a++) {
          var ang = (a / count) * Math.PI * 2 + ti * .7;
          var len = (sp.shape === 'needle' ? .42 : .34) * (1 - ti / (tiers + 2) * .35);
          items.push({ g: leafGeometry(len, sp.shape === 'needle' ? .035 : .085),
            m: mat4([0, y, 0], [0, ang, sp.shape === 'needle' ? .85 : .65], [1, 1, 1]), tint: tint });
        }
      }
    } else {
      tint = [.85, 1.0, .82];
      var stemH = full * .18;
      items.push({ g: new T.CylinderGeometry(.025, .045, stemH, 6),
        m: mat4([0, stemH / 2, 0], [0, 0, 0], [1, 1, 1]), tint: [.35, .60, .36] });
      var n = sp.shape === 'sword' ? 11 : 8;
      for (var li = 0; li < n; li++) {
        var len = full * rnd(.55, .92);
        var wid = len * (sp.shape === 'sword' ? .16 : .24) * sp.leafW;
        items.push({ g: leafGeometry(len, wid),
          m: mat4([0, stemH * .7, 0], [0, (li / n) * Math.PI * 2 + rnd(-.2, .2), rnd(.10, .34) * (li % 2 ? 1 : -1)], [1, 1, 1]), tint: tint });
      }
    }
    if (sp.root) {
      for (var ri = 0; ri < 5; ri++) {
        items.push({ g: new T.CylinderGeometry(.008, .022, .35, 4),
          m: mat4([rnd(-.16, .16), -.14, rnd(-.14, .14)], [0, 0, rnd(-.7, .7)], [1, 1, 1]), tint: [.5, .55, .4] });
      }
    }
    var mesh = new T.Mesh(mergeGeos(items), mat);
    g.add(mesh); disposeItems(items);
    g.userData = { sp: sp, leafMat: mat, leaves: [mesh], c1: col(sp.color), c2: col(sp.color2), full: full };
    return g;
  }

  /* ================= 螺虾模型 ================= */
  function shellTexture(sp) {
    var key = 'shell' + sp.id;
    if (texCache[key]) return texCache[key];
    var cv = cv2d(256, 128), c = cv.getContext('2d');
    c.fillStyle = sp.look.c1; c.fillRect(0, 0, 256, 128);
    if (sp.look.shell === 'nerite') {
      c.strokeStyle = 'rgba(40,34,28,.78)'; c.lineWidth = 9;
      for (var i = -2; i < 20; i++) {
        c.beginPath(); c.moveTo(i * 16, 0); c.bezierCurveTo(i * 16 + 20, 40, i * 16 - 8, 88, i * 16 + 14, 128); c.stroke();
      }
    } else {
      c.strokeStyle = 'rgba(90,55,30,.35)'; c.lineWidth = 3;
      for (var k = 0; k < 9; k++) { c.beginPath(); c.moveTo(0, k * 16); c.lineTo(256, k * 16 + 5); c.stroke(); }
    }
    var g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(0,0,0,.2)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 128);
    var tex = new T.CanvasTexture(cv); tex.encoding = T.sRGBEncoding;
    texCache[key] = tex; return tex;
  }

  function buildInvert(sp) {
    if (sp.model && glbModels[sp.model.file]) return buildGlbFish(sp);   // 虾/螺等外置模型走同一管线
    var g = new T.Group(), lk = sp.look;
    var bodyMat = new T.MeshStandardMaterial({ color: 0xc9b79a, roughness: .75, transparent: true, opacity: .92 });
    if (lk.shell === 'shrimp') {
      var sm = new T.MeshStandardMaterial({ color: 0xa9c8bd, roughness: .42, metalness: .08, transparent: true, opacity: .82 });
      for (var i = 0; i < 5; i++) {
        var seg = new T.Mesh(new T.SphereGeometry(.30 - i * .035, 10, 8), sm);
        seg.scale.set(1.25, .72, .82); seg.position.set(-i * .32, .1 + i * .025, 0);
        g.add(seg);
      }
      var tail = new T.Mesh(new T.ConeGeometry(.22, .34, 5), sm);
      tail.position.set(-1.55, .16, 0); tail.rotation.z = Math.PI / 2; g.add(tail);
      var lineMat = new T.LineBasicMaterial({ color: 0xd9efe7, transparent: true, opacity: .6 });
      var antGroup = new T.Group();
      for (var a = 0; a < 4; a++) {
        var pts = [new T.Vector3(.34, .16, 0), new T.Vector3(.85, .35 + a * .08, a * .06), new T.Vector3(1.35, .5 + a * .16, a * .1)];
        antGroup.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), lineMat));
      }
      g.add(antGroup);
      g.userData = { sp: sp, antGroup: antGroup };
      var eyeM = new T.MeshBasicMaterial({ color: 0x16201f });
      [-1, 1].forEach(function (s) {
        var e = new T.Mesh(new T.SphereGeometry(.045, 6, 6), eyeM);
        e.position.set(.38, .22, s * .12); g.add(e);
      });
    } else {
      var foot = new T.Mesh(new T.SphereGeometry(.46, 12, 10), bodyMat);
      foot.scale.set(1.35, .35, .85); foot.position.set(.18, -.16, 0); g.add(foot);
      var shellMat = new T.MeshStandardMaterial({ map: shellTexture(sp), roughness: .46, metalness: .08 });
      var shell = new T.Mesh(new T.SphereGeometry(.5, 20, 16), shellMat);
      if (lk.shell === 'cone') { shell.scale.set(.9, 1.35, .9); shell.position.y = .28; }
      else { shell.scale.set(1.05, .78, .9); shell.position.y = .16; }
      g.add(shell);
      // 壳上的螺旋缝
      var spiralPts = [];
      for (var s = 0; s <= 60; s++) {
        var u = s / 60, ang = u * Math.PI * 5;
        var rr = .50 * (1 - u * .82);
        spiralPts.push(new T.Vector3(Math.cos(ang) * rr * 1.05, .16 + .78 * (.5 - u * .5) + Math.sin(u * 3) * .02, Math.sin(ang) * rr * .9));
      }
      var spiral = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(spiralPts), 60, .012, 4, false),
        new T.MeshStandardMaterial({ color: 0x5d4326, roughness: .8 }));
      g.add(spiral);
      var antMat = new T.MeshBasicMaterial({ color: 0xd8c7a8 });
      var antGroup = new T.Group();
      [-1, 1].forEach(function (side) {
        var ant = new T.Mesh(new T.CylinderGeometry(.006, .012, .42, 4), antMat);
        ant.position.set(.62, .02, side * .14); ant.rotation.z = -.6; antGroup.add(ant);
      });
      g.add(antGroup);
    }
    g.userData = g.userData || { sp: sp };
    g.userData.sp = sp; g.userData.antGroup = g.userData.antGroup || null;
    return g;
  }

  /* ================= 静态景物 ================= */
  /* 商店「造景」tab 买到的沉木：一根随机枝形。
   * shape 0..3 决定倾斜方向与分枝数，seed 保证同一件每次重建都长一样。
   * h/thick 由调用方按当前缸尺寸算好，所以换缸时整根等比缩放、不会戳出水面。 */
  function makeWoodPiece(wx, by, wz, h, thick, shape, seed, mat) {
    var g = new T.Group();
    var lean = (shape === 1 ? .12 : shape === 2 ? -.10 : shape === 3 ? .02 : .06)
      + (hash('wl' + seed) - .5) * .10;
    var curl = (hash('wc' + seed) - .5) * .5;
    var pts = [
      new T.Vector3(wx, by, wz),
      new T.Vector3(wx + lean * h * .35, by + h * .34, wz + curl * thick),
      new T.Vector3(wx + lean * h * .72, by + h * .70, wz - curl * thick * 2),
      new T.Vector3(wx + lean * h, by + h, wz + curl * thick)
    ];
    var curve = new T.CatmullRomCurve3(pts);
    g.add(new T.Mesh(new T.TubeGeometry(curve, 20, thick, 7, false), mat));
    var nb = [1, 2, 1, 3][shape] || 1;
    for (var b = 0; b < nb; b++) {
      var t0 = Math.min(.88, .36 + b * .17 + hash('wt' + seed + b) * .10);
      var a = curve.getPoint(t0);
      var dir = (b % 2 ? 1 : -1) * (.30 + hash('wd' + seed + b) * .35);
      var bp = [a,
        new T.Vector3(a.x + dir * h * .28, a.y + h * .13, a.z + thick),
        new T.Vector3(a.x + dir * h * .48, a.y + h * .28, a.z - thick * 1.5)];
      g.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(bp), 10, thick * .55, 6, false), mat));
    }
    return g;
  }

  /* 石头：style = pebble 鹅卵石（圆润） | angular 棱角碎石（尖锐） | slate 板岩叠层（片状堆叠） */
  function makeRockStyled(style, r, color, seed) {
    if (style === 'slate') {
      var grp = new T.Group(), sm = new T.MeshStandardMaterial({ color: color, roughness: .88, metalness: .04 });
      var n = 2 + ((hash('sl' + seed) * 2.4) | 0);
      for (var i = 0; i < n; i++) {
        var bw = r * (1.25 - i * .22), bh = .10 + hash('sh' + seed + '_' + i) * .08, bd = r * .55;
        var slab = new T.Mesh(new T.BoxGeometry(bw, bh, bd), sm);
        slab.position.y = i * (bh + .028);
        slab.rotation.y = hash('sr' + seed + '_' + i) * 1.2 - .6;
        grp.add(slab);
      }
      return grp;
    }
    // 用共享顶点的球体做确定性形变，避免非索引几何逐顶点随机造成面撕裂
    var amp = style === 'angular' ? .26 : .13;
    var g = new T.SphereGeometry(r, 12, 9), p = g.attributes.position;
    for (var vi = 0; vi < p.count; vi++) {
      var x = p.getX(vi), y = p.getY(vi), z = p.getZ(vi);
      var def = 1 + amp * Math.sin(x * 3.1 + y * 2.3) + amp * .7 * Math.cos(z * 4.4 + y * 1.9);
      p.setXYZ(vi, x * def, y * def * (style === 'angular' ? .60 : .68), z * def);
    }
    g.computeVertexNormals();
    return new T.Mesh(g, new T.MeshStandardMaterial({ color: color, roughness: .96, metalness: .02 }));
  }

  /* 外置石头模型：风格 → GLB 文件。模型还没到位（首屏）或加载失败时
   * 自动回退到 makeRockStyled，缸里不会出现空石头位。 */
  var ROCK_GLB = { pebble: 'rock_pebble.glb', angular: 'rock_lava.glb', slate: 'rock_slate.glb' };

  function buildGlbRock(style, r, color, seed) {
    var file = ROCK_GLB[style];
    var mc = file && glbModels[file];
    if (!mc) return makeRockStyled(style, r, color, seed);
    var cloneFn = (T.SkeletonUtils && T.SkeletonUtils.clone) ? T.SkeletonUtils.clone : function (o) { return o.clone(true); };
    var inst = cloneFn(mc.root);
    // 沿用色型那套双色重映射：亮部=玩家选的石色，暗部=同色压暗，纹理明暗保留
    var c = new T.Color(color || '#46595c');
    var look = { a: [c.r, c.g, c.b], b: [c.r * .38, c.g * .38, c.b * .38] };
    inst.traverse(function (o) {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      /* disposeStatic 重建时会 dispose 静态组里所有几何与材质，
       * 所以每块石头都要深拷贝，不能共享 GLB 模板的资源。 */
      o.geometry = o.geometry.clone();
      o.material = o.material.clone();
      applyGlbLook(o.material, look);       // clone 之后再挂，Material.clone 不会复制 onBeforeCompile
    });
    inst.updateMatrixWorld(true);
    var box = new T.Box3().setFromObject(inst);
    var size = box.getSize(new T.Vector3()), ctr = box.getCenter(new T.Vector3());
    var rad = Math.max(size.x, size.z) * .5;
    var k = r / Math.max(rad, .001);
    var g = new T.Group();
    inst.scale.setScalar(k);
    inst.position.set(-ctr.x * k, -box.min.y * k - r * .46, -ctr.z * k);
    g.add(inst);
    g.rotation.y = hash('rky' + seed) * Math.PI * 2;
    g.userData.isModel = true;
    return g;
  }

  function applyDims(s) {
    /* 传 state 而不是 tankSize：D.tank 会优先读 s.tankDims（自定义长宽高） */
    var t = D.tank(s || { l: 90, w: 30, h: 37 });
    TANK.w = t.w; TANK.h = t.h; TANK.d = t.d;
    BASE_Y = -TANK.h / 2 + 0.5;
    WATER_Y = TANK.h / 2 - 0.22;
    PXCM = (t.cm ? TANK.w / t.cm : 25.5 / 90) * FISH_VIS;
    computeBaseDist();
  }

  function buildLights() {
    lights.amb = new T.AmbientLight(0x8ec3d1, .42); scene.add(lights.amb);
    lights.hemi = new T.HemisphereLight(0xd9f7ff, 0x0a2832, .30); scene.add(lights.hemi);
    lights.sun = new T.DirectionalLight(0xe8fbff, 1.18); lights.sun.position.set(-5, 11, 7); scene.add(lights.sun);
    lights.fill = new T.PointLight(0x6fd0e0, .32, 30); lights.fill.position.set(4, 2, 5); scene.add(lights.fill);
    lights.top = new T.PointLight(0xbdf3ff, .42, 24); lights.top.position.set(0, WATER_Y + 1, 0); scene.add(lights.top);
  }

  function buildStatic(s) {
    staticGroup = new T.Group();
    shellObjs = []; beams = []; bubbleData = []; rockPickables = [];
    var sub = D.substrate(s ? s.substrate : 'sand');
    var root = staticGroup;
    function addShell(o) { o.userData.shell = true; shellObjs.push(o); root.add(o); return o; }

    // 玻璃缸体
    var gm = new T.MeshPhysicalMaterial({ color: 0x69aebb, transparent: true, opacity: .10, roughness: .06, metalness: 0, side: T.DoubleSide, depthWrite: false });
    var back = new T.Mesh(new T.PlaneGeometry(TANK.w, TANK.h), gm.clone());
    back.material.opacity = .16; back.position.z = -TANK.d / 2; addShell(back);
    [-1, 1].forEach(function (sd) {
      var side = new T.Mesh(new T.PlaneGeometry(TANK.d, TANK.h), gm.clone());
      side.material.opacity = .09; side.rotation.y = Math.PI / 2; side.position.x = sd * TANK.w / 2; addShell(side);
    });
    // 缸框
    var frameMat = new T.MeshStandardMaterial({ color: 0xbfe3e6, roughness: .28, metalness: .45, transparent: true, opacity: .62 });
    var fw = .055;
    function bar(w, h, d, x, y, z) {
      var m = new T.Mesh(new T.BoxGeometry(w, h, d), frameMat);
      m.position.set(x, y, z); addShell(m);
    }
    [-1, 1].forEach(function (sy) {
      [-1, 1].forEach(function (sz) { bar(TANK.w, fw, fw, 0, sy * TANK.h / 2, sz * TANK.d / 2); });
      [-1, 1].forEach(function (sx) { bar(fw, fw, TANK.d, sx * TANK.w / 2, sy * TANK.h / 2, 0); });
    });
    [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) { bar(fw, TANK.h, fw, sx * TANK.w / 2, 0, sz * TANK.d / 2); }); });

    /* 底砂地形：按存档坡度设置堆出起伏（左高右低 / 沙丘 / 两高夹谷…），
     * 顶面网格 + 四周侧裙包到缸底，水草与食物落点都跟随砂面。 */
    var AQUA = (s && s.aqua) || {};
    var slope = AQUA.slope || 'flat';
    terrain.prof = function (wx) {
      var u = clamp((wx + TANK.w / 2) / TANK.w, 0, 1);
      if (slope === 'riseL') return (1 - u) * .85;
      if (slope === 'riseR') return u * .85;
      if (slope === 'mound') return Math.pow(Math.sin(Math.PI * u), 1.4) * .8;
      if (slope === 'valley') return Math.pow(Math.abs(u - .5) * 2, 1.3) * .6;
      return 0;
    };
    terrain.top = function (wx) { return BASE_Y + terrain.prof(wx) + .012; };

    // 顶面网格
    var sgx = 28, sgz = 14, spos = [], suv = [], sidx = [], si, sj;
    for (sj = 0; sj <= sgz; sj++) for (si = 0; si <= sgx; si++) {
      var sx2 = -TANK.w / 2 + TANK.w * si / sgx, sz2 = -TANK.d / 2 + TANK.d * sj / sgz;
      var sy2 = terrain.top(sx2) + (hash('sd' + si + '_' + sj) - .5) * .05;
      spos.push(sx2, sy2, sz2); suv.push(si / sgx * 5, sj / sgz * 2);
    }
    function svi(ii, jj) { return jj * (sgx + 1) + ii; }
    for (sj = 0; sj < sgz; sj++) for (si = 0; si < sgx; si++) {
      var sa = svi(si, sj), sb = svi(si, sj + 1), sc2 = svi(si + 1, sj), sd2 = svi(si + 1, sj + 1);
      sidx.push(sa, sb, sc2, sb, sd2, sc2);
    }
    // 侧裙：四条边从砂面向下包到缸底
    var sBottom = BASE_Y - .56;
    function skirt(pts) {
      var b0 = spos.length / 3;
      pts.forEach(function (pt) { spos.push(pt[0], terrain.top(pt[0]), pt[1]); suv.push(0, 0); });
      pts.forEach(function (pt) { spos.push(pt[0], sBottom, pt[1]); suv.push(0, 0); });
      for (var k = 0; k < pts.length - 1; k++) {
        var t0 = b0 + k, b1 = b0 + pts.length + k, t1 = b0 + k + 1, b2 = b0 + pts.length + k + 1;
        sidx.push(t0, b1, t1, t1, b1, b2);
      }
    }
    var fr = [], bk = [], lf = [], rt = [];
    for (si = 0; si <= sgx; si++) {
      var fx = -TANK.w / 2 + TANK.w * si / sgx;
      fr.push([fx, TANK.d / 2]); bk.push([fx, -TANK.d / 2]);
    }
    for (sj = 0; sj <= sgz; sj++) {
      var fz = -TANK.d / 2 + TANK.d * sj / sgz;
      lf.push([-TANK.w / 2, fz]); rt.push([TANK.w / 2, fz]);
    }
    skirt(fr); skirt(bk); skirt(lf); skirt(rt);
    var sandGeo = new T.BufferGeometry();
    sandGeo.setAttribute('position', new T.Float32BufferAttribute(spos, 3));
    sandGeo.setAttribute('uv', new T.Float32BufferAttribute(suv, 2));
    sandGeo.setIndex(sidx); sandGeo.computeVertexNormals();
    var sand = new T.Mesh(sandGeo,
      new T.MeshStandardMaterial({ map: noiseTexture(sub.base, sub.dark, 2600), color: sub.color, roughness: 1, side: T.DoubleSide }));
    root.add(sand);
    var pebbleMat = new T.MeshStandardMaterial({ color: 0x8d9384, roughness: .95 });
    var pebbles = new T.InstancedMesh(new T.IcosahedronGeometry(.075, 0), pebbleMat, 46);
    var mtx = new T.Matrix4(), q = new T.Quaternion(), pv = new T.Vector3(), sv = new T.Vector3();
    for (var i = 0; i < 46; i++) {
      var pxx = rnd(-TANK.w / 2 + .3, TANK.w / 2 - .3);
      pv.set(pxx, terrain.top(pxx) + .01, rnd(-TANK.d / 2 + .3, TANK.d / 2 - .3));
      var sc = rnd(.5, 1.4); sv.set(sc, sc * .55, sc);
      mtx.compose(pv, q, sv); pebbles.setMatrixAt(i, mtx);
    }
    pebbles.instanceMatrix.needsUpdate = true; root.add(pebbles);

    // 石头 / 沉木：设置面板那一组 + 商店「造景」tab 逐件添加的随机个体
    var rockCfg = AQUA.rock || {};
    var rStyle = rockCfg.style || 'pebble', rColor = rockCfg.color || '#46595c';
    var rSize = clamp(rockCfg.size || 1, .6, 1.6), rCount = clamp(Math.round(rockCfg.count || 4), 2, 7);
    var rockSlots = [[-.32, .62], [-.28, .42], [.315, .58], [.275, .36], [-.14, .30], [.10, .44], [-.42, .28], [.44, .28]];
    var rockGroup = new T.Group(); rockGroup.name = 'rocks';
    for (var rk = 0; rk < rCount && rk < rockSlots.length; rk++) {
      var slot = rockSlots[rk];
      var rpk = (AQUA.rockPos && AQUA.rockPos[rk]) || null;
      var rr = slot[1] * rSize * (rpk && rpk[2] ? rpk[2] : 1) * (.9 + hash('rksz' + rk) * .3);
      var rock = buildGlbRock(rStyle, rr, rColor, rk);
      /* 位置：玩家拖过的石头记在 aqua.rockPos（归一化 0..1），否则用固定槽位。
       * 旧代码这里用了 rnd()，每次重建造景石头都会随机跳位置——顺手换成确定性哈希。 */
      var rp = (AQUA.rockPos && AQUA.rockPos[rk]) || null;
      var rwx = rp ? (rp[0] - .5) * TANK.w : slot[0] * TANK.w;
      var rwz = rp ? (rp[1] - .5) * TANK.d * .62 : (hash('rkz' + rk) * 1.6 - .8);
      rock.position.set(rwx, BASE_Y + terrain.prof(rwx) + rr * .22, rwz);
      rock.userData.rockIdx = rk;
      rock.userData.rockLift = rr * .22;   // 拖拽时按砂面高度重新算 y
      rockPickables.push(rock);
      rockGroup.add(rock);
    }
    /* 商店买的青龙石：每件的形状、大小、位置独立随机。半径按缸宽/深的较小值算，
     * 乘实例系数后仍留得出缸壁余量；seed 让同一件每次重建长得一模一样。 */
    var DITEMS = (s && s.decorItems) || {};
    (DITEMS.rock || []).forEach(function (it, i) {
      var dr = Math.min(TANK.w, TANK.d) * .06 * it.s;
      var dx = (it.x - .5) * TANK.w, dz = (it.z - .5) * TANK.d * .62;
      var drk = buildGlbRock(it.shape || 'pebble', dr, rColor, 'dr' + it.seed + '_' + i);
      drk.position.set(dx, BASE_Y + terrain.prof(dx) + dr * .22, dz);
      drk.userData.decorKind = 'rock';
      drk.userData.decorIdx = i;
      drk.userData.rockLift = dr * .22;
      rockPickables.push(drk);
      rockGroup.add(drk);
    });
    root.add(rockGroup);

    /* 沉木：woodGroup 里放商店买到的多根随机枝形；没有实例时回填旧版单根，
     * 保证老存档 / 只开过工具条开关的缸不会空掉。组名仍是 'wood'，
     * decorOn.driftwood 的显隐逻辑无需改动。 */
    var woodMat = new T.MeshStandardMaterial({ color: 0x4a3626, roughness: .95 });
    var woodGroup = new T.Group(); woodGroup.name = 'wood';
    var woodList = DITEMS.wood || [];
    if (woodList.length) {
      woodList.forEach(function (it, i) {
        var wx = (it.x - .5) * TANK.w, wz = (it.z - .5) * TANK.d * .62;
        var wh = TANK.h * .26 * it.s;
        var wth = Math.max(.055, Math.min(TANK.w, TANK.d) * .012 * it.s);
        var piece = makeWoodPiece(wx, BASE_Y + terrain.prof(wx) + .04, wz,
          wh, wth, it.shape, it.seed + '_' + i, woodMat);
        piece.userData.decorKind = 'wood';
        piece.userData.decorIdx = i;
        piece.userData.rockLift = .04;
        rockPickables.push(piece);
        woodGroup.add(piece);
      });
    } else {
      var wd = AQUA.wood || {};
      var wxn = (wd.x != null ? wd.x : .11), wzn = (wd.z != null ? wd.z : .5), wsk = wd.s || 1;
      var wbx = (wxn - .5) * TANK.w, wbz = (wzn - .5) * TANK.d * .62;
      var woodBaseY = BASE_Y + terrain.prof(wbx) + .06;
      var woodPts = [new T.Vector3(wbx, woodBaseY, wbz + .2),
        new T.Vector3(wbx + .03 * TANK.w, woodBaseY + 1.0 * wsk, wbz - .2),
        new T.Vector3(wbx + .075 * TANK.w, woodBaseY + 1.4 * wsk, wbz + .1),
        new T.Vector3(wbx + .10 * TANK.w, woodBaseY + 2.4 * wsk, wbz - .3)];
      woodGroup.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(woodPts), 24, .17, 8, false), woodMat));
    }
    root.add(woodGroup);

    // 水面（平面视角下隐藏）
    var wt = rippleTexture();
    water = new T.Mesh(new T.PlaneGeometry(TANK.w, TANK.d, 20, 10),
      new T.MeshPhysicalMaterial({ map: wt, color: 0x9cdee6, transparent: true, opacity: .30,
        roughness: .12, metalness: .12, side: T.DoubleSide, depthWrite: false }));
    water.rotation.x = -Math.PI / 2; water.position.y = WATER_Y; water.renderOrder = 14; addShell(water);

    // 焦散光纹（贴着底砂）
    var ct = rippleTexture(); ct.repeat.set(3, 1.4);
    caustic = new T.Mesh(new T.PlaneGeometry(TANK.w, TANK.d),
      new T.MeshBasicMaterial({ map: ct, color: 0xb9f4ee, transparent: true, opacity: .10,
        blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    caustic.rotation.x = -Math.PI / 2; caustic.position.y = BASE_Y + .012; root.add(caustic);

    // 水下光柱
    var bt = beamTexture();
    for (var b = 0; b < 3; b++) {
      var beam = new T.Mesh(new T.PlaneGeometry(TANK.w * .17, TANK.h * 1.15),
        new T.MeshBasicMaterial({ map: bt, color: 0xd4fbf5, transparent: true, opacity: .30,
          blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
      beam.position.set((b - 1) * TANK.w * .30, .2, -TANK.d * .27 + b * TANK.d * .07);
      beam.rotation.z = (b - 1) * .075;
      beam.renderOrder = 6; root.add(beam); beams.push(beam);
    }

    // 气泡点云
    var bg = new T.BufferGeometry();
    bg.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(90 * 3), 3));
    bubbles = new T.Points(bg, new T.PointsMaterial({ map: bubbleTexture(), size: .17, transparent: true,
      opacity: .62, depthWrite: false, sizeAttenuation: true, blending: T.AdditiveBlending }));
    bubbles.renderOrder = 12; root.add(bubbles);
    for (var q2 = 0; q2 < 90; q2++) bubbleData.push({ x: 0, y: -100, v: 0, p: 0 });

    scene.add(root);
    applyViewMode(s ? s.viewMode : '3d');
    if (s) {
      var rc = scene.getObjectByName('rocks'), wd = scene.getObjectByName('wood');
      if (rc) rc.visible = !!s.decorOn.rocks;
      if (wd) wd.visible = !!s.decorOn.driftwood;
    }
  }

  function applyViewMode(mode) {
    var flat = mode === 'flat';
    shellObjs.forEach(function (o) { o.visible = !flat; });
    if (scene && scene.fog) scene.fog.density = flat ? .010 : .018;
    if (flat) { cam.taz = cam.az = 0; cam.tel = cam.el = .03; }
  }

  function disposeStatic() {
    if (!staticGroup) return;
    staticGroup.traverse(function (o) {
      if (o.geometry) { try { o.geometry.dispose(); } catch (e) { } }
      if (o.material) {
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) { try { m.dispose(); } catch (e) { } });
      }
    });
    scene.remove(staticGroup);
    staticGroup = null;
  }

  function rebuild(s) {
    if (!ready) return;
    applyDims(s);
    disposeStatic();
    buildStatic(s);
    if (lights.top) lights.top.position.set(0, WATER_Y + 1, 0);
    computeBaseDist();
    resize();
  }

  /* ================= 个体同步 ================= */
  function depthOf(c) { return (hash(c.id || 'x') - .5) * 3.4; }

  function spawn(c) {
    var sp = D.get(c.specId);
    if (!sp) return;
    var g = c.kind === 'fish' ? buildFish(sp) : c.kind === 'plant' ? buildPlant(sp) : buildInvert(sp);
    g.userData.creatureId = c.id;
    scene.add(g);
    var shadow = null;
    if (c.kind !== 'plant') {
      shadow = new T.Mesh(new T.CircleGeometry(.5, 16),
        new T.MeshBasicMaterial({ color: 0x041820, transparent: true, opacity: .16, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = BASE_Y + .02; shadow.renderOrder = 2;
      scene.add(shadow);
    }
    var vHash = hash(c.id + 'v');
    objs[c.id] = { group: g, sp: sp, kind: c.kind, phase: hash(c.id + 'p') * 6.283,
      z: depthOf(c), yaw: (hash(c.id + 'y') - .5) * .70, shadow: shadow,
      lenF: .93 + hash(c.id + 'l') * .15, hgtF: .88 + vHash * .26,
      tint: [.93 + hash(c.id + 'r') * .13, .94 + hash(c.id + 'g') * .10, .93 + hash(c.id + 'b') * .14] };
    pickables.push(g);
  }

  function disposeGroup(g) {
    if (g && g.userData && g.userData.isModel) return;   // GLB 克隆共享模板几何/材质，不可销毁
    g.traverse(function (o) {
      if (o.geometry) {
        var shared = false;
        for (var k in leafCache) if (leafCache[k] === o.geometry) { shared = true; break; }
        if (!shared) { try { o.geometry.dispose(); } catch (e) { } }
      }
      if (o.material) {
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) { try { m.dispose(); } catch (e) { } });
      }
    });
  }

  function remove(id) {
    var rec = objs[id];
    if (!rec) return;
    scene.remove(rec.group);
    if (rec.shadow) {
      scene.remove(rec.shadow);
      try { rec.shadow.geometry.dispose(); rec.shadow.material.dispose(); } catch (e) { }
    }
    var i = pickables.indexOf(rec.group);
    if (i >= 0) pickables.splice(i, 1);
    disposeGroup(rec.group);
    delete objs[id];
  }

  function syncCreatures(s, dt) {
    var seen = {};
    for (var i = 0; i < s.creatures.length; i++) {
      var c = s.creatures[i];
      seen[c.id] = 1;
      if (!objs[c.id]) spawn(c);
      var rec = objs[c.id], g = rec.group, sp = rec.sp;
      var px = (c.x - .5) * TANK.w;
      var py = ( .5 - c.y) * TANK.h;
      if (c.kind === 'plant') {
        var r = clamp(c.h / sp.maxH, .06, 1.12);
        // 布景摆位：拖拽过的水草记录了深度 zd，落点跟随底砂坡面
        var pz = c.zd != null ? (c.zd - .5) * TANK.d * .62 : rec.z * .5;
        // 缸内水流：过滤器常开时有一股稳定的推力，气泵再添一份紊流
        var flowK = (s.filterOn ? 1 : .42) + (s.airOn ? .32 : 0);
        if (sp.floating) {
          // 浮萍：贴着水面随波轻轻起伏、缓慢打转
          g.position.set(px, WATER_Y - .02 + Math.sin(t * .9 + rec.phase) * .035, pz);
          g.scale.set(.35 + r * 1.0, 1, .35 + r * 1.0);
          g.rotation.y = t * .05 * (rec.phase > Math.PI ? 1 : -1) + rec.phase;
        } else {
          g.position.set(px, terrain.top(px), pz);
          /* 长满的水草顶部不许穿出水面/顶玻璃：可用高度 = 水面 - 砂面 - 余量。
           * terrain.top() 返回的是世界坐标（BASE_Y 之上），旧写法又减了一次 BASE_Y，
           * 分子只剩「砂面厚度」约 0.5，yCap 常年卡在 0.69 —— 纵向被压低三成、
           * 横向却是 1.05 倍，宽叶草就整株趴在地上。 */
          var availH = WATER_Y - 0.06 - terrain.top(px);
          var yCap = Math.min(1, availH / Math.max(.001, sp.maxH * TANK.h));
          /* 横竖一起随生长收：原来横向下限 0.55 太高，幼株会变成「横向铺开、竖向极矮」
           * 的扁片。改成接近等比 + 小下限，幼株小一號但不会趴。 */
          var gx = Math.max(.30, r * 1.05);
          var gy = Math.max(.26, r * yCap);
          g.scale.set(gx, gy, gx);
        }
        g.rotation.z = Math.sin(t * .5 + rec.phase) * .05 * flowK;
        g.rotation.y = Math.sin(t * .3 + rec.phase) * .06;
        /* 叶片随水流慢慢摇：根部幅度趋近 0 的行波 + 叠一层高频轻颤，
         * 相位混入顶点横向位置，让同一株上不同叶子错开节拍，不再是整株「齐刷刷」摆。
         * 开销可控，隔帧更新。 */
        if (!g.userData.isModel && !sp.floating && sp.shape !== 'moss' && quality >= .62 && (frameTick + i) % 2 === 0) {
          var mesh = g.children[0], pa = mesh.geometry.attributes.position;
          if (!g.userData.pbase) g.userData.pbase = pa.array.slice(0);
          var pb = g.userData.pbase, fullP = g.userData.full || 1;
          for (var pv2 = 0; pv2 < pa.count; pv2++) {
            var vy2 = pb[pv2 * 3 + 1], vx2 = pb[pv2 * 3];
            var hv = Math.max(0, vy2 / fullP);
            var swA = Math.pow(hv, 1.6) * .05 * flowK;
            var swayX = (Math.sin(t * .85 + rec.phase + vy2 * 1.1 + vx2 * .8) +
              Math.sin(t * 1.9 + rec.phase * 1.7 + vy2 * .7) * .35) * swA;
            var swayZ = Math.cos(t * .6 + rec.phase * 1.3 + vy2 * .9 + vx2 * .5) * swA * .6;
            pa.setX(pv2, pb[pv2 * 3] + swayX);
            pa.setZ(pv2, pb[pv2 * 3 + 2] + swayZ);
          }
          pa.needsUpdate = true;
        }
        // 缺光黄化
        if (g.userData.leafMat) {
          var yl = c.yellow || 0;
          g.userData.leafMat.color.setRGB(1 - yl * .12, 1 - yl * .05, 1 - yl * .42);
        }
      } else if (c.kind === 'fish') {
        /* 深度：沿 z 轴漫游；转身时再往外甩一点，掉头才会走成一条 3D 弧线而不是原地平移 */
        var zw = (c.zw == null ? 0.5 : c.zw);
        var zT = (zw - 0.5) * TANK.d * 0.88;
        if (rec.dz == null) rec.dz = zT;
        rec.dz += (zT - rec.dz) * Math.min(1, dt * 2.2);
        g.position.set(px, py, rec.dz + (rec.turnArc || 0) * .55 + Math.sin(t * .35 + rec.phase) * .10);
        var sc = Math.max(.28, c.sizeCm * PXCM);
        g.scale.set(sc * rec.lenF, sc * rec.hgtF, sc);
        /* 转向不再瞬间掉头：朝向沿最短弧逐渐转过去，转弯时向圆心一侧侧倾（banking）。
         * 群游换向时能看到一整群鱼在「拐弯」，而不是集体闪现掉头。 */
        var vxW = c.vx * TANK.w, vzW = (c.vzw || 0) * TANK.d * .88;
        var mvLen = Math.sqrt(vxW * vxW + vzW * vzW);
        /* 偏航取真实速度方向，但夹在 ±49° 内：缸宽远大于进深，
         * 不夹的话横向速度一慢，鱼就会长时间正对/背对镜头，成了正面特写。 */
        /* 朝向 = 基准左右（+X / −X）+ 偏离角。
         * 之前直接夹 atan2 的结果：向左游时 atan2≈180°，被夹成 49°，
         * 头朝右身体却往左走 —— 这就是「倒退游泳」的来源。 */
        if (Math.abs(vxW) > .12) rec.baseYaw = vxW >= 0 ? 0 : Math.PI;
        if (rec.baseYaw == null) rec.baseYaw = 0;
        var dev = Math.atan2(vxW >= 0 ? -vzW : vzW, Math.max(Math.abs(vxW), 1e-4));
        dev = clamp(dev, -.85, .85);
        /* 偏离角低通：深度速度抖一下，朝向就跟着抖，这是「摇头」的来源之一 */
        rec.devS = (rec.devS == null ? dev : rec.devS + (dev - rec.devS) * Math.min(1, dt * 4.5));
        var targetYaw = mvLen > .05
          ? rec.baseYaw + rec.devS + rec.yaw
          : (rec.dispYaw == null ? rec.yaw : rec.dispYaw);
        if (rec.dispYaw == null) rec.dispYaw = targetYaw;
        var dYaw = ((targetYaw - rec.dispYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        /* 转身速率随速度变化，并且用「比例 + 限速」：
         * 原来只按最大角速度匀速转、到角就急停，看着像甩头。加上缓动后起步收尾都柔和。 */
        var spdNorm = Math.min(1, Math.abs(c.vx) / .06);
        var yawRate = st === 'dart' ? 4.4 : (1.7 + 1.5 * spdNorm);
        var yawStep = clamp(dYaw * Math.min(1, dt * 6.5), -dt * yawRate, dt * yawRate);
        rec.dispYaw += yawStep;
        rec.turn = Math.abs(dYaw);
        var yawVel = yawStep / Math.max(dt, 1e-4);
        var arcT = Math.min(1, Math.abs(dYaw) / 2.0) * Math.sign(dYaw || 1);
        rec.turnArc = (rec.turnArc || 0) + (arcT - (rec.turnArc || 0)) * Math.min(1, dt * 3);
        g.rotation.y = rec.dispYaw + Math.sin(t * .6 + rec.phase) * .012;
        g.rotation.z = clamp(-c.vy * 2.2, -.22, .22) * (c.dir >= 0 ? 1 : -1) +
          clamp(dYaw * .10, -.09, .09);                       // 掉头时轻微抬头
        g.rotation.x = Math.sin(t * 1.4 + rec.phase) * .02 +
          clamp(-yawVel * .085, -.38, .38);                   // 依转向角速度侧倾压弯
        // 摆尾：节奏与幅度随行为状态变化（休息慢而小、急窜快而大），转弯时额外加力
        var ud = g.userData;
        var st = c.state || 'cruise';
        var fMul = st === 'rest' ? .38 : st === 'dart' ? 1.8 : st === 'hover' ? .72 : st === 'forage' ? .85 : 1;
        var shapeF = ud.bodyShape === 'anguilliform' ? 1.32 : ud.bodyShape === 'compressiform' ? .84 :
          ud.bodyShape === 'globiform' ? .76 : ud.bodyShape === 'depressiform' ? .92 : 1;
        var turnBoost = clamp(rec.turn * 2.0, 0, 1);
        var freq = (4.0 + sp.speed * 4.4) * fMul * shapeF * (1 + turnBoost * .6);
        var amp = (st === 'dart' ? .19 : st === 'rest' ? .06 : .125) + turnBoost * .05;
        /* 外部 GLB 模型：自带动画走 mixer（暂停时冻结）。
         * 三处必须跟程序化鱼对齐，否则看起来像「在冰面上滑」：
         *   1) 时钟用 animDt（随快进倍率放大），不能直接吃真实 dt；
         *   2) 播放速率由 freq 反推，休息/急窜/转弯才跟着变；
         *   3) 幅度用 action 权重模拟，休息时弱、冲刺时满。 */
        if (ud.mixer) {
          var animDt = s.paused ? 0 : dt * (1 + Math.min((s.speed || 1) - 1, 15) * 0.28);
          if (!s.paused) {
            /* 参考资产 Swimming fish.glb 的尾拍周期是 0.33s（≈3Hz），
             * 我们片段 0.9s 只有 1.1Hz，所以这里乘 2.4 把它拉到真实鱼的速度。
             * 之前直接 1:1 播放，鱼看起来才那么"慢动作"。 */
            var tTarget = clamp(freq / Math.max(1e-3, ud.clipOmega) * 2.4, .45, 3.6);
            ud.tScale += (tTarget - ud.tScale) * Math.min(1, dt * 5);
            var wTarget = clamp(amp / .125 * .92 + turnBoost * .10, .40, 1);
            ud.weight += (wTarget - ud.weight) * Math.min(1, dt * 4);
            ud.mixer.timeScale = ud.tScale;
            /* 转身权重由「角速度」驱动，而不是剩余角度误差。
             * 三维朝向是连续跟随的，dYaw 常年接近 0，用它判断的话
             * Turn 片段几乎永远不会被激活，鱼自然弯不起来。 */
            var twRate = Math.abs(yawVel) / 1.9;          // 角速度贡献
            var twErr = Math.abs(dYaw) / 1.1;             // 大幅换向时兜底
            var tw = clamp(Math.max(twRate, twErr) * .96 + (st === 'dart' ? .30 : 0), 0, 1);
            ud.turnW += (tw - ud.turnW) * Math.min(1, dt * 6);
            if (ud.action) ud.action.setEffectiveWeight(ud.weight * (1 - ud.turnW));
            if (ud.actTurn) ud.actTurn.setEffectiveWeight(ud.weight * ud.turnW);
          }
          ud.mixer.update(animDt);
        }
        var waveShader = ud.bodyMat && ud.bodyMat.userData && ud.bodyMat.userData.shader;
        if (waveShader) {
          waveShader.uniforms.uWaveTime.value = t;
          waveShader.uniforms.uWaveFreq.value = freq;
          waveShader.uniforms.uWaveAmp.value = amp / Math.max(.6, c.sizeCm / Math.max(1, sp.size[1]));
          waveShader.uniforms.uWavePhase.value = rec.phase;
        }
        if (ud.tailGroup) ud.tailGroup.rotation.y = Math.sin(t * freq + rec.phase - .55) *
          (st === 'hover' ? .10 : .26) * (1 + turnBoost * .8);
        // 胸鳍划水：悬停/休息时左右交替划（真实鱼类的低耗姿态），巡游时双鳍同步、急窜收拢贴身
        var rowF = (st === 'hover' || st === 'rest') ? 6.8 + sp.speed * 1.6 : 3.4 + sp.speed * 1.2;
        var rowAmp = st === 'hover' ? .5 : st === 'rest' ? .34 : st === 'dart' ? .08 : .26;
        var altPhase = (st === 'hover' || st === 'rest') ? Math.PI : 0;
        if (ud.pectL) {
          ud.pectL.rotation.y = .30 + Math.sin(t * rowF + rec.phase + altPhase) * rowAmp;
          ud.pectR.rotation.y = -.30 - Math.sin(t * rowF + rec.phase) * rowAmp;
        }
        if (ud.fins) ud.fins.rotation.z = Math.sin(t * (freq + 2) + rec.phase) *
          (st === 'hover' ? .085 : st === 'dart' ? .012 : .035);
        // 近景细节（LOD）：cam.zoom 是距离系数（越小越近），拉近镜头才显现的口须并轻轻摆动
        if (ud.barbels) {
          var near = cam.zoom < .92;
          ud.barbels.visible = near;
          if (near) {
            ud.barbels.rotation.x = Math.sin(t * 3.1 + rec.phase) * .18;
            ud.barbels.rotation.y = Math.sin(t * 2.3 + rec.phase * 2) * .12;
          }
        }
        // 病弱 / 老年体色转淡（外部模型保留原始材质，不做褪色）
        var dull = clamp(1 - c.health, 0, 1) * .34 + (c.ageDays > sp.lifespan * .82 ? .22 : 0) +
          (c.disease ? .12 * c.disease : 0);
        if (ud.bodyMat) ud.bodyMat.color.setRGB((1 - dull * .28) * rec.tint[0], (1 - dull * .20) * rec.tint[1], (1 - dull * .12) * rec.tint[2]);
      } else {
        g.position.set(px, clamp(py, BASE_Y + .12, WATER_Y - .3), rec.z * .7);
        g.scale.setScalar(Math.max(.32, c.sizeCm * PXCM * 1.15));
        g.rotation.y = c.dir >= 0 ? 0 : Math.PI;
        g.rotation.z = Math.sin(t * .8 + rec.phase) * .04;
        // 蜡虾触须 / 螺的触角轻轻抖动
        var ud2 = g.userData;
        if (ud2.antGroup) {
          ud2.antGroup.rotation.z = Math.sin(t * 2.6 + rec.phase) * .10;
          ud2.antGroup.rotation.x = Math.sin(t * 1.7 + rec.phase * 2) * .08;
        }
        /* 螺虾 GLB 没有骨骼，摆动靠顶点着色器里的 uTime 推动 */
        if (ud2.waveShaders && ud2.waveShaders.length) {
          for (var wi = 0; wi < ud2.waveShaders.length; wi++) {
            ud2.waveShaders[wi].uniforms.uTime.value = t + rec.phase;
          }
        }
      }
      if (rec.shadow) {
        rec.shadow.position.set(px, terrain.top(px) + .02, rec.z * .7);
        var hn = clamp((py - BASE_Y) / (TANK.h * .82), 0, 1);
        rec.shadow.scale.setScalar(Math.max(.45, c.sizeCm * PXCM) * (1.05 + hn * 1.5));
        rec.shadow.material.opacity = .19 * (1 - hn * .62);
      }
    }
    Object.keys(objs).forEach(function (id) { if (!seen[id]) remove(id); });
  }

  function syncFood(s) {
    var i, m;
    for (i = 0; i < s.foods.length; i++) {
      var f = s.foods[i];
      if (!foodPool[i]) {
        m = new T.Mesh(new T.SphereGeometry(.055, 8, 6),
          new T.MeshStandardMaterial({ color: 0xd9a45a, roughness: .85 }));
        scene.add(m); foodPool[i] = m;
      }
      m = foodPool[i]; m.visible = true;
      m.material.color.set(f.color);
      var fy = (.5 - f.y) * TANK.h;
      if (f.state === 'rest') fy = Math.max(fy, terrain.top((f.x - .5) * TANK.w) + .06);   // 沉底的残饵落在砂面上
      m.position.set((f.x - .5) * TANK.w, fy, .4 + Math.sin(f.wob) * .5);
      var rr = f.diet === 'algae' ? 1.7 : 1;
      m.scale.set(rr, f.diet === 'flake' ? .55 : .85, rr);
      m.material.opacity = f.state === 'rest' ? .7 : 1;
      m.material.transparent = f.state === 'rest';
    }
    for (i = s.foods.length; i < foodPool.length; i++) foodPool[i].visible = false;
  }

  function syncBubbles(s, env, dt) {
    var pos = bubbles.geometry.attributes.position;
    var rate = (s.airOn ? .55 : .02) + env.plantMass * env.light * .018;
    for (var i = 0; i < bubbleData.length; i++) {
      var b = bubbleData[i];
      if (b.y < -50 && Math.random() < rate * dt * 3) {
        b.x = s.airOn ? rnd(-.4, .4) : rnd(-TANK.w / 2, TANK.w / 2);
        b.y = BASE_Y; b.v = rnd(.9, 2.3); b.p = rnd(0, 6.28);
      }
      if (b.y > -50) {
        b.y += b.v * dt;
        if (b.y > WATER_Y) b.y = -100;
        pos.setXYZ(i, b.x + Math.sin(t * 2 + b.p) * .1, b.y, rnd(-1, 1) * .1 + .3);
      } else pos.setXYZ(i, 0, -100, 0);
    }
    pos.needsUpdate = true;
  }

  /* ================= 相机 / 交互 ================= */
  function computeBaseDist() {
    var f = camera.fov * Math.PI / 180;
    var dH = TANK.h * 1.10 / (2 * Math.tan(f / 2));
    var dW = TANK.w * 1.02 / (2 * Math.tan(f / 2) * camera.aspect);
    cam.baseDist = Math.max(dH, dW);
  }

  function updateCamera() {
    cam.az += (cam.taz - cam.az) * .12;
    cam.el += (cam.tel - cam.el) * .12;
    cam.zoom += (cam.tzoom - cam.zoom) * .12;
    var d = cam.baseDist * cam.zoom;
    camera.position.set(Math.sin(cam.az) * d, Math.sin(cam.el) * d + .25, Math.cos(cam.az) * d);
    camera.lookAt(0, 0, 0);
    if (handlers.view) handlers.view(Math.round(cam.az * 180 / Math.PI), Math.round(cam.el * 180 / Math.PI), cam.zoom);
  }

  function setRay(e) {
    var r = canvas.getBoundingClientRect();
    var nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    var ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(new T.Vector2(nx, ny), camera);
  }

  function feedX(e) {
    setRay(e);
    var hit = new T.Vector3();
    var plane = new T.Plane(new T.Vector3(0, 1, 0), -WATER_Y);
    if (raycaster.ray.intersectPlane(plane, hit)) return clamp(hit.x / TANK.w + .5, .04, .96);
    return .5;
  }

  function pick(e) {
    setRay(e);
    var hits = raycaster.intersectObjects(pickables, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && !o.userData.creatureId) o = o.parent;
      if (o && o.userData.creatureId) return o.userData.creatureId;
    }
    return null;
  }

  function resetView() {
    cam.taz = cam.az = 0; cam.tel = cam.el = .03; cam.tzoom = cam.zoom = 1;
  }

  /* ---------- 布景摆位：把屏幕坐标打到砂面，换算回归一化坐标 ---------- */
  function groundAt(e) {
    setRay(e);
    var hit = new T.Vector3();
    var plane = new T.Plane(new T.Vector3(0, 1, 0), -BASE_Y);
    return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  }
  function normX(wx) { return clamp(wx / TANK.w + .5, .05, .95); }
  function normZ(wz) { return clamp(wz / (TANK.d * .62) + .5, .10, .90); }

  /* 摆位模式下优先抓水草，其次抓石头；返回 {kind,id/idx} 或 null */
  function pickLayout(e) {
    /* 遍历射线上的所有命中，优先抓水草——鱼游在前面时也能抓住被挡住的水草 */
    setRay(e);
    var hits = raycaster.intersectObjects(pickables, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && !o.userData.creatureId) o = o.parent;
      if (o && o.userData.creatureId) {
        var c = objs[o.userData.creatureId];
        if (c && c.sp && c.sp.kind === 'plant') return { kind: 'plant', id: o.userData.creatureId };
      }
    }
    /* 射线兜底：屏幕距离最近的未遮挡水草。
     * 注意坐标系：投影结果是画布内像素，clientX/Y 是视口坐标——
     * 必须加上画布的视口偏移再比距离。 */
    var cr = canvas.getBoundingClientRect();
    var bestId = null, bestD = 46;
    for (var pid in objs) {
      if (objs[pid].sp.kind !== 'plant') continue;
      var gv = new T.Vector3(); objs[pid].group.getWorldPosition(gv); gv.project(camera);
      var vx2 = (gv.x * .5 + .5) * W + cr.left, vy2 = (-gv.y * .5 + .5) * H + cr.top;
      var d = Math.hypot(vx2 - e.clientX, vy2 - e.clientY);
      if (d < bestD) { bestD = d; bestId = pid; }
    }
    if (bestId) return { kind: 'plant', id: bestId };
    setRay(e);
    var hits = raycaster.intersectObjects(rockPickables, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      /* 设置面板那组石头带 rockIdx；商店造景 tab 的独立个体带 decorKind/decorIdx。
       * 两者共用同一条拾取通道，但落点要写回不同的存档字段。 */
      while (o && o.userData.rockIdx == null && o.userData.decorKind == null) o = o.parent;
      if (!o) continue;
      if (o.userData.decorKind) {
        return { kind: 'decor', decorKind: o.userData.decorKind, idx: o.userData.decorIdx, obj: o };
      }
      if (o.userData.rockIdx != null) return { kind: 'rock', idx: o.userData.rockIdx, obj: o };
    }
    return null;
  }

  function movePlace(e) {
    var p = groundAt(e);
    if (!p || !drag.place) return;
    var nx = normX(p.x), nz = normZ(p.z);
    if (drag.place.kind === 'plant') {
      /* 直接喂给模拟层，下一帧 syncCreatures 会把 group 摆过去，跟手感就是逐帧的 */
      if (handlers.layout) handlers.layout(drag.place.id, nx, nz, false);
    } else if (drag.place.kind === 'decor') {
      var d = drag.place.obj;
      d.position.x = p.x;
      d.position.z = p.z;
      d.position.y = BASE_Y + terrain.prof(p.x) + d.userData.rockLift;
      if (handlers.layoutDecor) handlers.layoutDecor(drag.place.decorKind, drag.place.idx, nx, nz, false);
    } else {
      var o = drag.place.obj;
      o.position.x = p.x;
      o.position.z = p.z;
      o.position.y = BASE_Y + terrain.prof(p.x) + o.userData.rockLift;
      if (handlers.layoutRock) handlers.layoutRock(drag.place.idx, nx, nz, false);
    }
  }

  function bindEvents() {
    var pendingClick = null;
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag.active = true; drag.moved = false;
      drag.x0 = drag.x = e.clientX; drag.y0 = drag.y = e.clientY;
      drag.place = (curState && curState.mode === 'layout') ? pickLayout(e) : null;
      if (drag.place) canvas.classList.add('placing');
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
    });
    canvas.addEventListener('pointermove', function (e) {
      var r = canvas.getBoundingClientRect();
      var nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
      if (curState) {
        curState.pointer = { x: nx, y: ny, active: !drag.moved };
      }
      if (!drag.active) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 6) drag.moved = true;
      if (drag.place) {
        movePlace(e);                       // 摆位：拖的是物件，相机保持不动
      } else if (drag.moved) {
        if (!curState || curState.viewMode !== 'flat') {
          cam.taz = clamp(cam.taz - dx * .0048, -.85, .85);
          cam.tel = clamp(cam.tel + dy * .0032, -.30, .48);
        }
        canvas.classList.add('dragging');
      }
      drag.x = e.clientX; drag.y = e.clientY;
    });
    canvas.addEventListener('pointerup', function (e) {
      if (!drag.active) return;
      drag.active = false;
      canvas.classList.remove('dragging', 'placing');
      if (drag.place) {
        // 摆位落点定稿：这一下才写存档
        if (drag.place.kind === 'plant') {
          var pp = groundAt(e);
          if (pp && handlers.layout) handlers.layout(drag.place.id, normX(pp.x), normZ(pp.z), true);
        } else if (drag.place.kind === 'decor') {
          var pd = groundAt(e);
          if (pd && handlers.layoutDecor) handlers.layoutDecor(drag.place.decorKind, drag.place.idx,
            normX(pd.x), normZ(pd.z), true);
        } else if (handlers.layoutRock) {
          var pq = groundAt(e);
          if (pq) handlers.layoutRock(drag.place.idx, normX(pq.x), normZ(pq.z), true);
        }
        drag.place = null;
        return;
      }
      if (drag.moved || !curState) return;
      // 延迟一小段，双击复位视角时不会顺手投一次饲料
      var token = { x: e.clientX, y: e.clientY, stamp: performance.now() };
      pendingClick = token;
      setTimeout(function () {
        if (pendingClick !== token) return;
        pendingClick = null;
        var fake = { clientX: token.x, clientY: token.y };
        if (curState.mode === 'inspect') { if (handlers.select) handlers.select(pick(fake)); }
        else if (curState.mode === 'feed' && handlers.feed) handlers.feed(feedX(fake));
      }, 210);
    });
    canvas.addEventListener('pointercancel', function () {
      drag.active = false; drag.place = null;
      canvas.classList.remove('dragging', 'placing');
    });
    canvas.addEventListener('pointerleave', function () { if (curState) curState.pointer.active = false; });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      cam.tzoom = clamp(cam.tzoom + Math.sign(e.deltaY) * .12, .42, 2.3);
    }, { passive: false });
    canvas.addEventListener('dblclick', function (e) { e.preventDefault(); pendingClick = null; resetView(); });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /* ================= 启动 / 主绘制 ================= */
  function attach(cv, s) {
    canvas = cv;
    curState = s;      // 模型分批要用它判断「哪些在缸里」，不能等第一帧
    if (!T) { canvas.parentNode.setAttribute('data-error', 'Three.js 未加载'); return; }
    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8) * quality);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .96;
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(36, 1.8, .1, 120);
    raycaster = new T.Raycaster();
    scene.background = backgroundTexture();
    scene.fog = new T.FogExp2(0x0a3a49, .018);
    fishEnv = makeEnvCube();
    if (T.GLTFLoader && !glbLoader) glbLoader = new T.GLTFLoader();
    applyDims(s);
    buildLights();
    buildStatic(s);
    bindEvents();
    resize();
    window.addEventListener('resize', resize);
    ready = true;
    buildThumbnails();
    loadThumbImages();
    /* 模型加载推迟两帧：先让缸体和程序化鱼画出来、输入能响应，
     * 再把十几个 GLB 的解析/贴图解码排进主线程，首屏不会一进来就卡住。
     * 后台标签页里 rAF 不跑，所以再加一个定时器兜底。 */
    var modelsStarted = false;
    var startModels = function () {
      if (modelsStarted) return;
      modelsStarted = true;
      loadExternalModels();
    };
    requestAnimationFrame(function () { requestAnimationFrame(startModels); });
    setTimeout(startModels, 1200);
  }

  function resize() {
    if (!renderer) return;
    var r = canvas.getBoundingClientRect();
    W = Math.max(320, r.width); H = Math.max(240, r.height);
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    computeBaseDist();
  }

  function draw(s, dt) {
    if (!ready || !renderer) return;
    curState = s;
    dt = clamp(dt || 0, 0, .1);
    if (!s.paused) { t += dt; frameTick++; }
    var env = window.AW_SIM.getEnv(s);
    // 真实光照：夜间关灯几乎全黑，灯光档位直接决定亮度
    // env.light 可以超过 1（极强档），上限跟 sim 的 clamp 对齐
    var lv = clamp(env.light, 0, 1.85);
    lights.sun.intensity = .018 + lv * 1.52;
    lights.amb.intensity = .016 + lv * .50;
    lights.hemi.intensity = .012 + lv * .36;
    lights.fill.intensity = .008 + lv * .34;
    lights.top.intensity = .010 + lv * .55;
    // 顶档再把曝光抬一点，才看得出「最亮」和「中」的区别
    renderer.toneMappingExposure = .96 + Math.max(0, lv - 1) * .30;
    if (scene.fog) scene.fog.color.setRGB(.015 + lv * .045, .07 + lv * .12, .10 + lv * .14);
    if (water) {
      water.material.map.offset.x = t * .012; water.material.map.offset.y = t * .006;
      water.material.opacity = .02 + lv * .30;
    }
    if (caustic) { caustic.material.map.offset.x = -t * .018; caustic.material.opacity = lv * .13; }
    beams.forEach(function (b, i) { b.material.opacity = lv * .44; b.rotation.z = (i - 1) * .075 + Math.sin(t * .25 + i) * .018; });
    // 沉木 / 石块按造景开关显隐
    var wood = scene.getObjectByName('wood'), rocks = scene.getObjectByName('rocks');
    if (wood) wood.visible = !!(s.decorOn && s.decorOn.driftwood);
    if (rocks) rocks.visible = !!(s.decorOn && s.decorOn.rocks);

    if (!__perf.marks.firstFrame) __mark('firstFrame');
    syncCreatures(s, dt);
    syncFood(s);
    syncBubbles(s, env, dt);
    updateCamera();
    renderer.render(scene, camera);

    // 低性能设备自动降低内部渲染分辨率（CSS 尺寸不变，画面只做一次拉伸）
    if (dt > .045) slowFrames++; else slowFrames = Math.max(0, slowFrames - 2);
    if (slowFrames > 24 && quality > .62) {
      quality = quality > .82 ? .80 : .62;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8) * quality * (sharpZoom ? 1.18 : 1));
      renderer.setSize(W, H, false);
      slowFrames = 0;
    }
    // 近景高清（LOD）：cam.zoom 越小越近，拉近后提高渲染分辨率，鱼鳞和鳍条更锐；离开后恢复
    var wantSharp = cam.zoom < .85;
    if (wantSharp !== sharpZoom) {
      sharpZoom = wantSharp;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8) * quality * (sharpZoom ? 1.18 : 1));
      renderer.setSize(W, H, false);
    }
    return env;
  }

  /* ================= 3D 缩略图（离屏渲染，同步输出） ================= */
  function buildThumbnails() {
    try {
      if (!thumbRig) {
        var rt = new T.WebGLRenderTarget(176, 120);
        var sc = new T.Scene(); sc.background = new T.Color(0x0d3c4c);
        sc.add(new T.AmbientLight(0xbfe6ee, .62));
        var dl = new T.DirectionalLight(0xffffff, 1.15); dl.position.set(-2, 4, 6); sc.add(dl);
        var pl = new T.PointLight(0x8fe0ea, .42); pl.position.set(3, 1, 4); sc.add(pl);
        var camT = new T.PerspectiveCamera(32, 176 / 120, .1, 60);
        camT.position.set(0, .1, 6.2); camT.lookAt(0, 0, 0);
        thumbRig = { rt: rt, sc: sc, camT: camT };
      }
    } catch (e) { return; }
    /* 不批量预画：只创建离屏环境，谁要图标谁再画（iconURL 会补）。
     * 以前一上来就画 60 个品种，每个都带一次 readPixels 同步回读，首屏明显卡。 */
  }

  function drawThumbTo(sp, force) {
    if (!thumbRig) return;
    if (!force && thumbCache[sp.id]) return;
    /* 这里永远不用 GLB：离屏渲染 45k 面的蒙皮模型 + readPixels 在软件渲染环境下
     * 会把主线程卡住（实测首屏直接僵死）。列表图标改由 drawIcon 走预渲染 PNG。 */
    var buildSp = sp.model ? simpleCopy(sp, { model: null }) : sp;
    var obj = null;
    try {
      obj = buildSp.kind === 'fish' ? buildFish(buildSp) : buildSp.kind === 'plant' ? buildPlant(buildSp) : buildInvert(buildSp);
      var box = new T.Box3().setFromObject(obj), size = box.getSize(new T.Vector3()), ctr = box.getCenter(new T.Vector3());
      var maxD = Math.max(size.x, size.y, size.z, .001);
      if (!isFinite(maxD) || maxD <= 0) maxD = .001;
      var k = 3.4 / maxD;
      obj.scale.multiplyScalar(k);
      obj.position.set(-ctr.x * k, -ctr.y * k, -ctr.z * k);
      if (buildSp.kind === 'fish') obj.rotation.y = -.18;
      // 部分模型绑定姿势塌缩（不播动画就是空的）：先把 mixer 摆到动画中段再截图
      if (obj.userData && obj.userData.mixer && obj.userData.action) {
        obj.userData.action.time = obj.userData.action.getClip().duration * .3;
        obj.userData.mixer.update(.016);
      }
      thumbRig.sc.add(obj);
      var renderer2 = renderer;
      renderer2.setRenderTarget(thumbRig.rt);
      renderer2.render(thumbRig.sc, thumbRig.camT);
      var buf = new Uint8Array(176 * 120 * 4);
      renderer2.readRenderTargetPixels(thumbRig.rt, 0, 0, 176, 120, buf);
      var cv = cv2d(176, 120), ctx = cv.getContext('2d'), img = ctx.createImageData(176, 120);
      for (var y = 0; y < 120; y++) for (var x = 0; x < 176; x++) {
        var si = ((119 - y) * 176 + x) * 4, di = (y * 176 + x) * 4;
        img.data[di] = Math.min(255, buf[si] * 1.12);
        img.data[di + 1] = Math.min(255, buf[si + 1] * 1.12);
        img.data[di + 2] = Math.min(255, buf[si + 2] * 1.12);
        img.data[di + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      thumbCache[sp.id] = cv;
      window.__thumbVer = (window.__thumbVer || 0) + 1;
      thumbRig.sc.remove(obj); disposeGroup(obj);
    } catch (err) {
      window.__thumbErr = window.__thumbErr || {};
      window.__thumbErr[sp.id] = (err && err.message ? err.message : String(err)) + ' @ ' + (err && err.stack ? err.stack.split('\n')[1] || '' : '');
      if (thumbRig && obj) { try { thumbRig.sc.remove(obj); } catch (e2) { } }
      try { renderer.setRenderTarget(null); } catch (e3) { }
      thumbCache[sp.id] = null;
    } finally {
      renderer.setRenderTarget(null);   // 关键：无论如何切回主画布，否则后续全部渲染进离屏缓冲
    }
  }

  function drawIcon(cv, spec, ow, oh) {
    var w = ow || 62, h = oh || 52;
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * ratio); cv.height = Math.round(h * ratio);
    var c = cv.getContext('2d'); c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.clearRect(0, 0, w, h);
    var img = spec.model && thumbImgs[spec.model.file];
    if (img && img.naturalWidth) {
      c.drawImage(img, 0, 0, w, h);
      var tint = iconTintOf(spec);
      if (tint) {
        c.globalCompositeOperation = 'multiply';
        c.fillStyle = 'rgb(' + tint[0] + ',' + tint[1] + ',' + tint[2] + ')';
        c.fillRect(0, 0, w, h);
        c.globalCompositeOperation = 'source-over';
      }
      return;
    }
    var src = thumbCache[spec.id];
    if (src) { c.drawImage(src, 0, 0, w, h); return; }
    // 设备 / 兜底：简洁线稿
    c.fillStyle = 'linear-gradient' in c ? '#123f50' : '#123f50';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#8fd6d6'; c.lineWidth = 2;
    c.strokeRect(w * .26, h * .24, w * .48, h * .52);
    c.beginPath(); c.moveTo(w * .36, h * .42); c.lineTo(w * .64, h * .42);
    c.moveTo(w * .36, h * .56); c.lineTo(w * .56, h * .56); c.stroke();
  }

  function projectSelected(s) {
    if (!ready || !s.selected || !objs[s.selected]) return null;
    var g = objs[s.selected].group;
    var v = new T.Vector3(); g.getWorldPosition(v); v.y += .35;
    v.project(camera);
    return { x: (v.x * .5 + .5) * W, y: (-v.y * .5 + .5) * H, visible: v.z < 1 };
  }

  /* ================= 图鉴 3D 展示台 =================
   * 独立的小场景：缓慢自转，鼠标拖拽环绕、滚轮缩放；每次展示重新生成模型 */
  var vCanvas = null, vRenderer = null, vScene = null, vCam = null, vPivot = null;
  var vYaw = .5, vPitch = .12, vDist = 5, vW = 0, vH = 0, vDragging = false;
  /* 展示台节奏：Swim 片段原始周期 0.9s（约 1.1Hz 摆尾），在展示台里按 0.42 倍播放
   * 大约 2.1s 一拍，看细节不晃眼。
   * 自转不再是整圈：侧扁的鱼转到正面/背面就成了一片薄片，看着像模型塌了。
   * 改成绕初始角度小幅来回摆，始终呈 3/4 侧视；想换角度看直接拖拽。 */
  var V_SWIM_RATE = .42, V_SWAY_AMP = .20, V_SWAY_W = .32, vSwayT = 0;

  function viewerAttach(cv) {
    if (vRenderer) { vCanvas = cv; return; }
    vCanvas = cv;
    try {
      vRenderer = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
      vRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      vRenderer.outputEncoding = T.sRGBEncoding;
    } catch (e) { vRenderer = null; return; }
    vScene = new T.Scene();
    vScene.add(new T.AmbientLight(0xbfe6ee, .85));
    var dl = new T.DirectionalLight(0xffffff, 1.25); dl.position.set(-3, 5, 6); vScene.add(dl);
    var pl = new T.PointLight(0x9fe0ea, .5); pl.position.set(4, -1, 4); vScene.add(pl);
    var bl = new T.DirectionalLight(0x5f9fc0, .35); bl.position.set(2, -4, -5); vScene.add(bl);
    vCam = new T.PerspectiveCamera(34, 1.6, .1, 60);
    vPivot = new T.Group(); vScene.add(vPivot);
    // 拖拽环绕 / 滚轮缩放
    cv.addEventListener('pointerdown', function (e) {
      vDragging = true; try { cv.setPointerCapture(e.pointerId); } catch (err) { }
      cv.classList.add('dragging');
    });
    cv.addEventListener('pointermove', function (e) {
      if (!vDragging) return;
      vYaw += (e.movementX || 0) * .009;
      vPitch = clamp(vPitch + (e.movementY || 0) * .006, -1.3, 1.3);
    });
    function endDrag() { vDragging = false; cv.classList.remove('dragging'); }
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      vDist = clamp(vDist + Math.sign(e.deltaY) * .5, 3, 9);
    }, { passive: false });
  }

  function viewerShow(specId) {
    if (!vRenderer) return;
    while (vPivot.children.length) {
      var m = vPivot.children[0];
      vPivot.remove(m); disposeGroup(m);
    }
    var sp = D.get(specId);
    if (!sp) return;
    var model = sp.kind === 'fish' ? buildFish(sp) : sp.kind === 'plant' ? buildPlant(sp) : buildInvert(sp);
    var box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3()), ctr = box.getCenter(new T.Vector3());
    var k = 2.6 / Math.max(size.x, size.y, size.z, .001);
    model.scale.setScalar(k);
    model.position.set(-ctr.x * k, -ctr.y * k, -ctr.z * k);
    vPivot.add(model);
    vYaw = .30; vPitch = .14; vDist = 5; vSwayT = 0;
  }

  function viewerFrame(dt) {
    if (!vRenderer || !vCanvas) return;
    var cw = vCanvas.clientWidth, ch = vCanvas.clientHeight;
    if (!cw || !ch) return;
    if (cw !== vW || ch !== vH) {
      vW = cw; vH = ch;
      vRenderer.setSize(cw, ch, false);
      vCam.aspect = cw / ch; vCam.updateProjectionMatrix();
    }
    if (!vDragging) vSwayT += dt;
    var yawNow = vYaw + (vDragging ? 0 : Math.sin(vSwayT * V_SWAY_W) * V_SWAY_AMP);
    vPivot.traverse(function (o) { if (o.userData && o.userData.mixer) o.userData.mixer.update(dt * V_SWIM_RATE); });
    var cp = Math.cos(vPitch);
    vCam.position.set(Math.sin(yawNow) * cp * vDist, Math.sin(vPitch) * vDist, Math.cos(yawNow) * cp * vDist);
    vCam.lookAt(0, 0, 0);
    vRenderer.render(vScene, vCam);
  }

  window.AW_RENDER = {
    attach: attach, resize: resize, draw: draw, drawIcon: drawIcon,
    projectSelected: projectSelected, resetView: resetView,
    rebuild: rebuild, applyViewMode: applyViewMode,
    viewerAttach: viewerAttach, viewerShow: viewerShow, viewerFrame: viewerFrame,
    thumbErrors: function () { return window.__thumbErr || {}; },
    redrawThumb: function (sp) { drawThumbTo(sp, true); },
    hasIcon: function (file) { return !!thumbImgs[file]; },
    thumbState: function (id) {
      var t = thumbCache[id];
      if (t === undefined) return 'undefined';
      if (t === null) return 'null';
      return 'canvas ' + t.width + 'x' + t.height;
    },
    modelState: function (f) { return glbModels[f] ? 'loaded len=' + glbModels[f].len.toFixed(3) : 'missing'; },
    glbInfo: function (f) {   // 诊断：dump 模板/克隆体的网格结构与材质
      var mc = glbModels[f];
      if (!mc) return 'missing';
      function dump(o, depth) {
        var out = [];
        o.traverse(function (n) {
          if (n.isMesh || n.isSkinnedMesh || n.isBone) {
            out.push((n.isBone ? 'bone:' : n.isSkinnedMesh ? 'skinned:' : 'mesh:') + n.name +
              ' vis=' + n.visible + ' tri=' + (n.geometry ? (n.geometry.index ? n.geometry.index.count / 3 : n.geometry.attributes.position.count / 3) | 0 : 0) +
              ' mat=' + (n.material ? (Array.isArray(n.material) ? n.material.length + 'x' : n.material.type) : '-'));
          }
        });
        return out.slice(0, depth || 12);
      }
      var cloneFn = (T.SkeletonUtils && T.SkeletonUtils.clone) ? T.SkeletonUtils.clone : function (o) { return o.clone(true); };
      var inst = cloneFn(mc.root);
      var meshes = 0, skinned = 0, invis = 0;
      inst.traverse(function (n) { if (n.isMesh) { meshes++; if (!n.visible) invis++; } if (n.isSkinnedMesh) skinned++; });
      return {
        template: dump(mc.root),
        cloneMeshes: meshes, cloneSkinned: skinned, cloneInvisible: invis,
        boxSize: new T.Box3().setFromObject(inst).getSize(new T.Vector3()).toArray().map(function (v) { return +v.toFixed(2); })
      };
    },
    modelStats: function (specId) {   // 调试：临时建模并返回包围盒（长/高/宽，含鳍），用后即弃
      var sp = D.get(specId);
      if (!sp || sp.kind !== 'fish') return null;
      var m = buildFish(sp);
      var sz = new T.Box3().setFromObject(m).getSize(new T.Vector3());
      disposeGroup(m);
      return { len: +sz.x.toFixed(2), hgt: +sz.y.toFixed(2), wid: +sz.z.toFixed(2) };
    },
    stats: function () {
      var wave = 0;
      for (var k in objs) {
        var u = objs[k].group && objs[k].group.userData;
        if (u && u.bodyMat && u.bodyMat.userData && u.bodyMat.userData.shader) wave++;
      }
      return renderer ? { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, quality: quality, waveShaders: wave } : null;
    },
    on: function (h) { for (var k in h) if (handlers.hasOwnProperty(k)) handlers[k] = h[k]; },
    hitTest: function () { return null; }
  };
})();
