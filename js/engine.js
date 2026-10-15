/* 一世·汉末 —— 人生模拟引擎
 * 逐年推进：SGE.step(L) 推进一年；遇到需要玩家决定的事，返回 {pending}，
 * 由 SGE.answer(L, i) 作答后再次 step。auto 模式下自动作答（用于同时辰者与统计）。
 * 同一命数（seed）+ 同样的选择 = 同样的一生。
 */
var SGE = (function (D) {
  'use strict';

  /* ================= 工具 ================= */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function pick(R, arr) { return arr[Math.floor(R() * arr.length)]; }
  function wpick(R, items, wfn) {
    var tot = 0, i, ws = [];
    for (i = 0; i < items.length; i++) { var w = Math.max(0, wfn(items[i], i)); ws.push(w); tot += w; }
    var r = R() * tot;
    for (i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  function interp(keys, y) {
    if (y <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      if (y <= keys[i][0]) {
        var a = keys[i - 1], b = keys[i];
        return a[1] + (b[1] - a[1]) * (y - a[0]) / (b[0] - a[0]);
      }
    }
    return keys[keys.length - 1][1];
  }
  function fill(t, map) { return t.replace(/\{(\w+)\}/g, function (m, k) { return map[k] != null ? map[k] : m; }); }

  var CN = '〇一二三四五六七八九';
  function cnNum(n) { // 普通汉字数字：二十五
    if (n < 10) return CN[n];
    if (n < 20) return '十' + (n % 10 ? CN[n % 10] : '');
    if (n < 100) return CN[Math.floor(n / 10)] + '十' + (n % 10 ? CN[n % 10] : '');
    return '一百' + (n % 100 ? (n % 100 < 10 ? '零' : '') + cnNum(n % 100) : '');
  }
  function slipNum(n) { // 简牍记数：廿三、卅五、卌
    if (n >= 20 && n < 50) return ['廿', '卅', '卌'][Math.floor(n / 10) - 2] + (n % 10 ? CN[n % 10] : '');
    return cnNum(n);
  }
  var STEM = '甲乙丙丁戊己庚辛壬癸', BRANCH = '子丑寅卯辰巳午未申酉戌亥';
  function ganzhi(y) { return STEM[(y - 4) % 10] + BRANCH[(y - 4) % 12]; }

  /* ================= 预处理 ================= */
  var ZK = Object.keys(D.ZONES);
  var ZBASE = {};
  ZK.forEach(function (z) { ZBASE[z] = 0; });
  D.JUN.forEach(function (j) { ZBASE[j[1]] += j[2]; });
  function zonePop(z, y) { return ZBASE[z] * interp(D.POP_IDX[z], y); }
  var POP_SCALE = (function () { var s = 0; ZK.forEach(function (z) { s += zonePop(z, 157); }); return 5648 / s; })();
  function totalPop(y) { var s = 0; ZK.forEach(function (z) { s += zonePop(z, y); }); return s * POP_SCALE; }

  var EV_BY_Y = {}, CAMP_BY_Y = {};
  D.EVENTS.forEach(function (e, i) { e.id = i; (EV_BY_Y[e.y] = EV_BY_Y[e.y] || []).push(e); });
  var ARMY_NORM = { caocao: 'wei', liubei: 'shu', sunce: 'wu', sunquan: 'wu' };
  D.CAMPAIGNS.forEach(function (c) {
    c.a = c.a.map(function (k) { return ARMY_NORM[k] || k; });
    (CAMP_BY_Y[c.y] = CAMP_BY_Y[c.y] || []).push(c);
  });

  function ctrl(z, y) {
    var t = D.CTRL[z], f = t[0][1];
    for (var i = 0; i < t.length; i++) if (y >= t[i][0]) f = t[i][1];
    return f;
  }
  function group(fk) { return D.FACTIONS[fk].g; }
  function fname(fk, y) { if (fk === 'jin' && y >= 317) return '东晋'; return D.FACTIONS[fk].n; }
  function armyOf(fk) { var g = group(fk); return g === 'other' ? fk : g; }

  function calendar(z, y) {
    var fk = ctrl(z, y), g = group(fk);
    if (fk === 'chenghan' || fk === 'hanzhao' || fk === 'houzhao') return fk;
    if (y < 220) return 'han';
    if (g === 'shu' || fk === 'nzrebels') return y >= 221 ? 'shu' : 'han';
    if (g === 'wu' || fk === 'shixie') return y >= 222 ? 'wu' : 'wei';
    if (g === 'jin') return 'jin';
    return y >= 265 ? 'jin' : 'wei';
  }
  function era(z, y) {
    var cal = calendar(z, y), list = D.ERAS[cal], e = list[0];
    for (var i = 0; i < list.length; i++) if (y >= list[i][0]) e = list[i];
    var n = y - e[0] + 1;
    return { cal: cal, name: e[1], n: n, text: e[1] + (n === 1 ? '元' : cnNum(n)) + '年' };
  }
  var REIGNS = {
    han: [[146, '汉桓帝'], [168, '汉灵帝'], [190, '汉献帝']],
    wei: [[220, '魏文帝'], [227, '魏明帝'], [240, '魏少帝'], [254, '魏高贵乡公'], [260, '魏元帝']],
    shu: [[221, '蜀汉昭烈帝'], [223, '蜀汉后主']],
    wu: [[222, '吴大帝'], [252, '吴会稽王'], [258, '吴景帝'], [264, '吴末帝']],
    jin: [[265, '晋武帝'], [290, '晋惠帝'], [307, '晋怀帝'], [313, '晋愍帝'], [317, '晋元帝'], [323, '晋明帝'], [326, '晋成帝'], [343, '晋康帝'], [345, '晋穆帝']],
    chenghan: [[304, '成汉武帝']],
    hanzhao: [[304, '汉光文帝'], [310, '汉昭武帝'], [318, '赵主刘曜']],
    houzhao: [[319, '后赵石勒'], [333, '后赵石虎']]
  };
  function reignText(z, y) {
    var e = era(z, y), r = REIGNS[e.cal], name = r[0][1];
    for (var i = 0; i < r.length; i++) if (y >= r[i][0]) name = r[i][1];
    return name + e.text;
  }

  var DIRS = ['东边', '东南', '南方', '西南', '西边', '西北', '北方', '东北'];
  function dirWord(from, to) {
    var a = D.ZONES[from], b = D.ZONES[to];
    var dx = b.x - a.x, dy = b.y - a.y;
    if (Math.sqrt(dx * dx + dy * dy) < 70) return '不远处';
    var ang = Math.atan2(dy, dx); // y 向下为南
    var idx = Math.round(ang / (Math.PI / 4));
    idx = (idx + 8) % 8;
    return DIRS[idx];
  }
  function zoneDist(a, b) { var A = D.ZONES[a], B = D.ZONES[b]; return Math.sqrt(Math.pow(A.x - B.x, 2) + Math.pow(A.y - B.y, 2)) / 100; }
  var REMOTE = { jiao: 1, nanzhong: 1, liaodong: 1, liang: 1 };

  /* ================= 死亡率 ================= */
  var QT = [[0, 0.2], [1, 0.075], [2, 0.045], [3, 0.035], [4, 0.025], [5, 0.013], [10, 0.006], [15, 0.008], [20, 0.01], [30, 0.013], [40, 0.018], [50, 0.026], [55, 0.036], [60, 0.05], [65, 0.075], [70, 0.11], [75, 0.16], [80, 0.24], [85, 0.34]];
  function baseQ(a) { var q = QT[0][1]; for (var i = 0; i < QT.length; i++) if (a >= QT[i][0]) q = QT[i][1]; return q; }
  function chaos(y) { return y < 184 ? 1 : y <= 207 ? 1.2 : y <= 219 ? 1.08 : y <= 290 ? 1 : y <= 316 ? 1.2 : 1.08; }
  var CLS_Q = { gentry: 0.78, merchant: 0.92, clerk: 0.88, slave: 1.2, tenant: 1.05, tribal: 1.08, tuntian: 1.04 };

  /* ================= 姓名 ================= */
  function surname(R, cls) {
    if (cls === 'gentry' && R() < 0.06) return pick(R, D.SURNAMES2);
    var arr = D.SURNAMES;
    var i = Math.floor(Math.pow(R(), 1.7) * arr.length); // 越靠前越常见
    return arr[i];
  }
  function givenName(R, sex) { return pick(R, sex === 'M' ? D.MALE : D.FEMALE); }
  function xiaoName(R) { return '阿' + pick(R, D.XIAO); }
  function ethName(R, eth) {
    var E = D.ETH[eth], syl = E.syl.split('');
    var g = pick(R, syl) + (R() < 0.6 ? pick(R, syl) : '');
    return { sur: E.sur ? pick(R, E.sur.split('')) : '', given: g };
  }

  /* ================= 创建 ================= */
  function pickYear(R, mode) {
    var lo = 150, hi = 220;
    if (mode === 'zhongping') { lo = 182; hi = 186; }
    else if (mode === 'jianan') { lo = 194; hi = 198; }
    else if (mode === 'chaos') { lo = 175; hi = 205; }
    else if (mode === 'blind') { lo = 150; hi = 262; }
    var ys = []; for (var y = lo; y <= hi; y++) ys.push(y);
    return wpick(R, ys, function (y) { return totalPop(y); });
  }
  var WAR_W = {};
  function warWeight(z, y) {
    var k = z + y; if (WAR_W[k] != null) return WAR_W[k];
    var s = 0;
    for (var yy = y; yy < y + 25; yy++) (EV_BY_Y[yy] || []).forEach(function (e) {
      var fx = e.at && e.at[z]; if (fx) s += (fx.war || 0) + (fx.fam || 0) + (fx.plag || 0) + (fx.m15 || 0) + (fx.move || 0) * 0.05;
    });
    return (WAR_W[k] = 1 + s * 25);
  }
  function pickJun(R, y, opts) {
    var idx = D.JUN.map(function (j, i) { return i; });
    return wpick(R, idx, function (i) {
      var j = D.JUN[i];
      if (opts.juns && opts.juns.indexOf(j[0]) < 0) return 0;
      if (opts.zones && opts.zones.indexOf(j[1]) < 0) return 0;
      var w = j[2] * interp(D.POP_IDX[j[1]], y);
      if (opts.mode === 'chaos') w *= warWeight(j[1], y);
      return w;
    });
  }
  function pickClass(R, z, y, opts) {
    var w = { peasant: 0.56, tenant: 0.17, artisan: 0.05, merchant: 0.035, slave: 0.045, clerk: 0.06, gentry: 0.025, tuntian: 0, soldier: 0 };
    var g = group(ctrl(z, y));
    if (g === 'wei' && y >= 196) { w.tuntian = 0.1; w.peasant -= 0.1; }
    if (y >= 200 && (g === 'wei' || g === 'wu' || g === 'shu')) { w.soldier = 0.07; w.peasant -= 0.07; }
    if (g === 'wu') { w.tenant += 0.05; w.peasant -= 0.05; }
    var T = opts.tier, E = opts.edu, k;
    var TM = [
      { tenant: 2, slave: 1.6, tuntian: 1.4, soldier: 1.2, peasant: 0.9, artisan: 0.6, merchant: 0.3, clerk: 0.2, gentry: 0.05 },
      { peasant: 1.3, artisan: 1.2, tenant: 0.8, slave: 0.6, merchant: 1, clerk: 0.7, gentry: 0.3 },
      { merchant: 3, clerk: 3, artisan: 1.5, peasant: 0.8, tenant: 0.3, slave: 0.1, tuntian: 0.5, soldier: 0.5, gentry: 1.5 },
      { gentry: 10, clerk: 3, merchant: 3, peasant: 0.3, tenant: 0.08, slave: 0.03, tuntian: 0.1, soldier: 0.1, artisan: 0.5 }
    ];
    var EM = { none: { clerk: 0.4, gentry: 0.3 }, basic: {}, high: { clerk: 1.6, gentry: 1.4 }, college: { clerk: 2.5, gentry: 2.5 }, grad: { clerk: 3, gentry: 4 } };
    if (T != null) for (k in TM[T]) w[k] *= TM[T][k];
    if (E && EM[E]) for (k in EM[E]) w[k] *= EM[E][k];
    var keys = Object.keys(w);
    return wpick(R, keys, function (k) { return w[k]; });
  }

  function newKin(L, rel, sex, by, name, extra) {
    var k = { id: L.kin.length, rel: rel, sex: sex, by: by, name: name, alive: true, dy: null, cause: null, apart: false, out: false, soldier: null };
    if (extra) for (var p in extra) k[p] = extra[p];
    L.kin.push(k);
    return k;
  }

  function create(seed, opts) {
    opts = opts || {};
    var R = rng(seed);
    var L = {
      seed: seed, opts: opts, mode: opts.mode || 'history', auto: !!opts.auto, R: R,
      years: [], kin: [], alive: true, age: 0, pending: null, pre: null,
      rumors: [], met: {}, meetDone: {}, meetLog: [], achievements: [], bandYears: {}, flags: {},
      moves: 0, places: [], regimes: [], soldierYears: 0, kidsBorn: 0, grandkids: 0, lastChoice: -9,
      office: null, officeMax: null, job: null, injury: null, schooling: false, literate: false
    };
    L.by = opts.year != null ? opts.year : pickYear(R, L.mode);
    var ji = opts.jun != null ? opts.jun : pickJun(R, L.by, opts);
    setPlace(L, ji);
    L.birthJun = ji; L.birthZone = L.zone; L.birthCounty = L.county;

    // 族群
    L.eth = null;
    if (!opts.han) (D.ETHNIC[L.zone] || []).forEach(function (e) { if (!L.eth && R() < e[1]) L.eth = e[0]; });
    L.sex = opts.sex || (R() < 0.51 ? 'M' : 'F');
    L.cls = L.eth ? 'tribal' : pickClass(R, L.zone, L.by, opts);
    var C = D.CLASSES[L.cls];

    // 姓名
    if (L.eth) { var en = ethName(R, L.eth); L.sur = en.sur; L.given = en.given; }
    else { L.sur = surname(R, L.cls); L.given = givenName(R, L.sex); }
    L.xiao = L.sex === 'F' ? '阿' + L.given.slice(-1) : xiaoName(R);
    L.name = L.sur + L.given;

    // 属性
    L.body = Math.round(clamp(30 + R() * 45 + (L.cls === 'gentry' ? 6 : 0) + (L.cls === 'slave' ? -6 : 0), 15, 90));
    L.wealth = Math.round(C.wealth[0] + R() * (C.wealth[1] - C.wealth[0]));
    L.land = Math.round(C.land[0] + R() * (C.land[1] - C.land[0]));
    if (L.cls === 'gentry') L.land = Math.round(L.land / 50) * 50;
    if (L.land < 5) L.land = 0;
    L.learn = 0; L.fame = 0;
    var ST = { gentry: [60, 80], clerk: [40, 55], merchant: [28, 45], peasant: [25, 45], tenant: [15, 30], slave: [3, 12], tribal: [25, 45], tuntian: [18, 32], soldier: [20, 35], artisan: [25, 40] }[L.cls];
    L.standing = Math.round(ST[0] + R() * (ST[1] - ST[0]));
    L.gate = L.cls === 'gentry' ? (R() < 0.3 ? 3 : 2) : L.cls === 'clerk' ? 1 : 0;
    L.clan = 1 + Math.floor(R() * (L.cls === 'gentry' ? 5 : 3));

    // 父母
    var fAge = L.cls === 'gentry' ? 20 + Math.floor(R() * 20) : 18 + Math.floor(R() * 20);
    var mAge = 15 + Math.floor(R() * Math.min(20, fAge - 13));
    var fn = L.eth ? ethName(R, L.eth) : { sur: L.sur, given: givenName(R, 'M') };
    var mSur = L.eth ? (D.ETH[L.eth].sur ? pick(R, D.ETH[L.eth].sur.split('')) : '') : surname(R, L.cls);
    if (mSur === L.sur && !L.eth) mSur = surname(R, L.cls) || '王';
    var father = newKin(L, 'father', 'M', L.by - fAge, fn.sur + fn.given, { lit: false });
    var mother = newKin(L, 'mother', 'F', L.by - mAge, mSur ? mSur + '氏' : '母亲');
    var litP = { gentry: 0.95, clerk: 0.9, merchant: 0.4, artisan: 0.1, peasant: 0.04, tenant: 0.02, tuntian: 0.03, soldier: 0.04, slave: 0.01, tribal: 0.01 }[L.cls];
    father.lit = R() < litP;
    var war = L.by >= 184 && L.by <= 210 || L.by >= 300;
    if (R() < (war ? 0.04 : 0.015)) { father.alive = false; father.dy = L.by; father.cause = 'war'; L.flags.posthumous = true; }
    if (R() < 0.015) { mother.alive = false; mother.dy = L.by; mother.cause = 'childbirth'; L.flags.motherDied = true; }

    // 兄姊
    var births = Math.max(0, Math.floor((mAge - 16) / 2.3 * (0.5 + R() * 0.6)));
    births = Math.min(births, 7);
    L.olderDead = 0;
    for (var i = 0; i < births; i++) {
      if (R() < 0.42) { L.olderDead++; continue; }
      var sx = R() < 0.51 ? 'M' : 'F';
      newKin(L, 'sib', sx, L.by - (births - i) * 2 - Math.floor(R() * 2), sx === 'M' ? xiaoName(R) : '阿' + givenName(R, 'F'));
    }
    // 祖父母
    var gp = Math.floor(R() * 3) - (fAge > 32 ? 1 : 0);
    for (i = 0; i < gp; i++) {
      var gs = i === 0 ? (R() < 0.5 ? 'M' : 'F') : 'F';
      newKin(L, 'gp', gs, L.by - fAge - 20 - Math.floor(R() * 12), gs === 'M' ? fn.sur + givenName(R, 'M') : (L.eth ? '祖母' : surname(R, L.cls) + '氏'));
    }
    var olderSame = L.kin.filter(function (k) { return k.rel === 'sib' && k.sex === L.sex; }).length;
    L.rank = olderSame + 1;
    L.household = 1 + L.kin.filter(function (k) { return k.alive; }).length;
    L.places.push(L.zone);
    L.regimes.push(ctrl(L.zone, L.by));
    L.job = null;
    return L;
  }

  function setPlace(L, ji) {
    var j = D.JUN[ji], R = L.R;
    L.jun = ji; L.zone = j[1]; L.county = pick(R, j[3]);
    L.urban = R() < 0.12;
    L.village = pick(R, D.VILLAGES) + '里';
  }
  function placeText(L) { return D.JUN[L.jun][0] + '·' + L.county; }

  /* ================= 文本小工具 ================= */
  function relName(L, k) {
    switch (k.rel) {
      case 'father': return '父亲';
      case 'mother': return '母亲';
      case 'gp': return k.sex === 'M' ? '祖父' : '祖母';
      case 'sib': return k.by <= L.by ? (k.sex === 'M' ? '哥哥' : '姐姐') : (k.sex === 'M' ? '弟弟' : '妹妹');
      case 'spouse': return L.sex === 'M' ? '妻子' : '丈夫';
      case 'child': return k.sex === 'M' ? '儿子' : '女儿';
    }
    return '亲人';
  }
  function kinLabel(L, k) {
    var r = relName(L, k);
    if (k.rel === 'gp' || (k.rel === 'mother' && k.name === '母亲')) return r;
    return r + k.name;
  }
  function add(L, s, k, t) {
    if (!L.alive && k !== 'death') return null;
    var e = { s: s, k: k, t: t, i: L.rec.entries.length };
    L.rec.entries.push(e);
    return e;
  }
  function ageOf(L, k, y) { return y - k.by; }
  function bodyMul(L) { return 1.4 - L.body / 100 * 0.8; }

  /* ================= 死亡与风险 ================= */
  var HZ = ['war', 'fam', 'plag', 'flood', 'corv'];
  function susc(kind, a, sex, L) {
    var m = 1, w = L.wealth;
    if (kind === 'war') { if (sex === 'M' && a >= 15 && a <= 55) m *= 1.5; if (a < 5) m *= 1.2; if (a >= 60) m *= 1.3; if (w > 70) m *= 0.7; }
    if (kind === 'fam') {
      if (a < 5) m *= 2; else if (a < 12) m *= 1.3; if (a >= 60) m *= 1.7;
      m *= w < 12 ? 1.6 : w < 30 ? 1.15 : w < 60 ? 0.75 : 0.3;
    }
    if (kind === 'plag') { if (a < 10) m *= 1.3; if (a >= 55) m *= 1.6; }
    if (kind === 'corv') { if (!(sex === 'M' && a >= 16 && a <= 60)) return 0; m *= 1.5; }
    if (L.cls === 'gentry') m *= kind === 'fam' ? 0.5 : 0.7;
    if (L.cls === 'slave' && kind === 'fam') m *= 1.3;
    return m;
  }
  var DEATH = {
    infant: ['你没能熬过人生的第一个冬天。', '你出生后不久便染了病，没有活过周岁。', '你在襁褓中夭折了。母亲把你埋在了屋后的桑树下。'],
    child: ['你得了急病，高烧几日后夭亡，年仅{a}岁。', '一场痢疾带走了你，年仅{a}岁。', '你染上了风寒，没能挺过来，年仅{a}岁。', '你掉进了村口的水塘，等大人赶到时已经晚了。年仅{a}岁。'],
    ill: ['你患病卧床数月，终究没能好起来。', '你染上伤寒，七日后去世。', '你得了疟疾，忽冷忽热，最终不治。', '你积劳成疾，咳血而死。', '你的背上生了痈疽，溃烂不愈而死。'],
    old: ['你在睡梦中安静地离去。', '你寿终正寝。', '一个冬日的午后，你坐在门口晒太阳，再也没有醒来。'],
    tiger: ['你上山砍柴，遭遇猛虎，伤重不治。'],
    drown: ['你渡河时船只倾覆，落水而亡。'],
    fall: ['你修缮屋顶时失足跌落，伤重不治。'],
    bandit: ['你在路上遭遇盗贼，被杀害了。'],
    plag: ['疫病中，你染病身亡。', '大疫中，你高烧不退，几天后便去世了。'],
    fam: ['饥荒中，你饿死了。', '你和家人吃光了草根树皮，最终没能熬过这场饥荒。'],
    war: ['乱兵冲进了村子，你死于兵祸之中。', '战乱中，你死在了逃亡的路上。'],
    flood: ['洪水涌来，你没能逃出去。'],
    corv: ['你在服劳役时累倒，再也没有起来。'],
    battle: ['你战死于{n}。'],
    massacre: ['城破之后，你被魏军杀害了。'],
    executed: ['你受到牵连，被处死。'],
    childbirth: ['你生下孩子后血崩不止，死于难产。'],
    road: ['你倒在了逃难的路上。']
  };
  var CAUSE_SHORT = { infant: '夭折', child: '夭折', ill: '病故', old: '寿终', tiger: '虎患', drown: '溺水', fall: '意外', bandit: '盗贼', plag: '疫病', fam: '饥荒', war: '兵祸', flood: '水灾', corv: '劳役', battle: '战死', massacre: '屠城', executed: '株连', childbirth: '难产', road: '死于逃难' };
  var CAUSE_STAT = { infant: '夭折', child: '夭折', ill: '疾病', old: '寿终', tiger: '意外', drown: '意外', fall: '意外', bandit: '兵祸盗贼', plag: '疫病', fam: '饥荒', war: '兵祸盗贼', flood: '意外', corv: '劳役', battle: '战死', massacre: '兵祸盗贼', executed: '株连', childbirth: '难产', road: '饥荒' };

  function die(L, cause, s, map) {
    if (!L.alive) return;
    var t = fill(pick(L.R, DEATH[cause]), map || { a: L.age });
    var e = add(L, s, 'death', t);
    L.alive = false; L.cause = cause; L.causeText = t; L.deathS = s; L.deathI = e.i; L.dy = L.rec.y;
    L.rec.death = true;
  }

  function kinDie(L, k, cause, s, y, extra) {
    if (!k.alive) return;
    k.alive = false; k.dy = y; k.cause = cause;
    if (k.apart) return;
    var a = y - k.by, nm = kinLabel(L, k), t;
    switch (cause) {
      case 'plag': t = nm + '染上疫病，没能熬过去。'; break;
      case 'fam': t = '饥荒中，' + nm + '饿死了。'; break;
      case 'war': t = nm + '死于乱兵之中。'; break;
      case 'flood': t = nm + '被洪水卷走了。'; break;
      case 'corv': t = nm + '服役时累死在了工地上。'; break;
      case 'battle': t = nm + '战死于' + extra + '，再也没有回来。'; break;
      case 'massacre': t = '城破之后，' + nm + '被杀害了。'; break;
      case 'executed': t = nm + '受牵连被杀。'; break;
      case 'childbirth': t = nm + '难产而死。'; break;
      case 'road': t = '逃难路上，' + nm + '倒在了路边。'; break;
      default:
        if (a <= 1) t = nm + '没能活过周岁。';
        else if (a < 15) t = nm + '得了急病，夭折了，年仅' + cnNum(a) + '岁。';
        else if (a < 55) t = nm + '病逝，年' + cnNum(a) + '。';
        else t = nm + '去世了，享年' + cnNum(a) + '。';
    }
    add(L, s, 'fam', t);
    if (k.rel === 'spouse') { L.widowed = true; L.married = false; }
    if (k.rel === 'child') L.rec.tags.push('loss');
  }

  function liveKin(L, filt) { return L.kin.filter(function (k) { return k.alive && !k.apart && (!filt || filt(k)); }); }

  /* ================= 一年的准备：可能产生选择 ================= */
  function localFx(L, ev, z, y) {
    var fx = ev.at && ev.at[z];
    if (!fx && ev.all) { var g = group(ctrl(z, y)); if (!ev.all.g || ev.all.g.indexOf(g) >= 0) fx = ev.all; }
    if (!fx) return null;
    if (fx.eth && fx.eth.indexOf(L.eth) < 0) return { _skip: true };
    if (fx.cls && fx.cls.indexOf(L.cls) < 0) return { _skip: true };
    return fx;
  }
  function zname(z) { return D.ZONES[z].label === D.ZONES[z].zhou ? D.ZONES[z].zhou : D.ZONES[z].zhou + '·' + D.ZONES[z].label; }

  function meetOK(L, m, y) {
    if (y < m.y[0] || y > m.y[1]) return false;
    if (m.zones.indexOf(L.zone) < 0) return false;
    if (m.jun && m.jun.indexOf(D.JUN[L.jun][0]) < 0) return false;
    if (L.age < m.age[0] || L.age > m.age[1]) return false;
    if (m.sex && m.sex !== L.sex) return false;
    if (m.eth && m.eth.indexOf(L.eth) < 0) return false;
    if (m.follow && (L.soldier || L.band)) return false;
    return true;
  }

  function prepare(L, y) {
    var R = L.R, P = { queue: [], dec: { flee: {}, sights: [] } }, a = L.age, z = L.zone;
    var free = !L.soldier && !L.band;
    var gap = a - L.lastChoice >= 3;
    (EV_BY_Y[y] || []).forEach(function (ev) {
      var fx = localFx(L, ev, z, y);
      if (!fx || fx._skip) return;
      if (fx.flee && a >= 14 && free) {
        var dest = pick(R, fx.to);
        if (R() < Math.min(1, fx.flee * 2 + 0.2)) {
          P.queue.push({ key: 'flee', ev: ev.id, dest: dest, q: (fx.t || ev.w) + ' 乡里已经有人开始收拾行装。', o: ['举家逃往' + zname(dest), '留守故土'], auto: Math.min(0.95, fx.flee * 2.2) });
        }
      }
      if (fx.join && L.sex === 'M' && a >= 15 && a <= 45 && free && ['peasant', 'tenant', 'tuntian'].indexOf(L.cls) >= 0) {
        if (R() < fx.join * (L.flags.taiping ? 2 : 1)) P.queue.push({ key: 'join', q: '太平道的人在村口聚集，头裹黄巾，喊着"黄天当立"。有人拉你一起去。', o: ['头裹黄巾，随他们起事', '闭门不出'], auto: L.flags.taiping ? 0.6 : 0.25 });
      }
      if (fx.tt && a >= 16 && free && (L.cls === 'peasant' || L.cls === 'tenant') && L.land < 15) {
        if (R() < fx.tt) P.queue.push({ key: 'tt', q: '官府招募流民屯田，给田给牛，收成官六民四；只是入了屯，便不能随意离开。', o: ['应募屯田', '不去'], auto: 0.5 });
      }
      if (fx.fam && a >= 16 && L.land >= 10 && L.cls !== 'gentry' && free) {
        P.queue.push({ key: 'sell', q: '粮价飞涨，一斗米能换一亩地。家里的存粮撑不到明年。', o: ['卖掉一半田地换粮', '咬牙硬撑'], auto: 0.5 });
      }
    });
    // 历史人物
    D.MEETS.forEach(function (m, i) {
      if (L.meetDone[i] || !meetOK(L, m, y)) return;
      if (R() >= m.p) return;
      if (m.q) {
        var c = { key: 'meet', mi: i, q: m.q, o: m.o.map(function (x) { return x[0]; }), auto: 0.5 };
        P.queue.push(c);
      } else P.dec.sights.push(i);
    });
    // 日常选择（不频繁）
    if (gap && free) {
      var marriedable = !L.married && !L.spouseK;
      if (L.sex === 'M' && marriedable && a >= 16 && a <= 32 && L.cls !== 'slave' && R() < 0.22) {
        var sp = makeSpouse(L, y);
        P.queue.push({ key: 'marry', sp: sp, q: '媒人上门，说合' + sp.from + '的' + sp.name + '（' + cnNum(sp.age) + '岁）。', o: ['答应这门亲事', '再等等'], auto: 0.7 });
      } else if (L.sex === 'F' && marriedable && a >= 18 && a <= 30 && L.cls !== 'slave' && R() < 0.3) {
        var sp2 = makeSpouse(L, y);
        P.queue.push({ key: 'marry', sp: sp2, q: '你已经' + cnNum(a) + '岁了。媒人说合' + sp2.from + '的' + sp2.name + '（' + cnNum(sp2.age) + '岁），' + sp2.desc + '。', o: ['答应这门亲事', '再等等'], auto: 0.75 });
      } else if (a >= 6 && a <= 9 && !L.schooling && ['peasant', 'artisan', 'merchant', 'tenant', 'soldier', 'tuntian'].indexOf(L.cls) >= 0 && L.wealth >= 15 && R() < 0.12) {
        P.queue.push({ key: 'school', q: '乡里的老先生愿意教你识字，学费是每年一斗粟。父母问你想不想去。', o: ['去读书', '帮家里干活'], auto: 0.5 });
      } else if (a >= 16 && a <= 35 && L.learn >= 35 && !L.office && L.sex === 'M' && R() < 0.25) {
        P.queue.push({ key: 'clerk', q: '县里缺一个书佐，县丞问你愿不愿意到县廷当差。', o: ['去县廷', '留在家中'], auto: 0.6 });
      } else if (L.sex === 'M' && a >= 16 && a <= 35 && y >= 186 && y <= 235 && ['peasant', 'tenant', 'artisan'].indexOf(L.cls) >= 0 && R() < 0.07) {
        P.queue.push({ key: 'recruit', q: fname(ctrl(z, y), y) + '的军队在郡里募兵，应募者每月给粮。', o: ['应募从军', '留在家中'], auto: 0.3 });
      } else if (a >= 18 && y >= 190 && y <= 205 && ['yu', 'yan', 'xu', 'luoyang', 'guanzhong', 'qing'].indexOf(z) >= 0 && R() < 0.1) {
        var md = pick(R, ['jingbei', 'jingnan', 'jiangdong', 'liaodong', 'shu', 'jiao']);
        P.queue.push({ key: 'migrate', dest: md, q: '听说' + zname(md) + '一带还算太平，乡里已经有好几户人家南下（或北上）避乱了。', o: ['迁往' + zname(md), '留在故乡'], auto: 0.25 });
      }
    }
    if (L.soldier && !L.band && a >= 18 && R() < 0.035) {
      P.queue.push({ key: 'desert', q: '军中疫病流行，粮饷又欠了三个月。有人约你夜里一起逃走。', o: ['趁夜逃走', '留在营中'], auto: 0.2 });
    }
    return P;
  }

  function makeSpouse(L, y) {
    var R = L.R, sex = L.sex === 'M' ? 'F' : 'M';
    var age = L.sex === 'M' ? clamp(L.age - Math.floor(R() * 7), 14, 40) : L.age + Math.floor(R() * 9);
    var sur = L.eth && !D.ETH[L.eth].sur ? '' : surname(R, L.cls);
    if (sur === L.sur) sur = surname(R, L.cls);
    var given = L.eth ? ethName(R, L.eth).given : givenName(R, sex);
    var from = pick(R, ['邻村', '同里', '邻县', '本县' + pick(R, D.VILLAGES) + '里']);
    var descs = sex === 'M' ? ['家里有几亩薄田', '是个老实的庄稼人', '父亲是个木匠', '家境比你家好一些', '比你大几岁，人还算本分'] : ['手很巧，会织布', '家里兄弟多', '性子温和', '家境和你家差不多'];
    return { sex: sex, age: age, sur: sur, given: given, name: sur + given, from: from, desc: pick(R, descs) };
  }

  function autoPick(L, c) { return L.R() < c.auto ? 0 : 1; }

  function applyChoice(L, c, P) {
    var i = c.answer, d = P.dec;
    L.lastChoice = L.age;
    var lbl = c.o[i];
    if (!L.auto) (L.choiceLog = L.choiceLog || []).push({ y: L.by + L.age, q: c.q, a: lbl });
    P.chosen = P.chosen || [];
    P.chosen.push({ q: c.q, a: lbl, key: c.key });
    switch (c.key) {
      case 'flee': d.flee[c.ev] = { go: i === 0, dest: c.dest }; break;
      case 'join': d.join = i === 0; break;
      case 'tt': d.tt = i === 0; break;
      case 'sell': d.sell = i === 0; break;
      case 'marry': d.marry = i === 0 ? c.sp : null; break;
      case 'school': d.school = i === 0; break;
      case 'clerk': d.clerk = i === 0; break;
      case 'recruit': d.recruit = i === 0; break;
      case 'migrate': d.migrate = i === 0 ? c.dest : null; break;
      case 'desert': d.desert = i === 0; break;
      case 'meet':
        var m = D.MEETS[c.mi];
        if (m.o[i][1] === 'see') {
          d.meet = c.mi;
          if (m.follow) P.queue.unshift({ key: 'follow', mi: c.mi, q: m.follow.q, o: m.follow.o.map(function (x) { return x[0]; }), auto: 0.4, pre: m.t });
        }
        break;
      case 'follow': if (i === 0) d.follow = D.MEETS[c.mi].follow.band; break;
    }
  }

  /* ================= 推进一年 ================= */
  function step(L) {
    if (!L.alive) return null;
    var y = L.by + L.age;
    if (!L.pre) L.pre = prepare(L, y);
    var P = L.pre;
    while (P.queue.length) {
      var c = P.queue[0];
      if (c.answer === undefined) {
        if (L.auto) c.answer = autoPick(L, c);
        else { L.pending = c; return { pending: c }; }
      }
      P.queue.shift();
      applyChoice(L, c, P);
    }
    L.pending = null;
    var rec = runYear(L, y, P);
    L.pre = null;
    return rec;
  }
  function answer(L, i) { if (L.pending) L.pending.answer = i; }
  function runToEnd(L) { var g = 0; while (L.alive && g++ < 130) step(L); return L; }

  function runYear(L, y, P) {
    var R = L.R, dec = P.dec, a = L.age;
    var rec = { y: y, age: a, zone: L.zone, ctrl: ctrl(L.zone, y), entries: [], tags: [], chosen: P.chosen || [] };
    L.rec = rec;
    L.yConscript = 0;

    // 政权更替
    var fk = rec.ctrl;
    if (L.regimes[L.regimes.length - 1] !== fk) {
      if (a > 0) add(L, 0.02, 'note', '你所在的' + D.ZONES[L.zone].zhou + '，如今归' + fname(fk, y) + '统治。');
      L.regimes.push(fk);
    }

    if (a === 0) birthEntries(L, y);
    if (L.band) bandYear(L, y);

    // 本年的历史事件
    (EV_BY_Y[y] || []).forEach(function (ev) {
      if (!L.alive) return;
      var fx = localFx(L, ev, L.zone, y);
      if (!fx) { farOrRumor(L, ev, y); return; }
      if (fx._skip) return;
      applyFx(L, ev, fx, dec, y);
    });
    if (!L.alive) return finishYear(L, rec);

    // 迁徙选择
    if (dec.migrate) relocate(L, dec.migrate, 1.2, '你家收拾了能带走的东西，跟着同乡迁往{dest}。', 0.03, y);
    // 传闻
    L.rumors = L.rumors.filter(function (r) {
      if (r.y <= y) { add(L, Math.floor(R() * 4) + 0.5, 'rumor', r.t); return false; }
      return true;
    });

    // 历史人物
    if (dec.meet != null) meetHappen(L, dec.meet, y, 1.0);
    dec.sights.forEach(function (i) { meetHappen(L, i, y, 1 + R() * 2); });
    if (dec.follow) joinBand(L, dec.follow, y);

    // 军旅
    if (dec.join) {
      L.soldier = { army: 'yellow', since: y }; L.job = '黄巾';
      add(L, 0.3, 'war', '你头裹黄巾，加入了太平道的队伍。');
    }
    if (dec.recruit) enlist(L, y, 1.1, true);
    if (dec.desert && L.soldier) desert(L, y);
    if (L.soldier && !L.band) soldierYear(L, y);
    if (!L.alive) return finishYear(L, rec);

    lifeStage(L, y, dec);
    if (!L.alive) return finishYear(L, rec);

    kinYear(L, y);

    // 本人基础死亡率
    var q = baseQ(a) * (CLS_Q[L.cls] || 1) * chaos(y) * bodyMul(L) * (L.injury ? 1.15 : 1) * (L.wealth < 10 ? 1.15 : 1);
    if (R() < q) {
      var cause, s = Math.floor(R() * 4) + 0.6;
      if (a === 0) cause = 'infant';
      else if (a < 15) cause = 'child';
      else {
        var oldW = a >= 55 ? (a - 50) / 10 : 0;
        cause = wpick(R, ['ill', 'old', 'tiger', 'drown', 'fall', 'bandit'], function (c) {
          return { ill: 1, old: oldW, tiger: 0.03, drown: 0.04, fall: 0.03, bandit: 0.04 * chaos(y) * chaos(y) }[c];
        });
      }
      // 神医
      if ((cause === 'ill' || cause === 'child') && ['yu', 'xu', 'yan'].indexOf(L.zone) >= 0 && y >= 185 && y <= 207 && R() < 0.06) {
        add(L, s, 'meet', '你病得奄奄一息时，一位游方医者路过，为你施针用药。你竟活了下来。后来才知道，他叫华佗。');
        markMet(L, 'huatuo', y, '华佗曾救过你的命。');
        L.body = clamp(L.body - 5, 5, 100);
      } else die(L, cause, s, { a: cnNum(a) });
    }
    return finishYear(L, rec);
  }

  function finishYear(L, rec) {
    if (!L.alive) {
      rec.entries = rec.entries.filter(function (e) { return e.k === 'death' || e.s < L.deathS || (e.s === L.deathS && e.i < L.deathI); });
    } else {
      // 无事之年
      var personal = rec.entries.filter(function (e) { return e.k !== 'far' && e.k !== 'rumor' && e.k !== 'note'; });
      if (rec.major || personal.length === 0) {
        var d = daily(L, rec.y);
        if (d) add(L, rec.major ? 2.6 : 1.5 + L.R() * 2, 'life', rec.major ? '这一年你' + cnNum(L.age) + '岁，' + d.replace(/。$/, '') + '。' : d);
      }
      // 属性漂移
      if (L.age > 40) L.body -= 0.6;
      if (L.age > 60) L.body -= 1;
      if (L.wealth > 55 && L.age < 40) L.body += 0.4;
      var C = D.CLASSES[L.cls], mid = (C.wealth[0] + C.wealth[1]) / 2;
      L.wealth += (mid - L.wealth) * 0.07;
      L.body = clamp(L.body, 3, 100);
      L.wealth = clamp(L.wealth, 0, 100);
      L.standing = clamp(L.standing, 0, 100);
      L.learn = clamp(L.learn, 0, 100);
      L.fame = clamp(L.fame, 0, 100);
    }
    rec.entries.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    rec.attr = { body: Math.round(L.body), wealth: Math.round(L.wealth), learn: Math.round(L.learn), standing: Math.round(L.standing), fame: Math.round(L.fame) };
    rec.zoneEnd = L.zone;
    rec.alive = L.alive;
    L.years.push(rec);
    if (L.alive) L.age++;
    return rec;
  }

  /* ---------- 出生 ---------- */
  function birthEntries(L, y) {
    var R = L.R, C = D.CLASSES[L.cls], father = L.kin[0], mother = L.kin[1];
    var where = D.ZONES[L.zone].zhou + D.JUN[L.jun][0] + L.county + (L.urban ? '县城' : '') + L.village;
    var desc = L.eth ? D.ETH[L.eth].tribe : C.desc;
    if (L.eth) where = D.ZONES[L.zone].zhou + D.JUN[L.jun][0] + '境内的山野之间';
    add(L, 0, 'life', '你出生在' + where + '，' + desc + '。');
    var sibs = L.kin.filter(function (k) { return k.rel === 'sib'; }).length;
    var t = sibs === 0 ? '你是家里的第一个孩子。' : '你上面有' + cnNum(sibs) + '个哥哥姐姐。';
    if (L.olderDead > 0) t += '母亲原本还生过' + cnNum(L.olderDead) + '个孩子，都没能养大。';
    add(L, 0.05, 'fam', t);
    if (L.flags.posthumous) add(L, 0.1, 'fam', '你还没出生，父亲就死在了乱兵之中。');
    if (L.flags.motherDied) add(L, 0.12, 'fam', '母亲生下你不久就去世了。');
    if (L.cls === 'slave') add(L, 0.15, 'note', '按照律令，奴婢所生的孩子也是奴婢。你的名字被写进了主人家的簿籍，与牛马同列。');
    add(L, 0.2, 'fam', L.sex === 'M' ? '父母给你取了个小名，叫' + L.xiao + '。' : '大人们叫你' + L.xiao + '。');
  }

  /* ---------- 远方大事与传闻 ---------- */
  function farOrRumor(L, ev, y) {
    var R = L.R;
    if (ev.major && ev.far && L.age >= 0) {
      var dir = dirWord(L.zone, ev.o);
      add(L, ev.s + 0.05, 'far', ev.far.replace('{dir}', dir));
      L.rec.major = true;
      if (L.age >= 5) add(L, ev.s + 0.06, 'far2', pick(R, ['你没有参与。', '你对此一无所知。', '这些事，离你很远。']));
    }
    var r = (L.learn >= 40 || L.cls === 'gentry') && ev.r2 ? ev.r2 : ev.r1;
    if (!r && ev.r2 && (L.learn >= 40 || L.cls === 'gentry')) r = ev.r2;
    if (r && L.age >= 4 && R() < (ev.major ? 0.85 : 0.35)) {
      var d = zoneDist(L.zone, ev.o);
      var delay = d < 1.2 ? 0 : d < 2.5 ? (R() < 0.5 ? 0 : 1) : d < 4 ? 1 + Math.floor(R() * 2) : 2 + Math.floor(R() * 2);
      if (REMOTE[L.zone]) delay++;
      if (L.cls === 'gentry' && delay > 0) delay--;
      if (delay === 0) add(L, Math.min(3.9, ev.s + 0.6 + R()), 'rumor', r);
      else L.rumors.push({ y: y + delay, t: r });
    }
  }

  /* ---------- 地方效果 ---------- */
  function applyFx(L, ev, fx, dec, y) {
    var R = L.R, s = ev.s + 0.1, a = L.age;
    if (fx.t) add(L, s, 'hist', fx.t);
    var fled = false, moved = false, dest = null;
    if (fx.flee) {
      var f = dec.flee[ev.id];
      if (f) { fled = f.go; dest = f.dest; }
      else if (a < 14 && !L.soldier && R() < fx.flee) { fled = true; dest = pick(R, fx.to); L.parentsFled = true; }
    }
    if (!fled && fx.move && !L.soldier && !L.band && R() < fx.move) { moved = true; dest = pick(R, fx.to); }
    var hm = fled ? 0.35 : 1;
    var em = fx.ethMul && L.eth && fx.ethMul[L.eth] ? fx.ethMul[L.eth] : 1;
    for (var h = 0; h < HZ.length; h++) {
      var kind = HZ[h];
      if (!fx[kind]) continue;
      var p = fx[kind] * hm * em * susc(kind, a, L.sex, L) * bodyMul(L);
      if (kind === 'fam' && dec.sell) p *= 0.45;
      if (kind === 'fam' && dec.sell === false) p *= 1.25;
      if (R() < p) { die(L, kind, s + 0.05); return; }
      liveKin(L).forEach(function (k) {
        var pk = fx[kind] * hm * em * susc(kind, ageOf(L, k, y), k.sex, L);
        if (R() < pk) kinDie(L, k, kind, s + 0.04, y);
      });
      L.rec.tags.push('hard');
      if (kind === 'fam') L.body -= 4;
      if (kind === 'plag') L.body -= 2;
    }
    if (fx.m15) {
      var mm = D.JUN[L.jun][0] === '辽东郡' ? 1.6 : 0.3;
      if (L.sex === 'M' && a >= 15 && R() < fx.m15 * mm) { die(L, 'massacre', s + 0.05); return; }
      liveKin(L, function (k) { return k.sex === 'M' && ageOf(L, k, y) >= 15; }).forEach(function (k) { if (R() < fx.m15 * mm) kinDie(L, k, 'massacre', s + 0.04, y); });
    }
    if (fx.purge && (L.cls === 'gentry' || L.office) && a >= 15 && R() < fx.purge * (L.office ? 2.5 : 1)) { die(L, 'executed', s + 0.05); return; }
    if (fx.loss) L.wealth -= fx.loss * (0.6 + R() * 0.6) * (L.cls === 'gentry' ? 0.6 : 1);
    if (fx.gain) L.wealth += fx.gain;
    if (fx.fame) L.fame += fx.fame;
    if (fx.conscript) L.yConscript += fx.conscript;
    if (dec.sell && fx.fam && L.land >= 10) {
      var sold = Math.floor(L.land / 2); L.land -= sold; L.wealth += 6;
      add(L, s + 0.02, 'bad', '你家卖掉了' + cnNum(sold) + '亩田，换回几石粮食。');
      dec.sell = 'done';
    }
    if (dec.tt && fx.tt) {
      L.cls = 'tuntian'; L.job = '屯田客'; L.land = 0;
      add(L, s + 0.2, 'life', '你家应募成了屯田客，分到了官田，还借到一头官牛。');
      dec.tt = false;
    }
    if (fled || moved) {
      var txt = fled ? (fx.ft || '你家随着逃难的人群，往{dest}去了。') : (fx.mt || '你家被官府强迁往{dest}。');
      if (fled && a < 14) txt = '父母决定逃难。' + txt;
      relocate(L, dest, s + 0.2, txt, fx.mr || 0.03, y);
      if (!L.alive) return;
      if (fled && fx.fn === 'changban') changban(L, y, s + 0.3);
    }
    if (fx.fn && SPECIAL[fx.fn]) SPECIAL[fx.fn](L, fx, s, y, fled);
  }

  function relocate(L, dest, s, text, risk, y) {
    var R = L.R, a = L.age;
    var ji = pickJun(R, y, { zones: [dest] });
    var oldZone = L.zone;
    setPlace(L, ji);
    L.moves++; L.places.push(dest);
    add(L, s, 'move', fill(text, { dest: zname(dest) + '的' + D.JUN[ji][0] }));
    L.rec.tags.push('move');
    var p = risk * (a < 5 || a > 60 ? 2 : 1) * bodyMul(L);
    if (R() < p) { die(L, 'road', s + 0.05); return; }
    liveKin(L).forEach(function (k) {
      var ka = ageOf(L, k, y);
      if (k.out) { k.apart = true; return; }
      if (R() < risk * (ka < 5 || ka > 60 ? 2 : 1)) kinDie(L, k, 'road', s + 0.04, y);
    });
    // 新地方的生计
    L.wealth -= 10;
    if (['peasant', 'clerk'].indexOf(L.cls) >= 0) {
      L.land = 0;
      if (R() < 0.6) { L.cls = 'tenant'; L.job = L.job === '农' ? '佃户' : L.job; add(L, s + 0.1, 'bad', '在新的地方你家没有田，只好投靠当地豪强，做了佃客。'); }
      else { L.cls = 'peasant'; L.land = 10 + Math.floor(R() * 20); add(L, s + 0.1, 'life', '官府把荒地分给流民，你家分到了' + cnNum(L.land) + '亩。'); }
    }
    if (L.cls === 'gentry') L.land = Math.round(L.land / 4);
    var fk = ctrl(L.zone, y);
    if (oldZone !== L.zone && L.regimes[L.regimes.length - 1] !== fk) L.regimes.push(fk);
  }

  /* ---------- 特殊事件 ---------- */
  var SPECIAL = {
    shanyue: function (L, fx, s, y) {
      if (L.eth !== 'shanyue' || !L.alive) return;
      if (L.R() < 0.5) {
        L.eth = null; L.cls = 'peasant'; L.land = 10;
        if (L.sex === 'M' && L.age >= 16 && L.age <= 45 && !L.soldier) { L.soldier = { army: 'wu', since: y }; L.job = '军卒'; add(L, s + 0.3, 'war', '你们的宗部被迫出山。按孙家的规矩，"强者为兵，羸者补户"——你被编入了吴军。'); }
        else add(L, s + 0.3, 'move', '你们的宗部被迫出山。你家被编入平地的户籍，从此要向官府纳租服役。');
      }
    },
    wuhuan: function (L, fx, s, y) {
      if (L.eth !== 'wuhuan' || !L.alive) return;
      if (L.R() < 0.5) {
        relocate(L, 'ji', s + 0.3, '曹军破了乌桓。你们部落被迁入中原，安置在{dest}。', 0.04, y);
        if (L.alive && L.sex === 'M' && L.age >= 16 && L.age <= 45) { L.soldier = { army: 'wei', since: y }; L.job = '骑卒'; add(L, s + 0.4, 'war', '乌桓的骑手被编入曹军，号称"天下名骑"。你也在其中。'); }
      }
    },
    di219: function (L, fx, s, y) {
      if (L.eth === 'di' && L.alive && L.zone === 'hanzhong' && L.R() < 0.7) relocate(L, 'guanzhong', s + 0.3, '曹军把武都的氐人迁往关中，你们一族被安置在{dest}。', 0.03, y);
    },
    nanzhong: function (L, fx, s, y) {
      if (L.eth === 'yi' && L.alive && L.sex === 'M' && L.age >= 16 && L.age <= 40 && L.R() < 0.08) {
        relocate(L, 'shu', s + 0.3, '诸葛丞相把南中的劲卒青羌万余家迁入蜀中，编为"飞军"。你也被编入其中，迁到{dest}。', 0.03, y);
        if (L.alive) { L.soldier = { army: 'shu', since: y }; L.job = '军卒'; }
      }
    },
    yizhou: function (L, fx, s, y) {
      if (L.soldier && L.soldier.army === 'wu' && L.R() < 0.15) {
        add(L, s + 0.2, 'war', '你被选入了出海的甲士之中。船队在海上漂了一年，到了一个叫夷洲的地方。');
        if (L.R() < 0.75) die(L, 'plag', s + 0.5);
        else add(L, 3.5, 'war', '"军行经岁，士众疾疫死者十有八九"。你是活着回来的少数人之一。');
      }
    },
    marry273: function (L, fx, s, y) {
      if (L.sex === 'F' && L.age >= 17 && !L.married && !L.spouseK && L.alive) {
        add(L, s + 0.1, 'life', '朝廷下诏：女子年十七父母不嫁者，由官府为之婚配。');
        doMarry(L, makeSpouse(L, y), y, s + 0.2, '官府为你配了婚。');
      }
    },
    demob280: function (L, fx, s, y) {
      if (L.soldier && (L.soldier.army === 'jin' || L.soldier.army === 'wei') && L.R() < 0.6) {
        L.soldier = null; L.job = L.cls === 'soldier' ? '农' : (L.job === '军卒' ? '农' : L.job);
        add(L, s + 0.2, 'good', '天下一统，朝廷"罢州郡兵"。你卸下了兵甲，回家种地。');
      }
    }
  };

  function changban(L, y, s) {
    var R = L.R;
    add(L, s, 'meet', '逃难的人流里，你看见刘备骑在马上，频频回头。有人劝他丢下百姓先走，他说："今人归吾，吾何忍弃去！"');
    markMet(L, 'liubei', y, '你曾随刘备一同南逃。');
    if (R() < 0.15) {
      add(L, s + 0.2, 'meet', '乱军之中，一员将领怀抱婴儿，单骑从你身旁冲过。后来你才知道，那是赵云，怀里抱的是刘备的儿子阿斗。');
      markMet(L, 'zhaoyun', y, '长坂乱军中，赵云从你身旁冲过。');
    }
  }

  /* ---------- 历史人物 ---------- */
  function markMet(L, id, y, ach) {
    if (!L.met[id]) { L.met[id] = y; L.meetLog.push({ id: id, y: y, ach: ach }); }
  }
  function meetHappen(L, i, y, s) {
    var m = D.MEETS[i];
    L.meetDone[i] = true;
    var title = y < 219 ? '左将军' : y < 221 ? '汉中王' : '皇帝';
    add(L, s, 'meet', fill(m.t, { title: title }));
    var fig = D.FIGURES.filter(function (f) { return f.id === m.f; })[0];
    markMet(L, m.f, y, '你曾' + (m.follow ? '在乡里见过' : '见过') + fig.n + '。');
    if (m.fx) {
      if (m.fx.flag) L.flags[m.fx.flag] = true;
      if (m.fx.learn) L.learn += m.fx.learn;
      if (m.fx.body) L.body += m.fx.body;
    }
    L.rec.tags.push('meet');
  }

  function joinBand(L, key, y) {
    var B = D.BANDS[key];
    L.band = key; L.bandYears[key] = 0;
    L.soldier = { army: 'band', since: y };
    L.job = '军卒';
    liveKin(L).forEach(function (k) { k.apart = true; });
    add(L, 1.3, 'war', '你辞别了家人，跟着' + B.who + '走了。');
  }
  function bandYear(L, y) {
    var R = L.R, B = D.BANDS[L.band], p = B.path[y];
    if (!p) { endBand(L, y, true); return; }
    L.bandYears[L.band]++;
    if (L.zone !== p[0]) { var ji = pickJun(R, y, { zones: [p[0]] }); setPlace(L, ji); L.places.push(p[0]); L.moves++; }
    add(L, 0.4, 'war', p[2]);
    L.rec.tags.push('band');
    if (R() < p[1] * bodyMul(L) * 1.1) { die(L, 'battle', 0.6, { n: '追随' + B.who + '的路上' }); recordBand(L); return; }
    if (R() < (p[3] || 0.05)) {
      add(L, 0.8, 'bad', '乱军之中，你与' + B.who + '的队伍失散了，再也没能找到他们。你在' + D.JUN[L.jun][0] + '安顿下来。');
      recordBand(L); L.band = null; L.soldier = null; L.job = '农'; L.cls = L.cls === 'gentry' ? 'gentry' : 'tenant';
      return;
    }
    if (y >= B.end) endBand(L, y, false);
  }
  function recordBand(L) {
    var B = D.BANDS[L.band], n = L.bandYears[L.band];
    if (n > 0) L.achievements.push(B.ach(n));
  }
  function endBand(L, y, silent) {
    var B = D.BANDS[L.band];
    recordBand(L);
    L.band = null;
    L.soldier = { army: B.after === 'sunce' ? 'yuanshu' : B.after, since: y };
    if (B.after === 'sunce') L.flags.sunjianOld = true;
    if (!silent) add(L, 3.6, 'war', B.after === 'wei' ? '你成了曹军中的一名老兵。' : B.after === 'shu' ? '你留在蜀汉军中，成了一名老兵。' : '你和孙坚的旧部一起，暂时依附袁术。');
  }

  /* ---------- 军旅 ---------- */
  function enlist(L, y, s, voluntary) {
    var fk = ctrl(L.zone, y), army = armyOf(fk);
    L.soldier = { army: army, since: y };
    var horse = ['liang', 'bing', 'you'].indexOf(L.zone) >= 0 || L.eth;
    L.job = horse && L.R() < 0.5 ? '骑卒' : L.R() < 0.3 ? '弓手' : '军卒';
    add(L, s, 'war', (voluntary ? '你应募从军，' : '官府征兵，你') + '被编入' + fname(fk, y) + '的军中，成了一名' + L.job + '。');
    if (army === 'wei' && y >= 200) { L.cls = L.cls === 'gentry' ? 'gentry' : 'soldier'; add(L, s + 0.05, 'note', '按曹魏的士家制度，你的家人从此也编入士籍，世代为兵，不得随意迁徙。'); }
  }
  function desert(L, y) {
    var R = L.R;
    add(L, 1.2, 'bad', '你趁夜逃离了军营。');
    var army = L.soldier.army;
    L.soldier = null; L.job = '农';
    if (army === 'wei' && R() < 0.3 && L.married) {
      add(L, 1.4, 'bad', '按"士亡法"，逃兵的妻儿要没为官奴。你的家人被官府带走了。');
      liveKin(L, function (k) { return k.rel === 'spouse' || k.rel === 'child'; }).forEach(function (k) { k.apart = true; });
      L.married = false;
    }
    if (R() < 0.2) { add(L, 1.6, 'bad', '你被追兵抓了回去，挨了一顿军棍。'); L.soldier = { army: army, since: y }; L.body -= 8; }
  }
  function soldierYear(L, y) {
    var R = L.R, S = L.soldier;
    L.soldierYears++;
    var end = D.ARMY_END[S.army];
    if (S.army === 'yuanshu' && L.flags.sunjianOld && y >= 195) { S.army = 'wu'; L.flags.sunjianOld = false; add(L, 0.2, 'war', '孙策从袁术那里要回了父亲孙坚的旧部千余人，渡江东去。你也在其中。'); }
    else if (end && y >= end[0]) {
      var nx = end[1];
      if (nx === 'zone') nx = armyOf(ctrl(L.zone, y));
      if (!nx || nx === 'yellow') {
        L.soldier = null; L.job = '农';
        add(L, 0.3, 'war', S.army === 'yellow' ? '黄巾兵败如山倒。你扔掉头巾，逃回了乡里，从此再不敢提起这件事。' : '你所在的军队覆灭了。你侥幸活下来，回到了乡里。');
        return;
      }
      if (nx !== S.army) {
        var gname = { wei: S.army === 'wei' ? '晋' : '曹', shu: '蜀', wu: '吴', jin: '晋' }[nx] || fname(nx, y);
        add(L, 0.3, 'war', S.army === 'wei' && nx === 'jin' ? '魏帝禅位，你所在的魏军成了晋军。' : '你所在的军队覆灭，你被编入了' + gname + '军。');
        S.army = nx;
      }
    }
    var fought = false;
    (CAMP_BY_Y[y] || []).forEach(function (c) {
      if (!L.alive || c.a.indexOf(S.army) < 0) return;
      if (R() >= (c.p == null ? 0.5 : c.p)) return;
      fought = true;
      add(L, 1.5, 'war', c.t ? '你随军参加了' + c.n + '。' + c.t : '你随军参加了' + c.n + '。');
      L.rec.tags.push('war');
      if (R() < c.r * bodyMul(L)) { die(L, 'battle', 1.7, { n: c.n }); return; }
      var r = R();
      if (r < 0.12) { L.fame += 4; L.wealth += 5; add(L, 1.8, 'good', '你在' + c.n + '中斩获首级，得了赏赐。'); if (L.job === '军卒' && R() < 0.4) { L.job = '军吏'; add(L, 1.85, 'good', '你被提拔为什长，管着十个人。'); } }
      else if (r < 0.22) { L.body -= 15; L.injury = pick(R, ['左足', '右手', '左目']); add(L, 1.8, 'bad', '你在' + c.n + '中受了伤，' + { 左足: '左腿从此有些跛', 右手: '右手少了两根手指', 左目: '左眼瞎了' }[L.injury] + '。'); }
    });
    if (!L.alive) return;
    // 军中疾疫
    if (R() < 0.012 * bodyMul(L)) { die(L, 'plag', 2.5); return; }
    if (!fought && R() < 0.5) add(L, 2, 'life', pick(R, D.DAILY.soldier));
    // 退伍
    var hered = (S.army === 'wei' || S.army === 'wu' || S.army === 'jin') && L.cls === 'soldier';
    if (L.age >= 55 || (L.injury && R() < 0.3) || (!hered && R() < 0.06)) {
      L.soldier = null; L.job = '农';
      add(L, 3.2, 'good', L.age >= 55 ? '你老了，被准许离开军营，回家养老。' : '你被遣散回乡。');
    }
  }

  /* ---------- 人生阶段 ---------- */
  function daily(L, y) {
    var R = L.R, a = L.age, DD = D.DAILY, pool = [];
    LOCAL.forEach(function (x) { if (x[0] === L.zone && y >= x[1] && y <= x[2] && a >= 6) pool.push(x[3]); });
    if (L.eth && D.ETH[L.eth]) pool = pool.concat(a < 14 ? D.ETH[L.eth].child : D.ETH[L.eth].adult);
    else if (a < 3) return a === 0 ? null : pick(R, ['你学会了走路。', '你会叫"阿母"了。', '你断了奶，开始吃粟米粥。']);
    else if (a < 14) {
      pool = pool.concat(L.cls === 'gentry' ? DD.childGentry : L.cls === 'clerk' ? DD.childClerk.concat(DD.child) : L.cls === 'merchant' ? DD.childMerchant.concat(DD.child) : L.cls === 'artisan' ? DD.childArtisan.concat(DD.child) : L.cls === 'slave' ? DD.childSlave : DD.child);
      if (L.sex === 'F') pool = pool.concat(DD.childF);
    } else if (a >= 62) pool = pool.concat(DD.old);
    else if (L.soldier) pool = pool.concat(DD.soldier);
    else if (L.office) pool = pool.concat(DD.clerkJob);
    else if (L.cls === 'gentry') pool = pool.concat(DD.gentry);
    else if (L.cls === 'merchant') pool = pool.concat(DD.merchant);
    else if (L.cls === 'artisan') pool = pool.concat(DD.artisan);
    else if (L.cls === 'slave') pool = pool.concat(DD.slave);
    else if (L.cls === 'tuntian') pool = pool.concat(DD.tuntian, L.sex === 'F' ? DD.farmerF : DD.farmer);
    else pool = pool.concat(L.sex === 'F' ? DD.farmerF : DD.farmer);
    if (L.sex === 'F' && a >= 16 && L.married) {
      var kids = liveKin(L, function (k) { return k.rel === 'child'; });
      if (kids.length) pool.push('在' + L.county + '给第' + cnNum(kids.length) + '个孩子做了一双鞋。', '你背着最小的孩子下田干活。');
    }
    return pool.length ? pick(R, pool) : null;
  }
  var LOCAL = D.LOCAL;

  function doMarry(L, sp, y, s, prefix) {
    var k = newKin(L, 'spouse', sp.sex, y - sp.age, sp.name);
    L.spouseK = k; L.married = true; L.widowed = false;
    add(L, s, 'good', (prefix || '') + (L.sex === 'M' ? '你娶了' + sp.from + '的' + sp.name + '为妻。' : '你嫁给了' + sp.from + '的' + sp.name + '。'));
    L.standing += 4;
    L.rec.tags.push('marry');
    if (L.sex === 'F') { // 女子出嫁，娘家人不再同住
      liveKin(L, function (x) { return ['father', 'mother', 'sib', 'gp'].indexOf(x.rel) >= 0; }).forEach(function (x) { x.out = true; });
      L.wealth = clamp(L.wealth + (L.R() - 0.5) * 20, 3, 95);
    }
  }

  function lifeStage(L, y, dec) {
    var R = L.R, a = L.age, g = group(ctrl(L.zone, y));
    var registered = !L.eth && L.cls !== 'slave';
    // 读书
    if (a === 6 && (L.cls === 'gentry' || (L.cls === 'clerk' && R() < 0.7))) { L.schooling = true; add(L, 1, 'life', L.cls === 'gentry' ? '你开始跟着家中的塾师读《孝经》《论语》。' : '父亲开始教你认字。'); }
    if (dec.school) { L.schooling = true; add(L, 1, 'good', '你开始跟着乡里的老先生识字。'); }
    if (L.schooling && a < 18) { L.learn += 4 + R() * 5; if (L.cls === 'gentry') L.learn += 2; }
    else if (L.kin[0].lit && L.kin[0].alive && a >= 5 && a <= 12) L.learn += 1.2;
    if (L.schooling && a >= 15 && R() < 0.3) L.schooling = false;
    if (!L.literate && L.learn >= 30) { L.literate = true; add(L, 2.5, 'good', pick(R, ['你认得几百个字了，能读懂官府贴出的告示。', '你终于能读完一整卷书了。'])); }

    // 礼与税
    if (a === 7 && registered && y < 204) add(L, 0.5, 'note', '按汉制，你开始缴纳口钱，每年二十三钱。');
    if (a === 15) add(L, 0.5, 'note', registered && y < 204 && g === 'han' ? '你十五岁了，开始缴纳算赋，每年一百二十钱。' : '你十五岁了，在乡里人眼里，已经是大人了。');
    if (a === 20 && L.sex === 'M' && L.literate) {
      L.zi = pick(R, D.ZI_HEAD) + pick(R, D.MALE);
      add(L, 0.8, 'life', '你行了冠礼，取字' + L.zi + '。');
    }
    if (a === 56 && registered && y < 220) add(L, 0.5, 'note', '你五十六岁了，按例免除了算赋。');
    if (a === 70 && registered && y < 220) add(L, 2.4, 'good', '仲秋案比，县里授予你一根王杖，杖端刻着鸠鸟。持杖者"比于节"，见官可以不拜。');

    // 职业
    if (a === 14 && !L.job) L.job = L.eth ? (L.zone === 'jiao' || L.eth === 'shanyue' ? '山民' : '牧民') : D.CLASSES[L.cls].job;
    if (L.sex === 'M' && a === 16 && L.cls === 'soldier' && !L.soldier) {
      L.soldier = { army: armyOf(ctrl(L.zone, y)), since: y }; L.job = '军卒';
      add(L, 0.6, 'war', '你家是士家。你满了十六岁，按例入营当兵。');
    }
    career(L, y, dec);

    // 婚姻
    var unmarried = !L.married;
    if (dec.marry) doMarry(L, dec.marry, y, 1.5);
    else if (unmarried && !L.spouseK && !L.band) {
      if (L.sex === 'F') {
        var pf = { 13: 0.08, 14: 0.18, 15: 0.3, 16: 0.35, 17: 0.35 }[a] || 0;
        if (L.cls === 'slave' && a >= 15) pf = 0.15;
        if (R() < pf) doMarry(L, makeSpouse(L, y), y, 1.5, L.cls === 'slave' ? '主人把你配给了家中的一个奴仆。' : '父母做主，把你许配了人家。');
      } else if (a >= 16 && a <= 35 && !L.soldier && R() < (L.cls === 'gentry' ? 0.22 : L.cls === 'slave' ? 0.05 : 0.09)) {
        doMarry(L, makeSpouse(L, y), y, 1.5);
      }
    } else if (L.widowed && !L.married) {
      if (L.sex === 'F' && a < 40 && R() < (g === 'wei' && L.cls === 'soldier' ? 0.6 : 0.15)) {
        L.spouseK = null;
        doMarry(L, makeSpouse(L, y), y, 2.2, g === 'wei' && L.cls === 'soldier' ? '按士家的规矩，军士的寡妻要配嫁给其他士卒。' : '守寡一段时间后，你改嫁了。');
      } else if (L.sex === 'M' && a < 55 && R() < 0.2) { L.spouseK = null; doMarry(L, makeSpouse(L, y), y, 2.2, '你续娶了。'); }
    }

    // 生育
    var sp = L.spouseK;
    if (L.married && sp && sp.alive && !sp.apart) {
      var wifeAge = L.sex === 'F' ? a : y - sp.by;
      var away = (L.sex === 'F' && sp.soldier) || (L.sex === 'M' && L.soldier);
      var kidsN = L.kin.filter(function (k) { return k.rel === 'child'; }).length;
      var pb = wifeAge >= 15 && wifeAge <= 44 && kidsN < 10 ? (away ? 0.12 : 0.3) * (wifeAge > 38 ? 0.5 : 1) : 0;
      if (L.rec.tags.indexOf('hard') >= 0) pb *= 0.6;
      if (R() < pb) birth(L, y);
      if (!L.alive) return;
    }
    // 子女婚嫁、孙辈
    liveKin(L, function (k) { return k.rel === 'child'; }).forEach(function (k) {
      var ka = y - k.by;
      if (k.sex === 'F' && !k.out && ka >= 14 && R() < 0.3) { k.out = true; add(L, 2.8, 'fam', '女儿' + k.name + '出嫁了。'); }
      if (k.sex === 'M' && !k.wed && ka >= 17 && R() < 0.25) { k.wed = true; add(L, 2.8, 'fam', '儿子' + k.name + '娶了妻。'); }
      if ((k.wed || k.out) && ka >= 17 && ka <= 45 && R() < 0.12) {
        L.grandkids++;
        add(L, 3.2, 'good', (k.sex === 'M' ? '你有了' + (L.grandkids === 1 ? '第一个' : '') + '孙' : '女儿' + k.name + '生了孩子，你有了外孙') + (R() < 0.5 ? '子' : '女') + '。');
        L.rec.tags.push('kid');
      }
    });

    // 孤儿
    var f = L.kin[0], m = L.kin[1];
    if (a < 12 && !f.alive && !m.alive && !L.flags.orphan) {
      L.flags.orphan = true;
      var older = liveKin(L, function (k) { return k.rel === 'sib' && y - k.by >= 16; });
      if (older.length) add(L, 3, 'fam', '父母都不在了，' + kinLabel(L, older[0]) + '撑起了这个家。');
      else {
        var r = R();
        if (r < 0.6) { add(L, 3, 'fam', '父母都不在了。叔父收养了你。'); L.wealth -= 5; }
        else if (r < 0.85 && L.cls !== 'gentry') { L.cls = 'slave'; L.wealth = 2; L.job = '奴婢'; L.standing = 5; add(L, 3, 'bad', '父母都不在了。你被一户豪强收作了奴婢，换了一口饭吃。'); }
        else { L.wealth = 0; L.body -= 8; add(L, 3, 'bad', '父母都不在了。你成了流落街头的孤儿，靠乞讨活了下来。'); }
      }
    }

    // 征兵
    if (L.sex === 'M' && a >= 16 && a <= 50 && !L.soldier && !L.band && L.cls !== 'slave' && L.cls !== 'gentry' && !L.office) {
      var rate = conscriptRate(L.zone, y) + L.yConscript;
      if (L.eth === 'cong' || L.eth === 'wuhuan' || L.eth === 'qiang' || L.eth === 'xiongnu') rate *= 1.5;
      if (R() < rate) enlist(L, y, 1.2, false);
    }

    // 随机际遇
    personal(L, y);
    if (!L.alive) return;
    // 家境滑落
    if (L.cls === 'peasant' && L.wealth < 5 && L.land > 0 && R() < 0.3) {
      L.cls = 'tenant'; L.land = 0; L.standing -= 5;
      add(L, 3.3, 'bad', '你家欠了豪强的债，只好把田地抵给他，从此做了佃客。');
    }
    if (L.cls === 'slave' && a >= 15 && R() < 0.012) {
      L.cls = 'tenant'; L.standing += 10;
      add(L, 3, 'good', y >= 220 && g === 'wei' ? '朝廷下诏放免了一批官私奴婢，你成了良人。' : '主人放免了你，你成了良人。');
    }
  }

  function career(L, y, dec) {
    var R = L.R, a = L.age, fk = ctrl(L.zone, y);
    if (dec.clerk) { L.office = '书佐'; L.job = '书佐'; L.officeMax = '县书佐'; L.fame += 3; add(L, 1.4, 'good', '你到县廷当了书佐，每天抄写文书。'); }
    if (a < 16 || L.soldier || L.band || L.sex === 'F') return;
    if (L.office === '书佐' && L.learn >= 50 && R() < 0.06) {
      L.office = '计吏'; L.job = '计吏'; L.officeMax = '郡上计吏'; L.fame += 4;
      add(L, 2, 'good', '你被郡里选为上计吏，年底要带着全郡的户口簿书进京上计。');
    } else if ((L.office === '计吏' || L.office === '书佐') && L.fame >= 15 && L.standing >= 45 && R() < 0.02) {
      L.office = '县长'; L.job = '县长'; L.officeMax = '县长'; L.fame += 8; L.wealth += 10;
      add(L, 2, 'good', '你被任命为一个小县的县长。从小吏做到长吏，在你的出身里是极少见的。');
    }
    if (L.cls === 'gentry' && !L.office && a >= 18) {
      var p = 0;
      if (y < 220 && L.fame >= 5) p = 0.04; // 举孝廉
      if (y >= 220) p = L.gate >= 3 ? 0.12 : 0.05; // 九品中正
      if (y >= 190 && y < 230 && L.learn >= 55) p += 0.03; // 征辟
      if (R() < p) {
        var t;
        if (y < 220 && R() < 0.6) { L.office = '郎官'; L.officeMax = '郎中'; t = '郡里举你为孝廉，你入京做了郎官。'; }
        else if (y >= 220 && R() < 0.6) { L.office = '县令'; L.officeMax = '县令'; t = '郡中正评你为' + (L.gate >= 3 ? '上' : '中') + '品，你被任为县令。'; }
        else { L.office = '幕僚'; L.officeMax = fname(fk, y) + '的幕僚'; t = fname(fk, y) + '征辟你为掾属，你做了幕府的幕僚。'; }
        L.job = L.office; L.fame += 10; L.wealth += 8;
        add(L, 2, 'good', t);
      }
    } else if (L.office === '郎官' && R() < 0.15) {
      L.office = '县令'; L.officeMax = '县令'; L.job = '县令'; L.fame += 6;
      add(L, 2, 'good', '你外放为县令。');
    } else if (L.office === '县令' && L.fame >= 30 && R() < 0.03) {
      L.office = '郡守'; L.officeMax = '郡太守'; L.job = '太守'; L.fame += 12;
      add(L, 2, 'good', '你升任太守，治理一郡。');
    }
    if (!L.office && L.cls !== 'gentry' && a >= 18 && a <= 50) {
      var r = R();
      if (r < 0.006 && L.learn >= 25) { L.job = '医者'; add(L, 2.2, 'life', '你跟着一位老医者学会了针灸和几张药方，开始给乡人看病。'); L.standing += 6; }
      else if (r < 0.009) { L.job = '巫祝'; add(L, 2.2, 'life', '乡里的巫祝老了，你接替他主持祭祀、驱鬼治病。'); L.standing += 4; }
      else if (r < 0.014 && L.learn >= 30 && L.standing >= 30) { L.job = '门客'; add(L, 2.2, 'life', '你投到一户豪强门下做了门客。'); L.wealth += 6; }
      else if (r < 0.02 && L.cls === 'peasant' && y >= 189 && y <= 220) { L.cls = 'tenant'; L.job = '部曲'; add(L, 2.2, 'life', '乱世里，你家投靠了当地的豪强，你成了他坞壁里的部曲。'); }
    }
  }

  function birth(L, y) {
    var R = L.R, sx = R() < 0.51 ? 'M' : 'F';
    var k = newKin(L, 'child', sx, y, sx === 'M' ? xiaoName(R) : '阿' + givenName(R, 'F'));
    L.kidsBorn++;
    L.rec.tags.push('kid');
    var nth = L.kidsBorn;
    if (L.sex === 'F') add(L, 2, 'good', '你生下了' + (nth === 1 ? '第一个孩子，' : '') + '一个' + (sx === 'M' ? '儿子' : '女儿') + '，取小名' + k.name + '。');
    else add(L, 2, 'good', '妻子' + L.spouseK.name + '生下了一个' + (sx === 'M' ? '儿子' : '女儿') + '，取小名' + k.name + '。' + (nth === 1 ? '你第一次成为了父亲。' : ''));
    var mother = L.sex === 'F' ? null : L.spouseK;
    var pm = 0.012 * (L.rec.tags.indexOf('hard') >= 0 ? 2 : 1);
    if (L.sex === 'F') { if (R() < pm * bodyMul(L)) die(L, 'childbirth', 2.05); }
    else if (R() < pm) kinDie(L, mother, 'childbirth', 2.05, y);
    if (R() < 0.08) { k.alive = false; k.dy = y; add(L, 2.1, 'fam', '孩子生下来没几天就夭折了。'); L.rec.tags.push('loss'); }
  }

  function personal(L, y) {
    var R = L.R, a = L.age;
    if (a < 6) return;
    var farm = ['peasant', 'tenant', 'tuntian', 'soldier', 'clerk'].indexOf(L.cls) >= 0 && !L.soldier;
    var r = R();
    if (r < 0.05) { L.body -= 6; add(L, 2.2, 'bad', pick(R, ['你大病一场，在床上躺了一个多月。', '你染上了疟疾，熬了一个夏天才好。'])); }
    else if (r < 0.13 && farm && a >= 12) { L.wealth += 5; add(L, 3, 'good', '这一年风调雨顺，收成不错。'); }
    else if (r < 0.19 && farm && a >= 12) { L.wealth -= 6; add(L, 3, 'bad', pick(R, ['今年先旱后涝，收成只有往年的一半。', '一场冰雹打烂了快要成熟的麦子。'])); }
    else if (r < 0.2) { L.wealth -= 15; add(L, 1.8, 'bad', '家里失了火，烧掉了半间屋子和存粮。'); }
    else if (r < 0.2 + 0.015 * chaos(y)) { L.wealth -= 10; add(L, 2.4, 'bad', '你在路上遇到盗贼，被抢走了财物。'); }
    else if (r < 0.24 && farm && L.wealth > 10) { L.wealth -= 8; add(L, 1.2, 'bad', '家里的耕牛病死了。'); }
    else if (r < 0.25) { L.wealth += 12; add(L, 2, 'good', pick(R, ['你在田里挖出了一小罐前人埋下的五铢钱。', '远房的亲戚过世，留给你家一些钱财。'])); }
    else if (r < 0.27 && L.cls === 'merchant') { var w = R() < 0.55 ? 10 : -12; L.wealth += w; add(L, 2, w > 0 ? 'good' : 'bad', w > 0 ? '你倒卖了一批布帛，赚了不少。' : '一船货在江上翻了，血本无归。'); }
    else if (r < 0.29 && a >= 15) { L.standing += 4; add(L, 2.5, 'good', pick(R, ['你帮乡里调解了一场田界纠纷，大家都说你公道。', '邻家断了粮，你分了他们两斗米。'])); }
  }

  function conscriptRate(z, y) {
    var g = group(ctrl(z, y));
    if (y < 184) return 0.004;
    if (y < 190) return 0.02;
    if (g === 'shu') return 0.04;
    if (g === 'wu') return 0.03;
    if (g === 'wei') return y < 220 ? 0.03 : 0.018;
    if (g === 'jin') return y < 280 ? 0.012 : y < 291 ? 0.004 : 0.02;
    return 0.035;
  }

  function kinYear(L, y) {
    var R = L.R;
    L.kin.forEach(function (k) {
      if (!k.alive) return;
      var ka = y - k.by;
      if (ka <= 0) return;
      // 征兵
      if (!k.apart && k.sex === 'M' && ka >= 16 && ka <= 50 && !k.soldier && ['father', 'sib', 'spouse', 'child'].indexOf(k.rel) >= 0 && L.cls !== 'gentry' && L.cls !== 'slave') {
        if (R() < (conscriptRate(L.zone, y) + L.yConscript) * 0.8) {
          var fk = ctrl(L.zone, y);
          k.soldier = armyOf(fk);
          add(L, 1.25, 'fam', '官府征兵，' + kinLabel(L, k) + '被征入' + fname(fk, y) + '军中。');
          if (k.rel === 'child') L.rec.tags.push('war');
        }
      }
      if (k.soldier) {
        (CAMP_BY_Y[y] || []).forEach(function (c) {
          if (!k.alive || c.a.indexOf(k.soldier) < 0 || R() >= (c.p == null ? 0.5 : c.p)) return;
          if (R() < c.r) kinDie(L, k, 'battle', 1.9, y, c.n);
          else if (!k.apart && R() < 0.25) add(L, 3.1, 'fam', kinLabel(L, k) + '从' + c.n + '的战场上活着回来了。');
        });
        if (k.alive && R() < 0.1) { k.soldier = null; if (!k.apart) add(L, 3.4, 'fam', kinLabel(L, k) + '退伍回家了。'); }
      }
      if (!k.alive) return;
      var q = (ka === 1 ? baseQ(0) : baseQ(ka)) * (CLS_Q[L.cls] || 1) * chaos(y) * (k.soldier ? 1.5 : 1);
      if (R() < q) kinDie(L, k, 'base', 1 + Math.floor(R() * 3) + 0.5, y);
    });
    // 弟妹出生
    var f = L.kin[0], m = L.kin[1];
    if (L.age < 20 && f.alive && m.alive && !m.apart && !m.out && y - m.by <= 42 && y - m.by >= 16) {
      var nb = L.kin.filter(function (k) { return k.rel === 'sib' && k.by > L.by; }).length;
      if (nb < 6 && R() < 0.27) {
        var sx = R() < 0.51 ? 'M' : 'F';
        var k = newKin(L, 'sib', sx, y, sx === 'M' ? xiaoName(R) : '阿' + givenName(R, 'F'));
        add(L, 0.9, 'fam', '母亲生下了一个' + (sx === 'M' ? '弟弟' : '妹妹') + '，小名' + k.name + '。');
      }
    }
  }

  /* ================= 查询 ================= */
  function household(L, y) {
    // 户籍简：返回当前同户之人，第一位为户人（户主）
    var meA = y - L.by;
    var me = { me: true, sex: L.sex, age: meA, name: L.eth ? L.name : L.sur + L.given, injury: L.injury, soldier: !!L.soldier };
    var others = L.kin.filter(function (k) { return k.alive && !k.apart && !k.out && k.by <= y; });
    var f = L.kin[0], m = L.kin[1], sp = L.spouseK, head = null;
    if (L.sex === 'F' && L.married && sp && sp.alive && !sp.apart) head = sp;
    else if (meA < 30 && f.alive && !f.apart && !f.out) head = f;
    else if (meA < 15 && m.alive && !m.apart && !m.out && L.kin.indexOf(m) >= 0) head = m;
    var list = [];
    if (head) list.push({ head: true, sex: head.sex, age: y - head.by, name: head.name, soldier: !!head.soldier, kid: head.id });
    else me.head = true;
    list.push(me);
    others.forEach(function (k) {
      if (head && k === head) return;
      var r = relName(L, k);
      if (head && head.rel === 'father' && k.rel === 'mother') r = '妻子';
      if (head && (head.rel === 'father' || head.rel === 'mother') && k.rel === 'sib') r = k.sex === 'M' ? '儿子' : '女儿';
      if (head && head.rel === 'father' && k.rel === 'gp') r = k.sex === 'M' ? '父亲' : '母亲';
      if (head && head.rel === 'spouse' && k.rel === 'child') r = k.sex === 'M' ? '儿子' : '女儿';
      list.push({ sex: k.sex, age: y - k.by, name: k.name, rel: r, soldier: !!k.soldier });
    });
    return list;
  }
  function slipText(L, p, headName) {
    var a = p.age + 1; // 虚岁
    var big = a >= 15, t;
    var REL = { 妻子: '妻', 丈夫: '夫', 父亲: '父', 母亲: '母', 祖父: '祖父', 祖母: '祖母', 儿子: '子男', 女儿: '子女', 哥哥: '兄', 弟弟: '弟', 姐姐: '姊', 妹妹: '妹' };
    if (L.cls === 'slave' && p.me) t = '户下' + (p.sex === 'M' ? '奴' : '婢') + p.name + '年' + slipNum(a);
    else if (p.head) t = L.village + '户人' + (p.sex === 'M' ? '公乘' : '大女') + p.name + '年' + slipNum(a) + (big && a <= 56 ? '　算一' : '');
    else {
      var r = p.rel ? REL[p.rel] || '' : (L.sex === 'F' && L.married ? '妻' : p.sex === 'M' ? '子男' : '子女');
      t = headName + r + (p.sex === 'F' && big && r.indexOf('子') < 0 ? '大女' : '') + p.name + '年' + slipNum(a);
    }
    if (p.soldier) t += '　从军';
    if (p.injury) t += '　伤' + p.injury;
    return t;
  }

  function stats(Ls) {
    var ages = Ls.map(function (L) { return L.years.length - 1; });
    return ages;
  }

  return {
    rng: rng, create: create, step: step, answer: answer, runToEnd: runToEnd,
    era: era, ganzhi: ganzhi, reignText: reignText, ctrl: ctrl, group: group, fname: fname, zonePop: zonePop, totalPop: totalPop,
    cnNum: cnNum, slipNum: slipNum, zname: zname, household: household, slipText: slipText, kinLabel: kinLabel, relName: relName,
    placeText: placeText, CAUSE_SHORT: CAUSE_SHORT, CAUSE_STAT: CAUSE_STAT, POP_SCALE: POP_SCALE, stats: stats
  };
})(SGD);
if (typeof module !== 'undefined') module.exports = SGE;
