/* 澄屿 · 生态水族箱 —— 物种资料库
 * 参数参考常见淡水观赏鱼/水草/观赏螺饲养资料，单位为「模拟天」与「厘米」。
 * 归一化坐标：x 0..1 从左到右，y 0..1 从水面到缸底。
 */
(function () {
  'use strict';

  const fish = [
    {
      id: 'guppy', name: '孔雀鱼', latin: 'Poecilia reticulata', kind: 'fish', price: 16,
      tags: ['上层', '活泼', '卵胎生', '繁殖快'],
      desc: '尾鳍华丽的小型卵胎生鱼，喜欢在水面附近巡游，吃饱了就特别爱生小鱼。',
      layer: [0.10, 0.50], speed: 1.05, schooling: 0.30, bold: 0.78, activity: 'day',
      appetite: 1.0, waste: 0.75, bioload: 0.55,
      diet: ['flake', 'floating'], reach: 0.48,
      aggression: 0.02, territory: 0, finRisk: 0.85,
      temp: [22, 28], oxygenNeed: 0.45, hardiness: 0.78,
      size: [1.5, 4.4, 5.8], growthDays: 30, lifespan: 420,
      breed: { mode: 'livebearer', chance: 0.85, minAge: 38, max: 3, cooldown: 13 },
      plantBite: 0, algaeEat: 0,
      model: { file: 'guppy_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'slim', tail: 'fan', pattern: 'guppy', c1: '#7fd8d3', c2: '#2d6ca8', c3: '#ffb648', fin: '#ff8a5b' }
    },
    {
      id: 'neon', name: '红绿灯', latin: 'Paracheirodon innesi', kind: 'fish', price: 12,
      tags: ['中层', '强群游', '胆小', '喜软水'],
      desc: '典型灯科鱼，成群才安心。对氨氮和亚硝酸盐敏感，是水质的活体指示剂。',
      layer: [0.32, 0.72], speed: 0.92, schooling: 0.95, bold: 0.30, activity: 'day',
      appetite: 0.72, waste: 0.45, bioload: 0.35,
      diet: ['flake', 'sinking'], reach: 0.38,
      aggression: 0, territory: 0, finRisk: 0.15,
      temp: [22, 26], oxygenNeed: 0.62, hardiness: 0.32,
      size: [1.2, 3.2, 4.0], growthDays: 40, lifespan: 500,
      breed: { mode: 'none', chance: 0 },
      plantBite: 0, algaeEat: 0,
      look: { body: 'slim', tail: 'fork', pattern: 'neon', c1: '#5ec8e5', c2: '#123a78', c3: '#f04b52', fin: '#8fc6d8' },
      model: { file: 'neon_rigged.glb', yaw: 0, pitch: 0 }
    },
    {
      id: 'zebra', name: '斑马鱼', latin: 'Danio rerio', kind: 'fish', price: 10,
      tags: ['中上层', '强群游', '抢食快', '耐粗养'],
      desc: '一刻不停的「小马达」，成群冲刺抢食，耐温差、耐水质波动，新手友好。',
      layer: [0.14, 0.62], speed: 1.55, schooling: 0.86, bold: 0.72, activity: 'day',
      appetite: 1.15, waste: 0.6, bioload: 0.42,
      diet: ['flake', 'floating', 'sinking'], reach: 0.62,
      aggression: 0.05, territory: 0, finRisk: 0.05,
      temp: [18, 28], oxygenNeed: 0.55, hardiness: 0.90,
      size: [1.6, 5.2, 6.4], growthDays: 34, lifespan: 620,
      breed: { mode: 'egg', chance: 0.30, minAge: 55, max: 2, cooldown: 20 },
      plantBite: 0, algaeEat: 0,
      model: { file: 'zebra_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'slim', tail: 'fork', pattern: 'zebra', c1: '#d7e7c8', c2: '#27436f', c3: '#7fb6d9', fin: '#9fc4cf' }
    },
    {
      id: 'betta', name: '暹罗斗鱼', latin: 'Betta splendens', kind: 'fish', price: 38,
      tags: ['上层', '独居', '强领域', '迷鳃低氧'],
      desc: '有迷鳃可直接呼吸空气，但绝不能与另一只斗鱼同缸；会驱赶鲜艳长鳍的邻居。',
      layer: [0.08, 0.46], speed: 0.62, schooling: 0, bold: 0.92, activity: 'day',
      appetite: 0.85, waste: 0.55, bioload: 0.5,
      diet: ['floating', 'flake'], reach: 0.42,
      aggression: 0.92, territory: 1, finRisk: 0,
      temp: [24, 30], oxygenNeed: 0.18, hardiness: 0.65,
      size: [2.4, 6.2, 7.4], growthDays: 42, lifespan: 700,
      breed: { mode: 'none', chance: 0 },
      plantBite: 0, algaeEat: 0,
      model: { file: 'betta_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'stout', tail: 'veil', pattern: 'betta', c1: '#3f6bd6', c2: '#171f61', c3: '#ef4f7f', fin: '#7851cc' }
    },
    {
      id: 'goldfish', name: '草种金鱼', latin: 'Carassius auratus', kind: 'fish', price: 26,
      tags: ['中下层', '翻砂', '大胃王', '啃水草'],
      desc: '没有胃，边吃边排，耗氧高、污染大，还会把柔嫩水草当沙拉，需要大水体和强过滤。',
      layer: [0.34, 0.92], speed: 0.72, schooling: 0.18, bold: 0.85, activity: 'day',
      appetite: 1.7, waste: 1.9, bioload: 2.4,
      diet: ['flake', 'sinking', 'floating'], reach: 0.75,
      aggression: 0.05, territory: 0, finRisk: 0,
      temp: [16, 24], oxygenNeed: 0.85, hardiness: 0.85,
      size: [3.0, 14.0, 20.0], growthDays: 90, lifespan: 1500,
      breed: { mode: 'none', chance: 0 },
      plantBite: 0.55, algaeEat: 0.08,
      look: { body: 'deep', tail: 'twin', pattern: 'gold', c1: '#ffb23f', c2: '#e2681c', c3: '#fff0b0', fin: '#ffd07a' },
      model: { file: 'goldfish_rigged.glb', yaw: 0, pitch: 0 }
    },
    {
      id: 'cory', name: '熊猫鼠鱼', latin: 'Corydoras panda', kind: 'fish', price: 20,
      tags: ['底层', '群游', '清残饵', '偏夜行'],
      desc: '带胡须的底栖清道夫，白天躲阴、夜里翻砂找沉底的碎屑，必须同种成群才不紧张。',
      layer: [0.72, 0.96], speed: 0.78, schooling: 0.78, bold: 0.42, activity: 'night',
      appetite: 0.85, waste: 0.5, bioload: 0.5,
      diet: ['sinking', 'algae'], reach: 0.30,
      aggression: 0, territory: 0, finRisk: 0,
      temp: [21, 26], oxygenNeed: 0.60, hardiness: 0.62,
      size: [1.4, 4.6, 5.6], growthDays: 48, lifespan: 800,
      breed: { mode: 'none', chance: 0 },
      plantBite: 0, algaeEat: 0.05,
      model: { file: 'cory_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'stout', tail: 'fork', pattern: 'cory', barbel: 1, c1: '#e8d9bd', c2: '#2c2b32', c3: '#4a4a52', fin: '#c9c1ad' }
    },
    {
      id: 'oto', name: '小精灵异型', latin: 'Otocinclus macrospilus', kind: 'fish', price: 24,
      tags: ['底层', '吸盘口', '刮藻', '温顺'],
      desc: '整天贴着缸壁和叶片刮食藻膜，几乎不吃人工饲料，缸里没藻就容易饿瘦。',
      layer: [0.48, 0.95], speed: 0.55, schooling: 0.55, bold: 0.35, activity: 'both',
      appetite: 0.5, waste: 0.3, bioload: 0.32,
      diet: ['algae'], reach: 0.30,
      aggression: 0, territory: 0, finRisk: 0,
      temp: [22, 27], oxygenNeed: 0.70, hardiness: 0.28,
      size: [1.4, 4.0, 5.0], growthDays: 55, lifespan: 700,
      breed: { mode: 'none', chance: 0 },
      plantBite: 0, algaeEat: 1.0,
      model: { file: 'oto_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'long', tail: 'fork', pattern: 'oto', c1: '#a7a893', c2: '#3d4b3c', c3: '#dcd7b4', fin: '#cdd6bf' }
    },
    {
      id: 'koi', name: '锦鲤', latin: 'Cyprinus rubrofuscus', kind: 'fish', price: 88,
      tags: ['中下层', '大型', '长寿', '需要大缸'],
      desc: '能长到半米、活很多年的大家伙，食量与排泄惊人，翻砂拱草，小缸养不出状态。',
      layer: [0.28, 0.88], speed: 0.82, schooling: 0.35, bold: 0.90, activity: 'day',
      appetite: 2.1, waste: 2.6, bioload: 4.0,
      diet: ['floating', 'sinking', 'flake'], reach: 0.78,
      aggression: 0.03, territory: 0, finRisk: 0,
      temp: [15, 26], oxygenNeed: 0.90, hardiness: 0.88,
      size: [5.0, 28.0, 42.0], growthDays: 160, lifespan: 2600,
      breed: { mode: 'none', chance: 0 },
      plantBite: 0.7, algaeEat: 0.1,
      look: { body: 'long', tail: 'fork', pattern: 'koi', c1: '#fbf6ee', c2: '#e34b32', c3: '#26262c', fin: '#f3e9dc' },
      model: { file: 'koi_rigged.glb', yaw: 0 }
    },

    /* ===== 新增品种 ===== */
    {
      id: 'cardinal', name: '宝莲灯', latin: 'Paracheirodon axelrodi', kind: 'fish', price: 16,
      tags: ['中层', '强群游', '红带贯穿', '喜软水'],
      desc: '比红绿灯更艳的灯科鱼，红色从腹部一直延伸到尾柄，成群才敢放开游。',
      layer: [0.30, 0.72], speed: 0.95, schooling: 0.92, bold: 0.32, activity: 'day',
      appetite: 0.75, waste: 0.45, bioload: 0.38, diet: ['flake', 'sinking'], reach: 0.38,
      aggression: 0, territory: 0, finRisk: 0.12, temp: [23, 28], oxygenNeed: 0.64, hardiness: 0.30,
      size: [1.3, 3.8, 4.8], growthDays: 42, lifespan: 520, breed: { mode: 'none', chance: 0 },
      plantBite: 0, algaeEat: 0,
      look: { body: 'slim', tail: 'fork', pattern: 'neon', c1: '#5aa9ec', c2: '#102a70', c3: '#ef3b45', fin: '#a8d4ea' },
      model: { file: 'cardinal_rigged.glb', yaw: 0 }
    },
    {
      id: 'whitecloud', name: '白云金丝', latin: 'Tanichthys albonubes', kind: 'fish', price: 9,
      tags: ['中上层', '耐低温', '群游', '无需加热'],
      desc: '不用加热棒也活得很好的小型灯类，鳍缘带金红边，冷水缸里的常客。',
      layer: [0.16, 0.62], speed: 1.10, schooling: 0.84, bold: 0.55, activity: 'day',
      appetite: 0.80, waste: 0.42, bioload: 0.34, diet: ['flake', 'floating'], reach: 0.48,
      aggression: 0.02, territory: 0, finRisk: 0.05, temp: [14, 24], oxygenNeed: 0.58, hardiness: 0.92,
      size: [1.3, 3.4, 4.2], growthDays: 32, lifespan: 560, breed: { mode: 'egg', chance: 0.22, minAge: 48, max: 2, cooldown: 24 },
      plantBite: 0, algaeEat: 0,
      model: { file: 'whitecloud_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'slim', tail: 'fork', pattern: 'neon', c1: '#c8c9a0', c2: '#3d5a52', c3: '#e8a13c', fin: '#efcb78' }
    },
    {
      id: 'blacktetra', name: '黑尾大勾', latin: 'Moenkhausia costae', kind: 'fish', price: 13,
      tags: ['中层', '群游', '银亮', '黑尾'],
      desc: '银白身体配一道醒目的黑色尾斑，游速快、成群时整齐得像一片银光。',
      layer: [0.26, 0.70], speed: 1.20, schooling: 0.88, bold: 0.52, activity: 'day',
      appetite: 0.90, waste: 0.48, bioload: 0.40, diet: ['flake', 'sinking'], reach: 0.48,
      aggression: 0.06, territory: 0, finRisk: 0.08, temp: [21, 28], oxygenNeed: 0.58, hardiness: 0.72,
      size: [1.5, 4.4, 5.6], growthDays: 38, lifespan: 600, breed: { mode: 'none', chance: 0 },
      plantBite: 0, algaeEat: 0,
      model: { file: 'blacktetra_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'slim', tail: 'fork', pattern: 'blacktail', c1: '#d9e2df', c2: '#6d818a', c3: '#1c2730', fin: '#c2d2d4' }
    },
    {
      id: 'tigerbarb', name: '虎皮鱼', latin: 'Puntigrus tetrazona', kind: 'fish', price: 14,
      tags: ['中层', '群游', '爱追咬', '活泼'],
      desc: '四道黑纹像虎斑，精力旺盛又爱追长鳍鱼；同种六条以上才不容易互相追打。',
      layer: [0.24, 0.72], speed: 1.35, schooling: 0.75, bold: 0.78, activity: 'day',
      appetite: 1.05, waste: 0.62, bioload: 0.50, diet: ['flake', 'sinking', 'floating'], reach: 0.55,
      aggression: 0.42, territory: 0, finRisk: 0.55, temp: [22, 28], oxygenNeed: 0.58, hardiness: 0.80,
      size: [1.6, 5.4, 7.0], growthDays: 36, lifespan: 620, breed: { mode: 'none', chance: 0 },
      plantBite: 0.05, algaeEat: 0,
      model: { file: 'tigerbarb_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'deep', tail: 'fork', pattern: 'tiger', c1: '#e6c375', c2: '#2a2a2c', c3: '#e07b3c', fin: '#ef9a54' }
    },
    {
      id: 'molly', name: '黑玛丽', latin: 'Poecilia sphenops', kind: 'fish', price: 15,
      tags: ['上层', '卵胎生', '耐咸', '爱吃藻'],
      desc: '通体墨黑的卵胎生鱼，会啃缸壁藻膜，适应力强，状态好时会不断添小鱼。',
      layer: [0.10, 0.52], speed: 0.86, schooling: 0.32, bold: 0.68, activity: 'day',
      appetite: 1.00, waste: 0.78, bioload: 0.62, diet: ['flake', 'floating', 'algae'], reach: 0.50,
      aggression: 0.04, territory: 0, finRisk: 0.20, temp: [22, 28], oxygenNeed: 0.50, hardiness: 0.86,
      size: [1.8, 6.0, 8.0], growthDays: 38, lifespan: 520,
      breed: { mode: 'livebearer', chance: 0.55, minAge: 45, max: 2, cooldown: 18 },
      plantBite: 0, algaeEat: 0.25,
      model: { file: 'molly_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'stout', tail: 'fan', pattern: 'guppy', c1: '#4a4e58', c2: '#141920', c3: '#7c8490', fin: '#2c333c' }
    },
    {
      id: 'discus', name: '七彩神仙', latin: 'Symphysodon aequifasciatus', kind: 'fish', price: 96,
      tags: ['中下层', '圆盘体', '高温', '娇贵'],
      desc: '侧扁如盘的「热带鱼之王」，要 28℃ 以上的稳定软水，水质一波动就先停食给你看。',
      layer: [0.30, 0.78], speed: 0.48, schooling: 0.45, bold: 0.42, activity: 'day',
      appetite: 0.95, waste: 0.95, bioload: 1.5, diet: ['sinking', 'flake'], reach: 0.42,
      aggression: 0.03, territory: 0, finRisk: 0, temp: [27, 32], oxygenNeed: 0.80, hardiness: 0.16,
      size: [3.2, 15.0, 20.0], growthDays: 110, lifespan: 1200, breed: { mode: 'none', chance: 0 },
      plantBite: 0, algaeEat: 0,
      look: { body: 'deep', tail: 'round', pattern: 'discus', c1: '#7fb5a6', c2: '#2d5a64', c3: '#d9793f', fin: '#79a99c' },
      model: { file: 'discus_rigged.glb', yaw: 0 }
    },

    /* ===== 同品种不同色型 ===== */
    {
      id: 'guppy_red', name: '孔雀鱼·红礼服', latin: 'Poecilia reticulata', kind: 'fish', price: 24, breedGroup: 'guppy',
      tags: ['上层', '色型', '卵胎生', '繁殖快'], desc: '红礼服品系，后半身浓烈正红，尾鳍宽大，是草缸里最跳的一抹颜色。',
      layer: [0.10, 0.50], speed: 1.05, schooling: 0.30, bold: 0.78, activity: 'day',
      appetite: 1.0, waste: 0.75, bioload: 0.55, diet: ['flake', 'floating'], reach: 0.48,
      aggression: 0.02, territory: 0, finRisk: 0.85, temp: [22, 28], oxygenNeed: 0.45, hardiness: 0.76,
      size: [1.5, 4.4, 5.8], growthDays: 30, lifespan: 420,
      breed: { mode: 'livebearer', chance: 0.70, minAge: 38, max: 2, cooldown: 15 },
      plantBite: 0, algaeEat: 0,
      look: { body: 'slim', tail: 'fan', pattern: 'guppy', c1: '#e8ddd0', c2: '#9b2530', c3: '#f04a3c', fin: '#d3323f' },
      model: { file: 'guppy_red_rigged.glb', yaw: 0 }
    },
    {
      id: 'guppy_blue', name: '孔雀鱼·蓝草尾', latin: 'Poecilia reticulata', kind: 'fish', price: 26, breedGroup: 'guppy',
      tags: ['上层', '色型', '草尾', '繁殖快'], desc: '尾鳍带细密喷点的蓝草尾，游动时像撒了一把碎钻。',
      layer: [0.10, 0.50], speed: 1.05, schooling: 0.30, bold: 0.78, activity: 'day',
      appetite: 1.0, waste: 0.75, bioload: 0.55, diet: ['flake', 'floating'], reach: 0.48,
      aggression: 0.02, territory: 0, finRisk: 0.85, temp: [22, 28], oxygenNeed: 0.45, hardiness: 0.76,
      size: [1.5, 4.4, 5.8], growthDays: 30, lifespan: 420,
      breed: { mode: 'livebearer', chance: 0.60, minAge: 38, max: 2, cooldown: 16 },
      plantBite: 0, algaeEat: 0,
      look: { body: 'slim', tail: 'fan', pattern: 'guppy', c1: '#8fd4e8', c2: '#1b3f9c', c3: '#143b7a', fin: '#4b78d8' },
      /* 共用孔雀鱼写实模型 + 染色，不再单独占一个 786 面低模 */
      model: { file: 'guppy_rigged.glb', yaw: 0 }
    },
    {
      id: 'betta_red', name: '斗鱼·烈焰红', latin: 'Betta splendens', kind: 'fish', price: 46, breedGroup: 'betta',
      tags: ['上层', '色型', '独居', '强领域'], desc: '正红色半月斗鱼，展鳍时极具压迫感，同缸绝不能放第二只斗鱼。',
      layer: [0.08, 0.46], speed: 0.62, schooling: 0, bold: 0.92, activity: 'day',
      appetite: 0.85, waste: 0.55, bioload: 0.5, diet: ['floating', 'flake'], reach: 0.42,
      aggression: 0.92, territory: 1, finRisk: 0, temp: [24, 30], oxygenNeed: 0.18, hardiness: 0.65,
      size: [2.4, 6.2, 7.4], growthDays: 42, lifespan: 700, breed: { mode: 'none', chance: 0 },
      plantBite: 0, algaeEat: 0,
      model: { file: 'betta_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'stout', tail: 'veil', pattern: 'betta', c1: '#d8363f', c2: '#681221', c3: '#ff8463', fin: '#c2253a' }
    },
    {
      id: 'betta_white', name: '斗鱼·月光白', latin: 'Betta splendens', kind: 'fish', price: 52, breedGroup: 'betta',
      tags: ['上层', '色型', '独居', '强领域'], desc: '素白的白金斗鱼，在弱光下泛着珍珠光泽，性格一样不好惹。',
      layer: [0.08, 0.46], speed: 0.62, schooling: 0, bold: 0.92, activity: 'day',
      appetite: 0.85, waste: 0.55, bioload: 0.5, diet: ['floating', 'flake'], reach: 0.42,
      aggression: 0.92, territory: 1, finRisk: 0, temp: [24, 30], oxygenNeed: 0.18, hardiness: 0.65,
      size: [2.4, 6.2, 7.4], growthDays: 42, lifespan: 700, breed: { mode: 'none', chance: 0 },
      plantBite: 0, algaeEat: 0,
      model: { file: 'betta_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'stout', tail: 'veil', pattern: 'betta', c1: '#e8eef0', c2: '#8fa5b4', c3: '#d7e8ea', fin: '#c8dbe0' }
    },
    {
      id: 'gold_black', name: '黑摩尔', latin: 'Carassius auratus', kind: 'fish', price: 34, breedGroup: 'goldfish',
      tags: ['中下层', '色型', '大胃王', '耗氧高'], desc: '通体乌黑的金鱼品系，食量与排泄同样惊人，低温高氧才养得漂亮。',
      layer: [0.34, 0.92], speed: 0.72, schooling: 0.18, bold: 0.85, activity: 'day',
      appetite: 1.7, waste: 1.9, bioload: 2.4, diet: ['flake', 'sinking', 'floating'], reach: 0.75,
      aggression: 0.05, territory: 0, finRisk: 0, temp: [16, 24], oxygenNeed: 0.85, hardiness: 0.85,
      size: [3.0, 14.0, 20.0], growthDays: 90, lifespan: 1500, breed: { mode: 'none', chance: 0 },
      plantBite: 0.55, algaeEat: 0.08,
      look: { body: 'deep', tail: 'twin', pattern: 'gold', c1: '#3b3a3d', c2: '#111216', c3: '#6c6a72', fin: '#2a2a30' },
      /* 不再单占一个 786 面低模：共用草种金鱼的写实模型，靠 shader 双色重映射压黑。 */
      model: { file: 'goldfish_rigged.glb', yaw: 0 }
    },
    {
      id: 'koi_sanke', name: '锦鲤·大正三色', latin: 'Cyprinus rubrofuscus', kind: 'fish', price: 128, breedGroup: 'koi',
      tags: ['中下层', '色型', '大型', '收藏级'], desc: '红、白、黑三色齐备的大正三色，长成之后是缸里最贵的一尾。',
      layer: [0.28, 0.88], speed: 0.82, schooling: 0.35, bold: 0.90, activity: 'day',
      appetite: 2.1, waste: 2.6, bioload: 4.0, diet: ['floating', 'sinking', 'flake'], reach: 0.78,
      aggression: 0.03, territory: 0, finRisk: 0, temp: [15, 26], oxygenNeed: 0.90, hardiness: 0.88,
      size: [5.0, 28.0, 42.0], growthDays: 160, lifespan: 2600, breed: { mode: 'none', chance: 0 },
      plantBite: 0.7, algaeEat: 0.1,
      look: { body: 'long', tail: 'fork', pattern: 'koi', c1: '#f7f2e8', c2: '#d8452f', c3: '#1e1f24', fin: '#ece3d4' },
      /* 共用锦鲤写实模型 + 染色，不再单独占一个 786 面低模 */
      model: { file: 'koi_rigged.glb', yaw: 0 }
    },

    {
      id: 'clownfish', name: '小丑鱼', latin: 'Amphiprion ocellaris', kind: 'fish', price: 58,
      tags: ['中层', '海水明星', '外置模型', '皮实'],
      desc: '《海底总动员》的主角，橙白相间的海葵鱼。本品种使用外部 GLB 模型文件渲染，加载失败自动回退程序化模型。',
      layer: [0.30, 0.68], speed: 0.80, schooling: 0.20, bold: 0.60, activity: 'day',
      appetite: 0.80, waste: 0.50, bioload: 0.50, diet: ['flake', 'sinking'], reach: 0.40,
      aggression: 0.10, territory: 0, finRisk: 0, temp: [24, 27], oxygenNeed: 0.60, hardiness: 0.70,
      size: [1.5, 5.0, 6.0], growthDays: 55, lifespan: 1300,
      breed: { mode: 'egg', chance: 0.20, minAge: 80, max: 2, cooldown: 30 },
      plantBite: 0, algaeEat: 0.05,
      model: { file: 'clownfish_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'slim', tail: 'round', pattern: 'clownfish', c1: '#ff7a26', c2: '#c2451a', c3: '#f8f6f2', fin: '#ff8f4a' }
    },

    /* ===== 新增品种（第二批）：长鳍与多种体型 ===== */
    {
      id: 'angelfish', name: '神仙鱼', latin: 'Pterophyllum scalare', kind: 'fish', price: 55,
      tags: ['中层', '高身长鳍', '优雅', '喜软水'],
      desc: '侧扁如月、背鳍臀鳍撑成两片帆，游起来慢慢悠悠；怕吵，受惊会竖起所有的鳍。',
      layer: [0.30, 0.72], speed: 0.50, schooling: 0.35, bold: 0.42, activity: 'day',
      appetite: 0.80, waste: 0.70, bioload: 1.10, diet: ['flake', 'sinking'], reach: 0.40,
      aggression: 0.10, territory: 0, finRisk: 0, temp: [24, 30], oxygenNeed: 0.70, hardiness: 0.35,
      size: [1.8, 10.0, 15.0], growthDays: 100, lifespan: 1400,
      breed: { mode: 'egg', chance: 0.20, minAge: 100, max: 2, cooldown: 35 },
      plantBite: 0.10, algaeEat: 0,
      model: { file: 'angelfish_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'deep', tail: 'veil', pattern: 'angel', c1: '#cfd8dc', c2: '#51626e', c3: '#2c3a45', fin: '#b9c6cd' }
    },
    {
      id: 'swordtail', name: '红箭鱼', latin: 'Xiphophorus helleri', kind: 'fish', price: 18,
      tags: ['上层', '卵胎生', '红剑尾', '活泼'],
      desc: '公鱼尾鳍下叶拖出一柄长长的红「剑」，游速快、状态好时剑会更挺括。',
      layer: [0.12, 0.55], speed: 1.00, schooling: 0.30, bold: 0.75, activity: 'day',
      appetite: 1.00, waste: 0.70, bioload: 0.52, diet: ['flake', 'floating'], reach: 0.50,
      aggression: 0.08, territory: 0, finRisk: 0.10, temp: [22, 28], oxygenNeed: 0.50, hardiness: 0.82,
      size: [1.5, 5.5, 7.0], growthDays: 34, lifespan: 520,
      breed: { mode: 'livebearer', chance: 0.65, minAge: 40, max: 3, cooldown: 15 },
      plantBite: 0, algaeEat: 0.04,
      look: { body: 'slim', tail: 'sword', pattern: 'swordtail', c1: '#ef6a4c', c2: '#8f2c26', c3: '#ffd27a', fin: '#e86a4a' },
      model: { file: 'swordtail_rigged.glb', yaw: 0 }
    },
    {
      id: 'clownloach', name: '三间鼠', latin: 'Chromobotia macracanthus', kind: 'fish', price: 42,
      tags: ['底层', '群游', '橙黑三间', '爱躲藏'],
      desc: '橙底三道黑带的小丑鱼，白天爱钻沉木和石缝，夜里出来翻砂；胸鳍长而有力。',
      layer: [0.62, 0.94], speed: 0.85, schooling: 0.65, bold: 0.35, activity: 'both',
      appetite: 0.90, waste: 0.60, bioload: 0.90, diet: ['sinking', 'flake'], reach: 0.45,
      aggression: 0, territory: 0, finRisk: 0, temp: [24, 30], oxygenNeed: 0.70, hardiness: 0.50,
      size: [2.0, 9.0, 13.0], growthDays: 130, lifespan: 2200, breed: { mode: 'none', chance: 0 },
      plantBite: 0.05, algaeEat: 0.10,
      look: { body: 'stout', tail: 'fork', pattern: 'clown', barbel: 1, c1: '#e8a33d', c2: '#232323', c3: '#e0452a', fin: '#d95f2b' },
      model: { file: 'clownloach_rigged.glb', yaw: 0 }
    },
    {
      id: 'denison', name: '一眉道人', latin: 'Sahyadria denisonii', kind: 'fish', price: 30,
      tags: ['中层', '强群游', '红眉', '低温水'],
      desc: '眼上一道红眉、体侧一条黑线，成群巡游时队形整齐得像检阅；喜欢含氧高的凉水。',
      layer: [0.20, 0.66], speed: 1.40, schooling: 0.90, bold: 0.55, activity: 'day',
      appetite: 0.95, waste: 0.50, bioload: 0.46, diet: ['flake', 'sinking'], reach: 0.50,
      aggression: 0.02, territory: 0, finRisk: 0.05, temp: [16, 25], oxygenNeed: 0.72, hardiness: 0.58,
      size: [2.0, 8.5, 11.0], growthDays: 70, lifespan: 900, breed: { mode: 'none', chance: 0 },
      plantBite: 0, algaeEat: 0,
      model: { file: 'denison_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'slim', tail: 'fork', pattern: 'denison', c1: '#dfe6e2', c2: '#22303a', c3: '#e04a3a', fin: '#c7d4d8' }
    },
    {
      id: 'pearlgourami', name: '珍珠马甲', latin: 'Trichogaster leerii', kind: 'fish', price: 32,
      tags: ['中上层', '迷宫鳃', '珍珠点', '温和'], labyrinth: 1,
      desc: '一身珍珠似的喷点，臀鳍像一袭蕾丝长裙；有迷宫鳃能到水面换气，低氧也不怕。',
      layer: [0.18, 0.60], speed: 0.55, schooling: 0.15, bold: 0.50, activity: 'day',
      appetite: 0.85, waste: 0.65, bioload: 0.70, diet: ['flake', 'floating', 'sinking'], reach: 0.50,
      aggression: 0.03, territory: 0, finRisk: 0, temp: [24, 30], oxygenNeed: 0.25, hardiness: 0.68,
      size: [2.0, 8.0, 11.0], growthDays: 60, lifespan: 900,
      breed: { mode: 'egg', chance: 0.30, minAge: 70, max: 2, cooldown: 30 },
      plantBite: 0.08, algaeEat: 0.05,
      look: { body: 'stout', tail: 'round', pattern: 'pearl', c1: '#c9b98f', c2: '#5a6b4a', c3: '#c96a3f', fin: '#d8c9a2' },
      model: { file: 'pearlgourami_rigged.glb', yaw: 0 }
    },
    {
      id: 'bronzecory', name: '青铜鼠鱼', latin: 'Corydoras aeneus', kind: 'fish', price: 16,
      tags: ['底层', '群游', '翻砂', '长胸鳍'],
      desc: '泛着青铜光泽的鼠鱼，胸鳍又长又尖，在砂上一「走」一停，像小号的水底侦察兵。',
      layer: [0.70, 0.96], speed: 0.80, schooling: 0.70, bold: 0.45, activity: 'night',
      appetite: 0.85, waste: 0.50, bioload: 0.50, diet: ['sinking', 'flake'], reach: 0.30,
      aggression: 0, territory: 0, finRisk: 0, temp: [20, 26], oxygenNeed: 0.60, hardiness: 0.70,
      size: [1.6, 6.0, 7.2], growthDays: 52, lifespan: 900,
      breed: { mode: 'egg', chance: 0.25, minAge: 70, max: 2, cooldown: 26 },
      plantBite: 0, algaeEat: 0.06,
      model: { file: 'bronzecory_rigged.glb', yaw: 0, pitch: 0 },
      look: { body: 'stout', tail: 'fork', pattern: 'cory', barbel: 1, c1: '#b0a290', c2: '#3c4a52', c3: '#d9d2bd', fin: '#c4b7a0' }
    }
  ];

  /* ===== 品种色型 / 鳍型变体：入缸时在商店里选 =====
   * colors[0] 与 fins[0] 为默认组合，即原品种本身；其余组合自动生成为独立品种条目。
   * id 规则：基础id + '__色型key' + (非默认鳍时 '_鳍key')，存档兼容（就是普通品种）。 */
  const vDefs = [
    { base: 'zebra',
      colors: [
        { key: 'wild', name: '野生蓝纹' },
        { key: 'gold', name: '金色', priceMul: 1.25, look: { c1: '#e9c96d', c2: '#8a6b2a', c3: '#f4e3a1', fin: '#d9b968' } },
        { key: 'leopard', name: '豹纹', priceMul: 1.30, look: { c1: '#d8cfa8', c2: '#6b5a2e', c3: '#8a7a4a', fin: '#c9bd90' } }
      ],
      fins: [ { key: 'std', name: '普通鳍' }, { key: 'lf', name: '长鳍蝶翼', finMul: 1.55 } ] },
    { base: 'cory',
      colors: [
        { key: 'panda', name: '熊猫' },
        { key: 'albino', name: '白鼠', priceMul: 1.20, look: { c1: '#e8d9c4', c2: '#c98a4a', c3: '#f2e2c8', fin: '#e8a464', eye: '#d03b2f' } },
        { key: 'pepper', name: '花椒', priceMul: 1.15, look: { c1: '#c4b394', c2: '#6e5a3a', c3: '#a08a5e', fin: '#c9b48e' } }
      ] },
    { base: 'bronzecory',
      colors: [
        { key: 'bronze', name: '青铜' },
        { key: 'emerald', name: '绿铜', priceMul: 1.30, look: { c1: '#7e9a86', c2: '#2e4a3e', c3: '#a9c2a8', fin: '#8fb094' } },
        { key: 'albino', name: '白化', priceMul: 1.20, look: { c1: '#e8d9c4', c2: '#c98a4a', c3: '#f2e2c8', fin: '#e8a464', eye: '#d03b2f' } }
      ] },
    { base: 'clownloach',
      colors: [
        { key: 'classic', name: '标准橙黑' },
        { key: 'golden', name: '金三间', priceMul: 1.45, look: { c1: '#e8cf8d', c2: '#5e4a2a', c3: '#d9b968', fin: '#c9a95e' } }
      ] },
    { base: 'angelfish',
      colors: [
        { key: 'silver', name: '银仙' },
        { key: 'black', name: '黑仙', priceMul: 1.30, look: { c1: '#4a565e', c2: '#1e262c', c3: '#0e1418', fin: '#3c4850' } },
        { key: 'gold', name: '金仙', priceMul: 1.40, look: { c1: '#e8cf8d', c2: '#9a7a2e', c3: '#6b5618', fin: '#d9b968' } }
      ],
      fins: [ { key: 'std', name: '标准鳍' }, { key: 'veil', name: '长帆鳍', finMul: 1.25 } ] },
    { base: 'swordtail',
      colors: [
        { key: 'red', name: '正红' },
        { key: 'platinum', name: '白金', priceMul: 1.20, look: { c1: '#e8e4da', c2: '#b0a284', c3: '#f6f2e8', fin: '#e0a24a' } },
        { key: 'blue', name: '蓝剑', priceMul: 1.20, look: { c1: '#7e9ab0', c2: '#2e4256', c3: '#b8cede', fin: '#6a8aa4' } }
      ],
      fins: [ { key: 'std', name: '标准鳍' }, { key: 'highfin', name: '高鳍', finMul: 1.30 } ] },
    { base: 'betta',
      colors: [
        { key: 'blue', name: '蓝宝' },
        { key: 'marble', name: '大理石', priceMul: 1.35, look: { c1: '#c9c4bc', c2: '#2e3440', c3: '#4a5468', fin: '#8a94a8' } }
      ],
      fins: [ { key: 'std', name: '标准鳍' }, { key: 'hm', name: '半月大鳍', finMul: 1.35 } ] },
    { base: 'goldfish',
      colors: [
        { key: 'red', name: '草金' },
        { key: 'sakura', name: '樱花琉金', priceMul: 1.40, look: { c1: '#f2e4da', c2: '#e07a5e', c3: '#fff2e8', fin: '#f2b49a' }, shape: 'globiform' }
      ] },
    { base: 'guppy',
      colors: [
        { key: 'teal', name: '青绿' },
        { key: 'snake', name: '蛇纹黄', priceMul: 1.20, look: { c1: '#e8d9a0', c2: '#9a8a3a', c3: '#c9b95e', fin: '#e0c968' } }
      ],
      fins: [ { key: 'std', name: '普通鳍' }, { key: 'bigfin', name: '大背鳍', finMul: 1.25 } ] },
    { base: 'pearlgourami',
      colors: [
        { key: 'pearl', name: '珍珠' },
        { key: 'gold', name: '金马甲', priceMul: 1.25, look: { c1: '#e8cf8d', c2: '#8a7a3a', c3: '#f2e2b0', fin: '#d9c07a' } },
        { key: 'blue', name: '蓝马甲', priceMul: 1.25, look: { c1: '#9ab0c9', c2: '#3a5270', c3: '#c9d8e8', fin: '#8aa4c4' } }
      ],
      fins: [ { key: 'std', name: '标准鳍' }, { key: 'skirt', name: '长裙鳍', finMul: 1.20 } ] }
  ];

  (function buildVariants() {
    vDefs.forEach(function (d) {
      var base = null;
      fish.forEach(function (f) { if (f.id === d.base) base = f; });
      if (!base) return;
      base.vColors = d.colors;
      base.vFins = d.fins;
      var fins = d.fins || [{ key: 'std', name: '标准鳍' }];
      fins.forEach(function (fin, fi) {
        d.colors.forEach(function (cv, ci) {
          if (ci === 0 && fi === 0) return;      // 默认组合 = 原品种本身
          var v = JSON.parse(JSON.stringify(base));
          v.id = base.id + '__' + cv.key + (fi === 0 ? '' : '_' + fin.key);
          v.name = base.name + '·' + cv.name + (fi === 0 ? '' : '·' + fin.name);
          v.variantOf = base.id;
          v.finMul = fin.finMul || 1;
          if (cv.look) { for (var k in cv.look) v.look[k] = cv.look[k]; }
          if (cv.shape) v.shape = cv.shape;
          v.price = Math.round(base.price * (cv.priceMul || 1.2) + (v.finMul > 1 ? base.price * .18 : 0));
          v.hideInShop = true;
          v.desc = base.desc;
          fish.push(v);
        });
      });
    });
  })();

  const plants = [
    {
      id: 'anubias', name: '水榕', latin: 'Anubias barteri', kind: 'plant', price: 24,
      tags: ['阴性草', '极慢生长', '低光可活'],
      desc: '厚叶、根茎不能埋进砂里，一周只长一点点。灯弱也不黄叶，是最省心的慢生活代表。',
      growth: 0.006, maxH: 0.34, lightNeed: 0.22, nutrientNeed: 0.22, root: true, floating: false,
      shape: 'broad', oxygen: 0.45, uptake: 0.30, shade: 0.10, grazeRisk: 0.10,
      temp: [20, 30], color: '#3f8f57', color2: '#245c3c', leafW: 1.15,
      /* 模型自带 root 旋转（node[0] 绕 X +90°，Z-up 已转成 Y-up），
       * 这里声明 y = 不再扶正；写 z 会被多转一次导致躺倒。 */
      model: { file: 'anubias.glb', yaw: 0, axis: 'y' }
    },
    {
      id: 'moss', name: '三角莫斯', latin: 'Vesicularia sp.', kind: 'plant', price: 18,
      tags: ['附着生长', '耐低光', '幼鱼躲藏'],
      desc: '附着在沉木和石头上铺成绒毯，长得慢，能给幼鱼和虾提供藏身处，也会拦截细小残饵。',
      growth: 0.012, maxH: 0.16, lightNeed: 0.20, nutrientNeed: 0.25, root: false, floating: false,
      shape: 'moss', oxygen: 0.35, uptake: 0.32, shade: 0.06, grazeRisk: 0.08,
      temp: [18, 28], color: '#5aa256', color2: '#2f6b3b', leafW: 1.0,
      model: { file: 'moss.glb', yaw: 0, axis: 'y' }
    },
    {
      id: 'hornwort', name: '金鱼藻', latin: 'Ceratophyllum demersum', kind: 'plant', price: 12,
      tags: ['速生', '无需底砂', '抑藻', '会遮光'],
      desc: '针状轮生叶的漂浮型水草，疯长时几天就能顶到水面，疯狂吸收硝酸盐、压制藻类。',
      growth: 0.052, maxH: 0.92, lightNeed: 0.45, nutrientNeed: 0.75, root: false, floating: false,
      shape: 'needle', oxygen: 0.95, uptake: 0.95, shade: 0.35, grazeRisk: 0.55,
      temp: [16, 30], color: '#4f9d56', color2: '#2c7040', leafW: 0.9,
      /* 同上：GLB root 已带 +90° X 旋转，声明 y 保持自带朝向 */
      model: { file: 'hornwort.glb', yaw: 0, axis: 'y' }
    },
    {
      id: 'elodea', name: '蜈蚣草', latin: 'Egeria densa', kind: 'plant', price: 10,
      tags: ['速生', '耐低温', '产氧强'],
      desc: '茎节一路往上窜，耐冷、耐粗放，白天吐出一串串氧气泡，是经典的新手增氧草。',
      growth: 0.040, maxH: 0.86, lightNeed: 0.40, nutrientNeed: 0.55, root: false, floating: false,
      shape: 'stem', oxygen: 0.85, uptake: 0.70, shade: 0.22, grazeRisk: 0.60,
      temp: [12, 28], color: '#62a84f', color2: '#3a7c3c', leafW: 1.0,
      model: { file: 'elodea.glb', yaw: 0, axis: 'y' }
    },
    {
      id: 'sword', name: '皇冠草', latin: 'Echinodorus amazonicus', kind: 'plant', price: 32,
      tags: ['阳性草', '重肥', '大叶', '中速'],
      desc: '根系发达的大叶皇冠，光和肥不够就黄叶停长；状态好时能长出带小植株的花茎。',
      growth: 0.022, maxH: 0.62, lightNeed: 0.72, nutrientNeed: 0.82, root: true, floating: false,
      shape: 'sword', oxygen: 0.60, uptake: 0.65, shade: 0.18, grazeRisk: 0.45,
      temp: [22, 28], color: '#5aa85a', color2: '#2e6f42', leafW: 1.45,
      model: { file: 'sword.glb', yaw: 0, axis: 'y' }
    },
    {
      id: 'duckweed', name: '浮萍', latin: 'Lemna minor', kind: 'plant', price: 8,
      tags: ['漂浮', '繁殖极快', '遮光', '吸硝酸盐'],
      desc: '浮在水面的小圆叶，一天能铺满一层。吸肥厉害，但盖住水面会遮光、抢走水下草的光照。',
      growth: 0.085, maxH: 0.85, lightNeed: 0.55, nutrientNeed: 0.85, root: false, floating: true,
      shape: 'float', oxygen: 0.18, uptake: 1.0, shade: 0.80, grazeRisk: 0.85,
      temp: [15, 32], color: '#7cc25a', color2: '#4d8c3e', leafW: 1.0,
      model: { file: 'duckweed.glb', yaw: 0, axis: 'y' }
    },
    {
      id: 'hairgrass', name: '牛毛毡', latin: 'Eleocharis parvula', kind: 'plant', price: 20,
      tags: ['前景草', '需强光', '成毯'],
      desc: '细如牛毛的前景草，靠匍匐茎慢慢连成草坪。光弱就徒长稀疏，属于需要耐心的品种。',
      growth: 0.016, maxH: 0.20, lightNeed: 0.78, nutrientNeed: 0.55, root: true, floating: false,
      shape: 'carpet', oxygen: 0.40, uptake: 0.45, shade: 0.02, grazeRisk: 0.30,
      temp: [20, 28], color: '#71b552', color2: '#3f7f3f', leafW: 1.0,
      model: { file: 'hairgrass.glb', yaw: 0, axis: 'y' }
    }
  ];

  const inverts = [
    {
      id: 'apple', name: '苹果螺', latin: 'Planorbella duryi', kind: 'invert', price: 8,
      tags: ['吃藻', '清残饵', '雌雄同体', '易爆缸'],
      desc: '扁圆壳的小劳力，啃藻膜也吃沉底残饵。两只就能繁殖，水质肥了很快满缸都是。',
      algae: 0.45, leftover: 0.65, plantBite: 0.02, graze: 0.55,
      breed: { mode: 'self', chance: 0.55, minAge: 22, max: 2, cooldown: 9 },
      speed: 0.10, size: [0.5, 1.7, 2.4], growthDays: 24, lifespan: 300,
      bioload: 0.22, temp: [18, 30], oxygenNeed: 0.30, hardiness: 0.92,
      /* 螺没有 layer 的话，sim 的边界计算会拿到 undefined 算出 NaN，
       * 再被兜底值落到中层——表现就是「螺漂在水里」。 */
      layer: [0.88, 0.96],
      look: { shell: 'round', c1: '#dc9a5e', c2: '#a35c34' },
      model: { file: 'apple.glb', yaw: 0 }
    },
    {
      id: 'mystery', name: '神秘螺', latin: 'Pomacea diffusa', kind: 'invert', price: 18,
      tags: ['大型', '清残饵', '水面产卵', '啃嫩芽'],
      desc: '个头大、胃口也大，会爬出水面产一坨粉白卵。缺食时会啃柔嫩水草，淡水中繁殖较慢。',
      algae: 0.30, leftover: 0.95, plantBite: 0.28, graze: 0.30,
      breed: { mode: 'pair', chance: 0.12, minAge: 60, max: 1, cooldown: 40 },
      speed: 0.08, size: [1.0, 4.2, 5.6], growthDays: 45, lifespan: 480,
      bioload: 0.60, temp: [20, 28], oxygenNeed: 0.45, hardiness: 0.72,
      layer: [0.88, 0.96],
      look: { shell: 'cone', c1: '#e8cf8d', c2: '#8d6738' },
      model: { file: 'mystery.glb', yaw: 0 }
    },
    {
      id: 'nerite', name: '斑马螺', latin: 'Neritina natalensis', kind: 'invert', price: 22,
      tags: ['除藻最强', '不吃水草', '淡水不繁殖'],
      desc: '缸壁绿斑的克星，只刮藻不啃草。卵需要汽水才能孵化，所以永远不会在淡水缸爆缸。',
      algae: 1.0, leftover: 0.18, plantBite: 0, graze: 1.0,
      breed: { mode: 'none', chance: 0 },
      speed: 0.09, size: [0.9, 2.4, 3.0], growthDays: 40, lifespan: 600,
      bioload: 0.30, temp: [22, 28], oxygenNeed: 0.50, hardiness: 0.70,
      layer: [0.88, 0.96],
      model: { file: 'snail.glb', yaw: 0, pitch: 0 },
      look: { shell: 'nerite', c1: '#d6bd7d', c2: '#3b352c' }
    },
    {
      id: 'shrimp', name: '黑壳虾', latin: 'Neocaridina denticulata', kind: 'invert', price: 10,
      tags: ['群居', '除藻', '胆小', '会被大鱼吃'],
      desc: '几乎透明的清洁小队，夜里更活跃，成群躲在水草间。遇上金鱼、锦鲤就成了点心。',
      algae: 0.70, leftover: 0.55, plantBite: 0, graze: 0.70,
      breed: { mode: 'self', chance: 0.22, minAge: 30, max: 2, cooldown: 22 },
      speed: 0.22, size: [0.5, 2.0, 2.6], growthDays: 32, lifespan: 360,
      bioload: 0.12, temp: [18, 28], oxygenNeed: 0.65, hardiness: 0.40,
      /* 虾在底层活动，但比螺高一点——要能扒水草、跳一下 */
      layer: [0.76, 0.95],
      model: { file: 'shrimp.glb', yaw: Math.PI, pitch: 0 },
      look: { shell: 'shrimp', c1: '#a8c6b8', c2: '#5a7b71' }
    }
  ];

  const foods = [
    { id: 'flake', name: '薄片饲料', desc: '浮在水面慢慢吸水，上层鱼的主食', diet: 'flake', sink: 0.028, nutrition: 0.20, pollution: 0.75, n: 8, color: '#e5b45e' },
    { id: 'floating', name: '浮性颗粒', desc: '长时间漂浮，斗鱼与孔雀鱼爱抢', diet: 'floating', sink: 0.012, nutrition: 0.26, pollution: 0.90, n: 7, color: '#d9923f' },
    { id: 'sinking', name: '沉底颗粒', desc: '快速下沉，喂中层与底层鱼', diet: 'sinking', sink: 0.18, nutrition: 0.24, pollution: 1.0, n: 7, color: '#9c7440' },
    { id: 'bloodworm', name: '冻干红虫', desc: '高蛋白催长，但污染水体也快', diet: 'sinking', sink: 0.10, nutrition: 0.46, pollution: 1.55, n: 6, color: '#a33f3a' },
    { id: 'wafer', name: '螺旋藻片', desc: '沉底藻片，螺虾与异型的加餐', diet: 'algae', sink: 0.30, nutrition: 0.30, pollution: 1.15, n: 3, color: '#4f8a45' }
  ];

  /* gear 里前 4 件是真设备，后 2 件（decor: true）是造景件。
   * 造景件仍然留在 gear，是为了让 D.get('driftwood') / buyGear 的旧调用链不失效；
   * 商店用 D.decor 单独成 tab，且购买走「每次添加一件随机个体」的 addDecor。
   * en 字段给英文/拼音搜索提供非拉丁名的检索词。 */
  const gear = [
    { id: 'filter', kind: 'gear', name: '生化过滤器', en: 'Bio Filter', price: 88, desc: '硝化菌把氨氮转成硝酸盐，开着时水质稳定得多；同时带来轻微水流与增氧。', tag: '净化' },
    { id: 'heater', kind: 'gear', name: '恒温加热棒', en: 'Heater', price: 62, desc: '把水温稳定在设定值。热带鱼低于适温会停食、掉状态，金鱼则怕长期高温。', tag: '控温' },
    { id: 'light', kind: 'gear', name: '全光谱水草灯', en: 'LED Light', price: 70, desc: '可调三档光强。阳性草要强光，光太强又会让缸壁长藻，需要平衡。', tag: '光照' },
    { id: 'air', kind: 'gear', name: '静音气泵', en: 'Air Pump', price: 46, desc: '持续补氧，高密度、高温或夜间水草耗氧时尤其重要。', tag: '增氧' },
    { id: 'driftwood', kind: 'gear', decor: true, name: '沉木', en: 'Driftwood', price: 36, desc: '莫斯的附着基座，也是鼠鱼和虾的躲藏处；每次添加的大小与枝形都不同。', tag: '造景' },
    { id: 'rocks', kind: 'gear', decor: true, name: '青龙石', en: 'Seiryu Stone', price: 28, desc: '堆出层次和洞穴，给底层鱼划分地盘；每次添加的石形与大小都不同。', tag: '造景' }
  ];
  const decor = gear.filter(function (g) { return !!g.decor; });

  /* 缸体尺寸：w/h/d 为 3D 单位，cm 为标称宽度（厘米），cap 为生物负载容量倍率。
   * cm 是渲染层换算真实尺寸的唯一基准：1 个 3D 单位 = w / cm 厘米。
   * 于是任何缸里，sizeCm 的鱼占缸宽的比例恒等于 sizeCm / cm —— 换缸不会让鱼忽大忽小。 */
  const tankSizes = [
    { id: 'small', name: '迷你缸', w: 12.0, h: 7.0, d: 4.8, cm: 30, cap: 0.72, price: 0, desc: '30cm 桌面小缸：适合虾与小型灯鱼，负载有限。' },
    { id: 'medium', name: '标准缸', w: 16.8, h: 8.4, d: 6.2, cm: 45, cap: 1.0, price: 0, desc: '45cm 入门缸：容量均衡，适合灯鱼与鼠鱼。' },
    { id: 'large', name: '大缸', w: 21.0, h: 9.4, d: 7.0, cm: 60, cap: 1.5, price: 320, desc: '60cm 草缸：硝化余量更足，造景空间大。' },
    { id: 'huge', name: '落地缸', w: 25.5, h: 10.4, d: 8.0, cm: 90, cap: 2.1, price: 760, desc: '90cm 景观缸：默认配置，锦鲤、七彩神仙才施展得开。' }
  ];

  /* ---------- 自定义缸体尺寸 ----------
   * 旧的四档预设比例其实不统一：30cm 缸是 0.4 cm/单位、90cm 缸是 0.283 cm/单位，
   * 所以同一只鱼放进不同缸，身体占比并不守恒。改成自定义长宽高之后必须统一尺度，
   * 否则同一个 30cm 缸换成手填值会突然变形。
   * 基准取「90cm 落地缸 = 25.5 单位宽」，即 1 单位 ≈ 3.529cm。 */
  const CM_PER_UNIT = 90 / 25.5;

  const TANK_LIMITS = { l: [30, 200], w: [20, 80], h: [20, 80] };

  function tankFromCm(l, w, h) {
    var lim = TANK_LIMITS;
    l = Math.min(lim.l[1], Math.max(lim.l[0], Math.round(+l || 90)));
    w = Math.min(lim.w[1], Math.max(lim.w[0], Math.round(+w || 30)));
    h = Math.min(lim.h[1], Math.max(lim.h[0], Math.round(+h || 37)));
    /* 容量按体积的 0.55 次方缩放，而不是线性：
     * 线性的话 200cm 缸的负载上限会飙到 90cm 的 12 倍，过滤根本跟不上；
     * 0.55 次方能让大缸确实更省心，但不至于无脑塞鱼。 */
    var vRatio = (l * w * h) / (90 * 30 * 37);
    var cap = Math.min(5.0, Math.max(0.35, 2.1 * Math.pow(vRatio, 0.55)));
    return {
      id: 'custom',
      name: l + '×' + w + '×' + h + 'cm',
      w: l / CM_PER_UNIT,
      h: h / CM_PER_UNIT,
      d: w / CM_PER_UNIT,
      cm: l, cmw: w, cmh: h,
      cap: Math.round(cap * 100) / 100,
      price: 0,
      desc: '长 ' + l + 'cm × 宽 ' + w + 'cm × 高 ' + h + 'cm'
    };
  }

  function mapTank(id) {
    for (var i = 0; i < tankSizes.length; i++) if (tankSizes[i].id === id) return tankSizes[i];
    return tankSizes[1];
  }

  /* 底砂：color 为材质色，base/dark 为程序化纹理底色 */
  const substrates = [
    { id: 'sand', name: '细河沙', price: 0, color: '#aaa086', base: '#8d8767', dark: 'rgba(40,40,30,.26)', plant: 1.0, desc: '中性河沙，最适合鼠鱼翻砂。' },
    { id: 'black', name: '黑金沙', price: 40, color: '#4a4f50', base: '#2b3033', dark: 'rgba(10,14,16,.35)', plant: 1.0, desc: '深色底床，鱼的颜色会显得更鲜艳。' },
    { id: 'white', name: '白沙', price: 35, color: '#e0dbc9', base: '#cfcabb', dark: 'rgba(90,84,68,.24)', plant: 0.92, desc: '明亮干净，不过脏了也最明显。' },
    { id: 'aquasoil', name: '水草泥', price: 90, color: '#574636', base: '#3b2f26', dark: 'rgba(20,14,10,.4)', plant: 1.38, desc: '富含养分、软化水质，扎根水草明显长得快。' },
    { id: 'gravel', name: '彩色陶粒', price: 28, color: '#9a6f56', base: '#7b5a49', dark: 'rgba(50,30,22,.3)', plant: 1.04, desc: '孔隙大不易板结，适合强过滤。' }
  ];

  /* 四季：每 28 个模拟天换季 */
  const seasons = [
    { id: 0, name: '春', temp: 1.5, growth: 1.10, sell: 1.18, desc: '繁殖季，活体行情最好，鱼也长得快。' },
    { id: 1, name: '夏', temp: 4.0, growth: 1.16, sell: 1.02, desc: '水温偏高、溶氧下降，注意增氧。' },
    { id: 2, name: '秋', temp: 0, growth: 1.00, sell: 1.06, desc: '温度平稳，调理水质的好时候。' },
    { id: 3, name: '冬', temp: -4.0, growth: 0.86, sell: 0.88, desc: '生长放缓，加热棒变得重要。' }
  ];

  /* 体型族：鱼类学四分法 + 球形。每族给出一条沿体轴的截面包络曲线 h(u)（u=0 头部、u=1 尾柄）。
   * 同一套放样代码换一族 profile，就能从侧扁的七彩神仙变到棍棒形的异型、平扁的鼠鱼。
   * h 为体高包络（相对最大体高），w 为体宽系数，belly<1 表示腹部压平（平扁体型），bulge 为鳃后隆起。 */
  const bodyShapes = {
    fusiform: {
      name: '纺锤形', desc: '两头尖中间厚，游速快，多数小型灯鱼与锦鲤。',
      h: [[0, .34], [.08, .70], [.22, .95], [.34, 1], [.50, .95], [.66, .80], [.80, .58], [.90, .38], [1, .12]],
      w: .82, bulge: .16
    },
    compressiform: {
      name: '侧扁形', desc: '左右很薄、体高很高，转向灵活，斗鱼与七彩神仙。',
      h: [[0, .44], [.10, .84], [.24, .99], [.38, 1], [.52, .99], [.66, .92], [.78, .78], [.90, .52], [1, .16]],
      w: .48, bulge: .08
    },
    depressiform: {
      name: '平扁形', desc: '腹部压平、贴着底砂走，鼠鱼与异型。',
      h: [[0, .30], [.10, .58], [.24, .78], [.38, .92], [.52, 1], [.66, .94], [.80, .76], [.92, .44], [1, .14]],
      w: 1.24, bulge: .04, belly: .70
    },
    anguilliform: {
      name: '棍棒形', desc: '细长像小棍，摆动幅度从头到尾逐渐放大。',
      h: [[0, .55], [.06, .84], [.20, .94], [.40, .99], [.60, 1], [.78, .94], [.90, .70], [1, .28]],
      w: .58, bulge: 0, longBody: 1.12
    },
    globiform: {
      name: '球形', desc: '圆滚滚的蛋形身体，游得慢、拐弯笨。',
      h: [[0, .42], [.10, .78], [.24, .98], [.40, 1.04], [.56, 1.02], [.70, .92], [.82, .72], [.92, .44], [1, .18]],
      w: .94, bulge: .20
    }
  };
  const shapeById = {
    guppy: 'fusiform', guppy_red: 'fusiform', guppy_blue: 'fusiform',
    neon: 'fusiform', cardinal: 'fusiform', whitecloud: 'fusiform',
    zebra: 'fusiform', blacktetra: 'fusiform', tigerbarb: 'fusiform', molly: 'fusiform',
    koi: 'fusiform', koi_sanke: 'fusiform',
    goldfish: 'fusiform', gold_black: 'globiform',
    betta: 'compressiform', betta_red: 'compressiform', betta_white: 'compressiform',
    discus: 'compressiform',
    cory: 'depressiform', oto: 'anguilliform',
    angelfish: 'compressiform', swordtail: 'fusiform', clownloach: 'depressiform',
    denison: 'fusiform', pearlgourami: 'fusiform', bronzecory: 'depressiform',
    clownfish: 'compressiform'
  };

  /* 品种轮廓签名：吻尖度/头高/背弓/尾柄粗细——让同族鱼的侧影各有性格
   * snout 吻端收窄（越大吻越尖）、headH 头部高度系数、hump 背部弓起、pedK 尾柄粗细系数 */
  const silById = {
    guppy: { snout: .18, headH: .95, pedK: .68 },
    guppy_red: { snout: .18, headH: .95, pedK: .68 },
    guppy_blue: { snout: .18, headH: .95, pedK: .68 },
    neon: { snout: .30, headH: .88, pedK: .70 },
    cardinal: { snout: .30, headH: .90, pedK: .72 },
    whitecloud: { snout: .25, headH: .92, pedK: .76 },
    zebra: { snout: .30, headH: .90, pedK: .74 },
    blacktetra: { snout: .18, headH: 1.02, pedK: .80, hump: .05 },
    tigerbarb: { snout: .16, headH: 1.06, pedK: .68, hump: .14 },
    molly: { snout: .10, headH: 1.12, pedK: .82, hump: .08 },
    betta: { snout: .08, headH: 1.15, pedK: .60, hump: .10 },
    betta_red: { snout: .08, headH: 1.15, pedK: .60, hump: .10 },
    betta_white: { snout: .08, headH: 1.15, pedK: .60, hump: .10 },
    goldfish: { snout: .45, headH: .95, pedK: .55, hump: .16 },
    gold_black: { snout: .42, headH: .95, pedK: .55, hump: .16 },
    koi: { snout: .30, headH: 1.00, pedK: 1.10, hump: .06 },
    koi_sanke: { snout: .30, headH: 1.00, pedK: 1.10, hump: .06 },
    cory: { snout: .50, headH: .78, pedK: .55 },
    bronzecory: { snout: .48, headH: .80, pedK: .56 },
    clownloach: { snout: .42, headH: 1.05, pedK: .60, hump: .08 },
    oto: { snout: .28, headH: .90, pedK: .80 },
    angelfish: { snout: .28, headH: .88, pedK: .48, hump: .12 },
    swordtail: { snout: .22, headH: .95, pedK: .74 },
    denison: { snout: .38, headH: .92, pedK: .80 },
    pearlgourami: { snout: .12, headH: 1.08, pedK: .70, hump: .10 },
    discus: { snout: .20, headH: 1.10, pedK: .50, hump: .18 }
  };

  /* 背鳍形态：normal 普通 / sail 高帆（神仙）/ spike 尖棘（鼠鳅类）/ low 低平（七彩）/ flow 飘长（斗鱼、马甲） */
  const dorsalById = {
    cory: 'spike', bronzecory: 'spike', clownloach: 'spike', oto: 'spike',
    angelfish: 'sail', discus: 'low',
    betta: 'flow', betta_red: 'flow', betta_white: 'flow', pearlgourami: 'flow'
  };

  /* 鳍长系数：1 为标准，越大鳍越长。斑马鱼、鼠鱼类按用户要求加长，
   * 神仙鱼/珍珠马甲/红箭这些「鳍是卖点」的品种给到 1.4~1.85。 */
  const finLenById = {
    zebra: 1.35, cory: 1.45, bronzecory: 1.50, clownloach: 1.40, oto: 1.30,
    neon: 1.15, cardinal: 1.15, whitecloud: 1.20, blacktetra: 1.30,
    tigerbarb: 1.30, molly: 1.25, guppy: 1.25, guppy_red: 1.25, guppy_blue: 1.25,
    betta: 1.25, betta_red: 1.25, betta_white: 1.25,
    goldfish: 1.35, gold_black: 1.35, koi: 1.20, koi_sanke: 1.20, discus: 1.45,
    angelfish: 1.85, swordtail: 1.45, denison: 1.35, pearlgourami: 1.60
  };

  const map = {};
  [].concat(fish, plants, inverts, gear).forEach(function (s) { map[s.id] = s; });
  const foodMap = {};
  foods.forEach(function (f) { foodMap[f.id] = f; });

  window.AW_DATA = {
    fish: fish, plants: plants, inverts: inverts, foods: foods, gear: gear, decor: decor,
    tankSizes: tankSizes, substrates: substrates, seasons: seasons,
    bodyShapes: bodyShapes, shapeById: shapeById, finLenById: finLenById,
    creatures: [].concat(fish, plants, inverts),
    get: function (id) { return map[id]; },
    finLenOf: function (sp) {
      if (!sp) return 1;
      var fl = finLenById[sp.id];
      if (fl == null && sp.variantOf) fl = (finLenById[sp.variantOf] || 1) * (sp.finMul || 1);
      return fl || 1;
    },
    silOf: function (sp) {
      if (!sp) return {};
      return sp.sil || silById[sp.id] || (sp.variantOf && silById[sp.variantOf]) || {};
    },
    dorsalOf: function (sp) {
      if (!sp) return 'normal';
      return dorsalById[sp.id] || (sp.variantOf && dorsalById[sp.variantOf]) || 'normal';
    },
    food: function (id) { return foodMap[id]; },
    /* 支持三种入参：{l,w,h} 直接给厘米 / state（含 tankDims）/ 预设 id。
     * 所有老调用点传的是 s.tankSize（字符串），传 state 进来即可自动走自定义尺寸。 */
    tank: function (spec) {
      if (spec && typeof spec === 'object') {
        if (spec.l != null) return tankFromCm(spec.l, spec.w, spec.h);
        if (spec.tankDims && spec.tankDims.l != null) return tankFromCm(spec.tankDims.l, spec.tankDims.w, spec.tankDims.h);
        if (spec.tankSize) return mapTank(spec.tankSize);
      }
      return mapTank(spec);
    },
    tankFromCm: tankFromCm,
    tankLimits: TANK_LIMITS,
    cmPerUnit: CM_PER_UNIT,
    substrate: function (id) { for (var i = 0; i < substrates.length; i++) if (substrates[i].id === id) return substrates[i]; return substrates[0]; },
    season: function (day) { return seasons[Math.floor(((day || 1) - 1) / 28) % 4]; },
    /* 体型族：个体 → 品种 → 族表 */
    shapeOf: function (sp) {
      // 色型变体不在 shapeById 里，要回退到基础品种，否则图鉴会显示成「纺锤形」
      var key = sp && (sp.shape || shapeById[sp.id] || (sp.variantOf && shapeById[sp.variantOf]));
      return bodyShapes[key] ? key : 'fusiform';
    },
    bodyShape: function (sp) { return bodyShapes[AW_DATA.shapeOf(sp)]; },
    /* 体长-体重关系 W = a·L^b（b≠3 即异速生长）；系数按品种体型给默认值 */
    weightOf: function (sp, cm) {
      if (!sp || sp.kind !== 'fish' || !cm) return 0;
      var shape = AW_DATA.shapeOf(sp);
      var a = shape === 'globiform' ? .028 : shape === 'compressiform' ? .022 :
        shape === 'depressiform' ? .016 : shape === 'anguilliform' ? .006 : .013;
      var b = shape === 'globiform' ? 3.34 : shape === 'compressiform' ? 3.22 :
        shape === 'depressiform' ? 3.12 : shape === 'anguilliform' ? 2.86 : 3.06;
      return a * Math.pow(cm, b);
    },
    speciesName: function (id) { return map[id] ? map[id].name : '未知'; },
    displayName: function (c) { return (c && c.name) ? c.name : (c ? (map[c.specId] ? map[c.specId].name : '未知') : '未知'); },
    stageOf: function (c) {
      var sp = map[c.specId];
      if (!sp) return '未知';
      if (sp.kind === 'plant') return c.h >= sp.maxH * 0.85 ? '成熟' : '生长中';
      var r = c.sizeCm / sp.size[1];
      var old = c.ageDays > sp.lifespan * 0.82;
      if (old) return '老年';
      if (r < 0.5) return '幼体';
      if (r < 0.86) return '亚成体';
      return '成体';
    }
  };
})();
