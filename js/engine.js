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
  // 避免重复：最近十二年用过的句子先不再用
  function fresh(L, pool) {
    var y = L.by + L.age; L.recent = L.recent || {};
    var c = pool.filter(function (t) { return !(L.recent[t] && y - L.recent[t] < 12); });
    if (!c.length) c = pool;
    var t = pick(L.R, c); L.recent[t] = y; return t;
  }
  function cool(L, k, n) { var y = L.by + L.age; L.evCool = L.evCool || {}; if (L.evCool[k] != null && y - L.evCool[k] < n) return false; L.evCool[k] = y; return true; }
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
    if (fk === 'chenghan' || fk === 'hanzhao' || fk === 'houzhao' || fk === 'ranwei') return fk;
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
  /* ---------- 法令：按地点 × 年份 × 统治者 ---------- */
  var POL_C = {};
  function polsAt(z, y) {
    var k = z + y; if (POL_C[k]) return POL_C[k];
    var fk = ctrl(z, y);
    return (POL_C[k] = (D.POLICIES || []).filter(function (p) { return y >= p.y[0] && y <= p.y[1] && (!p.f || p.f.indexOf(fk) >= 0) && (!p.zones || p.zones.indexOf(z) >= 0); }));
  }
  function polMul(z, y, key) { var m = 1; polsAt(z, y).forEach(function (p) { if (p.fx[key] != null) m *= p.fx[key]; }); return m; }
  function polSum(z, y, key) { var m = 0; polsAt(z, y).forEach(function (p) { if (p.fx[key]) m += p.fx[key]; }); return m; }
  /* ---------- 本郡情形：治安、粮价、流民 ---------- */
  // 这一年本地的史实压力（不含随机事件），也用来估计别处的情形
  function regPressure(z, y) {
    var fk = ctrl(z, y), g = group(fk), P = { war: 0, fam: 0, out: 0, inflow: 0 };
    (EV_BY_Y[y] || []).forEach(function (ev) {
      var fx = ev.at && ev.at[z];
      if (!fx && ev.all && (!ev.all.g || ev.all.g.indexOf(g) >= 0)) fx = ev.all;
      if (fx) { P.war += fx.war || 0; P.fam += fx.fam || 0; P.out += (fx.flee || 0) + (fx.move || 0); }
      if (ev.at) Object.keys(ev.at).forEach(function (z2) {
        var f2 = ev.at[z2];
        if (z2 !== z && f2.to && f2.to.indexOf(z) >= 0) P.inflow += ((f2.flee || 0) + (f2.move || 0)) * Math.min(3, zonePop(z2, y) / Math.max(1, zonePop(z, y)));
      });
    });
    var t = 74 - (chaos(y) - 1) * 70 - P.war * 900 - P.fam * 250 - (LOOSE[fk] ? 15 : 0) + (ctrl(z, y - 1) !== fk ? -12 : 0);
    polsAt(z, y).forEach(function (p) { t += { shuke: 8, dongzhou: -12, yuanshu: -10, sunhao: -6, zhanglu: 4, shixie: 6, liubiao: 6, xiaoshi: 2, babing: 3 }[p.id] || 0; });
    P.order = clamp(t, 5, 95);
    P.price = Math.min(8, (1 + P.fam * 50) * (1 + P.war * 15) * (1 + (chaos(y) - 1) * 0.6));
    return P;
  }
  function orderLabel(v) { return v >= 75 ? '安定' : v >= 58 ? '尚可' : v >= 42 ? '不靖' : v >= 28 ? '盗贼横行' : '大乱'; }
  function refLabel(v, out) { return out >= 0.1 ? '外逃者众' : v >= 10 ? '流民塞路' : v >= 5 ? '流民颇多' : v >= 2 ? '时有流民' : '少见'; }
  function junPop(L, y) { var j = D.JUN[L.jun]; return j[2] * zonePop(L.zone, y) / Math.max(1, zonePop(L.zone, 157)); }
  function regionYear(L, y) {
    var R = L.R, z = L.zone, P = regPressure(z, y);
    if (!L.reg || L.reg.z !== z) L.reg = { z: z, order: P.order, price: P.price, ref: 0, out: 0, note: '' };
    var G = L.reg;
    G.order = clamp(G.order + (P.order - G.order) * 0.45 + (R() - 0.5) * 6, 5, 95);
    // 流民：周边战乱、灾荒逃来的人；乱世里相对太平的地方更会涌来
    var calm = P.war < 0.004 && P.fam < 0.01 ? 1 : 0.3;
    G.ref = clamp(G.ref * 0.6 + P.inflow * 120 + P.fam * 150 + (chaos(y) - 1) * 12 * calm * (0.6 + R() * 0.8), 0, 40);
    G.out = P.out;
    var pt = P.price * (1 + Math.min(G.ref, 30) / 60) * (0.92 + R() * 0.16);
    G.price = clamp(G.price * 0.45 + pt * 0.55, 0.6, 8);
    G.note = '';
    // 地方上的事（以史实为本）
    if (!L.eth && R() < 0.3) {
      var fk = ctrl(z, y), gk = group(fk);
      var pool = (D.REG_EV || []).filter(function (e) {
        return (!e.zones || e.zones.indexOf(z) >= 0) && (!e.y || (y >= e.y[0] && y <= e.y[1])) && (!e.f || e.f.indexOf(fk) >= 0) && (!e.g || e.g.indexOf(gk) >= 0) && (!e.notF || e.notF.indexOf(fk) < 0) &&
          (e.oLt == null || G.order < e.oLt) && (e.pGt == null || G.price > e.pGt) && (e.rGt == null || G.ref > e.rGt) && !(L.regSeen && L.regSeen[e.id] && y - L.regSeen[e.id] < 6);
      });
      if (pool.length) {
        var e = wpick(R, pool, function (x) { return x.w; }), f = e.fx;
        (L.regSeen = L.regSeen || {})[e.id] = y;
        if (f.order) G.order = clamp(G.order + f.order, 5, 95);
        if (f.price) G.price = clamp(G.price * f.price, 0.6, 8);
        if (f.ref) G.ref *= f.ref;
        if (f.refAdd) G.ref = clamp(G.ref + f.refAdd, 0, 40);
        G.note = e.t;
        if (L.age >= 6) add(L, 0.9, 'hist', e.t);
      }
    }
    (L.regHist = L.regHist || []).push({ y: y, z: z, order: Math.round(G.order), price: +G.price.toFixed(2), ref: +G.ref.toFixed(1), out: G.out });
    if (L.regHist.length > 140) L.regHist.shift();
  }
  function regionView(L, y) {
    var RH = L.regHist || [];
    if (!RH.length) return null;
    var h = RH.filter(function (x) { return x.y === y; })[0] || RH[RH.length - 1];
    var prev = RH.filter(function (x) { return x.y === y - 1 && x.z === h.z; })[0];
    var pop = junPop(L, y), refN = Math.round(h.ref / 100 * pop * 10000 / 100) * 100;
    var G = L.reg || {};
    return { jun: D.JUN[L.jun][0], ruler: fname(ctrl(h.z, y), y), pop: pop, order: h.order, orderL: orderLabel(h.order), price: Math.round(PRICE * h.price),
      trend: prev ? (h.price > prev.price * 1.08 ? 'up' : h.price < prev.price * 0.92 ? 'down' : 'flat') : 'flat', ref: h.ref, refN: refN, refL: refLabel(h.ref, h.out), out: h.out, note: y === L.by + L.age - (L.alive ? 1 : 0) ? G.note : '' };
  }
  // 抉择时可参考的两地情形
  function compareText(L, y, dest) {
    var G = L.reg, here = G ? { order: G.order, price: G.price, ref: G.ref } : regPressure(L.zone, y), P = regPressure(dest, y);
    var refD = P.inflow * 30;
    return '眼下本郡：治安' + orderLabel(here.order) + '，粮价每石约' + fmt(Math.round(PRICE * here.price)) + '钱，流民' + refLabel(here.ref, 0) + '。' +
      '听说' + zname(dest) + '：治安' + orderLabel(P.order) + '，粮价每石约' + fmt(Math.round(PRICE * P.price)) + '钱' + (refD >= 5 ? '，逃去的人已经很多了' : '') + '。';
  }

  // 前因后果：城池易手前先有军报；在任者随军务奔忙
  function foreshadow(L, y, fk) {
    var R = L.R, a = L.age, nfk = ctrl(L.zone, y + 1), zl = D.ZONES[L.zone].label;
    if (a >= 8 && !L.band && !L.eth && nfk !== fk && !SUCC[fk + '>' + nfk]) {
      var nn = lordName(nfk, y);
      if (L.office) add(L, 0.7, 'war', '你在' + L.office + '任上，案头的军报一天比一天急：' + nn + '的兵马正向' + zl + '逼近。官署里已经有人在悄悄收拾细软。');
      else if (L.cls === 'gentry' && a >= 12) add(L, 0.7, 'war', '族中得到消息：' + nn + '的兵马正向' + zl + '逼近。长辈们关起门来，一连商量了好几夜。');
      else if (!L.soldier && R() < 0.65) add(L, 0.7, 'rumor', pick(R, ['听说' + nn + '的兵马要打过来了。乡里有人开始往山里藏粮。', '路上逃难的人多了起来，都说' + nn + '的大军就在后面。', '县里贴出告示，要百姓加紧修城、交粮——听说是' + nn + '要来了。']));
    }
    if (L.office && !L.soldier && a >= 16) {
      var g = armyOf(fk), cs = (CAMP_BY_Y[y] || []).filter(function (c) { return c.a.indexOf(g) >= 0 || c.a.indexOf(fk) >= 0; });
      if (cs.length && R() < 0.7) {
        var c = pick(R, cs);
        add(L, 1.6, 'war', '为了' + c.n + '，' + (L.office === '幕僚' ? '幕府' : '官署') + '里日夜忙碌。你在' + L.office + '任上' + pick(R, ['筹措军粮、征发民夫', '核算军需、清点仓廪', '起草檄文、传递军书', '安置伤兵、抚恤阵亡者的家属']) + '，好几个月没有回家。');
      }
    }
  }
  function lawYear(L, y) {
    var R = L.R, a = L.age, seen = L.lawSeen = L.lawSeen || {}, E = L.eco;
    if (L.eth) return;
    polsAt(L.zone, y).forEach(function (p) {
      if (seen[p.id]) return;
      seen[p.id] = y;
      if (a === 0) return;
      add(L, 0.6, 'law', y === p.y[0] ? p.t : '你所在的地方，行的是「' + p.n + '」：' + p.s + '。');
      if (p.fx.cashLoss && E && L.cls !== 'slave' && E.cash + E.priv >= 300) {
        var lost = Math.round((E.cash + E.priv) * p.fx.cashLoss);
        E.cash = Math.round(E.cash * (1 - p.fx.cashLoss)); E.priv = Math.round(E.priv * (1 - p.fx.cashLoss));
        add(L, 0.65, 'bad', '你家攒下的钱，一下子贬了' + Math.round(p.fx.cashLoss * 10) + '成，折合约' + fmt(lost) + '钱值。');
      }
      if (p.fx.landGrant && (L.cls === 'peasant' || L.cls === 'tuntian') && isHead(L) && L.land < 30 && R() < 0.35) {
        var g = 10 + Math.round(R() * 10);
        L.land += g; if (L.cls === 'tuntian') { L.cls = 'peasant'; L.job = '农'; }
        add(L, 0.65, 'good', '你家按新法在荒地上占了' + cnNum(g) + '亩田，登记在了户籍上。');
      }
    });
    var risk = polSum(L.zone, y, 'officeRisk');
    if (risk && L.office && L.alive && R() < risk) {
      add(L, 1.3, 'bad', pick(R, ['有人向上告发你"诽谤朝政"。你被收捕下狱，审了几个月。', '校事说你经手的文书有毛病，你被下了狱。']));
      if (R() < 0.15) { die(L, 'executed', 1.35, { full: '狱吏拷问你与谁同谋，你说不出来，最后死在了狱中。' }); return; }
      L.office = null; L.job = L.cls === 'gentry' ? '士人' : '农'; L.fame -= 4;
      add(L, 1.35, 'life', '后来虽被放了出来，官是丢了。');
    }
    var lb = polSum(L.zone, y, 'learn');
    if (lb && L.literate && a >= 8 && a <= 50) L.learn += lb;
  }

  function chaos(y) { return y < 184 ? 1 : y <= 207 ? 1.2 : y <= 219 ? 1.08 : y <= 290 ? 1 : y <= 316 ? 1.2 : 1.08; }
  var CLS_Q = { gentry: 0.68, merchant: 0.9, clerk: 0.86, slave: 1.3, tenant: 1.07, tribal: 1.08, tuntian: 1.05 };

  /* ================= 姓名 ================= */
  function surname(R, cls) {
    if (cls === 'gentry' && R() < 0.06) return pick(R, D.SURNAMES2);
    var arr = D.SURNAMES;
    var i = Math.floor(Math.pow(R(), 1.7) * arr.length); // 越靠前越常见
    return arr[i];
  }
  function tierOf(cls) { return cls === 'gentry' || cls === 'clerk' ? 'elite' : cls === 'slave' ? 'slave' : cls === 'merchant' ? null : 'plain'; }
  function givenName(R, sex, tier) {
    if (tier === 'elite' && R() < 0.65) return pick(R, sex === 'M' ? D.MALE_ELITE : D.FEMALE_ELITE);
    if (tier === 'slave') return sex === 'M' ? pick(R, D.SLAVE_M).slice(-1) : pick(R, D.SLAVE_F).slice(-1);
    if (tier === 'plain' && R() < 0.55) return pick(R, sex === 'M' ? D.MALE_PLAIN : D.FEMALE_PLAIN);
    return pick(R, sex === 'M' ? D.MALE : D.FEMALE);
  }
  function xiaoName(R, tier) { return '阿' + pick(R, tier === 'elite' ? D.XIAO_ELITE : tier === 'plain' && R() < 0.6 ? D.XIAO_PLAIN : D.XIAO); }
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
    else if (mode === 'blind') { lo = 150; hi = 300; }
    else if (mode === 'yongjia') { lo = 296; hi = 310; }
    else if (mode === 'xiping') { lo = 168; hi = 178; }
    else if (mode === 'sanguo') { lo = 220; hi = 232; }
    else if (mode === 'weijin') { lo = 245; hi = 262; }
    else if (mode === 'taikang') { lo = 266; hi = 280; }
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
    var JM = { army: { soldier: 3, tenant: 1.2 }, civil: { clerk: 2.5 }, biz: { merchant: 3 }, craft: { artisan: 3 }, farm: { peasant: 1.6, tuntian: 1.5 }, edu: { clerk: 1.6, gentry: 1.3 } }[opts.mjob];
    if (JM) for (k in JM) w[k] *= JM[k];
    var keys = Object.keys(w);
    return wpick(R, keys, function (k) { return w[k]; });
  }

  function newKin(L, rel, sex, by, name, extra) {
    var k = { id: L.kin.length, rel: rel, sex: sex, by: by, name: name, xiao: (rel === 'child' || rel === 'sib') ? name : null, alive: true, dy: null, cause: null, apart: false, out: false, soldier: null };
    if (extra) for (var p in extra) k[p] = extra[p];
    if (L.tr) k.aff = kinAffInit(L, k);
    if (rel === 'spouse' && L.cls) k.job = jobFor(L, k);
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
    L.by = opts.year != null ? opts.year : pickYear(R, opts.era || L.mode);
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
    else { L.sur = surname(R, L.cls); L.given = givenName(R, L.sex, tierOf(L.cls)); }
    if (L.cls === 'slave' && !L.eth) L.given = pick(R, L.sex === 'M' ? D.SLAVE_M : D.SLAVE_F);
    L.xiao = L.sex === 'F' ? '阿' + L.given.slice(-1) : xiaoName(R, tierOf(L.cls));
    if (HR) { L.sur = HR.sur; L.xiao = HR.xiao; if (HR.given) L.given = HR.given; else if (L.sex === 'F') L.given = HR.xiao.slice(-1); if (HR.zi) L.zi = HR.zi; }
    L.name = L.sur + L.given;

    // 属性
    L.body = Math.round(clamp(30 + R() * 45 + (L.cls === 'gentry' ? 6 : 0) + (L.cls === 'slave' ? -6 : 0), 15, 90));
    L.wealth = Math.round(C.wealth[0] + R() * (C.wealth[1] - C.wealth[0]));
    L.land = Math.round(C.land[0] + R() * (C.land[1] - C.land[0]));
    if (L.cls === 'gentry') L.land = Math.round(L.land / 50) * 50;
    if (L.land < 5) L.land = 0;
    L.learn = 0; L.fame = 0; L.craft = 0;
    L.tr = {}; ['cur', 'cau', 'act', 'per', 'soc', 'ind', 'cmp'].forEach(function (k) { L.tr[k] = Math.round(clamp(50 + (R() + R() + R() - 1.5) * 24, 15, 85)); });
    L.tal = { craft: R() * 0.3, memory: R() * 0.3, strength: R() * 0.3, charm: R() * 0.3 };
    if (opts.mtr) for (var mk in opts.mtr) L.tr[mk] = clamp(L.tr[mk] + opts.mtr[mk], 5, 95);
    if (opts.mtal) for (var mt in opts.mtal) L.tal[mt] = clamp(L.tal[mt] + opts.mtal[mt], 0, 1);
    if (opts.mbody) L.body = clamp(L.body + opts.mbody, 10, 95);
    L.flags = L.flags || {};
    if (opts.mflag) L.flags[opts.mflag] = true;
    L.found = {}; L.focusManual = null; L.lastFocus = null; L.focusYears = 0; L.spendLog = []; L.crisis = false;
    var ST = { gentry: [60, 80], clerk: [40, 55], merchant: [28, 45], peasant: [25, 45], tenant: [15, 30], slave: [3, 12], tribal: [25, 45], tuntian: [18, 32], soldier: [20, 35], artisan: [25, 40] }[L.cls];
    L.standing = Math.round(ST[0] + R() * (ST[1] - ST[0]));
    L.gate = L.cls === 'gentry' ? (R() < 0.3 ? 3 : 2) : L.cls === 'clerk' ? 1 : 0;
    if (HR && HR.gate != null) L.gate = HR.gate;
    if (L.cls === 'gentry') {
      L.clanName = D.JUN[L.jun][0].replace(/(郡|国|尹)$/, '') + L.sur + '氏';
      L.gateName = L.gate >= 3 ? '世代二千石的高门' : '郡中著姓';
      if (L.gate >= 3) L.standing = Math.min(95, L.standing + 10);
    }
    L.clan = 1 + Math.floor(R() * (L.cls === 'gentry' ? 5 : 3));

    // 父母
    var fAge = L.cls === 'gentry' ? 20 + Math.floor(R() * 20) : 18 + Math.floor(R() * 20);
    var mAge = 15 + Math.floor(R() * Math.min(20, fAge - 13));
    var fn = L.eth ? ethName(R, L.eth) : { sur: L.sur, given: givenName(R, 'M', tierOf(L.cls)) };
    while (!L.eth && fn.given === L.given) fn.given = givenName(R, 'M', tierOf(L.cls));
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
      var sb = newKin(L, 'sib', sx, L.by - (births - i) * 2 - Math.floor(R() * 2), sx === 'M' ? xiaoName(R) : '阿' + givenName(R, 'F'), { sur: L.sur });
      if (eliteFam(L) || (L.by - sb.by >= 7 && (sx === 'M' || R() < 0.5))) giveName(L, sb);
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
    L.friends = [];
    L.kin.forEach(function (k) { k.aff = kinAffInit(L, k); if (k.rel !== 'gp' && (k.rel !== 'sib' || L.by - k.by >= 15)) k.job = jobFor(L, k); });
    if (HR && HR.land != null) L.land = HR.land;
    L.eco = initEco(L);
    if (L.gate >= 3) { L.eco.cash *= 2; L.land = Math.max(L.land, 1500); }
    L.lineage = HR ? HR.lineage : [];
    L.wealth = wealthScore(L);
    L.places.push(L.zone);
    L.regimes.push(ctrl(L.zone, L.by));
    L.job = null;
    return L;
  }

  // 名与字：小名在家里叫，大名入户籍，表字在冠礼（女子笄礼）时取
  function freshXiao(L, sex) {
    var used = L.kin.map(function (k) { return k.xiao; }).concat([L.xiao]), R = L.R, t = 0, x;
    do { x = sex === 'M' ? xiaoName(R, tierOf(L.cls)) : '阿' + givenName(R, 'F', tierOf(L.cls)); } while (used.indexOf(x) >= 0 && t++ < 10);
    return x;
  }
  function eliteFam(L) { return !L.eth && (L.cls === 'gentry' || L.cls === 'clerk' || L.cls === 'merchant'); }
  function kidSur(L, rel) {
    if (rel === 'sib') return L.sur;
    return L.sex === 'M' ? L.sur : (L.spouseK && L.spouseK.sur != null ? L.spouseK.sur : L.sur);
  }
  function giveName(L, k) {
    var R = L.R;
    if (L.eth && !D.ETH[L.eth].sur) { k.full = ethName(R, L.eth).given; k.name = k.full; return; }
    var used = [L.given].concat(L.kin.map(function (x) { return x.given || (x.name || '').slice(-1); }));
    var tr = tierOf(L.cls), g = givenName(R, k.sex, tr), tries = 0;
    while (used.indexOf(g) >= 0 && tries++ < 8) g = givenName(R, k.sex, tr);
    if (k.sex === 'M' && R() < (tr === 'elite' ? 0.2 : 0.08)) g += pick(R, tr === 'elite' ? D.MALE_ELITE : D.MALE);
    k.sur = k.sur != null ? k.sur : '';
    k.full = k.sur + g; k.given = g; k.name = k.full;
  }
  var ZI_F1 = ['文', '惠', '令', '淑', '季', '少', '孟', '仲', '幼', '德'], ZI_F2 = ['姬', '华', '容', '英', '君', '姜', '仪', '贞'];
  function giveZi(L, sex) { var R = L.R; return sex === 'M' ? pick(R, D.ZI_HEAD) + pick(R, D.MALE) : pick(R, ZI_F1) + pick(R, ZI_F2); }
  function setPlace(L, ji) {
    var j = D.JUN[ji], R = L.R;
    L.junHist = L.junHist || [];
    if (L.junHist.indexOf(ji) < 0) L.junHist.push(ji);
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
  // 称呼随居住地而变：同一个人，魏人、蜀人、吴人各有各的叫法
  function nameFor(L, key, y) {
    var fk = ctrl(L.zone, y), g = group(fk);
    switch (key) {
      case '曹操': if (g === 'wei' && y >= 196) return y >= 220 ? '武皇帝' : y >= 216 ? '魏王' : y >= 213 ? '魏公' : '曹公'; return y >= 196 && y < 213 ? '曹公' : '曹操';
      case '曹丕': if (g === 'wei' || g === 'jin') return y >= 227 ? '文皇帝' : y >= 220 ? '今上' : y >= 217 ? '魏太子曹丕' : '五官中郎将曹丕'; return '曹丕';
      case '刘备': if (g === 'shu' || fk === 'liubei') return y >= 223 ? '先帝' : y >= 221 ? '今上' : y >= 219 ? '汉中王' : '刘使君'; return '刘备';
      case '孙权': if (g === 'wu' || fk === 'sunquan') return y >= 252 ? '大皇帝' : y >= 229 ? '至尊' : y >= 221 ? '吴王' : '孙将军'; return '孙权';
      case '诸葛亮': if (g === 'shu') return y >= 234 ? '诸葛丞相' : y >= 221 ? '丞相' : '诸葛军师'; return '诸葛亮';
      case '司马懿': if (g === 'jin') return '宣皇帝'; if (g === 'wei' && y >= 239) return '太傅'; return '司马懿';
      case '汉帝': if (g === 'wei' && y >= 220) return '山阳公'; if (g === 'shu' && y >= 220) return '孝愍皇帝'; return '天子';
      case '刘禅': if (g === 'shu' && y < 264) return '今上'; return y >= 264 ? '安乐公刘禅' : '后主刘禅';
      case '孙皓': if (g === 'wu' && y < 280) return '主上'; return y >= 280 ? '归命侯孙皓' : '吴主孙皓';
    }
    return key;
  }
  function nameFill(L, t) { return t.indexOf('{') < 0 ? t : t.replace(/\{(曹操|曹丕|刘备|孙权|诸葛亮|司马懿|汉帝|刘禅|孙皓)\}/g, function (m, k) { return nameFor(L, k, L.by + L.age); }); }
  function eliteView(L) { return L.cls === 'gentry' || L.cls === 'clerk' || !!L.office || L.learn >= 40; }
  function add(L, s, k, t) {
    if (!L.alive && k !== 'death') return null;
    if (t) t = nameFill(L, t);
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
  var PURGE_TIES = ['的岳父是{pn}的门生', '曾受{pn}举荐为官', '的族兄在{pn}府中任职', '曾在{pn}的宴席上赋诗唱和', '家与{pn}家是姻亲'];
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
    executed: ['你被卷入一场案子，下狱后被处死。'],
    childbirth: ['你生下孩子后血崩不止，死于难产。'],
    road: ['你倒在了逃难的路上。']
  };
  var CAUSE_SHORT = { fade: '不知所终', executed: '被诛', infant: '夭折', child: '夭折', ill: '病故', old: '寿终', tiger: '虎患', drown: '溺水', fall: '意外', bandit: '盗贼', plag: '疫病', fam: '饥荒', war: '兵祸', flood: '水灾', corv: '劳役', battle: '战死', massacre: '屠城', executed: '株连', childbirth: '难产', road: '死于逃难' };
  var CAUSE_STAT = { fade: '不知所终', infant: '夭折', child: '夭折', ill: '疾病', old: '寿终', tiger: '意外', drown: '意外', fall: '意外', bandit: '兵祸盗贼', plag: '疫病', fam: '饥荒', war: '兵祸盗贼', flood: '意外', corv: '劳役', battle: '战死', massacre: '兵祸盗贼', executed: '株连', childbirth: '难产', road: '饥荒' };

  function die(L, cause, s, map) {
    if (!L.alive) return;
    // 宽限：玩家本人在幼年多半能挺过来（同时辰者与统计仍按史实）
    var spare = !L.auto && !L.opts.harsh ? (L.age < 5 ? 0.72 : L.age < 15 ? 0.45 : 0) : 0;
    if (spare && L.R() < spare && cause !== 'battle' && cause !== 'executed') {
      L.body = clamp(L.body - 4, 5, 100);
      add(L, s, 'bad', fresh(L, L.age < 5 ? ['你病得几乎没了气息，母亲抱着你守了三天三夜，你竟活了过来。', '你高烧不退，家里连小棺材都备下了。第四天早上，你睁开了眼睛。', '你那一回差点没挺过去。祖母说，是祖宗保佑。', '你病了一场，瘦得只剩一把骨头，到底还是熬过来了。'] : ['你病得很重，家里请了巫祝，又熬了草药。你命大，挺了过来。', '那一年你差点死了。后来大人们说起来，都说你是捡回来的一条命。']));
      return;
    }
    if (L.opts.surviveUntil && L.rec.y <= L.opts.surviveUntil) {
      if (!L.rec.spared) { L.rec.spared = true; L.body = clamp(L.body - 6, 5, 100); add(L, s, 'bad', '你大病一场，险些丧命，终究挺了过来。'); }
      return;
    }
    var pool = DEATH[cause];
    if ((cause === 'ill' || cause === 'child') && D.REGION && D.REGION[L.zone] && D.REGION[L.zone].ill >= 1.15 && L.R() < 0.5) pool = cause === 'ill' ? ['你染上了瘴疠，寒热交作，一个月后便去世了。'] : ['你染上了瘴疠，高烧不退，年仅{a}岁。'];
    var t = map && map.full ? map.full : fill(pick(L.R, pool), map || { a: L.age });
    var e = add(L, s, 'death', t);
    L.alive = false; L.cause = cause; L.causeText = t; L.deathS = s; L.deathI = e.i; L.dy = L.rec.y;
    L.rec.death = true;
  }

  function kinDie(L, k, cause, s, y, extra) {
    if (!k.alive) return;
    k.alive = false; k.dy = y; k.cause = cause;
    if (k.apart) return;
    if (k.rel === 'father' && L.sex === 'F' && !L.married && L.age >= 8 && L.cls !== 'slave' && L.land > 0 && L.kin.some(function (x) { return x.rel === 'sib' && x.sex === 'M' && x.alive; }))
      add(L, (s || 2) + 0.3, 'life', '父亲死后，家里的田产都归了兄弟。按规矩，女儿只能分到一份嫁妆。');
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
    if (k.rel === 'father' || k.rel === 'mother') { L.parentDied = y; L.parentDiedName = relName(L, k); }
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
    if (m.off && !L.office) return false;
    if (m.sol && !(L.soldier && (m.sol === true || L.soldier.army === m.sol))) return false;
    if (!m.sol && m.q && L.soldier && !m.off) return false;
    if (m.cls && m.cls.indexOf(L.cls) < 0) return false;
    if (m.fac && group(ctrl(L.zone, y)) !== m.fac) return false;
    return true;
  }

  // 地位越高，越可能见到名人
  var OFF_RANK = { 书佐: 1.3, 计吏: 1.5, 县长: 1.8, 幕僚: 2.2, 郎官: 2.2, 尚书郎: 2.6, 县令: 2.3, 郡守: 3.4, 刺史: 4.2, 九卿: 4.8 };
  function statusMul(L) {
    var m = { gentry: 5, clerk: 3, merchant: 1.6, slave: 0.3, tenant: 0.6, tribal: 0.6, tuntian: 0.6, soldier: 0.7 }[L.cls] || 0.8;
    if (L.cls === 'gentry') m *= L.gate >= 3 ? 1.8 : L.gate >= 2 ? 1.3 : 1;
    if (L.office) m *= OFF_RANK[L.office] || 2;
    if (L.mil) m *= 1 + L.mil * 0.4;
    if (L.literate) m *= 1.3;
    if (L.flags.salon) m *= 1.4;
    if (L.flags.connected || L.flags.retainers) m *= 1.15;
    return m * (1 + L.fame / 50);
  }
  // 同席交游：高门、大官、名士之家，常在宴会、拜访、雅集中结识当时当地的人物
  var FIG_AT = null;
  function figPresence() {
    if (FIG_AT) return FIG_AT;
    FIG_AT = {};
    D.MEETS.forEach(function (m) { if (m.eth || m.sol || m.cls) return; (FIG_AT[m.f] = FIG_AT[m.f] || []).push(m); });
    return FIG_AT;
  }
  var CIRCLE_P = { 书佐: 0.01, 计吏: 0.02, 县长: 0.025, 幕僚: 0.07, 郎官: 0.06, 尚书郎: 0.08, 县令: 0.045, 郡守: 0.09, 刺史: 0.13, 九卿: 0.13 };
  function eliteMeet(L, y) {
    var R = L.R, a = L.age;
    if (a < 12 || L.eth || L.cls === 'slave' || L.band || !L.alive) return;
    var p = 0;
    if (L.cls === 'gentry') p = L.gate >= 3 ? 0.2 : L.gate >= 2 ? 0.12 : 0.05;
    if (L.office) p = Math.max(p, CIRCLE_P[L.office] || 0.03);
    if (L.mil >= 2) p = Math.max(p, L.mil * 0.025);
    if (L.cls === 'merchant' && L.wealth >= 60) p = Math.max(p, 0.015);
    if (L.fame >= 40) p = Math.max(p, 0.03);
    if (L.lastFocus === 'travel' && L.literate) p = Math.max(p, 0.05) * 1.5;
    if (!p) return;
    p *= (1 + L.fame / 80) * (L.flags.salon ? 1.6 : 1) * (L.flags.connected || L.flags.retainers ? 1.2 : 1) * (a < 16 ? 0.5 : 1) * (L.sex === 'F' ? 0.5 : 1);
    if (R() >= Math.min(0.4, p)) return;
    var fk = ctrl(L.zone, y), cands = [], FA = figPresence(), gk = group(fk);
    // 高门与大官的交游不限于本郡：同一政权治下、当时在世的人物都可能同席
    var wide = (L.cls === 'gentry' && L.gate >= 2) || (OFF_RANK[L.office] || 0) >= 2.2 || L.fame >= 50 || L.lastFocus === 'travel';
    var lf = lordFigAt(fk, y);
    if (lf && !L.met[lf] && (L.office || L.cls === 'gentry' || L.fame >= 30)) cands.push({ id: lf, lord: true });
    Object.keys(FA).forEach(function (id) {
      if (L.met[id] || id === lf) return;
      if (FA[id].some(function (m) { return y >= m.y[0] && y <= m.y[1] && (m.zones.indexOf(L.zone) >= 0 || (wide && !m.q && group(ctrl(m.zones[0], y)) === gk)); })) cands.push({ id: id });
    });
    if (!cands.length) return;
    var c = pick(R, cands), fig = D.FIGURES.filter(function (f) { return f.id === c.id; })[0];
    if (!fig) return;
    var who = a < 18 && L.kin[0] && L.kin[0].alive && !L.kin[0].apart ? '父亲' : null, t;
    if (c.lord) t = pick(R, [fig.n + '巡视本郡，郡中设宴相迎，你也在座。', fig.n + '召见郡中的士人和属吏，你也在其中。']) + '你第一次在近处见到他。' + (LORD_LOOK[c.id] || '');
    else t = pick(R, ['郡中大族设宴，你也在座。', '太守在府中宴请郡中士人，你也在受邀之列。', '你' + (who ? '随' + who : '') + '去一位名士家中拜访，座中另有客人。', '一次清谈雅集上，你和几位名士同席。']) + '席间有一位客人引人注目——' + fig.n + '，' + fig.d + '。' + (LORD_LOOK[c.id] || '');
    add(L, 2.2, 'meet', t);
    markMet(L, c.id, y, '你曾与' + fig.n + (c.lord ? '有过一面之缘' : '同席') + '。');
    L.rec.tags.push('meet');
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
          if (L.cls === 'gentry' || L.wealth >= 65) P.queue.push({ key: 'flee', ev: ev.id, dest: dest, rich: true, info: compareText(L, y, dest), q: (fx.t || ev.w) + ' 族中正商议去留。', o: ['带上细软，乘车逃往' + zname(dest), '闭门据守坞壁', '听天由命'], w: [3, 3, 1] });
          else P.queue.push({ key: 'flee', ev: ev.id, dest: dest, info: compareText(L, y, dest), q: (fx.t || ev.w) + ' 乡里已经有人开始收拾行装。', o: ['举家逃往' + zname(dest), '留守故土'], auto: Math.min(0.95, fx.flee * 2.2) });
        }
      }
      // 株连：先有牵连，才有祸事
      if (fx.purge && (L.cls === 'gentry' || L.office) && a >= 15 && !L.soldier) {
        var prisk = fx.purge * (L.office ? 2.5 : 1) * (L.gate >= 3 ? 2 : 1);
        if (R() < Math.min(0.7, prisk * 3)) {
          var pn = fx.pn || '失势的一方', tie = pick(R, PURGE_TIES).replace(/\{pn\}/g, pn);
          P.queue.push({ key: 'purge', ev: ev.id, tie: tie, pn: pn, q: (fx.t || ev.w) + ' 朝廷穷治' + pn + '的党羽。你' + tie + '，这件事不少人都知道。有人劝你早作打算。',
            o: ['连夜出逃，投奔外郡', '闭门待罪', '上书自陈清白，揭发旧交'], w: [1 + (L.tr.act - 50) / 30, 1 + (L.tr.per - 50) / 30, Math.max(0.2, 0.6 + (L.tr.cmp - L.tr.soc) / 40)] });
        }
      }
      if (fx.join && L.sex === 'M' && a >= 15 && a <= 45 && free && ['peasant', 'tenant', 'tuntian'].indexOf(L.cls) >= 0) {
        if (R() < fx.join * (L.flags.taiping ? 2 : 1)) P.queue.push({ key: 'join', q: '太平道的人在村口聚集，头裹黄巾，喊着"黄天当立"。有人拉你一起去。', o: ['头裹黄巾，随他们起事', '闭门不出'], auto: L.flags.taiping ? 0.6 : 0.25 });
      }
      if (fx.tt && a >= 16 && free && (L.cls === 'peasant' || L.cls === 'tenant') && L.land < 15) {
        if (R() < fx.tt) P.queue.push({ key: 'tt', q: '官府招募流民屯田，给田给牛，收成官六民四；只是入了屯，便不能随意离开。', o: ['应募屯田', '不去'], auto: 0.5 });
      }
    });
    // 城头易帜：在任者与士人要表态
    if (y > L.by && free && a >= 16 && L.sex === 'M' && !L.eth && (L.office || (L.cls === 'gentry' && a >= 18))) {
      var ofk = ctrl(z, y - 1), nfk = ctrl(z, y);
      if (ofk !== nfk && !SUCC[ofk + '>' + nfk]) {
        var dz = Object.keys(D.CTRL).filter(function (zz) { return zz !== z && ctrl(zz, y) === ofk; });
        var on = oldLordDesc(z, ofk, y), nn = lordName(nfk, y), loose = !!LOOSE[ofk];
        var rc = { key: 'regime', ofk: ofk, nfk: nfk, on: on, nn: nn, dest: dz.length && !loose && ofk !== 'han' ? pick(R, dz) : null };
        if (L.office) {
          rc.q = D.ZONES[z].zhou + '易手了：' + (loose ? '盘踞此地的' + on + '被赶走，城头' : on + '的旗号从城头撤下，') + '换上了' + nn + '的旗号。你原是' + (loose ? '郡府' : on + '治下') + '的' + L.office + '，' + nn + '派来的使者已经到了门口。';
          rc.o = ['开门出迎，献上户籍簿书', '挂印而去，回乡闭门'];
          rc.w = [5 + (L.tr.cau - 50) / 10, 1.5 + (L.tr.per - 50) / 20];
          if (rc.dest) { rc.o.push('追随旧主，投奔' + zname(rc.dest)); rc.w.push(0.8 + (L.tr.ind - 50) / 25); }
        } else {
          rc.q = D.ZONES[z].zhou + '换了主人，' + nn + '的人在郡中访求名士，你家也收到了一封书信。';
          rc.o = ['投书新主，求一个出身', '闭门谢客，观望一阵'];
          rc.w = [2 + (L.tr.ind - 50) / 20, 2 + (L.tr.cau - 50) / 20];
        }
        rc.w = rc.w.map(function (x) { return Math.max(0.2, x); });
        P.queue.push(rc);
      }
    }
    // 月旦评与相人
    if (!L.appraised && a >= 12 && a <= 55 && free && !L.eth) {
      D.APPRAISERS.forEach(function (ap) {
        if (L.apQ || y < ap.y[0] || y > ap.y[1] || ap.zones.indexOf(z) < 0) return;
        if (ap.jun && ap.jun.indexOf(D.JUN[L.jun][0]) < 0) return;
        var ping = ap.kind === 'ping';
        if (ping && !(isElite(L) || L.learn >= 30 || L.fame >= 12)) return;
        if (ping && L.sex === 'F' && L.cls !== 'gentry') return;
        var p = (ping ? 0.03 : 0.012) * statusMul(L);
        if (R() >= Math.min(0.2, p)) return;
        L.apQ = true;
        if (L.fame >= 35 && ping) { P.dec.appraise = ap; return; }
        P.queue.push({ key: 'appraise', ap: ap, q: ap.intro + (ping ? (L.cls === 'gentry' ? '族中长辈劝你去求一句评语。' : '有人劝你也去试试：被他说一句好话，就能出名；说一句坏话，也就毁了。') : '乡里人都去请他看相。'),
          o: ping ? ['登门求一句评语', '不去'] : ['也请他相一相', '不去'], w: ping ? [3 + (L.tr.ind - 50) / 15, 2 + (L.tr.cau - 50) / 15] : [2, 2] });
      });
      L.apQ = false;
    }
    // 历史人物
    D.MEETS.forEach(function (m, i) {
      if (L.meetDone[i] || !meetOK(L, m, y)) return;
      // 远远一见只看机缘（住在城里更容易碰上）；近身的交集才看身份
      var near = m.q || m.elite || m.off || m.lit;
      var mul = (m.sol ? 1 : near ? statusMul(L) : clamp(Math.sqrt(statusMul(L)), 1, 2) * (L.urban ? 1.4 : 1)) * (L.lastFocus === 'travel' ? 1.6 : L.lastFocus === 'social' ? 1.2 : 1);
      if (R() >= Math.min(0.6, m.p * mul)) return;
      if (m.q) {
        var c = { key: 'meet', mi: i, q: m.q, o: m.o.map(function (x) { return x[0]; }), auto: 0.5 };
        P.queue.push(c);
      } else P.dec.sights.push(i);
    });
    // 日常选择（不频繁）
    if (gap && free) {
      var marriedable = !L.married && !L.spouseK;
      if (L.sex === 'M' && marriedable && a >= 16 && a <= 32 && L.cls !== 'slave' && R() < (L.flags.wantWed ? 0.6 : 0.22)) {
        var sp = makeSpouse(L, y);
        P.queue.push({ key: 'marry', sp: sp, q: '媒人上门，说合' + sp.from + '的' + sp.name + '（' + cnNum(sp.age) + '岁）。', o: ['答应这门亲事', '再等等'], auto: 0.7 });
      } else if (L.sex === 'F' && marriedable && a >= 18 && a <= 30 && L.cls !== 'slave' && R() < (L.flags.wantWed ? 0.6 : 0.3)) {
        var sp2 = makeSpouse(L, y);
        P.queue.push({ key: 'marry', sp: sp2, q: '你已经' + cnNum(a) + '岁了。媒人说合' + sp2.from + '的' + sp2.name + '（' + cnNum(sp2.age) + '岁），' + sp2.desc + '。', o: ['答应这门亲事', '再等等'], auto: 0.75 });
      } else if (a >= 6 && a <= 9 && !L.schooling && ['peasant', 'artisan', 'merchant', 'tenant', 'soldier', 'tuntian'].indexOf(L.cls) >= 0 && L.wealth >= 15 && R() < 0.12) {
        P.queue.push({ key: 'school', q: '乡里的老先生愿意教你识字，学费是每年一斗粟。父母问你想不想去。', o: ['去读书', '帮家里干活'], auto: 0.5 });
      } else if (a >= 16 && a <= 35 && L.learn >= 35 && !L.office && L.sex === 'M' && R() < 0.25 * polMul(z, y, 'career')) {
        P.queue.push({ key: 'clerk', q: '县里缺一个书佐，县丞问你愿不愿意到县廷当差。', o: ['去县廷', '留在家中'], auto: 0.6 });
      } else if (L.sex === 'M' && a >= 16 && a <= 38 && ((y >= 186 && y <= 235) || y >= 291) && ['peasant', 'tenant', 'artisan', 'clerk', 'merchant'].indexOf(L.cls) >= 0 && R() < (L.flags.martial || L.found.strength ? 0.25 : 0.1)) {
        P.queue.push({ key: 'recruit', q: fname(ctrl(z, y), y) + '的军队在郡里募兵，应募者每月给粮。', o: ['应募从军', '留在家中'], auto: 0.3 });
      } else if (a >= 18 && y >= 190 && y <= 205 && ['yu', 'yan', 'xu', 'luoyang', 'guanzhong', 'qing'].indexOf(z) >= 0 && R() < 0.1) {
        var md = pick(R, ['jingbei', 'jingnan', 'jiangdong', 'liaodong', 'shu', 'jiao']);
        P.queue.push({ key: 'migrate', dest: md, info: compareText(L, y, md), q: '听说' + zname(md) + '一带还算太平，乡里已经有好几户人家南下（或北上）避乱了。', o: ['迁往' + zname(md), '留在故乡'], auto: 0.25 });
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
      var bf = bestFriend(L, 65);
      if (bf && L.age >= 16) { opts.push('向朋友' + bf.name + '求助'); keys.push('friend'); w.push(1 + (L.tr.soc - 50) / 40); }
      if (lab) { opts.push(lab === 'self' ? '自己外出佣作' : '让' + kinLabel(L, lab) + '外出佣作'); keys.push('labor'); w.push(1.2); }
      if (['peasant', 'clerk', 'soldier', 'artisan', 'tuntian'].indexOf(L.cls) >= 0) { opts.push('投靠豪强，做他的佃客'); keys.push('kin'); w.push(0.8 + (L.tr.soc - 50) / 40); }
      var fd = pick(R, ['jingbei', 'jingnan', 'jiangdong', 'shu', 'jiao', 'liaodong'].filter(function (q) { return q !== z; }));
      opts.push('举家逃往' + zname(fd) + '，躲开债主'); keys.push('flee'); w.push(0.2 + (L.tr.ind - 50) / 60);
      var dec2 = a >= 16;
      var who = dec2 ? null : (L.kin[0].alive && !L.kin[0].apart ? '父亲' : '母亲');
      P.queue.push({ key: 'crisis', info: fd ? compareText(L, y, fd) : null, q: '家中入不敷出，如今欠债' + fmt(E.debt) + '钱值，' + (E.cash < 300 ? '粮储也快见底了。' : '债主已经上门催了几回。') + (dec2 ? '' : who + '愁得整夜睡不着。'),
        o: opts, keys: keys, w: w.map(function (x) { return Math.max(0.1, x); }), n: n, lab: lab, dest: fd, who: who, forced: !dec2 });
    }
    // 回响：年轻时的选择，多年后回来找你
    if (free) memCheck(L, y, P);
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
    var given = L.eth ? ethName(R, L.eth).given : givenName(R, sex, tierOf(L.cls));
    var from = pick(R, ['邻村', '同里', '邻县', '本县' + pick(R, D.VILLAGES) + '里']);
    var descs = sex === 'M' ? ['家里有几亩薄田', '是个老实的庄稼人', '父亲是个木匠', '家境比你家好一些', '比你大几岁，人还算本分'] : ['手很巧，会织布', '家里兄弟多', '性子温和', '家境和你家差不多'];
    if (L.cls === 'gentry') { var oj = pick(R, D.JUN)[0].replace(/(郡|国|尹)$/, ''); from = oj + sur + '氏'; descs = L.gate >= 3 ? ['门第与你家相当', '祖上做过太守', '家中藏书万卷'] : ['也是郡中的著姓', '家中有田数百顷', '父兄都在州郡任职']; }
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
      case 'flee': d.flee[c.ev] = { go: i === 0, dest: c.dest, rich: !!c.rich, fort: !!c.rich && i === 1 }; break;
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
          d.meet = c.mi; d.meetOut = m.o[i][2] || null;
          if (m.follow) P.queue.unshift({ key: 'follow', mi: c.mi, q: m.follow.q, o: m.follow.o.map(function (x) { return x[0]; }), auto: 0.4, pre: m.t });
        }
        break;
      case 'follow': if (i === 0) d.follow = D.MEETS[c.mi].follow.band; break;
      case 'seed1': case 'seed2': applySeed(L, c.key, i); d.seedText = SEEDS[c.key].t[i]; break;
      case 'crisis': d.crisis = { c: c, k: c.keys[i] }; break;
      case 'sonAsk': d.sonAsk = { give: i === 0, son: c.son }; break;
      case 'life': d.life = { c: c, i: i }; break;
      case 'appraise': if (i === 0) { d.appraise = c.ap; L.apAsk = true; } else L.appraised = true; break;
      case 'regime': d.regime = { c: c, i: i }; break;
      case 'mem': d.memC = { mi: c.mi, i: i }; break;
      case 'purge': (d.purge = d.purge || {})[c.ev] = { i: i, tie: c.tie, pn: c.pn }; break;
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
    L.yConscript = 0; L.yCart = false; L.yFort = false;

    // 政权更替
    var fk = rec.ctrl;
    if (L.regimes[L.regimes.length - 1] !== fk) {
      if (a > 0) {
        add(L, 0.02, 'note', fk === 'warlords' ? '你所在的' + D.ZONES[L.zone].zhou + '陷入了群雄割据，' + (WARLORD_DESC[L.zone] || '各路豪强') + '各据一方。' : '你所在的' + D.ZONES[L.zone].zhou + '，如今归' + fname(fk, y) + '统治。');
        var pfk = L.regimes[L.regimes.length - 1];
        if (pfk && ctrl(L.zone, y - 1) === pfk && !SUCC[pfk + '>' + fk] && !dec.regime && L.cls !== 'gentry' && !L.office && !L.soldier) add(L, 0.03, 'life', pick(R, D.WHEEL[L.cls === 'slave' ? 'slave' : L.cls === 'merchant' ? 'merchant' : 'poor']));
      }
      L.regimes.push(fk);
    }
    lawYear(L, y);
    if (!L.alive) return finishYear(L, rec);
    regionYear(L, y);
    foreshadow(L, y, fk);

    if (a === 0) birthEntries(L, y);
    rec.focus = resolveFocus(L, y);
    if (dec.seedText) add(L, 1.0, 'life', dec.seedText);
    if (dec.crisis) crisisAct(L, y, dec.crisis.c, dec.crisis.k);
    if (dec.sonAsk) sonOutcome(L, y, dec.sonAsk);
    if (dec.life) { lifeOutcome(L, y, dec.life.c, dec.life.i); memRecord(L, y, dec.life.c, dec.life.i, dec.life.c.meta || {}); }
    if (L.alive) memApply(L, y, dec);
    if (dec.regime) regimeOutcome(L, y, dec.regime.c, dec.regime.i);
    if (!L.alive) return finishYear(L, rec);
    if (dec.appraise) appraise(L, y, dec.appraise);
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
    if (dec.meet != null) meetHappen(L, dec.meet, y, 1.0, dec.meetOut);
    if (!L.alive) return finishYear(L, rec);
    dec.sights.forEach(function (i) { meetHappen(L, i, y, 1 + R() * 2); });
    eliteMeet(L, y);
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
    kinRelYear(L, y);
    friendsYear(L, y);
    economyYear(L, y);
    if (!L.alive) return finishYear(L, rec);

    // 本人基础死亡率
    var q = baseQ(a) * (CLS_Q[L.cls] || 1) * chaos(y) * bodyMul(L) * (D.REGION && D.REGION[L.zone] ? D.REGION[L.zone].ill : 1) * (L.injury ? 1.15 : 1) * (L.wealth < 10 ? 1.15 : 1) * (rec.focus.eff === 'health' ? 0.9 : 1);
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

  var YEAR_MAX = 350;
  function finishYear(L, rec) {
    if (L.alive && rec.y >= YEAR_MAX) {
      var ft = rec.y + '年以后，你的名字从户籍上消失了。也许你又活了许多年，在北方的战乱或江南的屋檐下终老——只是这部模拟，写到这一年为止。';
      var fe = add(L, 3.95, 'death', ft);
      L.alive = false; L.cause = 'fade'; L.causeText = ft; L.deathS = 3.95; L.deathI = fe.i; L.dy = rec.y; rec.death = true;
    }
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
      add(L, ev.s + 0.05, 'far', (ev.farE && eliteView(L) && L.age >= 10 ? ev.farE : ev.far).replace('{dir}', dir));
      L.rec.major = true;
      if (L.age >= 5) add(L, ev.s + 0.06, 'far2', L.office ? pick(R, ['消息很快送到了官署，你读到了这份军报。', '官署里为此议论了好几天。']) : L.cls === 'gentry' && L.age >= 12 ? pick(R, ['族中很快就得到了消息。', '家里的门客把消息带了回来，长辈们议论了很久。']) : pick(R, ['你没有参与。', '你对此一无所知。', '这些事，离你很远。']));
    }
    var r = (L.learn >= 40 || L.cls === 'gentry') && ev.r2 ? ev.r2 : ev.r1;
    if (!r && ev.r2 && (L.learn >= 40 || L.cls === 'gentry')) r = ev.r2;
    if (r && L.age >= 4 && R() < (ev.major ? 0.85 : 0.35)) {
      var d = zoneDist(L.zone, ev.o);
      var delay = d < 1.2 ? 0 : d < 2.5 ? (R() < 0.5 ? 0 : 1) : d < 4 ? 1 + Math.floor(R() * 2) : 2 + Math.floor(R() * 2);
      if (REMOTE[L.zone]) delay++;
      if (L.cls === 'gentry' && delay > 0) delay--;
      if (L.office) delay = 0;
      if (delay === 0) add(L, Math.min(3.9, ev.s + 0.6 + R()), 'rumor', r);
      else L.rumors.push({ y: y + delay, t: r });
    }
  }

  /* ---------- 地方效果 ---------- */
  function applyFx(L, ev, fx, dec, y) {
    var R = L.R, s = ev.s + 0.1, a = L.age;
    if (fx.t) add(L, s, 'hist', fx.t2 && eliteView(L) && a >= 10 ? fx.t2 : fx.t);
    var fled = false, moved = false, dest = null;
    if (fx.flee) {
      var f = dec.flee[ev.id];
      if (f) { fled = f.go; dest = f.dest; if (f.fort) { L.yFort = true; add(L, s + 0.02, 'life', '你家紧闭坞壁大门，部曲上墙守夜。'); } if (f.rich && f.go) L.yCart = true; }
      else if (a < 14 && !L.soldier && R() < fx.flee) { fled = true; dest = pick(R, fx.to); L.parentsFled = true; }
    }
    if (!fled && fx.move && !L.soldier && !L.band && R() < fx.move) { moved = true; dest = pick(R, fx.to); }
    var hm = (fled ? (L.yCart ? 0.15 : 0.35) : 1) * (L.flags.wubi ? 0.5 : 1) * (L.yFort ? 0.4 : 1);
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
    if (fx.war && L.sex === 'F' && a >= 14 && a <= 35 && !fled && !L.yFort && L.cls !== 'gentry' && R() < fx.war * 3) {
      var dz = pick(R, ['bing', 'liang', 'you', 'guanzhong', 'jiangdong', 'jingnan'].filter(function (q) { return q !== L.zone; }));
      liveKin(L).forEach(function (k) { k.apart = true; });
      if (L.spouseK) { L.married = false; L.spouseK = null; }
      relocate(L, dz, s + 0.07, '乱兵掳走了村里好些年轻女子，你也在其中。你被一路裹挟着带到了{dest}，从此再没见过家人。', 0.05, y);
      L.flags.abducted = y; L.cls = L.cls === 'slave' ? 'slave' : 'tenant';
      if (!L.alive) return;
    }
    var rk = fx.war ? 'war' : fx.fam ? 'fam' : fx.plag ? 'plag' : null;
    if (rk && a >= 5 && D.REACT && R() < 0.85) {
      var bk = L.cls === 'slave' ? 'slave' : L.cls === 'gentry' ? 'gentry' : L.office ? 'official' : L.cls === 'merchant' ? 'merchant' : L.eth ? 'tribal' : L.cls === 'tenant' && D.REACT[rk].tenant && R() < 0.5 ? 'tenant' : 'poor';
      var pool = D.REACT[rk][bk] || D.REACT[rk].poor;
      add(L, s + 0.06, 'life', fresh(L, pool));
    }
    if (fx.m15) {
      var mm = D.JUN[L.jun][0] === '辽东郡' ? 1.6 : 0.3;
      if (L.sex === 'M' && a >= 15 && R() < fx.m15 * mm) { die(L, 'massacre', s + 0.05); return; }
      liveKin(L, function (k) { return k.sex === 'M' && ageOf(L, k, y) >= 15; }).forEach(function (k) { if (R() < fx.m15 * mm) kinDie(L, k, 'massacre', s + 0.04, y); });
    }
    if (fx.purge && dec.purge && dec.purge[ev.id]) {
      var pd = dec.purge[ev.id], pr = [0.33, 0.33, 0.12][pd.i];
      if (pd.i === 0) {
        if (R() < 0.25) { add(L, s + 0.03, 'bad', '你还没出城，就被守门的兵认了出来，押回了城里。'); pr = 0.6; }
        else {
          var fz = ['jiangdong', 'liaodong', 'jingnan', 'shu', 'liang'].filter(function (q) { return q !== L.zone && group(ctrl(q, y)) !== group(ctrl(L.zone, y)); });
          if (L.office) { L.office = null; L.job = L.cls === 'gentry' ? '士人' : '农'; }
          if (fz.length) relocate(L, pick(R, fz), s + 0.03, '你丢下官职和大半家产，带着家小连夜出城，一路逃到了{dest}。', 0.03, y);
          pr = 0;
        }
      } else if (pd.i === 2) { L.fame -= 6; L.standing -= 4; add(L, s + 0.03, 'life', '你上书自陈，把与' + pd.pn + '往来的事一五一十都说了，还供出了几个旧交。有人因此下了狱。'); }
      if (R() < pr) { die(L, 'executed', s + 0.05, { full: pd.pn + '一案牵连甚广。有人翻出你' + pd.tie + '的旧事，你被收捕下狱，与族人一同被杀。' }); return; }
      if (pd.i === 1) add(L, s + 0.04, 'life', '你闭门待罪了几个月。风声渐渐过去，你家侥幸没有被牵连。');
      else if (pd.i === 2) add(L, s + 0.04, 'life', '你保住了性命和家业。只是从此以后，旧日的朋友见了你，都绕道走。');
    }
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
      if (L.yCart) txt = '你家装了几车细软，带着僮仆，往{dest}去了。';
      relocate(L, dest, s + 0.2, txt, (fx.mr || 0.03) * (L.yCart ? 0.3 : 1), y);
      if (!L.alive) return;
      if (fled && fx.fn === 'changban') changban(L, y, s + 0.3);
    }
    if (fx.fn && SPECIAL[fx.fn]) SPECIAL[fx.fn](L, fx, s, y, fled);
  }

  function relocate(L, dest, s, text, risk, y) {
    friendsApart(L, '你离开故乡后，便断了音讯');
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
    L.eco.cash = Math.round(L.eco.cash * (L.yCart ? 0.8 : 0.5)); L.eco.ox = 0; L.eco.house = Math.min(L.eco.house, L.cls === 'gentry' ? 20000 : 1500);
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
  function meetHappen(L, i, y, s, out) {
    var m = D.MEETS[i];
    L.meetDone[i] = true;
    var title = y < 219 ? '左将军' : y < 221 ? '汉中王' : '皇帝';
    if (m.t) add(L, s, 'meet', fill(m.t, { title: title }));
    var fig = D.FIGURES.filter(function (f) { return f.id === m.f; })[0];
    markMet(L, m.f, y, '你曾' + (m.follow ? '在乡里见过' : '见过') + fig.n + '。');
    if (m.fx) {
      if (m.fx.flag) L.flags[m.fx.flag] = true;
      if (m.fx.learn) L.learn += m.fx.learn;
      if (m.fx.body) L.body += m.fx.body;
      if (m.fx.fame) L.fame += m.fx.fame;
      if (m.fx.craft) L.craft += m.fx.craft;
    }
    L.rec.tags.push('meet');
    if (out) meetOutcome(L, out, y, s, fig);
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
  // 行伍中的晋升：熬资历、立战功、有人提携，都难；乱世与政令会改变难易
  var MIL = ['军卒', '屯长', '军司马', '校尉', '将军'];
  var MIL_P = [0.022, 0.012, 0.005, 0.0025];
  function milPromote(L, y, fought) {
    var R = L.R, lv = L.mil || 0;
    if (!L.alive || !L.soldier || L.band || lv >= 4) return;
    var cap = Math.min(4, (L.cls === 'gentry' ? 4 : L.found.strength || L.literate ? 3 : 2) + (L.patron ? 1 : 0));
    if (lv >= cap) return;
    var yrs = y - (L.soldier.since || y);
    var p = MIL_P[lv] * (yrs >= 3 ? 1 : 0.4) * (fought ? 1.6 : 1) * (chaos(y) > 1.05 ? 1.3 : 0.7) *
      (L.found.strength ? 1.4 : 1) * (L.literate ? 1.3 : 1) * (L.cls === 'gentry' ? 1.8 : 1) * (L.patron ? 1.5 : 1) * (1 + Math.min(40, Math.max(0, L.fame)) / 60) * polMul(L.zone, y, 'milc');
    if (R() >= p) return;
    L.mil = lv + 1; L.job = MIL[L.mil]; L.milMax = MIL[L.mil]; L.fame += 2 + L.mil * 2;
    add(L, 2.05, 'good', fresh(L, [
      ['你在军中熬了' + cnNum(Math.max(1, yrs)) + '年，资历够了，被提拔为屯长，手下管着百来号人。', '你识得几个字，又肯吃苦，被上头提拔为屯长。'],
      ['你升为军司马，有了自己的营。从前同伍的兄弟，见了你要行礼了。', '上头看你带兵有方，升你为军司马。'],
      ['你升为校尉，独领一军。这在你的出身里，是极少见的。', '一场仗打下来，主将上表为你请功，你升了校尉。'],
      ['你被拜为将军。一个人的出身和刀口上的功劳，都写在了这道任命上。']][L.mil - 1]));
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
      if (r < 0.12 * (L.found.strength ? 1.5 : 1)) {
        L.fame += 4; L.eco.priv += 1000; add(L, 1.8, 'good', '你在' + c.n + '中斩获首级，得了一千钱的赏赐。');
        var MIL = ['军卒', '屯长', '军司马', '校尉', '将军'];
        var lv = L.mil || 0, cap = Math.min(4, (L.cls === 'gentry' ? 4 : L.found.strength ? 3 : 2) + (L.patron ? 1 : 0));
        if (lv < cap && R() < (0.45 - lv * 0.08) * (L.cls === 'gentry' ? 1.6 : 1) * (L.found.strength ? 1.3 : 1) * (L.patron ? 1.4 : 1)) {
          L.mil = lv + 1; L.job = MIL[L.mil]; L.milMax = MIL[L.mil]; L.fame += 3 + L.mil * 3;
          add(L, 1.85, 'good', ['', '你被提拔为屯长，管着百来号人。', '你升为军司马，有了自己的营。', '你升为校尉，独领一军。', '你被拜为将军。一个人的出身和刀口上的功劳，都写在了这道任命上。'][L.mil]);
        }
      }
      else if (r < 0.22) { L.body -= 15; L.injury = pick(R, ['左足', '右手', '左目']); add(L, 1.8, 'bad', '你在' + c.n + '中受了伤，' + { 左足: '左腿从此有些跛', 右手: '右手少了两根手指', 左目: '左眼瞎了' }[L.injury] + '。'); }
    });
    if (!L.alive) return;
    // 军中疾疫
    if (R() < 0.012 * bodyMul(L)) { die(L, 'plag', 2.5); return; }
    if (!fought && R() < 0.5) add(L, 2, 'life', pick(R, D.DAILY.soldier));
    milPromote(L, y, fought);
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
    var RG = D.REGION && D.REGION[L.zone];
    if (RG && a >= 6) pool = pool.concat(RG.custom);
    if (L.eth && D.ETH[L.eth]) pool = pool.concat(a < 14 ? D.ETH[L.eth].child : D.ETH[L.eth].adult);
    else if (a < 3) return a === 0 ? null : pick(R, ['你学会了走路。', '你会叫"阿母"了。', '你断了奶，开始吃粟米粥。']);
    else if (a < 14) {
      pool = pool.concat(L.cls === 'gentry' ? DD.childGentry.concat(L.sex === 'M' && DD.gentryChild ? DD.gentryChild : []) : L.cls === 'clerk' ? DD.childClerk.concat(DD.child) : L.cls === 'merchant' ? DD.childMerchant.concat(DD.child) : L.cls === 'artisan' ? DD.childArtisan.concat(DD.child) : L.cls === 'slave' ? DD.childSlave : DD.child);
      if (L.sex === 'F') pool = pool.concat(DD.childF);
    } else if (a >= 62) pool = pool.concat(DD.old);
    else if (L.soldier) pool = pool.concat(DD.soldier);
    else if (L.office) pool = pool.concat(DD.clerkJob);
    else if (L.cls === 'gentry') pool = pool.concat(L.sex === 'F' && DD.gentryF ? DD.gentryF : DD.gentry);
    else if (L.cls === 'merchant') pool = pool.concat(DD.merchant);
    else if (L.cls === 'artisan') pool = pool.concat(DD.artisan);
    else if (L.cls === 'slave') pool = pool.concat(L.sex === 'F' && DD.slaveF ? DD.slaveF.concat(DD.slave) : DD.slave);
    else if (L.cls === 'tuntian') pool = pool.concat(DD.tuntian, L.sex === 'F' ? DD.farmerF : DD.farmer);
    else pool = pool.concat(L.sex === 'F' ? DD.farmerF : DD.farmer, L.cls === 'tenant' && DD.tenantLines ? DD.tenantLines : []);
    if (a >= 8 && !L.eth) polsAt(L.zone, y).forEach(function (p) { if (p.daily) pool = pool.concat(p.daily); });
    var TD = D.TIER_DAILY, tk = lifeTier(L, y).k;
    if (TD && tk && tk !== 'slave' && !L.eth) {
      if (a >= 3 && a < 14) pool = pool.concat(TD.child[tk], L.sex === 'F' ? TD.childF[tk] : []);
      else if (a >= 14 && a < 62 && !L.soldier && !L.band) pool = pool.concat(TD.adult[tk], TD.adult[tk]);
    }
    if (L.sex === 'F' && a >= 16 && L.married) {
      var kids = liveKin(L, function (k) { return k.rel === 'child'; });
      if (kids.length) pool.push('在' + L.county + '给第' + cnNum(kids.length) + '个孩子做了一双鞋。', '你背着最小的孩子下田干活。');
    }
    return pool.length ? fresh(L, pool) : null;
  }
  var LOCAL = D.LOCAL;

  function doMarry(L, sp, y, s, prefix) {
    var k = newKin(L, 'spouse', sp.sex, y - sp.age, sp.name, { sur: sp.sur });
    L.spouseK = k; L.married = true; L.widowed = false; L.marriedAt = y;
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
    if (a === 6 && (L.sex === 'M' ? (L.cls === 'gentry' || (L.cls === 'clerk' && R() < 0.7)) : ((L.cls === 'gentry' && R() < (L.gate >= 3 ? 0.5 : 0.3)) || (L.cls === 'clerk' && R() < 0.1)))) { L.schooling = true; add(L, 1, 'life', L.cls === 'gentry' ? '你开始跟着家中的塾师读《孝经》《论语》。' : '父亲开始教你认字。'); }
    if (dec.school) { L.schooling = true; add(L, 1, 'good', '你开始跟着乡里的老先生识字。'); }
    applyFocus(L, y, L.rec.focus);
    if (L.rec.focus.eff !== 'study') {
      if (L.schooling && a < 18) L.learn += 2 + R() * 2;
      else if (L.kin[0].lit && L.kin[0].alive && a >= 5 && a <= 12) L.learn += L.sex === 'F' ? 0.3 : 0.8;
    }
    if (L.schooling && a >= 15 && R() < 0.3) L.schooling = false;
    if (!L.literate && L.learn >= 30) { L.literate = true; add(L, 2.5, 'good', pick(R, ['你认得几百个字了，能读懂官府贴出的告示。', '你终于能读完一整卷书了。'])); }

    // 礼与税
    if (a === 7 && registered && y < 204) add(L, 0.5, 'note', '按汉制，你开始缴纳口钱，每年二十三钱。');
    if (a === 15) add(L, 0.5, 'note', registered && y < 204 && g === 'han' ? '你十五岁了，开始缴纳算赋，每年一百二十钱。' : '你十五岁了，在乡里人眼里，已经是大人了。');
    if (a === 15 && L.sex === 'F' && !L.zi && !L.eth && (L.cls === 'gentry' || (L.cls === 'clerk' && L.literate)) && R() < 0.7) {
      L.zi = giveZi(L, 'F');
      add(L, 0.8, 'life', '你行了笄礼，挽起了发髻，取字' + L.zi + '。');
    }
    if (a === 20 && L.sex === 'M' && !L.zi && !L.eth && L.cls !== 'slave' && R() < (L.literate || L.cls === 'gentry' || L.cls === 'clerk' ? 0.95 : 0.3)) {
      L.zi = giveZi(L, 'M');
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
      if (L.sex === 'F' && a < 40 && R() < (g === 'wei' && L.cls === 'soldier' ? 0.6 : L.cls === 'gentry' ? 0.05 : 0.18)) {
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
      if (R() < rate) {
        if ((L.cls === 'merchant' || L.wealth >= 60) && L.eco.cash + L.eco.priv >= 3000 && R() < 0.8) { payFrom(L, 3000); add(L, 1.2, 'life', '官府征兵点到了你。家里出了三千钱，雇人顶了你的名字。'); }
        else enlist(L, y, 1.2, false);
      }
    }

    // 随机际遇
    personal(L, y);
    if (!L.alive) return;
    childEvent(L, y);
    // 家境滑落
    splitHousehold(L, y);
    if (L.cls === 'slave' && a >= 15 && R() < 0.012) {
      L.cls = 'tenant'; L.standing += 10;
      add(L, 3, 'good', y >= 220 && g === 'wei' ? '朝廷下诏放免了一批官私奴婢，你成了良人。' : '主人放免了你，你成了良人。');
    }
  }

  function meetOutcome(L, o, y, s, fig) {
    var R = L.R;
    if (o.alt) { var r = R(), acc = 0, ch = o.alt[o.alt.length - 1]; for (var j = 0; j < o.alt.length; j++) { acc += o.alt[j].p; if (r < acc) { ch = o.alt[j]; break; } } o = ch; }
    if (o.die) { die(L, o.die, s + 0.1, { n: fig.n + '麾下' }); return; }
    if (o.t) add(L, s + 0.05, (o.fame || 0) < 0 || o.office === null ? 'bad' : 'good', o.t);
    if (o.fame) L.fame += o.fame;
    if (o.standing) L.standing += o.standing;
    if (o.body) L.body = clamp(L.body + o.body, 5, 100);
    if (o.cash) {
      L.eco.cash += o.cash;
      if (L.eco.cash < 0) { L.eco.debt -= L.eco.cash; L.eco.cash = 0; }
    }
    if (o.office === null && L.office) { L.office = null; L.job = '农'; }
    if (o.patron && !L.patron) { L.patron = o.patron; L.meetLog.push({ id: fig.id, y: y, ach: '你得到过' + o.patron + '的赏识。' }); }
    if (o.mil && L.soldier && (L.mil || 0) < 4) {
      var MIL = ['军卒', '屯长', '军司马', '校尉', '将军'];
      L.mil = (L.mil || 0) + 1; L.job = MIL[L.mil]; L.milMax = MIL[L.mil];
      add(L, s + 0.08, 'good', '战后论功，你被拔擢为' + MIL[L.mil] + '。');
    }
  }

  // 在群雄本人手下做事，就算见过他
  var LORD_FIG = { caocao: 'caocao', liubei: 'liubei', sunce: 'sunce', sunquan: 'sunquan', yuanshao: 'yuanshao', liubiao: 'liubiao', dongzhuo: 'dongzhuo', gongsunzan: 'gongsunzan', zhanglu: 'zhanglu', shixie: 'shixie', lvbu: 'lvbu', yuanshu: 'yuanshu', liuzhang: 'liuzhang', xiliang: 'mateng', taoqian: 'taoqian' };
  var LORD_LOOK = { caocao: '他个子不高，目光很亮，说话时常常大笑。', liubei: '他身长七尺五寸，垂手下膝，待人很和气，记得住下属的名字。', sunce: '他年轻俊朗，爱说笑，人们都叫他"孙郎"。', sunquan: '他方颐大口，目有精光。', yuanshao: '他姿貌威容，举止很有气度，只是议事时总拿不定主意。', liubiao: '他身长八尺余，姿貌温厚，说话不紧不慢。', dongzhuo: '他身体肥胖，目光阴沉，堂下的人都不敢抬头。', gongsunzan: '他相貌英俊，声音洪亮，身边总跟着骑白马的卫士。', zhanglu: '他穿着道服，说话不紧不慢，案上摆着道书。', shixie: '他体器宽厚，待人谦和，说起《春秋》来头头是道。', lvbu: '他身材魁梧，弓马娴熟，只是喜怒无常。', yuanshu: '他出入乘金车，言谈间很是骄矜。', liuzhang: '他性情宽柔，说话和气，看上去没什么主见。', mateng: '他身高八尺有余，面鼻雄异，待人却很宽厚。', taoqian: '他年纪已老，须发斑白，说话很直。', shile: '他是羯人，高鼻深目，说话带着上党口音，不识字，却记性极好。', shihu: '他身材魁梧，目光凶狠，左右的人都不敢抬头看他。', lixiong: '他衣着朴素，待人宽和，不像个皇帝。', murongh: '他身长七尺八寸，龙颜版齿，喜欢谈论经学。', ranmin: '他身长八尺，勇力绝人，骑着一匹名叫朱龙的马。' };
  function lordFigAt(fk, y) {
    if (fk === 'houzhao') return y < 334 ? 'shile' : y < 349 ? 'shihu' : null;
    if (fk === 'chenghan') return y < 334 ? 'lixiong' : null;
    if (fk === 'murong') return y >= 333 && y < 349 ? 'murongh' : null;
    if (fk === 'ranwei') return 'ranmin';
    return LORD_FIG[fk] || null;
  }
  function figName(id) { var f = D.FIGURES.filter(function (x) { return x.id === id; })[0]; return f ? f.n : ''; }
  function serveLord(L, id, y, how, s) {
    if (!id || L.met[id] || !figName(id)) return;
    add(L, s || 1.45, 'meet', '你第一次在近处见到了' + figName(id) + '本人。' + (LORD_LOOK[id] || ''));
    markMet(L, id, y, '你曾' + how + '。');
    L.rec.tags.push('meet');
  }

  // 改朝换代：禅代与父子相继不算易主
  var SUCC = { 'caocao>wei': 1, 'liubei>shu': 1, 'sunce>sunquan': 1, 'sunquan>wu': 1, 'liuyan>liuzhang': 1, 'wei>jin': 1, 'dongzhuo>lijue': 1, 'han>liuyan': 1, 'han>liubiao': 1, 'han>taoqian': 1, 'han>shixie': 1, 'han>gongsun': 1, 'han>zhanglu': 1, 'han>gongsunzan': 1, 'han>warlords': 1 };
  // 群雄割据、叛军这类"政权"并非一人，要说清楚到底是谁
  var LOOSE = { warlords: 1, rebels: 1, nzrebels: 1 };
  var WARLORD_DESC = { yu: '袁术的部将和汝南、颍川的黄巾余部', luoyang: '张杨、杨奉等各路兵马', qing: '青州黄巾和田楷、孔融等各路人马', bing: '黑山军张燕和各路豪强', jiangdong: '刘繇、王朗、严白虎等人' };
  function oldLordDesc(z, fk, y) { return fk === 'warlords' ? (WARLORD_DESC[z] || '割据此地的各路豪强') : lordName(fk, y); }
  function lordName(fk, y) { return { warlords: '新起的豪强', rebels: '凉州叛军', nzrebels: '南中豪帅', han: '汉廷', lijue: '李傕、郭汜' }[fk] || fname(fk, y); }
  var LOW_OFF = { 书佐: 1, 计吏: 1, 县长: 1 };
  function regimeOutcome(L, y, c, i) {
    var R = L.R, nn = c.nn || lordName(c.nfk, y), on = c.on || lordName(c.ofk, y), r = R();
    if (!L.office) {
      if (i === 0) {
        if (r < 0.3 + L.fame / 120 + (L.gate >= 3 ? 0.15 : 0)) { L.office = '幕僚'; L.officeMax = nn + '的掾属'; L.job = '幕僚'; L.fame += 4; add(L, 1.2, 'good', '你的书信得到了回音。' + nn + '辟你为掾属。有人说你识时务，也有人在背后说你急于求进。'); serveLord(L, lordFigAt(c.nfk, y), y, '应' + nn + '征辟，做他的掾属'); }
        else add(L, 1.2, 'life', '你的书信石沉大海。新主身边的人太多了，轮不到你。');
      } else { L.standing += 2; add(L, 1.2, 'life', '你闭门谢客，只在家中读书。乱世里，观望也是一种站队。'); }
      return;
    }
    if (i === 0) {
      if (LOW_OFF[L.office]) {
        if (r < 0.85) add(L, 1.2, 'life', '县廷换了主人，户籍、田亩、刑狱的文书还得有人管。你照旧当差，只是公文上的年号和印信都换了。');
        else { add(L, 1.2, 'bad', '新来的长官带来了自己的人，你被打发回了家。'); L.office = null; L.job = '农'; }
      } else if (r < 0.5) add(L, 1.2, 'life', '新主要安抚人心，你被留任原职。只是从此每次议事，都有人看你的脸色。');
      else if (r < 0.62 && L.fame >= 25) { L.fame += 5; add(L, 1.2, 'good', nn + '看重你的名声，召你相见，不但留任，还加了你的秩禄。'); serveLord(L, lordFigAt(c.nfk, y), y, '得' + nn + '召见，加了秩禄'); }
      else if (r < 0.88) { L.office = '幕僚'; L.job = '幕僚'; add(L, 1.2, 'bad', '要紧的位置都给了' + nn + '的旧部。你被调去做了一个闲散的掾属。'); }
      else {
        add(L, 1.2, 'bad', '有人向' + nn + '告发，说你是' + on + '的心腹。你被下了狱。');
        if (R() < 0.3) { die(L, 'executed', 1.4, { full: '狱中拷掠了几个月，你没能活着走出来。' }); return; }
        L.office = null; L.job = '农'; L.eco.cash = Math.round(L.eco.cash * 0.5); L.fame -= 3;
        add(L, 1.6, 'life', '关了几个月，家里花了一大笔钱上下打点，你才被放了出来，官自然是没了。');
      }
    } else if (i === 1) {
      L.fame += LOW_OFF[L.office] ? 1 : 4; L.standing += 2;
      L.office = null; L.job = L.cls === 'gentry' ? '士人' : '农';
      add(L, 1.2, 'life', '你把印绶封好，留在官舍里，回乡闭门不出。' + (L.cls === 'gentry' ? '乡里人说你有节操；新主那边，记下了你的名字。' : '家里人埋怨你，丢了一份口粮。'));
    } else {
      if (R() < 0.08) { die(L, 'road', 1.4); return; }
      relocate(L, c.dest, 1.2, '你带着家小连夜出城，往{dest}投奔' + on + '。', 0, y);
      if (R() < 0.55) add(L, 1.5, 'good', on + '念你远来相投，仍授了你官职。');
      else { L.office = '幕僚'; L.job = '幕僚'; add(L, 1.5, 'life', on + '收留了你，可远来的人太多，你只做了一个闲散的掾属。'); }
      L.fame += 2;
      serveLord(L, lordFigAt(c.ofk, y), y, '投奔' + on + '，在他帐下任职', 1.55);
    }
  }

  // 月旦评：评语由天资、学问、性情、名声决定——评的人看得见你自己还不知道的东西
  var AP_TXT = {
    wen: [['粗通章句，可以守家学。', '读书肯用功，只是器局小了些。'], ['博闻强记，可为郡文学掾。', '此子好学，他日当以经术立身。'], ['经明行修，当为一时儒宗。', '此子之学，非州郡所能容也。']],
    wu: [['有些膂力，可以为卒伍。', '性子刚，手脚重，宜远刀兵。'], ['勇而少谋，可为一校之长。', '健儿也。治世可为亭长，乱世可为部曲之帅。'], ['熊虎之士。治世之干城，乱世之将才。', '此人临阵必能陷坚，只恐不得善终。']],
    li: [['谨守绳墨，可为乡啬夫。', '小心勤谨，能治簿书而已。'], ['明练文法，可当一县。', '善于应对，长于吏事。'], ['明于治体，可当一郡。', '此人有经世之才，惜生非其时。']],
    zhi: [['志大而才疏，宜自敛抑。', '好为大言，恐终无成。'], ['有志节，可以立事；只是太急了些。', '不甘人下者也。'], ['此君乱世之所需，治世之所忌。', '非常之人也。天下有变，当见其人。']],
    de: [['中人之资，安分可以终老。', '无大过，亦无大功。'], ['笃实谦退，乡党称善。', '温良恭俭，足以保家。'], ['清正有德，可为人师表。', '其人如玉，可以托六尺之孤。']],
    gong: [['手巧，可为良工。', '心思细，可惜没有用在正途上。'], ['巧思过人，可以掌作坊。', '此子之巧，可以为将作之吏。'], ['巧思绝世，可比公输。', '其巧可以利天下，惜世人不知。']]
  };
  var XIANG_TXT = [
    ['你眉间有些劳苦之相，一生要多奔波。只是骨相坚实，吃得了苦。', '你面色偏黄，脾胃弱，要少饮酒，水边当心。', '你相貌平常，福薄却不至于穷，一生平平。'],
    ['你天庭饱满，中年之后当有一番际遇，切忌与人争讼。', '你耳厚口方，主有子孙之福。', '你骨相清峻，四十以后乃显。'],
    ['你相貌奇伟，此非常人之相。只是锋芒太露，要懂得收敛。', '你目有精光，虽在下位，必有出头之日。']
  ];
  var DIM_TAL = { wen: 'memory', wu: 'strength', li: 'charm', gong: 'craft' };
  function appraise(L, y, ap) {
    var R = L.R, t = L.tr, tal = L.tal;
    L.appraised = true;
    var D5 = {
      wen: L.learn * 0.9 + tal.memory * 40 + (t.cur - 50) / 3,
      wu: L.body * 0.5 + tal.strength * 50 + (L.flags.martial ? 12 : 0) + (t.act - 50) / 3,
      li: L.standing * 0.5 + tal.charm * 40 + (t.cau - 50) / 4 + (t.soc - 50) / 4 + (L.office ? 12 : 0),
      zhi: (t.ind + t.act) / 2 - 18 + L.fame / 3,
      de: (t.cau + t.soc) / 2 - 12 - (L.flags.corrupt ? 30 : 0),
      gong: L.craft * 0.6 + tal.craft * 50
    };
    var k = Object.keys(D5).sort(function (a, b) { return D5[b] - D5[a]; })[0], v = D5[k];
    var lv = v >= 72 ? 2 : v >= 48 ? 1 : 0, txt, ping = ap.kind === 'ping';
    if (ping) {
      txt = pick(R, AP_TXT[k][lv]);
      add(L, 1.3, lv ? 'good' : 'life', (L.fame >= 35 && !L.apAsk ? '你没有去求，' + ap.n + '却主动品评了你。' : '你登门拜见了' + ap.n + '。他打量了你许久，说了一句话。') + '人们很快就传开了：「' + txt + '」');
      if (lv === 2) { L.fame += 12; L.standing += 5; L.flags.praised = true; add(L, 1.35, 'good', '一夜之间，郡里的人都知道了你的名字。上门结交的人多了起来。'); }
      else if (lv === 1) { L.fame += 5; L.standing += 2; }
      else { L.fame -= 2; add(L, 1.35, 'life', '你听了，脸上发烫。这句话跟了你好些年。'); }
    } else {
      txt = pick(R, XIANG_TXT[lv]).replace(/^你/, '君');
      add(L, 1.3, 'life', ap.n + '端详了你一会儿，说：「' + txt + '」' + (lv ? '你嘴上说不信，心里却记下了。' : '你笑了笑，没放在心上。'));
      L.standing += lv;
    }
    var tk = DIM_TAL[k];
    if (tk && tal[tk] >= 0.45 && !L.found[tk]) { L.found[tk] = true; add(L, 1.4, 'good', '经这一句话，你才知道自己有' + TALENT[tk].n + '的天分。'); }
    L.appraisal = { by: ap.n, t: txt, y: y, ping: ping, lv: lv };
    markMet(L, ap.f, y, ap.n + '曾' + (ping ? '评' : '相') + '你：「' + txt + '」');
  }

  function career(L, y, dec) {
    var R = L.R, a = L.age, fk = ctrl(L.zone, y);
    if (L.flags.corrupt && L.office && R() < 0.06 * polMul(L.zone, y, 'corrupt')) {
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
    var pc = polMul(L.zone, y, L.cls === 'gentry' ? 'gcareer' : 'career');
    // 考课：每年的政绩评定，慢慢积累名声
    if (L.office && a >= 18 && R() < 0.3) {
      var ev = (L.learn - 40) / 20 + (L.standing - 45) / 25 + (L.tr.cau - 50) / 40 + (L.found.charm ? 0.4 : 0) + (L.flags.corrupt ? -1 : 0) + (R() - 0.5) * 2;
      if (ev > 0.8) { L.fame += 3; add(L, 2.15, 'good', fresh(L, ['这一年的考课，你被评为"最"，上头记了你的名字。', '郡里考课，你经手的户口、钱谷一丝不乱，被评为上等。'])); }
      else if (ev < -1.2) { L.fame -= 2; add(L, 2.15, 'bad', fresh(L, ['这一年的考课，你被评为"殿"，挨了上司一顿训斥。', '考课时你经手的账目对不上，被罚了俸。'])); }
    }
    if (L.office === '书佐' && L.learn >= 50 && R() < 0.06 * pc) {
      L.office = '计吏'; L.job = '计吏'; L.officeMax = '郡上计吏'; L.fame += 4;
      add(L, 2, 'good', '你被郡里选为上计吏，年底要带着全郡的户口簿书进京上计。');
    } else if ((L.office === '计吏' || L.office === '书佐') && L.fame >= 15 && L.standing >= 45 && R() < 0.02 * pc) {
      L.office = '县长'; L.job = '县长'; L.officeMax = '县长'; L.fame += 8;
      add(L, 2, 'good', '你被任命为一个小县的县长。从小吏做到长吏，在你的出身里是极少见的。');
    } else if (L.office === '县长' && L.cls !== 'gentry' && L.fame >= 25 && R() < 0.015 * pc * (L.patron ? 1.6 : 1) * (L.flags.donor ? 1.2 : 1)) {
      L.office = '县令'; L.job = '县令'; L.officeMax = '县令'; L.fame += 6;
      add(L, 2, 'good', '你调任一个万户以上的大县做县令。从书佐一步步做到这里，用了你大半辈子。');
    }
    var cm = (L.lastFocus === 'career' ? 2 : 1) * (L.flags.robe ? 1.3 : 1) * (L.flags.connected ? 1.3 : 1) * (L.flags.zz ? 2 : 1) * (L.flags.zzno ? 0.6 : 1) * (L.flags.disciple ? 1.4 : 1) * (L.found.memory ? 1.3 : 1) * (L.found.charm ? 1.2 : 1) * (L.flags.banned ? 0 : 1) * (L.patron ? 1.5 : 1) * (L.flags.praised ? 1.4 : 1) * (L.flags.jushi ? 1.5 : 1) * (L.flags.spur ? 1.3 : 1) * (L.flags.donor ? 1.2 : 1);
    var gm = L.gate >= 3 ? 2.2 : 1;
    if (L.cls === 'gentry' && !L.office && a >= 18) {
      var p = 0;
      if (y < 220 && (L.fame >= 5 || L.gate >= 3)) p = 0.04; // 察举
      if (y >= 220) p = L.gate >= 3 ? 0.13 : 0.04; // 九品中正：上品无寒门
      if (y >= 190 && y < 230 && L.learn >= 55) p += 0.03; // 征辟
      if (R() < p * cm * gm * polMul(L.zone, y, 'gcareer')) {
        var t;
        if (y < 220 && R() < 0.6) { L.office = '郎官'; L.officeMax = '郎中'; t = L.gate >= 3 ? '凭着家世，你一出仕就做了郎官。' : '郡里举你为孝廉，你入京做了郎官。'; }
        else if (y >= 220 && R() < 0.6) { L.office = L.gate >= 3 ? '尚书郎' : '县令'; L.officeMax = L.office; t = '郡中正评你为' + (L.gate >= 3 ? '上品。上品无寒门，下品无士族——你起家便是尚书郎。' : '中品，你被任为县令。'); }
        else { L.office = '幕僚'; L.officeMax = fname(fk, y) + '的幕僚'; t = fname(fk, y) + '征辟你为掾属，你做了幕府的幕僚。'; }
        L.job = L.office; L.fame += 10;
        add(L, 2, 'good', t);
        if (L.office === '幕僚') serveLord(L, lordFigAt(fk, y), y, '在' + fname(fk, y) + '幕府中任掾属');
      }
    } else if ((L.office === '郎官' || L.office === '尚书郎' || L.office === '幕僚') && R() < 0.12 * gm) {
      L.office = '县令'; L.officeMax = '县令'; L.job = '县令'; L.fame += 6;
      add(L, 2, 'good', '你外放为县令。');
    } else if ((L.office === '县令' || (L.office === '县长' && L.patron)) && (L.fame >= 30 || L.gate >= 3) && R() < 0.03 * gm * cm * pc) {
      L.office = '郡守'; L.officeMax = '郡太守'; L.job = '太守'; L.fame += 12;
      add(L, 2, 'good', '你升任太守，治理一郡。');
    } else if (L.office === '郡守' && (L.gate >= 2 || L.patron) && L.fame >= 45 && R() < 0.02 * gm * cm * pc) {
      var top = R() < 0.5 ? '刺史' : '九卿';
      L.office = top; L.officeMax = top === '刺史' ? '州刺史' : '九卿'; L.job = top; L.fame += 15;
      add(L, 2, 'good', top === '刺史' ? '你出任一州刺史，持节监察诸郡。' : '你入朝位列九卿。你家的门第，从此又高了一层。');
      if (L.gate < 3 && L.cls === 'gentry') { L.gate = 3; L.gateName = '世代二千石的高门'; }
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
    var k = newKin(L, 'child', sx, y, freshXiao(L, sx), { sur: kidSur(L, 'child') });
    k.lav = R();
    var xn = k.xiao;
    if (eliteFam(L)) giveName(L, k);
    L.kidsBorn++;
    L.rec.tags.push('kid');
    var nth = L.kidsBorn;
    var nm2 = k.full ? '取名' + k.full + '，小名' + xn : '取小名' + xn;
    if (L.sex === 'F') add(L, 2, 'good', '你生下了' + (nth === 1 ? '第一个孩子，' : '') + '一个' + (sx === 'M' ? '儿子' : '女儿') + '，' + nm2 + '。');
    else add(L, 2, 'good', '妻子' + L.spouseK.name + '生下了一个' + (sx === 'M' ? '儿子' : '女儿') + '，' + nm2 + '。' + (nth === 1 ? '你第一次成为了父亲。' : ''));
    var mother = L.sex === 'F' ? null : L.spouseK;
    var pm = 0.012 * (L.rec.tags.indexOf('hard') >= 0 ? 2 : 1) * (L.wealth >= 60 ? 0.6 : L.wealth < 15 ? 1.3 : 1);
    if (L.sex === 'F') { if (R() < pm * bodyMul(L)) die(L, 'childbirth', 2.05); }
    else if (R() < pm) kinDie(L, mother, 'childbirth', 2.05, y);
    if (R() < 0.08) { k.alive = false; k.dy = y; add(L, 2.1, 'fam', '孩子生下来没几天就夭折了。'); L.rec.tags.push('loss'); }
  }

  function personal(L, y) {
    var R = L.R, a = L.age;
    if (a < 6) return;
    var farm = ['peasant', 'tenant', 'tuntian', 'soldier', 'clerk'].indexOf(L.cls) >= 0 && !L.soldier;
    var poor = L.wealth < 25 && L.cls !== 'gentry';
    var tk = lifeTier(L, y).k, rich = tk === 'high' || tk === 'top';
    var r = R();
    if (r < 0.05 && cool(L, 'ill', 3)) { L.body -= rich ? 4 : poor ? 8 : 6; add(L, 2.2, 'bad', fresh(L, ['你大病一场，在床上躺了一个多月。', '你染上了疟疾，熬了一个夏天才好。', '你咳了一整个冬天，开春才慢慢好起来。', '你吃坏了肚子，泻了半个月，人瘦了一圈。'].concat(poor ? ['你病了，请不起医，只能躺着硬扛。', '你的腿上生了疮，没钱买药，溃烂了好几个月。'] : rich ? ['你病了一场。家里请了城里的医者，吃了几十服药才好。', '你病了，家里杀羊祷祀，又请了巫祝和医者，忙了一个多月。'] : ['你的腿上生了疮，溃烂了好几个月。']).concat(poor && a >= 14 ? ['你病得起不来床，地里的活全落在了家人身上。'] : []))); }
    else if (r < 0.13 && farm && a >= 12 && cool(L, 'good', 3)) { L.yHarvest = 1.2; if (L.reg) L.reg.price = clamp(L.reg.price * 0.92, 0.6, 8); add(L, 3, 'good', fresh(L, ['这一年风调雨顺，收成不错。', '今年雨水正好，粟穗压弯了腰。', '麦子收得多，晒谷场上堆得冒了尖。', '难得的好年景，乡里家家都酿了一点酒。'])); }
    else if (r < 0.19 && farm && a >= 12 && cool(L, 'bad', 3)) { L.yHarvest = 0.6; if (L.reg) L.reg.price = clamp(L.reg.price * 1.12, 0.6, 8); add(L, 3, 'bad', fresh(L, ['今年先旱后涝，收成只有往年的一半。', '一场冰雹打烂了快要成熟的麦子。', '夏天闹了虫，粟叶被啃得只剩筋。', '入秋连下了一个月的雨，谷子烂在了田里。', '春天一滴雨也没下，种子撒下去好些没出苗。'])); }
    else if (r < 0.2 && L.cls !== 'slave' && cool(L, 'fire', 15)) { L.eco.cash = Math.round(L.eco.cash * 0.6); L.eco.house = Math.max(500, L.eco.house - 1000); add(L, 1.8, 'bad', fresh(L, rich ? ['庄上的仓房失了火，烧掉了几百斛粮。', '后院的柴房起了火，僮仆们提水扑了半夜。'] : ['家里失了火，烧掉了半间屋子和存粮。', '灶膛的火星溅到了柴堆上，半个院子都烧了。'])); }
    else if (r < 0.2 + 0.015 * chaos(y) && cool(L, 'rob', 6)) {
      var lost = Math.round(Math.min(L.eco.priv + L.eco.cash, (rich ? 2000 : 300) + R() * (rich ? 8000 : 2500)));
      if (lost >= 30) {
        payFrom(L, lost); if (L.reg) L.reg.order = clamp(L.reg.order - 2, 5, 95);
        add(L, 2.4, 'bad', fresh(L, L.cls === 'slave' ? ['你偷偷攒下的' + fmt(lost) + '个钱，被同屋的人摸走了。你不敢声张。'] : a < 14 ? ['夜里有贼翻墙进来，偷走了' + fmt(lost) + '钱值的东西。父母心疼了好些天。'] : rich ? ['你家的车队在路上遭了劫，丢了' + fmt(lost) + '钱值的货物。', '夜里有贼翻进庄园，偷走了' + fmt(lost) + '钱值的东西。'] : ['你在路上遇到盗贼，被抢走了' + fmt(lost) + '钱值的财物。', '夜里有贼翻墙进来，偷走了' + fmt(lost) + '钱值的东西。']));
      }
    }
    else if (r < 0.24 && farm && L.eco.ox > 0 && cool(L, 'ox', 8)) { L.eco.ox--; add(L, 1.2, 'bad', fresh(L, ['家里的耕牛病死了。你蹲在牛棚里，半天没有说话。', '耕牛在山坡上摔断了腿，只好杀了。肉卖了钱，可开春拿什么犁地？'])); }
    else if (r < 0.25 && L.cls !== 'slave' && cool(L, 'luck', 15)) { L.eco.cash += Math.round(1500 + R() * 3500); add(L, 2, 'good', fresh(L, a < 14 || rich ? ['家里翻修老屋，在墙脚下挖出了一小罐前人藏的五铢钱。', '远房的亲戚过世，留给你家一些钱财。'] : ['你在田里挖出了一小罐前人埋下的五铢钱。', '远房的亲戚过世，留给你家一些钱财。'])); }
    else if (r < 0.27 && L.cls === 'merchant' && cool(L, 'trade', 3)) { var w = R() < 0.55 ? 1 : -1; L.eco.stock = Math.round(L.eco.stock * (w > 0 ? 1.25 : 0.7)); add(L, 2, w > 0 ? 'good' : 'bad', fresh(L, w > 0 ? ['你倒卖了一批布帛，赚了不少。', '你赶在涨价前囤了一批盐，赚了一笔。'] : ['一船货在江上翻了，血本无归。', '你进的一批漆器在路上碰坏了大半。'])); }
    else if (r < 0.29 && a >= 15 && cool(L, 'kind', 5)) { L.standing += 4; add(L, 2.5, 'good', fresh(L, ['你帮乡里调解了一场田界纠纷，大家都说你公道。', '邻家断了粮，你分了他们两斗米。', '你帮一户孤寡人家修好了屋顶。', '村里有人病倒，你背着他走了十里路去找医者。'])); }
    else if (r < 0.32 && poor && a >= 14 && cool(L, 'hard', 4)) { L.body -= 2; add(L, 2.7, 'bad', fresh(L, ['你给豪强家做了一个月的短工，工钱被管事克扣了一半。', '你去县城卖柴，被市吏以"占道"为名收走了一捆。', '你一双草鞋穿了三年，补了又补。', '你家的盐吃完了，好几个月吃饭没有一点咸味。', '你看着别人家的孩子穿上新衣，你家的孩子还光着脚。', '里正来催徭役，说是修驿道，一去就是一个月。'])); }
    var ord = L.reg ? L.reg.order : 70;
    if (ord < 45 && a >= 10 && L.cls !== 'slave' && R() < (45 - ord) / 260 * (L.flags.youxia ? 0.4 : 1) && cool(L, 'rob2', 4)) {
      var lost2 = Math.round(Math.min(L.eco.priv + L.eco.cash, (rich ? 3000 : 300) + R() * (rich ? 10000 : 1500)));
      if (lost2 >= 30) { payFrom(L, lost2); add(L, 2.45, 'bad', fresh(L, ['世道不靖，一伙盗贼夜里闯进村来，你家被抢走了' + fmt(lost2) + '钱值的东西。', '你去集上的路上被几个持刀的人拦住，身上的' + fmt(lost2) + '钱值全被搜走了。', '盗贼放火烧了邻家的草房，趁乱从你家抢走了' + fmt(lost2) + '钱值的粮食和布帛。'])); }
    }
    if (L.reg && L.reg.ref >= 6 && a >= 10 && R() < 0.15 && cool(L, 'refugee', 3)) add(L, 3.5, 'life', fresh(L, rich ? ['门外又来了一群流民，跪着求你家收留。管家挑了几个壮实的，收作了佃客。', '流民太多，庄上的佃客说，往后雇人的工钱可以再压一压。'] : ['城外又搭起了几个草棚，都是从外地逃来的人。', '流民来村里讨饭，你家给了半碗粥。', '流民太多，佣工的价钱一落千丈，你去做短工，一天只给一升粟。']));
    if (L.flags.nocoat && R() < 0.5) { L.body -= 3; L.flags.nocoat = false; add(L, 3.6, 'bad', '冬衣当掉了，那个冬天你冻得整夜睡不着，手脚生满了冻疮。'); }
  }

  function conscriptRate(z, y) { return conscriptBase(z, y) * polMul(z, y, 'cons'); }
  function conscriptBase(z, y) {
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
      kinJobYear(L, k, y);
      // 起名、取字
      if ((k.rel === 'child' || k.rel === 'sib') && !k.apart) {
        var mine = k.rel === 'child';
        if (!k.full && ka === 7 && (k.sex === 'M' || R() < 0.5)) {
          giveName(L, k);
          if (mine) add(L, 1.05, 'fam', (k.sex === 'M' ? '儿子' : '女儿') + k.xiao + '七岁了，要入户籍。你给' + (k.sex === 'M' ? '他' : '她') + '取了个大名，叫' + k.full + '。');
        }
        if (!k.zi && k.full && !L.eth && ((k.sex === 'M' && ka === 20 && R() < (k.lit || L.literate || L.cls === 'gentry' || L.cls === 'clerk' ? 0.9 : 0.3)) || (k.sex === 'F' && ka === 15 && L.cls === 'gentry' && R() < 0.7))) {
          k.zi = giveZi(L, k.sex);
          if (mine) add(L, 1.1, 'fam', k.sex === 'M' ? '儿子' + k.full + '行了冠礼，取字' + k.zi + '。' : '女儿' + k.full + '行了笄礼，取字' + k.zi + '。');
        }
      }
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
      var q = (ka === 1 ? baseQ(0) : baseQ(ka)) * (CLS_Q[L.cls] || 1) * chaos(y) * (k.soldier ? 1.5 : 1) * (k.rel === 'child' && L.rec.focus && L.rec.focus.eff === 'kids' ? 0.85 : 1) * (k.rel === 'child' && ka < 10 ? (L.wealth >= 60 ? 0.6 : L.wealth < 15 ? 1.25 : 1) : 1);
      if (k.cared && y - k.cared <= 3) q *= 0.65;
      if (R() < q) kinDie(L, k, 'base', 1 + Math.floor(R() * 3) + 0.5, y);
    });
    // 弟妹出生
    var f = L.kin[0], m = L.kin[1];
    if (L.age < 20 && f.alive && m.alive && !m.apart && !m.out && y - m.by <= 42 && y - m.by >= 16) {
      var nb = L.kin.filter(function (k) { return k.rel === 'sib' && k.by > L.by; }).length;
      if (nb < 6 && R() < 0.27) {
        var sx = R() < 0.51 ? 'M' : 'F';
        var k = newKin(L, 'sib', sx, y, freshXiao(L, sx), { sur: L.sur });
        if (eliteFam(L)) giveName(L, k);
        add(L, 0.9, 'fam', '母亲生下了一个' + (sx === 'M' ? '弟弟' : '妹妹') + '，小名' + k.name + '。');
      }
    }
  }

  /* ================= 性情与天资 ================= */
  var TRAITS = ['cur', 'cau', 'act', 'per', 'soc', 'ind', 'cmp'];
  var TRAIT_WORD = { cur: '好问', cau: '谨慎', act: '好动', per: '执拗', soc: '随和', ind: '有主见', cmp: '好胜' };
  function traitWords(L) {
    if (L.age < 6) return [];
    var t = L.tr, ks = TRAITS.slice().sort(function (a, b) { return t[b] - t[a]; });
    var w = ks.filter(function (k) { return t[k] >= 57; }).slice(0, 2).map(function (k) { return TRAIT_WORD[k]; });
    if (L.age >= 15) { if (t.cau - t.soc > 10) w.push('节俭'); else if (t.soc - t.cau > 12) w.push('豪爽'); }
    if (L.age >= 12 && t.cmp >= 70 && t.soc < 48) w.push('善妒');
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
    army: { n: '军中立足', v: '在军中立足', pull: '军令如山' },
    enlist: { n: '投军从戎', v: '投军', pull: '你一心想去从军' },
    weave: { n: '纺绩织作', v: '纺纱织布', pull: '家里等着布交户调' },
    travel: { n: '游历四方', v: '出门游历', pull: '你按捺不住出门的念头' },
    leisure: { n: '琴书自娱', v: '读书弹琴', pull: '你只想清清静静地过日子' },
    estate: { n: '经营产业', v: '经营田庄产业', pull: '田庄上的事离不开你' }
  };
  var WHY = { play: '你还小，正是贪玩的年纪', help: '家里缺人手', study: '你好问爱学', craft: '你手巧，总爱摆弄器物', body: '你闲不住', social: '你生性随和，喜欢热闹', livelihood: '你得自己挣口饭吃', house: '一家老小都指望着你', save: '你生性谨慎，总想着留些余粮', career: '你心里一直想做出一番事业', kids: '孩子还小', fame: '你很在意乡里的评价', health: '你近来身体不如从前', family: '儿孙绕膝', teach: '你肚子里有些学问', village: '乡里人信得过你', rest: '你年纪大了', army: '身在军中', enlist: '你不甘心一辈子守着几亩地', grow: '你还在襁褓之中', weave: '一家人的衣裳和户调的绢帛，都指望你的一双手', travel: '你想出门看看外面的天下', leisure: '家中殷实，你有闲暇', estate: '家中田产众多，总得有人照看' };
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
    if (L.sex === 'M' && a >= 16 && a <= 40 && L.cls !== 'slave' && !L.soldier) o.push('enlist');
    var rich = L.cls === 'gentry' || L.wealth >= 60 || !!L.office;
    if (L.sex === 'F') {
      o = o.filter(function (k) { return k !== 'body' && k !== 'career' && k !== 'livelihood' && k !== 'fame'; });
      if (!(L.cls === 'gentry' || L.schooling || L.literate)) o = o.filter(function (k) { return k !== 'study'; });
      if (a >= 12 && a < 60 && L.cls !== 'gentry') o.splice(1, 0, 'weave');
    }
    if (L.sex === 'M' && a >= 15 && a < 45 && L.literate && !rich && L.cls !== 'slave' && !L.eth && L.wealth >= 22) o.push('travel');
    if (rich && a >= 15 && a < 18 && L.sex === 'M' && L.cls !== 'slave') o.push('travel');
    if (rich && a >= 18 && a < 70 && L.cls !== 'slave') {
      o = o.filter(function (k) { return k !== 'help' && k !== 'livelihood'; });
      if (L.sex === 'M' && a < 55) o.push('travel');
      o.push('leisure');
      if (L.cls === 'gentry' && a >= 25) o.push('estate');
    }
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
      case 'career': s += (t.ind - 50) / 12 + (L.cls === 'gentry' ? 2.5 : 0) + L.fame / 25 + (L.office ? 1.5 : 0) + (L.flags.spur ? 1.5 : 0) + (t.cmp - 50) / 20; break;
      case 'kids': s += kidsUnder(L, 6) * 1.2 + (L.sex === 'F' ? 1 : 0); break;
      case 'fame': s += (t.soc - 50) / 15 + L.standing / 40 + (L.cls === 'gentry' ? 1 : 0); break;
      case 'health': s += (L.body < 35 ? 2.5 : 0) + (a - 45) / 15 + (L.injury ? 1 : 0); break;
      case 'family': s += 1 + kidsUnder(L, 99) / 3; break;
      case 'teach': s += L.learn / 30; break;
      case 'village': s += L.standing / 40 + (t.soc - 50) / 20; break;
      case 'rest': s += (a - 60) / 10; break;
      case 'army': s += 3; break;
      case 'weave': s += 2 + (poor ? 1 : 0); break;
      case 'enlist': s += (t.act - 50) / 10 + (t.ind - 50) / 15 + (L.flags.martial ? 3 : 0) + (L.found.strength ? 1.5 : 0) - 1.5; break;
      case 'travel': s += (t.cur - 50) / 10 + (t.act - 50) / 15; break;
      case 'leisure': s += (t.cau - 50) / 15 + (a > 40 ? 1 : 0); break;
      case 'estate': s += 1.5 + (t.per - 50) / 15; break;
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
        // 人不一定全听你的，但你坚持得越久、去年刚拗过一回，就越听话
        var g = focusScore(L, au.key) - focusScore(L, man);
        var pd = clamp(0.03 + g * 0.03, 0.02, 0.18) * (L.devY === y - 1 ? 0.4 : 1) * ((L.manYears || 0) >= 3 ? 0.6 : 1);
        if (L.R() < pd) { eff = au.key; dev = true; L.devY = y; }
      }
    }
    L.manYears = man && man === L.manPrev ? (L.manYears || 0) + 1 : man ? 1 : 0;
    L.manPrev = man;
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
      case 'social':
        L.standing += 1.5 + (L.found.charm ? 1 : 0); t.soc += 0.6;
        if (R() < 0.4) add(L, 2.25, 'life', fresh(L, a < 15 ? ['你整天和里中的孩子们混在一起，谁家有事都少不了你。', '你成了一群孩子的头儿，带着他们上山掏鸟窝、下河摸鱼。'] : L.cls === 'gentry' || L.literate ? ['你常与郡中的少年士子往来，品评人物，议论时事。', '你在宴席上谈吐得体，郡中的长辈都记住了你。', '你和几个朋友结伴去拜访名士，听他们清谈到深夜。'] : ['你常和同乡的后生们来往，一起喝酒、射猎、谈天。', '你帮朋友办成了一件难事，他逢人就说你够朋友。', '乡里有什么事，大家都愿意找你商量。']));
        break;
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
      case 'weave': L.eco.priv += Math.round(150 + R() * 250); break;
      case 'enlist':
        if (!L.soldier && R() < (chaos(y) > 1.05 || L.eth ? 0.7 : 0.45)) {
          var hadOff = L.office;
          if (hadOff) { add(L, 1.28, 'life', '你辞去了' + hadOff + '的差事，投笔从戎。'); L.office = null; }
          if (L.eth) add(L, 1.28, 'life', '你带着族中的几个子弟，投到了' + fname(ctrl(L.zone, y), y) + '的军中。官府向来看重' + D.ETH[L.eth].n + '的骑射和勇力。');
          enlist(L, y, 1.3, true);
          if (hadOff && !L.mil) { L.mil = L.cls === 'gentry' && L.gate >= 2 ? 2 : 1; L.job = ['军卒', '屯长', '军司马'][L.mil]; L.milMax = L.job; add(L, 1.35, 'good', '凭着做过官的资历，你一入营便做了' + L.job + '。'); }
          if (!L.mil && (L.cls === 'gentry' || (L.flags.martial && L.found.strength))) { L.mil = 1; L.job = '屯长'; L.milMax = '屯长'; add(L, 1.35, 'good', '凭着出身和一身本事，你一入营便做了屯长。'); }
        } else if (!L.soldier) add(L, 1.3, 'life', '你去营中打听从军的事，这一年没有募兵。');
        break;
      case 'travel':
        var richT = L.cls === 'gentry' || L.wealth >= 60 || !!L.office;
        L.learn += richT ? 2 : 2.5; L.fame += 1; L.standing += 1; t.cur += 0.4; t.act += 0.3;
        payFrom(L, richT ? 2000 : 600);
        var tsp = R() < 0.45 ? visit(L, y) : null;
        if (tsp) add(L, 2.2, 'life', tsp.t);
        else if (R() < 0.6) add(L, 2.2, 'life', fresh(L, richT ? ['你乘车出门游历，到过洛阳，在太学门外看了石经。', '你乘车游历了邻近几个郡，拜访了几位名士。', '你沿着江水走了一趟，见识了许多从未见过的风物。', '你带着两个僮仆远游，登过泰山，也在鲁国拜过孔子的旧宅。', '你游历到襄阳，在那里住了几个月，听北方来的儒生讲学。'] : ['你背着书箱步行游学，一路借宿在寺观和农家。', '你走了几百里路去拜一位经师，在他门下抄了一个冬天的书。', '你跟着贩货的商队出门，一路帮人写信、记账，见了不少世面。', '你在外游学一年，鞋磨破了三双，回来时人黑瘦了，眼界却宽了。']));
        if (R() < 0.12 && richT) { L.flags.connected = true; add(L, 2.3, 'good', '游历途中，你结交了几位外郡的名士，往后常有书信往来。'); }
        break;
      case 'leisure': L.body += 1; L.learn += 1; L.standing += 0.5; break;
      case 'estate': L.eco.cash += Math.round(L.land * 4); if (R() < 0.15) { L.land += 10; add(L, 2.2, 'life', '你又置下了十亩良田。'); } break;
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
  var SAL = { 书佐: 9000, 计吏: 12000, 县长: 40000, 郎官: 30000, 县令: 60000, 幕僚: 30000, 郡守: 120000, 尚书郎: 50000, 刺史: 150000, 九卿: 200000 };
  var JOBINC = { 医者: 1500, 巫祝: 800, 门客: 2000, 塾师: 900, 稳婆: 600, 山贼: 1500, 官匠: 1800, 代书先生: 1000, 游侠: 1200, 中人: 1200, 方士: 1000, 媒人: 600, 经师: 3000 };
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
    if (L.reg && L.reg.z === L.zone && L.regHist && L.regHist.length && L.regHist[L.regHist.length - 1].y === y) p = Math.max(p * 0.5, L.reg.price);
    return { h: h, p: Math.min(p, 8) };
  }
  function taxes(L, y, m, H, owner) {
    var g = group(ctrl(L.zone, y)), out = [];
    if (L.eth) return [['向官府纳贡', 200]];
    if (L.cls === 'tuntian') return [];
    if (L.flags.fugitive) return [];
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
    var lt = polSum(L.zone, y, 'landTax');
    if (lt && owner && L.land) out.push(['修宫钱（亩' + lt + '钱）', L.land * lt]);
    var tm = L.cls === 'gentry' ? 1.5 * polMul(L.zone, y, 'gtax') : polMul(L.zone, y, 'tax');
    if (tm !== 1) out.forEach(function (x) { x[1] = Math.round(x[1] * tm); });
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
    var RGN = D.REGION && D.REGION[L.zone];
    var hf = sh.h * (RGN ? RGN.yield : 1) * (L.yHarvest || 1) * (0.85 + R() * 0.3) * (E.tools ? 1.08 : 1) * (fo === 'house' ? 1.06 : 1) * polMul(L.zone, y, 'harvest');
    L.yHarvest = 1;
    var inc = [], exp = [], H = 0, note = '';
    var cap = (m.wM * 45 + m.wF * 12) * (E.ox > 0 ? 1.35 : 1);
    var owner = ['peasant', 'clerk', 'soldier', 'artisan', 'merchant'].indexOf(c) >= 0;
    if (c === 'gentry') { H = L.land * 2.5 * 0.5 * 0.8 * hf; note = '佃客交租'; }
    else if (c === 'tenant') { var sh6 = L.flags.rent6 ? 0.4 : 0.5; H = Math.min(cap, 70) * 2.5 * hf * sh6; note = L.flags.rent6 ? '佃种豪强之田，主家收六成' : '佃种豪强之田，见税什五'; }
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
    if (H > 0) inc.push(['田收 ' + H + ' 石' + (RGN && c !== 'tribal' ? RGN.staple : '') + (note ? '（' + note + '）' : ''), H * PRICE]);
    exp.push(['口粮 ' + C + ' 石（' + m.n + ' 口人）', C * PRICE]);
    if (C > H && sh.p > 1.05) exp.push(['粮价腾贵（谷价约为平年的' + sh.p.toFixed(1) + '倍）', Math.round((C - H) * PRICE * (sh.p - 1) * 0.5)]);
    if (H > C && sh.p > 1.05) inc.push(['余粮卖得好价', Math.round((H - C) * PRICE * (Math.min(sh.p, 1.6) - 1))]);
    if (m.wF > 0 && c !== 'gentry') inc.push(['纺织（家中女子所织）', Math.round(m.wF * 700 * (E.loom ? 1.3 : 1) * (sh.h < 0.6 ? 0.7 : 1) * (fo === 'weave' ? 1.4 : 1))]);
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
    var sup = elderSupport(L, y);
    if (sup) inc.push(['子女奉养', sup]);
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
    var buffer = (E.cash - reserve(L)) / Math.max(1, C * PRICE / 12);
    if (D.LEAN && a >= 4 && c !== 'gentry' && c !== 'merchant' && L.grainMonths < 11 && buffer < 4) {
      var sev = L.grainMonths >= 8 ? 'mild' : L.grainMonths >= 5 ? 'hard' : 'severe';
      L.body -= { mild: 0.5, hard: 1.5, severe: 3 }[sev];
      var RG2 = D.REGION && D.REGION[L.zone];
      add(L, 0.8, 'bad', fresh(L, D.LEAN[sev].concat(RG2 && sev !== 'severe' ? RG2.lean : [])));
      L.rec.tags.push('hard');
    }
    rec.ledger = { inc: inc, exp: exp, I: I, X: X, net: net, head: head };
    if (E.debt > Math.max(4000, C * PRICE * 0.8) && a - (L.lastCrisis == null ? -9 : L.lastCrisis) >= 3) { L.crisis = true; L.lastCrisis = a; }
    pendYear(L, y);
    if (!L.auto && L.autoSpendOn) smartSpend(L, y, fo); else autoSpend(L, y, fo);
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
      case 'friend':
        var bf = bestFriend(L, 0);
        if (bf && R() < 0.6) { var got = Math.min(E.debt, 1500 + Math.round(R() * 2000)); E.debt -= got; affAdd(bf, -5); add(L, 0.5, 'good', bf.name + '把家里的积蓄拿出来，替你还了' + fmt(got) + '钱值的债。你说不出话来。'); }
        else if (bf) { affAdd(bf, -3); add(L, 0.5, 'bad', bf.name + '也拿不出钱来，陪你坐了一夜。'); }
        break;
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
    { id: 'piglet', g: '农事', n: '买一头猪崽来养', c: 300, ok: function (L) { return farmerish(L) && !L.band && !pendHas(L, 'piglet'); }, fx: function (L, y) { pendAdd(L, { id: 'piglet', y: y + 1, cash: 700, t: '去年买的猪崽养肥了，年底卖了七百钱。' }); return '你买了一头猪崽，打算养到年底卖钱。'; } },
    { id: 'nourish', g: '日用', n: '买些补药养身', c: 2500, ok: function (L) { return richish(L) && L.age >= 35; }, fx: function (L) { L.body += 5; return '你买了些人参、茯苓，每天熬汤进补。'; } },
    { id: 'medicine', g: '家人', n: '给年老的爹娘请医买药', c: 1200, ok: function (L) { return !!oldParent(L); }, fx: function (L, y) { var k = oldParent(L); k.cared = y; affAdd(k, 10); L.standing += 1; return '你请了医者来给' + kinLabel(L, k) + '看病，又抓了几服药。老人嘴上说不要花这个钱，眼眶却红了。'; } },
    { id: 'redeem', g: '家人', n: '赎回被卖、被送走的亲人', c: 8000, ok: function (L) { return !!lostKin(L); }, fx: function (L) { var k = lostKin(L); k.apart = false; k.sold = k.given = k.bonded = false; affAdd(k, 25); L.standing += 2; return '你四处打听，终于找到了' + kinLabel(L, k) + '，花了八千钱把人赎了回来。一家人抱头痛哭。'; } },
    { id: 'dowry', g: '子女', n: '给女儿备一份体面的嫁妆', c: 4000, ok: function (L) { return !!dowryGirl(L); }, fx: function (L) { var k = dowryGirl(L); k.dowry = true; affAdd(k, 15); L.standing += 2; return '你给' + kinLabel(L, k) + '备下了一份嫁妆：铜镜、漆奁、几匹绢。她将来到了夫家，腰杆能直一些。'; } },
    { id: 'loan', g: '家业', n: '放一笔债（一万钱，两年后收回）', c: 10000, ok: function (L) { return richish(L) && L.age >= 20 && !pendHas(L, 'loan'); }, fx: function (L, y) { pendAdd(L, { id: 'loan', y: y + 2, cash: 13000, risk: 0.15, t: '两年前放出去的债收回来了，连本带利一万三千钱。', fail: '借债的那户人家举家逃走了，一万钱打了水漂。' }); return '你把一万钱借给了邻县的一户人家，约好两年后连本带利归还。'; } },
    { id: 'land100', g: '农事', n: '买一百亩田', c: LANDP * 100, ok: function (L) { return ['clerk', 'gentry', 'merchant'].indexOf(L.cls) >= 0 && !L.band; }, fx: function (L) { L.land += 100; return '你买下了一百亩田，招了几户佃客来种。'; } },
    { id: 'wubi', g: '家业', n: '修筑坞壁', c: 60000, ok: function (L, y) { return (L.cls === 'gentry' || L.wealth >= 60) && !L.flags.wubi && y >= 184 && !L.band; }, fx: function (L) { L.flags.wubi = true; L.standing += 4; return '你家征发佃客，在庄外筑起了高墙，四角立起望楼。乱兵来了，至少能关起门来守几天。'; } },
    { id: 'retainers', g: '交游', n: '蓄养宾客部曲', c: 30000, ok: function (L) { return (L.cls === 'gentry' || L.wealth >= 65) && L.sex === 'M' && !L.flags.retainers; }, fx: function (L) { L.flags.retainers = true; L.flags.connected = true; L.standing += 8; L.fame += 3; return '你家门下养了几十个宾客、上百个部曲。出门时前呼后拥，郡里的人都要让你三分。'; } },
    { id: 'salon', g: '交游', n: '招邀名士清谈雅集', c: 8000, ok: function (L) { return L.literate && (L.cls === 'gentry' || !!L.office || L.fame >= 30) && !L.flags.salon; }, fx: function (L) { L.flags.salon = true; L.fame += 3; L.standing += 2; return '你在家中设雅集，招邀郡中名士清谈。往后名士们路过本郡，常来你家坐坐。'; } },
    { id: 'library', g: '读书', n: '修一座藏书楼', c: 40000, ok: function (L) { return L.cls === 'gentry' && L.literate && !L.flags.library; }, fx: function (L) { L.flags.library = true; L.learn += 10; L.fame += 4; kidsWith(L, function (a) { return a >= 5; }).forEach(function (k) { k.lit = true; }); return '你修了一座藏书楼，收藏了上千卷书。远近的读书人都来借抄，家中子弟也都读了书。'; } },
    { id: 'tomb', g: '身后', n: '为先人修墓立碑', c: 20000, ok: function (L, y) { return richish(L) && !L.flags.tomb && deadParent(L) && !polsAt(L.zone, y).some(function (p) { return p.id === 'bozang'; }); }, fx: function (L) { L.flags.tomb = true; L.standing += 6; L.fame += 4; return '你为先人修了一座大墓，立了石阙，请人撰写碑文，颂扬先人的德行。乡里人都说你是孝子。'; } },
    { id: 'jushi', g: '仕途', n: '上下打点，谋一个举荐', c: 15000, ok: function (L, y) { return y < 220 && L.sex === 'M' && L.age >= 18 && L.age <= 45 && !L.office && (L.cls === 'gentry' || L.cls === 'clerk' || L.learn >= 40) && !L.flags.jushi; }, fx: function (L) { L.flags.jushi = true; return '你带着厚礼去拜见郡中的功曹，又托人在太守面前说了好话。能不能被举荐，就看来年了。'; } },
    { id: 'zzbribe', g: '仕途', n: '打点中正官', c: 30000, ok: function (L, y) { return y >= 220 && L.cls === 'gentry' && L.sex === 'M' && L.age >= 18 && L.age <= 45 && !L.office && !L.flags.zz; }, fx: function (L) { L.flags.zz = true; return '你托人给州里的中正官送去厚礼。不久，你的品第被评高了一等。'; } },
    { id: 'trip', g: '游历', n: '出门游历一番', c: function (L) { return richish(L) ? 6000 : 1500; }, ok: function (L, y) { return L.age >= 16 && !L.band && !L.soldier && L.cls !== 'slave' && spotsFor(L, y).length > 0 && (L.sex === 'M' || L.cls === 'gentry'); }, fx: function (L, y) { var p = visit(L, y); L.learn += 2; L.standing += 1; L.body += 1; if (richish(L)) L.fame += 1; return p ? p.t : '你出门走了一趟。'; } },
    { id: 'temple', g: '捐资', n: '捐资修缮社祠、祖祠', c: 3000, ok: function (L) { return L.age >= 20 && L.cls !== 'slave'; }, fx: function (L) { L.standing += 4; return '你出钱修缮了乡里的社祠和祖祠。逢年过节祭祀时，总要念到你的名字。'; } },
    { id: 'yishu', g: '捐资', n: '捐资办义塾', c: 6000, ok: function (L) { return richish(L) && L.age >= 25 && !L.flags.yishu; }, fx: function (L) { L.flags.yishu = true; L.standing += 5; L.fame += 2; kidsWith(L, function (a) { return a >= 5 && a <= 14; }).forEach(function (k) { k.lit = true; }); return '你出钱在乡里办了一所义塾，请先生教穷人家的孩子认字，自家的孩子也去了。'; } },
    { id: 'junzi', g: '捐资', n: '向官府捐献军资', c: 10000, ok: function (L, y) { return richish(L) && L.age >= 20 && chaos(y) > 1.0 && !L.flags.donor; }, fx: function (L) { L.flags.donor = true; L.fame += 3; L.standing += 2; return '你捐了一万钱的粮草给官府充作军资。郡守亲自写信致谢，往后你家的事，官府都格外关照。'; } },
    { id: 'bury', g: '捐资', n: '收葬路边的饿殍', c: 1500, ok: function (L) { return L.age >= 18 && L.reg && (L.reg.ref >= 5 || L.reg.price >= 1.5); }, fx: function (L) { L.standing += 4; L.fame += 1; return '你出钱买了几十口薄棺，把路边饿死的人收葬了。'; } },
    { id: 'zhoupeng', g: '捐资', n: '设粥棚赈济流民', c: 4000, ok: function (L) { return richish(L) && L.reg && (L.reg.ref >= 4 || L.reg.price >= 1.4); }, fx: function (L) { L.standing += 5; L.fame += 2; L.reg.ref *= 0.9; return '你在门外设了粥棚。每天清早，门口都排着长长的队伍。'; } },
    { id: 'xianli', g: '交游', n: '宴请县里的小吏', c: 1200, ok: function (L) { return L.age >= 20 && L.cls !== 'slave' && !L.office; }, fx: function (L) { L.standing += 2; L.flags.xianli = true; return '你请县里的几个小吏喝了一顿酒。往后去县廷办事，人家对你客气多了。'; } },
    { id: 'sanlao', g: '交游', n: '拜会乡里的三老', c: 300, ok: function (L) { return L.age >= 18 && L.cls !== 'slave'; }, fx: function (L) { L.standing += 2; return '你提着酒肉去拜会乡里的三老，听他讲了半天的旧事。'; } },
    { id: 'jiebai', g: '交游', n: '与好友结为异姓兄弟', c: 500, ok: function (L) { var f = bestFriend(L, 55); return L.age >= 15 && f && !f.sworn; }, fx: function (L) { var f = bestFriend(L, 55); f.sworn = true; affAdd(f, 20); return '你和' + f.name + '杀鸡饮酒，结为异姓' + (L.sex === 'F' ? '姐妹' : '兄弟') + '，发誓有难同当。'; } },
    { id: 'frgift', g: '交游', n: '给好友送一份礼', c: 400, ok: function (L) { return !!bestFriend(L, 0); }, fx: function (L) { var f = bestFriend(L, 0); affAdd(f, 12); return '你给' + f.name + '送去了一份礼。他' + (f.sex === 'F' ? '（她）' : '') + '高兴了好几天。'; } },
    { id: 'youxia', g: '交游', n: '结交游侠', c: 3000, ok: function (L) { return L.sex === 'M' && L.age >= 16 && L.age <= 45 && !L.office && !L.flags.youxia && L.cls !== 'slave'; }, fx: function (L) { L.flags.youxia = true; L.standing += 2; L.tr.act = clamp(L.tr.act + 2, 5, 95); return '你出钱结交了几个游侠。他们拍着胸脯说，往后在这一带，没人敢动你家。'; } },
    { id: 'gift', g: '身后', n: '给孙辈压岁钱', c: 100, ok: function (L) { return L.grandkids > 0; }, fx: function () { return '你给孙辈们每人串了一串压岁钱。'; } }
  ];
  // 游历之地：要看年代和是否同属一方
  var SPOTS = [
    { n: '洛阳', z: 'luoyang', y: [[150, 189], [205, 310]], t: '你到洛阳游历，在太学门外看了石经，又去白马寺看了西域来的僧人。' },
    { n: '长安', z: 'guanzhong', y: [[150, 189], [220, 315]], t: '你到长安，看了未央宫的旧址，荒草长得比人还高。' },
    { n: '许都', z: 'yu', y: [[196, 220]], t: '你到许都，城里车马喧阗，天子就住在这里。' },
    { n: '邺城', z: 'ji', y: [[205, 350]], t: '你到邺城，登上铜雀台，漳水在台下静静地流。' },
    { n: '泰山', z: 'yan', y: [[150, 350]], t: '你登了泰山，在日观峰上等了一夜，看到了日出。' },
    { n: '曲阜', z: 'yu', y: [[150, 350]], t: '你到鲁国曲阜，拜了孔子的旧宅，看了孔子手植的桧树。' },
    { n: '襄阳', z: 'jingbei', y: [[150, 350]], t: '你到襄阳，登了岘山，在汉水边坐了一下午。' },
    { n: '江陵', z: 'jingnan', y: [[150, 350]], t: '你到江陵，看大江东去，船帆如林。' },
    { n: '成都', z: 'shu', y: [[150, 350]], t: '你到成都，看了锦官城里织锦的作坊，又去看了李冰修的都江堰。' },
    { n: '建业', z: 'jiangdong', y: [[229, 312]], t: '你到建业，石头城下江水滔滔，市上满是南来北往的客商。' },
    { n: '建康', z: 'jiangdong', y: [[313, 350]], t: '你到建康，看秦淮河上的画舫，听南渡的士人清谈。' },
    { n: '会稽', z: 'jiangdong', y: [[150, 350]], t: '你到会稽，拜了禹陵，又在镜湖上泛舟。' },
    { n: '庐山', z: 'jiangdong', y: [[150, 350]], t: '你上了庐山，在山中住了几天，看瀑布从云里落下来。' },
    { n: '汉中', z: 'hanzhong', y: [[150, 350]], t: '你到汉中，沿着栈道走了一段，又去看了定军山。' },
    { n: '姑臧', z: 'liang', y: [[301, 350]], t: '你到凉州姑臧，城里讲学之风不绝，中原来的士人比本地人还多。' },
    { n: '番禺', z: 'jiao', y: [[150, 350]], t: '你到番禺，看海船带来的犀角、象牙和香料，听人说海那边还有许多国家。' }
  ];
  function spotsFor(L, y) {
    var g0 = group(ctrl(L.zone, y)), open = y < 190 || (y >= 280 && y < 291);
    return SPOTS.filter(function (p) { return p.y.some(function (r) { return y >= r[0] && y <= r[1]; }) && (open || group(ctrl(p.z, y)) === g0) && (L.visited || []).indexOf(p.n) < 0; });
  }
  function visit(L, y) {
    var sp = spotsFor(L, y);
    if (!sp.length) return null;
    var p = pick(L.R, sp);
    (L.visited = L.visited || []).push(p.n);
    return p;
  }
  function pendHas(L, id) { return (L.pend || []).some(function (p) { return p.id === id; }); }
  function pendAdd(L, p) { (L.pend = L.pend || []).push(p); }
  function pendYear(L, y) {
    if (!L.pend || !L.pend.length) return;
    L.pend = L.pend.filter(function (p) {
      if (p.y > y) return true;
      if (p.risk && L.R() < p.risk) add(L, 3.6, 'bad', p.fail);
      else { L.eco.cash += p.cash; add(L, 3.6, 'good', p.t); }
      return false;
    });
  }
  function oldParent(L) { return liveKin(L, function (k) { return (k.rel === 'father' || k.rel === 'mother') && !k.out && L.by + L.age - k.by >= 55; })[0] || null; }
  function lostKin(L) { return L.kin.filter(function (k) { return k.alive && k.apart && (k.sold || k.given || k.bonded); })[0] || null; }
  function deadParent(L) { return L.kin.some(function (k) { return (k.rel === 'father' || k.rel === 'mother') && !k.alive; }); }
  function dowryGirl(L) { return kidsWith(L, function (a, k) { return k.sex === 'F' && a >= 12 && a <= 20 && !k.out && !k.dowry; })[0] || null; }

  // 自动支用：按性情、眼下所重和家境，替你花一部分余财
  var SP_G = { 日用: 1, 农事: 1, 子女: 3, 家人: 5, 读书: 1, 交游: 1, 乡里: 1, 家业: 2, 买卖: 1, 军中: 2, 身后: 1, 仕途: 1.5, 游历: 1, 捐资: 1 };
  function smartSpend(L, y, fo) {
    var R = L.R, t = L.tr;
    if (L.age < 16 || L.cls === 'slave') return;
    var opt = spendOptions(L), budget = opt.can * clamp(0.3 + (t.soc - t.cau) / 150 + (fo === 'save' ? -0.2 : 0), 0.1, 0.6);
    if (budget < 80) return;
    var seen = L.spentY = L.spentY || {}, done = 0, rich = L.wealth >= 55;
    if (R() >= (rich ? 0.75 : 0.45)) return;
    for (var n = 0; n < (rich && R() < 0.4 ? 2 : 1); n++) {
      var items = opt.items.filter(function (it) { return it.st === 'ok' && it.c <= budget && (seen[it.id] == null || y - seen[it.id] >= 3); });
      if (!items.length) break;
      var it = wpick(R, items, function (it) {
        var w = SP_G[it.g] || 1, G = it.g;
        if (G === '日用') w *= L.body < 50 ? 3 : 0.8;
        if (G === '农事') w *= farmerish(L) ? 2.5 : 0.6;
        if (G === '读书') w *= L.literate ? 0.6 + t.cur / 50 : 0;
        if (G === '交游' || G === '乡里' || G === '捐资') w *= 0.3 + t.soc / 50;
        if (G === '游历') w *= 0.3 + (t.cur + t.act) / 100;
        if (fo === 'travel' && G === '游历') w *= 3;
        if (G === '买卖') w *= L.cls === 'merchant' ? 3 : 0;
        if (G === '身后') w *= L.age >= 50 ? 2 : 0.3;
        if (fo === 'career' && (G === '仕途' || G === '交游')) w *= 2.5;
        if (fo === 'study' && G === '读书') w *= 2.5;
        if ((fo === 'house' || fo === 'save') && (G === '农事' || G === '家业')) w *= 2;
        if ((fo === 'social' || fo === 'fame') && (G === '交游' || G === '乡里')) w *= 2.5;
        if (fo === 'kids' && G === '子女') w *= 2;
        w *= 0.4 + Math.log10(Math.max(50, it.c)) / 3;
        return Math.max(0.05, w);
      });
      var r = spend(L, it.id);
      if (!r.ok) break;
      seen[it.id] = y; budget -= it.c; done++;
      add(L, 3.75, 'spend', '（自动支用 ' + fmt(it.c) + ' 钱值）' + r.t);
      opt = spendOptions(L);
    }
    return done;
  }
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
      months: L.grainMonths, buyMonths: L.grainMonths != null && L.lastCons ? Math.floor(Math.max(0, cash - 0) / (L.lastCons * PRICE / 12)) : 0, coinNote: y >= 190 && y < 196 ? '董卓的小钱轻薄，钱几乎不值钱' : g === 'wei' && y >= 221 && y < 227 ? '朝廷罢五铢钱，交易多用谷帛' : ''
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
    if (!d.give) { affAdd(son, -12); add(L, 0.6, 'life', nm + '怏怏不乐，好几个月不同你说话。'); return; }
    affAdd(son, 8);
    payFrom(L, 3000);
    if (son.lav > 0.66) { var sp = 1800 + Math.round(R() * 8) * 100; add(L, 3.4, 'bad', '给' + nm + '的三千钱，他花了' + fmt(sp) + '宴客，说是结交朋友。剩下的也没拿回来。'); }
    else if (son.lav > 0.3) { L.eco.cash += 3400; add(L, 3.4, 'good', nm + '倒也争气，年底连本带利还了你三千四百钱。'); }
    else add(L, 3.4, 'bad', nm + '的买卖没做成，三千钱赔了个精光。他回来后好几天不敢见你。');
  }


  /* ================= 人生抉择 ================= */
  function choiceMul(L) {
    var m = { gentry: L.gate >= 3 ? 2.6 : 2.1, clerk: 1.7, merchant: 1.5, artisan: 1.1, peasant: 1, soldier: 1, tuntian: 0.9, tenant: 0.8, tribal: 0.8, slave: 0.7 }[L.cls] || 1;
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
      y: y, a: L.age, g: group(fk), fk: fk, fname: fname(fk, y), head: isHead(L), fl: fl, chaos: chaos(y), poor: poorNow(L), farm: farmerish(L), camp: camp,
      kids: function (lo, hi, sex, f) { return liveKin(L, function (k) { var a = y - k.by; return k.rel === 'child' && a >= lo && a <= hi && (!sex || k.sex === sex) && (!f || f(k)); }); },
      friend: function (min) { return bestFriend(L, min); },
      tier: lifeTier(L, y).k, order: L.reg ? L.reg.order : 70, ref: L.reg ? L.reg.ref : 0,
      sib: function () { return liveKin(L, function (k) { return k.rel === 'sib' && !k.out && k.by > L.by && k.by < y; })[0] || null; },
      someKin: function () { var ks = liveKin(L, function (k) { return !k.out && k.by < y; }); return ks.length ? ks[Math.floor(hash01(L.seed, y, 99) * ks.length)] : null; }
    };
  }
  function fillC(L, t, meta) {
    return t.replace('{kin}', meta.kin ? kinLabel(L, meta.kin) : '').replace(/\{kin\}/g, meta.kin ? kinLabel(L, meta.kin) : '')
      .replace(/\{friend\}/g, meta.friend ? meta.friend.name : '一个多年不见的旧友').replace(/\{clan\}/g, L.clanName || '你家').replace(/\{lord\}/g, meta.lord || '').replace(/\{birth\}/g, D.JUN[L.birthJun][0] + L.birthCounty).replace(/\{who\}/g, L.parentDiedName || '亲人');
  }
  function lifeChoice(L, y, free) {
    var R = L.R, a = L.age;
    var kid = a < 12;
    if (a < 5 || (!free && !L.soldier)) return null;
    var gapN = L.cls === 'gentry' || L.office ? 1 : 2;
    if (a - L.lastChoice < gapN) return null;
    if (R() >= (kid ? 0.1 : 0.17) * choiceMul(L)) return null;
    var H = ctxH(L, y), elite = isElite(L), pool = [];
    D.CHOICES.forEach(function (c) {
      if (c.elite && !elite) return;
      if (kid && !c.kid) return;
      var seen = (L.choiceSeen || {})[c.id];
      var REP = { sick: 5, plague: 6, storm: 3, relief: 4, lean: 3, extort: 6, kidsick: 4, haul: 5, pressgang: 6, taxdue: 5, hoard: 5, levy: 6, ration: 5, birthday: 8, case: 4, sellchild: 99, bondage: 8, rentup: 99 };
      if (seen != null && (REP[c.id] == null || y - seen < REP[c.id])) return;
      var meta = c.ok(L, H);
      if (meta) pool.push({ c: c, meta: meta });
    });
    if (!pool.length) return null;
    var pk = wpick(R, pool, function (x) { return x.c.w; });
    var c = pk.c;
    (L.choiceSeen = L.choiceSeen || {})[c.id] = y;
    if (c.pre) c.pre(L, pk.meta, H);
    var aw = c.aw ? c.aw(L).map(function (x) { return Math.max(1, x); }) : c.o.map(function () { return 1; });
    var dis = c.o.map(function (o, i) {
      if (L.sex === 'F' && c.r[i] && c.r[i].some(function (x) { return x.fx && x.fx.office; })) return '女子不得出仕';
      return c.need && c.need[i] && !c.need[i](L, H, pk.meta) ? (c.why && c.why[i]) || '做不到' : null;
    });
    var w = aw.map(function (x, i) { return dis[i] ? 0 : x * x; });
    if (!w.some(function (x) { return x > 0; })) return null;
    return { key: 'life', id: c.id, meta: pk.meta, q: fillC(L, c.q, pk.meta), o: c.o.map(function (o) { return fillC(L, o, pk.meta); }), w: w, dis: dis };
  }
  /* ================= 回响：年轻时的选择，多年后回来找你 ================= */
  var MEM_MAP = { 'foundling:0': 'foundling', 'friend:0': 'sheltered', 'friend:2': 'turned_away', 'plague:0': 'plague_saved', 'refugees:0': 'refugees', 'refugees:1': 'refugees', 'teachv:0': 'taught',
    'dispute:0': 'feud', 'dispute:1': 'yielded', 'hide:0': 'hid_census', 'bandit:0': 'was_bandit', 'relief:0': 'relief_open',
    'fr_jail:0': 'saved_friend', 'fr_jail:1': 'saved_friend', 'fr_jail:2': 'abandoned_friend', 'fr_dead:0': 'comfort_mother', 'fr_dead:1': 'revenge',
    'fr_rich:1': 'owe_friend', 'fr_rich:2': 'slander_rich', 'fr_office:0': 'congrat_office', 'fr_office:1': 'envy_office', 'sib_rich:1': 'sued_sib', 'fr_scholar:1': 'rival_study',
    'frloan:0': 'lent_friend', 'frloan:1': 'lent_friend', 'frloan:2': 'refused_friend', 'sellchild:0': 'sold_child', 'extort:3': 'defied', 'landgrab:3': 'sued_grab',
    'lean:0': 'borrowed_grain', 'funeral:0': 'lavish_funeral', 'funeral:2': 'lavish_funeral', 'bondage:1': 'kid_bonded', 'apprentice:0': 'apprentice' };
  function memRecord(L, y, ch, i, meta) {
    var k = MEM_MAP[ch.id + ':' + i];
    if (!k || !L.alive) return;
    var who = meta.friend || meta.kin || meta.kid || null;
    if (k === 'foundling') who = L.kin.filter(function (x) { return x.rel === 'child' && x.by === y; }).slice(-1)[0] || null;
    (L.mem = L.mem || []).push({ k: k, y: y, a: L.age, who: who, q: ch.q, o: ch.o[i] });
  }
  function wn(L, w) { return !w ? '' : w.rel ? kinLabel(L, w) : w.name; }
  var MEM_CB = {
    saved_friend: { d: [4, 18], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart; }, run: function (L, m) {
      var w = m.who; affAdd(w, 5);
      if (L.eco.debt > 0) { var g = Math.min(L.eco.debt, 3000); L.eco.debt -= g; return '当年你救出狱的' + w.name + '，听说你家欠了债，托人送来' + fmt(g) + '钱值，替你还上了。来人说："他说，这条命是你给的。"'; }
      if (L.sex === 'M' && !L.office && !L.soldier && (L.literate || L.learn >= 25) && L.R() < 0.4) { L.office = '书佐'; L.job = '书佐'; L.officeMax = L.officeMax || '县书佐'; return '当年你救出狱的' + w.name + '，如今在县廷说得上话。他向县丞举荐了你，你做了书佐。'; }
      L.eco.cash += 2000; return '当年你救出狱的' + w.name + '，这些年在外郡发了家。他托人送来两千钱和一封信，信上只有一句："不敢忘。"'; } },
    abandoned_friend: { d: [4, 15], ok: function (L, m) { return m.who && m.who.alive; },
      q: function (L, m) { return m.who.name + '从边地回来了，瘦得脱了形。当年他下狱，你闭门不出。如今你们在集上迎面撞见。'; }, o: ['上前叫住他，向他赔罪', '低下头，装作没看见'],
      r: [[{ p: 0.5, t: '你叫住了他。他站了很久，最后叹了口气："那时候，谁不怕呢。"你们一起喝了一顿酒。', back: true, waff: 35 }, { p: 0.5, t: '你叫住了他。他看了你一眼，什么也没说，走开了。' }], [{ p: 1, t: '你低下头，从他身边走了过去。那天晚上，你很久没睡着。', tr: { cau: 3 } }]] },
    comfort_mother: { d: [3, 12], ok: function () { return true; }, run: function (L, m) { L.standing += 2; L.eco.cash += 800; return '当年你去看望过的' + m.who.name + '的老母去世了。临终前，她让人把一对旧银镯送到你家，说："给你家的媳妇，算是他的一点心意。"'; } },
    revenge: { d: [2, 10], ok: function (L) { return !!(L.soldier || L.milMax); }, run: function (L, m) { L.tr.cau = clamp(L.tr.cau + 3, 5, 95); return '你在军中已经几年了。夜里站岗时，你常想起' + m.who.name + '。仇报了没有？你自己也说不清。'; } },
    owe_friend: { d: [2, 6], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart && L.eco.debt > 0; },
      q: function (L, m) { return m.who.name + '托人来问当年借给你的三千钱。'; }, o: ['砸锅卖铁也先还上', '求他再宽限几年'],
      need: [function (L) { return L.eco.cash + L.eco.priv >= 3000; }, null], why: ['你手头实在凑不出来', null],
      r: [[{ p: 1, t: '你把钱还上了，还多送了一只鸡。他说："你这人，靠得住。"', cash: -3000, debt: -3000, waff: 10 }], [{ p: 0.6, t: '他答应再宽限几年，只是脸色不太好看。', waff: -10 }, { p: 0.4, t: '他当场翻了脸，说你忘恩负义。你们从此断了来往。', waff: -40 }]] },
    slander_rich: { d: [3, 12], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart; }, run: function (L, m) {
      if (L.wealth < 35) { L.standing -= 1; return '荒年里你家去借粮。' + m.who.name + '——如今乡里数一数二的富户——让管家把你挡在了门外："当年的话，我家主人都记着呢。"'; }
      return '你和' + m.who.name + '在县里的宴席上遇见。他客客气气，你也客客气气，当年那些话，谁也没提。'; } },
    congrat_office: { d: [5, 15], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart; }, run: function (L, m) { L.standing += 3; L.flags.connected = true; return '你家和邻家为一桩田产打官司。当年你真心去贺的' + m.who.name + '，如今在郡里说得上话，他替你说了句公道话。'; } },
    envy_office: { d: [8, 15], ok: function () { return true; }, run: function (L, m) {
      if (L.officeMax || L.milMax) { L.fame += 2; return '你终于也出人头地了。那天你想起许多年前' + m.who.name + '穿着吏服回乡的样子——那口气，你憋了' + cnNum(L.by + L.age - m.y) + '年。'; }
      L.tr.cmp = clamp(L.tr.cmp - 8, 5, 95); L.tr.cau = clamp(L.tr.cau + 2, 5, 95);
      return m.who.alive ? m.who.name + '已经做到了县丞，你还在原地。你渐渐不再和他比了。' : '当年让你眼红的' + m.who.name + '已经不在了。你想起那些较劲的年月，只觉得可笑。'; } },
    sued_sib: { d: [5, 15], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart; },
      q: function (L, m) { return '你和' + kinLabel(L, m.who) + '自从当年为分家闹到族里，已经' + cnNum(L.by + L.age - m.y) + '年没有说过话了。这年冬天，他病倒了。'; }, o: ['提着一只鸡去看他', '不去'],
      r: [[{ p: 1, t: '你去了。兄弟俩对坐着，谁也没提当年的事。临走时，他让侄子送你到了村口。', waff: 30, tr: { cmp: -3 } }], [{ p: 1, t: '你没有去。后来听说他好了，两家还是不说话。' }]] },
    foundling: { d: [12, 22], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart; }, run: function (L, m) { affAdd(m.who, 20); return '你当年在路边抱回来的' + kinLabel(L, m.who) + '，如今已经长大成人。那天他给你磕了个头，说："没有您，我早就死在路边了。"'; } },
    sheltered: { d: [3, 15], ok: function () { return true; }, run: function (L) { L.eco.cash += 600; L.standing += 1; return '许多年前你收留过的那个旧友，托人带来了一封信和一匹绢——他在外郡站稳了脚跟。'; } },
    turned_away: { d: [4, 15], ok: function (L) { return L.R() < 0.5; }, run: function (L) { L.tr.cau = clamp(L.tr.cau + 2, 5, 95); return '你听人说，当年你闭门不见的那个旧友，后来死在了逃难的路上。你想起那天他在门外站了很久。'; } },
    plague_saved: { d: [3, 15], ok: function () { return true; }, run: function (L) { L.eco.cash += 400; L.standing += 2; return '当年你在疫中照料过的那户邻家，如今日子好过了。你家青黄不接时，他们送来了两石粟。'; } },
    refugees: { d: [3, 12], ok: function () { return true; }, run: function (L) { L.standing += 3; L.flags.wubi = true; return '你当年收容的流民里，有人做了你家佃客的头目。乱兵过境那年，他带着众人守住了庄门。'; } },
    taught: { d: [8, 20], ok: function () { return true; }, run: function (L) { L.standing += 3; return '你从前教过的学生里，有一个做了县吏，逢年过节都提着礼来看你。'; } },
    feud: { d: [3, 12], ok: function (L) { return L.land > 0; }, run: function (L) { L.yHarvest = Math.min(L.yHarvest || 1, 0.85); return '当年和你争田界的那户邻家，这些年一直和你家别着劲。今年春耕，你家田边的水渠被人堵了。'; } },
    yielded: { d: [3, 12], ok: function () { return true; }, run: function (L) { L.standing += 2; return '当年你在田界上让了一步。今年你家盖房缺人手，那户邻家的几个儿子二话不说就来帮忙了。'; } },
    hid_census: { d: [2, 10], ok: function (L) { return L.R() < 0.45; }, run: function (L) { payFrom(L, 1500); return '县里重新核查户口，当年少报的人口被查了出来。你家被罚了一千五百钱。'; } },
    was_bandit: { d: [3, 15], ok: function (L) { return !L.flags.outlaw; },
      q: function () { return '有人认出了你——当年在山里一起落草的人。他如今在县里当差，暗示你给些钱，不然就把旧事抖出去。'; }, o: ['给他钱，堵住他的嘴', '不理他'],
      need: [function (L) { return L.eco.cash + L.eco.priv >= 1000; }, null], why: ['你拿不出钱来', null],
      r: [[{ p: 1, t: '你给了他一千钱。他拍拍你的肩膀走了。你知道，这不会是最后一次。', cash: -1000 }], [{ p: 0.5, t: '他到底没敢声张——他自己也不干净。', tr: { ind: 2 } }, { p: 0.5, t: '旧事被抖了出来。县里把你抓去打了一顿，罚了钱，乡里人从此看你的眼神都变了。', cash: -1500, standing: -6, body: -4 }]] },
    relief_open: { d: [2, 10], ok: function () { return true; }, run: function (L) { L.fame += 4; return '当年你擅自开仓的事，乡里人一直记着。你离任那天，百姓沿路相送，有人在路边摆了酒。'; } },
    lent_friend: { d: [2, 15], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart && m.who.aff >= 40; }, run: function (L, m) { L.eco.cash += 600; affAdd(m.who, 5); return '你家遭了难。当年向你借过钱的' + m.who.name + '听说了，二话不说扛着两袋粟上了门。'; } },
    refused_friend: { d: [3, 15], ok: function (L, m) { return m.who && m.who.alive && L.R() < 0.6; }, run: function (L, m) { return '你在路上遇见了' + m.who.name + '——当年你没借钱给他。他如今日子好过了，看见你，把头扭了过去。'; } },
    sold_child: { d: [6, 20], ok: function (L, m) { return m.who && m.who.alive && m.who.apart; },
      q: function (L, m) { return '有人从邻县捎来消息：当年卖掉的' + kinLabel(L, m.who) + '还活着，在一户大户人家做奴仆。'; }, o: ['凑钱去把人赎回来', '远远去看一眼', '不去打扰了'],
      need: [function (L) { return L.eco.cash + L.eco.priv >= 6000; }, null, null], why: ['赎身要六千钱，你拿不出来', null, null],
      r: [[{ p: 1, t: '你凑了六千钱，把孩子赎了回来。一家人抱头痛哭，孩子却怯生生的，好几天才肯叫你。', cash: -6000, back: true, waff: 20 }],
        [{ p: 1, t: '你在那户人家的后门外等了一整天，终于远远看见了——长高了，穿着粗布衣裳，在井边打水。你没敢上前。' }], [{ p: 1, t: '你没有去。你想，也许那边的日子，比跟着你强。' }]] },
    defied: { d: [3, 12], ok: function () { return true; }, run: function (L) { if (L.R() < 0.5) { payFrom(L, 600); return '当年被你顶撞过的那个亭长，如今升了游徼。他一直记着你，派到你家的徭役总比别人多。'; } L.standing += 3; return '当年你和亭长理论的事早就传开了。乡里人受了欺负，都爱来找你出头。'; } },
    sued_grab: { d: [2, 10], ok: function () { return true; }, run: function (L) { if (L.R() < 0.6) { L.yHarvest = Math.min(L.yHarvest || 1, 0.8); return '当年你告到县里的那个豪强，这些年一直找你家的麻烦：放牛踩你家的苗，断你家的水。'; } L.standing += 3; return '当年你敢告豪强的事，乡里人至今说起来还竖大拇指。'; } },
    borrowed_grain: { d: [1, 2], ok: function () { return true; }, run: function (L) { payFrom(L, 800); return '当年向豪强借的那几斗粮，秋后要加倍还。管事上门来收，连本带利拿走了你家半仓粟。'; } },
    lavish_funeral: { d: [1, 8], ok: function () { return true; }, run: function (L) { L.standing += 3; return '乡里人至今说起你家当年给老人办的丧事，都说你是孝子。只是那笔债，你还了好多年。'; } },
    kid_bonded: { d: [3, 6], ok: function (L, m) { return m.who && m.who.alive && m.who.apart; }, run: function (L, m) { m.who.apart = false; m.who.bonded = false; affAdd(m.who, -10); return '你送去抵债的' + kinLabel(L, m.who) + '期满回来了，比走的时候瘦了一圈。见了你，半天叫不出一声。'; } },
    apprentice: { d: [6, 15], ok: function () { return true; }, run: function (L) { L.standing += 2; return '你当年收下的那个徒弟，如今自己开了作坊。逢年过节，他总要提着东西来看师父。'; } },
    rival_study: { d: [6, 15], ok: function () { return true; }, run: function (L) { if (L.learn >= 50) { L.fame += 3; return '多年后，你与当年的同窗在郡里的宴席上论经，已经不输给他了。座中有人说："这两位，是本郡的双璧。"'; } return '你和当年的同窗早已不再比了。他开馆讲学，你在家里教儿子认字。'; } }
  };
  function memCheck(L, y, P) {
    if (!L.mem || !L.mem.length) return;
    for (var j = 0; j < L.mem.length; j++) {
      var m = L.mem[j];
      if (m.done) continue;
      var cb = MEM_CB[m.k], dt = y - m.y;
      if (!cb || dt > cb.d[1]) { m.done = true; continue; }
      if (dt < cb.d[0] || L.R() >= 0.3) continue;
      if (!cb.ok(L, m)) continue;
      m.done = true;
      if (cb.q) {
        var dis = cb.o.map(function (o, i) { return cb.need && cb.need[i] && !cb.need[i](L) ? cb.why[i] : null; });
        P.queue.push({ key: 'mem', mi: j, q: cb.q(L, m), o: cb.o.slice(), dis: dis, w: cb.o.map(function (o, i) { return dis[i] ? 0 : 1; }) });
      } else P.dec.memRun = j;
      return;
    }
  }
  function memEcho(L, m, t) { (L.echoes = L.echoes || []).push({ y0: m.y, a0: m.a, o: m.o, y1: L.by + L.age, a1: L.age, t: t }); }
  function memApply(L, y, d) {
    if (d.memRun != null) {
      var m = L.mem[d.memRun], t = MEM_CB[m.k].run(L, m);
      if (t) { add(L, 1.5, 'life', t); memEcho(L, m, t); }
    }
    if (d.memC) {
      var m2 = L.mem[d.memC.mi], cb = MEM_CB[m2.k], rs = cb.r[d.memC.i], x = L.R(), acc = 0, r = rs[rs.length - 1];
      for (var k = 0; k < rs.length; k++) { acc += rs[k].p; if (x < acc) { r = rs[k]; break; } }
      if (r.cash) { if (r.cash > 0) L.eco.cash += r.cash; else payFrom(L, -r.cash); }
      if (r.debt) L.eco.debt = Math.max(0, L.eco.debt + r.debt);
      if (r.waff && m2.who) affAdd(m2.who, r.waff);
      if (r.back && m2.who) { m2.who.apart = false; m2.who.fate = ''; m2.who.sold = m2.who.given = m2.who.bonded = false; }
      ['standing', 'body'].forEach(function (q) { if (r[q]) L[q] += r[q]; });
      if (r.tr) for (var q in r.tr) L.tr[q] = clamp(L.tr[q] + r.tr[q], 5, 95);
      add(L, 1.5, 'life', r.t); memEcho(L, m2, r.t);
    }
  }

  function lifeOutcome(L, y, ch, i) {
    var R = L.R, def = D.CHOICES.filter(function (c) { return c.id === ch.id; })[0];
    var rs = def.r[i], r = rs[rs.length - 1], acc = 0, x = R();
    for (var j = 0; j < rs.length; j++) { acc += rs[j].p; if (x < acc) { r = rs[j]; break; } }
    var fx = r.fx || {}, s = 1.15, meta = ch.meta || {};
    var rt = Array.isArray(r.t) ? pick(R, r.t) : r.t;
    if (rt) add(L, s, 'life', fillC(L, rt, meta));
    ['body', 'learn', 'standing', 'fame', 'craft'].forEach(function (k) { if (fx[k]) L[k] += fx[k]; });
    var E = L.eco;
    if (fx.cash) { if (fx.cash > 0) E.cash += fx.cash; else payFrom(L, -fx.cash); }
    if (fx.priv) E.priv = Math.max(0, E.priv + fx.priv);
    if (fx.debt) E.debt = Math.max(0, E.debt + fx.debt);
    if (fx.land) L.land = Math.max(0, L.land + fx.land);
    if (fx.ox) E.ox = Math.max(0, E.ox + fx.ox);
    if (fx.cls) { L.cls = fx.cls; if (fx.cls !== 'slave' && E.house === 0) E.house = 1500; }
    if (fx.job) L.job = fx.job;
    if (fx.mil) { L.mil = fx.mil; L.milMax = ['军卒', '屯长', '军司马', '校尉', '将军'][fx.mil]; L.job = L.milMax; }
    if (fx.gentryWed) { L.spouseK = null; doMarry(L, makeSpouse(L, y), y, s + 0.1, L.sex === 'F' ? '你奉父命出嫁。' : ''); }
    if (fx.clanDie) liveKin(L, function (k) { return !k.out || k.rel === 'father' || k.rel === 'sib'; }).forEach(function (k) { if (R() < 0.6) kinDie(L, k, 'executed', s + 0.08, y); });
    if (fx.office) { L.office = fx.office; L.officeMax = fx.office === '幕僚' ? (meta.lord || '') + '幕府的掾属' : fx.office; L.job = fx.office; }
    var sv = fx.serve || (fx.office === '幕僚' && meta.fk ? lordFigAt(meta.fk, y) : null);
    if (sv) serveLord(L, sv, y, fx.office ? '在' + figName(sv) + '幕府中任职' : '追随' + figName(sv));
    if (fx.noOffice) { L.office = null; L.job = '农'; }
    if (fx.flag) [].concat(fx.flag).forEach(function (f) { L.flags[f] = true; });
    if (fx.tr) for (var t in fx.tr) L.tr[t] = clamp(L.tr[t] + fx.tr[t], 5, 95);
    if (fx.kinLit && meta.kin) meta.kin.lit = true;
    if (fx.kinAff && meta.kin) affAdd(meta.kin, fx.kinAff);
    if (fx.kinSoldier && meta.kin && meta.kin.alive) meta.kin.soldier = armyOf(ctrl(L.zone, y));
    if (fx.palace) { L.cls = 'slave'; L.job = '宫人'; L.eco.house = 0; relocate(L, 'ji', s + 0.05, '你被差役押上了车，一路送进了{dest}的宫里。', 0.02, y); }
    if (fx.sonsAff) liveKin(L, function (k) { return k.rel === 'child' && k.sex === 'M'; }).forEach(function (k) { affAdd(k, fx.sonsAff); });
    if (fx.frAff && meta.friend) affAdd(meta.friend, fx.frAff);
    if (fx.frGone && meta.friend) { meta.friend.apart = true; meta.friend.fate = fx.frGone; }
    if (fx.kinWed && meta.kin) meta.kin.wed = true;
    if (fx.kinGone && meta.kin) { meta.kin.apart = true; meta.kin.sold = true; L.rec.tags.push('loss'); }
    if (fx.kidGone && meta.kid) { meta.kid.apart = true; meta.kid.bonded = true; }
    if (fx.sonDie && meta.son && meta.son.alive) kinDie(L, meta.son, fx.sonDie, s + 0.05, y);
    if (fx.kidsHarm) { var yk = liveKin(L, function (k) { return k.rel === 'child' && y - k.by < 8; })[0]; if (yk) kinDie(L, yk, 'fam', s + 0.05, y); }
    if (fx.debtClear) E.debt = 0;
    if (fx.landMul) L.land = Math.floor(L.land * fx.landMul);
    if (fx.schooling) L.schooling = true;
    if (fx.kidsLit) liveKin(L, function (k) { return k.rel === 'child' && (fx.kidsLit === 'all' || k.sex === 'M'); }).forEach(function (k) { k.lit = true; });
    if (fx.concubine) L.flags.concubine = y;
    if (fx.divorced && L.spouseK) {
      L.spouseK.apart = true; L.married = false; L.spouseK = null; L.divorced = true;
      liveKin(L, function (k) { return k.rel === 'child'; }).forEach(function (k) { k.apart = true; });
      add(L, s + 0.05, 'bad', '按规矩，孩子留在夫家。你一个人回了娘家，从此再没见过他们。');
      L.eco = initEco(L); L.land = 0;
    }
    if (fx.debtMul) E.debt = Math.round(E.debt * fx.debtMul);
    if (fx.enlist) enlist(L, y, s + 0.1, false);
    if (fx.kinOut && meta.kin) meta.kin.out = true;
    if (fx.kinDie && meta.kin && meta.kin.alive) kinDie(L, meta.kin, fx.kinDie, s + 0.05, y);
    if (fx.child) {
      var sx = R() < 0.5 ? 'M' : 'F', k = newKin(L, 'child', sx, y, freshXiao(L, sx), { sur: kidSur(L, 'child') });
      k.lav = R(); k.adopted = true; L.kidsBorn++;
      add(L, s + 0.02, 'fam', '你给孩子取名' + k.name + '。');
    }
    if (fx.marry) { L.spouseK = null; doMarry(L, makeSpouse(L, y), y, s + 0.1); }
    var mvz = fx.move ? fx.move.filter(function (z) { return z !== L.zone; }) : [];
    if (mvz.length) relocate(L, pick(R, mvz), s + 0.2, '你们到了{dest}。', 0.03, y);
    if (fx.die) die(L, fx.die, s + 0.1, fx.die === 'executed' ? { full: L.R() < 0.5 ? '几天后，你被押赴市曹斩首，年' + cnNum(L.age) + '。' : '你没能活着走出监狱，年' + cnNum(L.age) + '。' } : { a: cnNum(L.age), n: '先登攻城' });
    L.rec.tags.push('choice');
  }

  /* ================= 传家：以子孙之身继续 ================= */
  function heirOf(L) {
    var kids = L.kin.filter(function (k) { return k.rel === 'child' && k.alive && !k.apart; }).sort(function (a, b) { return a.by - b.by; });
    if (!kids.length || L.cls === 'slave') return null;
    var k = kids.filter(function (x) { return x.sex === 'M'; })[0] || kids[0];
    var sp = L.spouseK && (L.spouseK.alive || L.spouseK.dy >= k.by) ? L.spouseK : L.kin.filter(function (x) { return x.rel === 'spouse'; })[0];
    var sur = k.sur != null ? k.sur : L.sex === 'M' ? L.sur : (sp && sp.sur != null ? sp.sur : sp ? sp.name.slice(0, 1) : L.sur);
    var cls = L.cls === 'tribal' ? 'tribal' : (L.office || L.cls === 'gentry') ? (L.cls === 'gentry' ? 'gentry' : 'clerk') : L.cls;
    return {
      year: k.by, jun: L.jun, sex: k.sex, sur: sur, xiao: k.xiao || k.name, given: k.given || null, zi: k.zi || null, cls: cls, eth: L.eth, land: L.land,
      parentSex: L.sex, parentName: L.name, parentBy: L.by, dy: L.dy, cause: L.cause, lit: L.literate,
      otherName: sp ? sp.name : null, otherBy: sp ? sp.by : null, otherDy: sp && !sp.alive ? sp.dy : null, otherCause: sp ? sp.cause : null,
      lineage: (L.lineage || []).concat([{ name: L.name, sex: L.sex, by: L.by, dy: L.dy }]), age: L.dy - k.by, gate: L.gate
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
    executed: '权力更迭的时候，史书记下的是胜负。被牵连的人，只是名单上的一行。',
    fade: '户籍上的名字消失，并不一定是死了：逃亡、南渡、被掳、投靠豪强，都会让一个人从簿籍上不见。史书写到这里，你的故事也就停在这里。'
  };
  // 眼下的家境档位（随田产、人口、财力逐年变化）
  var TIER_K = { 没有家产: 'slave', 赤贫: 'low', 贫寒: 'low', 温饱: 'mid', 小康: 'mid', 殷实: 'high', 富足: 'high', 豪富: 'top' };
  function lifeTier(L, y) {
    if (L.tierY === y && L.tierC) return L.tierC;
    var f = famLevel(L, Math.max(1, household(L, y).length)), lv = f.lv;
    if (L.cls !== 'slave' && !L.eth && L.age > 0) {
      if (L.wealth < 6) lv = '赤贫';
      else if (L.wealth < 12 && (TIER_K[lv] === 'mid' || TIER_K[lv] === 'high')) lv = '贫寒';
      else if (L.wealth >= 62 && L.cls !== 'gentry' && TIER_K[lv] !== 'high') lv = '殷实';
    }
    L.tierY = y; L.tierC = { lv: lv, k: TIER_K[lv] || null };
    return L.tierC;
  }
  function childEvent(L, y) {
    var R = L.R, a = L.age;
    if (a < 3 || a > 13 || L.eth || R() >= 0.2) return;
    var tk = lifeTier(L, y).k, seen = L.childSeen = L.childSeen || {};
    var pool = D.CHILD_EV.filter(function (e) { return !seen[e.id] && e.tiers.indexOf(tk) >= 0 && a >= e.age[0] && a <= e.age[1] && (!e.sex || e.sex === L.sex); });
    if (!pool.length) return;
    var e = pick(R, pool), fx = e.fx || {}, t = e.t;
    seen[e.id] = y;
    if (e.fn === 'giveSib') {
      var sib = liveKin(L, function (k) { return k.rel === 'sib' && !k.out && k.by > L.by && y - k.by <= 4; })[0];
      if (!sib) return;
      sib.apart = true; sib.given = true;
      t = '那年冬天，家里实在养不活了。父母把' + kinLabel(L, sib) + '送给了邻县一户没有孩子的人家。你追着牛车跑了很远，直到看不见。';
      var mo = L.kin[1]; if (mo && mo.alive) affAdd(mo, -4);
    } else if (e.fn === 'loseOx') {
      if (!L.eco || L.eco.ox < 1) return;
      L.eco.ox -= 1;
    } else if (e.fn === 'momAway') {
      var mo2 = L.kin[1]; if (!mo2 || !mo2.alive || mo2.apart) return;
      mo2.apart = true; mo2.sold = true;
    } else if (e.fn === 'momAff') {
      if (L.kin[1] && L.kin[1].alive) affAdd(L.kin[1], 10);
    } else if (e.fn === 'martialMaybe' && R() < 0.3) L.flags.martial = true;
    add(L, 1.4, 'life', t);
    ['body', 'learn', 'standing', 'fame'].forEach(function (k) { if (fx[k]) L[k] += fx[k]; });
    if (fx.tr) for (var k in fx.tr) L.tr[k] = clamp(L.tr[k] + fx.tr[k], 5, 95);
  }

  // 结局页：一生所历
  function lifeSummary(L) {
    var T = [], seen = {}, regs = [];
    (L.regimes || []).forEach(function (fk) { var n = fk === 'warlords' ? '群雄割据' : D.FACTIONS[fk].n; if (!seen[n]) { seen[n] = 1; regs.push(n); } });
    if (regs.length) T.push({ l: '历经政权', v: regs.length + ' 个', s: regs.join(' → ') });
    var jh = (L.junHist || [L.birthJun]).map(function (j) { return D.JUN[j][0]; });
    T.push({ l: '居住过的地方', v: jh.length > 1 ? jh.length + ' 个郡' : '未曾离乡', s: jh.join('、') + (L.moves ? '（迁徙 ' + L.moves + ' 次）' : '') });
    if ((L.visited || []).length) T.push({ l: '游历过的地方', v: L.visited.length + ' 处', s: L.visited.join('、') });
    var H = L.regHist || [];
    if (H.length) {
      var hi = H.reduce(function (a, b) { return b.price > a.price ? b : a; }), lo = H.reduce(function (a, b) { return b.order < a.order ? b : a; });
      var bad = H.filter(function (h) { return h.order < 42; }).length;
      T.push({ l: '见过最贵的粮价', v: '每石 ' + fmt(Math.round(PRICE * hi.price)) + ' 钱', s: hi.y + ' 年；平年约 100 钱' });
      T.push({ l: '动荡的年头', v: bad + ' 年', s: bad ? '最乱是 ' + lo.y + ' 年，' + orderLabel(lo.order) : '一生所在之地还算安定' });
    }
    var tax = 0;
    (L.years || []).forEach(function (r) { if (r.ledger && r.ledger.exp) r.ledger.exp.forEach(function (x) { if (/赋|租|户调|口钱|修宫钱|纳贡/.test(x[0])) tax += x[1]; }); });
    if (tax > 0) T.push({ l: '交给官府的', v: fmt(Math.round(tax)) + ' 钱值', s: '算赋、田租、户调等，按家计折算' });
    var laws = Object.keys(L.lawSeen || {}).length;
    if (laws) T.push({ l: '经历的法令', v: laws + ' 条', s: '' });
    T.push({ l: '结识的人物', v: Object.keys(L.met || {}).length + ' 位', s: '收入名册的' });
    var frs = (L.friends || []).length;
    if (frs) T.push({ l: '交过的朋友', v: frs + ' 位', s: (L.friends || []).filter(function (f) { return !f.alive; }).length + ' 位先你而去' });
    var kids = L.kin.filter(function (k) { return k.rel === 'child'; }), young = kids.filter(function (k) { return !k.alive && k.dy - k.by < 15; }).length;
    if (kids.length) T.push({ l: '子女', v: kids.length + ' 人', s: young ? young + ' 人没能长大' : '都长大了' });
    var ch = (L.choiceLog || []).filter(function (c) { return !c.narr; }).length;
    if (ch) T.push({ l: '亲手做出的抉择', v: ch + ' 次', s: (L.echoes || []).length ? (L.echoes || []).length + ' 次在多年后有了回响' : '' });
    return T;
  }

  // 出生时的家境说明：给不熟悉汉末的人一个参照
  function famLevel(L, hh) {
    var c = L.cls, per = hh ? L.land / hh : 0, debt = L.eco && L.eco.debt > 0, lv, t;
    if (L.eth) return { lv: '化外', t: '你家不在汉人的户籍里，放牧、射猎、种山田为生，不交汉家的赋税，却要给部落的首领出马出人。官府的文书里，你们被称作"夷"。', r: '' };
    if (c === 'slave') { lv = '没有家产'; t = '你家没有一寸地、一文钱，连人都是主人的。吃主人的饭，干主人的活，可以被买卖、赏赐、陪嫁。'; }
    else if (c === 'tenant') { lv = debt ? '赤贫' : '贫寒'; t = '你家没有自己的田，租种豪强的地，收成要交一半给田主' + (debt ? '，家里还欠着债' : '') + '。丰年刚够糊口，一遇灾荒就要借贷、卖儿女。汉末失去土地的农民，大多成了这样的佃客。'; }
    else if (c === 'tuntian') { lv = '贫寒'; t = '你家种的是官田，用官牛的收成要交官府六成，用自家牛的交五成。好处是不必另服兵役，坏处是不得随意离开屯田。'; }
    else if (c === 'soldier') { lv = '贫寒'; t = '你家是士家（兵户）：男子世代当兵，家属留在后方，等于人质；不得与平民随意通婚，也不能改籍。'; }
    else if (c === 'peasant') {
      if (per < 4) { lv = debt ? '赤贫' : '贫寒'; t = '你家的田，每口人摊不到四亩。当时一亩地一年收两三石粮，一个大人一年要吃十几石——地里的收成填不饱一家人的肚子，要靠佣工、织布补贴。'; }
      else if (per < 8) { lv = '温饱'; t = '你家的田每口人六七亩。丰年勉强吃饱，交完田租、算赋、口钱就所剩无几；一遇水旱蝗灾，就要借贷，甚至卖地。'; }
      else if (per < 15) { lv = '小康'; t = '你家的田每口人十来亩，丰年有余粮，荒年还能撑一阵。在编户小农里算是过得去的。'; }
      else { lv = '殷实'; t = '你家的田多，农忙时要雇人帮工，在乡里算是殷实之家——也最容易被豪强盯上、被官府摊派。'; }
    }
    else if (c === 'artisan') { lv = '温饱'; t = '你家靠手艺吃饭，田很少，口粮要拿手艺去换。官府随时可能把工匠征去官营作坊服役。'; }
    else if (c === 'merchant') { lv = L.wealth >= 45 ? '殷实' : '小康'; t = '你家做买卖，手里的钱比农家活泛。可汉朝"重农抑商"，商人入市籍，不许做官、不许乘车穿丝——虽然常有人不守。'; }
    else if (c === 'clerk') { lv = '小康'; t = '你家有人在县里当小吏，识字、懂律令，有一份俸禄，也有门路。在乡里算是体面人家，离真正的士族还很远。'; }
    else { lv = L.gate >= 3 ? '豪富' : '富足'; t = '你家有田' + L.land + '亩，有僮仆、宾客，族人聚居，' + (L.gate >= 3 ? '祖上世代做二千石的大官。' : '是郡里有名望的大姓。') + '在当时，这样的人家不到百分之三。'; }
    var R = { 没有家产: '在当时，几乎没有人比你的处境更低。', 赤贫: '十户人家里，大约只有一两户比你家更难。', 贫寒: '十户里大约有三四户和你家差不多，或者更难。', 温饱: '大约一半的人家，过的就是这样的日子。', 小康: '十户里，大约只有两三户比你家宽裕。', 殷实: '百户里，不过几户能比你家宽裕。', 富足: '一县之内，这样的人家屈指可数。', 豪富: '一州之内，这样的人家屈指可数。' }[lv];
    return { lv: lv, t: t, r: R };
  }

  function afterword(L) {
    var age = L.dy - L.by, t = [];
    if (REFLECT[L.cause]) t.push(REFLECT[L.cause]);
    else if (age >= 60) t.push('能活到这个年纪的人，在你的同代人里不到十分之一。你看着王朝更替、城头易帜，把这些都藏在了心里。');
    if (L.cls === 'slave') t.push('律令把你和牛马写在同一页簿籍上。可你也有过自己的名字，自己的念想。');
    else if (L.eth) t.push('汉人的户籍里没有你。史书提到你的族人，多半是在"叛""破""徙"这样的字旁边。');
    else if (L.sex === 'F' && L.cause !== 'childbirth') t.push('史书里的女子，多半只留下一个姓氏，写作"某氏"。可你的名字，曾经被家里人叫了很多年。');
    else if (L.moves >= 2 && age >= 15) t.push('你一生几度迁徙。汉末户籍上消失的千万人里，有许多就是像你这样的流民。');
    else if (L.officeMax && age >= 20 && L.cls !== 'gentry') t.push('你从寒微中做到了官。在那个讲究门第的时代，这样的人是极少数。');
    else if (L.clanName && age >= 20) t.push('你生在' + L.clanName + '。门第给了你读书、做官、乱世里先走一步的机会，也让你在每一次改朝换代时，都必须选一边站。');
    else if (age >= 15) t.push('你种出的粮食进了官仓，织出的布帛交了户调，你的名字写在里正的户籍简上。帝王将相的事业，就压在这些简牍上。');
    var lost = L.kin.filter(function (k) { return k.rel === 'child' && !k.alive && k.dy <= L.dy && k.dy - k.by < 15; }).length;
    if (lost >= 2) t.push('你一生送走了' + cnNum(lost) + '个没能长大的孩子。在那个时代，这几乎是每个' + (L.sex === 'F' ? '母亲' : '父亲') + '的命运，可它并不会因此变得轻一些。');
    var MOD = { infant: '在今天，绝大多数新生儿都能活过周岁。', child: '在今天，夺走你性命的这场病，多半一针、一剂药就能治好。', childbirth: '在今天的中国，因生育而死的女子，已经不到万分之二。', fam: '在今天，饥荒已经离这片土地很远了。', plag: '在今天，人们有了疫苗和隔离，大疫不再能轻易地带走一个村子。' };
    if (MOD[L.cause]) t.push(MOD[L.cause]);
    var RG = D.REGION && D.REGION[L.zone];
    if (RG && RG.end && age >= 10) t.push(RG.end);
    var top = /刺史|九卿|郡守|太守/.test(L.officeMax || '') || L.mil >= 3 || L.fame >= 55;
    var mid = !top && (!!L.officeMax || L.mil >= 2 || L.fame >= 25);
    var AP = L.appraisal;
    if (AP) {
      var ap = AP.by + '曾' + (AP.ping ? '评' : '相') + '你：「' + AP.t + '」';
      if (AP.lv === 2 && top) ap += '后来的事，证明他没有看错。';
      else if (AP.lv === 2 && age >= 35) ap += '可乱世没有给你施展的机会。评语还在，人已经老了。';
      else if (AP.lv === 0 && (top || mid)) ap += '你后来做到的，比他说的要多。';
      else if (AP.lv === 2) ap += '你没有活到应验的那一天。';
      t.push(ap);
    }
    if (top) t.push('也许你的名字会出现在某部史书的某一页上，写着籍贯、官职和几件大事。那些在你身边种地、织布、当兵的人，史书一个也不会写——你还记得他们吗？');
    else if (mid) t.push('你的名字也许会留在郡里的碑刻、族中的家谱上，史书里却未必有一行。和你同时代的几千万人，大多连这些也没有。');
    else t.push('《三国志》为数百人立了传。你不在其中——和那个时代的几千万人一样。');
    return t;
  }
  /* ================= 亲疏、营生、故交 ================= */
  var REL_LBL = [[80, '亲密'], [60, '和睦'], [40, '平淡'], [20, '疏远'], [-999, '不和']];
  function relLabel(a) { for (var i = 0; i < REL_LBL.length; i++) if (a >= REL_LBL[i][0]) return REL_LBL[i][1]; return '平淡'; }
  var JOB_M = { peasant: '农夫', tenant: '佃户', tuntian: '屯田客', soldier: '军卒', artisan: '工匠', merchant: '商贩', slave: '奴仆', clerk: '县吏', gentry: '士人', tribal: '牧人' };
  var JOB_F = { gentry: '持家', clerk: '持家', merchant: '持家', slave: '婢女', tribal: '牧人' };
  function jobFor(L, k) {
    var R = L.R;
    if (k.sex === 'F') return JOB_F[L.cls] || pick(R, ['农妇', '织妇']);
    if (L.cls === 'clerk') return pick(R, ['县吏', '书佐', '亭长', '乡啬夫']);
    if (L.cls === 'gentry') return k.rel === 'father' ? pick(R, L.gate >= 3 ? ['郡守', '议郎', '士人'] : ['郡吏', '士人', '县令']) : (k.lit || R() < 0.7 ? pick(R, ['儒生', '郡吏', '士人']) : '士人');
    if (L.cls === 'artisan') return R() < 0.75 ? '工匠' : '农夫';
    if (L.cls === 'peasant' && R() < 0.08) return pick(R, ['木匠', '铁匠', '货郎', '佣工']);
    return JOB_M[L.cls] || '农夫';
  }
  function kinAffInit(L, k) {
    var R = L.R, base = { father: 65, mother: 75, gp: 70, sib: 60, spouse: 55, child: 72 }[k.rel] || 60;
    return Math.round(clamp(base + (R() - 0.5) * 30, 10, 95));
  }
  function affAdd(k, d) { if (k) k.aff = clamp((k.aff == null ? 60 : k.aff) + d, 0, 100); }
  var KR_POS = {
    spouse: ['你病倒的那些日子，{k}日夜守在床边。', '{k}把攒下的一点钱拿出来，给你做了一件新衣。', '收工回来，{k}已经把饭热在了灶上。'],
    child: ['{k}从集上给你带回了一包饴糖。', '{k}帮你把地里的活干完了，没让你动手。', '{k}学会了一样新本事，跑来做给你看。'],
    parent: ['{k}把年轻时用惯的家什交到了你手里。', '{k}给你讲了许多家里的旧事。'],
    sib: ['{k}来帮你修了屋顶，一句客气话也没要。', '你和{k}在灯下说了半夜的话。']
  };
  var KR_NEG = {
    spouse: ['你和{k}为了钱的事吵了一架，好几天没说话。', '{k}嫌你不顾家，当着孩子的面数落你。'],
    child: ['{k}嫌你管得太多，顶撞了你几句。', '{k}偷拿了家里的钱，被你发现了。'],
    parent: ['{k}嫌你不听话，当着族人的面骂了你。'],
    sib: ['你和{k}为了分家产的事吵翻了。', '{k}借了你的钱，一直没有还。']
  };
  function kinRelYear(L, y) {
    var R = L.R, F = L.rec.focus ? L.rec.focus.eff : null;
    var drift = F === 'family' || F === 'kids' || F === 'house' ? 1.5 : F === 'travel' || F === 'army' || F === 'social' ? -0.6 : 0;
    var pool = [];
    L.kin.forEach(function (k) {
      if (!k.alive || k.apart || k.by > y) return;
      if (k.aff == null) k.aff = kinAffInit(L, k);
      if (drift && (k.rel === 'spouse' || k.rel === 'child')) affAdd(k, drift);
      if (y - k.by >= 8 && L.age >= 8) pool.push(k);
    });
    if (!pool.length || !cool(L, 'kinrel', 3) || R() > 0.35) return;
    var k = pick(R, pool), grp = k.rel === 'father' || k.rel === 'mother' || k.rel === 'gp' ? 'parent' : k.rel;
    var good = R() < 0.55 + (L.tr.soc - 50) / 200 + (k.aff - 60) / 200;
    var t = fresh(L, (good ? KR_POS : KR_NEG)[grp]).replace('{k}', kinLabel(L, k));
    affAdd(k, good ? 8 : -12);
    add(L, 2.3, 'fam', t);
  }
  function kinJobYear(L, k, y) {
    var ka = y - k.by;
    if (k.soldier) { k.job = '军卒'; return; }
    if (k.out && k.sex === 'F' && (k.rel === 'child' || k.rel === 'sib')) { k.job = '出嫁'; return; }
    if (!k.job && ka >= 15) {
      k.job = jobFor(L, k);
      if (k.rel === 'child' && !k.apart && k.job !== '农夫' && k.job !== '农妇') add(L, 1.15, 'fam', kinLabel(L, k) + '长大了，做了' + k.job + '。');
    }
  }
  // 老来：子女是否奉养，看亲疏
  function elderSupport(L, y) {
    if (L.age < 58) return 0;
    var amt = 0, cold = null;
    L.kin.forEach(function (k) {
      if (k.rel !== 'child' || !k.alive || k.apart || y - k.by < 18) return;
      if ((k.aff || 60) >= 60) amt += k.out ? 600 : 1200; else if ((k.aff || 60) < 30) cold = k;
    });
    if (cold && cool(L, 'cold', 6)) add(L, 3.4, 'bad', kinLabel(L, cold) + '很少回来看你。你知道，那是从前积下的疙瘩。');
    return Math.min(amt, 4000);
  }

  var FR_CTX = {
    child: ['儿时玩伴', '一起放牛、掏鸟窝长大的'], school: ['同窗', '一同读书的'], army: ['同伍', '在一个伍里吃过苦的'], office: ['同僚', '在县廷共事的'],
    trade: ['生意伙伴', '一起跑过买卖的'], girl: ['邻家姐妹', '一起采桑、织布的'], village: ['乡邻', '住在同一个里的'], band: ['同袍', '一同追随过主公的'], old: ['老友', '晚年常在一处晒太阳的']
  };
  function frCtx(L) {
    var a = L.age;
    if (L.band) return 'band';
    if (L.soldier) return 'army';
    if (a < 15) return L.schooling ? 'school' : 'child';
    if (L.office) return 'office';
    if (L.cls === 'merchant') return 'trade';
    if (L.sex === 'F') return 'girl';
    if (a >= 60) return 'old';
    return L.schooling && a < 22 ? 'school' : 'village';
  }
  function friendsYear(L, y) {
    var R = L.R, a = L.age, F = L.rec.focus ? L.rec.focus.eff : null;
    L.friends = L.friends || [];
    // 结交
    var alive = L.friends.filter(function (f) { return f.alive && !f.apart; }).length;
    var p = 0.05 + (F === 'social' ? 0.22 : F === 'travel' ? 0.15 : F === 'fame' || F === 'play' ? 0.1 : 0) + (L.found.charm ? 0.04 : 0) + (L.tr.soc - 50) / 400;
    if (a >= 6 && alive < (F === 'social' ? 9 : 6) && R() < p) {
      var ctx = frCtx(L), sex = L.sex === 'F' || ctx === 'girl' ? 'F' : 'M';
      var sur = L.eth && !D.ETH[L.eth].sur ? '' : surname(R, L.cls === 'gentry' && ctx !== 'village' ? 'gentry' : L.cls);
      var fr = { name: sur + givenName(R, sex), sex: sex, by: y - a + Math.round((R() - 0.5) * 6), since: y, ctx: ctx, aff: Math.round(55 + R() * 25), alive: true, apart: false, job: '', fate: '' };
      if (a >= 15) fr.job = ctx === 'army' ? '军卒' : ctx === 'office' ? pick(R, ['书佐', '县吏', '郡吏']) : ctx === 'trade' ? '商贩' : sex === 'F' ? pick(R, ['农妇', '织妇']) : pick(R, ['农夫', '佃户', '工匠', '货郎']);
      L.friends.push(fr);
      add(L, 2.4, 'good', fresh(L, ['你和' + fr.name + '成了朋友。', '你结识了' + fr.name + '，两人很谈得来。', fr.name + '是' + FR_CTX[ctx][1] + '，你们渐渐成了好友。']));
    }
    // 故交的一年
    var evDone = false;
    L.friends.forEach(function (f) {
      if (!f.alive || f.apart) return;
      var fa = y - f.by;
      if (!f.job && fa >= 15) f.job = f.sex === 'F' ? '农妇' : pick(R, ['农夫', '佃户', '工匠']);
      var q = baseQ(Math.max(1, fa)) * chaos(y) * 0.9 * (f.job === '军卒' ? 1.6 : 1);
      if (R() < q) {
        f.alive = false; f.dy = y; f.fate = fa < 15 ? '少年夭折' : fa >= 55 ? '寿终' : f.job === '军卒' ? '死于军中' : '病故';
        if (f.aff >= 40) add(L, 2.9, 'fam', '你的朋友' + f.name + '去世了，年' + cnNum(Math.max(1, fa)) + '。' + (f.aff >= 75 ? '你在他坟前坐了很久。'.replace('他', f.sex === 'F' ? '她' : '他') : ''));
        return;
      }
      if (evDone || R() > 0.1) return;
      evDone = true;
      var r = R(), ta = f.sex === 'F' ? '她' : '他';
      if (r < 0.25 && poorNow(L) && f.aff >= 60) { L.eco.cash += 200; affAdd(f, 5); add(L, 2.5, 'good', f.name + '听说你家断了粮，送来了两斗粟。'); }
      else if (r < 0.45 && fa >= 16 && fa <= 40 && f.sex === 'M' && f.job !== '军卒') { var nj = pick(R, ['军卒', '县吏', '商贩', '门客']); f.job = nj; add(L, 2.5, 'life', '你的朋友' + f.name + (nj === '军卒' ? '投了军。临走前，' + ta + '来和你喝了一回酒。' : nj === '县吏' ? '到县廷做了小吏。' : nj === '商贩' ? '做起了买卖，常年在外奔走。' : '投到了一位豪强门下。')); }
      else if (r < 0.62) { affAdd(f, -18); add(L, 2.5, 'bad', fresh(L, ['你和' + f.name + '为一件小事闹翻了。', f.name + '在背后说了你的闲话，传到了你耳朵里。'])); }
      else if (r < 0.78 && f.aff < 50) { affAdd(f, 20); add(L, 2.5, 'good', '你和' + f.name + '和好了，像从前一样。'); }
      else { affAdd(f, 4); add(L, 2.5, 'life', fresh(L, [f.name + '来看你，你们说了一下午的话。', '你去' + f.name + '家喝了喜酒。', '你和' + f.name + '一起去了一趟县城。'])); }
    });
  }
  function friendsApart(L, why) {
    (L.friends || []).forEach(function (f) { if (f.alive && !f.apart && f.ctx !== 'band') { f.apart = true; f.fate = why; } });
  }
  function bestFriend(L, min) {
    var fs = (L.friends || []).filter(function (f) { return f.alive && !f.apart && f.aff >= (min || 0); }).sort(function (a, b) { return b.aff - a.aff; });
    return fs[0] || null;
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
    spendOptions: spendOptions, spend: spend, relLabel: relLabel, famLevel: famLevel, lifeTier: lifeTier, polsAt: polsAt, regionView: regionView, lifeSummary: lifeSummary, heirOf: heirOf, afterlife: afterlife, afterword: afterword, isHead: isHead, autoAnswer: autoAnswer, fmt: fmt, LANDP: LANDP, CAUSE_SHORT: CAUSE_SHORT, CAUSE_STAT: CAUSE_STAT, POP_SCALE: POP_SCALE, stats: stats
  };
})(SGD);
if (typeof module !== 'undefined') module.exports = SGE;
