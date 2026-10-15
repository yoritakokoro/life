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
    var HR = opts.heir;
    if (HR) { opts.year = HR.year; opts.jun = HR.jun; opts.sex = HR.sex; opts.han = !HR.eth; opts.surviveUntil = HR.dy; }
    L.by = opts.year != null ? opts.year : pickYear(R, L.mode);
    var ji = opts.jun != null ? opts.jun : pickJun(R, L.by, opts);
    setPlace(L, ji);
    L.birthJun = ji; L.birthZone = L.zone; L.birthCounty = L.county;

    // 族群
    L.eth = null;
    if (!opts.han) (D.ETHNIC[L.zone] || []).forEach(function (e) { if (!L.eth && R() < e[1]) L.eth = e[0]; });
    L.sex = opts.sex || (R() < 0.51 ? 'M' : 'F');
    if (HR) L.eth = HR.eth || null;
    L.cls = HR ? HR.cls : L.eth ? 'tribal' : pickClass(R, L.zone, L.by, opts);
    var C = D.CLASSES[L.cls];

    // 姓名
    if (L.eth) { var en = ethName(R, L.eth); L.sur = en.sur; L.given = en.given; }
    else { L.sur = surname(R, L.cls); L.given = givenName(R, L.sex); }
    L.xiao = L.sex === 'F' ? '阿' + L.given.slice(-1) : xiaoName(R);
    if (HR) { L.sur = HR.sur; L.xiao = HR.xiao; if (L.sex === 'F') L.given = HR.xiao.slice(-1); }
    L.name = L.sur + L.given;

    // 属性
    L.body = Math.round(clamp(30 + R() * 45 + (L.cls === 'gentry' ? 6 : 0) + (L.cls === 'slave' ? -6 : 0), 15, 90));
    L.wealth = Math.round(C.wealth[0] + R() * (C.wealth[1] - C.wealth[0]));
    L.land = Math.round(C.land[0] + R() * (C.land[1] - C.land[0]));
    if (L.cls === 'gentry') L.land = Math.round(L.land / 50) * 50;
    if (L.land < 5) L.land = 0;
    L.learn = 0; L.fame = 0; L.craft = 0;
    L.tr = {}; ['cur', 'cau', 'act', 'per', 'soc', 'ind'].forEach(function (k) { L.tr[k] = Math.round(clamp(50 + (R() + R() + R() - 1.5) * 24, 15, 85)); });
    L.tal = { craft: R() * 0.3, memory: R() * 0.3, strength: R() * 0.3, charm: R() * 0.3 };
    L.found = {}; L.focusManual = null; L.lastFocus = null; L.focusYears = 0; L.spendLog = []; L.crisis = false;
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
    if (HR) {
      var me = HR.parentSex === 'M' ? father : mother, other = HR.parentSex === 'M' ? mother : father;
      me.name = HR.parentName; me.by = HR.parentBy; me.fixDy = HR.dy; me.fixCause = HR.cause; me.lit = !!HR.lit;
      if (HR.otherName) { other.name = HR.otherName; other.by = HR.otherBy; }
      if (HR.otherDy != null) { other.fixDy = HR.otherDy; other.fixCause = HR.otherCause || 'base'; } else other.guard = HR.dy;
      if (HR.parentSex === 'F') father.lit = !!HR.otherLit;
    } else {
      if (R() < (war ? 0.04 : 0.015)) { father.alive = false; father.dy = L.by; father.cause = 'war'; L.flags.posthumous = true; }
      if (R() < 0.015) { mother.alive = false; mother.dy = L.by; mother.cause = 'childbirth'; L.flags.motherDied = true; }
    }

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
    if (HR && HR.land != null) L.land = HR.land;
    L.eco = initEco(L);
    L.lineage = HR ? HR.lineage : [];
    L.wealth = wealthScore(L);
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
    if (L.opts.surviveUntil && L.rec.y <= L.opts.surviveUntil) {
      if (!L.rec.spared) { L.rec.spared = true; L.body = clamp(L.body - 6, 5, 100); add(L, s, 'bad', '你大病一场，险些丧命，终究挺了过来。'); }
      return;
    }
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
    if (m.lit && !L.literate) return false;
    if (m.elite && !(L.cls === 'gentry' || L.office || L.cls === 'clerk' || L.learn >= 45 || L.fame >= 20)) return false;
    if (m.follow && (L.soldier || L.band)) return false;
    return true;
  }

  // 地位越高，越可能见到名人
  function statusMul(L) {
    var m = { gentry: 5, clerk: 3, merchant: 1.8, slave: 0.4, tenant: 0.8, tribal: 0.7 }[L.cls] || 1;
    if (L.office) m *= 2;
    if (L.literate) m *= 1.3;
    return m * (1 + L.fame / 50);
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
    });
    // 历史人物
    D.MEETS.forEach(function (m, i) {
      if (L.meetDone[i] || !meetOK(L, m, y)) return;
      if (R() >= Math.min(0.6, m.p * statusMul(L))) return;
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
    // 性情的种子
    if (a === 3 || a === 5) {
      var sd = SEEDS[a === 3 ? 'seed1' : 'seed2'], tw = sd.w(L.tr);
      P.queue.unshift({ key: a === 3 ? 'seed1' : 'seed2', q: sd.q, o: sd.o, w: tw.map(function (x) { return x * x; }), hint: '这是你小时候的样子，没有对错。', narr: true });
    }
    // 家计危机
    if (L.crisis && free && L.cls !== 'slave') {
      L.crisis = false;
      var E = L.eco, opts = [], keys = [], w = [];
      var n = Math.min(L.land, Math.ceil(E.debt / (LANDP * 0.7)) + 1);
      if (L.land >= 3) { opts.push('卖掉' + cnNum(n) + '亩田'); keys.push('sell'); w.push(1 + (L.tr.cau - 50) / 30); }
      opts.push('再借些钱，撑过今年'); keys.push('borrow'); w.push(1 + (L.tr.ind - 50) / 40);
      var lab = laborCandidate(L, y);
      if (lab) { opts.push(lab === 'self' ? '自己外出佣作' : '让' + kinLabel(L, lab) + '外出佣作'); keys.push('labor'); w.push(1.2); }
      if (['peasant', 'clerk', 'soldier', 'artisan', 'tuntian'].indexOf(L.cls) >= 0) { opts.push('投靠豪强，做他的佃客'); keys.push('kin'); w.push(0.8 + (L.tr.soc - 50) / 40); }
      var fd = pick(R, ['jingbei', 'jingnan', 'jiangdong', 'shu', 'jiao', 'liaodong'].filter(function (q) { return q !== z; }));
      opts.push('举家逃往' + zname(fd) + '，躲开债主'); keys.push('flee'); w.push(0.2 + (L.tr.ind - 50) / 60);
      var dec2 = a >= 16;
      var who = dec2 ? null : (L.kin[0].alive && !L.kin[0].apart ? '父亲' : '母亲');
      P.queue.push({ key: 'crisis', q: '家中入不敷出，如今欠债' + fmt(E.debt) + '钱值，' + (E.cash < 300 ? '粮储也快见底了。' : '债主已经上门催了几回。') + (dec2 ? '' : who + '愁得整夜睡不着。'),
        o: opts, keys: keys, w: w.map(function (x) { return Math.max(0.1, x); }), n: n, lab: lab, dest: fd, who: who, forced: !dec2 });
    }
    // 人生抉择：身份越高，越常遇到需要拿主意的事
    var lc = lifeChoice(L, y, free);
    if (lc) P.queue.push(lc);
    // 儿子要钱
    if (gap && free && isHead(L) && a >= 40) {
      var son = liveKin(L, function (k) { return k.rel === 'child' && k.sex === 'M' && !k.out && !k.soldier && y - k.by >= 18; })[0];
      if (son && L.eco.cash - reserve(L) >= 3500 && R() < 0.1) {
        P.queue.push({ key: 'sonAsk', son: son, q: '儿子' + son.name + '说想去县里做点买卖，向你要三千钱。', o: ['给他', '不给'], auto: L.tr.soc > L.tr.cau ? 0.6 : 0.35 });
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

  function autoPick(L, c) {
    if (c.w) { var idx = c.o.map(function (x, i) { return i; }); return wpick(L.R, idx, function (i) { return c.w[i]; }); }
    return L.R() < c.auto ? 0 : 1;
  }
  function autoAnswer(L) { if (L.pending) L.pending.answer = autoPick(L, L.pending); return L.pending ? L.pending.answer : null; }

  function applyChoice(L, c, P) {
    var i = c.answer, d = P.dec;
    L.lastChoice = L.age;
    var lbl = c.o[i];
    if (!L.auto && !c.forced) (L.choiceLog = L.choiceLog || []).push({ y: L.by + L.age, q: c.q, a: lbl, narr: !!c.narr });
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
      case 'seed1': case 'seed2': applySeed(L, c.key, i); d.seedText = SEEDS[c.key].t[i]; break;
      case 'crisis': d.crisis = { c: c, k: c.keys[i] }; break;
      case 'sonAsk': d.sonAsk = { give: i === 0, son: c.son }; break;
      case 'life': d.life = { c: c, i: i }; break;
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
        if (L.auto || c.forced) c.answer = autoPick(L, c);
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
    rec.focus = resolveFocus(L, y);
    if (dec.seedText) add(L, 1.0, 'life', dec.seedText);
    if (dec.crisis) crisisAct(L, y, dec.crisis.c, dec.crisis.k);
    if (dec.sonAsk) sonOutcome(L, y, dec.sonAsk);
    if (dec.life) lifeOutcome(L, y, dec.life.c, dec.life.i);
    if (!L.alive) return finishYear(L, rec);
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
    economyYear(L, y);
    if (!L.alive) return finishYear(L, rec);

    // 本人基础死亡率
    var q = baseQ(a) * (CLS_Q[L.cls] || 1) * chaos(y) * bodyMul(L) * (L.injury ? 1.15 : 1) * (L.wealth < 10 ? 1.15 : 1) * (rec.focus.eff === 'health' ? 0.9 : 1);
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
      var slow = rec.focus && rec.focus.eff === 'health' ? 0.5 : 1;
      if (L.age > 40) L.body -= 0.6 * slow;
      if (L.age > 60) L.body -= 1 * slow;
      if (L.wealth > 55 && L.age < 40) L.body += 0.4;
      L.wealth = wealthScore(L);
      L.body = clamp(L.body, 3, 100);
      L.wealth = clamp(L.wealth, 0, 100);
      L.standing = clamp(L.standing, 0, 100);
      L.learn = clamp(L.learn, 0, 100);
      L.fame = clamp(L.fame, 0, 100);
    }
    rec.entries.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    if (L.eco) L.wealth = wealthScore(L);
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
    var hm = (fled ? 0.35 : 1) * (L.flags.wubi ? 0.5 : 1);
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
    if (fx.loss) {
      var fr = Math.min(0.9, fx.loss / 100 * (0.6 + R() * 0.8) * (L.cls === 'gentry' ? 0.6 : 1));
      L.eco.cash = Math.round(L.eco.cash * (1 - fr));
      if (fx.loss >= 20 && L.eco.ox > 0 && R() < 0.3) { L.eco.ox--; add(L, s + 0.03, 'bad', '家里的耕牛被乱兵牵走了。'); }
    }
    if (fx.gain) L.eco.cash += fx.gain * 150;
    if (fx.fame) L.fame += fx.fame;
    if (fx.conscript) L.yConscript += fx.conscript;
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
    L.eco.cash = Math.round(L.eco.cash * 0.5); L.eco.ox = 0; L.eco.house = Math.min(L.eco.house, L.cls === 'gentry' ? 20000 : 1500);
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
      if (R() < c.r * bodyMul(L) * (L.flags.armor ? 0.8 : 1) * (L.found.strength ? 0.85 : 1) * (L.lastFocus === 'army' ? 0.9 : 1)) { die(L, 'battle', 1.7, { n: c.n }); return; }
      var r = R();
      if (r < 0.12) { L.fame += 4; L.eco.priv += 1000; add(L, 1.8, 'good', '你在' + c.n + '中斩获首级，得了一千钱的赏赐。'); if (L.job === '军卒' && R() < 0.4) { L.job = '军吏'; add(L, 1.85, 'good', '你被提拔为什长，管着十个人。'); } }
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
      var dowry = Math.round(clamp(L.eco.cash * 0.15, 200, 30000) / 10) * 10, priv = L.eco.priv + dowry;
      var C = D.CLASSES[L.cls];
      L.land = Math.round(C.land[0] + L.R() * (C.land[1] - C.land[0])); if (L.land < 5) L.land = 0;
      L.eco = initEco(L); L.eco.priv = priv;
      add(L, s + 0.05, 'life', '娘家给了你' + fmt(dowry) + '钱值的嫁妆。这是你自己的私产。');
    } else {
      var bp = Math.round(({ gentry: 20000, clerk: 5000, merchant: 5000 }[L.cls] || 1500) * (0.7 + L.R() * 0.6) / 100) * 100;
      payFrom(L, bp);
      add(L, s + 0.05, 'life', '聘礼花去了' + fmt(bp) + '钱值。');
    }
  }

  function lifeStage(L, y, dec) {
    var R = L.R, a = L.age, g = group(ctrl(L.zone, y));
    var registered = !L.eth && L.cls !== 'slave';
    // 读书
    if (a === 6 && (L.cls === 'gentry' || (L.cls === 'clerk' && R() < 0.7))) { L.schooling = true; add(L, 1, 'life', L.cls === 'gentry' ? '你开始跟着家中的塾师读《孝经》《论语》。' : '父亲开始教你认字。'); }
    if (dec.school) { L.schooling = true; add(L, 1, 'good', '你开始跟着乡里的老先生识字。'); }
    applyFocus(L, y, L.rec.focus);
    if (L.rec.focus.eff !== 'study') {
      if (L.schooling && a < 18) L.learn += 2 + R() * 2;
      else if (L.kin[0].lit && L.kin[0].alive && a >= 5 && a <= 12) L.learn += 0.8;
    }
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
        if (r < 0.6) { add(L, 3, 'fam', '父母都不在了。叔父收养了你。'); L.eco.cash = Math.round(L.eco.cash * 0.5); }
        else if (r < 0.85 && L.cls !== 'gentry') { L.cls = 'slave'; L.eco = initEco(L); L.land = 0; L.job = '奴婢'; L.standing = 5; add(L, 3, 'bad', '父母都不在了。你被一户豪强收作了奴婢，换了一口饭吃。'); }
        else { L.eco.cash = 0; L.land = 0; L.body -= 8; add(L, 3, 'bad', '父母都不在了。你成了流落街头的孤儿，靠乞讨活了下来。'); }
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
    splitHousehold(L, y);
    if (L.cls === 'slave' && a >= 15 && R() < 0.012) {
      L.cls = 'tenant'; L.standing += 10;
      add(L, 3, 'good', y >= 220 && g === 'wei' ? '朝廷下诏放免了一批官私奴婢，你成了良人。' : '主人放免了你，你成了良人。');
    }
  }

  function career(L, y, dec) {
    var R = L.R, a = L.age, fk = ctrl(L.zone, y);
    if (L.flags.corrupt && L.office && R() < 0.06) {
      L.office = null; L.job = '农'; L.fame -= 6; L.flags.corrupt = false;
      add(L, 2.6, 'bad', '你从前受贿的事被人告发，丢了官，家产也被罚没了大半。');
      L.eco.cash = Math.round(L.eco.cash * 0.4);
    }
    if (L.flags.outlaw && R() < 0.12) {
      L.flags.outlaw = false; L.job = '农'; L.standing += 4;
      add(L, 2.6, 'life', '官府招抚山中的人，许他们下山归田。你回到了平地，重新编入户籍。');
    }
    if (dec.clerk) { L.office = '书佐'; L.job = '书佐'; L.officeMax = '县书佐'; L.fame += 3; add(L, 1.4, 'good', '你到县廷当了书佐，每天抄写文书。'); }
    if (a < 16 || L.soldier || L.band || L.sex === 'F') return;
    if (L.office === '书佐' && L.learn >= 50 && R() < 0.06) {
      L.office = '计吏'; L.job = '计吏'; L.officeMax = '郡上计吏'; L.fame += 4;
      add(L, 2, 'good', '你被郡里选为上计吏，年底要带着全郡的户口簿书进京上计。');
    } else if ((L.office === '计吏' || L.office === '书佐') && L.fame >= 15 && L.standing >= 45 && R() < 0.02) {
      L.office = '县长'; L.job = '县长'; L.officeMax = '县长'; L.fame += 8;
      add(L, 2, 'good', '你被任命为一个小县的县长。从小吏做到长吏，在你的出身里是极少见的。');
    }
    if (L.cls === 'gentry' && !L.office && a >= 18) {
      var p = 0;
      if (y < 220 && L.fame >= 5) p = 0.04; // 举孝廉
      var cm = (L.lastFocus === 'career' ? 2 : 1) * (L.flags.robe ? 1.3 : 1) * (L.flags.connected ? 1.3 : 1) * (L.flags.zz ? 2 : 1) * (L.flags.zzno ? 0.6 : 1) * (L.flags.disciple ? 1.4 : 1);
      if (y >= 220) p = L.gate >= 3 ? 0.12 : 0.05; // 九品中正
      if (y >= 190 && y < 230 && L.learn >= 55) p += 0.03; // 征辟
      if (R() < p * cm) {
        var t;
        if (y < 220 && R() < 0.6) { L.office = '郎官'; L.officeMax = '郎中'; t = '郡里举你为孝廉，你入京做了郎官。'; }
        else if (y >= 220 && R() < 0.6) { L.office = '县令'; L.officeMax = '县令'; t = '郡中正评你为' + (L.gate >= 3 ? '上' : '中') + '品，你被任为县令。'; }
        else { L.office = '幕僚'; L.officeMax = fname(fk, y) + '的幕僚'; t = fname(fk, y) + '征辟你为掾属，你做了幕府的幕僚。'; }
        L.job = L.office; L.fame += 10;
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
      else if (r < 0.014 && L.learn >= 30 && L.standing >= 30) { L.job = '门客'; add(L, 2.2, 'life', '你投到一户豪强门下做了门客。'); }
      else if (r < 0.02 && L.cls === 'peasant' && y >= 189 && y <= 220) { L.cls = 'tenant'; L.job = '部曲'; add(L, 2.2, 'life', '乱世里，你家投靠了当地的豪强，你成了他坞壁里的部曲。'); }
    }
  }

  function birth(L, y) {
    var R = L.R, sx = R() < 0.51 ? 'M' : 'F';
    var k = newKin(L, 'child', sx, y, sx === 'M' ? xiaoName(R) : '阿' + givenName(R, 'F'));
    k.lav = R();
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
    else if (r < 0.13 && farm && a >= 12) { L.yHarvest = 1.2; add(L, 3, 'good', '这一年风调雨顺，收成不错。'); }
    else if (r < 0.19 && farm && a >= 12) { L.yHarvest = 0.6; add(L, 3, 'bad', pick(R, ['今年先旱后涝，收成只有往年的一半。', '一场冰雹打烂了快要成熟的麦子。'])); }
    else if (r < 0.2 && L.cls !== 'slave') { L.eco.cash = Math.round(L.eco.cash * 0.6); L.eco.house = Math.max(500, L.eco.house - 1000); add(L, 1.8, 'bad', '家里失了火，烧掉了半间屋子和存粮。'); }
    else if (r < 0.2 + 0.015 * chaos(y)) { var lost = Math.round(Math.min(L.eco.priv + L.eco.cash, 300 + R() * 2500)); payFrom(L, lost); add(L, 2.4, 'bad', '你在路上遇到盗贼，被抢走了' + fmt(lost) + '钱值的财物。'); }
    else if (r < 0.24 && farm && L.eco.ox > 0) { L.eco.ox--; add(L, 1.2, 'bad', '家里的耕牛病死了。'); }
    else if (r < 0.25 && L.cls !== 'slave') { L.eco.cash += Math.round(1500 + R() * 3500); add(L, 2, 'good', pick(R, ['你在田里挖出了一小罐前人埋下的五铢钱。', '远房的亲戚过世，留给你家一些钱财。'])); }
    else if (r < 0.27 && L.cls === 'merchant') { var w = R() < 0.55 ? 1 : -1; L.eco.stock = Math.round(L.eco.stock * (w > 0 ? 1.25 : 0.7)); add(L, 2, w > 0 ? 'good' : 'bad', w > 0 ? '你倒卖了一批布帛，赚了不少。' : '一船货在江上翻了，血本无归。'); }
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
      if (k.fixDy != null || k.guard) {
        if (k.fixDy === y) kinDie(L, k, k.fixCause || 'base', 1.6, y);
        if (k.fixDy != null || y <= k.guard) return;
      }
      var q = (ka === 1 ? baseQ(0) : baseQ(ka)) * (CLS_Q[L.cls] || 1) * chaos(y) * (k.soldier ? 1.5 : 1) * (k.rel === 'child' && L.rec.focus && L.rec.focus.eff === 'kids' ? 0.85 : 1);
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

  /* ================= 性情与天资 ================= */
  var TRAITS = ['cur', 'cau', 'act', 'per', 'soc', 'ind'];
  var TRAIT_WORD = { cur: '好问', cau: '谨慎', act: '好动', per: '执拗', soc: '随和', ind: '有主见' };
  function traitWords(L) {
    if (L.age < 6) return [];
    var t = L.tr, ks = TRAITS.slice().sort(function (a, b) { return t[b] - t[a]; });
    var w = ks.filter(function (k) { return t[k] >= 57; }).slice(0, 2).map(function (k) { return TRAIT_WORD[k]; });
    if (L.age >= 15) { if (t.cau - t.soc > 10) w.push('节俭'); else if (t.soc - t.cau > 12) w.push('豪爽'); }
    return w.length ? w : ['平和'];
  }
  var TALENT = {
    craft: { n: '巧手', t: '你似乎很擅长记住东西是怎样拼起来的。大人修农具时，你在旁边看一遍就会了。' },
    memory: { n: '强记', t: '你很早就能记住别人说过的话，一字不差，大人们都暗暗称奇。' },
    strength: { n: '膂力', t: '你比同龄的孩子长得结实，力气也大，扛得动半袋粟米。' },
    charm: { n: '善察人意', t: '你很会看大人的脸色，说话总能说到人心里去。' }
  };
  var SEEDS = {
    seed1: { q: '夏日午后，大人都在忙。你一个人在屋前待着。你更常做的是——',
      o: ['跟着年长的孩子跑出去', '蹲在旁边看大人干活', '反复摆弄手边的小东西', '待在熟悉的大人身边'],
      t: ['你总是跟着年长的孩子满村跑，晒得黝黑。', '你常常蹲在一旁看大人干活，一看就是半天。', '你能把一块木头、几颗石子摆弄一整个下午。', '你总待在熟悉的大人身边，寸步不离。'],
      fx: [{ act: 8, soc: 4, strength: 0.3 }, { cur: 6, cau: 3, memory: 0.25 }, { per: 7, cur: 4, craft: 0.35 }, { cau: 6, soc: 4, charm: 0.2 }],
      w: function (t) { return [t.act, t.cur, t.per, t.cau]; } },
    seed2: { q: '家中来了一个你不认识的客人。他笑着同你说话。你——',
      o: ['躲到家人后面', '静静看着他', '回答他的话', '主动凑过去问东问西'],
      t: ['你躲在大人身后，只露出一双眼睛。', '你不说话，只是静静地看着他。客人走后，你把他说过的话学了一遍。', '你规规矩矩地回答了他的话，客人夸你懂事。', '你凑过去问东问西，客人被你问得哈哈大笑。'],
      fx: [{ cau: 7, ind: -3 }, { cau: 3, cur: 3, memory: 0.15 }, { soc: 5, ind: 3, charm: 0.2 }, { cur: 6, soc: 6, act: 3, charm: 0.1 }],
      w: function (t) { return [t.cau, (t.cau + t.cur) / 2, (t.soc + t.ind) / 2, (t.cur + t.soc) / 2]; } }
  };
  function applySeed(L, key, i) {
    var f = SEEDS[key].fx[i];
    for (var k in f) { if (L.tr[k] != null) L.tr[k] = clamp(L.tr[k] + f[k], 5, 95); else L.tal[k] = clamp(L.tal[k] + f[k], 0, 1); }
  }

  /* ================= 眼下所重 ================= */
  var FOCUS = {
    grow: { n: '成长', v: '长大', pull: '你还在襁褓之中' },
    play: { n: '玩耍', v: '四处玩耍', pull: '玩心太重' },
    help: { n: '帮补家计', v: '帮家里干活', pull: '家里实在缺人手' },
    study: { n: '读书习字', v: '读书习字', pull: '你实在放不下手边的书简' },
    craft: { n: '学习手艺', v: '学手艺', pull: '你总忍不住去摆弄那些器物' },
    body: { n: '强健筋骨', v: '练力气', pull: '你闲不住' },
    social: { n: '结交朋友', v: '四处交游', pull: '友人接连登门' },
    livelihood: { n: '谋生', v: '出去挣钱', pull: '家里等着米下锅' },
    house: { n: '操持家计', v: '操持家计', pull: '一家老小都指望着你' },
    save: { n: '积攒钱财', v: '节省开销', pull: '你心里总惦记着家里的余粮' },
    career: { n: '求取仕进', v: '谋个一官半职', pull: '有人劝你去郡里走动' },
    kids: { n: '养育子女', v: '照看孩子', pull: '孩子接连生病' },
    fame: { n: '经营名望', v: '在乡里经营名望', pull: '乡里有人来请你出面' },
    health: { n: '调养身体', v: '调养身体', pull: '身体实在不争气' },
    family: { n: '陪伴家人', v: '陪伴家人', pull: '家人离不开你' },
    teach: { n: '传授后辈', v: '教导后辈', pull: '后辈们总来找你' },
    village: { n: '乡里事务', v: '操心乡里的事', pull: '乡里的事总找上门来' },
    rest: { n: '清闲度日', v: '清闲度日', pull: '你实在累了' },
    army: { n: '军中立足', v: '在军中立足', pull: '军令如山' }
  };
  var WHY = { play: '你还小，正是贪玩的年纪', help: '家里缺人手', study: '你好问爱学', craft: '你手巧，总爱摆弄器物', body: '你闲不住', social: '你生性随和，喜欢热闹', livelihood: '你得自己挣口饭吃', house: '一家老小都指望着你', save: '你生性谨慎，总想着留些余粮', career: '你心里一直想做出一番事业', kids: '孩子还小', fame: '你很在意乡里的评价', health: '你近来身体不如从前', family: '儿孙绕膝', teach: '你肚子里有些学问', village: '乡里人信得过你', rest: '你年纪大了', army: '身在军中', grow: '你还在襁褓之中' };
  function teacherAt(L) { var f = L.kin[0]; return L.schooling || L.cls === 'gentry' || L.cls === 'clerk' || (f.lit && f.alive && !f.apart && !f.out); }
  function kidsUnder(L, n) { var y = L.by + L.age; return L.kin.filter(function (k) { return k.rel === 'child' && k.alive && !k.apart && y - k.by < n; }).length; }
  function focusOptions(L) {
    var a = L.age, o;
    if (a < 5) return ['grow'];
    if (L.band) return ['army'];
    if (L.soldier) return ['army', 'save', 'social', 'body'];
    if (a < 10) o = ['play', 'help', 'craft'];
    else if (a < 15) o = ['help', 'craft', 'body', 'social'];
    else if (a < 20) o = ['livelihood', 'craft', 'social', 'body'].concat(L.married ? ['house'] : []);
    else if (a < 40) o = ['house', 'save', 'social', 'craft'];
    else if (a < 60) o = ['house', 'save', 'fame', 'health'];
    else o = ['health', 'family', 'teach', 'village', 'rest'];
    if (a < 45 && (teacherAt(L) || L.literate)) o.splice(1, 0, 'study');
    if (a >= 18 && a < 60 && kidsUnder(L, 15) > 0) o.push('kids');
    if (L.sex === 'M' && a >= 18 && a < 65 && (L.office || L.cls === 'gentry' || L.learn >= 35)) o.push('career');
    if (L.cls === 'slave') o = o.filter(function (k) { return k !== 'save' && k !== 'career' && k !== 'fame'; });
    return o;
  }
  function hash01(a, b, c) {
    var h = Math.imul(a ^ 0x9e3779b9, 2654435761) ^ Math.imul(b, 40503) ^ Math.imul(c + 7, 69069);
    h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  function poorNow(L) { return L.eco.debt > 0 || L.wealth < 15 || (L.lastNet != null && L.lastNet < 0); }
  function focusScore(L, k) {
    var t = L.tr, a = L.age, s = 1, poor = poorNow(L);
    switch (k) {
      case 'play': s += (a < 8 ? 2 : 0) + (t.act - 50) / 12; break;
      case 'help': s += (poor ? 2.5 : 0.5) + (t.per - 50) / 20 - (L.cls === 'gentry' ? 3 : 0); break;
      case 'study': s += (t.cur - 50) / 10 + (t.per - 50) / 15 + (L.schooling ? 2.5 : 0) + (L.cls === 'gentry' ? 2 : 0) + (L.found.memory ? 1 : 0) - (poor ? 1 : 0) - (a > 25 ? 1 : 0); break;
      case 'craft': s += (L.found.craft ? 2 : 0) + (t.cur - 50) / 20 + (L.cls === 'artisan' ? 2 : 0) - (L.cls === 'gentry' ? 2 : 0); break;
      case 'body': s += (t.act - 50) / 10 + (L.found.strength ? 1 : 0); break;
      case 'social': s += (t.soc - 50) / 9 + (L.found.charm ? 1 : 0); break;
      case 'livelihood': s += (poor ? 2.5 : 1) + (L.married ? 0.5 : 0); break;
      case 'house': s += 1.5 + (poor ? 2 : 0) + (L.married ? 1 : 0) + (isHead(L) ? 1 : 0); break;
      case 'save': s += (t.cau - 50) / 9 + (L.eco.debt > 0 ? 1 : 0); break;
      case 'career': s += (t.ind - 50) / 12 + (L.cls === 'gentry' ? 2.5 : 0) + L.fame / 25 + (L.office ? 1.5 : 0); break;
      case 'kids': s += kidsUnder(L, 6) * 1.2 + (L.sex === 'F' ? 1 : 0); break;
      case 'fame': s += (t.soc - 50) / 15 + L.standing / 40 + (L.cls === 'gentry' ? 1 : 0); break;
      case 'health': s += (L.body < 35 ? 2.5 : 0) + (a - 45) / 15 + (L.injury ? 1 : 0); break;
      case 'family': s += 1 + kidsUnder(L, 99) / 3; break;
      case 'teach': s += L.learn / 30; break;
      case 'village': s += L.standing / 40 + (t.soc - 50) / 20; break;
      case 'rest': s += (a - 60) / 10; break;
      case 'army': s += 3; break;
    }
    if (L.lastFocus === k) s += 1.2;
    return s;
  }
  function focusWhy(L, k) {
    if ((k === 'house' || k === 'help' || k === 'livelihood' || k === 'save') && poorNow(L)) return L.eco.debt > 0 ? '家中还欠着债' : '家中粮储不丰';
    if (k === 'kids' && kidsUnder(L, 2) > 0) return '家中新添一口';
    if (k === 'health' && L.injury) return '旧伤时常发作';
    if (k === 'study' && L.found.memory) return '你记性极好，读书比旁人快';
    if (k === 'craft' && L.found.craft) return '你天生一双巧手';
    if (L.lastFocus === k && (L.focusYears || 0) >= 3 && L.age >= 15) return '多年来你一直如此，已成了习惯';
    return WHY[k];
  }
  function autoFocus(L, y) {
    var opts = focusOptions(L), best = opts[0], bs = -1e9;
    opts.forEach(function (k, i) { var s = focusScore(L, k) + hash01(L.seed, y, i) * 0.9; if (s > bs) { bs = s; best = k; } });
    return { key: best, why: focusWhy(L, best) };
  }
  function resolveFocus(L, y) {
    var opts = focusOptions(L), au = autoFocus(L, y), man = L.focusManual;
    if (man && opts.indexOf(man) < 0) man = null;
    var eff = au.key, dev = false;
    if (man) {
      eff = man;
      if (man !== au.key) {
        var g = focusScore(L, au.key) - focusScore(L, man);
        if (L.R() < clamp(0.08 + g * 0.06, 0.05, 0.35)) { eff = au.key; dev = true; }
      }
    }
    L.focusYears = L.lastFocus === eff ? (L.focusYears || 0) + 1 : 1;
    L.lastFocus = eff;
    return { eff: eff, auto: au.key, why: au.why, man: man, dev: dev };
  }
  function setFocus(L, k) { L.focusManual = k || null; }

  function applyFocus(L, y, F) {
    var R = L.R, k = F.eff, a = L.age, t = L.tr;
    if (F.dev) add(L, 0.3, 'note', '你原本打算' + FOCUS[F.man].v + '，不过' + FOCUS[F.auto].pull + '，这一年还是' + FOCUS[F.auto].v + '。');
    switch (k) {
      case 'play': L.body += 0.8; t.act += 0.4; t.soc += 0.3; break;
      case 'help': L.body += 0.4; t.per += 0.3; break;
      case 'study':
        var teach = teacherAt(L);
        L.learn += (teach ? 4 + R() * 4 : 1 + R() * 2) * (L.found.memory ? 1.4 : 1) * (a > 30 ? 0.6 : 1);
        t.cur += 0.3; t.per += 0.2;
        if (!teach && !L.literate && a < 16 && R() < 0.25) add(L, 2.1, 'life', '家里没人教你，你只能跟着识字的人零零碎碎地学。');
        break;
      case 'craft':
        L.craft += (3 + R() * 5) * (L.found.craft ? 1.5 : 1);
        if (L.craft >= 40 && a >= 16 && !L.office && !L.soldier && ['peasant', 'tenant', 'tuntian', 'soldier', 'clerk'].indexOf(L.cls) >= 0 && L.job !== '工匠') { L.job = '工匠'; add(L, 2.3, 'good', '你的手艺渐渐有了名气，乡里人开始请你做活。'); }
        break;
      case 'body': L.body += 1.8 + (L.found.strength ? 1 : 0); break;
      case 'social': L.standing += 1.5 + (L.found.charm ? 1 : 0); t.soc += 0.3; break;
      case 'fame': L.standing += 1.5; if (a >= 30) L.fame += 0.8; break;
      case 'career': L.fame += 0.6; L.standing += 0.5; break;
      case 'health': L.body += 1.2; break;
      case 'family': L.standing += 0.4; break;
      case 'teach':
        L.standing += 1;
        if (L.literate) liveKin(L, function (x) { return x.rel === 'child' && y - x.by >= 6 && y - x.by <= 25 && !x.lit; }).forEach(function (x) {
          if (R() < 0.3) { x.lit = true; add(L, 2.6, 'good', '你教会了' + kinLabel(L, x) + '认字。'); }
        });
        break;
      case 'village': L.standing += 2; break;
      case 'rest': L.body += 0.4; break;
    }
    TRAITS.forEach(function (x) { t[x] = clamp(t[x], 5, 95); });
    // 天资在少年时显露
    if (a >= 6 && a <= 14) Object.keys(TALENT).forEach(function (q) {
      if (L.found[q] || !L.alive) return;
      var rel = { craft: 'craft', memory: 'study', strength: 'body', charm: 'social' }[q] === k || (q === 'strength' && (k === 'play' || k === 'help'));
      if (R() < L.tal[q] * 0.22 + (rel ? 0.06 : 0)) {
        L.found[q] = y; add(L, 2.4, 'good', TALENT[q].t);
        if (q === 'strength') L.body += 5;
        if (q === 'charm') L.standing += 4;
      }
    });
  }

  /* ================= 家计 ================= */
  var PRICE = 100, LANDP = 1000;
  var SAL = { 书佐: 9000, 计吏: 12000, 县长: 40000, 郎官: 30000, 县令: 60000, 幕僚: 30000, 郡守: 120000 };
  var JOBINC = { 医者: 1500, 巫祝: 800, 门客: 2000, 塾师: 900, 稳婆: 600, 山贼: 1500 };
  function fmt(n) { n = Math.round(n); return (n < 0 ? '-' : '') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function initEco(L) {
    var R = L.R, E = { cash: 0, priv: 0, debt: 0, ox: 0, house: 3000, stock: 0, tools: false, loom: false, labor: 0, porter: 0, cart: false };
    var r = function (a, b) { return Math.round(a + R() * (b - a)); };
    switch (L.cls) {
      case 'peasant': E.cash = r(400, 2500); E.ox = L.land >= 20 && R() < 0.7 ? 1 : 0; if (R() < 0.2) E.debt = r(300, 1500); break;
      case 'tenant': E.cash = r(80, 600); E.house = 1500; if (R() < 0.35) E.debt = r(500, 3000); break;
      case 'tuntian': E.cash = r(150, 900); E.house = 1500; break;
      case 'soldier': E.cash = r(200, 1000); E.house = 1500; break;
      case 'artisan': E.cash = r(800, 4000); E.stock = r(2000, 6000); break;
      case 'merchant': E.cash = r(2000, 9000); E.stock = r(5000, 30000); E.house = 8000; break;
      case 'slave': E.house = 0; break;
      case 'clerk': E.cash = r(3000, 10000); E.ox = 1; E.house = 8000; break;
      case 'gentry': E.cash = r(30000, 250000); E.ox = Math.max(2, Math.round(L.land / 100)); E.house = 60000; break;
      case 'tribal': E.cash = r(100, 500); E.stock = r(3000, 12000); E.house = 800; break;
    }
    return E;
  }
  function netWorth(L) { var E = L.eco; return L.land * LANDP + E.ox * 3000 + E.house + E.stock + E.cash + E.priv - E.debt; }
  function wealthScore(L) { return clamp(22 * Math.log10(Math.max(0, netWorth(L)) / 1000 + 1), 0, 100); }
  function isHead(L) {
    if (L.cls === 'slave' || L.age < 15) return false;
    var f = L.kin[0], m = L.kin[1], sp = L.spouseK;
    var home = function (k) { return k.alive && !k.apart && !k.out; };
    if (L.sex === 'F') {
      if (L.married && sp && home(sp)) return false;
      if (L.married || L.widowed) return !L.kin.some(function (k) { return k.rel === 'child' && k.sex === 'M' && home(k) && L.by + L.age - k.by >= 16; });
      return !home(f) && !home(m);
    }
    return !!L.split || !home(f);
  }
  function reserve(L) { return (L.lastCons || 60) * PRICE * 0.25; }
  function payFrom(L, amt) { var E = L.eco, p = Math.min(E.priv, amt); E.priv -= p; amt -= p; if (amt > 0) E.cash -= amt; if (E.cash < 0) { E.debt -= E.cash; E.cash = 0; } }
  function members(L, y) {
    var m = { n: 0, adults: 0, kids: 0, infants: 0, elders: 0, wM: 0, wF: 0, cons: 0 };
    household(L, y).forEach(function (p) {
      if (p.me ? (L.soldier || L.band) : p.soldier) return;
      var a = p.age, w = 0;
      m.n++;
      if (a < 3) { m.infants++; m.cons += 3; }
      else if (a < 15) { m.kids++; m.cons += 8; if (a >= 10) w = 0.4; }
      else { m.adults++; m.cons += a > 60 ? 11 : 14; w = a > 60 ? 0.4 : 1; if (a > 60) m.elders++; }
      if (p.sex === 'M') m.wM += w; else m.wF += w;
    });
    return m;
  }
  function shock(L, y) {
    var h = 1, p = 1;
    (EV_BY_Y[y] || []).forEach(function (ev) {
      var fx = localFx(L, ev, L.zone, y);
      if (!fx || fx._skip) return;
      if (fx.fam) { h *= Math.max(0.2, 1 - fx.fam * 7); p *= 1 + fx.fam * 50; }
      if (fx.war) h *= Math.max(0.4, 1 - fx.war * 6);
      if (fx.flood) h *= Math.max(0.3, 1 - fx.flood * 15);
      if (fx.plag) h *= Math.max(0.7, 1 - fx.plag * 4);
    });
    return { h: h, p: Math.min(p, 8) };
  }
  function taxes(L, y, m, H, owner) {
    var g = group(ctrl(L.zone, y)), out = [];
    if (L.eth) return [['向官府纳贡', 200]];
    if (L.cls === 'tuntian') return [];
    var ad = m.adults - m.elders, adM = Math.max(0, Math.round(m.wM - 0.4 * m.elders)), k7 = Math.round(m.kids * 0.6);
    if (g === 'jin' && y >= 280) { out.push(['户调（绢三匹、绵三斤）', 1800]); out.push(['田租', 400]); }
    else if ((g === 'wei' || g === 'jin') && y >= 204) { out.push(['户调（绢二匹、绵二斤）', 1200]); if (owner && L.land) out.push(['田租（亩四升）', L.land * 4]); }
    else {
      var mu = g === 'wu' && y >= 200 ? 1.25 : g === 'shu' && y >= 214 ? 1.2 : 1;
      if (ad > 0) out.push(['算赋（成丁每人一百二十钱）', Math.round(ad * 120 * mu)]);
      if (k7) out.push(['口钱', k7 * 23]);
      if (adM) out.push(['更赋', Math.round(adM * 300 * mu)]);
      if (owner && H) out.push(['田租（三十税一）', Math.round(H / 30 * PRICE)]);
    }
    if (L.cls === 'gentry') out.forEach(function (x) { x[1] = Math.round(x[1] * 1.5); });
    return out;
  }
  function economyYear(L, y) {
    var R = L.R, E = L.eco, rec = L.rec, fo = rec.focus ? rec.focus.eff : null, a = L.age, c = L.cls;
    if (c === 'slave') { if (a >= 15) E.priv += Math.round(10 + R() * 50); rec.ledger = null; L.grainMonths = null; return; }
    if (L.band || (L.soldier && liveKin(L, function (k) { return !k.out; }).length === 0)) {
      var pay = 2400, keep = Math.round(pay * (L.tr.cau > 55 ? 0.6 : 0.35));
      E.priv += keep;
      rec.ledger = { solo: true, inc: [['军饷', pay]], exp: [['军中自用', pay - keep]], I: pay, X: pay - keep, net: keep, head: true };
      L.lastNet = keep; L.grainMonths = null;
      return;
    }
    var m = members(L, y), sh = shock(L, y);
    var hf = sh.h * (L.yHarvest || 1) * (0.85 + R() * 0.3) * (E.tools ? 1.08 : 1) * (fo === 'house' ? 1.06 : 1);
    L.yHarvest = 1;
    var inc = [], exp = [], H = 0, note = '';
    var cap = (m.wM * 45 + m.wF * 12) * (E.ox > 0 ? 1.35 : 1);
    var owner = ['peasant', 'clerk', 'soldier', 'artisan', 'merchant'].indexOf(c) >= 0;
    if (c === 'gentry') { H = L.land * 2.5 * 0.5 * 0.8 * hf; note = '佃客交租'; }
    else if (c === 'tenant') { H = Math.min(cap, 70) * 2.5 * hf * 0.5; note = '佃种豪强之田，见税什五'; }
    else if (c === 'tuntian') { H = Math.min(cap * 1.35, 60) * 2.8 * hf * 0.4; note = '屯田，官六民四'; }
    else if (c === 'tribal') { H = m.cons * (0.55 + 0.35 * hf); note = '畜牧与山田'; }
    else if (owner) {
      var own = Math.min(L.land, cap), spare = cap - own;
      H = own * 2.5 * hf;
      note = L.land > 0 ? '自家田' + L.land + '亩' : '';
      if (spare > 8 && (c === 'peasant' || c === 'soldier' || (c === 'artisan' && m.wM > 1.5))) { H += Math.min(spare, 40) * 0.6 * 2.5 * hf * 0.5; note += (note ? '，' : '') + '另佃种些他人田'; }
    }
    H = Math.round(H);
    var C = Math.round(m.cons);
    if (H > 0) inc.push(['田收 ' + H + ' 石' + (note ? '（' + note + '）' : ''), H * PRICE]);
    exp.push(['口粮 ' + C + ' 石（' + m.n + ' 口人）', C * PRICE]);
    if (C > H && sh.p > 1.05) exp.push(['粮价腾贵（谷价约为平年的' + sh.p.toFixed(1) + '倍）', Math.round((C - H) * PRICE * (sh.p - 1) * 0.5)]);
    if (H > C && sh.p > 1.05) inc.push(['余粮卖得好价', Math.round((H - C) * PRICE * (Math.min(sh.p, 1.6) - 1))]);
    if (m.wF > 0 && c !== 'gentry') inc.push(['纺织', Math.round(m.wF * 700 * (E.loom ? 1.3 : 1) * (sh.h < 0.6 ? 0.7 : 1))]);
    if (c === 'artisan') inc.push(['手艺', Math.round(Math.max(1, m.wM) * 5500 + L.craft * 40)]);
    else if (L.job === '工匠') inc.push(['做活', Math.round(600 + L.craft * 40)]);
    if (c === 'merchant') {
      inc.push(['买卖', Math.round(E.stock * (0.12 + R() * 0.25) * (chaos(y) > 1.1 ? 0.8 : 1) + m.wM * 3000 + (E.cart ? 2500 : 0) + (E.porter > 0 ? 1500 : 0))]);
      if (E.porter > 0) { E.porter--; exp.push(['脚夫工钱', 1000]); }
    }
    if (c === 'tribal') inc.push(['牲畜', Math.round(E.stock * 0.12 + m.wM * 800)]);
    if (c === 'soldier') inc.push(['士家廪给', m.n * 400]);
    if (L.office && SAL[L.office]) inc.push(['俸禄（' + L.office + '）', SAL[L.office]]);
    if (JOBINC[L.job]) inc.push([L.job + '的收入', JOBINC[L.job]]);
    var f = L.kin[0];
    if (c === 'clerk' && f.alive && !f.apart && !f.out && y - f.by < 60 && !L.split) inc.push(['父亲的俸禄', 9000]);
    if (c === 'gentry') inc.push(['家中产业', Math.round(L.land * 20)]);
    var wage = 0;
    if (fo === 'livelihood') wage += 1500;
    if (fo === 'help' && a >= 10) wage += 500;
    if ((c === 'peasant' || c === 'tenant') && H < C) wage += Math.round(Math.max(0, m.wM - 1) * 900);
    if (wage) inc.push(['佣作', wage]);
    if (E.labor > 0) { inc.push(['外出佣作寄回', 2500]); E.labor--; }
    if (L.soldier) inc.push(['军饷寄回', 1200]);
    exp.push(['衣物', m.n * 250]);
    exp.push(['盐、铁器与杂用', 300 + m.n * 80]);
    taxes(L, y, m, H, owner).forEach(function (x) { exp.push(x); });
    if (L.schooling && a < 18 && c !== 'gentry') exp.push(['束脩', 300]);
    if (c === 'gentry') exp.push(['宾客、部曲与延师', Math.round(L.land * 8)]);
    if (L.body < 30 || L.injury) exp.push(['医药', 200]);
    if (E.debt > 0) exp.push(['债息', Math.round(E.debt * 0.15)]);
    if (fo === 'social') exp.push(['交游应酬', c === 'gentry' ? 2000 : 300]);
    if (fo === 'career') exp.push(['人情往来', c === 'gentry' ? 5000 : 800]);
    if (fo === 'fame') exp.push(['宴客', c === 'gentry' ? 6000 : 1000]);
    var mult = fo === 'save' ? 0.92 : fo === 'house' ? 0.96 : 1;
    var I = 0, X = 0;
    inc.forEach(function (x) { I += x[1]; });
    exp.forEach(function (x) { if (x[0].indexOf('口粮') !== 0 && x[0].indexOf('粮价') !== 0) x[1] = Math.round(x[1] * mult); X += x[1]; });
    var net = I - X, head = isHead(L);
    if (net >= 0) {
      var rep = Math.min(E.debt, Math.round(net * 0.6)), left = net - rep;
      E.debt -= rep;
      if (!head && a >= 15) { var share = Math.round(left * (fo === 'save' ? 0.15 : 0.07)); left -= share; E.priv += share; }
      E.cash += left;
    } else {
      E.cash += net;
      if (E.cash < 0) { add(L, 3.85, 'bad', (head ? '你家' : '家中') + '入不敷出，积蓄用尽，又欠下了' + fmt(-E.cash) + '钱值的债。'); E.debt += -E.cash; E.cash = 0; L.rec.tags.push('hard'); }
      else if (net < -1500) add(L, 3.85, 'bad', '家中入不敷出，动用了' + fmt(-net) + '钱值的积蓄才熬过这一年。');
    }
    L.lastNet = net; L.lastCons = C;
    L.grainMonths = Math.round(Math.min(12, C > 0 ? Math.min(H, C) / C * 12 : 12));
    rec.ledger = { inc: inc, exp: exp, I: I, X: X, net: net, head: head };
    if (E.debt > Math.max(4000, C * PRICE * 0.8) && a - (L.lastCrisis == null ? -9 : L.lastCrisis) >= 3) { L.crisis = true; L.lastCrisis = a; }
    autoSpend(L, y, fo);
  }
  function autoSpend(L, y, fo) {
    var R = L.R, E = L.eco;
    if (L.age < 18 || L.cls === 'slave') return;
    var room = E.priv + (isHead(L) ? Math.max(0, E.cash - reserve(L)) : 0);
    if (room < 800) return;
    var lav = (L.tr.soc - L.tr.cau) / 40 + (fo === 'social' || fo === 'fame' ? 0.3 : 0) - (fo === 'save' ? 0.6 : 0);
    if (lav > 0.15 && R() < 0.25 + lav * 0.35) {
      var amt = Math.round(room * (0.05 + R() * 0.12) / 10) * 10;
      payFrom(L, amt); L.standing += 1;
      add(L, 3.7, 'life', pick(R, ['你近来手头宽裕，花了' + fmt(amt) + '钱值买酒肉，与邻人共饮。', '友人远道来访，你置办了一桌酒食，花去' + fmt(amt) + '钱值。', '你给家里添置了些新衣新物，花了' + fmt(amt) + '钱值。']));
    } else if (lav < -0.2 && R() < 0.15) add(L, 3.7, 'life', '你一直舍不得添置新衣，将余钱都攒了下来。');
  }
  function laborCandidate(L, y) {
    var k = liveKin(L, function (x) { return (x.rel === 'child' || x.rel === 'sib') && x.sex === 'M' && !x.out && !x.soldier && y - x.by >= 14 && y - x.by <= 35; })[0];
    if (k) return k;
    return L.sex === 'M' && L.age >= 16 && L.age <= 45 && !L.office ? 'self' : null;
  }
  function crisisAct(L, y, c, k) {
    var E = L.eco, R = L.R, who = c.who ? c.who + '决定' : '你家';
    switch (k) {
      case 'sell':
        var n = Math.min(c.n, L.land), got = Math.round(n * LANDP * (shock(L, y).p > 1.5 ? 0.45 : 0.7)), rp = Math.min(E.debt, got);
        L.land -= n; E.debt -= rp; E.cash += got - rp;
        if (E.ox && L.land < 10 && R() < 0.5) E.ox = 0;
        add(L, 0.5, 'bad', who + '卖掉了' + cnNum(n) + '亩田，得钱' + fmt(got) + '钱值，' + (E.debt > 0 ? '还了一部分债。' : '把债还清了。'));
        if (L.land === 0 && L.cls === 'peasant') { L.cls = 'tenant'; add(L, 0.55, 'bad', '田卖光了，你家只好去佃种别人的地。'); }
        break;
      case 'borrow': E.debt += 2000; E.cash += 2000; add(L, 0.5, 'bad', who + '又向里中的豪强借了二千钱，利息很重。'); break;
      case 'labor':
        E.labor = 3;
        add(L, 0.5, 'life', c.lab === 'self' ? '你到邻县的大户人家做佣工，挣些钱寄回家。' : kinLabel(L, c.lab) + '去邻县的大户人家做佣工，每年能寄回些钱。');
        break;
      case 'kin':
        L.cls = 'tenant'; if (L.job === '农') L.job = '佃户';
        E.debt = 0; L.land = 0; E.ox = 0; L.standing -= 4;
        add(L, 0.5, 'bad', who + '把田地抵给了当地的豪强，从此成了他的佃客。债是不用还了。');
        break;
      case 'flee': E.debt = 0; relocate(L, c.dest, 0.6, '你家趁夜离开了家乡，躲开债主，逃往{dest}。', 0.04, y); break;
    }
  }

  /* ================= 支用余财 ================= */
  function farmerish(L) { return ['peasant', 'tenant', 'tuntian', 'soldier', 'clerk'].indexOf(L.cls) >= 0 && !L.soldier && !L.band; }
  function richish(L) { return L.cls === 'gentry' || L.cls === 'merchant' || !!L.office; }
  function kidsWith(L, f) { var y = L.by + L.age; return liveKin(L, function (k) { return k.rel === 'child' && !k.out && f(y - k.by, k); }); }
  var SPEND = [
    { id: 'coat', g: '日用', n: '添置一件厚冬衣', c: 650, ok: function () { return true; }, fx: function (L) { L.body += 2; return '你添置了一件厚实的冬衣。这个冬天没那么难熬了。'; } },
    { id: 'chicken', g: '日用', n: '买一只鸡给家里补补', c: 220, ok: function (L) { return !L.band; }, fx: function (L) { L.body += 1; return '你买了一只鸡，炖了一锅汤，一家人吃得满嘴是油。'; } },
    { id: 'wine', g: '日用', n: '买些酒肉与邻人共饮', c: 90, ok: function () { return true; }, fx: function (L) { L.standing += 1; return '你买了些酒肉，请邻人来喝了一回。'; } },
    { id: 'doctor', g: '日用', n: '请医者来看旧疾', c: 360, ok: function (L) { return L.body < 50 || !!L.injury; }, fx: function (L) { L.body += 6; if (L.injury && L.R() < 0.3) { L.injury = null; return '医者给你针灸敷药，旧伤竟渐渐好了。'; } return '医者给你开了几服药，身子轻快了些。'; } },
    { id: 'kidclothes', g: '日用', n: '给孩子们做身新衣', c: 400, ok: function (L) { return kidsWith(L, function (a) { return a < 15; }).length > 0; }, fx: function (L) { L.standing += 0.5; return '你给孩子们各做了一身新衣，他们高兴了好几天。'; } },
    { id: 'tools', g: '农事', n: '添置一套新农具', c: 430, ok: function (L) { return farmerish(L) && !L.eco.tools; }, fx: function (L) { L.eco.tools = true; return '你添置了一套新的铁犁铧和锄头，往后耕作省力不少。'; } },
    { id: 'ox', g: '农事', n: '买一头耕牛', c: 3000, ok: function (L) { return farmerish(L) && L.eco.ox < 2 && (L.land >= 10 || L.cls === 'tenant'); }, fx: function (L) { L.eco.ox++; return '你买回一头黄牛。村里人都来看，说这牛口齿好。'; } },
    { id: 'land1', g: '农事', n: '买一亩田', c: LANDP, ok: function (L) { return ['peasant', 'clerk', 'gentry', 'merchant', 'artisan', 'soldier', 'tenant'].indexOf(L.cls) >= 0 && !L.band; }, fx: function (L) { L.land++; if (L.cls === 'tenant' && L.land >= 5) { L.cls = 'peasant'; return '你买下了一亩田。积攒了这么多年，你家终于又有了自己的地。'; } return '你买下了一亩田。'; } },
    { id: 'land10', g: '农事', n: '买十亩田', c: LANDP * 10, ok: function (L) { return ['peasant', 'clerk', 'gentry', 'merchant', 'artisan'].indexOf(L.cls) >= 0 && !L.band; }, fx: function (L) { L.land += 10; return '你买下了十亩好田，立了田契。'; } },
    { id: 'loom', g: '家业', n: '添置一架织机', c: 1500, ok: function (L) { return L.sex === 'F' && !L.eco.loom && L.cls !== 'gentry'; }, fx: function (L) { L.eco.loom = true; return '你添置了一架织机，往后织布快了许多。'; } },
    { id: 'tutor', g: '子女', n: '给孩子请人启蒙', c: 800, ok: function (L) { return kidsWith(L, function (a, k) { return a >= 5 && a <= 12 && !k.lit; }).length > 0; }, fx: function (L) { var k = kidsWith(L, function (a, x) { return a >= 5 && a <= 12 && !x.lit; })[0]; k.lit = true; return '你请乡里的老先生教' + kinLabel(L, k) + '识字。'; } },
    { id: 'sacrifice', g: '乡里', n: '祭祀祖先', c: 300, ok: function () { return true; }, fx: function (L) { L.standing += 1; return '你备了牲醴，祭祀祖先。'; } },
    { id: 'charity', g: '乡里', n: '出钱赈济乡里贫户', c: 2000, ok: function (L) { return L.age >= 20; }, fx: function (L) { L.standing += 5; L.fame += 2; return '你拿出二千钱赈济乡里的贫户。乡人都说你仁厚。'; } },
    { id: 'bridge', g: '乡里', n: '出资修桥补路', c: 5000, ok: function (L) { return L.age >= 25; }, fx: function (L) { L.standing += 6; L.fame += 3; return '你出钱修了村口的石桥。过往的人都知道这是谁修的。'; } },
    { id: 'slips', g: '读书', n: '买些简牍和纸', c: 400, ok: function (L) { return L.literate; }, fx: function (L) { L.learn += 2; return '你买了些简牍和纸，抄书习字。'; } },
    { id: 'copy', g: '读书', n: '请人抄录一部书', c: 600, ok: function (L) { return L.literate; }, fx: function (L) { L.learn += 3; return '你请人抄了一部《春秋》，日夜诵读。'; } },
    { id: 'classmates', g: '读书', n: '宴请同窗', c: 1200, ok: function (L) { return L.literate && L.age < 50; }, fx: function (L) { L.standing += 3; return '你宴请了几位一同读书的朋友，谈到半夜。'; } },
    { id: 'robe', g: '读书', n: '置办一袭像样的衣冠', c: 2400, ok: function (L) { return (L.literate || L.office) && !L.flags.robe; }, fx: function (L) { L.flags.robe = true; L.standing += 3; return '你置办了一袭像样的衣冠。穿上它去县廷，人家对你客气了许多。'; } },
    { id: 'visit', g: '读书', n: '游学，拜访名师', c: 4000, ok: function (L) { return L.literate && L.age < 45; }, fx: function (L) { L.learn += 6; L.fame += 2; L.standing += 2; return '你出门游学，拜访了邻郡的名师，听他讲了三个月的经。'; } },
    { id: 'books', g: '读书', n: '置办一批书籍', c: 3000, ok: function (L) { return L.literate && richish(L); }, fx: function (L) { L.learn += 5; return '你置办了一批书籍，满满装了两车。'; } },
    { id: 'teacher', g: '读书', n: '延请名师到家中讲学', c: 5000, ok: function (L) { return L.cls === 'gentry' || L.cls === 'clerk'; }, fx: function (L) { L.learn += 8; kidsWith(L, function (a) { return a >= 5 && a <= 18; }).forEach(function (k) { k.lit = true; }); return '你延请名师到家中讲学，家中子弟都跟着读书。'; } },
    { id: 'feast', g: '交游', n: '宴请宾客', c: 2000, ok: function (L) { return richish(L); }, fx: function (L) { L.standing += 4; L.fame += 2; return '你大宴宾客，席间有人赋诗，有人击剑。'; } },
    { id: 'befriend', g: '交游', n: '出资结交地方豪杰', c: 5000, ok: function (L) { return richish(L) && L.sex === 'M'; }, fx: function (L) { L.flags.connected = true; L.standing += 6; return '你出资结交了郡中几位有名望的人物。往后办事方便多了。'; } },
    { id: 'horse', g: '交游', n: '添置一匹良马', c: 15000, ok: function (L) { return richish(L) && !L.flags.horse; }, fx: function (L) { L.flags.horse = true; L.fame += 1; return '你买了一匹良马，骑出门时引得路人侧目。'; } },
    { id: 'goods', g: '买卖', n: '扩充货物', c: 5000, ok: function (L) { return L.cls === 'merchant'; }, fx: function (L) { L.eco.stock += 5000; return '你进了一批布帛和盐，货本多了五千钱。'; } },
    { id: 'porter', g: '买卖', n: '雇几个脚夫（三年）', c: 2000, ok: function (L) { return L.cls === 'merchant' && !L.eco.porter; }, fx: function (L) { L.eco.porter = 3; return '你雇了几个脚夫帮着运货。'; } },
    { id: 'cart', g: '买卖', n: '买一辆货车', c: 8000, ok: function (L) { return L.cls === 'merchant' && !L.eco.cart; }, fx: function (L) { L.eco.cart = true; return '你买了一辆牛车，往后能跑更远的路了。'; } },
    { id: 'venture', g: '买卖', n: '投入一次远途贩运', c: 10000, ok: function (L) { return L.cls === 'merchant'; }, fx: function (L) { var r = L.R(); if (r < 0.55) { L.eco.cash += 18000; return '你押了一批货到远方贩卖，赚回一万八千钱值。'; } if (r < 0.8) { L.eco.cash += 10000; return '远途贩运来回折腾了半年，刚好保本。'; } return '货在路上被劫，一万钱血本无归。'; } },
    { id: 'shop', g: '买卖', n: '在市上租一间铺子', c: 1500, ok: function (L) { return (L.cls === 'merchant' || L.cls === 'artisan' || L.job === '工匠') && !L.flags.shop; }, fx: function (L) { L.flags.shop = true; L.eco.stock += 1500; return '你在县城的市上租了一间小铺子。'; } },
    { id: 'armor', g: '军中', n: '添置一副好些的甲具', c: 3000, ok: function (L) { return !!L.soldier && !L.flags.armor; }, fx: function (L) { L.flags.armor = true; return '你花钱换了一副好些的皮甲和兜鍪。'; } },
    { id: 'treat', g: '军中', n: '买酒肉犒劳同伴', c: 300, ok: function (L) { return !!L.soldier; }, fx: function (L) { L.standing += 2; return '你买了酒肉犒劳同伍的兄弟。'; } },
    { id: 'sendhome', g: '军中', n: '把私蓄寄回家', c: function (L) { return Math.max(100, Math.round(L.eco.priv)); }, ok: function (L) { return !!L.soldier && L.eco.priv >= 100 && liveKin(L, function (k) { return !k.out; }).length > 0; }, fx: function (L, y, c) { L.eco.cash += c; return '你托同乡把' + fmt(c) + '钱值的私蓄捎回了家。'; } },
    { id: 'hairpin', g: '日用', n: '给自己买一支铜钗', c: 200, ok: function (L) { return L.sex === 'F'; }, fx: function () { return '你给自己买了一支铜钗。'; } },
    { id: 'coffin', g: '身后', n: '预备寿材', c: 3000, ok: function (L) { return L.age >= 55 && !L.flags.coffin; }, fx: function (L) { L.flags.coffin = true; return '你早早为自己备好了一副柏木寿材。'; } },
    { id: 'gift', g: '身后', n: '给孙辈压岁钱', c: 100, ok: function (L) { return L.grandkids > 0; }, fx: function () { return '你给孙辈们每人串了一串压岁钱。'; } }
  ];
  function spendRoom(L) {
    var head = isHead(L), free = Math.max(0, Math.round(L.eco.cash - reserve(L)));
    return { priv: Math.round(L.eco.priv), house: head ? free : 0, family: head ? 0 : free, head: head };
  }
  function spendOptions(L) {
    var y = L.by + L.age, room = spendRoom(L), can = room.priv + room.house;
    if (L.age < 15 || L.cls === 'slave') return { room: room, items: [], can: can };
    var items = SPEND.filter(function (s) { return s.ok(L, y); }).map(function (s) {
      var c = typeof s.c === 'function' ? s.c(L) : s.c;
      return { id: s.id, n: s.n, c: c, g: s.g, st: c <= can ? 'ok' : (!room.head && c <= can + room.family ? 'ask' : 'poor') };
    });
    return { room: room, items: items, can: can };
  }
  function spend(L, id) {
    var y = L.by + L.age;
    var s = SPEND.filter(function (x) { return x.id === id; })[0];
    var it = spendOptions(L).items.filter(function (x) { return x.id === id; })[0];
    if (!s || !it || it.st === 'poor') return { ok: false, t: '余财不足。' };
    var r;
    if (it.st === 'ask') {
      if (L.R() >= 0.2 + L.standing / 300 + (it.c < 1000 ? 0.25 : 0)) r = { ok: false, t: '你开口向家里要' + fmt(it.c) + '钱值，想' + s.n + '。家主没有答应。' };
      else { var p = Math.min(L.eco.priv, it.c); L.eco.priv -= p; L.eco.cash -= it.c - p; r = { ok: true, t: '家主答应了你。' + s.fx(L, y, it.c) }; }
    } else { payFrom(L, it.c); r = { ok: true, t: s.fx(L, y, it.c) }; }
    r.c = it.c;
    (L.spendLog = L.spendLog || []).push({ y: y, t: r.t, ok: r.ok });
    L.wealth = wealthScore(L);
    return r;
  }
  function ecoView(L) {
    var y = L.by + L.age - (L.alive ? 1 : 0), E = L.eco, g = group(ctrl(L.zone, y));
    var coin = L.eth ? 0.1 : (y >= 190 && y < 196) ? 0.15 : (g === 'wei' && y >= 221 && y < 227) ? 0.05 : (y >= 196 && y < 221) ? 0.3 : 0.45;
    var cloth = 0.3, cash = Math.round(E.cash);
    return {
      slave: L.cls === 'slave', head: isHead(L), land: L.land, ox: E.ox, house: E.house, stock: E.stock,
      assets: L.land * LANDP + E.ox * 3000 + E.house + E.stock, cash: cash, priv: Math.round(E.priv), debt: Math.round(E.debt),
      comp: [['五铢钱', Math.round(cash * coin)], ['布帛', Math.round(cash * cloth)], ['粮谷', cash - Math.round(cash * coin) - Math.round(cash * cloth)]],
      months: L.grainMonths, coinNote: y >= 190 && y < 196 ? '董卓的小钱轻薄，钱几乎不值钱' : g === 'wei' && y >= 221 && y < 227 ? '朝廷罢五铢钱，交易多用谷帛' : ''
    };
  }

  function splitHousehold(L, y) {
    var R = L.R, a = L.age, f = L.kin[0], E = L.eco;
    if (L.sex !== 'M' || L.split || L.cls === 'slave' || L.soldier || L.band || a < 18) return;
    var home = f.alive && !f.apart && !f.out;
    var bros = liveKin(L, function (k) { return k.rel === 'sib' && k.sex === 'M' && y - k.by >= 15 && !k.out; }).length;
    if (home && L.married && a >= 20 && R() < 0.12) {
      var share = Math.floor(L.land / (bros + 2));
      L.split = true; L.land = share; E.cash = Math.round(E.cash / (bros + 2)); E.debt = Math.round(E.debt / (bros + 2));
      E.ox = E.ox > 1 ? 1 : (R() < 0.4 ? E.ox : 0); E.house = Math.min(E.house, 2500);
      liveKin(L, function (k) { return ['father', 'mother', 'sib', 'gp'].indexOf(k.rel) >= 0; }).forEach(function (k) { k.out = true; });
      add(L, 2.9, 'life', '你与父亲分了家' + (share > 0 ? '，分得' + cnNum(share) + '亩田' : '') + '，从此自立门户，成了户主。');
    } else if (!f.alive && f.dy === y && !L.inherited) {
      L.inherited = true;
      if (bros > 0) {
        L.land = Math.floor(L.land / (bros + 1)); E.cash = Math.round(E.cash / (bros + 1));
        liveKin(L, function (k) { return k.rel === 'sib' && k.sex === 'M' && y - k.by >= 15; }).forEach(function (k) { k.out = true; });
        add(L, 3.1, 'life', '父亲去世后，你和兄弟们分了家产' + (L.land > 0 ? '，你分得' + cnNum(L.land) + '亩田' : '') + '，成了户主。');
      } else add(L, 3.1, 'life', '父亲去世，你继承了家业，成了户主。');
      L.split = true;
    }
  }
  function sonOutcome(L, y, d) {
    var R = L.R, son = d.son, nm = '儿子' + son.name;
    if (!son.alive) return;
    if (!d.give) { add(L, 0.6, 'life', nm + '怏怏不乐，好几个月不同你说话。'); return; }
    payFrom(L, 3000);
    if (son.lav > 0.66) { var sp = 1800 + Math.round(R() * 8) * 100; add(L, 3.4, 'bad', '给' + nm + '的三千钱，他花了' + fmt(sp) + '宴客，说是结交朋友。剩下的也没拿回来。'); }
    else if (son.lav > 0.3) { L.eco.cash += 3400; add(L, 3.4, 'good', nm + '倒也争气，年底连本带利还了你三千四百钱。'); }
    else add(L, 3.4, 'bad', nm + '的买卖没做成，三千钱赔了个精光。他回来后好几天不敢见你。');
  }


  /* ================= 人生抉择 ================= */
  function choiceMul(L) {
    var m = { gentry: 2.4, clerk: 1.8, merchant: 1.5, artisan: 1.1, peasant: 1, soldier: 1, tuntian: 0.9, tenant: 0.8, tribal: 0.8, slave: 0.7 }[L.cls] || 1;
    if (L.office) m *= 1.5;
    if (L.literate) m *= 1.2;
    return m;
  }
  function isElite(L) { return L.cls === 'gentry' || L.cls === 'clerk' || !!L.office || L.learn >= 45 || L.fame >= 20; }
  function ctxH(L, y) {
    var fl = { war: 0, fam: 0, plag: 0 }, fk = ctrl(L.zone, y);
    (EV_BY_Y[y] || []).forEach(function (ev) { var fx = localFx(L, ev, L.zone, y); if (fx && !fx._skip) { fl.war += fx.war || 0; fl.fam += fx.fam || 0; fl.plag += fx.plag || 0; } });
    var camp = L.soldier && (CAMP_BY_Y[y] || []).some(function (c) { return c.a.indexOf(L.soldier.army) >= 0; });
    return {
      y: y, a: L.age, g: group(fk), fname: fname(fk, y), head: isHead(L), fl: fl, chaos: chaos(y), poor: poorNow(L), farm: farmerish(L), camp: camp,
      kids: function (lo, hi, sex, f) { return liveKin(L, function (k) { var a = y - k.by; return k.rel === 'child' && a >= lo && a <= hi && (!sex || k.sex === sex) && (!f || f(k)); }); },
      someKin: function () { var ks = liveKin(L, function (k) { return !k.out && k.by < y; }); return ks.length ? ks[Math.floor(hash01(L.seed, y, 99) * ks.length)] : null; }
    };
  }
  function fillC(L, t, meta) {
    return t.replace('{kin}', meta.kin ? kinLabel(L, meta.kin) : '').replace(/\{kin\}/g, meta.kin ? kinLabel(L, meta.kin) : '')
      .replace(/\{lord\}/g, meta.lord || '').replace(/\{birth\}/g, D.JUN[L.birthJun][0] + L.birthCounty);
  }
  function lifeChoice(L, y, free) {
    var R = L.R, a = L.age;
    if (a < 12 || (!free && !L.soldier)) return null;
    var gapN = L.cls === 'gentry' || L.office ? 1 : 2;
    if (a - L.lastChoice < gapN) return null;
    if (R() >= 0.17 * choiceMul(L)) return null;
    var H = ctxH(L, y), elite = isElite(L), pool = [];
    D.CHOICES.forEach(function (c) {
      if (c.elite && !elite) return;
      if ((L.choiceSeen || {})[c.id] && c.id !== 'sick' && c.id !== 'plague' && c.id !== 'storm' && c.id !== 'relief') return;
      var meta = c.ok(L, H);
      if (meta) pool.push({ c: c, meta: meta });
    });
    if (!pool.length) return null;
    var pk = wpick(R, pool, function (x) { return x.c.w; });
    var c = pk.c;
    (L.choiceSeen = L.choiceSeen || {})[c.id] = true;
    var aw = c.aw ? c.aw(L).map(function (x) { return Math.max(1, x); }) : c.o.map(function () { return 1; });
    return { key: 'life', id: c.id, meta: pk.meta, q: fillC(L, c.q, pk.meta), o: c.o.slice(), w: aw.map(function (x) { return x * x; }) };
  }
  function lifeOutcome(L, y, ch, i) {
    var R = L.R, def = D.CHOICES.filter(function (c) { return c.id === ch.id; })[0];
    var rs = def.r[i], r = rs[rs.length - 1], acc = 0, x = R();
    for (var j = 0; j < rs.length; j++) { acc += rs[j].p; if (x < acc) { r = rs[j]; break; } }
    var fx = r.fx || {}, s = 1.15, meta = ch.meta || {};
    if (r.t) add(L, s, 'life', fillC(L, r.t, meta));
    ['body', 'learn', 'standing', 'fame', 'craft'].forEach(function (k) { if (fx[k]) L[k] += fx[k]; });
    var E = L.eco;
    if (fx.cash) { if (fx.cash > 0) E.cash += fx.cash; else payFrom(L, -fx.cash); }
    if (fx.priv) E.priv = Math.max(0, E.priv + fx.priv);
    if (fx.debt) E.debt += fx.debt;
    if (fx.land) L.land = Math.max(0, L.land + fx.land);
    if (fx.ox) E.ox = Math.max(0, E.ox + fx.ox);
    if (fx.cls) { L.cls = fx.cls; if (fx.cls !== 'slave' && E.house === 0) E.house = 1500; }
    if (fx.job) L.job = fx.job;
    if (fx.office) { L.office = fx.office; L.officeMax = fx.office === '幕僚' ? (meta.lord || '') + '幕府的掾属' : fx.office; L.job = fx.office; }
    if (fx.noOffice) { L.office = null; L.job = '农'; }
    if (fx.flag) [].concat(fx.flag).forEach(function (f) { L.flags[f] = true; });
    if (fx.tr) for (var t in fx.tr) L.tr[t] = clamp(L.tr[t] + fx.tr[t], 5, 95);
    if (fx.kinLit && meta.kin) meta.kin.lit = true;
    if (fx.kinOut && meta.kin) meta.kin.out = true;
    if (fx.kinDie && meta.kin && meta.kin.alive) kinDie(L, meta.kin, fx.kinDie, s + 0.05, y);
    if (fx.child) {
      var sx = R() < 0.5 ? 'M' : 'F', k = newKin(L, 'child', sx, y, sx === 'M' ? xiaoName(R) : '阿' + givenName(R, 'F'));
      k.lav = R(); k.adopted = true; L.kidsBorn++;
      add(L, s + 0.02, 'fam', '你给孩子取名' + k.name + '。');
    }
    if (fx.marry) { L.spouseK = null; doMarry(L, makeSpouse(L, y), y, s + 0.1); }
    if (fx.move) relocate(L, pick(R, fx.move.filter(function (z) { return z !== L.zone; })), s + 0.2, '你们到了{dest}。', 0.03, y);
    if (fx.die) die(L, fx.die, s + 0.1, { a: cnNum(L.age), n: '先登攻城' });
    L.rec.tags.push('choice');
  }

  /* ================= 传家：以子孙之身继续 ================= */
  function heirOf(L) {
    var kids = L.kin.filter(function (k) { return k.rel === 'child' && k.alive && !k.apart; }).sort(function (a, b) { return a.by - b.by; });
    if (!kids.length || L.cls === 'slave') return null;
    var k = kids.filter(function (x) { return x.sex === 'M'; })[0] || kids[0];
    var sp = L.spouseK && (L.spouseK.alive || L.spouseK.dy >= k.by) ? L.spouseK : L.kin.filter(function (x) { return x.rel === 'spouse'; })[0];
    var sur = L.sex === 'M' ? L.sur : (sp ? sp.name.slice(0, 1) : L.sur);
    var cls = L.cls === 'tribal' ? 'tribal' : (L.office || L.cls === 'gentry') ? (L.cls === 'gentry' ? 'gentry' : 'clerk') : L.cls;
    return {
      year: k.by, jun: L.jun, sex: k.sex, sur: sur, xiao: k.name, cls: cls, eth: L.eth, land: L.land,
      parentSex: L.sex, parentName: L.name, parentBy: L.by, dy: L.dy, cause: L.cause, lit: L.literate,
      otherName: sp ? sp.name : null, otherBy: sp ? sp.by : null, otherDy: sp && !sp.alive ? sp.dy : null, otherCause: sp ? sp.cause : null,
      lineage: (L.lineage || []).concat([{ name: L.name, sex: L.sex, by: L.by, dy: L.dy }]), age: L.dy - k.by
    };
  }

  /* ================= 身后与后记 ================= */
  function afterlife(L) {
    var out = [], z = L.zone, dy = L.dy, n = 0;
    for (var y = dy + 1; y <= dy + 45 && n < 2; y++) {
      (EV_BY_Y[y] || []).forEach(function (ev) {
        var fx = ev.at && ev.at[z];
        if (n >= 2 || !fx || !fx.t || !(fx.war || fx.fam || fx.plag || fx.move || fx.flee || fx.m15 || fx.flood)) return;
        out.push('你死后第' + cnNum(y - dy) + '年（' + y + '），' + fx.t.replace(/。$/, '') + '。');
        n++;
      });
    }
    if (n) out.push(L.kidsBorn ? '你的子孙是否熬过了那些年，没有人记下。' : '那时，已经没有人记得你了。');
    else if (dy < 280) out.push('你所在的地方，此后几十年里没有再遭大的兵祸。这在那个时代，已是难得的福分。');
    return out;
  }
  var REFLECT = {
    infant: '那一年出生的孩子，大约每五个就有一个活不过周岁。他们大多没有留下名字，只在母亲的记忆里活过几个月。',
    child: '史书里的汉末，是群雄的汉末。可对于大多数人家来说，乱世首先意味着：孩子养不大。',
    fam: '史书写饥荒，常常只用三个字："人相食"。在那三个字背后，是千千万万个和你一样的人。',
    plag: '建安年间的疫病，让曹植写下"家家有僵尸之痛"。史书记下了文人的哀叹，没有记下他们身旁成千上万的寻常人家。',
    battle: '史书记战争，用的是"斩首万级""溺死者数万"。你是那个数字里的一个。',
    war: '乱兵过境，史书往往只留下一句"所过残灭"。',
    massacre: '屠城在史书里只占一行字。那一行字里，有你。',
    childbirth: '在那个时代，生育是女子一生中最凶险的关口。史书很少写这件事，因为执笔写史的，不是她们。',
    road: '汉末的户口从五千多万跌到不足千万。消失的人里，有许多就倒在逃难的路上。',
    corv: '城墙、宫殿、驰道，都是像你这样的人一筐土一筐土垒起来的。史书记下了它们的名字，没有记下垒它们的人。',
    executed: '权力更迭的时候，史书记下的是胜负。被牵连的人，只是名单上的一行。'
  };
  function afterword(L) {
    var age = L.dy - L.by, t = [];
    if (REFLECT[L.cause]) t.push(REFLECT[L.cause]);
    else if (age >= 60) t.push('能活到这个年纪的人，在你的同代人里不到十分之一。你看着王朝更替、城头易帜，把这些都藏在了心里。');
    if (L.cls === 'slave') t.push('律令把你和牛马写在同一页簿籍上。可你也有过自己的名字，自己的念想。');
    else if (L.eth) t.push('汉人的户籍里没有你。史书提到你的族人，多半是在"叛""破""徙"这样的字旁边。');
    else if (L.sex === 'F' && L.cause !== 'childbirth') t.push('史书里的女子，多半只留下一个姓氏，写作"某氏"。可你的名字，曾经被家里人叫了很多年。');
    else if (L.moves >= 2 && age >= 15) t.push('你一生几度迁徙。汉末户籍上消失的千万人里，有许多就是像你这样的流民。');
    else if (L.officeMax && age >= 20) t.push('你做过官，名字或许会刻在某块碑上、写进某卷簿书，然后在千年里慢慢风化。');
    else if (age >= 15) t.push('你种出的粮食进了官仓，织出的布帛交了户调，你的名字写在里正的户籍简上。帝王将相的事业，就压在这些简牍上。');
    t.push('《三国志》为数百人立了传。你不在其中——和那个时代的几千万人一样。');
    return t;
  }
  /* ================= 查询 ================= */
  function household(L, y) {
    // 户籍简：返回当前同户之人，第一位为户人（户主）
    var meA = y - L.by;
    var me = { me: true, sex: L.sex, age: meA, name: L.eth ? L.name : L.sur + L.given, injury: L.injury, soldier: !!L.soldier };
    var others = L.kin.filter(function (k) { return k.alive && !k.apart && !k.out && k.by <= y; });
    var f = L.kin[0], m = L.kin[1], sp = L.spouseK, head = null;
    if (L.sex === 'F' && L.married && sp && sp.alive && !sp.apart) head = sp;
    else if (meA < 30 && f.alive && !f.apart && !f.out && !L.split) head = f;
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
    placeText: placeText, focusOptions: focusOptions, setFocus: setFocus, FOCUS: FOCUS, traitWords: traitWords, TALENT: TALENT, ecoView: ecoView,
    spendOptions: spendOptions, spend: spend, heirOf: heirOf, afterlife: afterlife, afterword: afterword, isHead: isHead, autoAnswer: autoAnswer, fmt: fmt, LANDP: LANDP, CAUSE_SHORT: CAUSE_SHORT, CAUSE_STAT: CAUSE_STAT, POP_SCALE: POP_SCALE, stats: stats
  };
})(SGD);
if (typeof module !== 'undefined') module.exports = SGE;
