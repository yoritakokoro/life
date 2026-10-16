/* 五千万分之一 —— 人生模擬引擎
 * 逐年推進：SGE.step(L) 推進一年；遇到需要玩家決定的事，返回 {pending}，
 * 由 SGE.answer(L, i) 作答後再次 step。auto 模式下自動作答（用於同時辰者与統計）。
 * 同一命数（seed）+ 同様的選択 = 同様的一生。
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
  // 避免重複：最近十二年用過的句子先不再用
  function fresh(L, pool) {
    var y = L.by + L.age; L.recent = L.recent || {};
    var c = pool.filter(function (t) { return !(L.recent[t] && y - L.recent[t] < 12); });
    if (!c.length) c = pool;
    var t = pick(L.R, c); L.recent[t] = y; return t;
  }
  function cool(L, k, n) { var y = L.by + L.age; L.evCool = L.evCool || {}; if (L.evCool[k] != null && y - L.evCool[k] < n) return false; L.evCool[k] = y; return true; }
  function fill(t, map) { return t.replace(/\{(\w+)\}/g, function (m, k) { return map[k] != null ? map[k] : m; }); }

  var CN = '〇一二三四五六七八九';
  function cnNum(n) { // 普通漢字数字：二十五
    if (n < 10) return CN[n];
    if (n < 20) return '十' + (n % 10 ? CN[n % 10] : '');
    if (n < 100) return CN[Math.floor(n / 10)] + '十' + (n % 10 ? CN[n % 10] : '');
    return '百' + (n % 100 ? (n % 100 < 10 ? '' : '') + cnNum(n % 100) : '');
  }
  function slipNum(n) { // 簡牘記数：廿三、卅五、卌
    if (n >= 20 && n < 50) return ['廿', '卅', '卌'][Math.floor(n / 10) - 2] + (n % 10 ? CN[n % 10] : '');
    return cnNum(n);
  }
  var STEM = '甲乙丙丁戊己庚辛壬癸', BRANCH = '子醜寅卯辰巳午未申酉戌亥';
  function ganzhi(y) { return STEM[(y - 4) % 10] + BRANCH[(y - 4) % 12]; }

  /* ================= 預処理 ================= */
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
  function fname(fk, y) { if (fk === 'jin' && y >= 317) return '東晋'; return D.FACTIONS[fk].n; }
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
    han: [[146, '漢桓帝'], [168, '漢霊帝'], [190, '漢献帝']],
    wei: [[220, '魏文帝'], [227, '魏明帝'], [240, '魏少帝'], [254, '魏高貴郷公'], [260, '魏元帝']],
    shu: [[221, '蜀漢昭烈帝'], [223, '蜀漢後主']],
    wu: [[222, '呉大帝'], [252, '呉会稽王'], [258, '呉景帝'], [264, '呉末帝']],
    jin: [[265, '晋武帝'], [290, '晋恵帝'], [307, '晋懐帝'], [313, '晋愍帝'], [317, '晋元帝'], [323, '晋明帝'], [326, '晋成帝'], [343, '晋康帝'], [345, '晋穆帝']],
    chenghan: [[304, '成漢武帝']],
    hanzhao: [[304, '漢光文帝'], [310, '漢昭武帝'], [318, '趙主劉曜']],
    houzhao: [[319, '後趙石勒'], [333, '後趙石虎']]
  };
  function reignText(z, y) {
    var e = era(z, y), r = REIGNS[e.cal], name = r[0][1];
    for (var i = 0; i < r.length; i++) if (y >= r[i][0]) name = r[i][1];
    return name + e.text;
  }

  var DIRS = ['東', '東南', '南', '西南', '西', '西北', '北', '東北'];
  function dirWord(from, to) {
    var a = D.ZONES[from], b = D.ZONES[to];
    var dx = b.x - a.x, dy = b.y - a.y;
    if (Math.sqrt(dx * dx + dy * dy) < 70) return '近く';
    var ang = Math.atan2(dy, dx); // y 向下為南
    var idx = Math.round(ang / (Math.PI / 4));
    idx = (idx + 8) % 8;
    return DIRS[idx];
  }
  function zoneDist(a, b) { var A = D.ZONES[a], B = D.ZONES[b]; return Math.sqrt(Math.pow(A.x - B.x, 2) + Math.pow(A.y - B.y, 2)) / 100; }
  var REMOTE = { jiao: 1, nanzhong: 1, liaodong: 1, liang: 1 };

  /* ================= 死亡率 ================= */
  var QT = [[0, 0.2], [1, 0.075], [2, 0.045], [3, 0.035], [4, 0.025], [5, 0.013], [10, 0.006], [15, 0.008], [20, 0.01], [30, 0.013], [40, 0.018], [50, 0.026], [55, 0.036], [60, 0.05], [65, 0.075], [70, 0.11], [75, 0.16], [80, 0.24], [85, 0.34]];
  function baseQ(a) { var q = QT[0][1]; for (var i = 0; i < QT.length; i++) if (a >= QT[i][0]) q = QT[i][1]; return q; }
  /* ---------- 法令：按地点 × 年份 × 統治者 ---------- */
  var POL_C = {};
  function polsAt(z, y) {
    var k = z + y; if (POL_C[k]) return POL_C[k];
    var fk = ctrl(z, y);
    return (POL_C[k] = (D.POLICIES || []).filter(function (p) { return y >= p.y[0] && y <= p.y[1] && (!p.f || p.f.indexOf(fk) >= 0) && (!p.zones || p.zones.indexOf(z) >= 0); }));
  }
  var ATM_C = {};
  function atmosAt(z, y) {
    var k = z + y; if (ATM_C[k] !== undefined) return ATM_C[k];
    var fk = ctrl(z, y);
    return (ATM_C[k] = (D.ATMOS || []).filter(function (a) { return y >= a.y[0] && y <= a.y[1] && a.f.indexOf(fk) >= 0 && (!a.zones || a.zones.indexOf(z) >= 0); })[0] || null);
  }
  function atmosLines(L, at) { var hi = L.cls === 'gentry' || !!L.office || !!L.literate; return (at.lines.all || []).concat(hi ? at.lines.hi || [] : at.lines.lo || []); }
  function atmosYear(L, y) {
    var at = !L.eth && atmosAt(L.zone, y), R = L.R;
    if (!at || !L.alive || inPal(L) || inHH(L)) return;
    if (L.age >= 10 && cool(L, 'atmos', 2) && R() < 0.45) { var al = atmosLines(L, at).filter(function (t) { return !(L.atSeen || {})[t]; }); if (al.length) { var t = pick(R, al); (L.atSeen = L.atSeen || {})[t] = 1; add(L, 2.55, 'hist', t); } }
    if (!at.risk || L.age < 18 || !(L.cls === 'gentry' || L.office)) return;
    if (R() >= at.risk * (L.office ? 1.5 : 1)) return;
    if (at.dieT && R() < (at.dieP || 0)) { die(L, 'executed', 2.6, { full: at.dieT }); return; }
    L.standing -= 2; L.body = clamp(L.body - 3, 1, 100); payFrom(L, 2000 + Math.round(L.wealth * 50));
    add(L, 2.6, 'bad', pick(R, at.riskT));
  }
  function polMul(z, y, key) { var m = 1; polsAt(z, y).forEach(function (p) { if (p.fx[key] != null) m *= p.fx[key]; }); return m; }
  function polSum(z, y, key) { var m = 0; polsAt(z, y).forEach(function (p) { if (p.fx[key]) m += p.fx[key]; }); return m; }
  /* ---------- 本郡情形：治安、糧価、流民 ---------- */
  // 這一年本地的史実圧力（不含随機事件），也用来估計別処的情形
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
    var atO = atmosAt(z, y); if (atO) t += atO.order || 0;
    P.order = clamp(t, 5, 95);
    P.price = Math.min(8, (1 + P.fam * 50) * (1 + P.war * 15) * (1 + (chaos(y) - 1) * 0.6));
    return P;
  }
  function orderLabel(v) { return v >= 75 ? '安定' : v >= 58 ? 'まずまず' : v >= 42 ? '不穏' : v >= 28 ? '盗賊横行' : '大乱'; }
  function refLabel(v, out) { return out >= 0.1 ? '外へ逃げる者が多い' : v >= 10 ? '道にあふれている' : v >= 5 ? 'かなり多い' : v >= 2 ? 'ときおり見かける' : 'ほとんどいない'; }
  function junPop(L, y) { var j = D.JUN[L.jun]; return j[2] * zonePop(L.zone, y) / Math.max(1, zonePop(L.zone, 157)); }
  function regionYear(L, y) {
    var R = L.R, z = L.zone, P = regPressure(z, y);
    if (!L.reg || L.reg.z !== z) L.reg = { z: z, order: P.order, price: P.price, ref: 0, out: 0, note: '' };
    var G = L.reg;
    G.order = clamp(G.order + (P.order - G.order) * 0.45 + (R() - 0.5) * 6, 5, 95);
    // 流民：周辺戦乱、災荒逃来的人；乱世里相対太平的地方更会湧来
    var calm = P.war < 0.004 && P.fam < 0.01 ? 1 : 0.3;
    G.ref = clamp(G.ref * 0.6 + P.inflow * 120 + P.fam * 150 + (chaos(y) - 1) * 12 * calm * (0.6 + R() * 0.8), 0, 40);
    G.out = P.out;
    var pt = P.price * (1 + Math.min(G.ref, 30) / 60) * (0.92 + R() * 0.16);
    G.price = clamp(G.price * 0.45 + pt * 0.55, 0.6, 8);
    G.note = '';
    // 地方上的事（以史実為本）
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
  // 抉択時可参考的両地情形
  function compareText(L, y, dest) {
    var G = L.reg, here = G ? { order: G.order, price: G.price, ref: G.ref } : regPressure(L.zone, y), P = regPressure(dest, y);
    var refD = P.inflow * 30;
    return '今いる郡は、治安：' + orderLabel(here.order) + '、穀物の値は一石およそ' + fmt(Math.round(PRICE * here.price)) + '銭、流民は' + refLabel(here.ref, 0) + '。' +
      '聞けば' + zname(dest) + 'は、治安：' + orderLabel(P.order) + '、穀物の値は一石およそ' + fmt(Math.round(PRICE * P.price)) + '銭' + (refD >= 5 ? '、すでに大勢がそちらへ逃げているという' : '') + '。';
  }

  // 前因後果：城池易手前先有軍報；在任者随軍務奔忙
  function foreshadow(L, y, fk) {
    var R = L.R, a = L.age, nfk = ctrl(L.zone, y + 1), zl = D.ZONES[L.zone].label;
    if (a >= 8 && !L.band && !L.eth && nfk !== fk && !SUCC[fk + '>' + nfk]) {
      var nn = lordName(nfk, y);
      if (L.office) add(L, 0.7, 'war', 'あなたが' + L.office + 'の任にあるあいだ、機上に届く軍報は日ごとに切迫していった――' + nn + 'の軍勢が' + zl + 'に迫っているという。役所では、こっそり金目の物をまとめはじめる者もいた。');
      else if (L.cls === 'gentry' && a >= 12) add(L, 0.7, 'war', '一族のもとに知らせが届いた――' + nn + 'の軍勢が' + zl + 'に迫っているという。長老たちは門を閉ざし、幾晩も続けて話し合った。');
      else if (!L.soldier && R() < 0.65) add(L, 0.7, 'rumor', pick(R, ['聞けば' + nn + 'の軍勢が攻めてくるという。村では山に穀物を隠しはじめる者も出た。', '道を逃げていく人が増えてきた。みな、' + nn + 'の大軍がすぐ後ろまで来ていると言う。', '県が告示を出し、民に城の修築と穀物の納入を急がせた――' + nn + 'が来るのだという。']));
    }
    if (L.office && !L.soldier && a >= 16) {
      var g = armyOf(fk), cs = (CAMP_BY_Y[y] || []).filter(function (c) { return c.a.indexOf(g) >= 0 || c.a.indexOf(fk) >= 0; });
      if (cs.length && R() < 0.7) {
        var c = pick(R, cs);
        add(L, 1.6, 'war', '' + c.n + 'に備えて、' + (L.office === '幕僚' ? '幕府' : '役所') + 'は昼も夜も慌ただしかった。あなたは' + L.office + 'の任にあって' + pick(R, ['軍糧を工面し、人夫を徴発し', '軍需を計算し、倉の穀物を数え', '檄文を起草し、軍書を送り届け', '負傷兵の世話をし、戦死者の家族を慰撫し']) + '、何か月も家に帰らなかった。');
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
      add(L, 0.6, 'law', y === p.y[0] ? p.t : 'あなたの住む土地では「' + p.n + '」が行われていた――' + p.s + '。');
      if (p.fx.cashLoss && E && L.cls !== 'slave' && E.cash + E.priv >= 300) {
        var lost = Math.round((E.cash + E.priv) * p.fx.cashLoss);
        E.cash = Math.round(E.cash * (1 - p.fx.cashLoss)); E.priv = Math.round(E.priv * (1 - p.fx.cashLoss));
        add(L, 0.65, 'bad', 'あなたの家が蓄えた銭は、一気に' + Math.round(p.fx.cashLoss * 10) + '割も目減りした。およそ' + fmt(lost) + '銭分の値打ちが消えたことになる。');
      }
      if (p.fx.landGrant && (L.cls === 'peasant' || L.cls === 'tuntian') && isHead(L) && L.land < 30 && R() < 0.35) {
        var g = 10 + Math.round(R() * 10);
        L.land += g; if (L.cls === 'tuntian') { L.cls = 'peasant'; L.job = '農'; }
        add(L, 0.65, 'good', 'あなたの家は新法に従って荒れ地に' + cnNum(g) + '畝の田を佔め、戸籍に登録した。');
      }
    });
    var risk = polSum(L.zone, y, 'officeRisk');
    if (risk && realOffice(L) && L.alive && R() < risk) {
      add(L, 1.3, 'bad', pick(R, ['誰かがあなたを「朝政を誹謗した」と告発した。あなたは捕らえられて獄に下され、何か月も取り調べを受けた。', '校事が、あなたの扱った文書に不備があると言い立て、あなたは獄に下された。']));
      if (R() < 0.15) { die(L, 'executed', 1.35, { full: '獄吏は誰と共謀したのかとあなたを拷問した。答えようもなく、あなたはついに獄中で死んだ。' }); return; }
      L.office = null; L.job = L.cls === 'gentry' ? '士人' : '農'; L.fame -= 4;
      add(L, 1.35, 'life', 'のちに釈放されはしたが、官職は失った。');
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
    var i = Math.floor(Math.pow(R(), 1.7) * arr.length); // 越靠前越常見
    return arr[i];
  }
  function tierOf(cls) { return cls === 'gentry' || cls === 'clerk' ? 'elite' : cls === 'slave' ? 'slave' : cls === 'merchant' ? null : 'plain'; }
  function givenName(R, sex, tier) {
    if (tier === 'elite' && R() < 0.65) return pick(R, sex === 'M' ? D.MALE_ELITE : D.FEMALE_ELITE);
    if (tier === 'slave') return sex === 'M' ? pick(R, D.SLAVE_M).slice(-1) : pick(R, D.SLAVE_F).slice(-1);
    if (tier === 'plain' && R() < 0.55) return pick(R, sex === 'M' ? D.MALE_PLAIN : D.FEMALE_PLAIN);
    return pick(R, sex === 'M' ? D.MALE : D.FEMALE);
  }
  var FAMOUS_NM = null;
  function famousName(n) {
    if (!FAMOUS_NM) { FAMOUS_NM = {}; (D.FIGURES || []).forEach(function (f) { FAMOUS_NM[f.n] = 1; }); (D.FAMOUS_NAMES || '').split(' ').forEach(function (x) { if (x) FAMOUS_NM[x] = 1; }); }
    return !!FAMOUS_NM[n];
  }
  function safeGiven(R, sur, sex, tier) { var g = givenName(R, sex, tier), t = 0; while (famousName(sur + g) && t++ < 20) g = givenName(R, sex, tier); return g; }
  function xiaoName(R, tier) { return '阿' + pick(R, tier === 'elite' ? D.XIAO_ELITE : tier === 'plain' && R() < 0.6 ? D.XIAO_PLAIN : D.XIAO); }
  function ethName(R, eth) {
    var E = D.ETH[eth], syl = E.syl.split(''), g, sr, t = 0;
    do { g = pick(R, syl) + (R() < 0.6 ? pick(R, syl) : ''); sr = E.sur ? pick(R, E.sur.split('')) : ''; } while (famousName(sr + g) && t++ < 20);
    return { sur: sr, given: g };
  }

  /* ================= 創建 ================= */
  function pickYear(R, mode) {
    var lo = 150, hi = 220;
    if (mode === 'zhongping') { lo = 182; hi = 186; }
    else if (mode === 'jianan') { lo = 194; hi = 198; }
    else if (mode === 'chaos') { lo = 175; hi = 205; }
    else if (mode === 'blind') { lo = 150; hi = 280; }
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
    else { L.sur = surname(R, L.cls); L.given = safeGiven(R, L.sur, L.sex, tierOf(L.cls)); }
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
    // 郡望：生在名族的郡里，可能就是那一族的子弟；尋常人家同姓同郡，也可能沾一点疏遠的親
    var jn = D.JUN[L.jun][0], CL = !HR && !L.eth ? (D.CLANS || []).filter(function (c) { return c.jun === jn; }) : [];
    if (CL.length && L.cls === 'gentry' && R() < (L.gate >= 3 ? 0.45 : 0.25)) { var cc = pick(R, CL); L.sur = cc.sur; L.clanK = cc.k; }
    else { var cm0 = CL.filter(function (c) { return c.sur === L.sur; })[0]; if (cm0) { L.clanK = cm0.k; L.clanPoor = L.cls !== 'gentry'; } }
    if (L.cls === 'gentry') {
      L.clanName = D.JUN[L.jun][0].replace(/(郡|国|尹)$/, '') + L.sur + '氏';
      L.gateName = L.gate >= 3 ? '代々二千石を出す高門' : '郡の名族';
      if (L.clanK) { L.clanName = clanOf(L).n; if (L.gate >= 3) L.gateName = clanOf(L).n + 'の近い分家'; }
      if (L.gate >= 3) L.standing = Math.min(95, L.standing + 10);
    }
    L.clan = 1 + Math.floor(R() * (L.cls === 'gentry' ? 5 : 3));

    // 父母
    var fAge = L.cls === 'gentry' ? 20 + Math.floor(R() * 20) : 18 + Math.floor(R() * 20);
    var mAge = 15 + Math.floor(R() * Math.min(20, fAge - 13));
    var fn = L.eth ? ethName(R, L.eth) : { sur: L.sur, given: safeGiven(R, L.sur, 'M', tierOf(L.cls)) };
    while (!L.eth && fn.given === L.given) fn.given = safeGiven(R, L.sur, 'M', tierOf(L.cls));
    var mSur = L.eth ? (D.ETH[L.eth].sur ? pick(R, D.ETH[L.eth].sur.split('')) : '') : surname(R, L.cls);
    if (mSur === L.sur && !L.eth) mSur = surname(R, L.cls) || '王';
    var father = newKin(L, 'father', 'M', L.by - fAge, fn.sur + fn.given, { lit: false });
    var mother = newKin(L, 'mother', 'F', L.by - mAge, mSur ? mSur + '氏' : '母親');
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

    // 庶出：富家、士族多有妾室，你可能是妾所生
    var shuP = L.eth || HR ? 0 : L.cls === 'gentry' ? (L.gate >= 3 ? 0.25 : 0.18) : L.cls === 'merchant' && L.wealth >= 50 ? 0.12 : L.wealth >= 62 ? 0.08 : 0;
    if (shuP > 0) L.dishu = '嫡出';
    if (R() < shuP) {
      L.shu = true; L.dishu = '庶出';
      var cs = surname(R, 'peasant'); if (cs === L.sur) cs = '李';
      mother.name = cs + '氏'; mother.concMom = true; mAge = 15 + Math.floor(R() * 8); mother.by = L.by - mAge;
      var ds = surname(R, L.cls); if (ds === L.sur || ds === cs) ds = '張';
      var dm = newKin(L, 'dimu', 'F', father.by + 1 + Math.floor(R() * 5), ds + '氏');
      dm.aff = 30 + Math.floor(R() * 30);
      if (!father.alive) { dm.alive = true; }
    }
    // 先天之疾：極少数孩子生来就与衆不同
    if (!L.eth || true) Object.keys(D.CONDS || {}).some(function (k) {
      if (R() >= D.CONDS[k].p) return false;
      L.cond = { k: k, rev: false };
      if (k === 'guai') { L.tr.soc = clamp(L.tr.soc - 25, 5, 95); L.tal.memory = clamp((L.tal.memory || 0) + 0.35, 0, 1); L.tal.craft = clamp((L.tal.craft || 0) + 0.2, 0, 1); }
      if (k === 'bo' || k === 'zhuru') L.body = clamp(L.body - 8, 10, 95);
      return true;
    });
    // 兄姉
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
      newKin(L, 'gp', gs, L.by - fAge - 20 - Math.floor(R() * 12), gs === 'M' ? fn.sur + safeGiven(R, fn.sur, 'M') : (L.eth ? '祖母' : surname(R, L.cls) + '氏'));
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

  // 名与字：小名在家里叫，大名入戸籍，表字在冠礼（女子笄礼）時取
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
    var tf = 0; while (famousName(k.sur + g) && tf++ < 20) g = givenName(R, k.sex, tr);
    k.full = k.sur + g; k.given = g; k.name = k.full;
  }
  var ZI_F1 = ['文', '恵', '令', '淑', '季', '少', '孟', '仲', '幼', '徳'], ZI_F2 = ['姫', '華', '容', '英', '君', '姜', '儀', '貞'];
  function giveZi(L, sex) { var R = L.R, z, t = 0; do { z = sex === 'M' ? pick(R, D.ZI_HEAD) + pick(R, D.MALE) : pick(R, ZI_F1) + pick(R, ZI_F2); } while (famousName((L.sur || '') + z) && t++ < 20); return z; }
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
      case 'father': return '父';
      case 'mother': return k.concMom ? '生母' : '母';
      case 'dimu': return '嫡母';
      case 'gp': return k.sex === 'M' ? '祖父' : '祖母';
      case 'sib': return k.by <= L.by ? (k.sex === 'M' ? '兄' : '姉') : (k.sex === 'M' ? '弟' : '妹');
      case 'spouse': return L.sex === 'M' ? '妻' : '夫';
      case 'child': return k.sex === 'M' ? '息子' : '娘';
      case 'conc': return L.sex === 'M' ? '妾' : '夫の妾';
    }
    return '身内';
  }
  function kinLabel(L, k) {
    var r = relName(L, k);
    if (k.rel === 'gp' || (k.rel === 'mother' && k.name === '母親')) return r;
    return r + 'の' + k.name;
  }
  // 称呼随居住地而変：同一個人，魏人、蜀人、呉人各有各的叫法
  function nameFor(L, key, y) {
    var fk = ctrl(L.zone, y), g = group(fk);
    switch (key) {
      case '曹操': if (g === 'wei' && y >= 196) return y >= 220 ? '武皇帝' : y >= 216 ? '魏王' : y >= 213 ? '魏公' : '曹公'; return y >= 196 && y < 213 ? '曹公' : '曹操';
      case '曹丕': if (g === 'wei' || g === 'jin') return y >= 227 ? '文皇帝' : y >= 220 ? '今上' : y >= 217 ? '魏太子曹丕' : '五官中郎将曹丕'; return '曹丕';
      case '劉備': if (g === 'shu' || fk === 'liubei') return y >= 223 ? '先帝' : y >= 221 ? '今上' : y >= 219 ? '漢中王' : '劉使君'; return '劉備';
      case '孫権': if (g === 'wu' || fk === 'sunquan') return y >= 252 ? '大皇帝' : y >= 229 ? '至尊' : y >= 221 ? '呉王' : '孫将軍'; return '孫権';
      case '諸葛亮': if (g === 'shu') return y >= 234 ? '諸葛丞相' : y >= 221 ? '丞相' : '諸葛軍師'; return '諸葛亮';
      case '司馬懿': if (g === 'jin') return '宣皇帝'; if (g === 'wei' && y >= 239) return '太傅'; return '司馬懿';
      case '漢帝': if (g === 'wei' && y >= 220) return '山陽公'; if (g === 'shu' && y >= 220) return '孝愍皇帝'; return '天子';
      case '劉禅': if (g === 'shu' && y < 264) return '今上'; return y >= 264 ? '安楽公劉禅' : '後主劉禅';
      case '孫皓': if (g === 'wu' && y < 280) return '主上'; return y >= 280 ? '帰命侯孫皓' : '呉主孫皓';
    }
    return key;
  }
  function nameFill(L, t) { return t.indexOf('{') < 0 ? t : t.replace(/\{(曹操|曹丕|劉備|孫権|諸葛亮|司馬懿|漢帝|劉禅|孫皓)\}/g, function (m, k) { return nameFor(L, k, L.by + L.age); }); }
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

  /* ================= 死亡与風険 ================= */
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
  var PURGE_TIES = ['岳父が{pn}の門生だった', '{pn}の推挙で官に就いたことがある', '族兄が{pn}の府に仕えている', '{pn}の宴席で詩を詠み交わしたことがある', '家が{pn}の家と姻戚関係にある'];
  var DEATH = {
    infant: ['人生最初の冬を越せなかった。', '生まれて間もなく病にかかり、満一歳を迎えられなかった。', '襁褓のうちに夭折した。母はあなたを家の裏の桑の木の下に葬った。'],
    child: ['急な病にかかり、数日高熱が続いたのちに亡くなった。わずか{a}歳だった。', '赤痢に命を奪われた。わずか{a}歳だった。', '風邪をこじらせ、持ちこたえられなかった。わずか{a}歳だった。', '村はずれの溜め池に落ち、大人たちが駆けつけたときにはもう手遅れだった。わずか{a}歳だった。'],
    ill: ['病で数か月床に就き、ついに回復しなかった。', '傷寒にかかり、七日後に世を去った。', '瘧にかかり、寒気と高熱を繰り返して、ついに助からなかった。', '積年の苦労がたたって病に倒れ、血を吐いて死んだ。', '背中に悪性のできものができ、膿み崩れて治らず、そのまま死んだ。'],
    old: ['眠りのうちに静かに旅立った。', '天寿を全うした。', 'ある冬の日の午後、戸口で日なたぼっこをしたまま、二度と目を覚まさなかった。'],
    tiger: ['山へ柴刈りに入って虎に襲われ、深手を負って助からなかった。'],
    drown: ['川を渡る途中で舟が転覆し、溺れ死んだ。'],
    fall: ['屋根を直していて足を踏み外して落ち、重傷を負って助からなかった。'],
    bandit: ['道中で盗賊に遭い、殺された。'],
    plag: ['疫病が流行り、あなたも罹って死んだ。', '大疫のさなか、高熱が引かず、数日後に世を去った。'],
    fam: ['飢饉のさなか、飢えて死んだ。', '家族とともに草の根も木の皮も食べ尽くし、ついにこの飢饉を越えられなかった。'],
    war: ['乱兵が村になだれ込み、あなたは戦禍のうちに死んだ。', '戦乱のさなか、逃げる途中で死んだ。'],
    flood: ['洪水が押し寄せ、逃げ切れなかった。'],
    corv: ['労役に服しているさなかに倒れ、二度と起き上がらなかった。'],
    battle: ['{n}で戦死した。'],
    massacre: ['城が落ちたのち、魏の兵に殺された。'],
    suicide: ['あなたは自ら命を絶った。'],
    executed: ['ある事件に巻き込まれ、獄に下されたのち処刑された。'],
    childbirth: ['子を産んだあと出血が止まらず、難産で死んだ。'],
    road: ['逃げ延びる途中の道で倒れた。'],
    feud: ['仇として狙われ、刃にかかって死んだ。']
  };
  var CAUSE_SHORT = { suicide: '自害', fade: '行方知れず', executed: '誅殺', infant: '夭折', child: '夭折', ill: '病死', old: '天寿', tiger: '虎害', drown: '溺死', fall: '事故', bandit: '盗賊', plag: '疫病', fam: '飢饉', war: '戦禍', flood: '水害', corv: '労役', battle: '戦死', massacre: '屠城', executed: '連座', childbirth: '難産', road: '逃亡中に死去', feud: '仇討ち' };
  var CAUSE_STAT = { fade: '行方知れず', infant: '夭折', child: '夭折', ill: '病気', old: '天寿', tiger: '事故', drown: '事故', fall: '事故', bandit: '戦禍・盗賊', plag: '疫病', fam: '飢饉', war: '戦禍・盗賊', flood: '事故', corv: '労役', battle: '戦死', massacre: '戦禍・盗賊', executed: '連座', childbirth: '難産', road: '飢饉', feud: '戦禍・盗賊' };

  function die(L, cause, s, map) {
    if (!L.alive) return;
    // 寛限：玩家本人在幼年多半能挺過来（同時辰者与統計仍按史実）
    var spare = !L.auto && !L.opts.harsh ? (L.age < 5 ? 0.93 : L.age < 15 ? 0.8 : 0) : 0;
    if (spare && L.R() < spare && cause !== 'battle' && cause !== 'executed') {
      L.body = clamp(L.body - 4, 5, 100);
      add(L, s, 'bad', fresh(L, L.age < 5 ? ['息も絶えかけるほどの病だった。母があなたを抱いて三日三晩見守り、あなたは奇跡的に持ち直した。', '高熱が引かず、家では小さな棺まで用意された。四日目の朝、あなたは目を開けた。', 'あのときは危うく助からないところだった。祖母は、ご先祖様のご加護だと言った。', '大病をして骨と皮ばかりに痩せたが、それでもなんとか持ちこたえた。'] : ['重い病にかかり、家では巫祝を呼び、薬草も煎じた。運よく、あなたは持ちこたえた。', 'その年、あなたは危うく死にかけた。のちに大人たちはその話になると、拾った命だと口をそろえた。']));
      return;
    }
    if (L.opts.surviveUntil && L.rec.y <= L.opts.surviveUntil) {
      if (!L.rec.spared) { L.rec.spared = true; L.body = clamp(L.body - 6, 5, 100); add(L, s, 'bad', '大病を患い、危うく命を落としかけたが、どうにか持ちこたえた。'); }
      return;
    }
    var pool = DEATH[cause];
    if ((cause === 'ill' || cause === 'child') && D.REGION && D.REGION[L.zone] && D.REGION[L.zone].ill >= 1.15 && L.R() < 0.5) pool = cause === 'ill' ? ['瘴癘にかかり、悪寒と高熱にかわるがわる襲われて、ひと月後に世を去った。'] : ['瘴癘にかかって高熱が引かず、わずか{a}歳で世を去った。'];
    var t = map && map.full ? map.full : fill(pick(L.R, pool), map || { a: L.age });
    var e = add(L, s, 'death', t);
    L.alive = false; L.cause = cause; L.causeText = t; L.deathS = s; L.deathI = e.i; L.dy = L.rec.y;
    L.rec.death = true;
  }

  function kinDie(L, k, cause, s, y, extra) {
    if (!k.alive || (k.famous && y !== k.fixDy)) return;
    k.alive = false; k.dy = y; k.cause = cause;
    if (k.apart) return;
    if (k.rel === 'father' && L.shu && !L.split && L.age >= 6 && !(L.sex === 'F' && L.married)) shuFatherDie(L, y, s);
    if (k.rel === 'father' && L.sex === 'F' && !L.married && L.age >= 8 && L.cls !== 'slave' && L.land > 0 && L.kin.some(function (x) { return x.rel === 'sib' && x.sex === 'M' && x.alive; }))
      add(L, (s || 2) + 0.3, 'life', '父の死後、家の田畑はすべて兄弟のものになった。しきたりでは、娘が受け取れるのは嫁入り道具の分だけだった。');
    var a = y - k.by, nm = kinLabel(L, k), t;
    switch (k.deathT ? 'fixed' : cause) {
      case 'fixed': t = k.deathT; break;
      case 'plag': t = nm + 'は疫病にかかり、持ちこたえられなかった。'; break;
      case 'fam': t = '飢饉のさなか、' + nm + 'が飢え死にした。'; break;
      case 'war': t = nm + 'は乱兵の手にかかって死んだ。'; break;
      case 'flood': t = nm + 'は洪水に呑まれた。'; break;
      case 'corv': t = nm + 'は役務のさなか、工事場で力尽きて死んだ。'; break;
      case 'battle': t = nm + 'は' + extra + 'で戦死し、二度と帰らなかった。'; break;
      case 'massacre': t = '城が落ちたのち、' + nm + 'は殺された。'; break;
      case 'executed': t = nm + 'は連座して殺された。'; break;
      case 'childbirth': t = nm + 'は難産で死んだ。'; break;
      case 'road': t = '逃げ延びる途中、' + nm + 'は道端に倒れた。'; break;
      default:
        if (a <= 1) t = nm + 'は満一歳を迎えられなかった。';
        else if (a < 15) t = nm + 'は急な病にかかって夭折した。わずか' + cnNum(a) + '歳だった。';
        else if (a < 55) t = nm + 'は病で亡くなった。享年' + cnNum(a) + '。';
        else t = nm + 'は世を去った。享年' + cnNum(a) + '。';
    }
    add(L, s, 'fam', t);
    if (k.rel === 'father' || k.rel === 'mother') { L.parentDied = y; L.parentDiedName = relName(L, k); }
    if (k.rel === 'spouse') { L.widowed = true; L.married = false; }
    if (k.rel === 'child') L.rec.tags.push('loss');
  }

  function liveKin(L, filt) { return L.kin.filter(function (k) { return k.alive && !k.apart && (!filt || filt(k)); }); }

  /* ================= 一年的準備：可能産生選択 ================= */
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
    if (inHH(L)) return false;
    if (m.elite && (L.flags.famousConc || !(L.cls === 'gentry' || L.office || L.cls === 'clerk' || L.learn >= 45 || L.fame >= 20))) return false;
    if (m.follow && (L.soldier || L.band)) return false;
    if (m.off && !realOffice(L)) return false;
    if (m.sol && !(L.soldier && (m.sol === true || L.soldier.army === m.sol))) return false;
    if (!m.sol && m.q && L.soldier && !m.off) return false;
    if (m.cls && m.cls.indexOf(L.cls) < 0) return false;
    if (m.fac && group(ctrl(L.zone, y)) !== m.fac) return false;
    return true;
  }

  // 地位越高，越可能見到名人
  var OFF_RANK = { 書佐: 1.3, 計吏: 1.5, 県長: 1.8, 幕僚: 2.2, 郎官: 2.2, 尚書郎: 2.6, 県令: 2.3, 郡守: 3.4, 刺史: 4.2, 九卿: 4.8 };
  function statusMul(L) {
    var m = { gentry: 5, clerk: 3, merchant: 1.6, slave: 0.3, tenant: 0.6, tribal: 0.6, tuntian: 0.6, soldier: 0.7 }[L.cls] || 0.8;
    if (L.cls === 'gentry') m *= L.gate >= 3 ? 1.8 : L.gate >= 2 ? 1.3 : 1;
    if (L.office) m *= OFF_RANK[L.office] || (LOCAL_OFF[L.office] ? 1.1 : 2);
    if (L.mil) m *= 1 + L.mil * 0.4;
    if (L.literate) m *= 1.3;
    if (L.flags.salon) m *= 1.4;
    if (L.flags.connected || L.flags.retainers) m *= 1.15;
    return m * (1 + L.fame / 50);
  }
  // 同席交遊：高門、大官、名士之家，常在宴会、拝訪、雅集中結識当時当地的人物
  var FIG_AT = null;
  function figPresence() {
    if (FIG_AT) return FIG_AT;
    FIG_AT = {};
    D.MEETS.forEach(function (m) { if (m.eth || m.sol || m.cls) return; (FIG_AT[m.f] = FIG_AT[m.f] || []).push(m); });
    return FIG_AT;
  }
  var CIRCLE_P = { 書佐: 0.01, 計吏: 0.02, 県長: 0.025, 幕僚: 0.07, 郎官: 0.06, 尚書郎: 0.08, 県令: 0.045, 郡守: 0.09, 刺史: 0.13, 九卿: 0.13 };
  // 少年故交：同郷同齢，日後成了名人
  function youthFriend(L, y) {
    var R = L.R, a = L.age;
    if (a < 8 || a > 24 || L.eth || L.cls === 'slave' || !L.alive) return;
    (D.YOUTH || []).forEach(function (Y) {
      if (L.met[Y.f] || y < Y.y[0] || y > Y.y[1] || Y.zones.indexOf(L.zone) < 0 || (Y.jun && Y.jun.indexOf(D.JUN[L.jun][0]) < 0)) return;
      if (L.sex === 'F' && Y.f !== 'zhugeliang') return;
      // 少年交遊也講門第：曹操、周瑜結交的是豪族子弟，荀彧、司馬懿的同窗是士族，鄧艾、呂蒙則是窮苦人家的孩子
      var tk = lifeTier(L, y).k, rich = L.cls === 'gentry' || tk === 'high' || tk === 'top';
      if ((Y.need === 'rich' && !rich) || (Y.need === 'gentry' && L.cls !== 'gentry') || (Y.need === 'lit' && !L.literate && L.cls !== 'gentry') || (Y.need === 'poor' && (L.cls === 'gentry' || tk === 'top'))) return;
      if (R() >= 0.012 * (L.literate ? 1.5 : 1) * (L.tr.soc / 50)) return;
      var fig = D.FIGURES.filter(function (f) { return f.id === Y.f; })[0];
      var fr = { name: fig.n, sex: 'M', by: L.by + Math.round((R() - 0.5) * 4), since: y, ctx: 'child', aff: 70, alive: true, apart: false, job: '', fate: '', fig: Y.f };
      (L.friends = L.friends || []).push(fr);
      var YR = (D.YOUTH_RISE || {})[Y.f];
      if (YR && YR.poor && rich) { fr.helped = true; fr.aff = 85; }
      add(L, 2.1, 'meet', Y.t + (fr.helped ? '彼の家は貧しく、あなたの家はよく援助していた。彼はそのことをずっと恩に感じていた。' : ''));
      markMet(L, Y.f, y, 'あなたと' + fig.n + 'は少年時代の友だった。');
      L.youthFig = Y.f;
      L.rec.tags.push('meet');
    });
  }
  // 名人之妾：乱世里的諸侯納妾，尋常人家的女児偶爾也会被看中
  // y 可能被納的年份；d 卒年；b 生年（不詳則不写年歳）；seat 府邸所在；dt 死訊，拠本伝
  var FAMOUS_CONC = {
    caocao: { pal: [[213, '魏公宮', '曹公が魏公に封ぜられ、鄴に魏国を建てた。屋敷は魏国の宮室となった。'], [216, '王宮', '曹公が魏王に進み、あなたは鄴の魏王宮に住むことになった。']], y: [192, 219], d: 220, b: 155, seat: function (y) { return y < 204 ? ['潁川郡', '許県'] : ['魏郡', '鄴県']; }, dt: '夫の曹操が洛陽で病没した。享年六十六。' },
    liubei: { pal: [[219, '王宮', '劉備が漢中王に進み、屋敷は王宮と呼ばれるようになった。あなたは屋敷の女たちとともに宮室へ移り、出入りには宮門の衛兵を通らねばならなくなった。'], [221, '皇宮', '劉備が成都で皇帝に即位した。あなたは後宮の側妾の一人となり、成都の宮中に住むことになった。宮門が閉じれば、外の人に会うことはめったになかった。']], y: [194, 222], d: 223, b: 161, seat: function (y) { return y < 201 ? ['下邳国', '下邳'] : y < 209 ? ['南陽郡', '新野'] : y < 214 ? ['南郡', '江陵'] : ['蜀郡', '成都']; }, dt: '夫の劉備が永安宮で病没した。享年六十三。' },
    sunce: { y: [195, 199], d: 200, b: 175, seat: function () { return ['呉郡', '呉県']; }, dt: '夫の孫策が狩りの最中に許貢の食客に襲われ、その深手がもとで死んだ。享年二十六。' },
    sunquan: { pal: [[221, '王宮', '孫権は魏から呉王に封ぜられ、屋敷は王宮となって、決まりごとが一気に増えた。'], [229, '皇宮', '孫権が武昌で皇帝に即位し、秋には建業へ遷都した。あなたも後宮とともに建業の太初宮へ移った。']], y: [200, 251], d: 252, b: 182, seat: function (y) { return y < 211 ? ['呉郡', '呉県'] : ['丹楊郡', y < 212 ? '秣陵' : '建業']; }, dt: '夫の孫権が病没した。享年七十一。' },
    yuanshao: { y: [191, 201], d: 202, seat: function () { return ['魏郡', '鄴県']; }, dt: '夫の袁紹は官渡で敗れたのち病を発して血を吐き、ほどなく死んだ。' },
    liubiao: { y: [190, 207], d: 208, b: 142, seat: function () { return ['南郡', '襄陽']; }, dt: '夫の劉表は背中に悪性の腫れ物ができ、病死した。享年六十七。' },
    lvbu: { y: [194, 198], d: 199, seat: function (y) { return y < 196 ? null : ['下邳国', '下邳']; }, dt: '下邳が落城し、夫の呂布は曹操に絞め殺された。' },
    dongzhuo: { y: [189, 191], d: 192, seat: function (y) { return y < 191 ? ['河南尹', '洛陽'] : ['京兆尹', '長安']; }, dt: '夫の董卓は朝賀のため参内したところ、掖門で呂布に戟で刺し殺された。' }
  };

  // 名人府里的日子：随他的為人、妻室和経歴而定
  var CONC_FU = ['屋敷の女たちと針仕事をしながら、外の噂話を聞いた。', '正室から割り当てられた仕事を、ひとつひとつ片づけた。', '屋敷に大事な客が来ると、側妾たちは奥に控え、外へ出ることを許されなかった。', '屋敷の高い塀の向こうから、通りの物売りの声が聞こえた。', '節句には、屋敷から側妾一人ひとりに新しい着物が下された。'], CONC_PAL = ['宮中の日々は長かった。ほかの側妾たちと針仕事をしながら、宮人から外の話を聞いた。', '宮中で宴が開かれた。あなたは末席から、上座の冠を遠く眺めるだけだった。', '彼に会えるのはひと月に一度あるかないかだった。宮門の外のことは、宦官や宮人から聞くしかなかった。', '節句には、宮中から絹や白粉が下された。', '宮中の小さな庭に花を植え、毎年咲いては散るのを眺めた。'];
  function C2seat(id, y) { var C = FAMOUS_CONC[id]; return C && C.seat ? C.seat(y) : null; }
  function concLifeYear(L, y) {
    var id = L.flags.famousConc, k = L.spouseK, CL = id && (D.CONC_LIFE || {})[id], R = L.R;
    if (!CL || !k || !k.famous || !k.alive || k.apart || L.marriedAt === y) return;
    L.clDone = L.clDone || {};
    // 他怎様待你：進府後的頭一両年，按你的性情決定
    var TR = (D.CONC_TREAT || {})[id];
    if (TR && !L.flags.fcTreat && (y - L.marriedAt >= 2 || R() < 0.5)) {
      var ok = { charm: !!L.found.charm, lit: !!L.literate, soc: L.tr.soc >= 60, cau: L.tr.cau >= 60, per: L.tr.per >= 60, any: true };
      var m = TR.filter(function (x) { return ok[x.c] && x.c !== 'any' && (!x.y || (y >= x.y[0] && y <= x.y[1])); }), tt = m.length ? pick(R, m) : TR.filter(function (x) { return x.c === 'any'; })[0];
      L.flags.fcTreat = true; if (tt.fav) L.flags.fcFav = true;
      var tf = tt.fx || {};
      if (tf.learn) L.learn = Math.min(100, (L.learn || 0) + tf.learn);
      if (tf.standing) L.standing += tf.standing;
      if (tf.body) L.body = clamp(L.body + tf.body, 1, 100);
      add(L, 1.39, tt.fav ? 'good' : 'life', tt.t);
      return;
    }
    (FAMOUS_CONC[id].pal || []).forEach(function (pp) { if (pp[0] === y) { L.flags.fcPal = pp[1]; add(L, 1.37, 'life', pp[2]); } });
    if (CL && C2seat(id, y)) seatMove(L, C2seat(id, y), 1.38, 'あなたは彼の家族とともに{dest}へ移った。', y);
    var must = [], opt = [];
    CL.ev.forEach(function (e, i) { if (!L.clDone[i] && y >= e.y[0] && y <= e.y[1]) (e.must ? must : opt).push(i); });
    var i = must.length ? must[0] : opt.length && R() < 0.4 ? pick(R, opt) : null;
    if (i == null) return;
    var e = CL.ev[i], fx = e.fx || {};
    L.clDone[i] = true;
    add(L, 1.4, 'life', e.t);
    if (fx.standing) L.standing += fx.standing;
    if (fx.body) L.body = clamp(L.body + fx.body, 1, 100);
    if (fx.seat) seatMove(L, fx.seat, 1.41, 'あなたは彼の家族とともに{dest}へ移り住んだ。', y);
    var r = R();
    if (fx.die && r < fx.die) { die(L, 'war', 1.42, { full: fx.dieT }); return; }
    if (fx.lost && r >= (fx.die || 0) + fx.lost && fx.backT) add(L, 1.42, 'life', fx.backT);
    if (fx.lost && r < (fx.die || 0) + fx.lost) {
      add(L, 1.42, 'bad', fx.lostT);
      k.apart = true; L.married = false; L.widowed = true; L.flags.fcLost = true;
      if (fx.lostZ) seatMove(L, fx.lostZ, 1.43, 'あなたは{dest}に身を置くことになった。', y);
    }
  }
  // 少年故交飛黄騰達之後
  function youthTier(YR, y) { var t = -1; YR.r.forEach(function (r, i) { if (y >= r[0]) t = i; }); return t; }
  function youthFr(L) { return (L.friends || []).filter(function (f) { return f.fig === L.youthFig; })[0]; }
  function youthChoice(L, y, P) {
    var id = L.youthFig, YR = id && (D.YOUTH_RISE || {})[id], fr = youthFr(L);
    if (!YR || !fr || !fr.alive || (YR.d && y >= YR.d)) return;
    var t = youthTier(YR, y);
    if (t < 0 || t <= (L.yfTier == null ? -1 : L.yfTier)) return;
    L.yfTier = t;
    var n = figName(id), T = YR.r[t], a = L.age;
    var can = a >= 16 && a <= 60 && L.cls !== 'slave' && !L.flags.palaceIn && !L.eth && !L.band && YR.k !== 'lit' && !L.flags.yfServed && (L.yfAsk || 0) < 2 && !(L.sex === 'F' && L.married && L.flags.famousConc);
    if (!can) { L.yfNews = '少年時代の友' + n + 'が、いまや' + T[1] + 'になったと聞いた。'; return; }
    L.yfAsk = (L.yfAsk || 0) + 1;
    var o = L.sex === 'F' ? ['人に託して贈り物を届け、旧交を温める', '彼の邪魔はしない'] : ['彼のもとへ身を寄せに行く', '手紙を書いて旧交を温める', '彼の邪魔はしない'];
    P.queue.push({ key: 'yfr', fid: id, tier: t, q: '少年時代をともに過ごした' + n + 'が、いまや' + T[1] + 'になっている。' + (fr.helped ? 'かつてあなたの家は彼を援助したことがある。' : '') + '彼を訪ねてみろと勧める者がいた。', o: o, w: L.sex === 'F' ? [2, 1] : [2, 2, 1] });
  }
  function youthOutcome(L, y, c, i) {
    var R = L.R, id = c.fid, YR = D.YOUTH_RISE[id], T = YR.r[c.tier], n = figName(id), fr = youthFr(L);
    if (!fr) return;
    if (L.sex === 'F') i = i === 0 ? 1 : 2;
    if (i === 2) { add(L, 1.3, 'life', '行かなかった。彼はいまや' + T[1] + 'だ。きっと自分のことなどとうに忘れているだろう、と思った。'); return; }
    // 記不記得你：看他的為人、你們当年的交情、你如今的身份
    var hi = (L.cls === 'gentry' && L.gate >= 2) || (OFF_RANK[L.office] || 0) >= 2;
    var pr = YR.nj * (fr.helped ? 1.25 : 1) * (0.6 + (fr.aff || 60) / 150) * (hi ? 1.15 : 1);
    if (i === 1) {
      if (R() < pr) {
        affAdd(fr, 10);
        if (L.sex === 'F') { L.eco.cash += 2000; add(L, 1.3, 'good', n + 'から返事が届き、人を介して手厚い贈り物まで送られてきた。手紙には、少年時代のことは今もみな覚えている、と書かれていた。'); }
        else if (L.literate || L.cls === 'gentry') { L.flags.praised = true; L.fame += 4; add(L, 1.3, 'good', n + 'から長い返事が届いた。少年時代の出来事を、ひとつひとつよく覚えていた。人前であなたを褒めたこともあったらしい。それ以来、州郡にもあなたの名を知る者が現れた。'); }
        else { L.eco.cash += 3000; add(L, 1.3, 'good', '人に頼んで手紙を代筆してもらった。数か月後、' + n + 'の使いが三千銭と一言を届けてきた。「困ったことがあれば、訪ねて来い」'); L.flags.yfOpen = true; }
      } else add(L, 1.3, 'life', '手紙は送ったが、それきり返事はなかった。届いたのかもしれないし、届かなかったのかもしれない。');
      return;
    }
    // 投奔
    var dest = T[2], far = dest && dest !== L.zone;
    if (R() >= pr * (L.flags.yfOpen ? 1.3 : 1)) {
      L.eco.cash = Math.max(0, L.eco.cash - 800);
      add(L, 1.3, 'bad', far ? '何日も歩いて' + n + 'を訪ねた。門番に外で止められ、門の外で三日待ったが、返ってきたのは「' + ({ lord: '主公はご多忙だ', gen: '将軍は軍務中だ' }[YR.k] || '殿は公務でお忙しい') + '」の一言だけだった。仕方なく家に帰った。' : '' + n + 'を訪ねた。門番に外で止められ、昔なじみを名乗って来る者など毎日いくらでもいる、と言われた。');
      affAdd(fr, -10);
      return;
    }
    affAdd(fr, 12); L.flags.yfServed = id; L.patron = true;
    if (far) relocate(L, dest, 1.31, '旅支度を整え、{dest}へ向かった。', 0.02, y);
    if (!L.alive) return;
    var lord = YR.k === 'lord' ? id : lordFigAt(ctrl(L.zone, y), y), lit = L.literate || L.cls === 'gentry';
    if (lit) {
      L.office = '幕僚'; L.job = '幕僚'; L.officeMax = n + '府の掾属'; L.fame += 6;
      add(L, 1.32, 'good', n + 'はあなたを一目で見分け、手を取って少年時代の話を長々と語った。彼はあなたをそばに置き、掾属とした。');
      if (lord) serveLord(L, lord, y, YR.k === 'lord' ? '少年時代の旧友' + n + 'を頼り、その幕府に仕えた' : '少年時代の旧友' + n + 'の推挙で幕府に仕えた');
    } else if (YR.k === 'lord' || YR.k === 'gen') {
      add(L, 1.32, 'good', n + 'はあなたを覚えていて、笑いながら幼名で悪態をついた。彼はあなたをそばに置き、親兵にした。');
      enlist(L, y, 1.33, false);
      if (L.soldier) { L.mil = Math.max(L.mil || 0, 1); L.job = '親兵'; }
    } else {
      L.eco.cash += 5000; L.standing += 4;
      add(L, 1.32, 'good', n + 'はあなたを覚えていた。屋敷での仕事を世話してくれたうえ、暮らしを立てる金まで贈ってくれた。');
    }
  }
  function youthNews(L, y) {
    if (L.yfNews) { add(L, 2.05, 'meet', L.yfNews); L.yfNews = null; if (L.youthFig && D.YOUTH_RISE[L.youthFig].k === 'lit') L.fame += 1; }
    var id = L.youthFig, YR = id && (D.YOUTH_RISE || {})[id], fr = youthFr(L);
    if (!YR || !fr || !fr.alive || !YR.d || y !== YR.d) return;
    fr.alive = false; fr.dy = y; fr.fate = '史書に名を残す';
    if (L.age >= 10) add(L, 2.05, 'fam', YR.dt);
    if (L.flags.yfServed === id) { L.patron = false; if (YR.k !== 'lord' && L.office === '幕僚' && L.R() < 0.4) { L.office = null; L.job = L.cls === 'gentry' ? '士人' : '農'; add(L, 2.06, 'life', '彼が死ぬと、あなたは屋敷での後ろ盾を失い、ほどなく家へ帰された。'); } }
  }
  // 名人之女：高門子弟極少数的婚配
  function wedFigChoice(L, y, P) {
    if (L.sex !== 'M' || L.married || L.spouseK || L.widowed || L.age < 17 || L.age > 27 || L.flags.wfAsk || L.eth) return;
    if (!(L.cls === 'gentry' && (L.gate >= 2 || realOffice(L)))) return;
    var fk = ctrl(L.zone, y), lf = lordFigAt(fk, y), gk = group(fk);
    var c = (D.WED_FIG || []).filter(function (W) { return y >= W.y[0] && y <= W.y[1] && (W.lord ? W.lord === lf : W.g === gk); });
    if (!c.length || L.R() >= 0.02 * (L.gate >= 3 ? 2 : 1) * (L.fame >= 30 ? 1.5 : 1) * (L.shu ? 0.3 : 1)) return;
    L.flags.wfAsk = true;
    var W = pick(L.R, c);
    P.queue.push({ key: 'wfig', wi: (D.WED_FIG).indexOf(W), q: W.t, o: ['この縁談を受ける', 'やんわりと断る'], w: [4, 1] });
  }
  function wedFigOutcome(L, y, c, i) {
    var R = L.R, W = D.WED_FIG[c.wi], n = figName(W.f);
    if (i === 1) {
      if (W.lord && R() < 0.35) { L.flags.zzno = true; add(L, 1.3, 'bad', 'すでに婚約があると言って断った。' + n + 'は何も言わなかったが、それ以来、州郡からあなたを辟召する者は二度と現れなかった。'); }
      else add(L, 1.3, 'life', 'すでに婚約があると言って断った。話はそれきりになった。');
      return;
    }
    var k = newKin(L, 'spouse', 'F', L.by + 1 + Math.floor(R() * 5), W.sur + '氏', { sur: W.sur, famDad: W.f });
    L.spouseK = k; L.married = true; L.widowed = false; L.marriedAt = y;
    L.flags.wedFig = W.f; L.fame += 8; L.standing += 8; L.flags.connected = true;
    L.rec.tags.push('marry'); L.rec.tags.push('meet');
    add(L, 1.3, 'good', 'あなたは' + n + 'の娘を娶った。婚礼の日、祝いに訪れた車馬が通りを埋め尽くした。史書には、彼女はただ「' + W.sur + '氏」とだけ記されるだろう――記されるとすれば、だが。');
    markMet(L, W.f, y, 'あなたは' + n + 'の娘婿だ。');
    if (!L.office && R() < 0.6) {
      L.office = '幕僚'; L.job = '幕僚'; L.officeMax = n + '府の掾属';
      add(L, 1.31, 'good', '婚礼から間もなく、岳父はあなたを掾属に辟召した。');
      if (W.lord) serveLord(L, W.lord, y, '岳父' + n + 'の掾属となった');
    }
  }
  function wedFigYear(L, y) {
    var id = L.flags.wedFig; if (!id) return;
    var W = D.WED_FIG.filter(function (w) { return w.f === id; })[0], n = figName(id);
    if (y === W.d) add(L, 2.05, 'fam', '岳父の' + n + 'が亡くなった。' + (L.spouseK && L.spouseK.famDad === id && L.spouseK.alive ? '妻は泣き続けて、何日も食事をとらなかった。' : ''));
    if (id === 'yuanshao' && y === 205) { add(L, 2.06, 'bad', '袁譚が敗れて殺され、妻の実家の袁氏は完全に没落した。曹操は袁家の姻戚を咎めなかったが、あなたはそれ以来この縁組について口を閉ざした。'); if (L.office === '幕僚') { L.office = null; L.job = '士人'; } }
    if (id === 'liubiao' && y === 208) add(L, 2.06, 'bad', '曹操の大軍が南下し、劉琮は荊州を挙げて降伏した。妻の実家はそれきり立ち直れなかった。');
    if (id === 'simayi' && y === 249) { L.fame += 5; add(L, 2.06, 'good', '高平陵の変で、岳父の司馬懿が曹爽を誅した。司馬家の娘婿であるあなたのもとには、一夜にして取り入ろうとする者が押し寄せ、門の敷居がすり減るほどだった。'); }
  }
  // 庶出的人，父親一死，家里的位置就変了
  function shuFatherDie(L, y, s) {
    var R = L.R, bro = L.kin.some(function (x) { return x.rel === 'sib' && x.sex === 'M' && x.alive; }), mom = L.kin[1], dm = L.kin.filter(function (x) { return x.rel === 'dimu' && x.alive; })[0];
    if (L.sex === 'M' && bro) {
      L.land = Math.round(L.land * 0.3); L.eco.cash = Math.round(L.eco.cash * 0.4); L.eco.house = Math.min(L.eco.house, 3000);
      add(L, (s || 2) + 0.31, 'bad', '父の死後、' + (dm ? '嫡母' : '一族の長老') + 'の差配で家産が分けられた。田畑と屋敷の大半は嫡出の兄弟のものとなり、あなたが得たのはわずかな分け前だけだった。');
    } else if (L.sex === 'M') add(L, (s || 2) + 0.31, 'life', '父には嫡出の息子がいなかった。庶子のあなたが、家を背負って立てるただ一人の男子となった。一族には不服な者もいたが、認めるほかなかった。');
    if (mom && mom.alive && mom.concMom && dm && R() < 0.35) {
      mom.apart = true;
      add(L, (s || 2) + 0.32, 'bad', '嫡母はあなたの生母を家から追い出した。まだ若いのだから、この家に留まることはない、と言って。門まで追いかけたときには、一台の牛車が遠ざかっていくのが見えるだけだった。');
    }
  }

  // 民夫：大戦要糧，糧要人運
  function civWarChoice(L, y, P) {
    var a = L.age, fk = ctrl(L.zone, y);
    if (L.sex !== 'M' || a < 16 || a > 55 || L.soldier || L.band || L.eth || L.office || ['peasant', 'tenant', 'tuntian', 'artisan', 'clerk'].indexOf(L.cls) < 0) return;
    var W = (D.CIV_WAR || []).filter(function (w) { return y >= w.y[0] && y <= w.y[1] && w.zones.indexOf(L.zone) >= 0 && (w.fk.indexOf(fk) >= 0 || w.fk.indexOf(group(fk)) >= 0) && !(L.civDone || {})[w.n + y]; })[0];
    if (!W || L.R() >= (W.y[1] > W.y[0] ? 0.25 : 0.55)) return;
    (L.civDone = L.civDone || {})[W.n + y] = true;
    P.queue.push({ key: 'civwar', wi: D.CIV_WAR.indexOf(W), q: W.t + '里正が名簿を手に家にやって来て、あなたの名が呼ばれた。', o: ['役に就く', '金を出して人を僱い、代わりに行かせる', '山に逃げ込んでしばらく隠れる'], w: [3, L.eco.cash >= 2000 ? 2 : 0.1, 1] });
  }
  function civWarOutcome(L, y, c, i) {
    var R = L.R, W = D.CIV_WAR[c.wi];
    if (i === 1 && L.eco.cash < 2000) i = 0;
    if (i === 0) {
      if (R() < W.die * bodyMul(L)) { die(L, 'corv', 1.3, { full: W.n === '北伐' ? '食糧を背負って桟道を進んでいたとき、足を滑らせ、荷もろとも谷底へ落ちた。' : W.n === '赤壁' ? '軍中で疫病にかかり、生きて帰れなかった。' : '軍糧を運ぶ途中で力尽きて倒れ、二度と起き上がらなかった。' }); return; }
      L.body -= 4; L.standing += 1; L.rec.tags.push('war');
      add(L, 1.3, 'life', pick(R, ['何か月も糧車を押して歩き、足のまめは潰れてはまたできた。帰ってきたときには、家族にも見分けがつかないほど痩せていた。', '大軍のために一度糧を運び、前線の陣営と地を埋める死者をこの目で見た。帰ってからも、長いあいだそのことを口にしたがらなかった。', '輸送隊について' + W.n + 'まで歩き、また歩いて戻った。一緒に行った者のうち、何人もが帰らなかった。']));
    } else if (i === 1) { payFrom(L, 2000); add(L, 1.3, 'life', '二千銭で貧しい男を僱い、代わりに行かせた。のちに聞いたところでは、その男は帰ってこなかった。'); }
    else if (R() < 0.35) { L.body -= 5; L.eco.cash = Math.max(0, L.eco.cash - 500); add(L, 1.3, 'bad', '山に隠れたが、数日で見つけ出された。棒で打たれ、罰金まで取られ、結局は糧を運びに引っ立てられた。'); }
    else { L.standing -= 2; add(L, 1.3, 'life', '山に一か月あまり隠れ、徴発の役人が去ってからようやく戻った。村の人々があなたを見る目は、どこかよそよそしかった。'); }
  }
  // 大戦之年，不同身份的人各有各的経歴
  function civWarYear(L, y) {
    var R = L.R, a = L.age, fk = ctrl(L.zone, y);
    if (!L.alive || L.soldier || L.band || a < 16) return;
    var W = (D.CIV_WAR || []).filter(function (w) { return y >= w.y[0] && y <= w.y[1] && w.zones.indexOf(L.zone) >= 0 && (w.fk.indexOf(fk) >= 0 || w.fk.indexOf(group(fk)) >= 0); })[0];
    // 幕府中人随軍出征
    if (L.office === '幕僚' && L.lordFk) {
      var c = (CAMP_BY_Y[y] || []).filter(function (c) { return c.a.indexOf(armyOf(L.lordFk)) >= 0 || c.a.indexOf(L.lordFk) >= 0; })[0];
      if (c && R() < 0.4 && !(L.civDone || {})['mf' + y]) {
        (L.civDone = L.civDone || {})['mf' + y] = true;
        if (R() < c.r * 0.25) { die(L, /疫/.test(c.t || '') ? 'plag' : 'battle', 1.4, { n: c.n, full: /疫/.test(c.t || '') ? '軍に従って' + c.n + 'に出征し、陣中で疫病にかかって、陣営で死んだ。' : '軍に従って' + c.n + 'に出征した。本営が敵軍に破られ、逃げ出せなかった。' }); return; }
        L.fame += 2; L.battles = (L.battles || []).concat([c.n]);
        add(L, 1.4, 'war', pick(R, ['軍に従って' + c.n + 'に出征し、幕府で文書を司って、日夜軍令を起草し、糧秣の帳簿を確かめた。', '軍に従って' + c.n + 'に出征した。軍議の席で末座から少し意見を述べると、主将がちらりとあなたを見た。', '軍に従って' + c.n + 'に至った。軍幕から外を眺めると、山一面に陣の火が灯っていた。']));
        return;
      }
    }
    if (!W) return;
    // 妻子：丈夫被徴去運糧
    if (L.sex === 'F' && L.married && L.spouseK && L.spouseK.alive && !L.spouseK.apart && !L.spouseK.famous && farmerish(L) && R() < (W.y[1] > W.y[0] ? 0.15 : 0.4) && !(L.civDone || {})['f' + W.n + y]) {
      (L.civDone = L.civDone || {})['f' + W.n + y] = true;
      add(L, 1.45, 'life', W.t + '夫の' + L.spouseK.name + 'が名簿に挙げられ、幹し飯を背負って出ていった。');
      if (R() < W.die * 1.2) kinDie(L, L.spouseK, 'corv', 1.46, y);
      else add(L, 1.46, 'life', '数か月後、夫は帰ってきた。見る影もなく痩せ細っていた。');
      return;
    }
    // 商人：軍需
    if (L.cls === 'merchant' && L.sex === 'M' && R() < 0.4 && !(L.civDone || {})['m' + W.n + y]) {
      (L.civDone = L.civDone || {})['m' + W.n + y] = true;
      if (R() < 0.7) { L.eco.cash += 4000; add(L, 1.45, 'good', W.t + 'あなたは穀物や飼い葉を軍に売り、ひと儲けした。'); }
      else { L.eco.stock = Math.round((L.eco.stock || 0) * 0.5); add(L, 1.45, 'bad', W.t + '軍吏はあなたが買い佔めをしていると言い立て、倉の穀物の半分を徴発して、紙切れ一枚の預かり証を置いていっただけだった。'); }
    }
  }

  function clanOf(L) { return L.clanK ? (D.CLANS || []).filter(function (c) { return c.k === L.clanK; })[0] : null; }
  // 族人：同族的名人更容易見到，族中的栄辱也落到你頭上
  function clanYear(L, y) {
    var C = clanOf(L), R = L.R, a = L.age;
    if (!C || !L.alive) return;
    if (!L.flags.clanIntro && a >= 6) { L.flags.clanIntro = true; add(L, 2.15, 'life', L.clanPoor ? 'あなたの家の姓は' + C.sur + '。' + C.n + 'と同じ宗族だというが、とうに五服の外だ。本気で縁故を頼ろうとしても、相手が認めるとは限らない。' : C.t); }
    var act = C.figs.filter(function (f) { return y >= f[1] && y <= f[2]; });
    L.clanUp = !L.clanPoor && act.length > 0 && L.sex === 'M';
    if (a >= 10 && act.length) {
      var f = pick(R, act), id = f[0], fig = D.FIGURES.filter(function (x) { return x.id === id; })[0];
      if (fig && !L.met[id] && R() < (L.clanPoor ? 0.015 : L.gate >= 3 ? 0.25 : 0.12) * (L.sex === 'F' ? 0.6 : 1)) {
        var t = L.clanPoor ? fig.n + 'が帰郷して祖先を祀った。あなたの家と彼は同じ宗族とはいえ、とうに五服の外だ。あなたは人混みにまぎれ、遠くから彼をひと目見た。'
          : pick(R, ['一族の祭祀で、あなたは祠堂で同族の' + fig.n + 'に会った――' + fig.d + '。', fig.n + 'が帰省し、一族で宴が開かれ、あなたも席に連なった。彼はあなたに学問のことをいくつか尋ねた。', '長老に連れられて、一族の' + fig.n + 'を訪ねた。' + fig.d + '。']);
        add(L, 2.12, 'meet', t);
        markMet(L, id, y, L.clanPoor ? 'あなたと' + fig.n + 'は五服の外の同宗だ。' : 'あなたは' + fig.n + 'の一族だ。');
        L.rec.tags.push('meet');
      }
    }
    C.ev.forEach(function (e) {
      if (e.y !== y || a < 8) return;
      add(L, 2.1, 'life', e.t);
      if (L.clanPoor) return;
      if (e.fx) { if (e.fx.standing) L.standing += e.fx.standing; if (e.fx.fame) L.fame += e.fx.fame; }
      if (e.risk && e.risk.zones.indexOf(L.zone) >= 0 && R() < e.risk.p) die(L, 'executed', 2.11, { full: e.risk.dieT });
    });
  }

  // 私情：毎年都可能被撞破；撞破之後，男女、貴賤，下場各不相同
  function affairYear(L, y) {
    var A = L.affair, R = L.R;
    if (!A || !L.alive || y === A.since) return;
    var sp = L.spouseK;
    if (!sp || !sp.alive || sp.apart || L.soldier) { L.affair = null; add(L, 2.2, 'life', '' + A.name + 'との密かな仲は、こうしてひっそりと終わった。'); return; }
    var r = R();
    if (r < 0.15) { L.affair = null; L.flags.affPast = true; add(L, 2.2, 'life', pick(R, [A.name + 'の一家はよその県へ移っていった。旅立ちの日、二人は辻で遠くから一度目を合わせたが、どちらも何も言わなかった。', '二人はもう会わないと約束した。それからは道で行き会っても、見知らぬ者同士のように振る舞った。'])); return; }
    if (r > 0.15 + 0.13 * (L.tr.cau < 40 ? 1.4 : 1) * (A.k === 'g' ? 1.2 : 1)) { if (R() < 0.3) add(L, 2.25, 'life', pick(R, ['あなたは' + A.name + 'とまた会った。帰り道、誰かに背後から見られている気がしてならなかった。', '村にいくらか噂が立った。あなたは聞こえないふりをした。'])); return; }
    // 事情敗露
    L.affair = null; L.flags.affCaught = true; L.rec.tags.push('loss');
    var t;
    if (A.k === 'same') {
      L.standing -= 6;
      if (L.sex === 'M') { if (L.cls === 'gentry' && R() < 0.6) add(L, 2.2, 'bad', 'あなたたちのことは士人の間に広まった。「断袖」「分桃」と皮肉る者もいれば、笑って済ませる者もいた――当時はそういう風潮だった。ただ妻だけは、二度とあなたとろくに口をきこうとしなかった。'); else if (R() < 0.6) add(L, 2.2, 'bad', '噂が広まった。村の者は陰であなたたちを「断袖」とあざけり、妻は泣いて実家に帰り、何か月も経ってようやく戻ってきた。律令はこうしたことを裁かないが、郷里の口は律令よりもつらかった。'); else add(L, 2.2, 'bad', '妻があなたたちの様子を見てしまった。妻は何も言わず、それからは寝室を別にした。'); affAdd(sp, -40); }
      else if (R() < 0.7) { L.standing -= 4; L.body -= 5; affAdd(sp, -45); add(L, 2.2, 'bad', '婚家があなたたちの手紙を押さえた。姑はあなたを婦道にもとると罵り、以後里帰りを許さなかった。夫はあなたを打ち、それからは目を合わせようともしなかった。'); }
      else { add(L, 2.2, 'bad', '婚家があなたたちの手紙を押さえた。夫は「淫佚」を理由に離縁状を書いた。子どもは婚家に残された。'); doDivorce(L, y); }
      return;
    }
    if (A.k === 'sao') {
      L.standing -= 20;
      if (R() < 0.5) { add(L, 2.2, 'bad', '事が露見した。一族の者が二人を県に訴え出た。律によれば、「復兄弟之妻」（兄弟の妻と通じた）者は黥して城旦舂とされる。'); sentence(L, y, 2.21, '黥為城旦', 4); }
      else { L.split = true; add(L, 2.2, 'bad', '事が露見した。一族の長老たちは祠堂を開いてあなたを宗族から追放し、兄嫁は実家へ送り返された。それ以来、村の人々は陰であなたを「盗嫂」と呼んだ。'); }
      return;
    }
    if (A.k === 'bi') {
      var bx = R();
      if (bx < 0.5) { affAdd(sp, -30); add(L, 2.2, 'bad', '妻に知られた。妻は何も言わず、翌日には人買いを呼んで、その婢女をよその県へ売り払った。'); }
      else if (bx < 0.8) { affAdd(sp, -40); L.standing -= 3; add(L, 2.2, 'bad', '妻に知られた。妻はその婢女を中庭に呼びつけ、家じゅうの者の前で半殺しになるまで打ち拠え、それから実家へ帰ってしまった。三度迎えに行って、ようやく戻ってきた。'); }
      else { add(L, 2.2, 'life', '妻に知られたが、妻は騒ぎ立てなかった。こそこそするくらいなら、いっそ妾にしてしまえばいい、と言った。'); var csur = surname(R, 'peasant'), ck = newKin(L, 'conc', 'F', y - 18, csur + safeGiven(R, csur, 'F', 'plain'), { sur: csur }); ck.job = '侍妾'; ck.cy = y; }
      return;
    }
    if (A.k === 'nan') {
      if (R() < 0.5) { affAdd(sp, -30); add(L, 2.2, 'life', '妻はもう耐えきれず、泣きながら実家へ帰った。二人のことは洛陽の士人のあいだでしばらく噂になったが、誰も深刻には受け取らなかった――当時はそういう風潮だった。'); }
      else { L.fame = Math.max(0, L.fame - 3); add(L, 2.2, 'life', '清議の場で二人を揶揄し、「男寵乱徳」だと言う者がいた。あなたは笑って取り合わなかった。'); }
      return;
    }
    if (A.k === 'slave') {
      if (R() < 0.55) { die(L, 'executed', 2.2, { full: '事が露見した。主人はあなたとその侍妾を中庭に縛り出し、家じゅうの僮僕の前で打ち殺させた。' }); return; }
      L.body -= 15; add(L, 2.2, 'bad', '事が露見した。侍妾は主人の手で遠くへ売られ、あなたは半殺しになるまで打たれ、顔に入れ墨をされて、田荘で最もつらい仕事に回された。'); return;
    }
    if (A.k === 'g') {
      L.fame = Math.max(0, L.fame - 12); L.standing -= 15;
      if (L.sex === 'M') { if (L.office) { L.office = null; L.job = '士人'; } L.flags.zzno = true; add(L, 2.2, 'bad', '事が露見した。郷論は騒然となり、あなたは「帷薄不修」（家の風紀が乱れている）と言われた。官職を失い、中正はあなたの品第を何等も下げた。もはや出世の望みはなかった。'); }
      else { sp.apart = true; L.married = false; L.spouseK = null; L.divorced = true; L.flags.noRemarry = true; add(L, 2.2, 'bad', '事が露見した。婚家は「淫佚」を理由にあなたを離縁し、実家へ帰した。実家はあなたを裏庭の一室に閉じ込め、それ以来、外に出て人に会うことを許さなかった。'); }
      return;
    }
    var x = R();
    if (L.sex === 'F') {
      if (x < 0.4) { add(L, 2.2, 'bad', '事が露見した。夫は「七出」のうち「淫佚」の一条によって離縁状を書き、あなたを家から追い出した。子どもは婚家に残された。'); doDivorce(L, y); }
      else if (x < 0.65) { L.body -= 12; L.standing -= 20; add(L, 2.2, 'bad', '事が露見した。夫は二人を県に訴え出た。律によれば、人妻と和姦した者は男女とも「完為城旦舂」とされる――あなたは米つきの苦役に送られ、数年後にようやく帰された。'); }
      else if (x < 0.9) { L.standing -= 10; affAdd(sp, -45); add(L, 2.2, 'bad', '事が露見した。夫はあなたをひどく打ちすえ、さらに刀を提げて' + A.name + 'のもとへ向かった。相手はその夜のうちに県境の外へ逃げた。夫はあなたを離縁しなかったが、それ以来二度とまともにあなたを見ようとはしなかった。'); }
      else { die(L, 'feud', 2.2, { full: '事が露見した。夫は激怒のあまり手をかけた。村の人々はこの話になると首を振ってため息をついたが、あなたのために一言でも口をきく者はいなかった。' }); }
    } else {
      if (x < 0.35) { L.body -= 10; L.standing -= 10; add(L, 2.2, 'bad', '事が露見した。女の夫が兄弟を何人も連れて押しかけ、あなたは半月も床から起き上がれないほど打ちのめされた。村の人々は、自業自得だと言った。'); }
      else if (x < 0.65) { L.body -= 12; L.standing -= 18; add(L, 2.2, 'bad', '事が露見した。女の夫は二人を県に訴え出た。律によれば、人妻と和姦した者は男女とも「完為城旦舂」とされる――あなたは髪を剃られて築城の苦役に送られ、数年後にようやく帰された。'); }
      else if (x < 0.92) { payFrom(L, 4000); L.standing -= 8; add(L, 2.2, 'bad', '事が露見した。里の父老が仲裁に入り、あなたが女の家に四千銭を払って、ようやく内々に収まった。妻の' + sp.name + 'は実家に帰り、何か月も戻らなかった。'); affAdd(sp, -40); }
      else { die(L, 'feud', 2.2, { full: '事が露見した。ある夜、女の夫が路地の入口で待ち伏せ、刀を振り下ろした。' }); }
    }
  }
  // 女子离了夫家（被休、改嫁），丈夫的妾也就不再是你的家人；守寡留在夫家的不算
  function concSweep(L) {
    if (L.sex !== 'F') return;
    var gone = L.divorced && !L.married || L.married && !L.spouseK || !L.married && !L.widowed;
    liveKin(L, function (k) { return k.rel === 'conc' && !k.apart; }).forEach(function (k) { if (gone || L.married && L.marriedAt && k.cy != null && k.cy < L.marriedAt) { k.apart = true; k.fate = k.fate || ''; } });
  }
  function doDivorce(L, y) {
    var sp = L.spouseK; if (!sp) return;
    sp.apart = true; L.married = false; L.spouseK = null; L.divorced = true;
    liveKin(L, function (k) { return k.rel === 'child'; }).forEach(function (k) { k.apart = true; });
    L.eco = initEco(L); L.land = 0;
    concSweep(L);
  }
  // 配偶的私情被你知道了
  function victimOutcome(L, y, v, s) {
    var R = L.R, sp = L.spouseK; if (!sp) return;
    if (L.sex === 'M') {
      if (v === 1) { add(L, s, 'bad', '離縁状を書いた。「七出」によれば、妻の淫佚は離縁の理由になる。' + sp.name + 'は泣きながら実家へ帰った。'); sp.apart = true; L.married = false; L.spouseK = null; L.divorced = true; L.standing -= 2; }
      else if (v === 2) {
        if (R() < 0.6) { add(L, s, 'bad', '県に訴え出た。県吏は何度か取り調べ、その男と' + sp.name + 'の両方を「完為城旦舂」とした。家の恥は県じゅうに知れ渡った。'); sp.apart = true; L.married = false; L.spouseK = null; L.standing -= 6; }
        else { add(L, s, 'bad', '県に訴え出たが、確かな証拠をつかめなかった。県吏は男の家から金を受け取り、逆にあなたを誣告だとして棒で打たせた。'); L.body -= 6; L.standing -= 6; affAdd(sp, -40); }
      } else {
        if (R() < 0.1) { die(L, 'feud', s, { full: '刀を提げて、あの男に落とし前をつけに行った。相手は備えていた。揉み合いになり、あなたは二度と立ち上がれなかった。' }); return; }
        add(L, s, 'bad', '刀を提げて乗り込み、あの男に斬りつけて傷を負わせた。男はその夜のうちに県境の外へ逃げた。県から一度役人が事情を聞きに来たが、村の父老がとりなしてくれ、話はうやむやに終わった。'); L.standing -= 3; affAdd(sp, -35);
      }
    } else {
      if (v === 1) { add(L, s, 'bad', 'あの寡婦の家の前まで行って、ひとしきり罵った。帰ってきた夫は、隣近所の前であなたを「妒」（嫉妬深い）と罵った――それも七出のひとつだ。それ以来、夫はかえって足しげく通うようになった。'); L.standing -= 4; affAdd(sp, -20); }
      else {
        var kin = L.kin.filter(function (k) { return (k.rel === 'father' || (k.rel === 'sib' && k.sex === 'M')) && k.alive; })[0];
        if (kin && R() < 0.6) { add(L, s, 'life', '実家に帰った。' + relName(L, kin) + 'が婚家に出向いてひとしきり談判し、夫は詫びを入れて、あの寡婦と手を切った。'); affAdd(sp, 10); }
        else { add(L, s, 'bad', '実家に帰った。だが実家の者たちは、嫁に出した娘はこぼした水と同じ、男のすることは少し我慢すれば済む、と言った。数日後、あなたは自分で婚家へ戻った。'); L.standing -= 2; }
      }
    }
  }

  /* ---------- 罪与罰：繋獄、刑徒、亡命、贖罪与大赦 ---------- */
  var HIDE = ['jingbei', 'jiangdong', 'shu', 'liaodong', 'jiao', 'liang', 'you', 'jingnan'];
  function sentence(L, y, s, n, years, deathP, deathT) {
    var R = L.R;
    if (deathP && R() < deathP) {
      if (L.eco.cash + L.eco.priv >= 20000 && R() < 0.5) { payFrom(L, 20000); add(L, s, 'bad', '律によれば死罪だった。家族は田畑と屋敷を売って金をかき集め、死罪を贖って、刑は' + n + 'に改められた。'); }
      else { die(L, 'executed', s, { full: deathT || '市場に引き出されて斬首され、骸は市にさらされた。' }); return; }
    }
    if (L.eco.cash >= 8000 && R() < 0.4) { payFrom(L, 8000); L.standing -= 6; add(L, s + 0.01, 'bad', '家族が金を出して罪を贖ってくれた。家には戻れたが、村の人々はあなたを見るたびに陰で後ろ指をさした。'); return; }
    L.convict = { until: y + years, n: n, job: L.job }; L.job = '刑徒'; L.flags.convicted = n; L.standing -= 12; L.rec.tags.push('loss');
    add(L, s + 0.01, 'bad', '刑は' + n + 'と決まった。髪を剃られ、首に鉄の枷をはめられ、刑徒の一隊とともに' + pick(R, ['城壁の修築', '河の堤の築造', '官営の工房での苦役', '馳道の修築']) + 'へと引き立てられた。刑期は' + cnNum(years) + '年。');
  }
  function crimeStart(L, y, k, s) {
    var R = L.R;
    if (k === 'steal') {
      if (R() < 0.5) { L.body -= 5; payFrom(L, 500); L.standing -= 6; add(L, s, 'bad', '大家の主人はあなたを縛って里正のもとへ突き出し、ひとしきり打ったうえ、あなたの家に粟五斗を弁償させた。それ以来、村の人々はあなたを警戒した。'); }
      else { add(L, s, 'bad', '大家の主人はあなたを県に突き出した。'); sentence(L, y, s + 0.02, '罰作一年', 1); }
    } else if (k === 'kill') { L.crime = { k: 'kill', y: y, ask: true }; L.flags.killed = y; }
    else if (k === 'revenge') {
      var r = R();
      if (r < 0.45) { L.fame += 15; L.standing += 10; L.flags.revenger = true; add(L, s, 'good', '県長はあなたの孝義に心を打たれ、罪に問うに忍びず、何度も逃げるよう勧めたが、あなたは応じなかった。のちに大赦があり、あなたは釈放された。村ではあなたを「孝烈」とたたえ、郡はあなたの家の門前に表彰の標を立てた。'); }
      else sentence(L, y, s, '髡鉗城旦', 5, 0.35, '父の仇を討ち、自ら出頭した。だが律令は私に人を殺すことを許さず、やはり死罪とされ、市で処刑された。村の人々はみなあなたのために嘆いた。');
    } else if (k === 'tomb') sentence(L, y, s, '髡鉗城旦', 4, 0.4, '墓荒らしは重罪だ。あなたは市場に引き出されて斬首された。');
    else if (k === 'coin') sentence(L, y, s, '髡鉗城旦', 4, 0.6, '律によれば、銭を私鋳した者は棄市とされる。あなたは市場に引き出されて斬首され、銭の鋳型も衆人の前で打ち砕かれた。');
    else if (k === 'false') {
      if (R() < 0.06) { die(L, 'executed', s, { full: '県の獄に何か月も閉じ込められた。獄吏は金を求めたが、家には払えるものがなく、あなたは獄中で病死した。' }); return; }
      add(L, s, 'bad', '県の獄に入れられた。獄吏は毎日金をせびりに来て、出さなければ打った。半年あまり経ってようやく事件の真相が明らかになり、あなたは釈放された。'); L.body -= 8; payFrom(L, 1000);
    } else if (k === 'falseFled') { L.crime = { k: 'fled', y: y, fled: true }; relocate(L, pick(R, HIDE), s + 0.02, '{dest}へ逃れ、名を隠して、人に僱われて日々を食いつないだ。', 0.03, y); }
  }
  function crimeAfter(L, y, i) {
    var R = L.R;
    if (i === 2 && L.eco.cash < 10000) i = 0;
    if (i === 0) { L.crime.fled = true; L.crime.fy = y; L.flags.wanted = true; relocate(L, pick(R, HIDE), 1.3, 'その夜のうちに出奔し、{dest}まで逃げ延びた。名を変え、人に僱われて日々を食いつないだ。', 0.04, y); }
    else if (i === 1) { L.crime = null; add(L, 1.3, 'life', '県廷に出頭して自首した。'); sentence(L, y, 1.31, '髡鉗城旦', 5, 0.3, '争って人を殺した者は、律によれば死罪だ。あなたは市場に引き出されて斬首された。'); }
    else { payFrom(L, 10000); L.crime = null; L.standing -= 8; add(L, 1.3, 'bad', '一族が一万銭をかき集めて、死者の家に届けた。死者の家は訴えを取り下げ、県吏も分け前を受け取った。事件はこうして揉み消された。'); }
  }
  function crimeYear(L, y) {
    var R = L.R;
    if (L.convict) {
      var C = L.convict;
      if (R() < 0.04 * bodyMul(L)) { die(L, 'corv', 2.3, { full: '刑徒の列の中で力尽きて倒れ、工事場のそばに粗末に葬られた。刑徒の墓磚には、名前と本籍と「死」の一字が刻まれているだけだった。' }); return; }
      if (R() < 0.2) { L.convict = null; L.job = C.job || '農'; add(L, 2.3, 'good', '天子が天下に大赦を下した。あなたは刑徒の一隊とともに釈放された。髪もまだ伸びそろわないうちに、家へ帰った。'); return; }
      if (y >= C.until) { L.convict = null; L.job = C.job || '農'; add(L, 2.3, 'life', '刑期を終えて、帰された。家の畑は半ば荒れ果て、子どもはあなたを見ると母親の後ろに隠れた。'); return; }
      L.body -= 4; add(L, 2.4, 'life', pick(R, ['鉄の枷をはめたまま工事場でまる一年働いた。肩の皮は擦りむけては、また治った。', '刑徒たちは毎日夜明け前から働かされ、監督の鞭には容赦がなかった。', '同じ隊の刑徒がまた一人死んだ。その墓磚には名前と本籍と刑名が刻まれた。']));
      return;
    }
    var K = L.crime;
    if (!K || K.ask || K.fy === y || K.y === y) return;
    if (R() < 0.22) { L.crime = null; L.flags.wanted = false; add(L, 2.3, 'good', '天子が天下に大赦を下した。あなたの罪は、こうして帳消しになった。'); return; }
    if (y - K.y >= 8) { L.crime = null; add(L, 2.3, 'life', 'これほどの年月が過ぎ、もうあの古い事件を追及する者はいなかった。あなたは少しずつ本名を名乗れるようになった。'); return; }
    if (R() < 0.12 * (K.fled ? 0.5 : 1) * ((L.reg ? L.reg.order : 70) / 70)) {
      L.crime = null; add(L, 2.3, 'bad', '誰かがあなたに気づき、役所に訴え出た。あなたは本籍地へ護送された。');
      if (K.k === 'kill') sentence(L, y, 2.31, '髡鉗城旦', 5, 0.4, '争って人を殺した者は、律によれば死罪だ。あなたは市場に引き出されて斬首された。');
      else sentence(L, y, 2.31, '罰作', 2);
    }
  }

  /* ---------- 愛好与才芸：家境決定你能愛好什麼 ---------- */
  function hobbyOk(L, k, y) {
    var H = D.HOBBY[k], tk = lifeTier(L, y).k, hi = L.cls === 'gentry' || tk === 'high' || tk === 'top';
    if (H.sex && H.sex !== L.sex) return false;
    if (H.y && (y < H.y[0] || y > H.y[1])) return false;
    if (L.cls === 'slave') return H.who === 'any' && !H.cost;
    if (H.who === 'low') return !hi;
    if (H.who === 'hi') return hi;
    if (H.who === 'lit') return !!L.literate || L.cls === 'gentry';
    return true;
  }
  function hobbyChoice(L, y, P) {
    var a = L.age, R = L.R;
    if (L.hobby || L.eth) return;
    var kid = a >= 8 && a <= 16 && !L.flags.hobAsk, adult = a >= 18 && a <= 45 && !L.flags.hobAsk2 && L.flags.hobAsk;
    if (!(kid && R() < 0.25) && !(adult && R() < 0.05)) return;
    L.flags[kid ? 'hobAsk' : 'hobAsk2'] = true;
    var ks = Object.keys(D.HOBBY || {}).filter(function (k) { return hobbyOk(L, k, y); }), pk = [];
    while (ks.length && pk.length < 3) pk.push(ks.splice(Math.floor(R() * ks.length), 1)[0]);
    if (!pk.length) return;
    P.queue.push({ key: 'hobby', ks: pk, q: kid ? '手が空いたとき、何をするのがいちばん好き？' : '暮らしが少し落ち着いてきた。何か楽しみを見つけたい。', o: pk.map(function (k) { return D.HOBBY[k].n; }).concat(['特に趣味はない']), w: pk.map(function () { return 2; }).concat([1]) });
  }
  function hobbyPick(L, y, c, i) {
    if (i >= c.ks.length) return;
    var k = c.ks[i];
    L.hobby = { k: k, lv: 5, apt: L.R(), since: y };
    if (L.cond && L.cond.k === 'guai') L.hobby.apt = Math.max(L.hobby.apt, 0.75 + L.R() * 0.25);
    add(L, 2.5, 'life', 'あなたは' + D.HOBBY[k].n + 'に夢中になった。');
  }
  function hobbyYear(L, y) {
    var Hb = L.hobby, R = L.R;
    if (!Hb || !L.alive) return;
    var HD = D.HOBBY[Hb.k], F = L.rec.focus ? L.rec.focus.eff : null;
    if (HD.cost) {
      if (L.eco.cash < HD.cost * 2 && R() < 0.4) { L.hobbyPast = Hb; L.hobby = null; add(L, 2.6, 'life', '家の暮らしが苦しくなり、もう' + HD.n + 'どころではなくなった。'); return; }
      if (L.eco.cash >= HD.cost) payFrom(L, HD.cost);
    }
    if (L.soldier && R() < 0.5) return;
    Hb.lv = Math.min(100, Hb.lv + 3 + Hb.apt * 8 + (F === 'play' || F === 'leisure' ? 4 : 0));
    if (HD.body) L.body = clamp(L.body + HD.body, 1, 100);
    if (R() < 0.18 && !(L.flags.famousConc && HD.who === 'low')) add(L, 2.6, 'life', pick(R, HD.lines));
    if (!Hb.tal && Hb.lv >= 80 && Hb.apt >= 0.75 && L.age >= 14) {
      Hb.tal = true;
      var T = HD.tal, tk = lifeTier(L, y).k, hi = L.cls === 'gentry' || tk === 'high' || tk === 'top';
      var t = (hi ? T.th : T.tl) || T.t || T.th || T.tl, fx = T.fx || {};
      add(L, 2.55, 'good', t);
      if (fx.cash) L.eco.cash += fx.cash;
      if (fx.fame) L.fame += fx.fame;
      if (fx.standing) L.standing += fx.standing;
      if (fx.learn) L.learn += fx.learn;
      if (fx.craft) L.craft += fx.craft;
      if (fx.body) L.body = clamp(L.body + fx.body, 1, 100);
      if (fx.side) L.side = { k: fx.side, from: y, until: y + 15 };
      if (fx.job && !L.office && !L.soldier && L.cls !== 'gentry') L.job = fx.job;
      if (fx.flag === 'strongman') L.found.strength = true;
      if (fx.flag === 'needle') L.side = { k: 'xiu', from: y, until: y + 20 };
      if (fx.flag === 'calligrapher' && !hi && L.sex === 'M' && !L.office && !L.soldier) { L.office = '書佐'; L.officeMax = L.officeMax || '書佐'; L.job = '書佐'; }
      if (fx.flag === 'reckoner' && !hi && L.sex === 'M' && !L.office && !L.soldier && R() < 0.5) { L.office = '計吏'; L.officeMax = L.officeMax || '計吏'; L.job = '計吏'; }
      if (Hb.k === 'hua' && !hi && !L.office) L.job = '画工';
      if (fx.flag === 'archer') L.flags.archer = true;
    }
  }
  function hobbyText(L) {
    var Hb = L.hobby; if (!Hb) return '';
    return D.HOBBY[Hb.k].n + '（' + (Hb.lv < 30 ? '習いたて' : Hb.lv < 60 ? 'ひととおり' : Hb.lv < 85 ? '熟達' : '達人') + (Hb.tal ? '、名が知られる' : '') + '）';
  }

  /* ---------- 先天之疾与痼疾 ---------- */
  function condNoRead(L) { return !!(L.cond && L.cond.rev && D.CONDS[L.cond.k].noRead); }
  function condMarry(L) { var m = L.cond && L.cond.rev ? D.CONDS[L.cond.k].marry || 1 : 1; if (L.chronic === 'li') m *= 0.05; var hi = L.cls === 'gentry' || (L.tierC && (L.tierC.k === 'top' || L.tierC.k === 'high')); return hi ? Math.min(1, m * 1.6) : m; }
  function condHi(L, y) { var tk = lifeTier(L, y).k; return L.cls === 'gentry' || tk === 'high' || tk === 'top'; }
  function condYear(L, y) {
    var R = L.R, a = L.age, C = L.cond;
    if (C && L.alive) {
      var CD = D.CONDS[C.k], hi = condHi(L, y), side = hi ? 'hi' : 'lo';
      if (!C.rev) {
        if (a >= CD.age) { C.rev = true; add(L, 2.3, 'life', CD.rv[side]); if (CD.noRead) L.literate = false; if (C.k === 'guai') L.standing += hi ? 0 : -5; }
      } else {
        if (CD.danger && a >= 6 && R() < CD.danger) { die(L, 'drown', 2.3, { full: pick(R, CD.dangerT) }); return; }
        if (a >= 6 && R() < 0.1) add(L, 2.45, 'life', pick(R, CD.ev[side]));
        if (CD.gift && !C.gift && a >= 14 && a <= 35 && R() < (C.k === 'guai' ? (hi ? 0.12 : 0.06) : 0.06)) {
          C.gift = side; add(L, 2.35, 'good', CD.gift[side]);
          if (hi) { L.fame += C.k === 'guai' ? 12 : 6; L.flags.praised = true; if (C.k === 'guai') L.found.memory = true; }
          else if (C.k === 'guai') { L.craft += 15; L.found.craft = true; if (!L.office && !L.soldier) L.job = '匠人'; }
          else if (C.k === 'mang') { if (!L.office) L.job = '卜者'; }
        }
      }
    }
    // 後天痼疾
    if (L.chronic) { var CH = D.CHRONIC[L.chronic]; L.body = clamp(L.body + CH.yearly, 1, 100); if (R() < 0.08) add(L, 2.45, 'life', 'あなたの' + CH.n + 'は、また少し重くなった。'); return; }
    var hi2 = condHi(L, y);
    Object.keys(D.CHRONIC || {}).some(function (k) {
      var CH = D.CHRONIC[k];
      if (L.age < CH.age[0] || L.age > CH.age[1] || (CH.who === 'low' && hi2) || (CH.who === 'hi' && !hi2) || R() >= CH.p) return false;
      L.chronic = k; L.body = clamp(L.body + CH.body, 1, 100); add(L, 2.3, 'bad', CH.t);
      if (CH.outcast) { L.standing -= 30; L.flags.outcast = true; (L.friends || []).forEach(function (f) { if (f.alive) { f.apart = true; f.fate = 'あなたが癘風を患ってから、行き来は途絶えた'; } }); }
      return true;
    });
  }
  function condText(L) {
    var t = [];
    if (L.cond && L.cond.rev) t.push(D.CONDS[L.cond.k].n + (L.cond.gift === 'hi' && L.cond.k === 'guai' ? '、人呼んで異才' : ''));
    if (L.chronic) t.push(D.CHRONIC[L.chronic].n);
    return t.join('、');
  }

  function spLabel(sp) { return sp.from + 'の' + sp.name + '（' + cnNum(sp.age) + '歳、' + sp.desc + '）'; }
  /* ---------- 成丁：十五歳，自己挑一条路 ---------- */
  var PATHS = [
    { k: 'farm', n: '家の田を守り、立派な百姓になる', ok: function (L) { return L.sex === 'M' && L.cls !== 'gentry' && L.cls !== 'merchant'; } },
    { k: 'craft', n: '県城で師匠につき、手に職をつける', ok: function (L) { return L.sex === 'M' && L.cls !== 'gentry'; } },
    { k: 'client', n: '豪族の門下に入り、食客となる', ok: function (L) { return L.sex === 'M' && L.cls !== 'gentry' && L.tr.soc >= 35; } },
    { k: 'clerk', n: '県廷で書佐の職を探す', ok: function (L) { return L.sex === 'M' && L.literate && L.cls !== 'gentry'; } },
    { k: 'army', n: '募兵に応じて軍に入り、出世に賭ける', ok: function (L) { return L.sex === 'M' && !(L.cond && D.CONDS[L.cond.k].noArmy); } },
    { k: 'trade', n: '元手をかき集め、村々を回って商いをする', ok: function (L) { return L.sex === 'M' && L.cls !== 'gentry'; } },
    { k: 'city', n: '町に出て日僱いをし、世間を見る', ok: function (L) { return L.sex === 'M' && L.cls !== 'gentry' && L.cls !== 'merchant'; } },
    { k: 'jing', n: '門を閉ざして経学を修め、州郡の察挙を待つ', ok: function (L) { return L.sex === 'M' && L.cls === 'gentry'; } },
    { k: 'youxue', n: '書箱を背負って遊学し、名師を訪ねる', ok: function (L) { return L.sex === 'M' && L.cls === 'gentry'; } },
    { k: 'zhoujun', n: 'まず州郡で小吏となり、政務に慣れる', ok: function (L) { return L.sex === 'M' && L.cls === 'gentry'; } },
    { k: 'yin', n: '仕官を求めず、隠れ住んで書を読む', ok: function (L) { return L.sex === 'M' && L.cls === 'gentry'; } },
    { k: 'weave', n: '母について機織りを習い、家を切り盛りする', ok: function (L) { return L.sex === 'F' && L.cls !== 'gentry'; } },
    { k: 'brew', n: '酒造りや醤造りを習い、家計の足しにする', ok: function (L) { return L.sex === 'F' && L.cls !== 'gentry'; } },
    { k: 'wenpo', n: '村の産婆について、お産の取り上げ方を習う', ok: function (L) { return L.sex === 'F' && L.cls !== 'gentry'; } },
    { k: 'fread', n: '両親に頼んで、読み書きを習わせてもらう', ok: function (L) { return L.sex === 'F' && !L.literate && (L.cls === 'gentry' || L.wealth >= 45); } },
    { k: 'nvjie', n: '『女誡』を読み、礼儀と針仕事を学んで「賢婦」を目指す', ok: function (L) { return L.sex === 'F' && (L.cls === 'gentry' || L.wealth >= 55); } },
    { k: 'qinF', n: '琴を習い、詩書を学ぶ', ok: function (L) { return L.sex === 'F' && L.cls === 'gentry'; } }
  ];
  function pathChoice(L, y, P) {
    if (L.age !== 15 || L.flags.pathAsk || L.eth || L.cls === 'slave' || L.flags.palaceIn || L.soldier || L.office) return;
    L.flags.pathAsk = true;
    var ks = PATHS.filter(function (p) { return p.ok(L); });
    if (ks.length < 2) return;
    P.queue.push({ key: 'path', ks: ks.map(function (p) { return p.k; }), q: L.sex === 'M' ? '十五歳になった。村の人々の目には、もう一人前の大人だ。これからどの道を進むか、長いあいだ考えた――' : '十五歳になった。あと一、二年で嫁ぐことになる。それまでに、何を学びたい？', o: ks.map(function (p) { return p.n; }), w: ks.map(function () { return 1; }) });
  }
  function pathOutcome(L, y, k) {
    var R = L.R, E = L.eco;
    L.path = k;
    switch (k) {
      case 'farm': L.yHarvest = 1.06; L.standing += 2; add(L, 1.3, 'life', '父について、天候の読み方、種の選び方、肥やしのやり方を学んだ。土地は人を欺かない、と父は言った。'); break;
      case 'craft': L.flags.apprenticeY = y; L.job = '学徒'; L.craft += 6; add(L, 1.3, 'life', '県城で' + pick(R, ['木匠', '鉄匠', '陶工', '漆工']) + 'に弟子入りした。最初の三年は水汲みとふいご引きと叱られ役ばかり。飯は出るが、給金はなかった。'); break;
      case 'client': L.job = '門客'; L.flags.client = true; L.standing += 2; add(L, 1.3, 'life', '県のある豪族の門下に身を投じた。主人は寝食を与えてくれ、あなたは使い走りや屋敷の警護をこなし、ときには主人のために体を張った。'); break;
      case 'clerk': if (R() < 0.5 + L.learn / 200) { L.office = '書佐'; L.officeMax = L.officeMax || '書佐'; L.job = '書佐'; add(L, 1.3, 'good', '達筆を買われ、県廷で書佐の職を得た。'); } else add(L, 1.3, 'life', '何度か県廷に掛け合ったが、県丞は今は人手が足りていると言った。ひとまず家に帰って待つしかなかった。'); L.flags.wantClerk = true; break;
      case 'army': add(L, 1.3, 'life', '弓一張と幹し飯一袋を背負って、募兵に応じた。'); enlist(L, y, 1.31, true); break;
      case 'trade': E.stock = (E.stock || 0) + 800; L.side = { k: 'fan', from: y, until: y + 12 }; L.job = '貨郎'; add(L, 1.3, 'life', '数百銭の元手をかき集め、天秤棒を担いで村々を回り、針や糸、塩、小間物を売り歩いた。'); break;
      case 'city': E.labor = Math.max(E.labor || 0, 2); L.urban = true; add(L, 1.3, 'life', '県城に出て、工事場で荷を担ぎ、市場で荷運びをした。城内の物はどれも見たことのないものばかりで、城内の人々はあなたを見下した。'); break;
      case 'jing': L.learn += 10; L.flags.disciple = true; add(L, 1.3, 'life', '門を閉ざして経学に打ち込み、一年じゅう家から出なかった。一族の長老たちは、この子はいずれ孝廉に挙げられるだろうと言った。'); break;
      case 'youxue': L.learn += 12; L.fame += 4; L.flags.connected = true; payFrom(L, 3000); add(L, 1.3, 'life', '書箱を背負って旅に出て、何人もの名師を訪ね、よその郡の士人たちと交わりを結んだ。'); break;
      case 'zhoujun': if (R() < 0.75) { L.office = '書佐'; L.officeMax = L.officeMax || '書佐'; L.job = '書佐'; add(L, 1.3, 'good', '家柄のおかげで、あなたはすぐに郡府の書佐となった。'); } else add(L, 1.3, 'life', '郡府には空きがなく、ひとまず家で待つことにした。'); break;
      case 'yin': L.fame += 5; L.flags.hermit = true; L.flags.zzno = true; add(L, 1.3, 'life', 'あなたは仕官を求めないと言い、門を閉ざして書を読んだ。高潔だと言う者もいれば、もっと大きな名声を待っているのだと言う者もいた。'); break;
      case 'weave': L.side = { k: 'fang', from: y, until: y + 30 }; add(L, 1.3, 'life', '母について糸を紡ぎ、布を織った。一年もすると、あなたの織る布は母のものより目が揃うようになった。'); break;
      case 'brew': L.side = { k: 'jiu', from: y, until: y + 30 }; add(L, 1.3, 'life', '酒造りと醤造りを覚えた。正月や節句には、近所の人々が一杯の酒を求めてあなたの家へやって来た。'); break;
      case 'wenpo': L.flags.wenpo = y; add(L, 1.3, 'life', '村の産婆について家々を回り、何度もお産に立ち会った。初めて血を見たときは、怖くて足がすくんでしまった。'); break;
      case 'fread': if (R() < 0.6) { L.learn += 15; L.schooling = true; add(L, 1.3, 'good', '父母は許してくれた。あなたは兄弟たちと一緒に書を読み、彼らよりも早く読み進めた。'); } else add(L, 1.3, 'bad', '父は言った。「女子無才便是徳（女は才がないのが徳）」——もっとも、この言葉が言われるようになるのは後世のことで、父が口にしたのはただ一言、「書など読んでどうする」だけだった。'); break;
      case 'nvjie': L.standing += 4; add(L, 1.3, 'life', '『女誡』を読み、礼儀作法と針仕事を学んだ。縁談を持ちこむ仲人の足がいっそう繁くなった。'); break;
      case 'qinF': L.learn += 8; if (!L.hobby) L.hobby = { k: 'qin', lv: 20, apt: R(), since: y }; add(L, 1.3, 'life', '琴を習い、詩書を学んだ。母は、蔡家の娘もこうして育ったのだと言った。'); break;
    }
  }
  /* ---------- 謀劃：毎年可以主動做一件事 ---------- */
  function planYear(L, y) {
    var R = L.R;
    if (L.flags.apprenticeY && y - L.flags.apprenticeY >= 3 && L.job === '学徒') { L.flags.apprenticeY = null; L.cls = L.cls === 'gentry' ? L.cls : 'artisan'; L.job = '工匠'; L.craft += 10; add(L, 2.3, 'good', '三年の年季が明け、師匠はもう独り立ちしてよいと言った。それからは腕一本で食べていくことになった。'); }
    if (L.flags.wenpo && !inPal(L) && L.age >= 25 && !/穏婆/.test(L.job || '') && !L.office && L.sex === 'F') { L.flags.wenpo = null; L.job = '穏婆'; L.standing += 3; add(L, 2.3, 'life', '村の年老いた産婆が亡くなった。それからは、子が生まれる家はみなあなたを呼びに来るようになった。'); }
  }

      /* ---------- 出嫁従夫：嫁到什麼人家，就過什麼日子 ---------- */
      var HDESC = { tenant: ['豪族の小作人で、自分の田はない', '一家そろって大家の田を耕している'], peasant: ['わずかな田を持つ家の者', '実直な百姓'], artisan: ['腕一本で食べている職人', '父が大工'], soldier: ['代々兵を出す士家の子弟', '営で兵をしていて、家族も営に住んでいる'], tuntian: ['官田を耕す屯田民'], merchant: ['商いをしていて、年じゅう各地を回っている', '県城の市に店を構えている'], clerk: ['県の役所に勤めている', '父が県の小役人'], gentry: ['郡の名族の子弟', '数百頃の田を持ち、父や兄はみな州郡に仕えている'] };
      var CLS_WIFE = { tenant: 'これからあなたは小作人の家の嫁だ。誰に小作料を納め、一年でどれだけ取られるかは、すべて地主の顔色しだいだった。', peasant: 'これからあなたは自作農の家の嫁だ。わずかな田が、一家の命綱だった。', artisan: 'これからあなたは職人の家の嫁だ。夫の腕しだいで、鍋に米があるかどうかが決まった。', soldier: 'これからあなたは士家の嫁だ。決まりで、士家の妻や娘は勝手に再婚も移住もできない。夫が営にいるかぎり、あなたもここを離れられない。', tuntian: 'これからあなたは屯田民の嫁だ。耕すのは官の田で、収穫は官が六、民が四だった。', merchant: 'これからあなたは商家の嫁だ。金には困らないが、村の人はどこか見下していた。', clerk: 'これからあなたは小役人の家の嫁だ。夫には毎月俸米が出て、百姓の家よりは暮らしが安定していた。', gentry: 'これからあなたは士族の家の婦人だ。家格が上がったぶん、決まりごとも増えた。' };
      function spouseCls(L, y) {
        var R = L.R, c = L.cls, r = R(), g = group(ctrl(L.zone, y)), shi = (g === 'wei' || g === 'wu') && y >= 200 && y <= 280;
        if (L.eth || c === 'slave') return c;
        if (c === 'tenant') return r < 0.6 ? 'tenant' : r < 0.85 ? 'peasant' : r < 0.93 && shi ? 'soldier' : 'artisan';
        if (c === 'peasant') return r < 0.55 ? 'peasant' : r < 0.7 ? 'tenant' : r < 0.8 ? 'artisan' : r < 0.88 ? 'clerk' : r < 0.94 ? 'merchant' : shi ? 'soldier' : 'peasant';
        if (c === 'tuntian') return r < 0.7 ? 'tuntian' : r < 0.85 ? 'peasant' : 'soldier';
        if (c === 'soldier') return r < 0.75 ? 'soldier' : 'peasant';
        if (c === 'artisan') return r < 0.5 ? 'artisan' : r < 0.85 ? 'peasant' : 'merchant';
        if (c === 'merchant') return r < 0.55 ? 'merchant' : r < 0.75 ? 'peasant' : r < 0.9 ? 'clerk' : r < 0.95 ? 'gentry' : 'artisan';
        if (c === 'clerk') return r < 0.55 ? 'clerk' : r < 0.75 ? 'peasant' : r < 0.9 ? 'gentry' : 'merchant';
        if (c === 'gentry') return r < (L.shu ? 0.65 : 0.85) ? 'gentry' : 'clerk';
        return c;
      }
      // 丈夫的前程：升遷、罷黜，都落在妻子的日子上
      var H_LADDER = ['亭長', '郷嗇夫', '書佐', '県吏', '郡吏', '県令', '郡守'];
      var H_SAL = { 亭長: 3000, 郷嗇夫: 5000, 書佐: 9000, 県吏: 6000, 郡吏: 12000, 県令: 60000, 郡守: 120000, 議郎: 30000 };
      function husbandYear(L, y) {
        var R = L.R, hs = L.sex === 'F' && L.married && L.spouseK && L.spouseK.alive && !L.spouseK.apart && !L.spouseK.famous ? L.spouseK : null;
        if (!hs) {
          if (L.sex === 'F' && L.widowed && L.hadSal && !L.flags.nosalNote) { L.flags.nosalNote = true; add(L, 2.2, 'bad', '夫が死ぬと、家に入っていた俸禄も途絶えた。'); }
          return;
        }
        var i = H_LADDER.indexOf(hs.job);
        if (H_SAL[hs.job]) L.hadSal = true;
        if (i >= 0 && i < H_LADDER.length - 1 && y - hs.by >= 22 && R() < (L.cls === 'gentry' ? 0.05 : 0.025) * (i >= 4 ? 0.3 : 1)) {
          hs.job = H_LADDER[i + 1]; L.standing += 3 + i; add(L, 2.2, 'good', '夫が{job}に昇進した。家に入る俸米が増え、近所の人もあなたに少し丁寧になった。'.replace('{job}', hs.job));
        } else if (i >= 0 && R() < 0.012) {
          hs.job = L.cls === 'gentry' ? '士人' : '農夫'; L.standing -= 2; add(L, 2.2, 'bad', '夫が職を失い、家でぶらぶらするようになった。家の実入りががくんと減った。');
        }
      }
    
  /* ---------- 府邸与宮中：做了諸侯的姫妾，日子就被関在高牆之内 ---------- */
  var PAL_OK = ['lg_palace', 'sick', 'plague', 'buddha', 'homesick'];
  function inPal(L) { return L.flags.palace != null && !L.flags.palaceOut; }
  var CAP_SEAT = { luoyang: ['河南尹', '洛陽'], guanzhong: ['京兆尹', '長安'], yu: ['潁川郡', '許県'], ji: ['魏郡', '鄴県'], jiangdong: ['丹楊郡', '建業'], shu: ['蜀郡', '成都'] };
  function inHH(L) { var k = L.spouseK; return !!(L.flags.famousConc && !L.flags.leftHH && k && k.famous && !k.apart && (k.alive || L.flags.fcPal === '皇宮' || L.flags.noRemarry)); }
  var FAR_HH = { fu: ['知らせは屋敷にも届き、女たちは何日もひそひそと噂し合った。', '屋敷の者たちのあいだに、たちまちこの知らせが広まった。'], gong: ['知らせは宮中にも届き、宮人たちは何日もひそひそと噂し合った。', '宮中の者たちのあいだに、たちまちこの知らせが広まった。'] };
  var REACT_HH = { war: { fu: ['外では戦が続いていた。屋敷の門は固く閉ざされ、女たちは奥に閉じこもって、遠くの太鼓の音を聞くばかりだった。', '前線からの戦報が次々と屋敷に届いた。女たちは寄り集まって様子をうかがったが、誰も詳しく尋ねようとはしなかった。'], gong: ['外では戦が続いていた。宮門の守りが増やされ、宮人たちは夜もぐっすり眠れなかった。', '前線の戦報が宮中に届くと、宮人たちはひそひそと伝え合い、誰も大きな声では話さなかった。'] }, fam: { fu: ['外は飢饉だった。屋敷の手当も減らされたが、女たちはまだ腹を満たせた。塀の外で飢え死にする人のことは、下女から聞いて知った。'], gong: ['外は飢饉だった。宮中では民と苦しみを分かつとして膳が減らされた——それでも減らした分だけで、外の一家が一年に食べる量より多かった。'] }, plag: { fu: ['外では疫病がはやっていた。屋敷の門は閉ざされ、出入りする者はみな艾で燻された。'], gong: ['外では疫病がはやっていた。宮中では巫祝を呼んで疫を祓い、宮人たちは香袋を身につけ、宮門から一歩も出ることを許されなかった。'] } };
  var CONC_WID = ['彼が生前に贈ってくれた装身具は、ずっと箱の底にしまってあった。', '屋敷の子どもたちは年ごとに大きくなり、あなたが誰なのかもう知らない子もいた。', '病にかかった。新しい奥方は薬を届けさせたが、見舞いには来なかった。', 'あなたは彼の位牌を守り、一年また一年と過ごした。屋敷の者たちは次第にあなたを忘れていった。', '彼の命日には、昔の側妾たち何人かと香を焚いた。誰も口をきかなかった。', '新しい主人が家を継ぎ、屋敷のしきたりも変わった。古くからの者への手当は年ごとに減っていった。', '奥庭に植えた数本の木は、もう塀より高く伸びていた。'], CONC_WIDP = ['先帝から賜った簪は、箱にしまったまま、めったに取り出さなかった。', '宮の塀の外で、槐の木がまた花をつけた。数えてみると、宮に入ってからもう何年も経っていた。', '若い宮人に、先帝はどんな方でしたかと尋ねられた。長いこと考えたが、何から話せばよいのかわからなかった。', '病にかかった。宮中の医官は一度診に来たきり、二度と来なかった。', '別宮の日々は静かだった。先帝の旧人たちと針仕事をしながら、昔の話ばかりした。', '先帝の命日には、霊座の前で楽を奏し、供え物をして、朝から昼まで過ごした。', '新帝が即位してから、別宮への手当は年ごとに減っていった。', '別宮の門は一年中閉ざされていた。外の知らせは、何か月も遅れて届いた。'], CONC_TQ = ['毎月一日と十五日、銅雀台の上で彼の霊帳に向かい、朝から昼まで楽を奏した。', '銅雀台の上からは、西陵の墓所が望めた——それも彼が遺令で言い置いたことだった。', '彼の遺した香は台の側妾たちに分けられた。履物を編んで売り、暮らしを立てる者もいた。それも遺令で許されていた。'];
  var HPAL = { rival_o: ['耐えて、争わない', '中宮に訴え出る', '彼の歓心を買い、寵愛を取り戻そうとする'], rival_r: ['あなたは耐えた。暮らしは少し苦しくなったが、波風は立たなかった。', '中宮があなたの肩を持ち、その美人はずいぶんおとなしくなった。', '中宮は「姉妹の間柄なのだから、仲良くなさい」と淡々と言っただけだった。それからあの女はますます増長した。', '寵愛をいくらか取り戻した。だが宮中の者たちは、あなたを策士だと噂した。', '何度か張り合ううちに、かえって彼に疎まれ、ますます足が遠のいた。'], natal_r: ['こつこつ貯めた蓄えを、人に託して実家へ送った。母からは、家族みなあなたに感謝していると返事が来た。', '彼はうなずいた。兄弟は郎官の職を得て、実家の暮らしはそれから少し楽になった。', '彼は眉をひそめ、後宮の者は外のことに口を出すなと言った。あなたは二度とその話をしなかった。', '取り合わなかった。のちに、母がそのことで何日も泣いていたと聞いた。'], visit_o: ['宮を出て里帰りする許しを願う', '宦官に頼んで品物を届けてもらう', 'もう口にしない'], visit_r: ['許しを得て、車で実家へ帰った。母は門の前でひざまずいてあなたを迎え、長いこと泣いていた。', '彼は、宮中の者が宮を出るのはよくないと言った。帰ることはかなわなかった。', '宦官に頼んで、絹一匹と銭をいくらか届けてもらった。', 'それきり口にしなかった。母の面影は、年ごとにぼやけていった。'], dau_r: ['公主は、ある将軍の息子のもとへ降嫁した。輿入れの日、宮中からは数えきれないほどの下賜があった。', '公主は、代々二千石を出す家へ降嫁した。', '彼はうなずき、娘はさらに二年あなたのそばに残った。', '彼は、年頃の娘は嫁ぐものだと言い、縁談はそのまま決まった。公主は士族の名門へ降嫁した。'], wid_o: ['このまま静かに暮らしていく', '新君に願い出て宮を出て、故郷で余生を送る', '宮中の幼い子らの養育を手伝う'], wid_r: ['位牌を守る日々は、ゆっくりと過ぎていった。', '新君は許した。わずかな蓄えを持って宮門を出て、長く離れていた故郷へ帰った。', '新君は、先君の人が宮を出るのはよくないと言った。あなたは留まるしかなかった。', '宮中の幼い子らの世話を手伝った。子どもたちはあなたを「阿母」と呼んだ。'] };
  var HPOOL = {
    gentryWife: ['家の切り盛りを任され、朝早くから婢女たちに仕事を割り振った。', '一族の嫁たちが集まって針仕事をすると、話はいつのまにか誰の夫の官位が高いかの比べ合いになった。', '夫の同僚が家族連れで訪ねてきた。あなたは奥で宴を設け、女客をもてなした。', '息子に自ら『孝経』を教え、一句まちがえるたびに十遍書き写させた。', '祖先を祭る日、あなたは家の女たちを率いて後ろで礼をし、少しも乱れなかった。', '家の奴僕は数十人いる。誰が怠け、誰が手癖が悪いか、あなたはすべて心得ていた。', '夫がまた妾を迎えた。あなたはその女を呼び、家の決まりを言い渡した。'],
    gentryWifeHi: ['州郡の長官の夫人たちが屋敷を訪ねてきた。あなたは品秩どおりに席次を整えた。', '外出には車を使い、前後に婢女や僕がつき従った。道行く人々はみな道を譲った。', '一族の大事には、長老たちもあなたの意見を聞きに来た。', '宮中の女官が、太后が名門の命婦たちに会いたいと仰せだと伝えてきた。あなたは三度着替えてから出かけた。'],
    offWife: ['夫の任地に従い、官舎に住んだ。土地にも人にもなじみがなかった。', '県の富豪が贈り物を届けてきた。受け取るのも怖く、断るのも怖かった。', '夫が夜更けまで訴えを裁くあいだ、あなたは奥で食事を温めておいた。', '正月には属吏の妻たちが挨拶に来た。あなたは一人ひとりに返礼した。'],
    haoWife: ['塢壁には百人を超える小作人や部曲が住んでいて、その衣食はすべてあなたが目を配った。', '乱兵が来たとき、あなたは女たちを率いて塢壁の楼に立てこもり、幾晩も守り抜いた。', '小作人の嫁が小作料を減らしてほしいと頼みに来た。身ごもっているのを見て、一斗減らしてやった。', 'あなたの家の田はいくつもの里にまたがっていた。県吏も税の取り立てに来ると、まずあなたの家で一杯ひっかけていった。'],
    concNoble: ['正室に「しきたり」を教えると呼ばれ、廊下で一刻も立たされた。', 'あなたの産んだ子は正室を「母」と呼ばねばならない。それを聞いても、あなたは何も言わなかった。', '主人があなたの部屋を訪れる日は、だんだん減っていった。', '屋敷の婢女たちはあなたにも礼をする。だが陰で何と言っているかは知っていた。'],
    gentryHi: ['門生や故吏が節句ごとに挨拶に訪れ、門前には車馬が絶えなかった。', '新任の州郡長官は、着任するとまずあなたの家に挨拶に来た。', '一族の子弟の縁談も仕官も、まずあなたの家に相談が来た。', '家の賓客・部曲・奴僕を合わせると数百人になり、あなたは半分の名前も知らなかった。'],
    haoMan: ['塢壁には数百の部曲を養っていた。農時には田を耕し、乱れれば武器を取らせた。', '新しく着任した県令は、まず使いをよこしてあなたの家に挨拶を入れた。', 'あなたが乗り出して村の人殺し沙汰を収めると、官府もそれを認めるしかなかった。', '流民が身を寄せてきた。あなたは頑丈そうな者を小作人に取り、残りは追い返した。']
  };
  function hhChoice(L, y, P) {
    var R = L.R, k = L.spouseK, pal = !!L.flags.fcPal, alive = k.alive;
    if (L.age < 16 || !cool(L, 'hh', 3) || R() > 0.45) return;
    var dau = liveKin(L, function (x) { return x.rel === 'child' && x.sex === 'F' && !x.out && !x.wed && y - x.by >= 14 && y - x.by <= 18; })[0];
    var mom = L.kin[1] && L.kin[1].alive ? L.kin[1] : null, cs = [];
    if (alive) cs.push('rival', 'natal');
    if (alive && mom) cs.push('visit');
    if (dau) cs.push('dau', 'dau');
    if (!alive) cs.push('wid', 'wid');
    if (!cs.length) return;
    var kd = pick(R, cs), H = { rival_q: '屋敷に若い側妾が新しく入り、たちまち寵愛を得た。何かとあなたの上に立とうとし、あなたの部屋の費えまで削られた。', rival_qp: '宮中に美人が新しく入り、たちまち寵愛を得た。何かとあなたの上に立とうとし、あなたの部屋の費えまで削られた。', rival_o: ['こらえて、張り合わない', '正室に訴える', '何とか彼の心をつかみ、寵愛を取り戻す'], rival_r: ['あなたはこらえた。暮らしは少し苦しくなったが、波風は立たなかった。', '正室があなたの肩を持ってくれ、その側妾はずいぶんおとなしくなった。', '正室は「姉妹なのだから仲よくなさい」と言っただけだった。それからというもの、相手はいっそう増長した。', 'あなたはいくらか寵愛を取り戻した。だが屋敷の者は、あなたは計算高いと噂した。', '何度か張り合ったが、かえって彼をうんざりさせ、ますます足が遠のいた。'], natal_q: '実家から人づてに手紙が来た。家が災難に遭い、暮らしが立たない、何とかしてほしいという。', natal_o: ['自分の蓄えをこっそり送る', '実家の兄弟に職を世話してほしいと彼に頼む', '心を鬼にして相手にしない'], natal_r: ['あなたは貯めておいた私財を人に託して送った。母からの返事には、家じゅうがあなたに感謝していると書かれていた。', '彼はうなずいた。あなたの兄弟は屋敷で小役人の職を得て、実家の暮らしは少し楽になった。', '彼は眉をひそめ、奥の者は外のことに口を出すなと言った。あなたは二度とその話を持ち出せなかった。', 'あなたは取り合わなかった。のちに、母がそのことで何日も泣いていたと聞いた。'], visit_q: 'もう何年も母に会っていない。', visit_o: ['里帰りを許してほしいと彼に頼む', '人に託して品物を届ける', '口にしない'], visit_r: ['あなたは車で実家に帰った。母はあなたの手を取って長いこと泣き、痩せたねと言った。', '屋敷の者が外へ出るのはよくないと言われ、帰れなかった。', '絹一匹と銭をいくらか、人に託して届けた。', 'あなたは二度と口にしなかった。母の面影は、年ごとにぼやけていった。'], dau_q: 'あなたの娘{kin}が縁談の年ごろになった。屋敷の者が何軒か相手を選んできた。', dau_qp: 'あなたの娘{kin}は公主に封ぜられ、降嫁の年ごろになった。宮中が功臣の子弟から何人か候補を選んできた。', dau_o: ['将の息子に嫁がせる', '士族の名門に嫁がせる', 'もう数年手元に置かせてほしいと彼に頼む'], dau_r: ['娘はある将の息子に嫁いだ。嫁入りの日、屋敷では何十卓もの宴が開かれた。', '娘は代々二千石を出す家に嫁いだ。', '彼はうなずき、娘はさらに二年あなたのそばにいた。', '彼は、娘は嫁ぐものだと言い、縁談はそのまま決まった。娘は士族の名門に嫁いだ。'], wid_q: '彼が世を去って、もう何年にもなる。あなたは位牌を守り、一年また一年と過ごしてきた。', wid_o: ['このまま静かに暮らす', '屋敷を出て、故郷で余生を送らせてほしいと新しい主に願う', '屋敷の幼い子らの養育を手伝う'], wid_r: ['位牌を守る日々は、ゆっくりと過ぎていった。', '新しい主は許してくれた。あなたはわずかな私財を攜え、長く離れていた故郷へ帰った。', '新しい主は、先君の者が外へ出るのはよくないと言った。あなたは残るしかなかった。', 'あなたは屋敷の幼い子らの面倒を見るのを手伝い、子どもたちはあなたを「阿母」と呼んだ。'], dau_job: '持家' };
    var q = kd === 'rival' ? (pal ? H.rival_qp : H.rival_q) : kd === 'dau' ? (pal ? H.dau_qp : H.dau_q).replace('{kin}', dau.name) : H[kd + '_q'];
    var ho = pal && HPAL[kd + '_o'] || H[kd + '_o'];
    P.queue.push({ key: 'hh', kd: kd, kin: dau, q: q, o: ho, w: ho.map(function () { return 1; }) });
  }
  function hhOutcome(L, y, c, i) {
    var R = L.R, H = { rival_q: '屋敷に若い側妾が新しく入り、たちまち寵愛を得た。何かとあなたの上に立とうとし、あなたの部屋の費えまで削られた。', rival_qp: '宮中に美人が新しく入り、たちまち寵愛を得た。何かとあなたの上に立とうとし、あなたの部屋の費えまで削られた。', rival_o: ['こらえて、張り合わない', '正室に訴える', '何とか彼の心をつかみ、寵愛を取り戻す'], rival_r: ['あなたはこらえた。暮らしは少し苦しくなったが、波風は立たなかった。', '正室があなたの肩を持ってくれ、その側妾はずいぶんおとなしくなった。', '正室は「姉妹なのだから仲よくなさい」と言っただけだった。それからというもの、相手はいっそう増長した。', 'あなたはいくらか寵愛を取り戻した。だが屋敷の者は、あなたは計算高いと噂した。', '何度か張り合ったが、かえって彼をうんざりさせ、ますます足が遠のいた。'], natal_q: '実家から人づてに手紙が来た。家が災難に遭い、暮らしが立たない、何とかしてほしいという。', natal_o: ['自分の蓄えをこっそり送る', '実家の兄弟に職を世話してほしいと彼に頼む', '心を鬼にして相手にしない'], natal_r: ['あなたは貯めておいた私財を人に託して送った。母からの返事には、家じゅうがあなたに感謝していると書かれていた。', '彼はうなずいた。あなたの兄弟は屋敷で小役人の職を得て、実家の暮らしは少し楽になった。', '彼は眉をひそめ、奥の者は外のことに口を出すなと言った。あなたは二度とその話を持ち出せなかった。', 'あなたは取り合わなかった。のちに、母がそのことで何日も泣いていたと聞いた。'], visit_q: 'もう何年も母に会っていない。', visit_o: ['里帰りを許してほしいと彼に頼む', '人に託して品物を届ける', '口にしない'], visit_r: ['あなたは車で実家に帰った。母はあなたの手を取って長いこと泣き、痩せたねと言った。', '屋敷の者が外へ出るのはよくないと言われ、帰れなかった。', '絹一匹と銭をいくらか、人に託して届けた。', 'あなたは二度と口にしなかった。母の面影は、年ごとにぼやけていった。'], dau_q: 'あなたの娘{kin}が縁談の年ごろになった。屋敷の者が何軒か相手を選んできた。', dau_qp: 'あなたの娘{kin}は公主に封ぜられ、降嫁の年ごろになった。宮中が功臣の子弟から何人か候補を選んできた。', dau_o: ['将の息子に嫁がせる', '士族の名門に嫁がせる', 'もう数年手元に置かせてほしいと彼に頼む'], dau_r: ['娘はある将の息子に嫁いだ。嫁入りの日、屋敷では何十卓もの宴が開かれた。', '娘は代々二千石を出す家に嫁いだ。', '彼はうなずき、娘はさらに二年あなたのそばにいた。', '彼は、娘は嫁ぐものだと言い、縁談はそのまま決まった。娘は士族の名門に嫁いだ。'], wid_q: '彼が世を去って、もう何年にもなる。あなたは位牌を守り、一年また一年と過ごしてきた。', wid_o: ['このまま静かに暮らす', '屋敷を出て、故郷で余生を送らせてほしいと新しい主に願う', '屋敷の幼い子らの養育を手伝う'], wid_r: ['位牌を守る日々は、ゆっくりと過ぎていった。', '新しい主は許してくれた。あなたはわずかな私財を攜え、長く離れていた故郷へ帰った。', '新しい主は、先君の者が外へ出るのはよくないと言った。あなたは残るしかなかった。', 'あなたは屋敷の幼い子らの面倒を見るのを手伝い、子どもたちはあなたを「阿母」と呼んだ。'], dau_job: '持家' }, r = L.flags.fcPal && HPAL[c.kd + '_r'] || H[c.kd + '_r'], t;
    if (c.kd === 'rival') {
      if (i === 0) { t = r[0]; L.standing -= 1; L.body -= 1; }
      else if (i === 1) { if (R() < 0.6) { t = r[1]; L.standing += 2; } else { t = r[2]; L.standing -= 2; } }
      else if (R() < 0.4) { t = r[3]; L.flags.fcFav = true; L.standing -= 1; } else { t = r[4]; L.flags.fcFav = false; }
    } else if (c.kd === 'natal') {
      var nk = L.kin.filter(function (x) { return (x.rel === 'mother' || x.rel === 'father' || x.rel === 'sib') && x.alive; });
      if (i === 0) { t = r[0]; L.eco.priv = Math.max(0, L.eco.priv - 3000); nk.forEach(function (x) { affAdd(x, 12); }); }
      else if (i === 1) { if (R() < 0.5) { t = r[1]; var br = nk.filter(function (x) { return x.rel === 'sib' && x.sex === 'M'; })[0]; if (br) br.job = '府吏'; } else { t = r[2]; L.standing -= 2; } }
      else { t = r[3]; nk.forEach(function (x) { affAdd(x, -20); }); }
    } else if (c.kd === 'visit') {
      if (i === 0) { if (R() < 0.6) { t = r[0]; affAdd(L.kin[1], 15); } else t = r[1]; }
      else if (i === 1) { t = r[2]; L.eco.priv = Math.max(0, L.eco.priv - 800); affAdd(L.kin[1], 8); }
      else t = r[3];
    } else if (c.kd === 'dau') {
      var d = c.kin; if (!d || !d.alive) return;
      if (i === 2 && R() < 0.5) t = r[2];
      else { t = i === 0 ? r[0] : i === 1 ? r[1] : r[3]; d.out = true; d.wed = true; d.job = '持家'; L.standing += 2; }
    } else if (c.kd === 'wid') {
      if (i === 0) t = r[0];
      else if (i === 1) { if (R() < 0.4) { t = r[1]; L.flags.leftHH = true; L.flags.noRemarry = true; } else t = r[2]; }
      else { t = r[3]; L.standing += 2; }
    }
    if (t) add(L, 1.3, 'life', t);
  }
  function hhDaily(L, y) {
    var a = L.age, R = L.R, tk = lifeTier(L, y).k, rich = tk === 'high' || tk === 'top', sp = L.spouseK, P = HPOOL;
    if (a < 16) return null;
    if (L.sex === 'F' && L.married && sp && sp.alive && !sp.apart) {
      if (L.flags.isConc && !L.flags.famousConc) return R() < 0.6 ? fresh(L, P.concNoble) : null;
      if (/県令|郡守|県長|刺史|九卿|議郎/.test(sp.job || '')) return R() < 0.6 ? fresh(L, P.offWife) : null;
      if (L.cls === 'gentry') return R() < 0.6 ? fresh(L, L.gate >= 3 ? P.gentryWifeHi.concat(P.gentryWife) : P.gentryWife) : null;
      if (rich && L.cls !== 'merchant') return R() < 0.5 ? fresh(L, P.haoWife) : null;
    }
    if (L.sex === 'M' && a >= 25) {
      if (L.cls === 'gentry' && L.gate >= 3 && isHead(L)) return R() < 0.45 ? fresh(L, P.gentryHi) : null;
      if (rich && L.cls !== 'gentry' && L.cls !== 'merchant' && isHead(L)) return R() < 0.45 ? fresh(L, P.haoMan) : null;
    }
    return null;
  }
  /* ---------- 侍婢与宮人：底層女子的去処，偶爾被看中 ---------- */
  // 売身為婢、立傭券做侍女、父親坐罪被没入官府；好勝的人会自己去争
  function vain(L) { return L.tr.cmp >= 62; }
  function jealous(L) { return L.tr.cmp >= 70 && L.tr.soc < 48; }
  function maidOk(L) { return L.sex === 'F' && !L.married && !L.flags.concubineOf && !L.flags.isConc && L.flags.palace == null && (L.job === '侍女' || L.cls === 'slave' && (L.job === '婢女' || L.job === '奴婢')); }
  function maidFig(L, y) { var id = L.flags.maidOf, C = id && FAMOUS_CONC[id]; return C && y >= C.y[0] && y <= C.y[1] && y < C.d ? id : null; }
  function capOf(L, y) { var g = group(ctrl(L.zone, y)); return g === 'han' ? (y < 190 ? 'luoyang' : y < 196 ? 'guanzhong' : 'yu') : g === 'wei' ? (y < 220 ? 'ji' : 'luoyang') : g === 'wu' ? 'jiangdong' : g === 'shu' ? 'shu' : g === 'jin' ? (y < 311 ? 'luoyang' : 'jiangdong') : null; }
  function maidLines(L) {
    var M = D.MAID, y = L.by + L.age, mf = maidFig(L, y), p = M.daily.slice();
    if (L.job === '侍女') p = p.concat(M.dailyHire);
    if (mf) p = p.concat(M.fu.map(function (t) { return t.replace(/\{lord\}/g, figName(mf)); }));
    return p;
  }
  function maidChoice(L, y, P) {
    var R = L.R, a = L.age, M = D.MAID;
    if (!M || L.sex !== 'F' || L.eth || inHH(L) || L.soldier || L.band || L.convict || !L.alive) return;
    // 一、荒年里，人牙子上門：売身為婢，或立傭券做幾年侍女
    if (!L.married && !L.widowed && a >= 12 && a <= 18 && !L.flags.maidAsk && L.job !== '侍女' && L.flags.palace == null && ['peasant', 'tenant', 'artisan', 'tuntian'].indexOf(L.cls) >= 0 && R() < (poorNow(L) ? 0.06 : 0.012)) {
      L.flags.maidAsk = true;
      var fid = lordFigAt(ctrl(L.zone, y), y), C = fid && FAMOUS_CONC[fid], fam = C && y >= C.y[0] && y <= C.y[1] && R() < 0.2 ? fid : null;
      var hi = Math.floor(R() * M.hh.length), lean = poorNow(L) && (L.crisis || L.eco.debt > 0), price = lean ? 5000 : 12000;
      var q = (fam ? M.inQf.replace(/\{lord\}/g, figName(fam)) : M.inQ.replace('{hh}', M.hh[hi][0])).replace('{p}', fmt(price)) + (lean ? M.lean : '');
      P.queue.push({ key: 'maid', kd: 'in', fam: fam, hi: hi, price: price, q: q, o: M.inO, w: [lean ? 1.6 : 0.5, 1.2, 1.5] });
      return;
    }
    // 二、被主人看中（私家婢女被主人看中，另有 f_master）
    if (maidOk(L) && a >= 14 && a <= 26 && cool(L, 'mpick', 2)) {
      var mf = maidFig(L, y);
      if ((mf || L.cls !== 'slave') && R() < 0.035 * (L.found.charm ? 1.8 : 1)) {
        P.queue.push({ key: 'maid', kd: 'pick', fam: mf, q: mf ? M.pickQf.replace(/\{lord\}/g, figName(mf)) : M.pickQ, o: L.cls === 'slave' ? M.pickO.slice(0, 2) : M.pickO, w: [2, 1, 1] });
        return;
      }
    }
    // 三、好勝的人，自己去争
    if (maidOk(L) && vain(L) && a >= 14 && a <= 26 && cool(L, 'mshow', 3) && R() < 0.4) {
      var sf = maidFig(L, y), ks = ['wine', 'sing'].concat(jealous(L) ? ['frame'] : [], ['none']), so = ks.map(function (k) { return M.showO[k]; });
      P.queue.push({ key: 'maid', kd: 'show', fam: sf, ks: ks, q: sf ? M.showQf.replace(/\{lord\}/g, figName(sf)) : M.showQ, o: so, w: ks.map(function (k) { return k === 'none' ? 1 : 1.5; }) });
      return;
    }
    // 四、宮人争寵
    var lv = L.flags.palace;
    if (lv != null && !L.flags.palaceOut && (L.cls === 'slave' || L.flags.palaceUp) && lv < 3 && vain(L) && a >= 14 && a <= 30 && cool(L, 'gshow', 3) && R() < 0.4) {
      var era = y >= 181 && y <= 189 && L.zone === 'luoyang' ? 'lie' : y >= 266 && y <= 290 && L.zone === 'luoyang' ? 'yang' : 'gen';
      var gk = ['act'].concat(L.eco.cash + L.eco.priv >= 1000 ? ['bribe'] : [], jealous(L) && lv >= 1 ? ['frame'] : [], ['none']);
      P.queue.push({ key: 'maid', kd: 'gshow', ks: gk, q: M.gShowQ[era], o: gk.map(function (k) { return k === 'act' ? M.gShowO[era] : M.gShowO[k]; }), w: gk.map(function (k) { return k === 'none' ? 1 : 1.5; }) });
      return;
    }
    // 五、父親坐罪，妻女没入官府
    var f = L.kin[0];
    if (!L.married && a >= 8 && a <= 20 && L.cls !== 'slave' && L.flags.palace == null && !L.flags.moAsk && f && f.alive && !f.apart && !f.out && (L.cls === 'clerk' || L.cls === 'gentry' && (L.gate || 0) <= 2) && capOf(L, y) && R() < 0.0025 * chaos(y)) {
      L.flags.moAsk = true;
      P.queue.push({ key: 'maid', kd: 'mo', q: M.moQ, o: M.moO, w: [1, 2] });
    }
  }
  function palaceUp(L, y) {
    var rk = palaceRanks(y), lv = L.flags.palace || 0;
    if (lv >= rk.length - 2) return;
    lv++; L.flags.palace = lv; L.flags.palaceUp = true; L.job = rk[lv]; L.flags.palaceTop = rk[lv]; L.fame += 4 + lv * 3; L.standing += 5;
    if (lv >= 1) L.cls = 'gentry';
    add(L, 1.36, 'good', PAL_T[rk[lv]] || D.MAID.palUp);
  }
  function maidToConc(L, y, fam) {
    var R = L.R, M = D.MAID;
    if (fam) { famousConcOutcome(L, y, { fid: fam, maid: true }, 0); return; }
    if (L.cls === 'slave') { L.flags.concubineOf = true; L.standing += 3; add(L, 1.34, 'life', M.toSlaveC); return; }
    L.spouseK = null; var ocls = L.cls; L.cls = 'gentry'; L.gate = L.gate || 1;
    var nsp = makeSpouse(L, y); nsp.age = L.age + 12 + Math.floor(R() * 20); nsp.from = L.flags.maidHS || '';
    doMarry(L, nsp, y, 1.33, M.toConcN);
    L.flags.isConc = true; L.cls0 = ocls; L.standing += 4; L.job = '持家';
    add(L, 1.34, 'life', M.toConcN2.replace('{n}', nsp.name));
  }
  function maidOutcome(L, y, c, i) {
    var R = L.R, M = D.MAID, k = c.ks ? c.ks[i] : i, rr;
    if (!L.alive) return;
    if (c.kd === 'in') {
      if (i === 2) { add(L, 1.3, 'life', M.inR[2]); return; }
      var hs = c.fam ? M.hsF.replace(/\{lord\}/g, figName(c.fam)) : M.hh[c.hi][1];
      L.flags.maidWas = i === 0 ? 'bi' : 'hire'; L.flags.maidHS = hs; L.flags.maidOf = c.fam || null;
      if (i === 0) {
        L.cls = 'slave'; L.eco = initEco(L); L.land = 0; L.job = '婢女'; L.standing = Math.min(L.standing, 8);
        liveKin(L, function (x) { return ['father', 'mother', 'dimu', 'sib', 'gp'].indexOf(x.rel) >= 0; }).forEach(function (x) { x.out = true; });
        add(L, 1.3, 'bad', M.inR[0].replace('{hs}', hs).replace('{p}', fmt(c.price)));
      } else {
        L.flags.maidJob0 = L.job; L.job = '侍女'; L.flags.maidEnd = y + 3 + Math.floor(R() * 3);
        add(L, 1.3, 'life', M.inR[1].replace('{hs}', hs).replace('{n}', cnNum(L.flags.maidEnd - y)));
      }
      if (c.fam && i === 0) seatMove(L, FAMOUS_CONC[c.fam].seat(y), 1.31, M.seat, y);
      return;
    }
    if (c.kd === 'pick') {
      if (i === 0) { maidToConc(L, y, c.fam); return; }
      if (i === 1) {
        if (R() < 0.5) { add(L, 1.3, 'life', M.pickR.saved); return; }
        if (c.fam) { add(L, 1.3, 'bad', M.pickR.forced); maidToConc(L, y, c.fam); return; }
        if (L.cls === 'slave') { var dz = pick(R, ['jingnan', 'jiangdong', 'yu', 'ji', 'xu'].filter(function (z) { return z !== L.zone; })); L.flags.maidOf = null; relocate(L, dz, 1.3, M.pickR.sold, 0.02, y); return; }
        add(L, 1.3, 'bad', M.pickR.fired); maidQuit(L); return;
      }
      add(L, 1.3, 'life', M.pickR.quit); maidQuit(L); return;
    }
    if (c.kd === 'show') {
      if (k === 'none') { add(L, 1.3, 'life', M.showR.none); return; }
      if (k === 'frame') {
        if (R() < 0.5) { add(L, 1.3, 'life', M.showR.frameOk); L.tr.cmp = clamp(L.tr.cmp + 2, 5, 95); }
        else { add(L, 1.3, 'bad', M.showR.frameBad); L.body -= 3; L.standing -= 2; }
        return;
      }
      var p = 0.16 * (L.found.charm ? 1.8 : 1) * (k === 'wine' ? 1.1 : 0.9);
      rr = R();
      if (rr < p) { add(L, 1.3, 'good', M.showR.ok); maidToConc(L, y, maidFig(L, y)); }
      else if (rr < p + 0.3) { add(L, 1.3, 'bad', M.showR.caught); L.body -= 4; L.standing -= 2; }
      else add(L, 1.3, 'life', M.showR.miss);
      return;
    }
    if (c.kd === 'gshow') {
      rr = R();
      if (k === 'none') add(L, 1.3, 'life', M.gShowR.none);
      else if (k === 'act') {
        var gp = 0.12 * (L.found.charm ? 1.8 : 1);
        if (rr < gp) { add(L, 1.3, 'good', M.gShowR.ok); palaceUp(L, y); }
        else if (rr < gp + 0.25) { add(L, 1.3, 'bad', M.gShowR.caught); L.body -= 4; L.standing -= 2; }
        else add(L, 1.3, 'life', M.gShowR.miss);
      } else if (k === 'bribe') {
        payFrom(L, 1000);
        if (rr < 0.18 * (L.found.charm ? 1.6 : 1)) { add(L, 1.3, 'good', M.gShowR.bribeOk); palaceUp(L, y); }
        else add(L, 1.3, 'life', M.gShowR.bribeNo);
      } else if (k === 'frame') {
        if (rr < 0.35) { add(L, 1.3, 'life', M.gShowR.frameOk); L.standing += 2; }
        else if (rr < 0.55) die(L, 'executed', 1.35, { full: M.gShowR.frameDie });
        else { add(L, 1.3, 'bad', M.gShowR.frameBad); L.standing -= 4; }
      }
      return;
    }
    if (c.kd === 'mo') {
      var f = L.kin[0], pz = capOf(L, y);
      if (!f || !f.alive) return;
      if (i === 1 && L.eco.cash + L.eco.priv >= 20000) {
        payFrom(L, 20000);
        if (R() < 0.6) { f.job = '刑徒'; add(L, 1.3, 'bad', M.moR.ransom); return; }
      } else if (i === 1) add(L, 1.29, 'bad', M.moR.noMoney);
      kinDie(L, f, 'executed', 1.3, y);
      liveKin(L, function (x) { return x.rel === 'mother' || x.rel === 'sib' || x.rel === 'dimu'; }).forEach(function (x) { x.apart = true; });
      L.cls = 'slave'; L.job = '宮人'; L.land = 0; L.eco = initEco(L); L.eco.house = 0; L.flags.palace = 0; L.flags.palaceIn = y; L.flags.palaceTop = '宮人'; L.flags.moru = y; L.standing = Math.min(L.standing, 5);
      var tx = M.moR.taken + (M.moNote[group(ctrl(L.zone, y))] || '');
      if (pz && CAP_SEAT[pz]) { var cs = CAP_SEAT[pz]; if (L.county === cs[1]) add(L, 1.32, 'bad', tx.replace('{dest}', cs[1])); else seatMove(L, cs, 1.32, tx, y); } else add(L, 1.32, 'bad', tx.replace('{dest}', zname(L.zone)));
    }
  }
  function maidQuit(L) { L.job = L.flags.maidJob0 || ''; L.flags.maidOf = null; L.flags.maidEnd = null; }
  function maidYear(L, y) {
    if (!D.MAID || L.job !== '侍女' || !L.alive) return;
    L.eco.priv += 300;
    if (L.married || y >= (L.flags.maidEnd || 0)) { if (!L.married) add(L, 1.4, 'life', D.MAID.endHire); maidQuit(L); }
  }
  /* ---------- 君主之死、政権之亡：後宮与姫妾的下場 ---------- */
  var EMP_DIE = { han: [189], wei: [226, 239], shu: [223], wu: [252, 264], jin: [290, 306] };
  function capQuiet(L, st) { var ji = -1; D.JUN.forEach(function (j, i) { if (ji < 0 && j[0] === st[0] && (j[3].indexOf(st[1]) >= 0 || st[1] === '建業')) ji = i; }); if (ji >= 0) { setPlace(L, ji); L.county = st[1]; L.urban = true; } }
  function palOut(L, y, cls, job) { L.flags.palaceOut = y; L.cls = cls; L.job = job; L.land = 0; L.standing = Math.min(L.standing, 25); }
  function palLike(L) { return inPal(L) || !!(L.flags.famousConc && L.flags.fcPal && inHH(L)); }
  function consortChoice(L, y, P) {
    var C = D.CFATE, g = group(ctrl(L.zone, y));
    if (!C || !palLike(L) || !L.flags.palG || L.flags.palG === g) return;
    if (L.flags.palG === 'shu' && g === 'wei' && L.age < 45) P.queue.push({ key: 'cfate', kd: 'shu', q: C.shuQ, o: C.shuO, w: [L.tr.per >= 65 ? 1.5 : 0.3, 1, 1.5] });
  }
  function consortOutcome(L, y, c, i) {
    var C = D.CFATE, R = L.R;
    if (c.kd !== 'shu' || !L.alive) return;
    if (i === 0) { die(L, 'suicide', 1.6, { full: C.shuDie }); return; }
    if (i === 2 && R() < 0.35) { palOut(L, y, 'peasant', '農'); L.flags.noRemarry = false; add(L, 1.6, 'good', C.shuFree); return; }
    if (L.flags.famousConc) { L.flags.leftHH = true; L.spouseK = null; L.married = false; L.widowed = true; L.flags.isConc = false; }
    palOut(L, y, 'soldier', '持家'); L.flags.noRemarry = false;
    var sp = makeSpouse(L, y); sp.job = '軍吏';
    doMarry(L, sp, y, 1.6, i === 2 ? C.shuGive2 : C.shuGive);
  }
  function consortYear(L, y) {
    var C = D.CFATE, R = L.R, z = L.zone, g = group(ctrl(z, y)), lv = L.flags.palace || 0, fc = !!L.flags.famousConc;
    if (!C || !L.alive) return;
    if (fc && L.flags.famousConc === 'yuanshao' && y === 204 && z === 'ji' && L.flags.noRemarry && !L.flags.leftHH) add(L, 1.66, 'life', C.yuan204);
    if (!palLike(L)) return;
    var hi = fc || lv >= 1, old = L.flags.palG, r;
    L.flags.palG = g;
    if (!old) return;
    // 漢末：董卓遷都，天子東帰
    if (inPal(L) && y === 190 && z === 'luoyang') { if (R() < 0.06) { die(L, 'road', 1.66, { full: C.qianDie }); return; } seatMove(L, CAP_SEAT.guanzhong, 1.66, C.qian, y); return; }
    if (inPal(L) && y === 195 && z === 'guanzhong') {
      r = R();
      if (r < 0.3) { die(L, 'war', 1.66, { full: C.dongDie }); return; }
      if (r < 0.55) { palOut(L, y, 'slave', '奴婢'); add(L, 1.66, 'bad', C.dongCap); return; }
      add(L, 1.66, 'life', C.dong); L.flags.hanEast = true; return;
    }
    if (inPal(L) && y === 196 && L.flags.hanEast) { L.flags.hanEast = false; seatMove(L, CAP_SEAT.yu, 1.66, C.xu, y); return; }
    // 漢亡：天子禅位，做了山陽公
    if (inPal(L) && y === 220 && (L.flags.palaceIn || 0) < 220 && z === 'yu') {
      if (hi && R() < 0.6) { seatMove(L, ['河内郡', '山陽'], 1.66, C.shanyang, y); L.flags.palaceUp = false; L.flags.noRemarry = true; return; }
      if (!hi && R() < 0.3) { palOut(L, y, 'peasant', '農'); add(L, 1.66, 'good', C.hanFree); return; }
      add(L, 1.66, 'life', C.hanStay); return;
    }
    // 永嘉之乱：洛陽陥落
    if (inPal(L) && y === 311 && z === 'luoyang') {
      r = R();
      if (r < 0.35) { die(L, 'war', 1.66, { full: C.yjDie }); return; }
      if (r < 0.8) { palOut(L, y, 'slave', '奴婢'); relocate(L, 'bing', 1.66, C.yjCap, 0.05, y); return; }
      palOut(L, y, 'peasant', '農'); add(L, 1.66, 'life', C.yjRun); return;
    }
    // 政権滅亡
    if (old !== g) {
      if (old === 'shu' && g === 'wei' && L.age >= 45) { palOut(L, y, 'peasant', '農'); if (fc) L.flags.leftHH = true; add(L, 1.66, 'life', C.shuOld); return; }
      if (old === 'wei' && g === 'jin') {
        if (hi && !fc && R() < 0.5) { seatMove(L, CAP_SEAT.ji, 1.66, C.chenliu, y); L.flags.palaceUp = false; L.flags.noRemarry = true; return; }
        add(L, 1.66, 'life', C.weiJin); return;
      }
      if (old === 'wu' && g === 'jin' && (fc || lv >= 1)) { seatMove(L, CAP_SEAT.luoyang, 1.66, C.wuJin, y); L.flags.palaceUp = false; return; }
      return;
    }
    // 君主駕崩（改朝換代之外）
    if (!fc && (EMP_DIE[g] || []).indexOf(y) >= 0) {
      var kids = liveKin(L, function (k) { return k.rel === 'child'; }).length;
      if (lv >= 1 && kids) { L.flags.palaceOut = y; L.job = '太妃'; add(L, 1.66, 'life', C.taifei); return; }
      if (lv >= 1) { L.flags.palaceUp = false; L.flags.noRemarry = true; add(L, 1.66, 'life', C.biegong); return; }
      if (!(g === 'jin' && y === 290) && R() < 0.3) { palOut(L, y, 'peasant', '農'); add(L, 1.66, 'good', C.fang); }
    }
  }
  function famousConcChoice(L, y, P) {
    if (L.sex !== 'F' || L.married || L.widowed || L.age < 15 || L.age > 22 || L.flags.fcAsk || L.eth || L.flags.concubineOf || L.flags.isConc) return;
    var fk = ctrl(L.zone, y), id = lordFigAt(fk, y), C = FAMOUS_CONC[id];
    if (!C || y < C.y[0] || y > C.y[1]) return;
    if (L.R() >= 0.004 * (L.found.charm ? 2 : 1) * (L.urban ? 2 : 1)) return;
    L.flags.fcAsk = true;
    var n = figName(id);
    P.queue.push({ key: 'fconc', fid: id, q: n + 'の車駕が城中を通りかかり、彼は人混みの中にあなたを見つけた。翌日、彼の部下が結納の品を攜えて門を訪れ、' + n + 'があなたを妾に迎えたいと告げた。家族全員があなたを見つめた。', o: ['承諾する', '父母に何とか断ってもらう'], w: [2, 1] });
  }
  function eliteMeet(L, y) {
    var R = L.R, a = L.age;
    if (a < 12 || L.eth || L.cls === 'slave' || L.band || !L.alive || L.flags.famousConc) return;
    var p = 0;
    if (L.cls === 'gentry') p = L.gate >= 3 ? 0.2 : L.gate >= 2 ? 0.12 : 0.05;
    if (realOffice(L)) p = Math.max(p, CIRCLE_P[L.office] || 0.03);
    if (L.mil >= 2) p = Math.max(p, L.mil * 0.025);
    if (L.cls === 'merchant' && L.wealth >= 60) p = Math.max(p, 0.015);
    if (L.fame >= 40) p = Math.max(p, 0.03);
    if (L.lastFocus === 'travel' && L.literate) p = Math.max(p, 0.05) * 1.5;
    if (!p) return;
    p *= (1 + L.fame / 80) * (L.flags.salon ? 1.6 : 1) * (L.flags.connected || L.flags.retainers ? 1.2 : 1) * (a < 16 ? 0.5 : 1) * (L.sex === 'F' ? 0.5 : 1);
    if (R() >= Math.min(0.4, p)) return;
    var fk = ctrl(L.zone, y), cands = [], FA = figPresence(), gk = group(fk);
    // 高門与大官的交遊不限於本郡：同一政権治下、当時在世的人物都可能同席
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
    var who = a < 18 && L.kin[0] && L.kin[0].alive && !L.kin[0].apart ? '父親' : null, t;
    if (c.lord) t = pick(R, [fig.n + 'が本郡を巡視し、郡では宴を設けて迎えた。あなたもその席にいた。', fig.n + 'が郡中の士人と属吏を召し出し、あなたもその中にいた。']) + 'あなたは初めて間近に彼を見た。' + (LORD_LOOK[c.id] || '');
    else t = pick(R, ['郡の大族が宴を設け、あなたもその席にいた。', '太守が府で郡中の士人を招いて宴を開き、あなたも招かれた。', 'あなたは' + (who ? who + 'に連れられて' : '') + 'ある名士の家を訪ねた。座には他にも客がいた。', 'ある清談の集まりで、あなたは何人かの名士と同席した。']) + '席上、ひときわ目を引く客がいた——' + fig.n + '、' + fig.d + '。' + (LORD_LOOK[c.id] || '');
    add(L, 2.2, 'meet', t);
    markMet(L, c.id, y, 'あなたはかつて' + fig.n + (c.lord ? 'と一度顔を合わせたことがある' : 'と同席したことがある') + '。');
    L.rec.tags.push('meet');
  }
  function prepare(L, y) {
    var R = L.R, P = { queue: [], dec: { flee: {}, sights: [] } }, a = L.age, z = L.zone;
    var free = !L.soldier && !L.band && !L.convict && !inHH(L);
    if (inHH(L)) hhChoice(L, y, P);
    maidChoice(L, y, P);
    consortChoice(L, y, P);
    if (L.crime && L.crime.ask) { L.crime.ask = false; P.queue.push({ key: 'crimeAfter', q: 'あなたははずみで人を殺してしまった。死者の家族はすでに県に訴え出ており、亭長が求盗を率いてあちこちで下手人を捜している。', o: ['夜のうちに他郷へ逃げる', '自首する', '一族に金を集めてもらい、死者の家と示談にする'], w: [3, 1, L.eco.cash >= 10000 ? 2 : 0.1] }); }
    var gap = a - L.lastChoice >= 3;
    (EV_BY_Y[y] || []).forEach(function (ev) {
      var fx = localFx(L, ev, z, y);
      if (!fx || fx._skip) return;
      if (fx.flee && a >= 14 && free) {
        var dest = pick(R, fx.to);
        if (R() < Math.min(1, fx.flee * 2 + 0.2)) {
          if (L.cls === 'gentry' || L.wealth >= 65) P.queue.push({ key: 'flee', ev: ev.id, dest: dest, rich: true, info: compareText(L, y, dest), q: (fx.t || ev.w) + '一族は去るか留まるかを話し合っていた。', o: ['金目の物をまとめ、車で' + zname(dest) + 'へ逃げる', '門を閉ざして塢壁に立てこもる', '天に任せる'], w: [3, 3, 1] });
          else P.queue.push({ key: 'flee', ev: ev.id, dest: dest, info: compareText(L, y, dest), q: (fx.t || ev.w) + '村ではすでに荷物をまとめ始めた者もいた。', o: ['一家で' + zname(dest) + 'へ逃げる', '故郷に留まる'], auto: Math.min(0.95, fx.flee * 2.2) });
        }
      }
      // 株連：先有牽連，才有禍事
      if (fx.purge && (L.cls === 'gentry' || L.office) && a >= 15 && !L.soldier) {
        var prisk = fx.purge * (L.office ? 2.5 : 1) * (L.gate >= 3 ? 2 : 1);
        if (R() < Math.min(0.7, prisk * 3)) {
          var pn = fx.pn || '失脚した側', tie = pick(R, PURGE_TIES).replace(/\{pn\}/g, pn);
          P.queue.push({ key: 'purge', ev: ev.id, tie: tie, pn: pn, q: (fx.t || ev.w) + '朝廷は' + pn + 'の一党を厳しく追及していた。あなたは' + tie + '。そのことを知る者は少なくない。早めに手を打てと勧める者もいた。',
            o: ['夜のうちに逃げ出し、他郡を頼る', '門を閉ざして処分を待つ', '上書して潔白を訴え、旧友を告発する'], w: [1 + (L.tr.act - 50) / 30, 1 + (L.tr.per - 50) / 30, Math.max(0.2, 0.6 + (L.tr.cmp - L.tr.soc) / 40)] });
        }
      }
      if (fx.join && L.sex === 'M' && a >= 15 && a <= 45 && free && ['peasant', 'tenant', 'tuntian'].indexOf(L.cls) >= 0) {
        if (R() < fx.join * (L.flags.taiping ? 2 : 1)) P.queue.push({ key: 'join', q: '太平道の者たちが村の入口に集まり、頭に黄巾を巻いて「黄天当立」と叫んでいた。一緒に来いとあなたを誘う者がいた。', o: ['黄巾を巻き、彼らと共に起つ', '家に閉じこもる'], auto: L.flags.taiping ? 0.6 : 0.25 });
      }
      if (fx.tt && a >= 16 && free && (L.cls === 'peasant' || L.cls === 'tenant') && L.land < 15) {
        if (R() < fx.tt) P.queue.push({ key: 'tt', q: '官府が流民を募って屯田をさせていた。田と牛を与え、収穫は官が六、民が四。ただし屯に入れば、勝手に離れることはできない。', o: ['屯田に応募する', '行かない'], auto: 0.5 });
      }
    });
    // 城頭易幟：在任者与士人要表態
    if (y > L.by && free && a >= 16 && L.sex === 'M' && !L.eth && (L.office || (L.cls === 'gentry' && a >= 18))) {
      var ofk = ctrl(z, y - 1), nfk = ctrl(z, y);
      if (ofk !== nfk && !SUCC[ofk + '>' + nfk]) {
        var dz = Object.keys(D.CTRL).filter(function (zz) { return zz !== z && ctrl(zz, y) === ofk; });
        var on = oldLordDesc(z, ofk, y), nn = lordName(nfk, y), loose = !!LOOSE[ofk];
        var rc = { key: 'regime', ofk: ofk, nfk: nfk, on: on, nn: nn, dest: dz.length && !loose && ofk !== 'han' ? pick(R, dz) : null };
        if (L.office) {
          rc.q = D.ZONES[z].zhou + 'の主が替わった。' + (loose ? 'この地に割拠していた' + on + 'が追い払われ、城頭には' : on + 'の旗印が城頭から降ろされ、') + '代わりに' + nn + 'の旗印が掲げられた。あなたはもともと' + (loose ? '郡府' : on + 'の治下') + 'の' + L.office + 'で、' + nn + 'の遣わした使者が、すでに門前に来ていた。';
          rc.o = ['門を開いて出迎え、戸籍の簿書を献上する', '印綬を返して去り、郷里で門を閉ざす'];
          rc.w = [5 + (L.tr.cau - 50) / 10, 1.5 + (L.tr.per - 50) / 20];
          if (rc.dest) { rc.o.push('旧主に従い、' + zname(rc.dest) + 'へ身を寄せる'); rc.w.push(0.8 + (L.tr.ind - 50) / 25); }
        } else {
          rc.q = D.ZONES[z].zhou + 'の主が替わった。' + nn + 'の配下が郡中で名士を探し求めており、あなたの家にも一通の書状が届いた。';
          rc.o = ['新しい主に書を送り、仕官の道を求める', '門を閉ざして客を断り、しばらく様子を見る'];
          rc.w = [2 + (L.tr.ind - 50) / 20, 2 + (L.tr.cau - 50) / 20];
        }
        rc.w = rc.w.map(function (x) { return Math.max(0.2, x); });
        P.queue.push(rc);
      }
    }
    // 月旦評与相人
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
        P.queue.push({ key: 'appraise', ap: ap, q: ap.intro + (ping ? (L.cls === 'gentry' ? '一族の長老たちは、評語をひとつもらってこいと勧めた。' : 'あなたも行ってみろと勧める者がいた。彼にひとこと褒められれば名が上がり、ひとこと貶されればそれで終わりだ。') : '村の者たちはこぞって彼に人相を見てもらいに行った。'),
          o: ping ? ['訪ねて評語を求める', '行かない'] : ['自分も見てもらう', '行かない'], w: ping ? [3 + (L.tr.ind - 50) / 15, 2 + (L.tr.cau - 50) / 15] : [2, 2] });
      });
      L.apQ = false;
    }
    // 歴史人物
    D.MEETS.forEach(function (m, i) {
      if (L.meetDone[i] || !meetOK(L, m, y)) return;
      // 遠遠一見只看機縁（住在城里更容易碰上）；近身的交集才看身份
      var near = m.q || m.elite || m.off || m.lit;
      var mul = (m.sol ? 1 : near ? statusMul(L) : clamp(Math.sqrt(statusMul(L)), 1, 2) * (L.urban ? 1.4 : 1)) * (L.lastFocus === 'travel' ? 1.6 : L.lastFocus === 'social' ? 1.2 : 1);
      if (R() >= Math.min(0.6, m.p * mul)) return;
      if (m.q) {
        var c = { key: 'meet', mi: i, q: m.q, o: m.o.map(function (x) { return x[0]; }), auto: 0.5 };
        P.queue.push(c);
      } else P.dec.sights.push(i);
    });
    // 日常選択（不頻繁）
    if (gap && free) {
      var marriedable = !L.married && !L.spouseK;
      if (L.sex === 'M' && marriedable && a >= 16 && a <= 32 && L.cls !== 'slave' && R() < (L.flags.wantWed ? 0.6 : 0.22)) {
        var sps = [makeSpouse(L, y), makeSpouse(L, y), makeSpouse(L, y)];
        P.queue.push({ key: 'marry', sps: sps, q: '仲人がやって来て、一度に三軒の家の娘を勧めてきた。どの娘を娶りたいか？', o: sps.map(spLabel).concat(['どれも気に入らない。もう少し待つ']), w: [2, 2, 2, 1] });
      } else if (L.sex === 'F' && marriedable && a >= 18 && a <= 30 && L.cls !== 'slave' && R() < (L.flags.wantWed ? 0.6 : 0.3)) {
        var sp2 = [makeSpouse(L, y), makeSpouse(L, y)];
        P.queue.push({ key: 'marry', sps: sp2, q: 'あなたはもう' + cnNum(a) + '歳になった。村の人々の目には、とうに嫁いでいるべき年だった。仲人が二軒の家を勧めてきた。', o: sp2.map(spLabel).concat(['どれも気に入らない。もう少し待つ']), w: [2, 2, 1] });
      } else if (L.sex === 'F' && marriedable && a >= 14 && a <= 17 && L.cls !== 'slave' && !L.flags.palaceIn && !(L.flags.wedDelay > y) && R() < 0.35) {
        var sp3 = [makeSpouse(L, y), makeSpouse(L, y)];
        P.queue.push({ key: 'marry', sps: sp3, early: true, q: '父母はあなたのために二軒の家を見つくろい、簾の陰からひと目見させてくれた。そして珍しく、あなたの気持ちを尋ねてくれた。', o: sp3.map(spLabel).concat(['あと二年家に置いてほしいと父母に頼む']), w: [2, 2, 1] });
      } else if (a >= 6 && a <= 9 && !L.schooling && ['peasant', 'artisan', 'merchant', 'tenant', 'soldier', 'tuntian'].indexOf(L.cls) >= 0 && L.wealth >= 15 && R() < 0.12) {
        P.queue.push({ key: 'school', q: '村の老先生が字を教えてくれるという。謝礼は毎年粟一斗。父母は行きたいかとあなたに尋ねた。', o: ['学びに行く', '家の仕事を手伝う'], auto: 0.5 });
      } else if (a >= 16 && a <= 35 && L.learn >= 35 && !L.office && L.sex === 'M' && R() < 0.25 * polMul(z, y, 'career')) {
        P.queue.push({ key: 'clerk', q: '県で書佐がひとり欠けており、県丞が県廷に勤めないかとあなたに尋ねた。', o: ['県廷へ行く', '家に残る'], auto: 0.6 });
      } else if (L.sex === 'M' && a >= 16 && a <= 38 && ((y >= 186 && y <= 235) || y >= 291) && ['peasant', 'tenant', 'artisan', 'clerk', 'merchant'].indexOf(L.cls) >= 0 && R() < (L.flags.martial || L.found.strength ? 0.25 : 0.1)) {
        P.queue.push({ key: 'recruit', q: fname(ctrl(z, y), y) + 'の軍が郡で兵を募っていた。応じた者には毎月糧が支給される。', o: ['応募して従軍する', '家に残る'], auto: 0.3 });
      } else if (a >= 18 && y >= 190 && y <= 205 && ['yu', 'yan', 'xu', 'luoyang', 'guanzhong', 'qing'].indexOf(z) >= 0 && R() < 0.1) {
        var md = pick(R, ['jingbei', 'jingnan', 'jiangdong', 'liaodong', 'shu', 'jiao']);
        P.queue.push({ key: 'migrate', dest: md, info: compareText(L, y, md), q: '聞けば、' + zname(md) + 'のあたりはまだ比較的平穏だという。村ではすでに何軒もの家が、戦乱を避けて南へ（あるいは北へ）移っていった。', o: [zname(md) + 'へ移る', '故郷に留まる'], auto: 0.25 });
      }
    }
    // 性情的種子
    if (a === 3 || a === 5) {
      var sk = a === 3 ? 'seed1' : 'seed2', sd = SEEDS[sk], tw = sd.w(L.tr), sv = SEED_V[sk][L.seedV = seedVar(L, y)] || sd;
      P.queue.unshift({ key: sk, q: sv.q, o: sv.o, w: tw.map(function (x) { return x * x; }), hint: 'これは幼い頃のあなたの姿。正解も間違いもない。', narr: true });
    }
    // 家計危機
    if (L.crisis && free && L.cls !== 'slave') {
      L.crisis = false;
      var E = L.eco, opts = [], keys = [], w = [];
      var n = Math.min(L.land, Math.ceil(E.debt / (LANDP * 0.7)) + 1);
      if (L.land >= 3) { opts.push('田を' + cnNum(n) + '畝売る'); keys.push('sell'); w.push(1 + (L.tr.cau - 50) / 30); }
      opts.push('もう少し借金をして今年を乗り切る'); keys.push('borrow'); w.push(1 + (L.tr.ind - 50) / 40);
      var lab = laborCandidate(L, y);
      var bf = bestFriend(L, 65);
      if (bf && L.age >= 16) { opts.push('友人の' + bf.name + 'に助けを求める'); keys.push('friend'); w.push(1 + (L.tr.soc - 50) / 40); }
      if (lab) { opts.push(lab === 'self' ? '自分が出稼ぎに出る' : '' + kinLabel(L, lab) + 'を出稼ぎに出す'); keys.push('labor'); w.push(1.2); }
      if (['peasant', 'clerk', 'soldier', 'artisan', 'tuntian'].indexOf(L.cls) >= 0) { opts.push('豪族に身を寄せ、その佃客になる'); keys.push('kin'); w.push(0.8 + (L.tr.soc - 50) / 40); }
      var fd = pick(R, ['jingbei', 'jingnan', 'jiangdong', 'shu', 'jiao', 'liaodong'].filter(function (q) { return q !== z; }));
      opts.push('一家で' + zname(fd) + 'へ逃げ、借金取りから逃れる'); keys.push('flee'); w.push(0.2 + (L.tr.ind - 50) / 60);
      var dec2 = a >= 16;
      var who = dec2 ? null : (L.kin[0].alive && !L.kin[0].apart ? '父親' : '母親');
      P.queue.push({ key: 'crisis', info: fd ? compareText(L, y, fd) : null, q: '家計は火の車で、いまや借金は' + fmt(E.debt) + '銭相当に達していた。' + (E.cash < 300 ? '蓄えの穀物も底をつきかけている。' : '借金取りがもう何度も催促に来ている。') + (dec2 ? '' : who + 'は心配で夜も眠れずにいる。'),
        o: opts, keys: keys, w: w.map(function (x) { return Math.max(0.1, x); }), n: n, lab: lab, dest: fd, who: who, forced: !dec2 });
    }
    // 幕府倒台：依附的勢力敗亡，幕僚各奔東西
    if (L.office === '幕僚' && free && a >= 18 && !P.queue.some(function (q) { return q.key === 'regime'; })) {
      if (!L.lordFk) L.lordFk = ctrl(z, y);
      var lfk = L.lordFk;
      while (LORD_END[lfk] && y >= LORD_END[lfk] && LORD_NEXT[lfk]) L.lordFk = lfk = LORD_NEXT[lfk];
      if (LORD_END[lfk] && y >= LORD_END[lfk] && y <= LORD_END[lfk] + 1) {
        var nk = ctrl(z, y), nnm = lordName(nk, y);
        P.queue.push({ key: 'lordfall', ofk: lfk, nfk: nk, q: 'あなたが仕えていた' + lordName(lfk, y) + 'が滅んだ。幕府の人々は散り散りになり、新しい主に仕える者、郷里に帰る者、最後まで旧主に従う者もいた。', o: [nnm + 'に身を寄せる', '郷里に帰って隠棲する', '旧主への節義を守り、出仕を拒む'],
          w: [Math.max(0.3, 1.5 + (L.tr.ind - 50) / 30), Math.max(0.3, 1 + (L.tr.cau - 50) / 30), Math.max(0.2, 0.5 + (L.tr.per - 50) / 30)] });
      }
    }
    // 迴響：年軽時的選択，多年後回来找你
    if (free) memCheck(L, y, P);
    battleChoice(L, y, P);
    if (free) civWarChoice(L, y, P);
    if (free) hobbyChoice(L, y, P);
    if (free) pathChoice(L, y, P);
    if (free) famousConcChoice(L, y, P);
    if (free) youthChoice(L, y, P);
    if (free) wedFigChoice(L, y, P);
    // 人生抉択：身份越高，越常遇到需要拿主意的事
    var lc = lifeChoice(L, y, free);
    if (lc) P.queue.push(lc);
    // 児子要銭
    if (gap && free && isHead(L) && a >= 40) {
      var son = liveKin(L, function (k) { return k.rel === 'child' && k.sex === 'M' && !k.out && !k.soldier && y - k.by >= 18; })[0];
      if (son && L.eco.cash - reserve(L) >= 3500 && R() < 0.1) {
        P.queue.push({ key: 'sonAsk', son: son, q: '息子の' + son.name + 'が、県で商売をしたいから三千銭ほしいと言ってきた。', o: ['与える', '与えない'], auto: L.tr.soc > L.tr.cau ? 0.6 : 0.35 });
      }
    }
    if (L.soldier && !L.band && a >= 18 && R() < 0.035) {
      P.queue.push({ key: 'desert', q: '軍中で疫病が流行り、糧食と俸給はもう三か月も滞っている。夜のうちに一緒に逃げようと誘う者がいた。', o: ['夜陰に乗じて逃げる', '陣営に残る'], auto: 0.2 });
    }
    return P;
  }

  function makeSpouse(L, y) {
    var R = L.R, sex = L.sex === 'M' ? 'F' : 'M';
    var age = L.sex === 'M' ? clamp(L.age - Math.floor(R() * 7), 14, 40) : L.age + Math.floor(R() * 9);
    var sur = L.eth && !D.ETH[L.eth].sur ? '' : surname(R, L.cls);
    if (sur === L.sur) sur = surname(R, L.cls);
    var given = L.eth ? ethName(R, L.eth).given : safeGiven(R, sur, sex, tierOf(L.cls));
    var from = pick(R, ['隣村', '同じ里', '隣県', '本県の' + pick(R, D.VILLAGES) + '里']);
    var descs = sex === 'M' ? ['痩せた田を数畝持つ家', '実直な百姓', '父親は大工', '暮らし向きはあなたの家より少し良い', 'あなたより数歳年上で、人柄はまずまず真面目'] : ['手先が器用で、機織りができる', '兄弟が多い', '気立てが穏やか', '暮らし向きはあなたの家と同じくらい'];
    if (L.cls === 'gentry') { var oj = pick(R, D.JUN)[0].replace(/(郡|国|尹)$/, ''); from = oj + sur + '氏'; descs = L.gate >= 3 ? ['家格はあなたの家と同等', '先祖に太守を務めた者がいる', '家に万巻の書を蔵する'] : ['これも郡中の名族', '数百頃の田を持つ', '父や兄はみな州郡に仕えている']; }
    var hc = L.sex === 'F' ? spouseCls(L, y) : null;
    if (hc && hc !== L.cls && HDESC[hc]) { descs = HDESC[hc]; if (hc === 'gentry') from = pick(R, D.JUN)[0].replace(/(郡|国|尹)$/, '') + sur + '氏'; }
    return { sex: sex, age: age, sur: sur, given: given, name: sur + given, from: from, desc: pick(R, descs), cls: hc };
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
    if (!L.auto && !L.skip && !c.forced) (L.choiceLog = L.choiceLog || []).push({ y: L.by + L.age, q: c.q, a: lbl, narr: !!c.narr });
    P.chosen = P.chosen || [];
    P.chosen.push({ q: c.q, a: lbl, key: c.key });
    switch (c.key) {
      case 'flee': d.flee[c.ev] = { go: i === 0, dest: c.dest, rich: !!c.rich, fort: !!c.rich && i === 1 }; break;
      case 'join': d.join = i === 0; break;
      case 'tt': d.tt = i === 0; break;
      case 'sell': d.sell = i === 0; break;
      case 'marry':
        if (c.sps) {
          if (i < c.sps.length) d.marry = c.sps[i];
          else if (c.early) { if (L.R() < 0.5) { L.flags.wedDelay = L.by + L.age + 2; d.wedDelayOk = true; } else { d.marry = c.sps[0]; d.wedForced = true; } }
          else d.marry = null;
        } else d.marry = i === 0 ? c.sp : null;
        break;
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
      case 'seed1': case 'seed2': applySeed(L, c.key, i); d.seedText = (SEED_V[c.key][L.seedV] || SEEDS[c.key]).t[i]; break;
      case 'crisis': d.crisis = { c: c, k: c.keys[i] }; break;
      case 'sonAsk': d.sonAsk = { give: i === 0, son: c.son }; break;
      case 'life': d.life = { c: c, i: i }; break;
      case 'appraise': if (i === 0) { d.appraise = c.ap; L.apAsk = true; } else L.appraised = true; break;
      case 'regime': d.regime = { c: c, i: i }; break;
      case 'mem': d.memC = { mi: c.mi, i: i }; break;
      case 'lordfall': d.lordfall = { c: c, i: i }; break;
      case 'fconc': d.fconc = { c: c, i: i }; break;
      case 'yfr': d.yfr = { c: c, i: i }; break;
      case 'bpov': L.bpovDec = { k: c.pk, i: i }; break;
      case 'crimeAfter': d.crimeAfter = i; break;
      case 'hh': d.hh = { c: c, i: i }; break;
      case 'maid': d.maid = { c: c, i: i }; break;
      case 'cfate': d.cfate = { c: c, i: i }; break;
      case 'hobby': d.hobby = { c: c, i: i }; break;
      case 'path': d.path = { c: c, i: i }; break;
      case 'civwar': d.civwar = { c: c, i: i }; break;
      case 'wfig': d.wfig = { c: c, i: i }; break;
      case 'purge': (d.purge = d.purge || {})[c.ev] = { i: i, tie: c.tie, pn: c.pn }; break;
    }
  }

  /* ================= 推進一年 ================= */
  function step(L) {
    if (!L.alive) return null;
    var y = L.by + L.age;
    if (!L.pre) L.pre = prepare(L, y);
    var P = L.pre;
    while (P.queue.length) {
      var c = P.queue[0];
      if (c.answer === undefined) {
        if (L.auto || L.skip || c.forced) c.answer = autoPick(L, c);
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

    // 政権更替
    var fk = rec.ctrl;
    if (L.regimes[L.regimes.length - 1] !== fk) {
      if (a > 0) {
        add(L, 0.02, 'note', fk === 'warlords' ? 'あなたの住む' + D.ZONES[L.zone].zhou + 'は群雄割拠に陥り、' + (WARLORD_DESC[L.zone] || '各地の豪族') + 'がそれぞれ一方に拠っていた。' : 'あなたの住む' + D.ZONES[L.zone].zhou + 'は、いまや' + fname(fk, y) + 'の支配下にあった。');
        var pfk = L.regimes[L.regimes.length - 1];
        if (pfk && ctrl(L.zone, y - 1) === pfk && !SUCC[pfk + '>' + fk] && !dec.regime && L.cls !== 'gentry' && !L.office && !L.soldier) add(L, 0.03, 'life', pick(R, D.WHEEL[inPal(L) ? 'palace' : L.cls === 'slave' ? 'slave' : L.cls === 'merchant' ? 'merchant' : 'poor']));
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
    if (dec.lordfall) lordFallOutcome(L, y, dec.lordfall.c, dec.lordfall.i);
    if (dec.fconc) famousConcOutcome(L, y, dec.fconc.c, dec.fconc.i);
    if (dec.yfr) youthOutcome(L, y, dec.yfr.c, dec.yfr.i);
    if (dec.civwar) civWarOutcome(L, y, dec.civwar.c, dec.civwar.i);
    if (dec.crimeAfter != null) crimeAfter(L, y, dec.crimeAfter);
    if (dec.hh) hhOutcome(L, y, dec.hh.c, dec.hh.i);
    if (dec.maid) maidOutcome(L, y, dec.maid.c, dec.maid.i);
    if (dec.cfate) consortOutcome(L, y, dec.cfate.c, dec.cfate.i);
    if (dec.hobby) hobbyPick(L, y, dec.hobby.c, dec.hobby.i);
    if (dec.path) pathOutcome(L, y, dec.path.c.ks[dec.path.i]);
    planYear(L, y);
    if (dec.wfig) wedFigOutcome(L, y, dec.wfig.c, dec.wfig.i);
    if (!L.alive) return finishYear(L, rec);
    concLifeYear(L, y);
    husbandYear(L, y);
    condYear(L, y);
    hobbyYear(L, y);
    crimeYear(L, y);
    affairYear(L, y);
    clanYear(L, y);
    civWarYear(L, y);
    youthNews(L, y);
    wedFigYear(L, y);
    if (!L.alive) return finishYear(L, rec);
    if (!L.alive) return finishYear(L, rec);
    if (dec.appraise) appraise(L, y, dec.appraise);
    if (!L.alive) return finishYear(L, rec);
    if (L.band) bandYear(L, y);

    // 本年的歴史事件
    (EV_BY_Y[y] || []).forEach(function (ev) {
      if (!L.alive) return;
      var fx = localFx(L, ev, L.zone, y);
      if (!fx) { farOrRumor(L, ev, y); return; }
      if (fx._skip) return;
      applyFx(L, ev, fx, dec, y);
    });
    if (!L.alive) return finishYear(L, rec);

    // 遷徙選択
    if (dec.migrate) relocate(L, dec.migrate, 1.2, '一家は持てるだけの物をまとめ、同郷の人々と共に{dest}へ移った。', 0.03, y);
    // 伝聞
    L.rumors = L.rumors.filter(function (r) {
      if (r.y <= y) { add(L, Math.floor(R() * 4) + 0.5, 'rumor', r.t); return false; }
      return true;
    });

    // 歴史人物
    if (dec.meet != null) meetHappen(L, dec.meet, y, 1.0, dec.meetOut);
    if (!L.alive) return finishYear(L, rec);
    dec.sights.forEach(function (i) { meetHappen(L, i, y, 1 + R() * 2); });
    eliteMeet(L, y);
    youthFriend(L, y);
    if (dec.follow) joinBand(L, dec.follow, y);

    // 軍旅
    if (dec.join) {
      L.soldier = { army: 'yellow', since: y }; L.job = '黄巾';
      add(L, 0.3, 'war', 'あなたは頭に黄巾を巻き、太平道の軍勢に加わった。');
    }
    if (dec.recruit) enlist(L, y, 1.1, true);
    if (dec.desert && L.soldier) desert(L, y);
    if (L.soldier && !L.band) soldierYear(L, y);
    if (!L.alive) return finishYear(L, rec);

    lifeStage(L, y, dec);
    if (!L.alive) return finishYear(L, rec);

    kinYear(L, y);
    famousWidow(L, y);
    if (!L.alive) return finishYear(L, rec);
    kinRelYear(L, y);
    friendsYear(L, y);
    economyYear(L, y);
    if (!L.alive) return finishYear(L, rec);

    // 本人基礎死亡率
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
        add(L, s, 'meet', '病で息も絶え絶えになっていたとき、旅の医者が通りかかり、鍼を打ち薬を与えてくれた。あなたは奇跡的に命をとりとめた。後になって、その人が華佗という名だと知った。');
        markMet(L, 'huatuo', y, '華佗はかつてあなたの命を救った。');
        L.body = clamp(L.body - 5, 5, 100);
      } else die(L, cause, s, { a: cnNum(a) });
    }
    return finishYear(L, rec);
  }

  var YEAR_MAX = 350;
  function finishYear(L, rec) {
    if (L.alive && rec.y >= YEAR_MAX) {
      var ft = rec.y + '年以降、あなたの名は戸籍から消えた。あるいはそれからも長く生き、北方の戦乱の中か江南の軒下で生涯を終えたのかもしれない——ただ、このシミュレーションが描くのはこの年までだ。';
      var fe = add(L, 3.95, 'death', ft);
      L.alive = false; L.cause = 'fade'; L.causeText = ft; L.deathS = 3.95; L.deathI = fe.i; L.dy = rec.y; rec.death = true;
    }
    if (!L.alive) {
      rec.entries = rec.entries.filter(function (e) { return e.k === 'death' || e.s < L.deathS || (e.s === L.deathS && e.i < L.deathI); });
    } else {
      // 無事之年
      var personal = rec.entries.filter(function (e) { return e.k !== 'far' && e.k !== 'rumor' && e.k !== 'note'; });
      if (rec.major || personal.length === 0) {
        var d = daily(L, rec.y);
        if (d) add(L, rec.major ? 2.6 : 1.5 + L.R() * 2, 'life', rec.major ? 'この年あなたは' + cnNum(L.age) + '歳。' + d.replace(/。$/, '') + '。' : d);
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
    var where = D.ZONES[L.zone].zhou + D.JUN[L.jun][0] + L.county + (L.urban ? '県城' : '') + L.village;
    var desc = L.eth ? D.ETH[L.eth].tribe : C.desc;
    if (L.eth) where = D.ZONES[L.zone].zhou + D.JUN[L.jun][0] + '境内の山野';
    add(L, 0, 'life', 'あなたは' + where + 'で生まれた。' + desc + '。');
    var sibs = L.kin.filter(function (k) { return k.rel === 'sib'; }).length;
    var t = sibs === 0 ? 'あなたは家の最初の子だった。' : 'あなたの上には兄や姉が' + cnNum(sibs) + '人いた。';
    if (L.olderDead > 0) t += '母は他にも' + cnNum(L.olderDead) + '人の子を産んでいたが、みな育たなかった。';
    add(L, 0.05, 'fam', t);
    if (L.flags.posthumous) add(L, 0.1, 'fam', 'あなたが生まれる前に、父は乱兵の手にかかって死んだ。');
    if (L.flags.motherDied) add(L, 0.12, 'fam', '母はあなたを産んで間もなく亡くなった。');
    if (L.cls === 'slave') add(L, 0.15, 'note', '律令によれば、奴婢の産んだ子もまた奴婢である。あなたの名は主人の家の簿籍に、牛馬と並んで書き込まれた。');
    add(L, 0.2, 'fam', L.sex === 'M' ? '父母はあなたに' + L.xiao + 'という幼名をつけた。' : '大人たちはあなたを' + L.xiao + 'と呼んだ。');
  }

  /* ---------- 遠方大事与伝聞 ---------- */
  var FAR_ARMY = ['この知らせは、たちまち軍中に広まった。', '陣営の者たちは何日もこの話でもちきりだった。次は自分たちの番だ、と言う者もいた。', '伍長が将軍の幕舎の前から戻ってきて、この知らせをみなに伝えた。'];
  // 军中之人：本军这一年正在打仗，战报就是自己身边的事，不再写成远方的传闻
  function onCampaign(L, ev, y) { return !!(L.soldier && !L.band && ev.at && (CAMP_BY_Y[y] || []).some(function (c) { return c.a.indexOf(L.soldier.army) >= 0; }) && Object.keys(ev.at).some(function (z) { return ev.at[z] && ev.at[z].war; })); }
  function farOrRumor(L, ev, y) {
    var R = L.R;
    if (onCampaign(L, ev, y)) { if (ev.major) L.rec.major = true; return; }
    if (ev.major && ev.far && L.age >= 0) {
      var dir = dirWord(L.zone, ev.o);
      add(L, ev.s + 0.05, 'far', (ev.farE && eliteView(L) && L.age >= 10 ? ev.farE : ev.far).replace('{dir}', dir));
      L.rec.major = true;
      if (L.age >= 5) add(L, ev.s + 0.06, 'far2', inHH(L) ? pick(R, L.flags.fcPal ? FAR_HH.gong : FAR_HH.fu) : L.soldier && !L.band ? pick(R, FAR_ARMY) : L.office ? pick(R, ['知らせはすぐに官署に届き、あなたもその軍報を読んだ。', '官署ではこの件で何日も議論が続いた。']) : L.cls === 'gentry' && L.age >= 12 ? pick(R, ['一族にはすぐに知らせが届いた。', '家の食客が知らせを持ち帰り、年長者たちは長いこと話し合った。']) : pick(R, ['あなたは関わらなかった。', 'あなたはこのことを何も知らなかった。', 'それらは、あなたからは遠い出来事だった。']));
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

  /* ---------- 地方効果 ---------- */
  function applyFx(L, ev, fx, dec, y) {
    var R = L.R, s = ev.s + 0.1, a = L.age;
    if (fx.t) add(L, s, 'hist', fx.t2 && eliteView(L) && a >= 10 ? fx.t2 : fx.t);
    var fled = false, moved = false, dest = null;
    if (fx.flee) {
      var f = dec.flee[ev.id];
      if (f) { fled = f.go; dest = f.dest; if (f.fort) { L.yFort = true; add(L, s + 0.02, 'life', '一家は塢壁の門を固く閉ざし、部曲が壁に上って夜通し見張った。'); } if (f.rich && f.go) L.yCart = true; }
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
    if (fx.war && L.sex === 'F' && a >= 14 && a <= 35 && !fled && !L.yFort && L.cls !== 'gentry' && !inHH(L) && R() < fx.war * 3) {
      var dz = pick(R, ['bing', 'liang', 'you', 'guanzhong', 'jiangdong', 'jingnan'].filter(function (q) { return q !== L.zone; }));
      liveKin(L).forEach(function (k) { k.apart = true; });
      if (L.spouseK) { L.married = false; L.spouseK = null; }
      relocate(L, dz, s + 0.07, '乱兵が村の若い女たちを大勢さらっていき、あなたもその中にいた。あなたは無理やり{dest}まで連れて行かれ、それきり家族に会うことはなかった。', 0.05, y);
      L.flags.abducted = y; L.cls = L.cls === 'slave' ? 'slave' : 'tenant';
      if (!L.alive) return;
    }
    var rk = fx.war ? 'war' : fx.fam ? 'fam' : fx.plag ? 'plag' : null;
    if (rk && a >= 5 && D.REACT && R() < 0.85) {
      var bk = L.cls === 'slave' ? 'slave' : L.cls === 'gentry' ? 'gentry' : L.office ? 'official' : L.cls === 'merchant' ? 'merchant' : L.eth ? 'tribal' : L.cls === 'tenant' && D.REACT[rk].tenant && R() < 0.5 ? 'tenant' : 'poor';
      var pool = inHH(L) || inPal(L) ? REACT_HH[rk][L.flags.fcPal || inPal(L) ? 'gong' : 'fu'] : D.REACT[rk][bk] || D.REACT[rk].poor;
      add(L, s + 0.06, 'life', fresh(L, pool));
    }
    if (fx.m15) {
      var mm = D.JUN[L.jun][0] === '遼東郡' ? 1.6 : 0.3;
      if (L.sex === 'M' && a >= 15 && R() < fx.m15 * mm) { die(L, 'massacre', s + 0.05); return; }
      liveKin(L, function (k) { return k.sex === 'M' && ageOf(L, k, y) >= 15; }).forEach(function (k) { if (R() < fx.m15 * mm) kinDie(L, k, 'massacre', s + 0.04, y); });
    }
    if (fx.purge && dec.purge && dec.purge[ev.id]) {
      var pd = dec.purge[ev.id], pr = [0.33, 0.33, 0.12][pd.i];
      if (pd.i === 0) {
        if (R() < 0.25) { add(L, s + 0.03, 'bad', '城を出る前に門番の兵に見破られ、城内へ引き戻された。'); pr = 0.6; }
        else {
          var fz = ['jiangdong', 'liaodong', 'jingnan', 'shu', 'liang'].filter(function (q) { return q !== L.zone && group(ctrl(q, y)) !== group(ctrl(L.zone, y)); });
          if (L.office) { L.office = null; L.job = L.cls === 'gentry' ? '士人' : '農'; }
          if (fz.length) relocate(L, pick(R, fz), s + 0.03, 'あなたは官職と家産の大半を捨て、妻子を連れて夜のうちに城を出て、{dest}まで逃げ延びた。', 0.03, y);
          pr = 0;
        }
      } else if (pd.i === 2) { L.fame -= 6; L.standing -= 4; add(L, s + 0.03, 'life', 'あなたは上書して自ら申し開きをし、' + pd.pn + 'との付き合いを洗いざらい打ち明け、さらに何人かの旧友の名を挙げた。そのために投獄された者もいた。'); }
      if (R() < pr) { die(L, 'executed', s + 0.05, { full: pd.pn + 'の一件は連座が広く及んだ。ある者があなたの過去を掘り起こした——' + pd.tie + '。あなたは捕らえられて獄に下され、一族と共に殺された。' }); return; }
      L.purgeLog = { pn: pd.pn, i: pd.i, y: y };
      if (pd.i === 1) add(L, s + 0.04, 'life', '門を閉ざして処分を待つこと数か月。騒ぎはしだいに収まり、あなたの家は幸いにも連座を免れた。');
      else if (pd.i === 2) add(L, s + 0.04, 'life', '命と家業は守られた。ただそれからというもの、昔の友人たちはあなたを見かけると道を避けるようになった。');
    }
    if (fx.loss) {
      var fr = Math.min(0.9, fx.loss / 100 * (0.6 + R() * 0.8) * (L.cls === 'gentry' ? 0.6 : 1));
      L.eco.cash = Math.round(L.eco.cash * (1 - fr));
      if (fx.loss >= 20 && L.eco.ox > 0 && R() < 0.3) { L.eco.ox--; add(L, s + 0.03, 'bad', '家の耕牛が乱兵に連れ去られた。'); }
    }
    if (fx.gain) L.eco.cash += fx.gain * 150;
    if (fx.fame) L.fame += fx.fame;
    if (fx.conscript) L.yConscript += fx.conscript;
    if (dec.tt && fx.tt) {
      L.cls = 'tuntian'; L.job = '屯田客'; L.land = 0;
      add(L, s + 0.2, 'life', '一家は応募して屯田客となり、官田を分け与えられ、官牛も一頭借りることができた。');
      dec.tt = false;
    }
    if (fled || moved) {
      var txt = fled ? (fx.ft || '一家は避難する人々の群れに混じって、{dest}へ向かった。') : (fx.mt || '一家は官府によって{dest}へ強制的に移された。');
      if (fled && a < 14) txt = '父母は逃げることを決めた。' + txt;
      if (L.yCart) txt = '一家は数台の車に金目の物を積み、僮僕を連れて{dest}へ向かった。';
      relocate(L, dest, s + 0.2, txt, (fx.mr || 0.03) * (L.yCart ? 0.3 : 1), y);
      if (!L.alive) return;
      if (fled && fx.fn === 'changban') changban(L, y, s + 0.3);
    }
    if (fx.fn && SPECIAL[fx.fn]) SPECIAL[fx.fn](L, fx, s, y, fled);
  }

  function relocate(L, dest, s, text, risk, y) {
    friendsApart(L, 'あなたが故郷を離れてから、音信は途絶えた');
    var R = L.R, a = L.age;
    var ji = pickJun(R, y, { zones: [dest] });
    var oldZone = L.zone;
    setPlace(L, ji);
    L.moves++; L.places.push(dest);
    add(L, s, 'move', fill(text, { dest: zname(dest) + 'の' + D.JUN[ji][0] }));
    L.rec.tags.push('move');
    var p = risk * (a < 5 || a > 60 ? 2 : 1) * bodyMul(L);
    if (R() < p) { die(L, 'road', s + 0.05); return; }
    liveKin(L).forEach(function (k) {
      var ka = ageOf(L, k, y);
      if (k.out) { k.apart = true; return; }
      if (R() < risk * (ka < 5 || ka > 60 ? 2 : 1)) kinDie(L, k, 'road', s + 0.04, y);
    });
    // 新地方的生計
    L.eco.cash = Math.round(L.eco.cash * (L.yCart ? 0.8 : 0.5)); L.eco.ox = 0; L.eco.house = Math.min(L.eco.house, L.cls === 'gentry' ? 20000 : 1500);
    if (['peasant', 'clerk'].indexOf(L.cls) >= 0) {
      L.land = 0;
      if (R() < 0.6) { L.cls = 'tenant'; L.job = L.job === '農' ? '佃戸' : L.job; add(L, s + 0.1, 'bad', '新しい土地では田がなく、一家はやむなく土地の豪族に身を寄せて佃客となった。'); }
      else { L.cls = 'peasant'; L.land = 10 + Math.floor(R() * 20); add(L, s + 0.1, 'life', '官府は荒れ地を流民に分け与え、一家は' + cnNum(L.land) + '畝を受け取った。'); }
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
        if (L.sex === 'M' && L.age >= 16 && L.age <= 45 && !L.soldier) { L.soldier = { army: 'wu', since: y }; L.job = '軍卒'; add(L, s + 0.3, 'war', 'あなたたちの宗部は山を下りることを余儀なくされた。孫家の決まりは「強者為兵，羸者補戸（強き者は兵に、弱き者は戸籍に）」——あなたは呉の軍に編入された。'); }
        else add(L, s + 0.3, 'move', 'あなたたちの宗部は山を下りることを余儀なくされた。一家は平地の戸籍に組み入れられ、以後は官府に租を納め、役に服さねばならなくなった。');
      }
    },
    wuhuan: function (L, fx, s, y) {
      if (L.eth !== 'wuhuan' || !L.alive) return;
      if (L.R() < 0.5) {
        relocate(L, 'ji', s + 0.3, '曹の軍が烏桓を破った。あなたたちの部落は中原へ移され、{dest}に住まわされた。', 0.04, y);
        if (L.alive && L.sex === 'M' && L.age >= 16 && L.age <= 45) { L.soldier = { army: 'wei', since: y }; L.job = '騎卒'; add(L, s + 0.4, 'war', '烏桓の騎手たちは曹の軍に編入され、「天下名騎（天下の名騎）」と称された。あなたもその一人だった。'); }
      }
    },
    di219: function (L, fx, s, y) {
      if (L.eth === 'di' && L.alive && L.zone === 'hanzhong' && L.R() < 0.7) relocate(L, 'guanzhong', s + 0.3, '曹の軍は武都の氐人を関中へ移し、あなたたちの一族は{dest}に住まわされた。', 0.03, y);
    },
    nanzhong: function (L, fx, s, y) {
      if (L.eth === 'yi' && L.alive && L.sex === 'M' && L.age >= 16 && L.age <= 40 && L.R() < 0.08) {
        relocate(L, 'shu', s + 0.3, '諸葛丞相は南中の精兵である青羌一万余家を蜀中へ移し、「飛軍」に編成した。あなたもその中に組み入れられ、{dest}へ移った。', 0.03, y);
        if (L.alive) { L.soldier = { army: 'shu', since: y }; L.job = '軍卒'; }
      }
    },
    yizhou: function (L, fx, s, y) {
      if (L.soldier && L.soldier.army === 'wu' && L.R() < 0.15) {
        add(L, s + 0.2, 'war', 'あなたは海を渡る甲士の一人に選ばれた。船団は一年にわたって海上をさまよい、夷洲という地にたどり着いた。');
        if (L.R() < 0.75) die(L, 'plag', s + 0.5);
        else add(L, 3.5, 'war', '「軍行経歳，士衆疾疫死者十有八九」（軍は一年を費やし、兵の八、九割が疫病で死んだ）。あなたは生きて帰った数少ない者の一人だった。');
      }
    },
    marry273: function (L, fx, s, y) {
      if (L.sex === 'F' && L.age >= 17 && L.age <= 30 && !L.married && !L.spouseK && L.alive && !inPal(L)) {
        add(L, s + 0.1, 'life', '朝廷が詔を下した。娘が十七になっても父母が嫁がせない場合は、官府が縁組をするという。');
        doMarry(L, makeSpouse(L, y), y, s + 0.2, '官府があなたの縁組を決めた。');
      }
    },
    demob280: function (L, fx, s, y) {
      if (L.soldier && (L.soldier.army === 'jin' || L.soldier.army === 'wei') && L.R() < 0.6) {
        L.soldier = null; L.job = L.cls === 'soldier' ? '農' : (L.job === '軍卒' ? '農' : L.job);
        add(L, s + 0.2, 'good', '天下は統一され、朝廷は「罷州郡兵（州郡の兵を廃す）」と命じた。あなたは甲冑を脱ぎ、家に帰って畑を耕した。');
      }
    }
  };

  function changban(L, y, s) {
    var R = L.R;
    add(L, s, 'meet', '避難する人の流れの中で、あなたは劉備が馬上で何度も振り返るのを見た。民を捨てて先に行けと勧める者がいたが、彼は言った。「今人帰吾，吾何忍棄去！（今、人々が私を頼ってきているのに、どうして見捨てられようか）」');
    markMet(L, 'liubei', y, 'あなたはかつて劉備と共に南へ逃れた。');
    if (R() < 0.15) {
      add(L, s + 0.2, 'meet', '乱戦のさなか、一人の将が赤子を抱いて単騎であなたのそばを駆け抜けていった。後になって知った。あれは趙雲で、抱いていたのは劉備の子、阿斗だったのだと。');
      markMet(L, 'zhaoyun', y, '長坂の乱戦の中、趙雲があなたのそばを駆け抜けていった。');
    }
  }

  /* ---------- 歴史人物 ---------- */
  function markMet(L, id, y, ach) {
    if (!L.met[id]) { L.met[id] = y; L.meetLog.push({ id: id, y: y, ach: ach }); }
  }
  function meetHappen(L, i, y, s, out) {
    var m = D.MEETS[i];
    L.meetDone[i] = true;
    var title = y < 219 ? '左将軍' : y < 221 ? '漢中王' : '皇帝';
    if (m.t) add(L, s, 'meet', fill(m.t, { title: title }));
    var fig = D.FIGURES.filter(function (f) { return f.id === m.f; })[0];
    markMet(L, m.f, y, 'あなたはかつて' + (m.follow ? '郷里で' : '') + fig.n + 'を見たことがある。');
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
    L.job = '軍卒';
    liveKin(L).forEach(function (k) { k.apart = true; });
    add(L, 1.3, 'war', 'あなたは家族に別れを告げ、' + B.who + 'について行った。');
  }
  function bandYear(L, y) {
    var R = L.R, B = D.BANDS[L.band], p = B.path[y];
    if (!p) { endBand(L, y, true); return; }
    L.bandYears[L.band]++;
    if (L.zone !== p[0]) { var ji = pickJun(R, y, { zones: [p[0]] }); setPlace(L, ji); L.places.push(p[0]); L.moves++; }
    add(L, 0.4, 'war', p[2]);
    L.rec.tags.push('band');
    if (R() < p[1] * bodyMul(L) * 1.1) { die(L, 'battle', 0.6, { n: B.who + 'に付き従う道中' }); recordBand(L); return; }
    if (R() < (p[3] || 0.05)) {
      add(L, 0.8, 'bad', '乱戦の中で、あなたは' + B.who + 'の一行とはぐれ、二度と見つけることはできなかった。あなたは' + D.JUN[L.jun][0] + 'に落ち着いた。');
      recordBand(L); L.band = null; L.soldier = null; L.job = '農'; L.cls = L.cls === 'gentry' ? 'gentry' : 'tenant';
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
    if (!silent) add(L, 3.6, 'war', B.after === 'wei' ? 'あなたは曹の軍の古参兵となった。' : B.after === 'shu' ? 'あなたは蜀漢の軍に残り、古参兵となった。' : 'あなたは孫堅の旧部と共に、ひとまず袁術のもとに身を寄せた。');
  }

  /* ---------- 軍旅 ---------- */
  function enlist(L, y, s, voluntary) {
    if (L.cond && L.cond.rev && D.CONDS[L.cond.k].noArmy) { if (!L.flags.longExempt) { L.flags.longExempt = true; add(L, s || 1.2, 'life', 'あなたは「罷癃」の者として、律により兵役を免除された。'); } return; }
    var fk = ctrl(L.zone, y), army = armyOf(fk);
    L.soldier = { army: army, since: y };
    var horse = ['liang', 'bing', 'you'].indexOf(L.zone) >= 0 || L.eth;
    L.job = horse && L.R() < 0.5 ? '騎卒' : L.R() < 0.3 ? '弓手' : '軍卒';
    add(L, s, 'war', (voluntary ? 'あなたは応募して従軍し、' : '官府の徴兵により、あなたは') + '' + fname(fk, y) + 'の軍に編入され、' + L.job + 'となった。');
    if (army === 'wei' && y >= 200) { L.cls = L.cls === 'gentry' ? 'gentry' : 'soldier'; add(L, s + 0.05, 'note', '曹魏の士家制度により、あなたの家族もこれ以後士籍に入れられ、代々兵となり、勝手に移り住むことは許されなくなった。'); }
  }
  function desert(L, y) {
    var R = L.R;
    add(L, 1.2, 'bad', 'あなたは夜陰に乗じて陣営から逃げ出した。');
    var army = L.soldier.army;
    L.soldier = null; L.job = '農';
    if (army === 'wei' && R() < 0.3 && L.married) {
      add(L, 1.4, 'bad', '「士亡法」により、逃亡兵の妻子は官奴に落とされる。あなたの家族は官府に連れ去られた。');
      liveKin(L, function (k) { return k.rel === 'spouse' || k.rel === 'child'; }).forEach(function (k) { k.apart = true; });
      L.married = false;
    }
    if (R() < 0.2) { add(L, 1.6, 'bad', 'あなたは追っ手に捕まって連れ戻され、軍棍で打たれた。'); L.soldier = { army: army, since: y }; L.body -= 8; }
  }
  // 行伍中的晋升：熬資歴、立戦功、有人提攜，都難；乱世与政令会改変難易
  var MIL = ['軍卒', '屯長', '軍司馬', '校尉', '将軍'];
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
      ['軍中で' + cnNum(Math.max(1, yrs)) + '年を耐え抜き、年功が足りて屯長に取り立てられ、百人ほどの部下を預かることになった。', 'いくらか字が読めるうえに苦労をいとわないので、上官に屯長に取り立てられた。'],
      ['軍司馬に昇進し、自分の営を持った。かつて同じ伍にいた仲間たちも、あなたを見れば礼をしなければならなくなった。', '兵の扱いがうまいと上官に見込まれ、軍司馬に昇進した。'],
      ['校尉に昇進し、一軍を率いることになった。あなたの出自からすれば、極めてまれなことだった。', 'ある戦いの後、主将が上表してあなたの功を申し立て、あなたは校尉に昇進した。'],
      ['あなたは将軍に任じられた。一人の人間の出自と、刃の下で立てた功のすべてが、この任命に刻まれていた。']][L.mil - 1]));
  }
  function povKey(c, army) { var k = c.y + '|' + army + '|' + c.n; return D.BATTLE_POV && D.BATTLE_POV[k] ? k : c.y + '|' + army; }
  // 名戦的関頭：年初就要拿主意
  function battleChoice(L, y, P) {
    if (!L.soldier || L.band) return;
    var S = L.soldier, R = L.R, done = false;
    (CAMP_BY_Y[y] || []).forEach(function (c) {
      if (done || c.a.indexOf(S.army) < 0) return;
      var pk = povKey(c, S.army), POV = (D.BATTLE_POV || {})[pk];
      if (!POV || !POV.ch || R() >= (c.p == null ? 0.5 : c.p)) return;
      done = true;
      P.queue.push({ key: 'bpov', pk: pk, q: '【' + c.n + '】' + POV.ch.q, o: POV.ch.o, w: POV.ch.o.map(function () { return 1; }) });
    });
  }
  function soldierYear(L, y) {
    var R = L.R, S = L.soldier;
    L.soldierYears++;
    var end = D.ARMY_END[S.army];
    if (S.army === 'yuanshu' && L.flags.sunjianOld && y >= 195) { S.army = 'wu'; L.flags.sunjianOld = false; add(L, 0.2, 'war', '孫策は袁術のもとから父孫堅の旧部千余人を取り戻し、長江を渡って東へ向かった。あなたもその中にいた。'); }
    else if (end && y >= end[0]) {
      var nx = end[1];
      if (nx === 'zone') nx = armyOf(ctrl(L.zone, y));
      if (!nx || nx === 'yellow') {
        if ((L.mil || 0) >= 2 && L.R() < 0.2) { die(L, 'executed', 0.35, { full: 'あなたのいた軍は壊滅した。あなたは敗軍の' + L.job + 'として捕らえられ、数人の同僚と共に斬首され、さらし首にされた。' }); return; }
        L.soldier = null; L.job = '農';
        add(L, 0.3, 'war', S.army === 'yellow' ? '黄巾は総崩れとなった。あなたは頭巾を捨てて郷里へ逃げ帰り、それからはこのことを二度と口にしなかった。' : 'あなたのいた軍は壊滅した。あなたは運よく生き延び、郷里に戻った。');
        return;
      }
      if (nx !== S.army) {
        var gname = { wei: S.army === 'wei' ? '晋' : '曹', shu: '蜀', wu: '呉', jin: '晋' }[nx] || fname(nx, y);
        add(L, 0.3, 'war', S.army === 'wei' && nx === 'jin' ? '魏帝が禅譲し、あなたのいた魏の軍は晋の軍となった。' : 'あなたのいた軍は壊滅し、あなたは' + gname + 'の軍に編入された。');
        if (!(S.army === 'wei' && nx === 'jin') && (L.mil || 0) >= 1 && L.R() < 0.5) { L.mil--; L.job = MIL[L.mil]; add(L, 0.32, 'bad', '降将は冷遇されるものだ。あなたは一階級降格され、' + L.job + 'となった。'); }
        S.army = nx;
      }
    }
    var fought = false;
    (CAMP_BY_Y[y] || []).forEach(function (c) {
      if (!L.alive || !L.soldier || c.a.indexOf(S.army) < 0) return;
      var pk = povKey(c, S.army), POV = (D.BATTLE_POV || {})[pk], forced = L.bpovDec && L.bpovDec.k === pk;
      if (POV && POV.ch && !forced) return; // 有関頭抉択的名戦，是否参戦已在年初定下
      if (!forced && R() >= (c.p == null ? 0.5 : c.p)) return;
      fought = true;
      add(L, 1.5, 'war', c.t ? 'あなたは軍に従って' + c.n + 'に加わった。' + c.t : 'あなたは軍に従って' + c.n + 'に加わった。');
      L.rec.tags.push('war');
      if (POV) add(L, 1.55, 'war', pick(R, POV.t));
      var OW = (D.OFFICER_WAR || {})[Math.min(3, L.mil || 0)];
      if (OW && R() < 0.6) add(L, 1.56, 'war', pick(R, OW));
      if (forced) {
        var o = POV.ch.r[L.bpovDec.i]; L.bpovDec = null;
        if (R() < o.die * bodyMul(L) * ((L.mil || 0) >= 2 && o.go !== 'army:wei' ? 0.8 : 1)) { die(L, 'battle', 1.7, { n: c.n, full: o.dieT }); return; }
        add(L, 1.6, 'war', o.t);
        if (o.fame) L.fame += o.fame;
        L.battles = (L.battles || []).concat([c.n]);
        if (o.go === 'home') { L.soldier = null; L.job = '農'; L.flags.deserted = c.n; }
        else if (o.go && o.go.indexOf('army:') === 0) S.army = o.go.slice(5);
        if (o.zone && o.zone !== L.zone) relocate(L, o.zone, 1.65, 'あなたは{dest}に落ち着いた。', 0, y);
        return;
      }
      L.battles = (L.battles || []).concat([c.n]);
      if (R() < c.r * bodyMul(L) * (L.flags.armor ? 0.8 : 1) * (L.found.strength ? 0.85 : 1) * (L.lastFocus === 'army' ? 0.9 : 1)) { die(L, 'battle', 1.7, { n: c.n }); return; }
      var r = R();
      if (r < 0.12 * (L.found.strength ? 1.5 : 1)) {
        L.fame += 4; L.eco.priv += 1000; add(L, 1.8, 'good', 'あなたは' + c.n + 'で首級を挙げ、千銭の褒美を得た。');
        var MIL = ['軍卒', '屯長', '軍司馬', '校尉', '将軍'];
        var lv = L.mil || 0, cap = Math.min(4, (L.cls === 'gentry' ? 4 : L.found.strength ? 3 : 2) + (L.patron ? 1 : 0));
        if (lv < cap && R() < (0.45 - lv * 0.08) * (L.cls === 'gentry' ? 1.6 : 1) * (L.found.strength ? 1.3 : 1) * (L.patron ? 1.4 : 1)) {
          L.mil = lv + 1; L.job = MIL[L.mil]; L.milMax = MIL[L.mil]; L.fame += 3 + L.mil * 3;
          add(L, 1.85, 'good', ['', '屯長に取り立てられ、百人ほどを預かることになった。', '軍司馬に昇進し、自分の営を持った。', '校尉に昇進し、一軍を率いることになった。', 'あなたは将軍に任じられた。一人の人間の出自と、刃の下で立てた功のすべてが、この任命に刻まれていた。'][L.mil]);
        }
      }
      else if (r < 0.22) { L.body -= 15; L.injury = pick(R, ['左足', '右手', '左目']); add(L, 1.8, 'bad', 'あなたは' + c.n + 'で傷を負い、' + { 左足: '以後、左足を少し引きずるようになった', 右手: '右手の指を二本失った', 左目: '左目が見えなくなった' }[L.injury] + '。'); }
    });
    if (!L.alive) return;
    // 軍中疾疫
    if (R() < 0.012 * bodyMul(L)) { die(L, 'plag', 2.5); return; }
    if (!fought && R() < 0.5) add(L, 2, 'life', pick(R, D.DAILY.soldier));
    milPromote(L, y, fought);
    // 退伍
    var hered = (S.army === 'wei' || S.army === 'wu' || S.army === 'jin') && L.cls === 'soldier';
    if (L.age >= 55 || (L.injury && R() < 0.3) || (!hered && R() < 0.06)) {
      L.soldier = null; L.job = '農';
      add(L, 3.2, 'good', L.age >= 55 ? '年老いたあなたは、陣営を離れて家で余生を送ることを許された。' : 'あなたは除隊となり、郷里へ帰された。');
    }
  }

  /* ---------- 人生階段 ---------- */
  function daily(L, y) {
    var R = L.R, a = L.age, DD = D.DAILY, pool = [], tk0 = lifeTier(L, y).k, rich = tk0 === 'high' || tk0 === 'top';
    LOCAL.forEach(function (x) { if (x[0] === L.zone && y >= x[1] && y <= x[2] && a >= 6) pool.push(x[3]); });
    var RG = D.REGION && D.REGION[L.zone];
    if (RG && a >= 6) pool = pool.concat(RG.custom);
    if (inHH(L) && a >= 14) return fresh(L, L.spouseK.alive ? (L.flags.fcPal ? CONC_PAL : CONC_FU) : L.flags.fcPal === '皇宮' ? CONC_WIDP : L.flags.famousConc === 'caocao' && L.flags.noRemarry ? CONC_TQ.concat(CONC_WID) : CONC_WID);
    var hd = !L.eth && hhDaily(L, y); if (hd) return hd;
    if (L.eth && D.ETH[L.eth]) pool = pool.concat(a < 14 ? D.ETH[L.eth].child : D.ETH[L.eth].adult);
    else if (a < 3) return a === 0 ? null : pick(R, ['歩けるようになった。', '「阿母」と呼べるようになった。', '乳離れして、粟の粥を食べ始めた。']);
    else if (a < 14) {
      // 富家的孩子不必放牛、拾柴、跟着母親去河辺洗衣
      var base = rich && L.cls !== 'slave' ? DD.childRich : DD.child;
      pool = pool.concat(L.cls === 'gentry' ? DD.childGentry.concat(L.sex === 'M' && DD.gentryChild ? DD.gentryChild : []) : L.cls === 'clerk' ? DD.childClerk.concat(base) : L.cls === 'merchant' ? DD.childMerchant.concat(base) : L.cls === 'artisan' ? DD.childArtisan.concat(base) : L.cls === 'slave' ? DD.childSlave : base);
      if (L.sex === 'F') pool = pool.concat(L.cls === 'gentry' || rich ? DD.childRichF : DD.childF);
      if (L.shu && a >= 5) pool = pool.concat(DD.shuChild, DD.shuChild);
    } else if (a >= 62) {
      var otk = lifeTier(L, y).k, elite = L.cls === 'gentry' || !!L.officeMax || otk === 'top' || otk === 'high';
      pool = pool.concat(DD.old, L.cls === 'slave' && !inPal(L) ? DD.oldSlave : inPal(L) ? DD.gongren : elite ? DD.oldElite : L.cls === 'merchant' ? DD.oldMerchant : farmerish(L) ? DD.oldFarm : [], L.sex === 'F' && L.cls !== 'slave' ? DD.oldF : []);
    }
    else if (L.soldier) pool = pool.concat(DD.soldier);
    else if (L.office) pool = pool.concat(DD.clerkJob);
    else if (L.cls === 'gentry') pool = pool.concat(L.sex === 'F' && DD.gentryF ? DD.gentryF : DD.gentry);
    else if (L.cls === 'merchant') pool = pool.concat(L.sex === 'F' ? DD.merchantF : DD.merchant);
    else if (L.cls === 'artisan') pool = pool.concat(L.sex === 'F' ? DD.artisanF.concat(DD.farmerF) : DD.artisan);
    else if (L.job === '侍女' || L.flags.maidOf && L.cls === 'slave' && !L.flags.concubineOf) pool = pool.concat(maidLines(L));
    else if (L.job === '宮人' || L.job === '采女') pool = pool.concat(DD.gongren);
    else if (L.flags.palace) pool = pool.concat(DD.gongrenHi);
    else if (L.cls === 'slave') pool = pool.concat(L.sex === 'F' && DD.slaveF ? DD.slaveF.concat(DD.slave) : DD.slave);
    else if (L.cls === 'tuntian') pool = pool.concat(DD.tuntian, L.sex === 'F' ? DD.farmerF : DD.farmer);
    else if (rich) pool = pool.concat(L.sex === 'F' ? DD.richFarmF : DD.richFarm);
    else pool = pool.concat(L.sex === 'F' ? (L.cls === 'clerk' && L.married ? DD.clerkF.concat(DD.farmerF) : DD.farmerF) : DD.farmer, L.cls === 'tenant' && DD.tenantLines ? DD.tenantLines : []);
    if (L.shu && a >= 14 && a < 62 && L.cls === 'gentry' || L.shu && a >= 14 && a < 40 && !L.married) pool = pool.concat(L.sex === 'F' && !L.married ? DD.shuF : DD.shuAdult);
    if (a >= 8 && !L.eth) polsAt(L.zone, y).forEach(function (p) { if (p.daily) pool = pool.concat(p.daily); });
    var TD = D.TIER_DAILY, tk = lifeTier(L, y).k;
    if (TD && tk && tk !== 'slave' && !L.eth) {
      if (a >= 3 && a < 14) pool = pool.concat(TD.child[tk], L.sex === 'F' ? TD.childF[tk] : []);
      else if (a >= 14 && a < 62 && !L.soldier && !L.band) pool = pool.concat(TD.adult[tk], TD.adult[tk]);
    }
    if (L.sex === 'F' && a >= 16 && L.married) {
      var kids = liveKin(L, function (k) { return k.rel === 'child'; });
      if (kids.length && !rich && L.cls !== 'gentry') pool.push('あなたは' + cnNum(kids.length) + '番目の子に靴を一足こしらえてやった。', farmerish(L) ? '一番下の子を背負って畑仕事に出た。' : '一番下の子をあやしながら、手仕事を続けた。');
      else if (kids.length) pool.push('乳母が一番下の子を抱いて、あなたに挨拶に来た。', '上の子に字を教えていると、下の子がそばであなたの帯をつかんで遊んでいた。');
    }
    return pool.length ? fresh(L, pool) : null;
  }
  var LOCAL = D.LOCAL;

  function doMarry(L, sp, y, s, prefix) {
    if (inPal(L) || inHH(L)) return;
    if (L.sex === 'F' && sp.cls && sp.cls !== L.cls) { L.cls = sp.cls; if (sp.cls === 'gentry') L.gate = Math.max(L.gate || 0, 1); L.clsNote = CLS_WIFE[sp.cls]; }
    var k = newKin(L, 'spouse', sp.sex, y - sp.age, sp.name, { sur: sp.sur });
    L.spouseK = k; L.married = true; L.widowed = false; L.marriedAt = y;
    if (L.shu && L.cls === 'gentry') prefix = (prefix || '') + '縁談の席で、相手方は開口一番「嫡出か庶出か」と尋ねた。結局決まったのは、家格の少し低い家だった。';
    add(L, s, 'good', (prefix || '') + (L.sex === 'M' ? 'あなたは' + sp.from + 'の' + sp.name + 'を妻に迎えた。' : 'あなたは' + sp.from + 'の' + sp.name + 'に嫁いだ。'));
    L.standing += 4;
    L.rec.tags.push('marry');
    if (L.clsNote) { add(L, s + 0.02, 'life', L.clsNote); L.clsNote = null; }
    if (L.sex === 'F') { // 女子出嫁，嬢家人不再同住
      liveKin(L, function (x) { return ['father', 'mother', 'dimu', 'sib', 'gp'].indexOf(x.rel) >= 0; }).forEach(function (x) { x.out = true; });
      var dowry = Math.round(clamp(L.eco.cash * (L.shu ? 0.07 : 0.15), 200, 30000) / 10) * 10, priv = L.eco.priv + dowry;
      var C = D.CLASSES[L.cls];
      L.land = Math.round(C.land[0] + L.R() * (C.land[1] - C.land[0])); if (L.land < 5) L.land = 0;
      L.eco = initEco(L); L.eco.priv = priv;
      add(L, s + 0.05, 'life', '実家はあなたに' + fmt(dowry) + '銭相当の嫁入り道具を持たせてくれた。これはあなた自身の私産である。');
    } else {
      var bp = Math.round(({ gentry: 20000, clerk: 5000, merchant: 5000 }[L.cls] || 1500) * (0.7 + L.R() * 0.6) / 100) * 100;
      payFrom(L, bp);
      add(L, s + 0.05, 'life', '結納に' + fmt(bp) + '銭相当を費やした。');
    }
  }

  function lifeStage(L, y, dec) {
    var R = L.R, a = L.age, g = group(ctrl(L.zone, y));
    var registered = !L.eth && L.cls !== 'slave';
    // 読書
    if (a === 6 && (L.sex === 'M' ? (L.cls === 'gentry' || (L.cls === 'clerk' && R() < 0.7)) : ((L.cls === 'gentry' && R() < (L.gate >= 3 ? 0.5 : 0.3)) || (L.cls === 'clerk' && R() < 0.1)))) { L.schooling = true; add(L, 1, 'life', L.cls === 'gentry' ? '家の塾師について『孝経』『論語』を読み始めた。' : '父が字を教えてくれるようになった。'); }
    if (dec.school) { L.schooling = true; add(L, 1, 'good', '村の老先生について字を習い始めた。'); }
    applyFocus(L, y, L.rec.focus);
    if (L.rec.focus.eff !== 'study') {
      if (L.schooling && a < 18) L.learn += 2 + R() * 2;
      else if (L.kin[0].lit && L.kin[0].alive && a >= 5 && a <= 12) L.learn += L.sex === 'F' ? 0.3 : 0.8;
    }
    if (L.schooling && a >= 15 && R() < 0.3) L.schooling = false;
    if (!L.literate && L.learn >= 30 && !condNoRead(L)) { L.literate = true; add(L, 2.5, 'good', pick(R, ['数百の字が読めるようになり、官府の貼り出す告示も読めるようになった。', 'ついに一巻の書を通して読めるようになった。'])); }

    // 礼与税
    if (a === 7 && registered && y < 204) add(L, 0.5, 'note', '漢の制度により、口銭を納め始めた。毎年二十三銭。');
    if (a === 15) add(L, 0.5, 'note', registered && y < 204 && g === 'han' ? '十五歳になり、算賦を納め始めた。毎年百二十銭。' : '十五歳になった。村の人々の目には、もう一人前の大人だった。');
    if (a === 15 && L.sex === 'F' && !L.zi && !L.eth && (L.cls === 'gentry' || (L.cls === 'clerk' && L.literate)) && R() < 0.7) {
      L.zi = giveZi(L, 'F');
      add(L, 0.8, 'life', '笄礼を行って髪を結い上げ、字を' + L.zi + 'とした。');
    }
    if (a === 20 && L.sex === 'M' && !L.zi && !L.eth && L.cls !== 'slave' && R() < (L.literate || L.cls === 'gentry' || L.cls === 'clerk' ? 0.95 : 0.3)) {
      L.zi = giveZi(L, 'M');
      add(L, 0.8, 'life', '冠礼を行い、字を' + L.zi + 'とした。');
    }
    if (a === 56 && registered && y < 220) add(L, 0.5, 'note', '五十六歳になり、慣例により算賦を免除された。');
    if (a === 70 && registered && y < 220) add(L, 2.4, 'good', '仲秋の案比で、県から王杖を一本授けられた。杖の先には鳩が刻まれている。杖を持つ者は「比於節（節を持つ使者に比す）」とされ、役人に会っても拝礼しなくてよい。');

    // 職業
    if (a === 14 && !L.job) L.job = L.eth ? (L.zone === 'jiao' || L.eth === 'shanyue' ? '山民' : '牧民') : D.CLASSES[L.cls].job;
    if (L.sex === 'M' && a === 16 && L.cls === 'soldier' && !L.soldier) {
      L.soldier = { army: armyOf(ctrl(L.zone, y)), since: y }; L.job = '軍卒';
      add(L, 0.6, 'war', 'あなたの家は士家である。十六歳になったので、決まりにより営に入って兵となった。');
    }
    career(L, y, dec);

    // 婚姻
    var unmarried = !L.married;
    if (dec.wedDelayOk) add(L, 1.45, 'life', '父母はあなたに根負けし、あと二年家に置くことを承知した。');
    if (dec.marry && !L.married) doMarry(L, dec.marry, y, 1.5, dec.wedForced ? '父は言った。「娘が自分で決めるなどということがあるものか」。縁談はそのまま決まった。' : '');
    else if (unmarried && !L.spouseK && !L.band && !dec.fconc && !dec.wfig && !inPal(L)) {
      if (L.sex === 'F') {
        var pf = L.flags.wedDelay > y ? 0 : { 13: 0.08, 14: 0.18, 15: 0.3, 16: 0.35, 17: 0.35 }[a] || 0;
        if (L.cls === 'slave' && a >= 15) pf = 0.15;
        if (R() < pf * condMarry(L)) doMarry(L, makeSpouse(L, y), y, 1.5, L.cls === 'slave' ? '主人はあなたを家の奴僕の一人にあてがった。' : '父母が決めて、あなたの嫁ぎ先が定まった。');
      } else if (a >= 16 && a <= 35 && !L.soldier && R() < (L.cls === 'gentry' ? 0.22 : L.cls === 'slave' ? 0.05 : 0.09) * condMarry(L)) {
        doMarry(L, makeSpouse(L, y), y, 1.5);
      }
    } else if (L.widowed && !L.married && !L.flags.noRemarry) {
      if (L.sex === 'F' && a < 40 && R() < (g === 'wei' && L.cls === 'soldier' ? 0.6 : L.cls === 'gentry' ? 0.05 : 0.18)) {
        L.spouseK = null;
        doMarry(L, makeSpouse(L, y), y, 2.2, g === 'wei' && L.cls === 'soldier' ? '士家の決まりにより、兵士の寡婦は他の兵卒に再嫁させられる。' : 'しばらく寡婦として過ごした後、あなたは再嫁した。');
      } else if (L.sex === 'M' && a < 55 && R() < 0.2) { L.spouseK = null; doMarry(L, makeSpouse(L, y), y, 2.2, 'あなたは後妻を迎えた。'); }
    }

    // 生育
    var sp = L.spouseK;
    if (L.married && sp && sp.alive && !sp.apart) {
      var wifeAge = L.sex === 'F' ? a : y - sp.by;
      var away = (L.sex === 'F' && sp.soldier) || (L.sex === 'M' && L.soldier);
      var kidsN = L.kin.filter(function (k) { return k.rel === 'child'; }).length;
      var pb = wifeAge >= 15 && wifeAge <= 44 && kidsN < 10 ? (away ? 0.12 : 0.3) * (wifeAge > 38 ? 0.5 : 1) : 0;
      if (L.rec.tags.indexOf('hard') >= 0) pb *= 0.6;
      if (L.flags.famousConc) pb *= 0.25;
      if (R() < pb) birth(L, y);
      if (!L.alive) return;
    }
    // 子女婚嫁、孫輩
    liveKin(L, function (k) { return k.rel === 'child'; }).forEach(function (k) {
      var ka = y - k.by;
      if (k.sex === 'F' && !k.out && ka >= 14 && R() < 0.3) { k.out = true; add(L, 2.8, 'fam', '娘の' + k.name + 'が嫁いだ。'); }
      if (k.sex === 'M' && !k.wed && ka >= 17 && R() < 0.25) { k.wed = true; add(L, 2.8, 'fam', '息子の' + k.name + 'が妻を娶った。'); }
      if ((k.wed || k.out) && ka >= 17 && ka <= 45 && R() < 0.12) {
        L.grandkids++;
        add(L, 3.2, 'good', (k.sex === 'M' ? 'あなたに' + (L.grandkids === 1 ? '初めての' : '') + '孫' : '娘の' + k.name + 'が子を産み、あなたに外孫') + (R() < 0.5 ? '（男の子）' : '（女の子）') + 'ができた。');
        L.rec.tags.push('kid');
      }
    });

    // 孤児
    var f = L.kin[0], m = L.kin[1];
    if (a < 12 && !f.alive && !m.alive && !L.flags.orphan) {
      L.flags.orphan = true;
      var older = liveKin(L, function (k) { return k.rel === 'sib' && y - k.by >= 16; });
      if (older.length) add(L, 3, 'fam', '父母はもういない。' + kinLabel(L, older[0]) + 'が家を支えることになった。');
      else {
        var r = R();
        if (r < 0.6) { add(L, 3, 'fam', '父母はもういない。叔父があなたを引き取った。'); L.eco.cash = Math.round(L.eco.cash * 0.5); }
        else if (r < 0.85 && L.cls !== 'gentry') { L.cls = 'slave'; L.eco = initEco(L); L.land = 0; L.job = '奴婢'; L.standing = 5; add(L, 3, 'bad', '父母はもういない。あなたはある豪族の家に奴婢として引き取られ、どうにか食いつないだ。'); }
        else { L.eco.cash = 0; L.land = 0; L.body -= 8; add(L, 3, 'bad', '父母はもういない。あなたは路頭に迷う孤児となり、物乞いをして生き延びた。'); }
      }
    }

    // 徴兵
    if (L.sex === 'M' && a >= 16 && a <= 50 && !L.soldier && !L.band && L.cls !== 'slave' && L.cls !== 'gentry' && !L.office) {
      var rate = conscriptRate(L.zone, y) + L.yConscript;
      if (L.eth === 'cong' || L.eth === 'wuhuan' || L.eth === 'qiang' || L.eth === 'xiongnu') rate *= 1.5;
      if (R() < rate) {
        if ((L.cls === 'merchant' || L.wealth >= 60) && L.eco.cash + L.eco.priv >= 3000 && R() < 0.8) { payFrom(L, 3000); add(L, 1.2, 'life', '官府の徴兵であなたの名が挙がった。家は三千銭を出し、人を僱って身代わりにした。'); }
        else enlist(L, y, 1.2, false);
      }
    }

    // 随機際遇
    personal(L, y);
    if (!L.alive) return;
    childEvent(L, y);
    eduYear(L, y);
    if (L.flags.palace != null && L.alive) palaceYear(L, y);
    maidYear(L, y);
    consortYear(L, y);
    concSweep(L);
    atmosYear(L, y);
    if ((L.job === '宮人' || L.job === '采女') && L.alive) {
      if (y === 280 && L.zone === 'jiangdong') relocate(L, 'luoyang', 1.5, '呉が滅んだ。孫皓の後宮にいた五千人の宮人は、晋の軍によって船で次々と北へ運ばれた。あなたもその中にいて、{dest}に着いた。', 0.03, y);
      else if ((y === 290 || y === 281) && L.zone === 'luoyang' && R() < 0.4) { L.cls = 'peasant'; L.job = '農'; L.land = 0; L.flags.palaceOut = y; add(L, 1.5, 'good', y === 290 ? '武帝が崩御し、宮中から年長の宮人たちが放たれた。あなたは宮門を出て長いこと立ち尽くした。どこへ行けばよいのかわからなかった。' : '宮人が多すぎるため、朝廷は一部を宮中から出した。あなたは宮門を出て長いこと立ち尽くした。どこへ行けばよいのかわからなかった。'); }
    }
    // 家境滑落
    splitHousehold(L, y);
    if (L.cls === 'slave' && !inPal(L) && a >= 15 && R() < 0.012) {
      L.cls = 'tenant'; L.standing += 10;
      add(L, 3, 'good', y >= 220 && g === 'wei' ? '朝廷は詔を下して官私の奴婢の一部を解放し、あなたは良人となった。' : '主人があなたを解放し、あなたは良人となった。');
    }
  }

  function meetOutcome(L, o, y, s, fig) {
    var R = L.R;
    if (o.alt) { var r = R(), acc = 0, ch = o.alt[o.alt.length - 1]; for (var j = 0; j < o.alt.length; j++) { acc += o.alt[j].p; if (r < acc) { ch = o.alt[j]; break; } } o = ch; }
    if (o.die) { die(L, o.die, s + 0.1, { n: fig.n + 'の麾下' }); return; }
    if (o.t) add(L, s + 0.05, (o.fame || 0) < 0 || o.office === null ? 'bad' : 'good', o.t);
    if (o.fame) L.fame += o.fame;
    if (o.standing) L.standing += o.standing;
    if (o.body) L.body = clamp(L.body + o.body, 5, 100);
    if (o.cash) {
      L.eco.cash += o.cash;
      if (L.eco.cash < 0) { L.eco.debt -= L.eco.cash; L.eco.cash = 0; }
    }
    if (o.office === null && L.office) { L.office = null; L.job = '農'; }
    if (o.patron && !L.patron) { L.patron = o.patron; L.meetLog.push({ id: fig.id, y: y, ach: 'あなたはかつて' + o.patron + 'に目をかけられた。' }); }
    if (o.mil && L.soldier && (L.mil || 0) < 4) {
      var MIL = ['軍卒', '屯長', '軍司馬', '校尉', '将軍'];
      L.mil = (L.mil || 0) + 1; L.job = MIL[L.mil]; L.milMax = MIL[L.mil];
      add(L, s + 0.08, 'good', '戦後の論功で、あなたは' + MIL[L.mil] + 'に抜擢された。');
    }
  }

  // 在群雄本人手下做事，就算見過他
  var LORD_FIG = { caocao: 'caocao', liubei: 'liubei', sunce: 'sunce', sunquan: 'sunquan', yuanshao: 'yuanshao', liubiao: 'liubiao', dongzhuo: 'dongzhuo', gongsunzan: 'gongsunzan', zhanglu: 'zhanglu', shixie: 'shixie', lvbu: 'lvbu', yuanshu: 'yuanshu', liuzhang: 'liuzhang', xiliang: 'mateng', taoqian: 'taoqian' };
  var LORD_LOOK = { caocao: '背は高くないが目は鋭く輝き、話しながらよく大笑いした。', liubei: '身の丈七尺五寸、腕を垂らすと膝に届くほど長い。人当たりが柔らかく、部下の名をよく覚えていた。', sunce: '若く颯爽として冗談を好み、人々は彼を「孫郎」と呼んでいた。', sunquan: 'えらの張った顔に大きな口、目には鋭い光があった。', yuanshao: '容貌は威厳に満ち、立ち居振る舞いにも風格があった。ただ、評議となるといつも決断がつかなかった。', liubiao: '身の丈八尺余り、温厚な風貌で、話しぶりはゆったりとしていた。', dongzhuo: '肥え太った体に陰鬱な目つき。堂の下の者たちは誰も顔を上げられなかった。', gongsunzan: '端正な顔立ちで声がよく通り、そばには常に白馬に乗った護衛が控えていた。', zhanglu: '道服をまとい、話しぶりはゆったりとして、機の上には道書が置かれていた。', shixie: '度量が大きく、人には謙虚で穏やか。『春秋』を語らせれば理路整然としていた。', lvbu: '堂々たる体軀で弓馬に長けていたが、喜怒の移り変わりが激しかった。', yuanshu: '出入りには金の車に乗り、言葉の端々に驕りがにじんでいた。', liuzhang: '性格は寛大で柔和、物言いも穏やかだったが、これといった定見はなさそうに見えた。', mateng: '身の丈八尺余り、顔立ちも鼻も雄々しく際立っていたが、人には寛大だった。', taoqian: 'すでに年老いて髪も髭も白く、物言いは率直だった。', shile: '羯人で、鼻が高く目は深くくぼんでいた。上党訛りで話し、字は読めないが、記憶力は抜群だった。', shihu: '堂々たる体軀に兇悪な目つきで、側近の者たちは誰も顔を上げて彼を見られなかった。', lixiong: '身なりは質素で人当たりも穏やか、とても皇帝には見えなかった。', murongh: '身の丈七尺八寸、竜のような顔立ちに一枚板のような歯並び。経学を論じるのを好んだ。', ranmin: '身の丈八尺、人並み外れた勇力の持ち主で、朱竜という名の馬に乗っていた。' };
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
    add(L, s || 1.45, 'meet', 'あなたは初めて間近で' + figName(id) + 'その人を見た。' + (LORD_LOOK[id] || ''));
    markMet(L, id, y, 'あなたはかつて' + how + '。');
    L.rec.tags.push('meet');
  }

  // 改朝換代：禅代与父子相継不算易主
  var SUCC = { 'caocao>wei': 1, 'liubei>shu': 1, 'sunce>sunquan': 1, 'sunquan>wu': 1, 'liuyan>liuzhang': 1, 'wei>jin': 1, 'dongzhuo>lijue': 1, 'han>liuyan': 1, 'han>liubiao': 1, 'han>taoqian': 1, 'han>shixie': 1, 'han>gongsun': 1, 'han>zhanglu': 1, 'han>gongsunzan': 1, 'han>warlords': 1 };
  // 群雄割拠、叛軍這類"政権"並非一人，要説清楚到底是誰
  var LOOSE = { warlords: 1, rebels: 1, nzrebels: 1 };
  var WARLORD_DESC = { yu: '袁術の部将と、汝南・潁川の黄巾の残党', luoyang: '張楊・楊奉ら各地の軍勢', qing: '青州黄巾と、田楷・孔融ら各地の軍勢', bing: '黒山軍の張燕と各地の豪族', jiangdong: '劉繇・王朗・厳白虎ら' };
  function oldLordDesc(z, fk, y) { return fk === 'warlords' ? (WARLORD_DESC[z] || 'この地に割拠する各地の豪族') : lordName(fk, y); }
  function lordName(fk, y) { return { warlords: '新興の豪族', rebels: '涼州叛軍', nzrebels: '南中豪帥', han: '漢廷', lijue: '李傕、郭汜' }[fk] || fname(fk, y); }
  var LOW_OFF = { 書佐: 1, 計吏: 1, 県長: 1, 亭長: 1, 里正: 1, 郷嗇夫: 1, 遊徼: 1 };
  // 各方勢力真正敗亡（或由継承者接続）的年份
  var LORD_END = { rebels: 190, dongzhuo: 192, lijue: 196, taoqian: 195, liuyan: 194, lvbu: 199, yuanshu: 199, gongsunzan: 199, sunce: 200, yuanshao: 205, liubiao: 208, xiliang: 214, liuzhang: 214, zhanglu: 215, caocao: 220, han: 220, liubei: 221, sunquan: 222, nzrebels: 225, shixie: 227, gongsun: 238, shu: 263, wei: 265, wu: 280, hanzhao: 329, chenghan: 347, houzhao: 350 };
  var LORD_NEXT = { caocao: 'wei', han: 'wei', liubei: 'shu', sunce: 'sunquan', sunquan: 'wu', liuyan: 'liuzhang', wei: 'jin', dongzhuo: 'lijue' };
  function famousConcOutcome(L, y, c, i) {
    if (L.married || L.flags.isConc || L.flags.concubineOf) return;
    var R = L.R, id = c.fid, n = figName(id), C = FAMOUS_CONC[id];
    if (i === 1) {
      if (R() < 0.6) { add(L, 1.2, 'life', '父母は幾重にも伝手を頼り、あなたにはもう嫁ぎ先が決まっていると言い繕った。' + n + 'の部下は二度と来なかった。'); return; }
      add(L, 1.2, 'bad', '断っても無駄だった。' + n + 'の部下は冷ややかな顔で言った。「主公に見初められて、差し出さなかった者などおらぬ」');
    }
    L.cls = 'gentry'; L.gate = L.gate || 1; L.spouseK = null;
    var k = newKin(L, 'spouse', 'M', C.b || y - 30 - Math.floor(R() * 15), n, { sur: n.charAt(0) });
    k.fixDy = C.d; k.fixCause = 'base'; k.famous = id; k.deathT = C.dt;
    L.spouseK = k; L.married = true; L.widowed = false; L.marriedAt = y; L.flags.isConc = true; L.flags.famousConc = id; L.standing += 8; L.fame += 6;
    liveKin(L, function (x) { return ['father', 'mother', 'dimu', 'sib', 'gp'].indexOf(x.rel) >= 0; }).forEach(function (x) { x.out = true; });
    var CL = (D.CONC_LIFE || {})[id];
    add(L, 1.25, 'meet', c.maid ? D.MAID.toConc.replace(/\{lord\}/g, n) + (CL ? CL.wife(y) : '') : 'あなたは' + n + 'の屋敷に迎え入れられ、彼の妾となった。' + (CL ? CL.wife(y) : '彼の奥向きにはすでに多くの女がおり、正室はあなたを見ても、ただ淡々とうなずいただけだった。'));
    L.job = '姫妾'; L.flags.noRemarry = false;
    seatMove(L, C.seat(y), 1.27, 'あなたは一台の車に乗せられ、{dest}にある彼の屋敷へ送られた。それからは実家の者と会うこともめったになくなった。', y);
    markMet(L, id, y, 'あなたはかつて' + n + 'の妾だった。');
    L.rec.tags.push('meet');
  }
  // 搬進諸侯的府邸（指定郡県）
  function seatMove(L, st, s, text, y) {
    if (!st) return;
    var ji = -1;
    D.JUN.forEach(function (j, i) { if (ji < 0 && j[0] === st[0] && (j[3].indexOf(st[1]) >= 0 || st[1] === '建業')) ji = i; });
    if (ji < 0 || (L.jun === ji && L.county === st[1])) return;
    var oz = L.zone;
    if (oz !== D.JUN[ji][1]) friendsApart(L, 'あなたが故郷を離れてから、音信は途絶えた');
    setPlace(L, ji); L.county = st[1]; L.urban = true; L.moves++; L.places.push(L.zone);
    add(L, s, 'move', fill(text, { dest: st[1] }));
    liveKin(L, function (k) { return k.out; }).forEach(function (k) { k.apart = true; });
    var fk = ctrl(L.zone, y);
    if (oz !== L.zone && L.regimes[L.regimes.length - 1] !== fk) L.regimes.push(fk);
  }
  // 丈夫死後：諸侯的姫妾，下場各不相同
  function famousWidow(L, y) {
    var k = L.spouseK, R = L.R, id = L.flags.famousConc;
    if (!id || L.flags.fcWidow || !k || k.famous !== id || k.alive || k.dy !== y) return;
    L.flags.fcWidow = true;
    if (L.flags.fcPal === '皇宮') { add(L, 1.62, 'life', '先帝が崩御した。宮中の決まりで、位号のない側妾は宮人とともに別宮へ移り、以後は先帝の位牌を守って暮らし、再嫁は許されなかった。'); L.flags.noRemarry = true; return; }
    if (id === 'caocao') { add(L, 1.62, 'life', '彼は遺令を残した。「吾婢妾与伎人皆勤苦，使著銅雀台，善待之（わが婢妾と伎人はみなよく勤めた。銅雀台に住まわせ、手厚く遇せよ）」。あなたは屋敷の姫妾たちと共に銅雀台に移り住んだ。毎月一日と十五日には、朝から昼まで、彼の霊帳に向かって楽を奏でねばならなかった。'); L.flags.noRemarry = true; seatMove(L, ['魏郡', '鄴県'], 1.63, 'あなたは{dest}の銅雀台へ送られた。', y); return; }
    if (id === 'yuanshao') {
      if (R() < (L.flags.fcFav ? 0.75 : 0.1)) { die(L, 'executed', 1.62, { full: '彼の亡骸がまだ冷えぬうちに、正室の劉夫人は彼が生前寵愛した五人の妾を殺し、髪を剃り、顔を黒く塗った。あの世で再び彼に会わせないためだという。あなたもその一人だった。' }); return; }
      add(L, 1.62, 'bad', '彼の亡骸がまだ冷えぬうちに、正室の劉夫人は彼が生前寵愛した五人の妾を殺し、髪を剃り、顔を黒く塗った。' + (L.flags.fcFav ? 'あなたも寵愛を受けていたが、なぜか見逃された。' : 'あなたは寵愛を受けた者の中に入っておらず、幸いにも難を逃れた。')); L.flags.noRemarry = true; return;
    }
    if (id === 'dongzhuo') {
      if (R() < 0.4) { die(L, 'executed', 1.62, { full: '董氏の一門は誅され、九十歳になる彼の老母さえ容赦されなかった。乱兵が郿塢に雪崩れ込んだとき、あなたは逃げ出せなかった。' }); return; }
      add(L, 1.62, 'bad', '董氏の一門は誅され、九十歳になる彼の老母さえ容赦されなかった。あなたは混乱に乗じて郿塢から逃げ出し、それからは名を隠して生きた。'); L.cls = 'peasant'; L.job = '農婦'; L.eco.cash = Math.round(L.eco.cash * 0.2); return;
    }
    if (id === 'lvbu') { add(L, 1.62, 'life', '曹操は呂布の家族をまとめて許都へ連れ帰った。'); seatMove(L, ['潁川郡', '許県'], 1.63, 'あなたは捕虜の列に混じって{dest}へ護送された。', y); return; }
    if (id === 'liubiao') { add(L, 1.62, 'life', D.CFATE.liubiao); L.flags.noRemarry = true; relocate(L, 'qing', 1.63, D.CFATE.liubiaoMove, 0.02, y); return; }
    if (id === 'sunce') { add(L, 1.62, 'life', D.CFATE.sunce); L.flags.noRemarry = true; return; }
    if (liveKin(L, function (x) { return x.rel === 'child'; }).length) { add(L, 1.62, 'life', '子がいたので、あなたは屋敷に残って留守を守った。新しい主人は慣例どおり、月々の手当てをくれた。'); L.flags.noRemarry = true; }
    else if (R() < 0.5) { add(L, 1.62, 'life', '子のない姫妾は、ある者は暇を出され、ある者は部将に下げ渡された。あなたはわずかな金を渡され、屋敷から出された。'); L.eco.cash += 2000; }
    else { add(L, 1.62, 'life', '子のなかったあなたは、屋敷の片隅の離れに住み、彼の位牌を守って日々を過ごした。'); L.flags.noRemarry = true; }
  }
  function factionAlive(fk, y) { return Object.keys(D.CTRL).some(function (z) { return ctrl(z, y) === fk; }); }
  function lordFallOutcome(L, y, c, i) {
    var R = L.R, on = lordName(c.ofk, y), nn = lordName(c.nfk, y);
    if (i === 0) {
      var r = R();
      if (r < 0.5) { L.lordFk = c.nfk; L.flags.switched = on; L.officeMax = nn + 'の掾属'; add(L, 1.2, 'life', nn + 'はあなたに才があると見て、幕府に留めて仕事をさせた。ただそれ以来、かつての同僚たちはあなたを見ると、どこか気まずそうにした。'); serveLord(L, lordFigAt(c.nfk, y), y, nn + 'に鞍替えし、その幕府で職に就いた'); }
      else if (r < 0.8) {
        add(L, 1.2, 'bad', 'あなたは' + on + 'の腹心だと言って、新しい主にあなたを用いるなと進言する者がいた。あなたは獄に下された。');
        if (R() < 0.25) { die(L, 'executed', 1.3, { full: '獄中で何度か取り調べを受け、最後には' + on + 'の残党という罪で処刑された。' }); return; }
        L.office = null; L.job = L.cls === 'gentry' ? '士人' : '農'; L.eco.cash = Math.round(L.eco.cash * 0.6);
        add(L, 1.35, 'life', '数か月閉じ込められ、家が金を使って方々に手を回して、ようやく釈放された。');
      } else { L.office = null; L.job = L.cls === 'gentry' ? '士人' : '農'; add(L, 1.2, 'life', '新しい主の幕府には人材があふれ、あなたの居場所はなかった。あなたは家に帰った。'); }
    } else if (i === 1) { L.office = null; L.job = L.cls === 'gentry' ? '士人' : '農'; L.fame += 1; add(L, 1.2, 'life', 'あなたは郷里に帰り、門を閉ざして書を読み、外の事には二度と関わらなかった。'); }
    else { L.office = null; L.job = L.cls === 'gentry' ? '士人' : '農'; L.fame += 4; L.standing += 2; L.tr.per = clamp(L.tr.per + 3, 5, 95); L.flags.loyal = on; add(L, 1.2, 'life', '新しい主が使いをよこして招いたが、あなたは何度も辞退した。融通が利かないと言う者もいれば、義士だと言う者もいた。'); }
  }
  function regimeOutcome(L, y, c, i) {
    var R = L.R, nn = c.nn || lordName(c.nfk, y), on = c.on || lordName(c.ofk, y), r = R();
    if (!L.office) {
      if (i === 0) {
        if (r < 0.3 + L.fame / 120 + (L.gate >= 3 ? 0.15 : 0)) { L.office = '幕僚'; L.officeMax = nn + 'の掾属'; L.job = '幕僚'; L.fame += 4; add(L, 1.2, 'good', 'あなたの書状に返事が来た。' + nn + 'があなたを掾属に召し出した。時勢を見る目があると言う者もいれば、陰で出世を焦っていると言う者もいた。'); serveLord(L, lordFigAt(c.nfk, y), y, nn + 'の招きに応じ、その掾属となった'); }
        else add(L, 1.2, 'life', 'あなたの書状はなしのつぶてだった。新しい主の周りには人が多すぎ、あなたの番は回ってこなかった。');
      } else { L.standing += 2; add(L, 1.2, 'life', 'あなたは門を閉ざして客を断り、家で書を読むばかりだった。乱世においては、様子見もまたひとつの立場の表明である。'); }
      return;
    }
    if (i === 0) {
      if (LOW_OFF[L.office]) {
        if (r < 0.85) add(L, 1.2, 'life', '県廷の主は替わっても、戸籍や田畝、刑獄の文書は誰かが扱わねばならない。あなたはこれまでどおり勤めた。ただ公文書の年号と印だけが替わった。');
        else { add(L, 1.2, 'bad', '新任の長官は自分の配下を連れてきており、あなたは家に帰された。'); L.office = null; L.job = '農'; }
      } else if (r < 0.5) add(L, 1.2, 'life', '新しい主は人心を慰撫するため、あなたを元の職に留めた。ただそれからは、評議のたびにあなたの顔色をうかがう者がいた。');
      else if (r < 0.62 && L.fame >= 25) { L.fame += 5; add(L, 1.2, 'good', nn + 'はあなたの名声を重んじて召し出し、留任させたうえに秩禄まで加えた。'); serveLord(L, lordFigAt(c.nfk, y), y, nn + 'に召し出され、秩禄を加えられた'); }
      else if (r < 0.88) { L.office = '幕僚'; L.job = '幕僚'; add(L, 1.2, 'bad', '重要な地位はみな' + nn + 'の旧臣に与えられた。あなたは閑職の掾属に回された。'); }
      else {
        add(L, 1.2, 'bad', 'ある者が' + nn + 'に、あなたは' + on + 'の腹心だと告発した。あなたは獄に下された。');
        if (R() < 0.3) { die(L, 'executed', 1.4, { full: '獄中で数か月にわたり拷問を受け、あなたは生きて出ることができなかった。' }); return; }
        L.office = null; L.job = '農'; L.eco.cash = Math.round(L.eco.cash * 0.5); L.fame -= 3;
        add(L, 1.6, 'life', '数か月閉じ込められ、家が大金を使って方々に手を回して、ようやく釈放された。官職はもちろん失った。');
      }
    } else if (i === 1) {
      L.fame += LOW_OFF[L.office] ? 1 : 4; L.standing += 2;
      L.office = null; L.job = L.cls === 'gentry' ? '士人' : '農';
      add(L, 1.2, 'life', 'あなたは印綬を封じて官舎に残し、郷里に帰って門を閉ざした。' + (L.cls === 'gentry' ? '郷里の人々はあなたを節操ある人だと言った。新しい主の側は、あなたの名を書き留めた。' : '家族は、食い扶持をひとつ失ったとあなたを恨んだ。'));
    } else {
      if (R() < 0.08) { die(L, 'road', 1.4); return; }
      relocate(L, c.dest, 1.2, 'あなたは妻子を連れて夜のうちに城を出て、{dest}にいる' + on + 'のもとへ身を寄せた。', 0, y);
      if (R() < 0.55) add(L, 1.5, 'good', on + 'は遠くから頼ってきたあなたを労い、改めて官職を授けた。');
      else { L.office = '幕僚'; L.job = '幕僚'; add(L, 1.5, 'life', on + 'はあなたを受け入れたが、遠くから来る者があまりに多く、あなたは閑職の掾属にとどまった。'); }
      L.fame += 2;
      serveLord(L, lordFigAt(c.ofk, y), y, on + 'のもとへ身を寄せ、その帳下で職に就いた', 1.55);
    }
  }

  // 月旦評：評語由天資、学問、性情、名声決定——評的人看得見你自己還不知道的東西
  var AP_TXT = {
    wen: [['章句にはひととおり通じている。家学を守ることはできよう。', '学問には励むが、器量がいささか小さい。'], ['博識で記憶力に優れる。郡の文学掾が務まろう。', 'この子は学を好む。いずれ経術で身を立てるであろう。'], ['経に明るく行いも正しい。一代の儒宗となるべき人物だ。', 'この子の学は、州郡に収まるものではない。']],
    wu: [['いくらか腕力がある。兵卒にはなれよう。', '気性が荒く手も早い。刀兵からは遠ざかるがよい。'], ['勇はあるが謀に乏しい。一隊の長にはなれよう。', '健児である。治世なら亭長、乱世なら部曲の頭となろう。'], ['熊虎の士。治世には国の干城、乱世には将の器。', 'この者は戦場に臨めば必ず堅陣を破る。ただ、まともな死に方はできまい。']],
    li: [['決まりをよく守る。郷嗇夫が務まろう。', '慎重で勤勉だが、帳簿を扱える程度にとどまる。'], ['法令文書に通暁している。一県を任せられよう。', '応対に巧みで、吏務に長けている。'], ['治政の要諦に明るい。一郡を任せられよう。', 'この者には経世の才がある。惜しいかな、生まれる時を誤った。']],
    zhi: [['志は大きいが才が追いつかない。自らを抑えるがよい。', '大言を好む。おそらく何も成し遂げまい。'], ['志と節操があり、事を成せよう。ただ、いささか性急にすぎる。', '人の下に甘んじる者ではない。'], ['この人は乱世に求められ、治世に忌まれる。', '非常の人である。天下に変あらば、必ずこの人の名を聞くだろう。']],
    de: [['並の資質。分をわきまえれば穏やかに老いを迎えられよう。', '大きな過ちもなく、大きな功もない。'], ['誠実で謙虚、郷里の評判もよい。', '温良恭倹、家を保つには十分だ。'], ['清廉で徳がある。人の師表となれよう。', 'その人は玉のごとし。六尺の孤を託すに足る。']],
    gong: [['手先が器用だ。良い職人になれよう。', '心配りは細やかだが、惜しいことに正しい道に使われていない。'], ['工夫の才が人並み外れている。工房を任せられよう。', 'この子の技なら、将作の吏が務まろう。'], ['比類なき巧みさ。公輸にも比すべきだ。', 'その技は天下を利するに足る。惜しいかな、世の人はそれを知らぬ。']]
  };
  var XIANG_TXT = [
    ['眉間に苦労の相がある。一生、奔走が多かろう。ただ骨相はしっかりしており、苦労には耐えられる。', '顔色が黄ばみ、胃腸が弱い。酒は控え、水辺には気をつけよ。', '人相は平凡。福は薄いが貧窮には至らず、平穏な一生だろう。'],
    ['額が豊かに張っている。中年以降にひとつ巡り合わせがあろう。人と訴訟で争うことは厳に慎め。', '耳は厚く口は四角い。子孫に恵まれる相だ。', '骨相は清らかで鋭い。四十を過ぎてから世に出るだろう。'],
    ['人相が並外れて立派だ。これは常人の相ではない。ただ鋭さが表に出すぎている。控えることを覚えよ。', '目に鋭い光がある。今は下の地位にあっても、必ず頭角を現す日が来る。']
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
      add(L, 1.3, lv ? 'good' : 'life', (L.fame >= 35 && !L.apAsk ? 'あなたが求めに行くまでもなく、' + ap.n + 'の方からあなたを品評した。' : 'あなたは' + ap.n + 'を訪ねて拝謁した。彼はしばらくあなたを見つめ、ひと言だけ口にした。') + 'その言葉はたちまち人々の間に広まった。「' + txt + '」');
      if (lv === 2) { L.fame += 12; L.standing += 5; L.flags.praised = true; add(L, 1.35, 'good', '一夜にして、郡じゅうの人があなたの名を知った。誼を結ぼうと訪ねてくる人が増えた。'); }
      else if (lv === 1) { L.fame += 5; L.standing += 2; }
      else { L.fame -= 2; add(L, 1.35, 'life', 'それを聞いて、あなたは顔がかっと熱くなった。この言葉は何年もあなたにつきまとった。'); }
    } else {
      txt = pick(R, XIANG_TXT[lv]).replace(/^你/, '君');
      add(L, 1.3, 'life', ap.n + 'はしばらくあなたの顔をじっと見つめ、こう言った。「' + txt + '」' + (lv ? '口では信じないと言いながら、あなたはその言葉を胸に刻んだ。' : 'あなたは笑って、気にも留めなかった。'));
      L.standing += lv;
    }
    var tk = DIM_TAL[k];
    if (tk && tal[tk] >= 0.45 && !L.found[tk]) { L.found[tk] = true; add(L, 1.4, 'good', 'この一言で、あなたは自分に' + TALENT[tk].n + 'の才があることを初めて知った。'); }
    L.appraisal = { by: ap.n, t: txt, y: y, ping: ping, lv: lv };
    markMet(L, ap.f, y, ap.n + 'はかつてあなたを' + (ping ? '品評して' : '人相見して') + '「' + txt + '」と言った');
  }

  function career(L, y, dec) {
    var R = L.R, a = L.age, fk = ctrl(L.zone, y);
    if (L.flags.corrupt && L.office && R() < 0.06 * polMul(L.zone, y, 'corrupt')) {
      L.office = null; L.job = '農'; L.fame -= 6; L.flags.corrupt = false;
      add(L, 2.6, 'bad', 'かつて賄賂を受け取ったことを告発され、あなたは官職を失い、家産の大半も没収された。');
      L.eco.cash = Math.round(L.eco.cash * 0.4);
    }
    if (L.flags.outlaw && R() < 0.12) {
      L.flags.outlaw = false; L.job = '農'; L.standing += 4;
      add(L, 2.6, 'life', '役所が山中の者たちを招撫し、山を下りて田に帰ることを許した。あなたは平地に戻り、改めて戸籍に編入された。');
    }
    if (dec.clerk) { L.office = '書佐'; L.job = '書佐'; L.officeMax = '県書佐'; L.fame += 3; add(L, 1.4, 'good', 'あなたは県廷の書佐となり、毎日文書を書き写す日々を送った。'); }
    if (a < 16 || L.soldier || L.band || L.sex === 'F') return;
    var pc = polMul(L.zone, y, L.cls === 'gentry' ? 'gcareer' : 'career');
    // 考課：毎年的政績評定，慢慢積累名声
    if (L.office && a >= 18 && R() < 0.3) {
      var ev = (L.learn - 40) / 20 + (L.standing - 45) / 25 + (L.tr.cau - 50) / 40 + (L.found.charm ? 0.4 : 0) + (L.flags.corrupt ? -1 : 0) + (R() - 0.5) * 2;
      if (ev > 0.8) { L.fame += 3; add(L, 2.15, 'good', fresh(L, ['この年の考課で、あなたは「最」と評され、上役に名を覚えられた。', '郡の考課で、あなたの扱った戸口や銭穀の帳簿は一分の乱れもなく、上等と評された。'])); }
      else if (ev < -1.2) { L.fame -= 2; add(L, 2.15, 'bad', fresh(L, ['この年の考課で、あなたは「殿」と評され、上役からこっぴどく叱られた。', '考課のとき、あなたの扱った帳簿の数字が合わず、俸給を減らされた。'])); }
    }
    if ((L.office === '亭長' || L.office === '里正') && L.standing >= 50 && L.fame >= 6 && R() < 0.05 * pc) {
      var up = L.literate ? '郷嗇夫' : '遊徼';
      L.office = up; L.job = up; L.officeMax = up; L.fame += 3;
      add(L, 2, 'good', up === '郷嗇夫' ? 'あなたは県から郷嗇夫に任じられ、一郷の賦税と訴訟を取り仕切ることになった。' : 'あなたは県から遊徼に任じられ、数人を率いて一郷の盗賊を取り締まることになった。');
    } else if ((L.office === '郷嗇夫' || L.office === '遊徼') && L.literate && L.learn >= 35 && R() < 0.04 * pc) {
      L.office = '書佐'; L.job = '書佐'; L.officeMax = '県書佐'; L.fame += 3;
      add(L, 2, 'good', '県令はあなたの仕事ぶりを買い、県廷に呼び寄せて書佐とした。郷の役人から県廷へ、また一段上がったことになる。');
    } else if (L.office === '書佐' && L.learn >= 50 && R() < 0.06 * pc) {
      L.office = '計吏'; L.job = '計吏'; L.officeMax = '郡上計吏'; L.fame += 4;
      add(L, 2, 'good', 'あなたは郡から上計吏に選ばれた。年末には郡全体の戸口簿を攜えて都へ上計に赴くのだ。');
    } else if ((L.office === '計吏' || L.office === '書佐') && L.fame >= 15 && L.standing >= 45 && R() < 0.02 * pc) {
      L.office = '県長'; L.job = '県長'; L.officeMax = '県長'; L.fame += 8;
      add(L, 2, 'good', 'あなたは小さな県の県長に任命された。小吏から長吏へ——あなたの出自では、きわめて稀なことだった。');
    } else if (L.office === '県長' && L.cls !== 'gentry' && L.fame >= 25 && R() < 0.015 * pc * (L.patron ? 1.6 : 1) * (L.flags.donor ? 1.2 : 1)) {
      L.office = '県令'; L.job = '県令'; L.officeMax = '県令'; L.fame += 6;
      add(L, 2, 'good', 'あなたは一万戸を超える大県の県令に転任した。書佐から一歩ずつここまで来るのに、人生の大半を費やした。');
    }
    var cm = (L.lastFocus === 'career' ? 2 : 1) * (L.clanUp ? 1.25 : 1) * (L.flags.robe ? 1.3 : 1) * (L.flags.connected ? 1.3 : 1) * (L.flags.zz ? 2 : 1) * (L.flags.zzno ? 0.6 : 1) * (L.flags.disciple ? 1.4 : 1) * (L.found.memory ? 1.3 : 1) * (L.found.charm ? 1.2 : 1) * (L.flags.banned ? 0 : 1) * (L.patron ? 1.5 : 1) * (L.flags.praised ? 1.4 : 1) * (L.flags.jushi ? 1.5 : 1) * (L.flags.spur ? 1.3 : 1) * (L.flags.donor ? 1.2 : 1) * (L.shu ? 0.85 : 1);
    var gm = L.gate >= 3 ? 2.2 : 1;
    if (L.cls === 'gentry' && !L.office && a >= 18) {
      var p = 0;
      if (y < 220 && (L.fame >= 5 || L.gate >= 3)) p = 0.04; // 察挙
      if (y >= 220) p = L.gate >= 3 ? 0.13 : 0.04; // 九品中正：上品無寒門
      if (y >= 190 && y < 230 && L.learn >= 55) p += 0.03; // 徴辟
      if (R() < p * cm * gm * polMul(L.zone, y, 'gcareer')) {
        var t;
        if (y < 220 && R() < 0.6) { L.office = '郎官'; L.officeMax = '郎中'; t = L.gate >= 3 ? '家柄のおかげで、あなたは出仕するなり郎官となった。' : '郡があなたを孝廉に推挙し、あなたは都に上って郎官となった。'; }
        else if (y >= 220 && R() < 0.6) { L.office = L.gate >= 3 ? '尚書郎' : '県令'; L.officeMax = L.office; t = '郡の中正はあなたを' + (L.gate >= 3 ? '上品と評した。「上品無寒門，下品無士族」（上品に寒門なく、下品に士族なし）——あなたは起家してすぐ尚書郎となった。' : '中品と評し、あなたは県令に任じられた。'); }
        else { L.office = '幕僚'; L.officeMax = fname(fk, y) + 'の幕僚'; t = fname(fk, y) + 'があなたを掾属として辟召し、あなたは幕府の幕僚となった。'; }
        L.job = L.office; L.fame += 10;
        add(L, 2, 'good', t);
        if (L.office === '幕僚') serveLord(L, lordFigAt(fk, y), y, '' + fname(fk, y) + 'の幕府で掾属を務めた');
      }
    } else if ((L.office === '郎官' || L.office === '尚書郎' || L.office === '幕僚') && R() < 0.12 * gm) {
      L.office = '県令'; L.officeMax = '県令'; L.job = '県令'; L.fame += 6;
      add(L, 2, 'good', 'あなたは地方に出て県令となった。');
    } else if ((L.office === '県令' || (L.office === '県長' && L.patron)) && (L.fame >= 30 || L.gate >= 3) && R() < 0.03 * gm * cm * pc) {
      L.office = '郡守'; L.officeMax = '郡太守'; L.job = '太守'; L.fame += 12;
      add(L, 2, 'good', 'あなたは太守に昇進し、一郡を治めることになった。');
    } else if (L.office === '郡守' && (L.gate >= 2 || L.patron) && L.fame >= 45 && R() < 0.02 * gm * cm * pc) {
      var top = R() < 0.5 ? '刺史' : '九卿';
      L.office = top; L.officeMax = top === '刺史' ? '州刺史' : '九卿'; L.job = top; L.fame += 15;
      add(L, 2, 'good', top === '刺史' ? 'あなたは一州の刺史となり、節を持して諸郡を監察した。' : 'あなたは朝廷に入り、九卿に列した。あなたの家の門第は、これでまた一段高くなった。');
      if (L.gate < 3 && L.cls === 'gentry') { L.gate = 3; L.gateName = '代々二千石を出す高門'; }
    }
    if (!L.office && L.cls !== 'gentry' && a >= 18 && a <= 50) {
      var r = R();
      if (r < 0.006 && L.learn >= 25) { L.job = '医者'; add(L, 2.2, 'life', 'あなたは年老いた医者について鍼灸といくつかの処方を覚え、村の人々を診るようになった。'); L.standing += 6; }
      else if (r < 0.009) { L.job = '巫祝'; add(L, 2.2, 'life', '村の巫祝が年老いたので、あなたが跡を継いで祭祀を司り、鬼を祓い病を治すようになった。'); L.standing += 4; }
      else if (r < 0.014 && L.learn >= 30 && L.standing >= 30) { L.job = '門客'; add(L, 2.2, 'life', 'あなたはある豪族の門下に身を寄せ、食客となった。'); }
      else if (r < 0.02 && L.cls === 'peasant' && y >= 189 && y <= 220) { L.cls = 'tenant'; L.job = '部曲'; add(L, 2.2, 'life', '乱世の中、あなたの家は土地の豪族に身を寄せ、あなたはその塢壁の部曲となった。'); }
    }
  }

  function birth(L, y) {
    var R = L.R, sx = R() < 0.51 && !L.flags.famousConc ? 'M' : 'F';
    var k = newKin(L, 'child', sx, y, freshXiao(L, sx), { sur: kidSur(L, 'child') });
    k.lav = R();
    if (L.sex === 'F' && L.affair && R() < 0.5) { k.doubt = true; add(L, 2.05, 'life', '生まれた子の目鼻立ちは、あまり夫に似ていなかった。あなたは何も言わなかった。'); }
    var cc = L.sex === 'M' && L.kin.filter(function (x) { return x.rel === 'conc' && x.alive && !x.apart; })[0];
    if (cc && R() < 0.35) { k.shu = true; k.momName = cc.name; }
    var xn = k.xiao;
    if (eliteFam(L)) giveName(L, k);
    L.kidsBorn++;
    L.rec.tags.push('kid');
    var nth = L.kidsBorn;
    var nm2 = k.full ? '名は' + k.full + '、幼名は' + xn : '幼名は' + xn;
    if (L.sex === 'F') add(L, 2, 'good', 'あなたは' + (nth === 1 ? '初めての' : '') + '子を産んだ。' + (sx === 'M' ? '男の子' : '女の子') + 'で、' + nm2 + '。');
    else add(L, 2, 'good', '妻の' + L.spouseK.name + 'が子を産んだ。' + (sx === 'M' ? '男の子' : '女の子') + 'で、' + nm2 + '。' + (nth === 1 ? 'あなたは初めて父親になった。' : ''));
    var mother = L.sex === 'F' ? null : L.spouseK;
    var pm = 0.012 * (L.rec.tags.indexOf('hard') >= 0 ? 2 : 1) * (L.wealth >= 60 ? 0.6 : L.wealth < 15 ? 1.3 : 1);
    if (L.sex === 'F') { if (R() < pm * bodyMul(L)) die(L, 'childbirth', 2.05); }
    else if (R() < pm) kinDie(L, mother, 'childbirth', 2.05, y);
    if (R() < 0.08) { k.alive = false; k.dy = y; add(L, 2.1, 'fam', '子は生まれて幾日もたたないうちに死んでしまった。'); L.rec.tags.push('loss'); }
  }

  function personal(L, y) {
    var R = L.R, a = L.age;
    if (a < 6 || inHH(L)) return;
    var farm = ['peasant', 'tenant', 'tuntian', 'soldier', 'clerk'].indexOf(L.cls) >= 0 && !L.soldier;
    var poor = L.wealth < 25 && L.cls !== 'gentry';
    var tk = lifeTier(L, y).k, rich = tk === 'high' || tk === 'top';
    var r = R();
    if (r < 0.05 && cool(L, 'ill', 3)) { L.body -= rich ? 4 : poor ? 8 : 6; add(L, 2.2, 'bad', fresh(L, ['あなたは大病を患い、ひと月以上も床に伏した。', 'あなたは瘧（おこり）にかかり、ひと夏を耐えてようやく治った。', 'あなたは冬じゅう咳き込み、春になってようやく少しずつ良くなった。', 'あなたは悪いものを食べて半月も下痢が続き、すっかり痩せてしまった。'].concat(poor ? ['あなたは病に倒れたが、医者を呼ぶ金もなく、ただ横になって耐えるしかなかった。', 'あなたの脚にできものができたが、薬を買う金がなく、何か月も膿み爛れたままだった。'] : rich ? ['あなたは病を患った。家では町の医者を呼び、何十服も薬を飲んでようやく治った。', 'あなたは病に倒れた。家では羊を屠って祈り、巫祝と医者も呼んで、ひと月以上も大騒ぎだった。'] : ['あなたの脚にできものができ、何か月も膿み爛れたままだった。']).concat(poor && a >= 14 ? ['あなたは病で床から起き上がれず、畑仕事はすべて家族の肩にのしかかった。'] : []))); }
    else if (r < 0.13 && farm && a >= 12 && cool(L, 'good', 3)) { L.yHarvest = 1.2; if (L.reg) L.reg.price = clamp(L.reg.price * 0.92, 0.6, 8); add(L, 3, 'good', fresh(L, ['この年は天候に恵まれ、なかなかの豊作だった。', '今年は雨がちょうどよく、粟の穂が重く垂れた。', '麦がたくさん穫れ、脱穀場には山のように積み上がった。', '珍しい豊年で、村ではどの家も少しずつ酒を醸した。'])); }
    else if (r < 0.19 && farm && a >= 12 && cool(L, 'bad', 3)) { L.yHarvest = 0.6; if (L.reg) L.reg.price = clamp(L.reg.price * 1.12, 0.6, 8); add(L, 3, 'bad', fresh(L, ['今年は日照りのあとに大水が来て、収穫は例年の半分しかなかった。', '雹が降って、実りかけた麦を打ち砕いた。', '夏に虫が湧き、粟の葉は筋だけになるまで食い荒らされた。', '秋口からひと月も雨が降り続き、穀物は田の中で腐ってしまった。', '春に一滴の雨も降らず、蒔いた種の多くが芽を出さなかった。'])); }
    else if (r < 0.2 && L.cls !== 'slave' && cool(L, 'fire', 15)) { L.eco.cash = Math.round(L.eco.cash * 0.6); L.eco.house = Math.max(500, L.eco.house - 1000); add(L, 1.8, 'bad', fresh(L, rich ? ['荘園の倉が火事になり、数百斛の穀物が焼けた。', '裏庭の薪小屋から火が出て、僮僕たちが夜半まで水を運んで消し止めた。'] : ['家が火事になり、家の半分と蓄えの穀物が焼けてしまった。', 'かまどの火の粉が薪の山に飛び、庭の半分が焼けた。'])); }
    else if (r < 0.2 + 0.015 * chaos(y) && cool(L, 'rob', 6)) {
      var lost = Math.round(Math.min(L.eco.priv + L.eco.cash, (rich ? 2000 : 300) + R() * (rich ? 8000 : 2500)));
      if (lost >= 30) {
        payFrom(L, lost); if (L.reg) L.reg.order = clamp(L.reg.order - 2, 5, 95);
        add(L, 2.4, 'bad', fresh(L, L.cls === 'slave' ? ['あなたがこっそり貯めた' + fmt(lost) + '銭を、同じ部屋の者に盗まれた。あなたは声を上げることもできなかった。'] : a < 14 ? ['夜中に泥棒が塀を越えて入り込み、' + fmt(lost) + '銭相当の品を盗んでいった。両親は何日も嘆いていた。'] : rich ? ['あなたの家の車列が道中で襲われ、' + fmt(lost) + '銭相当の荷を奪われた。', '夜中に泥棒が荘園に忍び込み、' + fmt(lost) + '銭相当の品を盗んでいった。'] : ['あなたは道中で盗賊に遭い、' + fmt(lost) + '銭相当の財物を奪われた。', '夜中に泥棒が塀を越えて入り込み、' + fmt(lost) + '銭相当の品を盗んでいった。']));
      }
    }
    else if (r < 0.24 && farm && L.eco.ox > 0 && cool(L, 'ox', 8)) { L.eco.ox--; add(L, 1.2, 'bad', fresh(L, ['家の耕牛が病で死んだ。あなたは牛小屋にしゃがみ込み、長いこと口をきかなかった。', '耕牛が山の斜面で脚を折り、潰すしかなかった。肉は売れたが、春になったら何で田を鋤けばいいのか。'])); }
    else if (r < 0.25 && L.cls !== 'slave' && cool(L, 'luck', 15)) { L.eco.cash += Math.round(1500 + R() * 3500); add(L, 2, 'good', fresh(L, a < 14 || rich ? ['古い家を修繕していたら、壁の根元から昔の人が隠した五銖銭の小壺が出てきた。', '遠縁の親戚が亡くなり、あなたの家にいくらかの財産を遺してくれた。'] : ['あなたは畑で、昔の人が埋めた五銖銭の小壺を掘り当てた。', '遠縁の親戚が亡くなり、あなたの家にいくらかの財産を遺してくれた。'])); }
    else if (r < 0.27 && L.cls === 'merchant' && cool(L, 'trade', 3)) { var w = R() < 0.55 ? 1 : -1; L.eco.stock = Math.round(L.eco.stock * (w > 0 ? 1.25 : 0.7)); add(L, 2, w > 0 ? 'good' : 'bad', fresh(L, w > 0 ? ['あなたは布帛をひと山転売して、かなり儲けた。', 'あなたは値上がり前に塩を買い込み、ひと儲けした。'] : ['荷を積んだ船が川で転覆し、元手をすっかり失った。', '仕入れた漆器の大半が道中で壊れてしまった。'])); }
    else if (r < 0.29 && a >= 15 && cool(L, 'kind', 5)) { L.standing += 4; add(L, 2.5, 'good', fresh(L, ['あなたは村の田の境界争いを仲裁し、皆から公平だと言われた。', '隣家の食糧が尽きたので、あなたは米を二斗分けてやった。', 'あなたは身寄りのない家の屋根を直してやった。', '村で病に倒れた人がいて、あなたは彼を背負って十里の道を医者のもとへ歩いた。'])); }
    else if (r < 0.32 && poor && a >= 14 && cool(L, 'hard', 4)) { L.body -= 2; add(L, 2.7, 'bad', fresh(L, ['あなたは豪族の家でひと月日僱い仕事をしたが、賃金の半分を差配役にピンはねされた。', 'あなたは県城へ薪を売りに行き、市の役人に「道をふさいだ」と言われて一束取り上げられた。', 'あなたは一足の草鞋を三年履き、繕っては履き続けた。', '家の塩が尽き、何か月も味気ない飯を食べた。', 'よその家の子が新しい着物を着ているのに、あなたの家の子はまだ裸足だった。', '里正が徭役の催促に来た。駅道の修繕だといい、行けばひと月は戻れない。'])); }
    var ord = L.reg ? L.reg.order : 70;
    if (ord < 45 && a >= 10 && L.cls !== 'slave' && R() < (45 - ord) / 260 * (L.flags.youxia ? 0.4 : 1) && cool(L, 'rob2', 4)) {
      var lost2 = Math.round(Math.min(L.eco.priv + L.eco.cash, (rich ? 3000 : 300) + R() * (rich ? 10000 : 1500)));
      if (lost2 >= 30) { payFrom(L, lost2); add(L, 2.45, 'bad', fresh(L, ['世が乱れ、盗賊の一団が夜に村へ押し入り、あなたの家は' + fmt(lost2) + '銭相当の物を奪われた。', '市へ向かう途中、刃物を持った数人に行く手を阻まれ、身につけていた' + fmt(lost2) + '銭相当の物をすべて奪われた。', '盗賊が隣家の草葺きの家に火を放ち、その混乱に乗じてあなたの家から' + fmt(lost2) + '銭相当の穀物と布帛を奪っていった。'])); }
    }
    if (L.reg && L.reg.ref >= 6 && a >= 10 && R() < 0.15 && cool(L, 'refugee', 3)) add(L, 3.5, 'life', fresh(L, rich ? ['門の外にまた流民の群れがやって来て、ひざまずいて受け入れを乞うた。執事は頑丈そうな者を何人か選び、佃客として抱えた。', '流民があまりに多いので、荘園の佃客頭は、これからは人を僱う賃金をもっと抑えられると言った。'] : ['城外にまたいくつか草小屋が建った。みなよその土地から逃れてきた人々だ。', '流民が村へ物乞いに来て、あなたの家は粥を半椀分けてやった。', '流民があまりに多く、日僱いの賃金は暴落した。あなたが日僱いに出ても、一日に粟一升しかもらえなかった。']));
    if (L.flags.nocoat && R() < 0.5) { L.body -= 3; L.flags.nocoat = false; add(L, 3.6, 'bad', '冬着を質に入れてしまい、その冬あなたは寒さで夜通し眠れず、手足はしもやけだらけになった。'); }
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
          if (mine) add(L, 1.05, 'fam', (k.sex === 'M' ? '息子の' : '娘の') + k.xiao + 'は七歳になり、戸籍に載せることになった。あなたは' + (k.sex === 'M' ? '彼' : '彼女') + 'に正式な名をつけ、' + k.full + 'とした。');
        }
        if (!k.zi && k.full && !L.eth && ((k.sex === 'M' && ka === 20 && R() < (k.lit || L.literate || L.cls === 'gentry' || L.cls === 'clerk' ? 0.9 : 0.3)) || (k.sex === 'F' && ka === 15 && L.cls === 'gentry' && R() < 0.7))) {
          k.zi = giveZi(L, k.sex);
          if (mine) add(L, 1.1, 'fam', k.sex === 'M' ? '息子の' + k.full + 'が冠礼を行い、字を' + k.zi + 'とした。' : '娘の' + k.full + 'が笄礼を行い、字を' + k.zi + 'とした。');
        }
      }
      // 徴兵
      if (!k.apart && k.sex === 'M' && ka >= 16 && ka <= 50 && !k.soldier && ['father', 'sib', 'spouse', 'child'].indexOf(k.rel) >= 0 && L.cls !== 'gentry' && L.cls !== 'slave') {
        if (R() < (conscriptRate(L.zone, y) + L.yConscript) * 0.8) {
          var fk = ctrl(L.zone, y);
          k.soldier = armyOf(fk);
          add(L, 1.25, 'fam', '役所の徴兵で、' + kinLabel(L, k) + 'は' + fname(fk, y) + 'の軍に取られた。');
          if (k.rel === 'child') L.rec.tags.push('war');
        }
      }
      if (k.soldier) {
        (CAMP_BY_Y[y] || []).forEach(function (c) {
          if (!k.alive || c.a.indexOf(k.soldier) < 0 || R() >= (c.p == null ? 0.5 : c.p)) return;
          if (R() < c.r) kinDie(L, k, 'battle', 1.9, y, c.n);
          else if (!k.apart && R() < 0.25) add(L, 3.1, 'fam', kinLabel(L, k) + 'は' + c.n + 'の戦場から生きて帰ってきた。');
        });
        if (k.alive && R() < 0.1) { k.soldier = null; if (!k.apart) add(L, 3.4, 'fam', kinLabel(L, k) + 'は兵役を解かれ、家に帰ってきた。'); }
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
        add(L, 0.9, 'fam', '母が' + (sx === 'M' ? '弟' : '妹') + 'を産んだ。幼名は' + k.name + '。');
      }
    }
  }

  /* ================= 性情与天資 ================= */
  var TRAITS = ['cur', 'cau', 'act', 'per', 'soc', 'ind', 'cmp'];
  var TRAIT_WORD = { cur: '好奇心旺盛', cau: '慎重', act: '活発', per: '頑固', soc: '気さく', ind: '自分の考えを持つ', cmp: '負けず嫌い' };
  function traitWords(L) {
    if (L.age < 6) return [];
    var t = L.tr, ks = TRAITS.slice().sort(function (a, b) { return t[b] - t[a]; });
    var w = ks.filter(function (k) { return t[k] >= 57; }).slice(0, 2).map(function (k) { return TRAIT_WORD[k]; });
    if (L.age >= 15) { if (t.cau - t.soc > 10) w.push('倹約家'); else if (t.soc - t.cau > 12) w.push('豪放'); }
    if (L.age >= 12 && t.cmp >= 70 && t.soc < 48) w.push('嫉妬深い');
    return w.length ? w : ['穏やか'];
  }
  var TALENT = {
    craft: { n: '器用な手先', t: 'あなたは物がどう組み合わさっているかを覚えるのが得意なようだ。大人が農具を直していると、そばで一度見ただけでできるようになった。' },
    memory: { n: '記憶力', t: 'あなたは幼いころから人の言ったことを一字一句違えずに覚えられ、大人たちはひそかに舌を巻いた。' },
    strength: { n: '膂力', t: 'あなたは同じ年頃の子よりがっしりしていて力も強く、粟米の半袋を担ぐことができた。' },
    charm: { n: '人の心を察する力', t: 'あなたは大人の顔色を読むのがうまく、いつも相手の心に響くことを言えた。' }
  };
  var SEEDS = {
    seed1: { q: '夏の昼下がり、大人たちはみな忙しく、あなたはひとり家の前にいる。あなたがよくしていたのは——',
      o: ['年上の子たちについて駆け出していく', 'そばにしゃがんで大人の仕事を眺める', '手近な小物を何度もいじり回す', '慣れた大人のそばを離れない'],
      t: ['あなたはいつも年上の子たちについて村じゅうを駆け回り、真っ黒に日焼けしていた。', 'あなたはよくそばにしゃがんで大人の仕事を眺め、見始めると半日でも飽きなかった。', 'あなたは木切れ一つ、小石数個で午後いっぱい遊んでいられた。', 'あなたはいつも慣れた大人のそばにいて、片時も離れなかった。'],
      fx: [{ act: 8, soc: 4, strength: 0.3 }, { cur: 6, cau: 3, memory: 0.25 }, { per: 7, cur: 4, craft: 0.35 }, { cau: 6, soc: 4, charm: 0.2 }],
      w: function (t) { return [t.act, t.cur, t.per, t.cau]; } },
    seed2: { q: '家に見知らぬ客がやって来た。客は笑顔であなたに話しかけてくる。あなたは——',
      o: ['家族の後ろに隠れる', '黙って相手を見つめる', '問いかけに答える', '自分から寄っていってあれこれ尋ねる'],
      t: ['あなたは大人の後ろに隠れ、目だけをのぞかせていた。', 'あなたは何も言わず、ただ黙って客を見つめていた。客が帰ったあと、あなたは客の言ったことをそっくり真似してみせた。', 'あなたは行儀よく客の問いに答え、物わかりのいい子だと褒められた。', 'あなたは寄っていってあれこれ尋ね、客は質問攻めにされて大笑いした。'],
      fx: [{ cau: 7, ind: -3 }, { cau: 3, cur: 3, memory: 0.15 }, { soc: 5, ind: 3, charm: 0.2 }, { cur: 6, soc: 6, act: 3, charm: 0.1 }],
      w: function (t) { return [t.cau, (t.cau + t.cur) / 2, (t.soc + t.ind) / 2, (t.cur + t.soc) / 2]; } }
  };

  // 同様的性情，不同的出身里是不同的場景（効果与原題相同，四個選項一一対応）
  var SEED_V = {
    seed1: {
      low: { q: '夜が明けたばかり、大人たちはみな畑に出て、あなたは家に残された。あなたがよくしていたのは——',
        o: ['年上の子について畦で落ち穂を拾う', 'かまどのそばにしゃがんで祖母の火加減を見る', '草の茎で小さなおもちゃを編む', '戸口で母の帰りを待つ'],
        t: ['あなたはよく年上の子について畦で落ち穂を拾い、ひとつかみ拾えただけで半日うれしかった。', 'あなたはかまどのそばにしゃがみ、祖母が火をおこして粥を煮るのを夢中で見ていた。', 'あなたは草の茎でバッタや小鳥を編み上げ、編み始めると午後いっぱい続けた。', 'あなたはいつも戸口に座り込み、母が畑から帰るのを待っていた。'] },
      rich: { q: '農繁期、家の作男も佃客もみな畑に出ている。あなたはひとり中庭にいる。あなたがよくしていたのは——',
        o: ['小作の家の子たちと村じゅうを駆け回る', '差配役の後ろについて帳付けを眺める', '倉の桝や秤をいじり回す', '母のそばで仕事の割り振りを眺める'],
        t: ['あなたはよく小作の家の子たちと村じゅうを駆け回り、泥だらけで帰っては母に眉をひそめられた。', 'あなたは差配役の後ろについて帳付けを眺め、見始めると半日でも飽きなかった。', 'あなたは倉の桝や秤を午後いっぱいいじり回していられた。', 'あなたはいつも母のそばにいて、母が婢女たちに仕事を割り振るのを眺めていた。'] },
      gentry: { q: '夏の昼下がり、目上の人々は広間で話し合い、乳母は廊下でうたた寝をしている。あなたがよくしていたのは——',
        o: ['裏口から抜け出し、僮僕の子らと川辺で遊ぶ', '屏風の陰で大人たちの話を盗み聞く', '父の文機の筆墨や算木をいじる', '乳母にまとわりついて離れない'],
        t: ['あなたはよく乳母のうたた寝の隙に裏口から抜け出し、僮僕の子らと川辺で遊んで泥だらけで帰ってきた。', 'あなたはよく屏風の陰で大人たちの話に聞き入り、聞き始めると半日でも飽きなかった。', 'あなたは父の文機の算木を手に、午後いっぱいいじり回していられた。', 'あなたはいつも乳母にまとわりつき、片時も離れなかった。'] },
      merchant: { q: '父の店には人がひっきりなしに出入りしている。あなたはひとり敷居に腰かけている。あなたがよくしていたのは——',
        o: ['店を抜け出して通りの子たちと遊ぶ', '父と客の値段交渉を眺める', '竿秤や銭差しをいじる', '母のそばにいる'],
        t: ['あなたはよく店を抜け出し、通りの子たちと駆け回って姿をくらました。', 'あなたは父と客の値段交渉を眺めるのが何より好きで、すっかり口ぶりまで真似るようになった。', 'あなたは竿秤や銭差しを午後いっぱいいじり回していられた。', 'あなたはいつも母のそばにいて、母が繕い物をしたり帳簿をつけたりするのを眺めていた。'] },
      slave: { q: '主家の屋敷で、大人たちはみな働いている。あなたはひとり薪小屋の入口にいる。あなたがよくしていたのは——',
        o: ['少し年上の僮僕について裏の庭へ行く', '台所の人が料理するのを眺める', '瓦のかけらを並べて遊ぶ', '母の働いている場所から離れない'],
        t: ['あなたはよく少し年上の僮僕について裏の庭に潜り込み、何度も差配役に捕まった。', 'あなたは台所の入口にしゃがんで料理を眺め、いい匂いに唾を飲み込んでいた。', 'あなたは瓦のかけら数個で午後いっぱい遊んでいられた。', 'あなたはいつも母の働いている場所にいて、遠くへは行こうとしなかった。'] },
      nomad: { q: '大人たちはみな牛や羊を追って出かけ、天幕の外は静まり返っている。あなたがよくしていたのは——',
        o: ['年上の子について子馬を追いかける', '老人が皮をなめし、矢柄を削るのを眺める', '羊の距骨をいじって遊ぶ', '祖母のそばにいる'],
        t: ['あなたはよく年上の子について子馬を追いかけ、転んでも泣かなかった。', 'あなたは老人のそばにしゃがみ、皮をなめし矢柄を削るのを夢中で見ていた。', 'あなたは羊の距骨数個で午後いっぱい遊んでいられた。', 'あなたはいつも祖母のそばにいて、一族の歌を歌ってもらっていた。'] },
      eth: { q: '大人たちはみな出かけ、集落は静まり返っている。あなたはひとり家の外にいる。あなたがよくしていたのは——',
        o: ['年上の子について山羊を追いかける', '老人が皮をなめし、竹細工を編むのを眺める', '骨のかけらと縄を数本いじって遊ぶ', '祖母のそばにいる'],
        t: ['あなたはよく年上の子について山じゅう山羊を追いかけ、誰よりも足が速かった。', 'あなたは老人のそばにしゃがみ、皮をなめし竹細工を編むのを夢中で見ていた。', 'あなたは骨のかけら一つと縄数本で午後いっぱい遊んでいられた。', 'あなたはいつも祖母のそばにいて、一族の言葉で歌ってもらっていた。'] }
    },
    seed2: {
      nomad: { q: '漢人の行商人が荷馬を引いて天幕の前にやって来た。塩や鉄器を毛皮と交換するのだ。彼は笑顔であなたに話しかけてくる。あなたは——',
        o: ['家族の後ろに隠れる', '黙って彼を見つめる', '覚えた片言の漢語で答える', '寄っていって荷馬を撫でる'],
        t: ['あなたは家族の後ろに隠れ、目だけをのぞかせていた。', 'あなたは何も言わず、ただ黙って彼を見つめていた。彼が去ったあと、あなたは彼を真似て漢語をいくつか口にしてみた。', 'あなたは覚えた片言の漢語で答えた。彼はたいそう驚いて、小さな塩の塊をくれた。', 'あなたは寄っていって荷馬を撫で、危うく蹴られそうになった。彼は大笑いした。'] },
      low: { q: '天秤棒を担いだ小間物売りが家の前でひと休みし、笑顔であなたに話しかけてきた。あなたは——',
        o: ['母の後ろに隠れる', '黙って彼の荷を見つめる', '問いかけに答える', '寄っていって荷の中身を尋ねる'],
        t: ['あなたは母の後ろに隠れ、目だけをのぞかせていた。', 'あなたは何も言わず、ただ彼の荷をじっと見ていた。彼が去ったあと、あなたは彼の売り声の節回しを真似してみせた。', 'あなたは行儀よく彼の問いに答えた。小間物売りは物わかりのいい子だと褒めて、赤い髪紐を一本くれた。', 'あなたは寄っていってあれこれ尋ね、小間物売りは質問攻めにされて大笑いした。'] },
      rich: { q: '県の小役人が家へ酒を飲みに来て、あなたを見かけると笑顔で話しかけてきた。あなたは——',
        o: ['母の後ろに隠れる', '黙って彼を見つめる', '問いかけに答える', '寄っていって腰に下げた物が何か尋ねる'],
        t: ['あなたは母の後ろに隠れ、出てこようとしなかった。', 'あなたは何も言わず、ただ黙って彼を見つめていた。彼が帰ったあと、あなたは彼の言ったことをそっくり真似してみせた。', 'あなたは行儀よく彼の問いに答えた。彼は父に、この子はいずれ読み書きができるようになるだろうと言った。', 'あなたは寄っていって、腰に下げた物は何かと尋ねた。彼は笑って、役所の印綬だ、もっとも小役人のだがね、と言った。'] },
      gentry: { q: '高い冠に広い帯を締めた客が父を訪ねてきた。父はあなたを呼んで挨拶させた。あなたは——',
        o: ['乳母の後ろに隠れる', '黙って相手を見つめる', '行儀よく礼をして受け答えする', '寄っていってどこから来たのか尋ねる'],
        t: ['あなたは乳母の後ろに隠れて出てこようとしなかった。父の顔が曇った。', 'あなたは何も言わず、ただ黙って客を見つめていた。客が帰ったあと、あなたは客の言ったことをそっくり真似してみせた。', 'あなたは行儀よく礼をして受け答えした。客は父に「この子は必ずや大成しよう」と言った。', 'あなたは寄っていってあれこれ尋ねた。父が叱ろうとすると、客はそれを制し、笑いながら一つ一つ答えてくれた。'] },
      merchant: { q: 'よその郡から来た旅商人が家にひと晩泊まり、笑顔であなたに話しかけてきた。あなたは——',
        o: ['母の後ろに隠れる', '黙って彼を見つめる', '問いかけに答える', '寄っていってどこを旅してきたのか尋ねる'],
        t: ['あなたは母の後ろに隠れ、目だけをのぞかせていた。', 'あなたは何も言わず、ただ黙って彼を見つめていた。彼が去ったあと、あなたは彼の訛りを真似してみせた。', 'あなたは行儀よく彼の問いに答えた。彼はあなたを利発だと褒め、いずれ商売に向いた器だと言った。', 'あなたはどこを旅してきたのかとしつこくせがんだ。彼はひと晩じゅう語り、江陵から洛陽までの話をしてくれた。'] },
      slave: { q: '主人の客が中庭を通りかかり、あなたを見下ろして、いくつかと尋ねた。あなたは——',
        o: ['母の後ろに隠れる', 'うつむいて黙っている', 'ひざまずいて答える', '顔を上げて誰なのか尋ねる'],
        t: ['あなたは母の後ろに隠れた。母はあわててあなたを引っ張り、客に叩頭させた。', 'あなたはうつむいて黙っていた。客が去ったあとも、あなたはその姿を長いこと覚えていた。', 'あなたは大人を真似てひざまずき、受け答えした。差配役は、この子は躾ができていると言った。', 'あなたは顔を上げて誰なのかと尋ねた。母は青ざめたが、客のほうは笑っていた。'] },
      eth: { q: '漢人の行商人が集落へ塩と鉄器を交換しに来て、笑顔であなたに話しかけてきた。あなたは——',
        o: ['家族の後ろに隠れる', '黙って彼を見つめる', '覚えた片言の漢語で答える', '寄っていって品物に触る'],
        t: ['あなたは家族の後ろに隠れ、目だけをのぞかせていた。', 'あなたは何も言わず、ただ黙って彼を見つめていた。彼が去ったあと、あなたは彼を真似て漢語をいくつか口にしてみた。', 'あなたは覚えた片言の漢語で答えた。彼はたいそう驚いて、小さな塩の塊をくれた。', 'あなたは寄っていって品物に触り、彼はそれを面白がって大笑いした。'] }
    }
  };
  function seedVar(L, y) {
    if (L.eth) return ['qiang', 'xiongnu', 'wuhuan', 'xianbei'].indexOf(L.eth) >= 0 ? 'nomad' : 'eth';
    if (L.cls === 'slave') return 'slave';
    if (L.cls === 'gentry') return 'gentry';
    if (L.cls === 'merchant') return 'merchant';
    var k = lifeTier(L, y).k;
    return k === 'high' || k === 'top' ? 'rich' : k === 'low' ? 'low' : null;
  }
  function applySeed(L, key, i) {
    var f = SEEDS[key].fx[i];
    for (var k in f) { if (L.tr[k] != null) L.tr[k] = clamp(L.tr[k] + f[k], 5, 95); else L.tal[k] = clamp(L.tal[k] + f[k], 0, 1); }
  }

  /* ================= 眼下所重 ================= */
  var FOCUS = {
    grow: { n: '成長', v: '大きくなる', pull: 'まだ襁褓の中にいて' },
    play: { n: '遊び', v: 'あちこちで遊び回る', pull: '遊びたい気持ちが強すぎて' },
    help: { n: '家計の手伝い', v: '家の仕事を手伝う', pull: '家の人手がどうしても足りず' },
    study: { n: '読み書きの勉強', v: '読み書きを学ぶ', pull: '手元の書物がどうしても手放せず' },
    craft: { n: '手仕事を学ぶ', v: '手仕事を学ぶ', pull: 'つい道具や器物をいじりたくなって' },
    body: { n: '体を鍛える', v: '力をつける', pull: 'じっとしていられず' },
    social: { n: '友人づきあい', v: 'あちこちで人と交わる', pull: '友人が次々と訪ねてきて' },
    livelihood: { n: '生計を立てる', v: '外に出て稼ぐ', pull: '家では米が尽きかけていて' },
    house: { n: '家を切り盛りする', v: '家を切り盛りする', pull: '一家の老いも若きもあなたを頼りにしていて' },
    save: { n: '蓄財', v: '出費を切り詰める', pull: '家の蓄えのことがいつも気がかりで' },
    career: { n: '仕官を目指す', v: '何か官職を得ようとする', pull: '郡へ顔を出すよう勧める人がいて' },
    kids: { n: '子育て', v: '子どもの面倒を見る', pull: '子どもが次々と病気になり' },
    fame: { n: '名望を高める', v: '村で名望を高める', pull: '村の人が仲裁を頼みに来て' },
    health: { n: '養生', v: '体を養生する', pull: '体がどうにも言うことを聞かず' },
    family: { n: '家族と過ごす', v: '家族と過ごす', pull: '家族があなたを放してくれず' },
    teach: { n: '後進を教える', v: '後輩を教え導く', pull: '後輩たちがいつも訪ねてきて' },
    village: { n: '村の世話', v: '村のことに心を砕く', pull: '村の揉め事がいつも持ち込まれて' },
    rest: { n: 'のんびり暮らす', v: 'のんびり暮らす', pull: 'すっかり疲れ果てていて' },
    army: { n: '軍中で身を立てる', v: '軍中で身を立てる', pull: '軍令は山のごとく重く' },
    enlist: { n: '従軍する', v: '軍に身を投じる', pull: 'どうしても従軍したくて' },
    weave: { n: '糸紡ぎと機織り', v: '糸を紡ぎ布を織る', pull: '戸調に納める布を家が待っていて' },
    travel: { n: '諸国を遊歴する', v: '遊歴に出る', pull: '旅に出たい気持ちを抑えきれず' },
    leisure: { n: '琴と書を楽しむ', v: '書を読み琴を弾く', pull: 'ただ静かに暮らしたくて' },
    estate: { n: '家産の経営', v: '田荘の経営に励む', pull: '田荘の仕事があなたなしでは回らず' }
  };
  var WHY = { play: 'あなたはまだ幼く、遊びたい盛りだ', help: '家の人手が足りない', study: 'あなたは好奇心旺盛で学ぶのが好きだ', craft: 'あなたは手先が器用で、いつも道具をいじりたがる', body: 'あなたはじっとしていられない', social: 'あなたは気さくな性分で、にぎやかなのが好きだ', livelihood: '自分の食い扶持は自分で稼がねばならない', house: '一家の老いも若きもあなたを頼りにしている', save: 'あなたは慎重な性分で、いつも蓄えを残そうと考えている', career: 'あなたはずっと、ひとかどの事業を成し遂げたいと思っている', kids: '子どもがまだ小さい', fame: 'あなたは村での評判をとても気にしている', health: 'このところ体が以前ほど丈夫でない', family: '子や孫に囲まれている', teach: 'あなたにはいくらかの学問がある', village: '村の人々があなたを信頼している', rest: 'あなたはもう年を取った', army: '軍中に身を置いている', enlist: '一生わずかな畑を守って終わるのは嫌だ', grow: 'あなたはまだ襁褓の中にいる', weave: '一家の着物も戸調に納める絹も、あなたの両手にかかっている', travel: '外の世界を見てみたい', leisure: '家は豊かで、あなたには暇がある', estate: '家の田畑は多く、誰かが目を配らねばならない' };
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
    if ((k === 'house' || k === 'help' || k === 'livelihood' || k === 'save') && poorNow(L)) return L.eco.debt > 0 ? '家にはまだ借金がある' : '家の穀物の蓄えが乏しい';
    if (k === 'kids' && kidsUnder(L, 2) > 0) return '家に新しい子が生まれた';
    if (k === 'health' && L.injury) return '古傷がしばしば痛む';
    if (k === 'study' && L.found.memory) return 'あなたは記憶力がずば抜けていて、人より早く書物を覚えられる';
    if (k === 'craft' && L.found.craft) return 'あなたは生まれつき手先が器用だ';
    if (L.lastFocus === k && (L.focusYears || 0) >= 3 && L.age >= 15) return '長年そうしてきて、もはや習い性になっている';
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
        // 人不一定全聴你的，但你堅持得越久、去年剛拗過一回，就越聴話
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
    if (F.dev) add(L, 0.3, 'note', 'あなたはもともと' + FOCUS[F.man].v + 'つもりだったが、' + FOCUS[F.auto].pull + '、この一年も結局' + FOCUS[F.auto].v + 'ことになった。');
    switch (k) {
      case 'play': L.body += 0.8; t.act += 0.4; t.soc += 0.3; break;
      case 'help': L.body += 0.4; t.per += 0.3; break;
      case 'study':
        var teach = teacherAt(L);
        L.learn += (teach ? 4 + R() * 4 : 1 + R() * 2) * (L.found.memory ? 1.4 : 1) * (a > 30 ? 0.6 : 1);
        t.cur += 0.3; t.per += 0.2;
        if (!teach && !L.literate && a < 16 && R() < 0.25) add(L, 2.1, 'life', '家には教えてくれる人がおらず、あなたは字の読める人について切れ切れに学ぶしかなかった。');
        break;
      case 'craft':
        L.craft += (3 + R() * 5) * (L.found.craft ? 1.5 : 1);
        if (L.craft >= 40 && a >= 16 && !L.office && !L.soldier && ['peasant', 'tenant', 'tuntian', 'soldier', 'clerk'].indexOf(L.cls) >= 0 && L.job !== '工匠') { L.job = '工匠'; add(L, 2.3, 'good', 'あなたの腕前は次第に評判となり、村の人々が仕事を頼みに来るようになった。'); }
        break;
      case 'body': L.body += 1.8 + (L.found.strength ? 1 : 0); break;
      case 'social':
        L.standing += 1.5 + (L.found.charm ? 1 : 0); t.soc += 0.6;
        if (R() < 0.4) add(L, 2.25, 'life', fresh(L, a < 15 ? ['あなたは毎日里の子どもたちとつるんで過ごし、どこの家で何があってもあなたの姿があった。', 'あなたは子どもたちの頭になり、皆を連れて山で鳥の巣を探し、川で魚を手づかみした。'] : L.cls === 'gentry' || L.literate ? ['あなたは郡の若い士人たちとよく行き来し、人物を品評し、時事を論じ合った。', 'あなたは宴席で如才なく振る舞い、郡の年長者たちに名を覚えられた。', 'あなたは友人数人と連れ立って名士を訪ね、夜更けまで彼らの清談に耳を傾けた。'] : ['あなたは同郷の若者たちとよく行き来し、ともに酒を飲み、狩りをし、語り合った。', 'あなたが友人の難しい頼みごとを片付けてやると、彼は会う人ごとにあなたは義理堅い男だと言いふらした。', '村で何かあると、皆あなたに相談したがった。']));
        break;
      case 'fame': L.standing += 1.5; if (a >= 30) L.fame += 0.8; break;
      case 'career': L.fame += 0.6; L.standing += 0.5; break;
      case 'health': L.body += 1.2; break;
      case 'family': L.standing += 0.4; break;
      case 'teach':
        L.standing += 1;
        if (L.literate) liveKin(L, function (x) { return x.rel === 'child' && y - x.by >= 6 && y - x.by <= 25 && !x.lit; }).forEach(function (x) {
          if (R() < 0.3) { x.lit = true; add(L, 2.6, 'good', 'あなたは' + kinLabel(L, x) + 'に字を教え、読めるようにした。'); }
        });
        break;
      case 'village': L.standing += 2; break;
      case 'rest': L.body += 0.4; break;
      case 'weave': L.eco.priv += Math.round(150 + R() * 250); break;
      case 'enlist':
        if (!L.soldier && R() < (chaos(y) > 1.05 || L.eth ? 0.7 : 0.45)) {
          var hadOff = L.office;
          if (hadOff) { add(L, 1.28, 'life', 'あなたは' + hadOff + 'の職を辞し、筆を投げうって軍に身を投じた。'); L.office = null; }
          if (L.eth) add(L, 1.28, 'life', 'あなたは一族の若者を数人連れて、' + fname(ctrl(L.zone, y), y) + 'の軍に身を投じた。役所はかねてより' + D.ETH[L.eth].n + 'の騎射と勇猛さを重んじていた。');
          enlist(L, y, 1.3, true);
          if (hadOff && !L.mil) { L.mil = L.cls === 'gentry' && L.gate >= 2 ? 2 : 1; L.job = ['軍卒', '屯長', '軍司馬'][L.mil]; L.milMax = L.job; add(L, 1.35, 'good', '官に就いていた経歴を買われ、あなたは入営してすぐに' + L.job + 'となった。'); }
          if (!L.mil && (L.cls === 'gentry' || (L.flags.martial && L.found.strength))) { L.mil = 1; L.job = '屯長'; L.milMax = '屯長'; add(L, 1.35, 'good', '出自と腕っぷしを買われ、あなたは入営してすぐに屯長となった。'); }
        } else if (!L.soldier) add(L, 1.3, 'life', 'あなたは軍営へ従軍のことを尋ねに行ったが、この年は兵の募集がなかった。');
        break;
      case 'travel':
        var richT = L.cls === 'gentry' || L.wealth >= 60 || !!L.office;
        L.learn += richT ? 2 : 2.5; L.fame += 1; L.standing += 1; t.cur += 0.4; t.act += 0.3;
        payFrom(L, richT ? 2000 : 600);
        var tsp = R() < 0.45 ? visit(L, y) : null;
        if (tsp) add(L, 2.2, 'life', tsp.t);
        else if (R() < 0.6) add(L, 2.2, 'life', fresh(L, richT ? ['あなたは車に乗って遊歴に出て、洛陽に至り、太学の門外で石経を見た。', 'あなたは車で近隣の数郡を巡り、何人かの名士を訪ねた。', 'あなたは江に沿って旅をし、見たこともない風物を数多く目にした。', 'あなたは僮僕を二人連れて遠く旅し、泰山に登り、魯国では孔子の旧宅に参った。', 'あなたは襄陽まで遊歴してそこに数か月滞在し、北から来た儒者の講義を聴いた。'] : ['あなたは書物の箱を背負って歩いて遊学し、道中は寺や農家に泊めてもらった。', 'あなたは数百里の道を歩いてある経師に入門し、その門下でひと冬書物を書き写した。', 'あなたは行商の隊について旅に出て、道々人の手紙を代筆したり帳簿をつけたりして、多くの世間を見た。', 'あなたはよそで一年遊学し、草鞋を三足履きつぶした。帰ってきたときは日に焼けて痩せていたが、見識は広がっていた。']));
        if (R() < 0.12 && richT) { L.flags.connected = true; add(L, 2.3, 'good', '遊歴の途中、あなたはよその郡の名士何人かと親交を結び、その後もたびたび書簡を交わした。'); }
        break;
      case 'leisure': L.body += 1; L.learn += 1; L.standing += 0.5; break;
      case 'estate': L.eco.cash += Math.round(L.land * 4); if (R() < 0.15) { L.land += 10; add(L, 2.2, 'life', 'あなたはまた十畝の良田を買い足した。'); } break;
    }
    TRAITS.forEach(function (x) { t[x] = clamp(t[x], 5, 95); });
    // 天資在少年時顕露
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

  /* ================= 家計 ================= */
  var PRICE = 100, LANDP = 1000;
  var SAL = { 里正: 1500, 亭長: 3000, 遊徼: 4000, 郷嗇夫: 5000, 書佐: 9000, 計吏: 12000, 県長: 40000, 郎官: 30000, 県令: 60000, 幕僚: 30000, 郡守: 120000, 尚書郎: 50000, 刺史: 150000, 九卿: 200000 };
  // 平民的副業：名目与一年大約的進項
  var SIDE_JOB = { fan: ['村々を回る行商', 1100], jiu: ['酒造りと醤造り', 700], xiu: ['刺繍', 900], sang: ['桑と麻', 500], veg: ['野菜売り', 700], tan: ['炭焼き', 900], xie: ['草鞋編みとむしろ織り', 450], yu: ['漁', 650], fang: ['糸紡ぎ', 500], zhu: ['豚と鶏の飼育', 600], feng: ['繕い物と洗濯', 350] };
  var JOBINC = { 卜者: 700, 匠人: 1200, 歌者: 900, 画工: 1300, 里父老: 300, 医者: 1500, 巫祝: 800, 門客: 2000, 塾師: 900, 穏婆: 600, 山賊: 1500, 官匠: 1800, 代書先生: 1000, 遊侠: 1200, 中人: 1200, 方士: 1000, 媒人: 600, 経師: 3000 };
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
    if (L.eth) return [['役所への貢納', 200]];
    if (L.cls === 'tuntian') return [];
    if (L.flags.fugitive) return [];
    var ad = m.adults - m.elders, adM = Math.max(0, Math.round(m.wM - 0.4 * m.elders)), k7 = Math.round(m.kids * 0.6);
    if (g === 'jin' && y >= 280) { out.push(['戸調（絹三匹・綿三斤）', 1800]); out.push(['田租', 400]); }
    else if ((g === 'wei' || g === 'jin') && y >= 204) { out.push(['戸調（絹二匹・綿二斤）', 1200]); if (owner && L.land) out.push(['田租（一畝あたり四升）', L.land * 4]); }
    else {
      var mu = g === 'wu' && y >= 200 ? 1.25 : g === 'shu' && y >= 214 ? 1.2 : 1;
      if (ad > 0) out.push(['算賦（成人一人につき百二十銭）', Math.round(ad * 120 * mu)]);
      if (k7) out.push(['口銭', k7 * 23]);
      if (adM) out.push(['更賦', Math.round(adM * 300 * mu)]);
      if (owner && H) out.push(['田租（収穫の三十分の一）', Math.round(H / 30 * PRICE)]);
    }
    var lt = polSum(L.zone, y, 'landTax');
    if (lt && owner && L.land) out.push(['修宮銭（一畝あたり' + lt + '銭）', L.land * lt]);
    var tm = L.cls === 'gentry' ? 1.5 * polMul(L.zone, y, 'gtax') : polMul(L.zone, y, 'tax');
    if (tm !== 1) out.forEach(function (x) { x[1] = Math.round(x[1] * tm); });
    return out;
  }
  function economyYear(L, y) {
    var R = L.R, E = L.eco, rec = L.rec, fo = rec.focus ? rec.focus.eff : null, a = L.age, c = L.cls;
    if (c === 'slave') { if (a >= 15) E.priv += Math.round(10 + R() * 50); rec.ledger = null; L.grainMonths = null; return; }
    // 诸侯府中的姬妾：吃穿用度都由府里供给，不再有自家的账
    if (inHH(L)) { E.debt = 0; rec.ledger = null; L.grainMonths = null; L.crisis = false; return; }
    if (L.band || (L.soldier && liveKin(L, function (k) { return !k.out; }).length === 0)) {
      var pay = 2400, keep = Math.round(pay * (L.tr.cau > 55 ? 0.6 : 0.35));
      E.priv += keep;
      rec.ledger = { solo: true, inc: [['軍の給金', pay]], exp: [['軍中での自分の出費', pay - keep]], I: pay, X: pay - keep, net: keep, head: true };
      L.lastNet = keep; L.grainMonths = null;
      return;
    }
    var m = members(L, y), sh = shock(L, y);
    var RGN = D.REGION && D.REGION[L.zone];
    var hf = sh.h * (RGN ? RGN.yield : 1) * (L.yHarvest || 1) * (0.85 + R() * 0.3) * (E.tools ? 1.08 : 1) * (fo === 'house' ? 1.06 : 1) * (L.harvestB || 1) * polMul(L.zone, y, 'harvest');
    L.yHarvest = 1;
    var inc = [], exp = [], H = 0, note = '';
    var cap = (m.wM * 45 + m.wF * 12) * (E.ox > 0 ? 1.35 : 1);
    var owner = ['peasant', 'clerk', 'soldier', 'artisan', 'merchant'].indexOf(c) >= 0;
    if (c === 'gentry') { H = L.land * 2.5 * 0.5 * 0.8 * hf; note = '佃客の納める小作料'; }
    else if (c === 'tenant') { var sh6 = L.flags.rent6 ? 0.4 : 0.5; H = Math.min(cap, 70) * 2.5 * hf * sh6; note = L.flags.rent6 ? '豪族の田を小作、地主が六割を取る' : '豪族の田を小作、収穫の半分を納める'; }
    else if (c === 'tuntian') { H = Math.min(cap * 1.35, 60) * 2.8 * hf * 0.4; note = '屯田、官が六・民が四'; }
    else if (c === 'tribal') { H = m.cons * (0.55 + 0.35 * hf); note = '牧畜と山の畑'; }
    else if (owner) {
      var own = Math.min(L.land, cap), spare = cap - own;
      H = own * 2.5 * hf;
      note = L.land > 0 ? '自作田' + L.land + '畝' : '';
      if (spare > 8 && (c === 'peasant' || c === 'soldier' || (c === 'artisan' && m.wM > 1.5))) { H += Math.min(spare, 40) * 0.6 * 2.5 * hf * 0.5; note += (note ? '、' : '') + 'ほかに他人の田も少し小作'; }
    }
    H = Math.round(H);
    var C = Math.round(m.cons);
    if (H > 0) inc.push(['田の収穫 ' + H + ' 石' + (RGN && c !== 'tribal' ? RGN.staple : '') + (note ? '（' + note + '）' : ''), H * PRICE]);
    exp.push(['口糧 ' + C + ' 石（' + m.n + ' 人分）', C * PRICE]);
    if (C > H && sh.p > 1.05) exp.push(['糧価高騰（穀物の値は平年の約' + sh.p.toFixed(1) + '倍）', Math.round((C - H) * PRICE * (sh.p - 1) * 0.5)]);
    if (H > C && sh.p > 1.05) inc.push(['余った穀物が高値で売れた', Math.round((H - C) * PRICE * (Math.min(sh.p, 1.6) - 1))]);
    if (m.wF > 0 && c !== 'gentry') inc.push(['紡織（家の女たちが織ったもの）', Math.round(m.wF * 700 * (E.loom ? 1.3 : 1) * (sh.h < 0.6 ? 0.7 : 1) * (fo === 'weave' ? 1.4 : 1))]);
    if (c === 'artisan') inc.push(['手仕事', Math.round(Math.max(1, m.wM) * 5500 + L.craft * 40)]);
    else if (L.job === '工匠') inc.push(['請け仕事', Math.round(600 + L.craft * 40)]);
    if (c === 'merchant') {
      inc.push(['商い', Math.round(E.stock * (0.12 + R() * 0.25) * (chaos(y) > 1.1 ? 0.8 : 1) + m.wM * 3000 + (E.cart ? 2500 : 0) + (E.porter > 0 ? 1500 : 0))]);
      if (E.porter > 0) { E.porter--; exp.push(['人足の賃金', 1000]); }
    }
    if (c === 'tribal') inc.push(['家畜', Math.round(E.stock * 0.12 + m.wM * 800)]);
    if (c === 'soldier') inc.push(['士家への支給', m.n * 400]);
    var hs = L.sex === 'F' && L.married && L.spouseK && L.spouseK.alive && !L.spouseK.apart && !L.spouseK.famous ? L.spouseK : null;
    if (hs && H_SAL[hs.job]) inc.push(['夫の俸禄（' + hs.job + '）', H_SAL[hs.job]]);
    if (L.office && SAL[L.office]) inc.push(['俸禄（' + L.office + '）', SAL[L.office]]);
    if (JOBINC[L.job]) inc.push([L.job + 'としての収入', JOBINC[L.job]]);
    var f = L.kin[0];
    if (c === 'clerk' && f.alive && !f.apart && !f.out && y - f.by < 60 && !L.split) inc.push(['父の俸禄', 9000]);
    if (c === 'gentry') inc.push(['家の産業', Math.round(L.land * 20)]);
    var wage = 0;
    if (fo === 'livelihood') wage += 1500;
    if (fo === 'help' && a >= 10) wage += 500;
    if ((c === 'peasant' || c === 'tenant') && H < C) wage += Math.round(Math.max(0, m.wM - 1) * 900);
    if (wage) inc.push(['僱われ仕事', wage]);
    if (E.labor > 0) { inc.push(['出稼ぎの仕送り', 2500]); E.labor--; }
    if (L.side && !L.soldier && !L.band) {
      var SD = SIDE_JOB[L.side.k];
      if (y > L.side.until || a >= 62) L.side = null;
      else if (SD) inc.push(['副業：' + SD[0], Math.round(SD[1] * (sh.h < 0.6 ? 0.7 : 1) * (0.8 + R() * 0.4))]);
    }
    if (L.soldier) inc.push(['軍の給金の仕送り', 1200]);
    var sup = elderSupport(L, y);
    if (sup) inc.push(['子による扶養', sup]);
    exp.push(['衣類', m.n * 250]);
    exp.push(['塩・鉄器・雑費', 300 + m.n * 80]);
    taxes(L, y, m, H, owner).forEach(function (x) { exp.push(x); });
    if (L.schooling && a < 18 && c !== 'gentry') exp.push(['束脩（謝礼）', 300]);
    if (c === 'gentry') exp.push(['賓客・部曲・家庭教師', Math.round(L.land * 8)]);
    if (L.body < 30 || L.injury) exp.push(['医薬', 200]);
    if (E.debt > 0) exp.push(['借金の利息', Math.round(E.debt * 0.15)]);
    if (fo === 'social') exp.push(['交際費', c === 'gentry' ? 2000 : 300]);
    if (fo === 'career') exp.push(['付け届け', c === 'gentry' ? 5000 : 800]);
    if (fo === 'fame') exp.push(['客をもてなす宴', c === 'gentry' ? 6000 : 1000]);
    var mult = fo === 'save' ? 0.92 : fo === 'house' ? 0.96 : 1;
    var I = 0, X = 0;
    inc.forEach(function (x) { I += x[1]; });
    exp.forEach(function (x) { if (x[0].indexOf('口糧') !== 0 && x[0].indexOf('糧価') !== 0) x[1] = Math.round(x[1] * mult); X += x[1]; });
    var net = I - X, head = isHead(L);
    if (net >= 0) {
      var rep = Math.min(E.debt, Math.round(net * 0.6)), left = net - rep;
      E.debt -= rep;
      if (!head && a >= 15) { var share = Math.round(left * (fo === 'save' ? 0.15 : 0.07)); left -= share; E.priv += share; }
      E.cash += left;
    } else {
      E.cash += net;
      if (E.cash < 0) { add(L, 3.85, 'bad', (head ? 'あなたの家' : '家') + 'は収入が支出に追いつかず、蓄えも使い果たして、さらに' + fmt(-E.cash) + '銭相当の借金を背負った。'); E.debt += -E.cash; E.cash = 0; L.rec.tags.push('hard'); }
      else if (net < -1500) add(L, 3.85, 'bad', '家は収入が支出に追いつかず、' + fmt(-net) + '銭相当の蓄えを取り崩して、ようやくこの一年を乗り切った。');
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
      add(L, 3.7, 'life', pick(R, ['このところ懐に余裕があり、あなたは' + fmt(amt) + '銭相当を使って酒と肉を買い、近所の人々と酌み交わした。', '友人が遠くから訪ねてきたので、あなたは酒食の膳を整え、' + fmt(amt) + '銭相当を費やした。', 'あなたは家のために新しい着物や道具をいくらか買い足し、' + fmt(amt) + '銭相当を使った。']));
    } else if (lav < -0.2 && R() < 0.15) add(L, 3.7, 'life', 'あなたは新しい着物ひとつ買うのも惜しみ、余った金はすべて貯めておいた。');
  }
  function laborCandidate(L, y) {
    var k = liveKin(L, function (x) { return (x.rel === 'child' || x.rel === 'sib') && x.sex === 'M' && !x.out && !x.soldier && y - x.by >= 14 && y - x.by <= 35; })[0];
    if (k) return k;
    return L.sex === 'M' && L.age >= 16 && L.age <= 45 && !L.office ? 'self' : null;
  }
  function crisisAct(L, y, c, k) {
    var E = L.eco, R = L.R, who = c.who ? c.who + 'の決断で、家は' : 'あなたの家は';
    switch (k) {
      case 'sell':
        var n = Math.min(c.n, L.land), got = Math.round(n * LANDP * (shock(L, y).p > 1.5 ? 0.45 : 0.7)), rp = Math.min(E.debt, got);
        L.land -= n; E.debt -= rp; E.cash += got - rp;
        if (E.ox && L.land < 10 && R() < 0.5) E.ox = 0;
        add(L, 0.5, 'bad', who + '田を' + cnNum(n) + '畝売り払い、' + fmt(got) + '銭相当を得て、' + (E.debt > 0 ? '借金の一部を返した。' : '借金を完済した。'));
        if (L.land === 0 && L.cls === 'peasant') { L.cls = 'tenant'; add(L, 0.55, 'bad', '田をすべて売り払ってしまい、あなたの家はよその土地を小作するしかなくなった。'); }
        break;
      case 'borrow': E.debt += 2000; E.cash += 2000; add(L, 0.5, 'bad', who + 'またも里の豪族から二千銭を借りた。利息はひどく重かった。'); break;
      case 'labor':
        E.labor = 3;
        add(L, 0.5, 'life', c.lab === 'self' ? 'あなたは隣県の大きな家に僱われて働き、稼ぎを家に送った。' : kinLabel(L, c.lab) + 'は隣県の大きな家に僱われに行き、毎年いくらか仕送りしてくれるようになった。');
        break;
      case 'kin':
        L.cls = 'tenant'; if (L.job === '農') L.job = '佃戸';
        E.debt = 0; L.land = 0; E.ox = 0; L.standing -= 4;
        add(L, 0.5, 'bad', who + '田地を土地の豪族に差し出し、以後その佃客となった。借金はもう返さなくてよくなった。');
        break;
      case 'flee': E.debt = 0; relocate(L, c.dest, 0.6, 'あなたの家は夜陰に乗じて故郷を離れ、債主の手を逃れて{dest}へ落ち延びた。', 0.04, y); break;
      case 'friend':
        var bf = bestFriend(L, 0);
        if (bf && R() < 0.6) { var got = Math.min(E.debt, 1500 + Math.round(R() * 2000)); E.debt -= got; affAdd(bf, -5); add(L, 0.5, 'good', bf.name + 'は自分の家の蓄えを持ち出し、あなたに代わって' + fmt(got) + '銭相当の借金を返してくれた。あなたは言葉が出なかった。'); }
        else if (bf) { affAdd(bf, -3); add(L, 0.5, 'bad', bf.name + 'にも出せる金はなく、ただひと晩あなたのそばに座っていてくれた。'); }
        break;
    }
  }

  /* ================= 支用余財 ================= */
  function farmerish(L) { return ['peasant', 'tenant', 'tuntian', 'soldier', 'clerk'].indexOf(L.cls) >= 0 && !L.soldier && !L.band; }
  function richish(L) { return L.cls === 'gentry' || L.cls === 'merchant' || !!L.office; }
  function kidsWith(L, f) { var y = L.by + L.age; return liveKin(L, function (k) { return k.rel === 'child' && !k.out && f(y - k.by, k); }); }
  var SPEND = [
    // —— 謀劃：毎年一件，自己動手改変人生 ——
    { id: 'pl_teacher', g: '謀劃（毎年一件）', plan: 1, n: '師について読み書きを学ぶ', c: 800, ok: function (L, y) { return L.planY !== y && L.age <= 35 && !L.literate && !condNoRead(L); }, fx: function (L, y) { L.planY = y; L.learn += 12; return 'あなたは村の老先生に弟子入りし、毎日仕事を終えると先生の家へ字を習いに通った。' + (L.learn >= 25 ? '一年たって、ずいぶん多くの字が読めるようになった。' : ''); } },
    { id: 'pl_craft', g: '謀劃（毎年一件）', plan: 1, n: '師について手に職をつける', c: 600, ok: function (L, y) { return L.planY !== y && L.age <= 30 && ['peasant', 'tenant', 'tuntian', 'clerk'].indexOf(L.cls) >= 0 && !L.office && !L.soldier && !L.flags.apprenticeY; }, fx: function (L, y) { L.planY = y; L.flags.apprenticeY = y; if (L.sex === 'M') L.job = '学徒'; L.craft += 6; return 'あなたは束脩を用意して、年老いた職人に弟子入りした。三年の徒弟、三年の手伝い奉公——それがしきたりだ。'; } },
    { id: 'pl_office', g: '謀劃（毎年一件）', plan: 1, n: '名刺を用意して県令に拝謁し、職を求める', c: 1500, ok: function (L, y) { return L.planY !== y && L.sex === 'M' && L.literate && !L.office && !L.soldier && L.age >= 18 && L.age <= 50; }, fx: function (L, y) { L.planY = y; var p = 0.15 + L.fame / 150 + L.learn / 300 + (L.cls === 'gentry' ? 0.2 : 0) + (L.clanUp ? 0.1 : 0); if (L.R() < p) { L.office = '書佐'; L.officeMax = L.officeMax || '書佐'; L.job = '書佐'; return '県令はあなたの字を見て、律令についていくつか問いただすと、県廷に留めて書佐とした。'; } L.fame += 1; return 'あなたは県廷の外で丸一日待たされたが、県令は簾越しに「わかった」と一言いっただけだった。この金は無駄になった。'; } },
    { id: 'pl_pinti', g: '謀劃（毎年一件）', plan: 1, n: '郡の名士を訪ね、品題の一言を求める', c: 2000, ok: function (L, y) { return L.planY !== y && L.sex === 'M' && L.literate && L.age >= 16 && L.age <= 35 && (L.cls === 'gentry' || L.learn >= 40); }, fx: function (L, y) { L.planY = y; if (L.R() < 0.3 + L.fame / 120 + (L.cls === 'gentry' ? 0.15 : 0)) { L.flags.praised = true; L.fame += 6; return '名士はあなたと半日語り合い、門まで見送る際にひと言褒めてくれた。ひと月もしないうちに、その言葉は郡じゅうに広まった。'; } return '名士はあなたと二言三言あいさつを交わしただけで、茶を出して客を帰らせた。'; } },
    { id: 'pl_trade', g: '謀劃（毎年一件）', plan: 1, n: '元手をかき集めて小商いを始める', c: 2000, ok: function (L, y) { return L.planY !== y && L.age >= 16 && L.age <= 55 && ['peasant', 'tenant', 'artisan', 'clerk'].indexOf(L.cls) >= 0 && !L.soldier && !L.side; }, fx: function (L, y) { L.planY = y; if (L.R() < 0.2) return 'あなたは品物を仕入れて売りに出たが、道中で追いはぎに遭い、元手をすっかり失った。'; L.side = { k: 'fan', from: y, until: y + 8 }; return 'あなたはこの金で塩や布、針と糸を仕入れ、農閑期には天秤棒を担いで村々を売り歩いた。それから数年、家にはもう一つ収入の道ができた。'; } },
    { id: 'pl_land', g: '謀劃（毎年一件）', plan: 1, n: '敷金を払い、大きな家から田を数十畝余分に借りる', c: 1000, ok: function (L, y) { return L.planY !== y && isHead(L) && ['peasant', 'tenant'].indexOf(L.cls) >= 0 && L.land < 40; }, fx: function (L, y) { L.planY = y; L.land += 12; return 'あなたは敷金を払って大きな家から数十畝の田を借りた。収穫の半分は地主に納めねばならないが、家の人手が足りていれば、暮らしはいくらか楽になるだろう。'; } },
    { id: 'pl_move', g: '謀劃（毎年一件）', plan: 1, n: '一家でもっと平穏な土地へ移る', c: 1500, ok: function (L, y) { return L.planY !== y && isHead(L) && !L.soldier && !L.office && (chaos(y) > 1.05 || (L.reg && L.reg.order < 45)); }, fx: function (L, y) { L.planY = y; var gk = group(ctrl(L.zone, y)), cand = Object.keys(D.CTRL).filter(function (z) { return z !== L.zone && group(ctrl(z, y)) === gk; }); if (!cand.length) return '方々で聞いて回ったが、同じ勢力の治める土地に、ここより平穏な所はなかった。あきらめるほかなかった。'; relocate(L, pick(L.R, cand), 2.1, '家財を売り払い、一家を連れて{dest}へ移り住んだ。', 0.02, y); return '一家を連れてこの地を去った。'; } },
    { id: 'pl_match', g: '謀劃（毎年一件）', plan: 1, n: '仲人に良縁を頼む', c: 600, ok: function (L, y) { return L.planY !== y && !L.married && !L.spouseK && L.age >= 16 && L.age <= 40 && L.cls !== 'slave' && !L.flags.palaceIn; }, fx: function (L, y) { L.planY = y; L.flags.wantWed = true; L.standing += 1; return '贈り物を用意して、郷里でいちばん口の達者な仲人に頼んだ。仲人は胸を叩いて、一年もしないうちにきっと良い縁談をまとめてみせると請け合った。'; } },
    { id: 'pl_doctor', g: '謀劃（毎年一件）', plan: 1, n: '名医を訪ね歩き、じっくり養生する', c: 1500, ok: function (L, y) { return L.planY !== y && (L.body < 55 || L.chronic || L.injury); }, fx: function (L, y) { L.planY = y; L.body = clamp(L.body + 10, 1, 100); if (L.chronic === 'xulao' && L.R() < 0.3) { L.chronic = null; return '良い医者に巡り会い、半年薬を飲み続けると、血を吐く咳が次第に治まっていった。'; } return '何人かの医者を訪ねて薬をたくさん飲み、体は少しずつ良くなった。'; } },
    { id: 'pl_reconcile', g: '謀劃（毎年一件）', plan: 1, n: '仲違いした親族や友人を訪ねて仲直りする', c: 300, ok: function (L, y) { return L.planY !== y && (L.kin.some(function (k) { return k.alive && !k.apart && k.aff != null && k.aff < 40; }) || (L.friends || []).some(function (f) { return f.alive && !f.apart && f.aff < 40; })); }, fx: function (L, y) { L.planY = y; var k = L.kin.filter(function (k) { return k.alive && !k.apart && k.aff != null && k.aff < 40; })[0] || (L.friends || []).filter(function (f) { return f.alive && !f.apart && f.aff < 40; })[0]; affAdd(k, 25); return '酒を一壺と肉をひとかたまり提げて、' + (k.rel ? kinLabel(L, k) : k.name) + 'を訪ねた。話し合ってわだかまりが解け、二人とも目を潤ませた。'; } },
    { id: 'pl_enlist', g: '謀劃（毎年一件）', plan: 1, n: '軍営に行って入隊する', c: 0, ok: function (L, y) { return L.planY !== y && L.sex === 'M' && L.age >= 16 && L.age <= 40 && !L.soldier && !L.office && !(L.cond && D.CONDS[L.cond.k].noArmy); }, fx: function (L, y) { L.planY = y; enlist(L, y, 2.1, true); return L.soldier ? '軍営に行って名を届け出た。' : '軍営に行って志願したが、採用されなかった。'; } },
    { id: 'pl_haoqiang', g: '謀劃（毎年一件）', plan: 1, n: '豪強に身を寄せ、庇護を求める', c: 0, ok: function (L, y) { return L.planY !== y && isHead(L) && L.cls === 'peasant' && chaos(y) > 1.05; }, fx: function (L, y) { L.planY = y; L.cls = 'tenant'; L.job = '部曲'; L.standing -= 3; L.flags.protected = true; return '一家を連れて豪強の塢壁に身を寄せ、その佃客・部曲となった。乱兵が来ても、塢壁の壁は自分の家の垣根よりずっと頑丈だ。だがそれからは、あなたの家の田も彼の田となった。'; } }
,
    { id: 'coat', g: '日用', n: '厚手の冬着を買い足す', c: 650, ok: function () { return true; }, fx: function (L) { L.body += 2; return '厚手の冬着を一着買い足した。この冬はそれほどつらくなかった。'; } },
    { id: 'chicken', g: '日用', n: '鶏を一羽買って家族に精をつけさせる', c: 220, ok: function (L) { return !L.band; }, fx: function (L) { L.body += 1; return '鶏を一羽買い、鍋いっぱいのスープを煮た。家族みんな口の周りを脂だらけにして食べた。'; } },
    { id: 'wine', g: '日用', n: '酒と肉を買って隣人と酌み交わす', c: 90, ok: function () { return true; }, fx: function (L) { L.standing += 1; return '酒と肉を買って、隣人を招いて一杯やった。'; } },
    { id: 'doctor', g: '日用', n: '医者を呼んで持病を診てもらう', c: 360, ok: function (L) { return L.body < 50 || !!L.injury; }, fx: function (L) { L.body += 6; if (L.injury && L.R() < 0.3) { L.injury = null; return '医者が鍼を打ち薬を塗ってくれると、古傷が次第に治っていった。'; } return '医者が薬を何服か処方してくれて、体が少し軽くなった。'; } },
    { id: 'kidclothes', g: '日用', n: '子どもたちに新しい服を仕立てる', c: 400, ok: function (L) { return kidsWith(L, function (a) { return a < 15; }).length > 0; }, fx: function (L) { L.standing += 0.5; return '子どもたちにそれぞれ新しい服を一着ずつ仕立ててやった。子どもたちは何日も大喜びだった。'; } },
    { id: 'tools', g: '農事', n: '新しい農具を一式そろえる', c: 430, ok: function (L) { return farmerish(L) && !L.eco.tools; }, fx: function (L) { L.eco.tools = true; return '新しい鉄の犂と鍬を一式そろえた。これからの耕作はずいぶん楽になる。'; } },
    { id: 'ox', g: '農事', n: '耕牛を一頭買う', c: 3000, ok: function (L) { return farmerish(L) && L.eco.ox < 2 && (L.land >= 10 || L.cls === 'tenant'); }, fx: function (L) { L.eco.ox++; return '黄牛を一頭買って帰った。村の者がみな見に来て、歯並びのいい牛だと言った。'; } },
    { id: 'land1', g: '農事', n: '田を一畝買う', c: LANDP, ok: function (L) { return ['peasant', 'clerk', 'gentry', 'merchant', 'artisan', 'soldier', 'tenant'].indexOf(L.cls) >= 0 && !L.band; }, fx: function (L) { L.land++; if (L.cls === 'tenant' && L.land >= 5) { L.cls = 'peasant'; return '田を一畝買った。長年こつこつ蓄えて、あなたの家はようやくまた自分の土地を持つことができた。'; } return '田を一畝買った。'; } },
    { id: 'land10', g: '農事', n: '田を十畝買う', c: LANDP * 10, ok: function (L) { return ['peasant', 'clerk', 'gentry', 'merchant', 'artisan'].indexOf(L.cls) >= 0 && !L.band; }, fx: function (L) { L.land += 10; return '良田を十畝買い、田の証文を交わした。'; } },
    { id: 'loom', g: '家業', n: '機織り機を一台そろえる', c: 1500, ok: function (L) { return L.sex === 'F' && !L.eco.loom && L.cls !== 'gentry'; }, fx: function (L) { L.eco.loom = true; return '機織り機を一台そろえた。これからは布を織るのがずっと速くなる。'; } },
    { id: 'tutor', g: '子女', n: '子どもに手習いの先生をつける', c: 800, ok: function (L) { return kidsWith(L, function (a, k) { return a >= 5 && a <= 12 && !k.lit; }).length > 0; }, fx: function (L) { var k = kidsWith(L, function (a, x) { return a >= 5 && a <= 12 && !x.lit; })[0]; k.lit = true; return '郷里の老先生に頼んで、' + kinLabel(L, k) + 'に読み書きを教えてもらった。'; } },
    { id: 'sacrifice', g: '郷里', n: '祖先を祀る', c: 300, ok: function () { return true; }, fx: function (L) { L.standing += 1; return '供え物と酒を用意して、祖先を祀った。'; } },
    { id: 'charity', g: '郷里', n: '銭を出して郷里の貧しい家を救済する', c: 2000, ok: function (L) { return L.age >= 20; }, fx: function (L) { L.standing += 5; L.fame += 2; return '二千銭を出して郷里の貧しい家々を救済した。郷里の人々はみな、あなたを情け深い人だと言った。'; } },
    { id: 'bridge', g: '郷里', n: '金を出して橋や道を直す', c: 5000, ok: function (L) { return L.age >= 25; }, fx: function (L) { L.standing += 6; L.fame += 3; return '村の入り口の石橋を自費で修繕した。行き交う人はみな、誰が直したのかを知っている。'; } },
    { id: 'slips', g: '読書', n: '竹簡や紙を買う', c: 400, ok: function (L) { return L.literate; }, fx: function (L) { L.learn += 2; return '竹簡や紙を買って、書物を写し字を習った。'; } },
    { id: 'copy', g: '読書', n: '人に頼んで書物を一部写してもらう', c: 600, ok: function (L) { return L.literate; }, fx: function (L) { L.learn += 3; return '人に頼んで『春秋』を一部写してもらい、日夜読みふけった。'; } },
    { id: 'classmates', g: '読書', n: '同窓を宴に招く', c: 1200, ok: function (L) { return L.literate && L.age < 50; }, fx: function (L) { L.standing += 3; return '一緒に学んだ友人を何人か宴に招き、夜更けまで語り合った。'; } },
    { id: 'robe', g: '読書', n: 'それなりの衣冠を一揃い整える', c: 2400, ok: function (L) { return (L.literate || L.office) && !L.flags.robe; }, fx: function (L) { L.flags.robe = true; L.standing += 3; return '見栄えのする衣冠を一揃い整えた。これを着て県廷へ行くと、人の態度がずいぶん丁寧になった。'; } },
    { id: 'visit', g: '読書', n: '遊学して名師を訪ねる', c: 4000, ok: function (L) { return L.literate && L.age < 45; }, fx: function (L) { L.learn += 6; L.fame += 2; L.standing += 2; return '遊学の旅に出て隣の郡の名師を訪ね、三か月にわたって経書の講義を聴いた。'; } },
    { id: 'books', g: '読書', n: '書籍をまとめて買いそろえる', c: 3000, ok: function (L) { return L.literate && richish(L); }, fx: function (L) { L.learn += 5; return '書籍をまとめて買いそろえた。車二台にぎっしり積むほどだった。'; } },
    { id: 'teacher', g: '読書', n: '名師を家に招いて講義してもらう', c: 5000, ok: function (L) { return L.cls === 'gentry' || L.cls === 'clerk'; }, fx: function (L) { L.learn += 8; kidsWith(L, function (a) { return a >= 5 && a <= 18; }).forEach(function (k) { k.lit = true; }); return '名師を家に招いて講義してもらい、家の子弟もみな一緒に学んだ。'; } },
    { id: 'feast', g: '交遊', n: '客を招いて宴を開く', c: 2000, ok: function (L) { return richish(L); }, fx: function (L) { L.standing += 4; L.fame += 2; return '盛大な宴を開いて客をもてなした。席上、詩を詠む者もいれば、剣を舞う者もいた。'; } },
    { id: 'befriend', g: '交遊', n: '金を出して土地の豪傑と交わる', c: 5000, ok: function (L) { return richish(L) && L.sex === 'M'; }, fx: function (L) { L.flags.connected = true; L.standing += 6; return '金を出して、郡で名の知れた人物数人と誼を結んだ。これからは何をするにもずっと都合がよくなる。'; } },
    { id: 'horse', g: '交遊', n: '良馬を一頭買う', c: 15000, ok: function (L) { return richish(L) && !L.flags.horse; }, fx: function (L) { L.flags.horse = true; L.fame += 1; return '良馬を一頭買った。乗って出かけると、道行く人が振り返って見た。'; } },
    { id: 'goods', g: '買売', n: '商品を仕入れ増す', c: 5000, ok: function (L) { return L.cls === 'merchant'; }, fx: function (L) { L.eco.stock += 5000; return '布帛と塩をまとめて仕入れ、元手が五千銭増えた。'; } },
    { id: 'porter', g: '買売', n: '人足を数人僱う（三年）', c: 2000, ok: function (L) { return L.cls === 'merchant' && !L.eco.porter; }, fx: function (L) { L.eco.porter = 3; return '人足を数人僱い、荷運びを手伝わせた。'; } },
    { id: 'cart', g: '買売', n: '荷車を一台買う', c: 8000, ok: function (L) { return L.cls === 'merchant' && !L.eco.cart; }, fx: function (L) { L.eco.cart = true; return '牛車を一台買った。これでもっと遠くまで商いに行ける。'; } },
    { id: 'venture', g: '買売', n: '遠方への行商に元手を投じる', c: 10000, ok: function (L) { return L.cls === 'merchant'; }, fx: function (L) { var r = L.R(); if (r < 0.55) { L.eco.cash += 18000; return '荷を一山、遠方へ運んで売りさばき、一万八千銭分を稼いで帰った。'; } if (r < 0.8) { L.eco.cash += 10000; return '遠方への行商で半年も行ったり来たりして、やっと元が取れただけだった。'; } return '荷は道中で奪われ、一万銭の元手がそっくり消えた。'; } },
    { id: 'shop', g: '買売', n: '市に店を一軒借りる', c: 1500, ok: function (L) { return (L.cls === 'merchant' || L.cls === 'artisan' || L.job === '工匠') && !L.flags.shop; }, fx: function (L) { L.flags.shop = true; L.eco.stock += 1500; return '県城の市に小さな店を一軒借りた。'; } },
    { id: 'armor', g: '軍中', n: 'もう少し良い甲冑を一揃いそろえる', c: 3000, ok: function (L) { return !!L.soldier && !L.flags.armor; }, fx: function (L) { L.flags.armor = true; return '金を払って、もう少しましな革の甲と兜に替えた。'; } },
    { id: 'treat', g: '軍中', n: '酒と肉を買って仲間をねぎらう', c: 300, ok: function (L) { return !!L.soldier; }, fx: function (L) { L.standing += 2; return '酒と肉を買って、同じ伍の仲間たちをねぎらった。'; } },
    { id: 'sendhome', g: '軍中', n: '貯めた金を家に送る', c: function (L) { return Math.max(100, Math.round(L.eco.priv)); }, ok: function (L) { return !!L.soldier && L.eco.priv >= 100 && liveKin(L, function (k) { return !k.out; }).length > 0; }, fx: function (L, y, c) { L.eco.cash += c; return '同郷の者に託して、' + fmt(c) + '銭分の蓄えを家に届けてもらった。'; } },
    { id: 'hairpin', g: '日用', n: '自分に銅の簪を一本買う', c: 200, ok: function (L) { return L.sex === 'F'; }, fx: function () { return '自分に銅の簪を一本買った。'; } },
    { id: 'coffin', g: '身後', n: '棺を用意しておく', c: 3000, ok: function (L) { return L.age >= 55 && !L.flags.coffin; }, fx: function (L) { L.flags.coffin = true; return '早いうちに、自分のための柏の木の棺を用意しておいた。'; } },
    { id: 'piglet', g: '農事', n: '子豚を一頭買って育てる', c: 300, ok: function (L) { return farmerish(L) && !L.band && !pendHas(L, 'piglet'); }, fx: function (L, y) { pendAdd(L, { id: 'piglet', y: y + 1, cash: 700, t: '去年買った子豚が肥えて、年末に七百銭で売れた。' }); return '子豚を一頭買った。年末まで育てて売るつもりだ。'; } },
    { id: 'nourish', g: '日用', n: '薬を買って養生する', c: 2500, ok: function (L) { return richish(L) && L.age >= 35; }, fx: function (L) { L.body += 5; return '人蔘や茯苓を買い、毎日煎じて滋養をとった。'; } },
    { id: 'medicine', g: '家人', n: '年老いた両親に医者を呼び薬を買う', c: 1200, ok: function (L) { return !!oldParent(L); }, fx: function (L, y) { var k = oldParent(L); k.cared = y; affAdd(k, 10); L.standing += 1; return '医者を呼んで' + kinLabel(L, k) + 'を診てもらい、薬も何服か買ってきた。老人は口ではそんな金を使うなと言ったが、目は潤んでいた。'; } },
    { id: 'redeem', g: '家人', n: '売られたり人手に渡ったりした身内を買い戻す', c: 8000, ok: function (L) { return !!lostKin(L); }, fx: function (L) { var k = lostKin(L); k.apart = false; k.sold = k.given = k.bonded = false; affAdd(k, 25); L.standing += 2; return 'あちこち尋ね回って、ついに' + kinLabel(L, k) + 'を見つけ出し、八千銭を払って買い戻した。一家は抱き合って泣いた。'; } },
    { id: 'dowry', g: '子女', n: '娘に恥ずかしくない嫁入り道具を用意する', c: 4000, ok: function (L) { return !!dowryGirl(L); }, fx: function (L) { var k = dowryGirl(L); k.dowry = true; affAdd(k, 15); L.standing += 2; return 'あなたは' + kinLabel(L, k) + 'のために嫁入り道具を用意した。銅鏡、漆の化粧箱、絹を数匹。嫁ぎ先に行っても、少しは胸を張っていられるだろう。'; } },
    { id: 'loan', g: '家業', n: '金を貸し付ける（一万銭、二年後に回収）', c: 10000, ok: function (L) { return richish(L) && L.age >= 20 && !pendHas(L, 'loan'); }, fx: function (L, y) { pendAdd(L, { id: 'loan', y: y + 2, cash: 13000, risk: 0.15, t: '二年前に貸した金が戻ってきた。元利合わせて一万三千銭。', fail: '金を借りた家が一家で夜逃げし、一万銭は水の泡となった。' }); return '一万銭を隣県のある家に貸し、二年後に元利そろえて返す約束をした。'; } },
    { id: 'land100', g: '農事', n: '田を百畝買う', c: LANDP * 100, ok: function (L) { return ['clerk', 'gentry', 'merchant'].indexOf(L.cls) >= 0 && !L.band; }, fx: function (L) { L.land += 100; return '田を百畝買い、佃客を何戸か招いて耕させた。'; } },
    { id: 'wubi', g: '家業', n: '塢壁を築く', c: 60000, ok: function (L, y) { return (L.cls === 'gentry' || L.wealth >= 60) && !L.flags.wubi && y >= 184 && !L.band; }, fx: function (L) { L.flags.wubi = true; L.standing += 4; return 'あなたの家は佃客を駆り出し、屋敷の外に高い塀を築き、四隅に物見櫓を建てた。乱兵が来ても、少なくとも門を閉ざして何日かは守れる。'; } },
    { id: 'retainers', g: '交遊', n: '賓客と部曲を養う', c: 30000, ok: function (L) { return (L.cls === 'gentry' || L.wealth >= 65) && L.sex === 'M' && !L.flags.retainers; }, fx: function (L) { L.flags.retainers = true; L.flags.connected = true; L.standing += 8; L.fame += 3; return 'あなたの家の門下には数十人の賓客と百人を超える部曲が養われた。外出すれば大勢が前後を固め、郡の人々もみな一目置くようになった。'; } },
    { id: 'salon', g: '交遊', n: '名士を招いて清談の雅集を開く', c: 8000, ok: function (L) { return L.literate && (L.cls === 'gentry' || !!L.office || L.fame >= 30) && !L.flags.salon; }, fx: function (L) { L.flags.salon = true; L.fame += 3; L.standing += 2; return '家で雅集を催し、郡の名士たちを招いて清談した。それからは名士たちがこの郡を通りかかると、よくあなたの家に立ち寄るようになった。'; } },
    { id: 'library', g: '読書', n: '蔵書楼を一棟建てる', c: 40000, ok: function (L) { return L.cls === 'gentry' && L.literate && !L.flags.library; }, fx: function (L) { L.flags.library = true; L.learn += 10; L.fame += 4; kidsWith(L, function (a) { return a >= 5; }).forEach(function (k) { k.lit = true; }); return '蔵書楼を一棟建て、千巻を超える書物を収めた。遠近の読書人が借りて写しに来て、家の子弟もみな書を読むようになった。'; } },
    { id: 'tomb', g: '身後', n: '先祖の墓を修め碑を立てる', c: 20000, ok: function (L, y) { return richish(L) && !L.flags.tomb && deadParent(L) && !polsAt(L.zone, y).some(function (p) { return p.id === 'bozang'; }); }, fx: function (L) { L.flags.tomb = true; L.standing += 6; L.fame += 4; return '先祖のために大きな墓を築き、石の闕を立て、人に碑文を撰ばせて先祖の徳を称えた。郷里の人々はみな、あなたを孝行者だと言った。'; } },
    { id: 'jushi', g: '仕途', n: '方々に手を回して推挙を狙う', c: 15000, ok: function (L, y) { return y < 220 && L.sex === 'M' && L.age >= 18 && L.age <= 45 && !L.office && (L.cls === 'gentry' || L.cls === 'clerk' || L.learn >= 40) && !L.flags.jushi; }, fx: function (L) { L.flags.jushi = true; return '手厚い礼物を攜えて郡の功曹を訪ね、さらに人に頼んで太守の前で口添えしてもらった。推挙されるかどうかは、来年次第だ。'; } },
    { id: 'zzbribe', g: '仕途', n: '中正官に付け届けをする', c: 30000, ok: function (L, y) { return y >= 220 && L.cls === 'gentry' && L.sex === 'M' && L.age >= 18 && L.age <= 45 && !L.office && !L.flags.zz; }, fx: function (L) { L.flags.zz = true; return '人に託して州の中正官に手厚い礼物を贈った。ほどなく、あなたの品第は一等上がった。'; } },
    { id: 'trip', g: '遊歴', n: '旅に出る', c: 0, ok: function (L) { return L.age >= 16 && !L.band && !L.soldier && L.cls !== 'slave' && (L.sex === 'M' || L.cls === 'gentry'); }, multi: tripOptions, fx: tripGo },
    { id: 'temple', g: '捐資', n: '社祠や祖祠の修繕に寄進する', c: 3000, ok: function (L) { return L.age >= 20 && L.cls !== 'slave'; }, fx: function (L) { L.standing += 4; return '金を出して郷里の社祠と祖祠を修繕した。節句や祭りのたびに、あなたの名が読み上げられる。'; } },
    { id: 'yishu', g: '捐資', n: '義塾を開く資金を出す', c: 6000, ok: function (L) { return richish(L) && L.age >= 25 && !L.flags.yishu; }, fx: function (L) { L.flags.yishu = true; L.standing += 5; L.fame += 2; kidsWith(L, function (a) { return a >= 5 && a <= 14; }).forEach(function (k) { k.lit = true; }); return '金を出して郷里に義塾を一つ開き、先生を招いて貧しい家の子どもたちに字を教えさせた。自分の家の子どもたちも通った。'; } },
    { id: 'junzi', g: '捐資', n: '官府に軍資を献納する', c: 10000, ok: function (L, y) { return richish(L) && L.age >= 20 && chaos(y) > 1.0 && !L.flags.donor; }, fx: function (L) { L.flags.donor = true; L.fame += 3; L.standing += 2; return '一万銭分の兵糧と秣を官府に献納し、軍資に充ててもらった。郡守自ら礼状を寄こし、それからはあなたの家のことを官府が格別に気にかけてくれた。'; } },
    { id: 'bury', g: '捐資', n: '道端の餓死者を葬る', c: 1500, ok: function (L) { return L.age >= 18 && L.reg && (L.reg.ref >= 5 || L.reg.price >= 1.5); }, fx: function (L) { L.standing += 4; L.fame += 1; return '薄い棺を何十も買い、道端で餓死した人々を葬った。'; } },
    { id: 'zhoupeng', g: '捐資', n: '粥の施し所を設けて流民を救う', c: 4000, ok: function (L) { return richish(L) && L.reg && (L.reg.ref >= 4 || L.reg.price >= 1.4); }, fx: function (L) { L.standing += 5; L.fame += 2; L.reg.ref *= 0.9; return '門の外に粥の施し所を設けた。毎朝早くから、門前には長い行列ができた。'; } },
    { id: 'xianli', g: '交遊', n: '県の小役人を宴に招く', c: 1200, ok: function (L) { return L.age >= 20 && L.cls !== 'slave' && !L.office; }, fx: function (L) { L.standing += 2; L.flags.xianli = true; return '県の小役人を何人か招いて一席設けた。それからは県廷へ用事で行くと、ずいぶん丁寧に扱われるようになった。'; } },
    { id: 'sanlao', g: '交遊', n: '郷里の三老を訪ねる', c: 300, ok: function (L) { return L.age >= 18 && L.cls !== 'slave'; }, fx: function (L) { L.standing += 2; return '酒と肉を提げて郷里の三老を訪ね、半日がかりで昔話を聞いた。'; } },
    { id: 'jiebai', g: '交遊', n: '義兄弟の契りを結ぶ', c: 500, ok: function (L) { return L.age >= 15 && friendsFor(L, 55).some(function (f) { return !f.sworn; }); }, multi: function (L) { return friendsFor(L, 55).filter(function (f) { return !f.sworn; }).map(function (f) { return { k: f.name, n: '' + f.name + 'と義' + (L.sex === 'F' ? '姉妹' : '兄弟') + 'の契りを結ぶ', c: 500, sub: frSub(L, f) }; }); }, fx: function (L, y, c, k) { var f = friendByName(L, k); f.sworn = true; affAdd(f, 20); return 'あなたは' + f.name + 'と鶏を絞めて酒を酌み交わし、義' + (L.sex === 'F' ? '姉妹' : '兄弟') + 'の契りを結んで、苦難を共にすると誓った。'; } },
    { id: 'frgift', g: '交遊', n: '友に贈り物をする', c: 400, ok: function (L) { return friendsFor(L, 0).length > 0; }, multi: function (L) { return friendsFor(L, 0).map(function (f) { return { k: f.name, n: '' + f.name + 'に贈り物をする', c: 400, sub: frSub(L, f) }; }); }, fx: function (L, y, c, k) { var f = friendByName(L, k); affAdd(f, 12); return 'あなたは' + f.name + 'に贈り物を届けた。' + (f.aff >= 80 ? '二人の友情はいっそう深まった。' : '相手はとても喜んだ。'); } },
    { id: 'frfeast', g: '交遊', n: '友を家に招いて酒を飲む', c: 300, ok: function (L) { return friendsFor(L, 0).length > 0 && L.age >= 16; }, multi: function (L) { return friendsFor(L, 0).map(function (f) { return { k: f.name, n: '' + f.name + 'を家に招いて酒を飲む', c: 300, sub: frSub(L, f) }; }); }, fx: function (L, y, c, k) { var f = friendByName(L, k); affAdd(f, 8); L.standing += 0.5; return 'あなたは' + f.name + 'を家に招いて酒を飲み、夕方から夜更けまで語り合った。'; } },
    { id: 'kingift', g: '家人', n: '家族に衣服を新調する', c: 500, ok: function (L) { return kinForGift(L).length > 0; }, multi: function (L) { return kinForGift(L).map(function (k) { return { k: String(k.id), n: '' + kinLabel(L, k) + 'に新しい服を一着仕立てる', c: 500, sub: '親疎：' + relLabel(k.aff == null ? 60 : k.aff) }; }); }, fx: function (L, y, c, key) { var k = L.kin.filter(function (x) { return String(x.id) === key; })[0]; affAdd(k, 10); return 'あなたは' + kinLabel(L, k) + 'に新しい服を一着仕立てた。' + (k.aff >= 80 ? '' : '相手は口ではいらないと言いながら、その後何日も着ていた。'); } },
    { id: 'youxia', g: '交遊', n: '遊侠と交わる', c: 3000, ok: function (L) { return L.sex === 'M' && L.age >= 16 && L.age <= 45 && !L.office && !L.flags.youxia && L.cls !== 'slave'; }, fx: function (L) { L.flags.youxia = true; L.standing += 2; L.tr.act = clamp(L.tr.act + 2, 5, 95); return '金を出して遊侠を何人か仲間にした。彼らは胸を叩いて、これからこのあたりであなたの家に手を出す者はいないと言った。'; } },
    { id: 'gift', g: '身後', n: '孫たちにお年玉をやる', c: 100, ok: function (L) { return L.grandkids > 0; }, fx: function () { return '孫たち一人ひとりに、紐に通したお年玉の銭をやった。'; } }
  ];
  // 遊歴之地：要看年代和是否同属一方
  var SPOTS = [
    { n: '洛陽', z: 'luoyang', y: [[150, 189], [205, 310]], t: '洛陽を旅し、太学の門外で石経を見て、さらに白馬寺へ行って西域から来た僧たちを見た。' },
    { n: '長安', z: 'guanzhong', y: [[150, 189], [220, 315]], t: '長安へ行き、未央宮の跡を見た。荒れ草が人の背丈よりも高く茂っていた。' },
    { n: '許都', z: 'yu', y: [[196, 220]], t: '許都へ行った。城内は車馬の音でにぎわい、天子はここに住んでいる。' },
    { n: '鄴城', z: 'ji', y: [[205, 350]], t: '鄴城へ行き、銅雀台に登った。漳水が台の下を静かに流れていた。' },
    { n: '泰山', z: 'yan', y: [[150, 350]], t: '泰山に登り、日観峰で一晩待って、日の出を見た。' },
    { n: '曲阜', z: 'yu', y: [[150, 350]], t: '魯国の曲阜へ行き、孔子の旧宅を拝し、孔子手植えの桧を見た。' },
    { n: '襄陽', z: 'jingbei', y: [[150, 350]], t: '襄陽へ行き、峴山に登って、漢水のほとりで午後を過ごした。' },
    { n: '江陵', z: 'jingnan', y: [[150, 350]], t: '江陵へ行き、大江が東へ流れ去るのを眺めた。船の帆が林のように立ち並んでいた。' },
    { n: '成都', z: 'shu', y: [[150, 350]], t: '成都へ行き、錦官城で錦を織る工房を見て、さらに李氷が築いた都江堰を見に行った。' },
    { n: '建業', z: 'jiangdong', y: [[229, 312]], t: '建業へ行った。石頭城の下を江水が滔々と流れ、市には南北を行き交う商人があふれていた。' },
    { n: '建康', z: 'jiangdong', y: [[313, 350]], t: '建康へ行き、秦淮河に浮かぶ画舫を眺め、南へ渡ってきた士人たちの清談を聴いた。' },
    { n: '会稽', z: 'jiangdong', y: [[150, 350]], t: '会稽へ行き、禹陵を拝し、さらに鏡湖に舟を浮かべた。' },
    { n: '廬山', z: 'jiangdong', y: [[150, 350]], t: '廬山に登り、山中に何日か滞在して、雲の中から落ちてくる滝を眺めた。' },
    { n: '漢中', z: 'hanzhong', y: [[150, 350]], t: '漢中へ行き、桟道に沿ってしばらく歩き、さらに定軍山を見に行った。' },
    { n: '姑臧', z: 'liang', y: [[301, 350]], t: '涼州の姑臧へ行った。城内では講学の風が絶えず、中原から来た士人のほうが土地の者より多いほどだった。' },
    { n: '番禺', z: 'jiao', y: [[150, 350]], t: '番禺へ行き、海船が運んでくる犀角や象牙、香料を見た。海の向こうにはまだ多くの国があると人から聞いた。' }
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
  function friendsFor(L, min) { return (L.friends || []).filter(function (f) { return f.alive && !f.apart && !f.fig && f.aff >= min; }).sort(function (a, b) { return b.aff - a.aff; }).slice(0, 6); }
  function friendByName(L, n) { return (L.friends || []).filter(function (f) { return f.name === n; })[0]; }
  function frSub(L, f) { return '交情：' + relLabel(f.aff) + (f.job ? ' · ' + f.job : '') + (f.sworn ? ' · 結義' : ''); }
  function kinForGift(L) { var y = L.by + L.age; return liveKin(L, function (k) { return !k.out && ['father', 'mother', 'spouse', 'conc', 'child', 'sib', 'gp'].indexOf(k.rel) >= 0 && y - k.by >= 5; }).slice(0, 8); }
  // 遊歴：毎個去処都有治安、盤纏、路程、風険和能否成行
  function tripInfo(L, p, y) {
    var d = zoneDist(L.zone, p.z), days = Math.max(3, Math.round(d * 14)), P = regPressure(p.z, y);
    var rich = richish(L), cost = Math.round(((rich ? 2000 : 300) + days * (rich ? 120 : 40)) / 100) * 100;
    var risk = clamp((100 - P.order) / 100 * (0.4 + d * 0.15) * (rich ? 0.8 : 1), 0.02, 0.9);
    var g0 = group(ctrl(L.zone, y)), g1 = group(ctrl(p.z, y)), open = y < 190 || (y >= 280 && y < 291) || g0 === g1;
    var no = !p.y.some(function (r) { return y >= r[0] && y <= r[1]; }) ? '今は行けない' : !open ? '' + fname(ctrl(p.z, y), y) + 'の支配下で敵国にあたり、関所を通れない' : P.order < 28 ? 'そこでは戦が起きている' : null;
    return { days: days, cost: cost, risk: risk, order: P.order, no: no };
  }
  function riskLabel(r) { return r < 0.12 ? '低' : r < 0.25 ? '中' : r < 0.45 ? '高' : '極高'; }
  function tripOptions(L, y) {
    return SPOTS.filter(function (p) { return p.y.some(function (r) { return y >= r[0] - 20 && y <= r[1] + 20; }); }).map(function (p) {
      var I = tripInfo(L, p, y);
      return { k: p.n, n: '' + p.n + ((L.visited || []).indexOf(p.n) >= 0 ? 'へ行く（訪問済み）' : 'へ行く'), c: I.cost, no: I.no, sub: '治安：' + orderLabel(I.order) + ' · 道中およそ' + cnNum(I.days) + '日 · 危険度：' + riskLabel(I.risk) };
    }).sort(function (a, b) { return (a.no ? 1 : 0) - (b.no ? 1 : 0) || a.c - b.c; });
  }
  function tripGo(L, y, c, key) {
    var R = L.R, p = SPOTS.filter(function (x) { return x.n === key; })[0];
    if (!p) return '旅に出て、ひと巡りしてきた。';
    var I = tripInfo(L, p, y), t = p.t + '往復で、道中' + cnNum(I.days * 2) + '日を費やした。';
    if ((L.visited = L.visited || []).indexOf(p.n) < 0) L.visited.push(p.n);
    L.learn += 2; L.standing += 1; L.body += 1; if (richish(L)) L.fame += 1;
    var r = R();
    if (r < I.risk * 0.08) { die(L, 'bandit', 1.2, { full: 'あなたは' + p.n + 'へ向かう途中で盗賊に遭い、二度と家に帰ることはなかった。' }); return 'あなたは' + p.n + 'へ旅立った。'; }
    if (r < I.risk * 0.5) { var lost = Math.round(Math.min(L.eco.cash + L.eco.priv, 500 + R() * 2500)); payFrom(L, lost); L.body -= 3; t += '帰り道で追いはぎに遭い、' + fmt(lost) + '銭分を奪われたが、身は無事に戻った。'; }
    else if (r < I.risk * 0.7) { L.body -= 4; t += '道中で風邪をひき、帰ってから半月寝込んだ。'; }
    return t;
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

  // 自動支用：按性情、眼下所重和家境，替你花一部分余財
  var SP_G = { 日用: 1, 農事: 1, 子女: 3, 家人: 5, 読書: 1, 交遊: 1, 郷里: 1, 家業: 2, 買売: 1, 軍中: 2, 身後: 1, 仕途: 1.5, 遊歴: 1, 捐資: 1 };
  function smartSpend(L, y, fo) {
    var R = L.R, t = L.tr;
    if (L.age < 16 || L.cls === 'slave') return;
    var opt = spendOptions(L), budget = opt.can * clamp(0.3 + (t.soc - t.cau) / 150 + (fo === 'save' ? -0.2 : 0), 0.1, 0.6);
    if (budget < 80) return;
    var seen = L.spentY = L.spentY || {}, done = 0, rich = L.wealth >= 55;
    if (R() >= (rich ? 0.75 : 0.45)) return;
    for (var n = 0; n < (rich && R() < 0.4 ? 2 : 1); n++) {
      var items = opt.items.filter(function (it) { return !it.plan && it.st === 'ok' && it.c <= budget && (seen[it.id] == null || y - seen[it.id] >= 3); });
      if (!items.length) break;
      var it = wpick(R, items, function (it) {
        var w = SP_G[it.g] || 1, G = it.g;
        if (G === '日用') w *= L.body < 50 ? 3 : 0.8;
        if (G === '農事') w *= farmerish(L) ? 2.5 : 0.6;
        if (G === '読書') w *= L.literate ? 0.6 + t.cur / 50 : 0;
        if (G === '交遊' || G === '郷里' || G === '捐資') w *= 0.3 + t.soc / 50;
        if (G === '遊歴') w *= (0.3 + (t.cur + t.act) / 100) * 0.4;
        if (fo === 'travel' && G === '遊歴') w *= 3;
        if (G === '買売') w *= L.cls === 'merchant' ? 3 : 0;
        if (G === '身後') w *= L.age >= 50 ? 2 : 0.3;
        if (fo === 'career' && (G === '仕途' || G === '交遊')) w *= 2.5;
        if (fo === 'study' && G === '読書') w *= 2.5;
        if ((fo === 'house' || fo === 'save') && (G === '農事' || G === '家業')) w *= 2;
        if ((fo === 'social' || fo === 'fame') && (G === '交遊' || G === '郷里')) w *= 2.5;
        if (fo === 'kids' && G === '子女') w *= 2;
        w *= 0.4 + Math.log10(Math.max(50, it.c)) / 3;
        return Math.max(0.05, w);
      });
      var r = spend(L, it.id);
      if (!r.ok) break;
      seen[it.id] = y; budget -= it.c; done++;
      add(L, 3.75, 'spend', '（自動支出 ' + fmt(it.c) + ' 銭分）' + r.t);
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
    var st = function (c) { return c <= can ? 'ok' : (!room.head && c <= can + room.family ? 'ask' : 'poor'); };
    var items = [];
    SPEND.filter(function (s) { return s.ok(L, y); }).forEach(function (s) {
      if (s.multi) { s.multi(L, y).forEach(function (m) { items.push({ id: s.id + ':' + m.k, n: m.n, c: m.c, g: s.g, sub: m.sub || '', why: m.no || null, st: m.no ? 'no' : st(m.c) }); }); return; }
      var c = typeof s.c === 'function' ? s.c(L) : s.c;
      items.push({ id: s.id, n: s.n, c: c, g: s.g, st: st(c), plan: !!s.plan });
    });
    return { room: room, items: items, can: can };
  }
  function spend(L, id) {
    var y = L.by + L.age;
    var sid = id.split(':')[0], key = id.slice(sid.length + 1);
    var s = SPEND.filter(function (x) { return x.id === sid; })[0];
    var it = spendOptions(L).items.filter(function (x) { return x.id === id; })[0];
    if (!s || !it || it.st === 'poor' || it.st === 'no') return { ok: false, t: it && it.why ? it.why + '。' : '余財が足りない。' };
    var r;
    if (it.st === 'ask') {
      if (L.R() >= 0.2 + L.standing / 300 + (it.c < 1000 ? 0.25 : 0)) r = { ok: false, t: '家に' + fmt(it.c) + '銭分を出してほしいと頼んだ。' + s.n + 'ためだったが、家長は承知しなかった。' };
      else { var p = Math.min(L.eco.priv, it.c); L.eco.priv -= p; L.eco.cash -= it.c - p; r = { ok: true, t: '家長は承知してくれた。' + s.fx(L, y, it.c, key) }; }
    } else { payFrom(L, it.c); r = { ok: true, t: s.fx(L, y, it.c, key) }; }
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
      comp: [['五銖銭', Math.round(cash * coin)], ['布帛', Math.round(cash * cloth)], ['穀物', cash - Math.round(cash * coin) - Math.round(cash * cloth)]],
      months: L.grainMonths, buyMonths: L.grainMonths != null && L.lastCons ? Math.floor(Math.max(0, cash - 0) / (L.lastCons * PRICE / 12)) : 0, coinNote: y >= 190 && y < 196 ? '董卓の小銭は薄くて軽く、銭はほとんど値打ちがない' : g === 'wei' && y >= 221 && y < 227 ? '朝廷が五銖銭を廃し、取引はもっぱら穀物と布帛で行われる' : ''
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
      liveKin(L, function (k) { return ['father', 'mother', 'dimu', 'sib', 'gp'].indexOf(k.rel) >= 0; }).forEach(function (k) { k.out = true; });
      add(L, 2.9, 'life', 'あなたは父と家を分け' + (share > 0 ? '、' + cnNum(share) + '畝の田を受け継ぎ' : '') + '、それからは一家を構えて戸主となった。');
    } else if (!f.alive && f.dy === y && !L.inherited) {
      L.inherited = true;
      if (bros > 0) {
        L.land = Math.floor(L.land / (bros + 1)); E.cash = Math.round(E.cash / (bros + 1));
        liveKin(L, function (k) { return k.rel === 'sib' && k.sex === 'M' && y - k.by >= 15; }).forEach(function (k) { k.out = true; });
        add(L, 3.1, 'life', '父が亡くなった後、あなたは兄弟たちと家産を分け' + (L.land > 0 ? '、' + cnNum(L.land) + '畝の田を得て' : '') + '、戸主となった。');
      } else add(L, 3.1, 'life', '父が亡くなり、あなたが家業を継いで戸主となった。');
      L.split = true;
    }
  }
  function sonOutcome(L, y, d) {
    var R = L.R, son = d.son, nm = '息子の' + son.name;
    if (!son.alive) return;
    if (!d.give) { affAdd(son, -12); add(L, 0.6, 'life', nm + 'はふさぎ込み、何か月もあなたと口をきかなかった。'); return; }
    affAdd(son, 8);
    payFrom(L, 3000);
    if (son.lav > 0.66) { var sp = 1800 + Math.round(R() * 8) * 100; add(L, 3.4, 'bad', '' + nm + 'に渡した三千銭のうち、' + fmt(sp) + '銭を彼は宴会に使い、友人づきあいのためだと言った。残りも戻ってこなかった。'); }
    else if (son.lav > 0.3) { L.eco.cash += 3400; add(L, 3.4, 'good', nm + 'はなかなか頑張り、年末には元利合わせて三千四百銭を返してきた。'); }
    else add(L, 3.4, 'bad', nm + 'の商売はうまくいかず、三千銭をすっかり失った。帰ってきてから何日も、あなたと顔を合わせられなかった。');
  }


  /* ================= 人生抉択 ================= */
  function choiceMul(L) {
    var m = { gentry: L.gate >= 3 ? 2.6 : 2.1, clerk: 1.7, merchant: 1.5, artisan: 1.1, peasant: 1, soldier: 1, tuntian: 0.9, tenant: 0.8, tribal: 0.8, slave: 0.7 }[L.cls] || 1;
    if (L.office) m *= 1.5;
    if (L.literate) m *= 1.2;
    return m;
  }
  var LOCAL_OFF = { 亭長: 1, 里正: 1, 郷嗇夫: 1, 遊徼: 1 };
  function realOffice(L) { return !!L.office && !LOCAL_OFF[L.office]; }
  function isElite(L) { return L.cls === 'gentry' || L.cls === 'clerk' || realOffice(L) || L.learn >= 45 || L.fame >= 20; }
  function ctxH(L, y) {
    var fl = { war: 0, fam: 0, plag: 0 }, fk = ctrl(L.zone, y);
    (EV_BY_Y[y] || []).forEach(function (ev) { var fx = localFx(L, ev, L.zone, y); if (fx && !fx._skip) { fl.war += fx.war || 0; fl.fam += fx.fam || 0; fl.plag += fx.plag || 0; } });
    var camp = L.soldier && (CAMP_BY_Y[y] || []).some(function (c) { return c.a.indexOf(L.soldier.army) >= 0; });
    return {
      y: y, a: L.age, g: group(fk), fk: fk, fname: fname(fk, y), head: isHead(L), fl: fl, chaos: chaos(y), poor: poorNow(L), farm: farmerish(L), camp: camp,
      kids: function (lo, hi, sex, f) { return liveKin(L, function (k) { var a = y - k.by; return k.rel === 'child' && a >= lo && a <= hi && (!sex || k.sex === sex) && (!f || f(k)); }); },
      friend: function (min) { return bestFriend(L, min); },
      school: (polsAt(L.zone, y).filter(function (p) { return p.fx.school; })[0] || {}).fx ? polsAt(L.zone, y).filter(function (p) { return p.fx.school; })[0] : null,
      tier: lifeTier(L, y).k, order: L.reg ? L.reg.order : 70, ref: L.reg ? L.reg.ref : 0,
      sib: function () { return liveKin(L, function (k) { return k.rel === 'sib' && !k.out && k.by > L.by && k.by < y; })[0] || null; },
      someKin: function () { var ks = liveKin(L, function (k) { return !k.out && !k.famous && k.by < y; }); return ks.length ? ks[Math.floor(hash01(L.seed, y, 99) * ks.length)] : null; }
    };
  }
  function fillC(L, t, meta) {
    return t.replace('{kin}', meta.kin ? kinLabel(L, meta.kin) : '').replace(/\{kin\}/g, meta.kin ? kinLabel(L, meta.kin) : '')
      .replace(/\{friend\}/g, meta.friend ? meta.friend.name : '長年会っていない旧友').replace(/\{clan\}/g, L.clanName || 'あなたの家').replace(/\{school\}/g, meta.sc ? meta.sc.city + meta.sc.n : '').replace(/\{lord\}/g, meta.lord || '').replace(/\{birth\}/g, D.JUN[L.birthJun][0] + L.birthCounty).replace(/\{who\}/g, L.parentDiedName || '身内');
  }
  function lifeChoice(L, y, free) {
    var R = L.R, a = L.age;
    var kid = a < 12;
    if (a < 5 || (!free && !L.soldier)) return null;
    var gapN = L.cls === 'gentry' || L.office || a >= 15 ? 1 : 2;
    if (a - L.lastChoice < gapN) return null;
    if (R() >= (kid ? 0.14 : 0.26) * choiceMul(L)) return null;
    var H = ctxH(L, y), elite = isElite(L), pool = [];
    D.CHOICES.forEach(function (c) {
      if (c.elite && !elite) return;
      if (kid && !c.kid) return;
      // 諸侯府里的姫妾，不再操持外面的営生
      if (L.flags.famousConc && L.spouseK && L.spouseK.alive && /^(call_|craft|apprentice|shop|f_tavern|f_master|f_levy|buyoffice|taixue)/.test(c.id)) return;
      if (inPal(L) && PAL_OK.indexOf(c.id) < 0) return;
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
    var co = c.of ? c.of(L) : c.o;
    var aw = c.aw ? c.aw(L).map(function (x) { return Math.max(1, x); }) : co.map(function () { return 1; });
    var dis = co.map(function (o, i) {
      if (L.sex === 'F' && c.r[i] && c.r[i].some(function (x) { return x.fx && x.fx.office; })) return '女子は仕官できない';
      return c.need && c.need[i] && !c.need[i](L, H, pk.meta) ? (c.why && c.why[i]) || 'できない' : null;
    });
    var w = aw.map(function (x, i) { return dis[i] ? 0 : x * x; });
    if (!w.some(function (x) { return x > 0; })) return null;
    return { key: 'life', id: c.id, meta: pk.meta, q: fillC(L, c.qf ? c.qf(L) : c.q, pk.meta), o: co.map(function (o) { return fillC(L, o, pk.meta); }), w: w, dis: dis };
  }
  /* ================= 迴響：年軽時的選択，多年後回来找你 ================= */
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
      if (L.eco.debt > 0) { var g = Math.min(L.eco.debt, 3000); L.eco.debt -= g; return 'かつてあなたが獄から救い出した' + w.name + 'が、あなたの家が借金を抱えていると聞き、人に託して' + fmt(g) + '銭分を届け、肩代わりしてくれた。使いの者は言った。「あの方は、この命はあなたにもらったものだ、と申しておりました。」'; }
      if (L.sex === 'M' && !L.office && !L.soldier && (L.literate || L.learn >= 25) && L.R() < 0.4) { L.office = '書佐'; L.job = '書佐'; L.officeMax = L.officeMax || '県書佐'; return 'かつてあなたが獄から救い出した' + w.name + 'は、今では県廷で顔が利く。彼が県丞にあなたを推挙し、あなたは書佐となった。'; }
      L.eco.cash += 2000; return 'かつてあなたが獄から救い出した' + w.name + 'は、この数年、他郡で財を成した。人に託して二千銭と一通の手紙を届けてきた。手紙にはただ一言、「御恩は忘れません。」とあった。'; } },
    abandoned_friend: { d: [4, 15], ok: function (L, m) { return m.who && m.who.alive; },
      q: function (L, m) { return m.who.name + 'が辺境から戻ってきた。見る影もなく痩せ細っている。かつて彼が投獄されたとき、あなたは門を閉ざして出なかった。今、二人は市で鉢合わせした。'; }, o: ['呼び止めて、詫びる', 'うつむいて、見なかったふりをする'],
      r: [[{ p: 0.5, t: 'あなたは彼を呼び止めた。彼は長いこと立ち尽くし、やがてため息をついた。「あの頃は、誰だって怖かったさ。」二人は一緒に酒を飲んだ。', back: true, waff: 35 }, { p: 0.5, t: 'あなたは彼を呼び止めた。彼はあなたを一瞥し、何も言わずに立ち去った。' }], [{ p: 1, t: 'うつむいたまま、彼のそばを通り過ぎた。その夜、長いこと眠れなかった。', tr: { cau: 3 } }]] },
    comfort_mother: { d: [3, 12], ok: function () { return true; }, run: function (L, m) { L.standing += 2; L.eco.cash += 800; return 'かつてあなたが見舞った' + m.who.name + 'の老母が亡くなった。臨終の前、彼女は古い銀の腕輪を一対あなたの家に届けさせ、こう言い残した。「お宅のお嫁さんに。あの子からのささやかな気持ちです。」'; } },
    revenge: { d: [2, 10], ok: function (L) { return !!(L.soldier || L.milMax); }, run: function (L, m) { L.tr.cau = clamp(L.tr.cau + 3, 5, 95); return '軍中に身を置いてもう何年にもなる。夜の歩哨に立つと、よく' + m.who.name + 'のことを思い出す。仇は討てたのだろうか。自分でもよくわからない。'; } },
    owe_friend: { d: [2, 6], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart && L.eco.debt > 0; },
      q: function (L, m) { return m.who.name + 'が人を寄こして、昔あなたに貸した三千銭のことを尋ねてきた。'; }, o: ['鍋釜を売ってでもまず返す', 'あと数年待ってくれと頼む'],
      need: [function (L) { return L.eco.cash + L.eco.priv >= 3000; }, null], why: ['手元にどうしてもそれだけの金がない', null],
      r: [[{ p: 1, t: '金を返し、そのうえ鶏を一羽添えた。彼は言った。「あんたって人は、信用できるな。」', cash: -3000, debt: -3000, waff: 10 }], [{ p: 0.6, t: '彼はあと数年待つと承知したが、顔色はあまりよくなかった。', waff: -10 }, { p: 0.4, t: '彼はその場で顔色を変え、恩知らずだとあなたを罵った。それきり二人の行き来は絶えた。', waff: -40 }]] },
    slander_rich: { d: [3, 12], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart; }, run: function (L, m) {
      if (L.wealth < 35) { L.standing -= 1; return '兇作の年、あなたの家は穀物を借りに行った。' + m.who.name + '――今や郷里でも指折りの富豪――は、執事に命じてあなたを門前で追い返させた。「あの頃のお言葉、主人はみな覚えておりますよ。」'; }
      return 'あなたは' + m.who.name + 'と県の宴席で出会った。彼も礼儀正しく、あなたも礼儀正しく、あの頃の言葉には、どちらも触れなかった。'; } },
    congrat_office: { d: [5, 15], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart; }, run: function (L, m) { L.standing += 3; L.flags.connected = true; return 'あなたの家は隣家と田地をめぐって訴訟になった。かつてあなたが心から祝いに行った' + m.who.name + 'は、今では郡で顔が利く。彼があなたのために公正な一言を添えてくれた。'; } },
    envy_office: { d: [8, 15], ok: function () { return true; }, run: function (L, m) {
      if (L.officeMax || L.milMax) { L.fame += 2; return 'あなたもついに出世した。その日、何年も前に' + m.who.name + 'が吏の服を着て故郷に帰ってきた姿を思い出した――あの悔しさを、' + cnNum(L.by + L.age - m.y) + '年も胸に抱えてきたのだ。'; }
      L.tr.cmp = clamp(L.tr.cmp - 8, 5, 95); L.tr.cau = clamp(L.tr.cau + 2, 5, 95);
      return m.who.alive ? m.who.name + 'はもう県丞にまでなったが、あなたは元のままだ。いつしか彼と張り合うのをやめた。' : 'かつてあなたが羨んだ' + m.who.name + 'は、もうこの世にいない。張り合っていた年月を思い出すと、ただおかしく思えた。'; } },
    sued_sib: { d: [5, 15], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart; },
      q: function (L, m) { return 'あなたと' + kinLabel(L, m.who) + 'は、かつて家産分けで一族を巻き込む騒ぎになって以来、もう' + cnNum(L.by + L.age - m.y) + '年も口をきいていない。この冬、彼が病に倒れた。'; }, o: ['鶏を一羽提げて見舞いに行く', '行かない'],
      r: [[{ p: 1, t: 'あなたは見舞いに行った。兄弟二人は向かい合って座り、どちらも昔のことには触れなかった。帰り際、彼は甥に村の入り口まであなたを送らせた。', waff: 30, tr: { cmp: -3 } }], [{ p: 1, t: '行かなかった。のちに彼は持ち直したと聞いたが、両家は相変わらず口をきかなかった。' }]] },
    foundling: { d: [12, 22], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart; }, run: function (L, m) { affAdd(m.who, 20); return 'かつてあなたが道端から抱いて連れ帰った' + kinLabel(L, m.who) + 'は、今ではすっかり大人になった。その日、彼はあなたに額ずいて言った。「あなたがいなければ、私はとうに道端で死んでいました。」'; } },
    sheltered: { d: [3, 15], ok: function () { return true; }, run: function (L) { L.eco.cash += 600; L.standing += 1; return '何年も前にあなたが匿ったあの旧友が、人に託して手紙一通と絹一匹を届けてきた――彼は他郡で足場を固めたのだ。'; } },
    turned_away: { d: [4, 15], ok: function (L) { return L.R() < 0.5; }, run: function (L) { L.tr.cau = clamp(L.tr.cau + 2, 5, 95); return '人づてに聞いた。かつてあなたが門を閉ざして会わなかったあの旧友は、その後、逃げ延びる途中で死んだという。あの日、彼が門の外で長いこと立っていたのを思い出した。'; } },
    plague_saved: { d: [3, 15], ok: function () { return true; }, run: function (L) { L.eco.cash += 400; L.standing += 2; return 'かつて疫病のさなかにあなたが看病した隣家は、今では暮らし向きがよくなった。あなたの家が端境期に困っていると、彼らは粟を二石届けてくれた。'; } },
    refugees: { d: [3, 12], ok: function () { return true; }, run: function (L) { L.standing += 3; L.flags.wubi = true; return 'かつてあなたが受け入れた流民のうち、一人があなたの家の佃客の頭になった。乱兵が通り過ぎたその年、彼は皆を率いて屋敷の門を守り抜いた。'; } },
    taught: { d: [8, 20], ok: function () { return true; }, run: function (L) { L.standing += 3; return '以前あなたが教えた弟子の一人が県の吏になり、節句や年越しのたびに礼物を提げて会いに来る。'; } },
    feud: { d: [3, 12], ok: function (L) { return L.land > 0; }, run: function (L) { L.yHarvest = Math.min(L.yHarvest || 1, 0.85); return 'かつてあなたと田の境界を争った隣家は、この数年ずっとあなたの家と張り合っている。今年の春の耕作の時期、あなたの家の田のそばの用水路が何者かにせき止められた。'; } },
    yielded: { d: [3, 12], ok: function () { return true; }, run: function (L) { L.standing += 2; return 'かつてあなたは田の境界で一歩譲った。今年、あなたの家が家を建てるのに人手が足りずにいると、あの隣家の息子たちが二つ返事で手伝いに来てくれた。'; } },
    hid_census: { d: [2, 10], ok: function (L) { return L.R() < 0.45; }, run: function (L) { payFrom(L, 1500); return '県で戸籍の調べ直しがあり、かつて少なく申告していた人数が露見した。あなたの家は千五百銭の罰金を科された。'; } },
    was_bandit: { d: [3, 15], ok: function (L) { return !L.flags.outlaw; },
      q: function () { return '誰かがあなたに気づいた――昔、山で一緒に賊をしていた男だ。今は県で役人勤めをしていて、金をよこさなければ昔のことをばらすとほのめかした。'; }, o: ['金を渡して口をふさぐ', '相手にしない'],
      need: [function (L) { return L.eco.cash + L.eco.priv >= 1000; }, null], why: ['出せる金がない', null],
      r: [[{ p: 1, t: '千銭を渡した。彼はあなたの肩をぽんと叩いて去った。これが最後ではないと、あなたにはわかっていた。', cash: -1000 }], [{ p: 0.5, t: '彼は結局、騒ぎ立てはしなかった――彼自身も脛に傷を持つ身だったのだ。', tr: { ind: 2 } }, { p: 0.5, t: '昔のことが暴かれた。県に引っ立てられて打たれ、罰金を取られ、それからは郷里の人々があなたを見る目がすっかり変わった。', cash: -1500, standing: -6, body: -4 }]] },
    relief_open: { d: [2, 10], ok: function () { return true; }, run: function (L) { L.fame += 4; return 'かつてあなたが独断で倉を開いたことを、郷里の人々はずっと覚えていた。あなたが任を離れる日、民は道に沿って見送り、道端に酒を並べる者もいた。'; } },
    lent_friend: { d: [2, 15], ok: function (L, m) { return m.who && m.who.alive && !m.who.apart && m.who.aff >= 40; }, run: function (L, m) { L.eco.cash += 600; affAdd(m.who, 5); return 'あなたの家が災難に遭った。かつてあなたから金を借りた' + m.who.name + 'はそれを聞くと、何も言わずに粟を二袋担いでやって来た。'; } },
    refused_friend: { d: [3, 15], ok: function (L, m) { return m.who && m.who.alive && L.R() < 0.6; }, run: function (L, m) { return '道で' + m.who.name + 'に出会った――昔、あなたが金を貸さなかった相手だ。今は暮らし向きがよくなった彼は、あなたを見ると顔をそむけた。'; } },
    sold_child: { d: [6, 20], ok: function (L, m) { return m.who && m.who.alive && m.who.apart; },
      q: function (L, m) { return '隣の県から知らせが届いた。かつて売った' + kinLabel(L, m.who) + 'は生きていて、ある大きな家で奴婢として仕えているという。'; }, o: ['金をかき集めて買い戻しに行く', '遠くからひと目見に行く', 'そっとしておく'],
      need: [function (L) { return L.eco.cash + L.eco.priv >= 6000; }, null, null], why: ['身請けには六千銭かかるが、あなたには出せない', null, null],
      r: [[{ p: 1, t: '六千銭をかき集めて、子を買い戻した。一家は抱き合って泣いたが、子はおどおどして、何日もたってようやくあなたを呼んでくれた。', cash: -6000, back: true, waff: 20 }],
        [{ p: 1, t: 'あの家の裏門の外で丸一日待ち、ついに遠くからその姿を見た――背が伸び、粗末な布の服を着て、井戸端で水を汲んでいた。近づく勇気は出なかった。' }], [{ p: 1, t: '行かなかった。あちらでの暮らしのほうが、自分のもとにいるよりましかもしれない、と思った。' }]] },
    defied: { d: [3, 12], ok: function () { return true; }, run: function (L) { if (L.R() < 0.5) { payFrom(L, 600); return 'かつてあなたが楯突いたあの亭長が、今では遊徼に出世した。彼はずっとあなたを根に持っていて、あなたの家に割り当てる徭役はいつも人より多い。'; } L.standing += 3; return 'かつてあなたが亭長とやり合った話は、とうに知れ渡っている。郷里の人々は、いじめられるとみなあなたのところへ頼みに来るようになった。'; } },
    sued_grab: { d: [2, 10], ok: function () { return true; }, run: function (L) { if (L.R() < 0.6) { L.yHarvest = Math.min(L.yHarvest || 1, 0.8); return 'かつてあなたが県に訴え出たあの豪強は、この数年ずっとあなたの家に嫌がらせを続けている。牛を放してあなたの家の苗を踏ませ、水を断つのだ。'; } L.standing += 3; return 'かつてあなたが豪強を訴えた話は、郷里の人々が今でも親指を立てて語り草にしている。'; } },
    borrowed_grain: { d: [1, 2], ok: function () { return true; }, run: function (L) { payFrom(L, 800); return 'かつて豪強から借りたあの数闘の穀物は、秋の後に倍にして返さねばならない。差配が取り立てに来て、元利合わせてあなたの家の倉の半分の粟を持っていった。'; } },
    lavish_funeral: { d: [1, 8], ok: function () { return true; }, run: function (L) { L.standing += 3; return '郷里の人々は今でも、あなたの家がかつて老人のために営んだ葬儀を語り草にし、あなたを孝行者だと言う。ただ、あの借金を返すのに何年もかかった。'; } },
    kid_bonded: { d: [3, 6], ok: function (L, m) { return m.who && m.who.alive && m.who.apart; }, run: function (L, m) { m.who.apart = false; m.who.bonded = false; affAdd(m.who, -10); return '借金のかたに差し出した' + kinLabel(L, m.who) + 'が年季を終えて戻ってきた。出ていった時よりひと回り痩せている。あなたの顔を見ても、しばらく声が出なかった。'; } },
    apprentice: { d: [6, 15], ok: function () { return true; }, run: function (L) { L.standing += 2; return 'かつてあなたが取った弟子が、今では自分の工房を開いた。節句や年越しのたびに、手土産を提げて師匠に会いに来る。'; } },
    rival_study: { d: [6, 15], ok: function () { return true; }, run: function (L) { if (L.learn >= 50) { L.fame += 3; return '何年もたって、あなたは郡の宴席でかつての同窓と経書を論じ合い、もはや引けを取らなかった。座の誰かが言った。「このお二人は、本郡の双璧ですな。」'; } return 'あなたとかつての同窓は、とうに張り合うのをやめた。彼は学塾を開いて講義し、あなたは家で息子に字を教えている。'; } }
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
    if (fx.affair) { var lsx = L.sex === 'M' ? 'F' : 'M', lsur = surname(R, L.cls === 'gentry' ? 'gentry' : 'peasant'); L.affair = { k: fx.affair, since: y, name: lsur + safeGiven(R, lsur, lsx) }; }
    if (fx.affair === 'same' && meta.friend && L.affair) L.affair.name = meta.friend.name;
    if (fx.vic) victimOutcome(L, y, fx.vic, s);
    if (fx.crime) crimeStart(L, y, fx.crime, s + 0.05);
    if (fx.love && meta.friend) { L.love = { name: meta.friend.name, sex: meta.friend.sex, y: y, mutual: fx.love === 2 }; if (fx.love === 2) meta.friend.lover = true; }
    if (fx.side) L.side = { k: fx.side, from: y, until: y + 5 + Math.floor(R() * 6) };
    if (fx.yHarvest) L.yHarvest = fx.yHarvest;
    if (fx.harvestB) L.harvestB = Math.min(1.15, (L.harvestB || 1) * fx.harvestB);
    if (fx.labor) E.labor = Math.max(E.labor || 0, fx.labor);
    if (fx.kidDie && meta.kid && meta.kid.alive) kinDie(L, meta.kid, 'fam', s + 0.05, y);
    if (fx.debt) E.debt = Math.max(0, E.debt + fx.debt);
    if (fx.land) L.land = Math.max(0, L.land + fx.land);
    if (fx.ox) E.ox = Math.max(0, E.ox + fx.ox);
    if (fx.cls) { L.cls = fx.cls; if (fx.cls !== 'slave' && E.house === 0) E.house = 1500; }
    if (fx.job) L.job = fx.job;
    if (fx.mil) { L.mil = fx.mil; L.milMax = ['軍卒', '屯長', '軍司馬', '校尉', '将軍'][fx.mil]; L.job = L.milMax; }
    if (fx.nobleConc && !L.flags.famousConc) {
      L.spouseK = null; var ocls = L.cls; L.cls = 'gentry'; L.gate = L.gate || 1;
      var nsp = makeSpouse(L, y); nsp.age = L.age + 12 + Math.floor(R() * 20); nsp.from = fx.nobleConc;
      doMarry(L, nsp, y, s + 0.1, 'あなたは' + fx.nobleConc + 'の屋敷に迎え入れられた。');
      L.flags.isConc = true; L.cls0 = ocls; L.standing += 6;
      add(L, s + 0.12, 'life', 'あなたは' + nsp.name + 'の妾となった。屋敷では錦の衣に贅沢な食事、けれど主母は正室だ。あなたの子は、生まれながらにして「庶出」なのだ。');
    }
    if (fx.gentryWed) { L.spouseK = null; doMarry(L, makeSpouse(L, y), y, s + 0.1, L.sex === 'F' ? 'あなたは父の命に従って嫁いだ。' : ''); }
    if (fx.clanDie) liveKin(L, function (k) { return !k.out || k.rel === 'father' || k.rel === 'sib'; }).forEach(function (k) { if (R() < 0.6) kinDie(L, k, 'executed', s + 0.08, y); });
    if (fx.office) { L.office = fx.office; L.officeMax = fx.office === '幕僚' ? (meta.lord || '') + '幕府の掾属' : fx.office; L.job = fx.office; }
    var sv = fx.serve || (fx.office === '幕僚' && meta.fk ? lordFigAt(meta.fk, y) : null);
    if (sv) serveLord(L, sv, y, fx.office ? '' + figName(sv) + 'の幕府に仕えた' : figName(sv) + 'に付き従った');
    if (fx.noOffice) { L.office = null; L.job = '農'; }
    if (fx.flag) [].concat(fx.flag).forEach(function (f) { L.flags[f] = true; });
    if (L.flags.duishi === true) { var dsur = surname(R, 'peasant'); L.flags.duishi = dsur + safeGiven(R, dsur, 'F', 'plain'); }
    if (fx.tr) for (var t in fx.tr) L.tr[t] = clamp(L.tr[t] + fx.tr[t], 5, 95);
    if (fx.kinLit && meta.kin) meta.kin.lit = true;
    if (fx.kinAff && meta.kin) affAdd(meta.kin, fx.kinAff);
    if (fx.kinSoldier && meta.kin && meta.kin.alive) meta.kin.soldier = armyOf(ctrl(L.zone, y));
    if (fx.palace) { var pz = typeof fx.palace === 'string' ? fx.palace : 'ji'; if (L.married && L.spouseK) { L.spouseK.apart = true; L.spouseK = null; L.married = false; liveKin(L, function (k) { return k.rel === 'child'; }).forEach(function (k) { k.apart = true; }); } L.cls = 'slave'; L.job = y < 190 ? '采女' : '宮人'; L.flags.palace = 0; L.flags.palaceIn = y; L.flags.palaceTop = L.job; L.eco.house = 0; if (CAP_SEAT[pz] && pz === L.zone) capQuiet(L, CAP_SEAT[pz]); else if (CAP_SEAT[pz]) seatMove(L, CAP_SEAT[pz], s + 0.05, 'あなたは車に押し込まれ、そのまま{dest}の宮中へ送られた。', y); else if (pz !== L.zone) relocate(L, pz, s + 0.05, 'あなたは車に押し込まれ、そのまま{dest}の宮中へ送られた。', 0.02, y); }
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
    if (fx.concubine || fx.husbandConc) {
      L.flags.concubine = y;
      var csur = surname(R, 'peasant'), ck = newKin(L, 'conc', 'F', y - 16 - Math.floor(R() * 6), csur + safeGiven(R, csur, 'F', 'plain'), { sur: csur });
      ck.job = '侍妾'; ck.cy = y;
    }
    if (fx.kinCare && meta.kin) { meta.kin.cared = y; affAdd(meta.kin, 8); }
    if (fx.kinPath && meta.kin) meta.kin.path = fx.kinPath;
    if (fx.edu && meta.sc) L.edu = { n: meta.sc.n, city: meta.sc.city, start: y, next: y + (meta.sc.exam || 2), tries: 0, sc: meta.sc.id };
    if (fx.divorced && L.spouseK) {
      L.spouseK.apart = true; L.married = false; L.spouseK = null; L.divorced = true;
      liveKin(L, function (k) { return k.rel === 'child'; }).forEach(function (k) { k.apart = true; });
      add(L, s + 0.05, 'bad', '定めにより、子どもは夫の家に残される。あなたは一人で実家に帰り、それきり子どもたちに会うことはなかった。');
      L.eco = initEco(L); L.land = 0;
    }
    if (fx.debtMul) E.debt = Math.round(E.debt * fx.debtMul);
    if (fx.enlist) enlist(L, y, s + 0.1, false);
    if (fx.kinOut && meta.kin) meta.kin.out = true;
    if (fx.kinDie && meta.kin && meta.kin.alive) kinDie(L, meta.kin, fx.kinDie, s + 0.05, y);
    if (fx.child) {
      var sx = R() < 0.5 ? 'M' : 'F', k = newKin(L, 'child', sx, y, freshXiao(L, sx), { sur: kidSur(L, 'child') });
      k.lav = R(); k.adopted = true; L.kidsBorn++;
      add(L, s + 0.02, 'fam', '子に' + k.name + 'と名付けた。');
    }
    if (fx.marry) { L.spouseK = null; doMarry(L, makeSpouse(L, y), y, s + 0.1); }
    var mvz = fx.move ? fx.move.filter(function (z) { return z !== L.zone; }) : [];
    if (mvz.length) relocate(L, pick(R, mvz), s + 0.2, '一家は{dest}にたどり着いた。', 0.03, y);
    if (fx.die) die(L, fx.die, s + 0.1, fx.die === 'executed' ? { full: L.R() < 0.5 ? '数日後、あなたは市に引き出されて斬首された。享年' + cnNum(L.age) + '。' : 'あなたは生きて獄を出ることができなかった。享年' + cnNum(L.age) + '。' } : { a: cnNum(L.age), n: '先登攻城' });
    L.rec.tags.push('choice');
  }

  /* ================= 伝家：以子孫之身継続 ================= */
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

  /* ================= 身後与後記 ================= */
  function afterlife(L) {
    var out = [], z = L.zone, dy = L.dy, n = 0;
    for (var y = dy + 1; y <= dy + 45 && n < 2; y++) {
      (EV_BY_Y[y] || []).forEach(function (ev) {
        var fx = ev.at && ev.at[z];
        if (n >= 2 || !fx || !fx.t || !(fx.war || fx.fam || fx.plag || fx.move || fx.flee || fx.m15 || fx.flood)) return;
        out.push('あなたの死後' + cnNum(y - dy) + '年目（' + y + '年）、' + fx.t.replace(/。$/, '') + '。');
        n++;
      });
    }
    if (n) out.push(L.kidsBorn ? 'あなたの子孫があの年月を生き延びたかどうか、記した者はいない。' : 'その頃には、もうあなたを覚えている者はいなかった。');
    else if (dy < 280) out.push('あなたが暮らした土地は、その後数十年、大きな戦禍に遭わなかった。あの時代にあっては、それだけでも得がたい幸いだった。');
    return out;
  }
  var REFLECT = {
    infant: 'その年に生まれた子どもは、およそ五人に一人が満一歳まで生きられなかった。その多くは名も残さず、母親の記憶の中で数か月を生きただけだった。',
    child: '史書の中の漢末は、群雄の漢末だ。だが大多数の家にとって、乱世とはまず何よりも、子どもが育たないということだった。',
    fam: '史書は飢饉を記すとき、しばしばたった三文字で済ませる。「人相食」――人が人を食らう、と。その三文字の向こうには、あなたと同じような人々が数えきれないほどいた。',
    plag: '建安年間の疫病は、曹植に「家家有殭屍之痛」（家ごとに屍を抱える痛みがある）と書かせた。史書は文人の嘆きを記したが、そのかたわらにいた無数のありふれた家々のことは記さなかった。',
    battle: '史書は戦争を「斬首万級」（首を斬ること一万）、「溺死者数万」と記す。あなたはその数字の中の一人だ。',
    war: '乱兵が通り過ぎても、史書はたいてい「所過残滅」（通った所はことごとく滅ぼされた）の一句を残すだけだ。',
    massacre: '城の皆殺しは、史書ではたった一行にすぎない。その一行の中に、あなたがいる。',
    childbirth: 'あの時代、出産は女性の一生でもっとも危険な関門だった。史書がこのことをほとんど書かないのは、筆を執って歴史を書いたのが彼女たちではなかったからだ。',
    road: '漢末の戸口は五千万余りから一千万足らずにまで落ち込んだ。消えた人々の多くは、逃げ延びる道の途中で倒れたのだ。',
    corv: '城壁も、宮殿も、馳道も、あなたのような人々がもっこ一杯ずつ土を積み上げて築いたものだ。史書はそれらの名を記したが、積み上げた人々のことは記さなかった。',
    suicide: D.CFATE.suicideEnd,
    executed: '権力が入れ替わるとき、史書が記すのは勝ち負けだ。巻き添えになった人々は、名簿の一行にすぎない。',
    fade: '戸籍から名が消えたからといって、死んだとは限らない。逃亡、南渡、連れ去り、豪強への身寄せ――どれも人を帳簿から消してしまう。史書がここで筆を止めるように、あなたの物語もここで止まる。'
  };
  // 眼下的家境檔位（随田産、人口、財力逐年変化）
  var TIER_K = { 没有家産: 'slave', 赤貧: 'low', 貧寒: 'low', 温飽: 'mid', 小康: 'mid', 殷実: 'high', 富足: 'high', 豪富: 'top' };
  function lifeTier(L, y) {
    if (L.tierY === y && L.tierC) return L.tierC;
    var f = famLevel(L, Math.max(1, household(L, y).length)), lv = f.lv;
    if (L.cls !== 'slave' && !L.eth && L.age > 0) {
      if (L.wealth < 6) lv = '赤貧';
      else if (L.wealth < 12 && (TIER_K[lv] === 'mid' || TIER_K[lv] === 'high')) lv = '貧寒';
      else if (L.wealth >= 62 && L.cls !== 'gentry' && TIER_K[lv] !== 'high') lv = '殷実';
    }
    L.tierY = y; L.tierC = { lv: lv, k: TIER_K[lv] || null };
    return L.tierC;
  }
  // 後宮：采女、宮人，偶有得寵者
  function palaceRanks(y) { return y < 190 ? ['采女', '美人', '貴人', '皇后'] : ['宮人', '才人', '美人', '貴人', '夫人', '皇后']; }
  var PAL_T = { 美人: '天子が宴の席であなたにふと目を留めた。翌日、あなたは美人に封じられ、自分の宮院に移り住んだ。', 才人: '宮中で慎み深く勤勉に務め、才人に抜擢されて、数人の宮女を束ねることになった。', 貴人: '寵愛を得て、貴人に封じられた。宮中の者はあなたを見ると、みな頭を下げて礼をするようになった。', 夫人: '夫人に昇格し、位は皇后に次ぐものとなった。あなたの父や兄たちも、みな官職を得た。', 皇后: '皇后に立てられた。後宮の出でここまで上り詰めた者は、史書にもほんの数人しかいない――郭女王は婢女の出、卞夫人は倡家の娘だった。あなたはその一人となった。' };
  function palaceYear(L, y) {
    var R = L.R, rk = palaceRanks(y), lv = L.flags.palace || 0;
    if (L.cls !== 'slave' && !L.flags.palaceUp) return;
    if (lv >= rk.length - 1) return;
    var p = [0.012, 0.006, 0.0025, 0.0006, 0.0002][Math.min(lv, 4)] * (L.found.charm ? 2 : 1) * (0.5 + L.tr.soc / 100) * (L.age <= 25 ? 1.3 : L.age >= 35 ? 0.3 : 1);
    if (rk[lv + 1] === '皇后') p = 0.0004;
    if (R() < p) {
      lv++; L.flags.palace = lv; L.flags.palaceUp = true; L.job = rk[lv]; L.flags.palaceTop = rk[lv]; L.fame += 4 + lv * 3; L.standing += 5;
      if (lv >= 1) L.cls = 'gentry';
      add(L, 1.8, 'good', PAL_T[rk[lv]] || '位が一つ上がった。');
      return;
    }
    if (lv >= 2 && R() < 0.012) { die(L, 'executed', 1.9, { full: '宮中で巫蠱を行い、後宮を呪詛したと訴える者がいた。あなたは死を賜った。享年' + cnNum(L.age) + '。' }); return; }
  }

  // 求学：太学、国子学、州郡学官
  var EDU_LINES = ['太学の博士が『春秋』の公羊の義を講じ、あなたは講義の筆記を一巻びっしり書き取った。', '同窓と学舎の外の槐の木の下で経義を論じ合い、日が暮れるまで言い争った。', '太学生たちはひそかに朝政を論じていた。あなたはそばで聞きながら、口を挟む勇気はなかった。', '『尚書』を一部写し終え、指にたこができた。', '学舎には冬でも炭火がなく、布団にくるまって書を読んだ。墨まで凍りついた。', 'あなたの文章の一節を博士が講堂で読み上げ、同窓たちがみな振り返ってあなたを見た。'];
  function eduYear(L, y) {
    var E = L.edu, R = L.R;
    if (!E || E.done || !L.alive) return;
    var pol = (D.POLICIES || []).filter(function (p) { return p.id === E.sc; })[0];
    var still = polsAt(L.zone, y).some(function (p) { return p.id === E.sc; });
    if (!still && y > E.start) { E.done = true; add(L, 1.6, 'life', '戦乱で' + E.n + 'は散り散りになった。博士たちはそれぞれ逃げ、あなたは書箱をまとめて家に帰った。'); return; }
    if (y <= E.start) return;
    L.learn += (3 + R() * 3) * (L.found.memory ? 1.3 : 1);
    if (!L.literate && L.learn >= 25 && !condNoRead(L)) L.literate = true;
    if (R() < 0.45) add(L, 2.3, 'life', fresh(L, EDU_LINES));
    if (R() < 0.3 && (L.friends || []).filter(function (f) { return f.alive && !f.apart; }).length < 8) {
      var fs = surname(R, L.cls === 'gentry' ? 'gentry' : 'clerk'), fr = { name: fs + safeGiven(R, fs, 'M', 'elite'), sex: 'M', by: L.by + Math.round((R() - 0.5) * 6), since: y, ctx: 'school', aff: Math.round(55 + R() * 25), alive: true, apart: false, job: '太学生', fate: '' };
      (L.friends = L.friends || []).push(fr); add(L, 2.35, 'good', 'あなたは' + E.n + 'で同窓の' + fr.name + 'と知り合い、二人はよく気が合った。');
    }
    if (y < E.next) return;
    var score = L.learn + R() * 25 + (L.found.memory ? 8 : 0) + (L.cls === 'gentry' && y >= 220 ? 10 : 0);
    if (score >= 72) {
      E.done = true; E.passed = true; L.fame += 5;
      var off = L.cls === 'gentry' ? '郎官' : '書佐';
      if (!L.office && L.sex === 'M') { L.office = off; L.job = off; L.officeMax = L.officeMax || (off === '郎官' ? '郎中' : '郡文学掌故'); }
      add(L, 2.4, 'good', (pol && pol.fx.school.pass) || ('あなたは' + E.n + 'の試験に及第し、官職を授けられた。'));
    } else if (++E.tries >= 2) { E.done = true; add(L, 2.4, 'life', '何度試験を受けても及第できなかった。' + E.city + 'で何年も学んだすえ、あなたは書箱をまとめて家に帰った。学問は身についたが、官職には就けなかった。'); }
    else { E.next = y + 2; add(L, 2.4, 'bad', 'この年の試験に、あなたは及第できなかった。歯を食いしばり、もう二年学ぶことにした。'); }
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
      t = 'その年の冬、家ではどうにも養いきれなくなった。両親は' + kinLabel(L, sib) + 'を隣県の子のない家に譲った。あなたは牛車を追いかけてずっと走った。見えなくなるまで。';
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

  // 結局頁：一生所歴
  function lifeSummary(L) {
    var T = [], seen = {}, regs = [];
    (L.regimes || []).forEach(function (fk) { var n = fk === 'warlords' ? '群雄割拠' : D.FACTIONS[fk].n; if (!seen[n]) { seen[n] = 1; regs.push(n); } });
    if (regs.length) T.push({ l: '経験した政権', v: regs.length + ' つ', s: regs.join(' → ') });
    var jh = (L.junHist || [L.birthJun]).map(function (j) { return D.JUN[j][0]; });
    T.push({ l: '暮らした土地', v: jh.length > 1 ? jh.length + ' 郡' : '故郷を離れず', s: jh.join('、') + (L.moves ? '（移住 ' + L.moves + ' 回）' : '') });
    if ((L.visited || []).length) T.push({ l: '旅した土地', v: L.visited.length + ' か所', s: L.visited.join('、') });
    var H = L.regHist || [];
    if (H.length) {
      var hi = H.reduce(function (a, b) { return b.price > a.price ? b : a; }), lo = H.reduce(function (a, b) { return b.order < a.order ? b : a; });
      var bad = H.filter(function (h) { return h.order < 42; }).length;
      T.push({ l: '目にした最高の穀物価格', v: '1石あたり ' + fmt(Math.round(PRICE * hi.price)) + ' 銭', s: hi.y + ' 年；平年はおよそ 100 銭' });
      T.push({ l: '動乱の年', v: bad + ' 年', s: bad ? '最も乱れたのは ' + lo.y + ' 年、' + orderLabel(lo.order) : '生涯暮らした土地はまずまず平穏だった' });
    }
    var tax = 0;
    (L.years || []).forEach(function (r) { if (r.ledger && r.ledger.exp) r.ledger.exp.forEach(function (x) { if (/賦|租|戸調|口銭|修宮銭|納貢/.test(x[0])) tax += x[1]; }); });
    if (tax > 0) T.push({ l: '官府に納めたもの', v: fmt(Math.round(tax)) + ' 銭分', s: '算賦・田租・戸調など、家計から換算' });
    var laws = Object.keys(L.lawSeen || {}).length;
    if (laws) T.push({ l: '経験した法令', v: laws + ' 件', s: '' });
    T.push({ l: '出会った人物', v: Object.keys(L.met || {}).length + ' 人', s: '名簿に載った人物' });
    var frs = (L.friends || []).length;
    if (frs) T.push({ l: '交わった友', v: frs + ' 人', s: (L.friends || []).filter(function (f) { return !f.alive; }).length + ' 人があなたより先に逝った' });
    var kids = L.kin.filter(function (k) { return k.rel === 'child'; }), young = kids.filter(function (k) { return !k.alive && k.dy - k.by < 15; }).length;
    if (kids.length) T.push({ l: '子女', v: kids.length + ' 人', s: young ? young + ' 人が成人できなかった' : 'みな成人した' });
    var ch = (L.choiceLog || []).filter(function (c) { return !c.narr; }).length;
    if (ch) T.push({ l: '自ら下した決断', v: ch + ' 回', s: (L.echoes || []).length ? (L.echoes || []).length + ' 回が年月を経て返ってきた' : '' });
    return T;
  }

  // 出生時的家境説明：給不熟悉漢末的人一個参照
  function famLevel(L, hh) {
    var c = L.cls, per = hh ? L.land / hh : 0, debt = L.eco && L.eco.debt > 0, lv, t;
    if (L.eth) return { lv: '化外', t: 'あなたの家は漢人の戸籍には載っていない。牧畜や狩り、山の畑で暮らしを立て、漢の賦税は納めないが、部族の首長には馬と人手を差し出さねばならない。官府の文書では、あなたたちは「夷」と呼ばれている。', r: '' };
    if (c === 'slave') { lv = '没有家産'; t = 'あなたの家には一寸の土地も一文の銭もなく、身そのものまで主人のものだ。主人の飯を食い、主人の仕事をし、売り買いされ、褒美として与えられ、嫁入りの供にもされる。'; }
    else if (c === 'tenant') { lv = debt ? '赤貧' : '貧寒'; t = 'あなたの家には自分の田がなく、豪強の土地を小作して、収穫の半分を田主に納めねばならない' + (debt ? '。そのうえ家には借金もある' : '') + '。豊作の年でようやく食いつなげる程度で、ひとたび災害に遭えば借金をし、子を売るしかない。漢末に土地を失った農民の多くは、こうした佃客になった。'; }
    else if (c === 'tuntian') { lv = '貧寒'; t = 'あなたの家が耕すのは官田だ。官の牛を使えば収穫の六割、自分の牛を使えば五割を官府に納める。兵役を別に務めなくてよいのが利点で、屯田を勝手に離れられないのが難点だ。'; }
    else if (c === 'soldier') { lv = '貧寒'; t = 'あなたの家は士家（兵戸）だ。男は代々兵となり、家族は後方に留め置かれる。人質も同然だ。平民と勝手に通婚することはできず、籍を改めることもできない。'; }
    else if (c === 'peasant') {
      if (per < 4) { lv = debt ? '赤貧' : '貧寒'; t = 'あなたの家の田は、一人あたり四畝にも満たない。当時、田一畝の年間収穫は二、三石で、大人一人が一年に食べるのは十数石――畑の実りでは一家の腹を満たせず、僱われ仕事や機織りで補わなければならない。'; }
      else if (per < 8) { lv = '温飽'; t = 'あなたの家の田は一人あたり六、七畝。豊作の年はどうにか腹を満たせるが、田租・算賦・口銭を納めればほとんど残らない。ひとたび水害・旱魃・蝗害に遭えば借金をし、ついには土地を売ることになる。'; }
      else if (per < 15) { lv = '小康'; t = 'あなたの家の田は一人あたり十畝ほど。豊作の年には余った穀物があり、兇作の年もしばらくは持ちこたえられる。戸籍に載る小農のなかでは、まずまずの暮らしだった。'; }
      else { lv = '殷実'; t = 'あなたの家は田が多く、農繁期には人を僱って手伝わせる。郷里では裕福な家とされた――そして豪族に目をつけられ、役所から割り当てを押しつけられやすい家でもあった。'; }
    }
    else if (c === 'artisan') { lv = '温飽'; t = 'あなたの家は手仕事で食べており、田はわずかで、食い扶持は腕で稼いで手に入れるしかない。役所はいつでも工匠を官営の工房へ徴発して働かせることができた。'; }
    else if (c === 'merchant') { lv = L.wealth >= 45 ? '殷実' : '小康'; t = 'あなたの家は商いをしており、手元の銭は農家より融通がきいた。だが漢は「重農抑商」を掲げ、商人は市籍に入れられ、官職に就くことも、車に乗り絹をまとうことも許されなかった――守らない者も多かったが。'; }
    else if (c === 'clerk') { lv = '小康'; t = 'あなたの家には県で小吏を務める者がいて、字が読め、律令に通じ、俸禄があり、つてもあった。郷里では体面のある家だが、本物の士族にはまだほど遠い。'; }
    else { lv = L.gate >= 3 ? '豪富' : '富足'; t = 'あなたの家には田が' + L.land + '畝あり、僮僕や賓客を抱え、一族が集まって暮らしていた。' + (L.gate >= 3 ? '祖先は代々二千石の高官を務めてきた。' : '郡で名の通った大姓だった。') + '当時、このような家は百分の三にも満たなかった。'; }
    var R = { 没有家産: '当時、あなたより低い境遇の者はほとんどいなかった。', 赤貧: '十戸のうち、あなたの家より苦しいのは一、二戸ほどだった。', 貧寒: '十戸のうち三、四戸ほどが、あなたの家と同じか、もっと苦しかった。', 温飽: 'およそ半分の家が、こうした暮らしをしていた。', 小康: '十戸のうち、あなたの家よりゆとりがあるのは二、三戸ほどだった。', 殷実: '百戸のうち、あなたの家よりゆとりがあるのはほんの数戸だった。', 富足: '一県のうちで、このような家は数えるほどしかなかった。', 豪富: '一州のうちで、このような家は数えるほどしかなかった。' }[lv];
    return { lv: lv, t: t, r: R };
  }

  function liang(n) { return n === 2 ? '二' : cnNum(n); }
  function afterword(L) {
    var age = L.dy - L.by, t = [], F = L.flags || {};
    var top = /刺史|九卿|郡守|太守/.test(L.officeMax || '') || L.mil >= 3 || L.fame >= 55 || (F.palace || 0) >= 3;
    var mid = !top && (!!L.officeMax || L.mil >= 2 || L.fame >= 25 || (F.palace || 0) >= 1);
    // 一、死因
    var rf = REFLECT[L.cause];
    if (L.cause === 'executed') {
      if (F.palace) rf = '後宮のことについて、史書は后妃の名号しか記そうとしない。死を賜った宮人には、その名号すらない。';
      else if (L.purgeLog) rf = '権力が移り変わるとき、史書が記すのは勝ち負けだ。巻き添えになった者は、名簿の一行にすぎない。';
      else if (F.loyal || F.switched) rf = '頼った者が倒れれば、それに頼っていた者も倒れる。乱世で人のために策をめぐらすのは、いつだって身代と命を賭けることだった。';
    }
    if (rf) t.push(rf);
    else if (age >= 60) t.push('この歳まで生きられた者は、あなたの同時代人の十分の一にも満たない。あなたは王朝の交代も、城頭の旗が掛け替えられるのも見てきて、それをすべて胸にしまっていた。');
    // 二、你是誰
    var who = '';
    if (F.palaceIn) {
      var pt = F.palaceTop || '宮人';
      if ((F.palace || 0) >= 2) who = 'あなたは一人の' + (F.palaceIn < 190 ? '采女' : '宮人') + 'から' + pt + 'にまで上りつめた。后妃伝に記されるのはわずか数人。あなたはその中の一行かもしれないし、一行すらないかもしれない。';
      else if (F.palaceOut) who = 'あなたが宮門を出たとき、もう若くはなかった。史書は「後宮数千人」と言う。あなたはその数千人の一人だった――それでも、あなたは外へ出ることができた。';
      else who = 'あなたの一生は宮殿の壁の中に閉じ込められていた。史書は「後宮数千人」と言う。あなたはその数千人の一人だった。';
    } else if (F.famousConc) who = 'あなたは' + figName(F.famousConc) + 'の妾だった。彼の伝には何人もの夫人の姓と、彼女たちが産んだ息子が記されている。あなたの名はない。';
    else if (F.isConc) who = 'あなたは貴顕の家の妾になった。礼法の上では、あなたの子は正室を「母」と呼ばねばならない。族譜には、たいてい姓がひとつ残るだけだ。';
    else if (L.cls === 'slave') who = '律令は、あなたを牛馬と同じ帳簿の同じ頁に書きつけた。それでもあなたには、自分の名前があり、自分の願いがあった。';
    else if (L.eth) who = '漢人の戸籍にあなたはいない。史書があなたの同族に触れるのは、たいてい「叛」「破」「徙」といった字のそばだ。';
    else if (F.loyal) who = 'あなたが仕えた' + F.loyal + 'が滅んだあと、あなたは新しい朝廷の招きを幾度も辞退した。乱世において、忠誠はしばしばもっとも役に立たず、もっとも得がたいものだった。';
    else if (F.switched) who = 'あなたは一人ならぬ主君に仕えた。「良禽は木を択んで棲む」と言われたあの時代、それを責める者はいない――ただあなた自身が、ときおり' + F.switched + 'のことを思い出すだけだった。';
    else if (L.purgeLog && L.purgeLog.i === 2) who = '' + L.purgeLog.pn + 'の一件で、あなたは上書して旧友を告発し、命と家業を守った。このことを、あなたは生涯二度と口にしなかった。';
    else if (L.purgeLog && L.purgeLog.i === 0) who = '' + L.purgeLog.pn + 'の一件で、あなたは夜のうちに逃げ出し、それきり故郷に戻ることはなかった。';
    else if (L.edu && L.edu.passed) who = 'あなたは' + L.edu.city + L.edu.n + 'の出身だった。字の読める者が一割に満たない時代に、あなたが読んだ書物は、同郷の者すべてを合わせたより多かった。';
    else if (L.edu) who = 'あなたは' + L.edu.city + 'で何年か学んだが、ついに合格しなかった。学問は官職にはならなかったが、無駄でもなかった――少なくとも、高札に何が書いてあるかは読めた。';
    else if (/亭長|里正|遊徼|郷嗇夫/.test(L.officeMax || '')) who = 'あなたは' + L.officeMax.replace(/^県/, '') + 'を務めた。秦漢四百年の天下は、ひとりひとりの亭長や里正が支えていた――高祖劉邦も、亭長だった。';
    else if (L.milMax && L.soldierYears > 0) who = L.mil >= 2 && L.cls !== 'gentry' ? 'あなたは一兵卒から、刀一本槍一本で' + L.milMax + 'にまで上りつめた。こうした者は、兵営で百人に一人も出ない。' : 'あなたは' + cnNum(L.soldierYears) + '年兵として過ごし、' + L.milMax + 'になった。軍功簿にはあなたの名があるが、史書にはない。';
    else if (L.soldierYears >= 5) who = 'あなたは' + cnNum(L.soldierYears) + '年兵として過ごし、最後まで一兵卒のままだった。史書が戦功を記すとき、記されるのは将軍の名だ。';
    else if (L.sex === 'F' && L.cause !== 'childbirth') who = '史書の中の女性は、たいてい姓だけが残り、「某氏」と書かれる。けれどあなたの名前は、家族に長いあいだ呼ばれていた。';
    else if (L.moves >= 2 && age >= 15) who = 'あなたは生涯に何度も移り住んだ。漢末の戸籍から消えた幾千万の人々の多くは、あなたのような流民だった。';
    else if (L.officeMax && age >= 20 && L.cls !== 'gentry') who = 'あなたは寒微の身から' + L.officeMax + 'にまでなった。家柄がものを言う時代に、こうした者はごく少数だった。';
    else if (L.clanName && age >= 20) who = 'あなたは' + L.clanName + 'に生まれた。家柄はあなたに、学問をし、官に就き、乱世で一歩先に動く機会を与えた。そして王朝が替わるたびに、どちらかの側に立つことを強いた。';
    else if (age >= 15) who = 'あなたが育てた穀物は官の倉に入り、織った布帛は戸調として納められ、あなたの名は里正の戸籍簡に記された。帝王将相の事業は、こうした簡牘の上に載っていたのだ。';
    if (who) t.push(who);
    if (L.flags.revenger) t.push('あなたは父の仇をその手で討ち、自ら役所に出頭した。郷里の人々はあなたを孝烈と称えた――漢末の人々は、こうした行いを敬った。');
    else if (L.flags.convicted) t.push('あなたは刑徒だったことがある（' + L.flags.convicted + '）。洛陽で出土した刑徒の墓磚には、何千何万というこうした名が刻まれている。あなたの名は、残らなかった。');
    if (L.cond && L.cond.rev) t.push(D.CONDS[L.cond.k].end[L.cond.gift || (L.cls === 'gentry' ? 'hi' : 'lo')] || D.CONDS[L.cond.k].end.lo);
    if (L.chronic === 'li') t.push('あなたは癘風を患い、里の門から追い出され、村はずれの草小屋で余生を送った。秦漢の律令では、癘者は「癘所」に移され、人から隔てられた。');
    if (L.love) { var lv2 = L.sex === 'M' ? '男子' : '女子'; t.push(L.love.mutual ? 'あなたは同じ' + lv2 + 'である' + L.love.name + 'と愛し合った。あの時代、こうした情には名分がなく、史書に一字の居場所もない。それでも、それは本物だった。' : 'あなたは生涯、同じ' + lv2 + 'である' + L.love.name + 'を心に抱いていた。そのことを、あなたは死ぬまで誰にも話さなかった。'); }
    if (L.flags.moru) t.push(D.MAID.endMo);
    else if (L.flags.maidWas && !L.flags.famousConc) t.push(L.flags.maidWas === 'bi' ? D.MAID.endBi : D.MAID.endHire2);
    if (L.flags.duishi) t.push('宮中で、あなたは宮女の' + L.flags.duishi + 'と「対食」の仲になった――二人の女が、夫婦のように長年互いを支え合った。');
    if (L.flags.affCaught) t.push('あなたのある秘めた恋は、のちに長く郷里の噂の種になった。史書はこうしたことを記さない――王侯にかかわる場合を除いて。');
    else if (L.flags.affPast) t.push('あなたには、誰も知らない過去があった。それはあなたとともに墓に入った。');
    var CLN = clanOf(L);
    if (CLN && !L.clanPoor) t.push('あなたは' + CLN.n + 'の出身だった。史書はあなたの多くの同族を記したが、あなたのことは記さなかった。');
    if (L.shu) t.push(L.sex === 'M' && /県令|太守|郡守|刺史|九卿|掾属/.test(L.officeMax || '') ? 'あなたは庶子だった。袁紹も庶子で、袁術は彼を「家奴」と罵った――だがそれは彼を止めなかったし、あなたを止めもしなかった。' : 'あなたは庶子だった。族譜では、あなたの名は嫡出の兄弟姉妹のあとに並べられた。あなたの生母の名は、族譜にない。');
    // 三、你活過的年月
    if (age >= 12) {
      var H = L.regHist || [], hi = H.length ? H.reduce(function (a, b) { return b.price > a.price ? b : a; }) : null;
      var harsh = Object.keys(L.lawSeen || {}).map(function (id) { return (D.POLICIES || []).filter(function (p) { return p.id === id; })[0]; }).filter(function (p) { return p && (p.fx.tax >= 1.3 || p.fx.cons >= 1.3); });
      if (hi && hi.price >= 3) t.push(hi.y + '年、あなたの住む土地では穀物の値が平年の' + cnNum(Math.round(hi.price)) + '倍にまで跳ね上がった。その年を生き延びた人々は、のちにその年のことをほとんど口にしなかった。');
      else if (harsh.length) t.push('あなたは「' + harsh[harsh.length - 1].n + '」のもとで生きた。竹簡に書かれた法令はわずか数行だが、一軒一軒の家に降りかかれば、それは一年また一年の暮らしそのものだった。');
    }
    // 四、家人
    var lost = L.kin.filter(function (k) { return k.rel === 'child' && !k.alive && k.dy <= L.dy && k.dy - k.by < 15; }).length;
    var sp = L.kin.filter(function (k) { return k.rel === 'spouse'; })[0];
    if (lost >= 2) t.push('あなたは生涯に' + liang(lost) + '人の、大きくなれなかった子を見送った。あの時代、それはほとんどすべての' + (L.sex === 'F' ? '母親' : '父親') + 'の運命だった。だからといって、その重さが少しでも軽くなるわけではない。');
    else if (sp && L.marriedAt && sp.aff >= 75 && (Math.min(L.dy, sp.alive ? L.dy : sp.dy) - L.marriedAt) >= 20) t.push('あなたと' + sp.name + 'は' + cnNum(Math.min(L.dy, sp.alive ? L.dy : sp.dy) - L.marriedAt) + '年連れ添った。乱世にあって、それだけでも得がたいことだった。');
    var readK = L.kin.filter(function (k) { return k.rel === 'child' && k.path === 'read'; }).length, shuK = L.kin.filter(function (k) { return k.shu; }).length;
    if (readK >= 1 && !L.literate) t.push('あなた自身は字が読めなかったが、' + (readK > 1 ? liang(readK) + '人の子' : '子') + 'を学問に通わせた。');
    else if (shuK >= 1 && L.sex === 'M') t.push('あなたには' + liang(shuK) + '人の庶出の子がいた。彼らは大人になっても、一族の中で口をきくときは、いつも嫡出の兄弟より一歩控えねばならなかった。');
    // 五、迴響与品評
    var ec = (L.echoes || []).length;
    if (ec >= 2) t.push('若いころのいくつかの選択が、何年もたってからまたあなたのもとに戻ってきた。善意も負い目も、忘れられてはいなかった。');
    var AP = L.appraisal;
    if (AP) {
      var ap = AP.by + 'はかつて' + (AP.ping ? 'あなたをこう評した' : 'あなたの人相を見てこう言った') + '。「' + AP.t + '」';
      if (AP.lv === 2 && top) ap += 'のちの出来事が、彼の目に狂いがなかったことを証明した。';
      else if (AP.lv === 2 && age >= 35) ap += 'だが乱世は、あなたに腕をふるう機会を与えなかった。評語は残り、人は老いた。';
      else if (AP.lv === 0 && (top || mid)) ap += 'あなたがのちに成し遂げたことは、彼の言葉を上回っていた。';
      else if (AP.lv === 2) ap += 'あなたは、その言葉が実現する日まで生きられなかった。';
      t.push(ap);
    }
    // 六、今昔
    var MOD = { infant: '今日では、新生児のほとんどが満一歳を迎えられる。', child: '今日なら、あなたの命を奪ったこの病は、たいてい注射一本、薬一服で治る。', childbirth: '今日の中国では、出産で命を落とす女性は一万人に二人にも満たない。', fam: '今日、飢饉はこの土地から遠いものになった。', plag: '今日、人々にはワクチンと隔離があり、大きな疫病がたやすく一つの村をまるごと連れ去ることはもうない。' };
    if (MOD[L.cause]) t.push(MOD[L.cause]);
    var RG = D.REGION && D.REGION[L.zone];
    if (RG && RG.end && age >= 10 && L.by + Math.min(age, 40) / 2 < 265) t.push(RG.end);
    // 七、史書
    var book = L.dy >= 290 ? '『晋書』' : L.dy >= 266 && L.by >= 230 ? '『三国志』と『晋書』' : '『三国志』';
    if (L.cause === 'fade') t.push(top ? 'あなたの名は、どこかの史書にまだ現れるかもしれない。だがあなたの最後の行方を、史書は書かなかった。' : '史書はこの年月の興亡を記したが、あなたがその後どこへ行ったかは記さなかった――あの時代の幾千万の人々と同じように。');
    else if (top) t.push('あなたの名は、' + book + 'のどこかの頁に、本籍と官職といくつかの大事とともに記されるかもしれない。あなたのそばで畑を耕し、布を織り、兵となった人々のことは、史書は一人も書かない――あなたは、彼らを覚えているだろうか。');
    else if (mid) t.push('あなたの名は、郡の碑刻や一族の家譜には残るかもしれないが、' + book + 'に一行でもあるとは限らない。あなたと同時代の幾千万の人々の多くは、それすら残せなかった。');
    else t.push(book + 'は数百人の伝を立てた。あなたはその中にいない――あの時代の幾千万の人々と同じように。');
    return t;
  }
  // 結局的成就（由一生的経歴推出）
  function endAch(L) {
    var a = [], F = L.flags || {}, age = L.dy - L.by;
    if (L.edu && L.edu.passed) a.push('あなたは' + L.edu.city + L.edu.n + 'の試験に合格した。');
    if ((F.palace || 0) >= 2) a.push('あなたは後宮で' + F.palaceTop + 'の位にまで上った。');
    if ((L.mil || 0) >= 3 && L.cls !== 'gentry') a.push('あなたは兵卒から、刀一本槍一本で' + L.milMax + 'にまで上りつめた。');
    if (/県令|太守|郡守|刺史|九卿/.test(L.officeMax || '') && L.cls !== 'gentry' && !F.isConc) a.push('あなたは寒門から' + L.officeMax + 'にまでなった。');
    if ((L.visited || []).length >= 5) a.push('あなたは' + cnNum(L.visited.length) + 'か所の土地を巡り歩いた。');
    if ((L.echoes || []).length >= 3) a.push('あなたが若いころにした選択は、何年ものちに' + cnNum(L.echoes.length) + '度、こだまのように返ってきた。');
    if (L.purgeLog) a.push('あなたは' + L.purgeLog.pn + 'の一件を生き延びた。');
    if (F.loyal) a.push('旧主が滅んだあとも、あなたは別の主に乗り換えなかった。');
    if (L.hobby && L.hobby.tal) a.push('あなたは' + D.HOBBY[L.hobby.k].n + 'で' + (L.cls === 'gentry' ? '一時その名を知られた' : '郷里に名を知られた') + '。');
    if ((L.battles || []).length) a.push('あなたは名もなき一兵卒として、' + L.battles.slice(0, 3).join('、') + (L.battles.length > 3 ? 'など' + cnNum(L.battles.length) + '度の戦い' : '') + 'を経験した。');
    if (F.famousConc) a.push('あなたはかつて' + figName(F.famousConc) + 'の妾だった。');
    if (L.youthFig) a.push('あなたと' + figName(L.youthFig) + 'は少年時代の友人だった。' + (F.yfServed ? 'のちにあなたは彼のもとに身を寄せた。' : ''));
    if (F.wedFig) a.push('あなたは' + figName(F.wedFig) + 'の娘を娶った。');
    if (age >= 80 && L.cause !== 'fade') a.push('あなたは' + cnNum(age) + '歳まで生きた。');
    if (L.cause === 'fade') a.push('あなたはこのシミュレーションの最後の年を越えて生き延びた。');
    return a;
  }
  /* ================= 親疏、営生、故交 ================= */
  var REL_LBL = [[80, '親密'], [60, '和やか'], [40, '普通'], [20, '疎遠'], [-999, '不仲']];
  function relLabel(a) { for (var i = 0; i < REL_LBL.length; i++) if (a >= REL_LBL[i][0]) return REL_LBL[i][1]; return '普通'; }
  var JOB_M = { peasant: '農夫', tenant: '佃戸', tuntian: '屯田客', soldier: '軍卒', artisan: '工匠', merchant: '商販', slave: '奴僕', clerk: '県吏', gentry: '士人', tribal: '牧人' };
  var JOB_F = { gentry: '持家', clerk: '持家', merchant: '持家', slave: '婢女', tribal: '牧人' };
  function jobFor(L, k) {
    var R = L.R;
    if (k.sex === 'F') return JOB_F[L.cls] || pick(R, ['農婦', '織婦']);
    if (L.cls === 'clerk') return pick(R, ['県吏', '書佐', '亭長', '郷嗇夫']);
    if (L.cls === 'gentry') return k.rel === 'father' ? pick(R, L.gate >= 3 ? ['郡守', '議郎', '士人'] : ['郡吏', '士人', '県令']) : (k.lit || R() < 0.7 ? pick(R, ['儒生', '郡吏', '士人']) : '士人');
    if (L.cls === 'artisan') return R() < 0.75 ? '工匠' : '農夫';
    if (L.cls === 'peasant' && R() < 0.08) return pick(R, ['木匠', '鉄匠', '貨郎', '傭工']);
    return JOB_M[L.cls] || '農夫';
  }
  function kinAffInit(L, k) {
    var R = L.R, base = { father: 65, mother: 75, gp: 70, sib: 60, spouse: 55, child: 72, dimu: 40 }[k.rel] || 60;
    return Math.round(clamp(base + (R() - 0.5) * 30, 10, 95));
  }
  function affAdd(k, d) { if (k) k.aff = clamp((k.aff == null ? 60 : k.aff) + d, 0, 100); }
  var KR_POS = {
    spouse: ['あなたが病に伏していたあいだ、{k}は昼も夜も枕元を離れなかった。', '{k}はこつこつ貯めたわずかな銭を出して、あなたに新しい着物を仕立ててくれた。', '仕事から帰ると、{k}がもう竃の上で飯を温めてくれていた。'],
    child: ['{k}が市から飴をひと包み買ってきてくれた。', '{k}が畑仕事を片づけてくれて、あなたには手を出させなかった。', '{k}が新しい技を覚えて、走ってきてやって見せてくれた。'],
    parent: ['{k}が若いころから使い慣れた道具を、あなたに譲ってくれた。', '{k}が家の昔話をたくさん聞かせてくれた。'],
    sib: ['{k}が屋根の修理を手伝いに来てくれた。礼の言葉ひとつ求めなかった。', 'あなたと{k}は灯火の下で夜半まで語り合った。']
  };
  KR_POS.spouseHi = ['あなたが病に伏していたあいだ、{k}は昼も夜も枕元を離れず、薬も自ら味見してから差し出した。', '{k}は人に頼んで、よその郡から上等な絹を一匹取り寄せてくれた。', 'あなたと{k}は灯火の下で向かい合い、夜半まで家のことを語り合った。'];
  KR_POS.dimu = ['{k}がめずらしくあなたに優しく接し、新しい着物を一枚くれた。', '{k}が病にかかり、あなたは枕元で薬湯の世話をした。彼女はあなたの手を取り、実の子よりも孝行だと言った。'];
  KR_POS.shumu = ['{k}がこっそり貯めた数枚の銭をあなたに握らせ、嫡母には知られないようにと念を押した。', '裏庭に{k}を訪ねた。彼女はあなたに靴を一足縫ってくれていた。針目がぎっしりと細かかった。'];
  KR_POS.conc = ['{k}は手先が器用で、あなたに新しい袍を一着縫ってくれた。', '{k}は一家の老若の世話を細やかにこなし、余計なことは一言も口にしなかった。'];
  KR_POS.concF = ['{k}はあなたにうやうやしく接し、家で何かあれば、まずあなたに伺いを立てに来た。', '{k}が子どもの面倒を見てくれたので、あなたは久しぶりにぐっすり眠れた。'];
  var KR_NEG = {
    spouse: ['あなたと{k}は銭のことで言い争い、何日も口をきかなかった。', '{k}はあなたが家を顧みないと言って、子どもの前であなたを責め立てた。'],
    child: ['{k}が、あれこれ口を出しすぎだとあなたに食ってかかった。', '{k}が家の銭をこっそり持ち出し、あなたに見つかった。'],
    parent: ['{k}は、言うことを聞かないと言って、一族の前であなたを叱りつけた。'],
    sib: ['あなたと{k}は家産の分け方で大喧嘩になった。', '{k}はあなたから借りた銭を、いつまでも返さなかった。'],
    conc: ['{k}がまた正室ともめて、家の中は何日も冷え切っていた。', '{k}は陰で、この家では自分は下女にも及ばないとこぼしていた。'],
    concF: ['{k}は夫の寵愛をかさに着て、あなたへの口のきき方もぞんざいになった。', '夫はこのひと月、ずっと{k}の部屋で寝ていた。あなたは何も言わなかった。']
  };
  KR_NEG.spouseHi = ['あなたと{k}は家の費用のことで言い争い、何日も口をきかなかった。', '{k}は、あなたが一族の親類に冷たすぎると言って、下女たちの前であなたに小言を言った。'];
  KR_NEG.dimu = ['{k}は一族の前であなたを叱りつけ、庶出の者はやはりしつけがなっていないと言った。', '{k}は父があなたに遺した物を、こっそり自分の子に与えてしまった。', '{k}はあなたの生母を庭で一刻のあいだ跪かせた。あなたは何も言えなかった。'];
  KR_NEG.shumu = ['{k}は、何事も耐えて、嫡出の兄弟と争うなとあなたを諭した。聞いているうちに胸が苦しくなり、あなたは彼女に当たり散らしてしまった。'];
  function kinRelYear(L, y) {
    var R = L.R, F = L.rec.focus ? L.rec.focus.eff : null;
    var drift = F === 'family' || F === 'kids' || F === 'house' ? 1.5 : F === 'travel' || F === 'army' || F === 'social' ? -0.6 : 0;
    var pool = [];
    L.kin.forEach(function (k) {
      if (!k.alive || k.apart || k.by > y) return;
      if ((k.rel === 'conc' && L.sex === 'F' && !(L.spouseK && L.spouseK.alive)) || k.famous) return;
      if (k.aff == null) k.aff = kinAffInit(L, k);
      if (drift && (k.rel === 'spouse' || k.rel === 'child')) affAdd(k, drift);
      if (y - k.by >= 8 && L.age >= 8) pool.push(k);
    });
    if (!pool.length || !cool(L, 'kinrel', 3) || R() > 0.35) return;
    var hiH = L.cls === 'gentry' || lifeTier(L, y).k === 'top' || lifeTier(L, y).k === 'high';
    var k = pick(R, pool), grp = k.rel === 'mother' && k.concMom ? 'shumu' : k.rel === 'father' || k.rel === 'mother' || k.rel === 'gp' ? 'parent' : k.rel === 'conc' ? (L.sex === 'M' ? 'conc' : 'concF') : k.rel === 'spouse' && hiH ? 'spouseHi' : k.rel;
    if (!KR_POS[grp]) return;
    var good = R() < 0.55 + (L.tr.soc - 50) / 200 + (k.aff - 60) / 200;
    var t = fresh(L, (good ? KR_POS : KR_NEG)[grp]).replace('{k}', kinLabel(L, k));
    affAdd(k, good ? 8 : -12);
    add(L, 2.3, 'fam', t);
  }
  function R2(L) { return L.R(); }
  function kinJobYear(L, k, y) {
    var ka = y - k.by;
    if (k.soldier) { k.job = '軍卒'; return; }
    if (k.out && k.sex === 'F' && (k.rel === 'child' || k.rel === 'sib')) { k.job = '出嫁'; return; }
    if (!k.job && ka >= 15) {
      var PJ = { read: L.cls === 'gentry' ? '儒生' : L.cls === 'clerk' || R2(L) < 0.3 ? '県吏' : '儒生', craft: '工匠', farm: k.sex === 'F' ? '農婦' : '農夫', trade: '商販' };
      k.job = k.path && PJ[k.path] ? PJ[k.path] : jobFor(L, k);
      if (k.path === 'read') k.lit = true;
      if (k.rel === 'child' && !k.apart && k.job !== '農夫' && k.job !== '農婦') add(L, 1.15, 'fam', kinLabel(L, k) + 'は大人になり、' + k.job + 'になった。');
    }
  }
  // 老来：子女是否奉養，看親疏
  function elderSupport(L, y) {
    if (L.age < 58) return 0;
    var amt = 0, cold = null;
    L.kin.forEach(function (k) {
      if (k.rel !== 'child' || !k.alive || k.apart || y - k.by < 18) return;
      if ((k.aff || 60) >= 60) amt += k.out ? 600 : 1200; else if ((k.aff || 60) < 30) cold = k;
    });
    if (cold && cool(L, 'cold', 6)) add(L, 3.4, 'bad', kinLabel(L, cold) + 'はめったにあなたに会いに来なかった。昔から積もったわだかまりのせいだと、あなたにはわかっていた。');
    return Math.min(amt, 4000);
  }

  var FR_CTX = {
    child: ['幼なじみ', '一緒に牛を追い、鳥の巣を探して育った'], school: ['同窓', '一緒に書を学んだ'], army: ['同じ伍の仲間', '同じ伍で苦労を共にした'], office: ['同僚', '県の役所で一緒に働いた'],
    childHi: ['幼なじみ', '一族の家塾で共に学び、裏庭で一緒に遊んで育った'], girlHi: ['閨中の姉妹', '一緒に針仕事を習い、『女誡』を読んだ'], scholar: ['同志', 'よく一緒に経義を論じ合った'], trade: ['商売仲間', '一緒に商いをして回った'], girl: ['隣家の姉妹', '一緒に桑を摘み、機を織った'], village: ['同郷の者', '同じ里に住む'], band: ['戦友', '共に主君に従った'], old: ['旧友', '晩年によく一緒に日向ぼっこをした']
  };
  function frCtx(L) {
    var a = L.age;
    if (L.band) return 'band';
    if (L.soldier) return 'army';
    var hiF = L.cls === 'gentry' || lifeTier(L, L.by + a).k === 'top';
    if (a < 15) return L.schooling ? 'school' : hiF ? 'childHi' : 'child';
    if (L.office) return 'office';
    if (L.cls === 'merchant') return 'trade';
    if (L.sex === 'F') return hiF ? 'girlHi' : 'girl';
    if (L.cls === 'gentry') return 'scholar';
    if (a >= 60) return 'old';
    return L.schooling && a < 22 ? 'school' : 'village';
  }
  function friendsYear(L, y) {
    var R = L.R, a = L.age, F = L.rec.focus ? L.rec.focus.eff : null;
    L.friends = L.friends || [];
    // 結交
    var alive = L.friends.filter(function (f) { return f.alive && !f.apart; }).length;
    var p = 0.05 + (F === 'social' ? 0.22 : F === 'travel' ? 0.15 : F === 'fame' || F === 'play' ? 0.1 : 0) + (L.found.charm ? 0.04 : 0) + (L.tr.soc - 50) / 400;
    if (a >= 6 && !inHH(L) && alive < (F === 'social' ? 9 : 6) && R() < p) {
      var ctx = frCtx(L), sex = L.sex === 'F' || ctx === 'girl' ? 'F' : 'M';
      var sur = L.eth && !D.ETH[L.eth].sur ? '' : surname(R, L.cls === 'gentry' && ctx !== 'village' ? 'gentry' : L.cls);
      var fr = { name: sur + safeGiven(R, sur, sex), sex: sex, by: y - a + Math.round((R() - 0.5) * 6), since: y, ctx: ctx, aff: Math.round(55 + R() * 25), alive: true, apart: false, job: '', fate: '' };
      fr.hi = ['childHi', 'girlHi', 'scholar'].indexOf(ctx) >= 0;
      if (a >= 15) fr.job = fr.hi ? (sex === 'F' ? '持家' : '士人') : ctx === 'army' ? '軍卒' : ctx === 'office' ? pick(R, ['書佐', '県吏', '郡吏']) : ctx === 'trade' ? '商販' : sex === 'F' ? pick(R, ['農婦', '織婦']) : pick(R, ['農夫', '佃戸', '工匠', '貨郎']);
      L.friends.push(fr);
      add(L, 2.4, 'good', fresh(L, ['あなたは' + fr.name + 'と友達になった。', 'あなたは' + fr.name + 'と知り合い、二人はとても気が合った。', fr.name + 'は' + FR_CTX[ctx][1] + '仲間で、二人はしだいに親しい友になった。']));
    }
    // 故交的一年
    var evDone = false;
    L.friends.forEach(function (f) {
      if (!f.alive || f.apart) return;
      var fa = y - f.by;
      if (!f.job && fa >= 15) f.job = f.hi ? (f.sex === 'F' ? '持家' : '士人') : f.sex === 'F' ? '農婦' : pick(R, ['農夫', '佃戸', '工匠']);
      var q = f.fig ? 0 : baseQ(Math.max(1, fa)) * chaos(y) * 0.9 * (f.job === '軍卒' ? 1.6 : 1);
      if (R() < q) {
        f.alive = false; f.dy = y; f.fate = fa < 15 ? '若くして死去' : fa >= 55 ? '天寿を全う' : f.job === '軍卒' ? '陣中で死去' : '病没';
        if (f.aff >= 40) add(L, 2.9, 'fam', 'あなたの友人' + f.name + 'が亡くなった。享年' + cnNum(Math.max(1, fa)) + '。' + (f.aff >= 75 ? 'あなたは長いこと、その墓の前に座っていた。'.replace('他', f.sex === 'F' ? '她' : '他') : ''));
        return;
      }
      if (f.fig || evDone || R() > 0.1) return;
      evDone = true;
      if (inHH(L)) { var hw = L.flags.fcPal ? '宮中' : '屋敷'; affAdd(f, 3); add(L, 2.5, 'life', fresh(L, [f.name + 'から' + hw + 'へ手紙が届いた。元気にしているかと書いてあった。', hw + 'の買い出しに出る下女に頼んで、' + f.name + 'へ品物を届けてもらった。', f.name + 'は、あなたが' + hw + 'で大事にされていると聞き、人づてに祝いの言葉を寄こした。'])); return; }
      var r = R(), ta = f.sex === 'F' ? '彼女' : '彼';
      if (r < 0.25 && poorNow(L) && f.aff >= 60) { L.eco.cash += 200; affAdd(f, 5); add(L, 2.5, 'good', f.name + 'は、あなたの家の食糧が尽きたと聞いて、粟を二斗届けてくれた。'); }
      else if (r < 0.45 && fa >= 16 && fa <= 40 && f.sex === 'M' && f.job !== '軍卒') { var nj = pick(R, ['軍卒', '県吏', '商販', '門客']); f.job = nj; add(L, 2.5, 'life', 'あなたの友人' + f.name + (nj === '軍卒' ? 'は軍に身を投じた。発つ前に、' + ta + 'はあなたと一度酒を酌み交わしに来た。' : nj === '県吏' ? 'は県の役所で小吏になった。' : nj === '商販' ? 'は商いを始め、一年じゅう各地を飛び回るようになった。' : 'はある豪族の門下に身を寄せた。')); }
      else if (r < 0.62) { affAdd(f, -18); add(L, 2.5, 'bad', fresh(L, ['あなたは' + f.name + 'とささいなことで仲たがいした。', f.name + 'が陰であなたの噂話をし、それがあなたの耳に入った。'])); }
      else if (r < 0.78 && f.aff < 50) { affAdd(f, 20); add(L, 2.5, 'good', 'あなたは' + f.name + 'と仲直りし、昔のような間柄に戻った。'); }
      else { affAdd(f, 4); add(L, 2.5, 'life', fresh(L, [f.name + 'が訪ねてきて、二人で午後いっぱい語り合った。', 'あなたは' + f.name + 'の家の祝い酒に招かれた。', 'あなたは' + f.name + 'と連れ立って県城へ出かけた。'])); }
    });
  }
  function friendsApart(L, why) {
    (L.friends || []).forEach(function (f) { if (f.alive && !f.apart && f.ctx !== 'band') { f.apart = true; f.fate = why; } });
  }
  function bestFriend(L, min) {
    var fs = (L.friends || []).filter(function (f) { return f.alive && !f.apart && !f.fig && f.aff >= (min || 0); }).sort(function (a, b) { return b.aff - a.aff; });
    return fs[0] || null;
  }

  /* ================= 査詢 ================= */
  function household(L, y) {
    // 戸籍簡：返回当前同戸之人，第一位為戸人（戸主）
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
      if (head && (head.rel === 'father' || head.rel === 'mother') && k.rel === 'sib') r = k.sex === 'M' ? '児子' : '女児';
      if (head && head.rel === 'father' && k.rel === 'gp') r = k.sex === 'M' ? '父親' : '母親';
      if (head && head.rel === 'spouse' && k.rel === 'child') r = k.sex === 'M' ? '児子' : '女児';
      list.push({ sex: k.sex, age: y - k.by, name: k.name, rel: r, soldier: !!k.soldier });
    });
    return list;
  }
  function slipText(L, p, headName) {
    var a = p.age + 1; // 虚歳
    var big = a >= 15, t;
    var REL = { 妾: '妾', 丈夫的妾: '妾', 妻子: '妻', 丈夫: '夫', 父親: '父', 母親: '母', 祖父: '祖父', 祖母: '祖母', 児子: '子男', 女児: '子女', 哥哥: '兄', 弟弟: '弟', 姐姐: '姉', 妹妹: '妹' };
    if (L.cls === 'slave' && p.me) t = '戸下' + (p.sex === 'M' ? '奴' : '婢') + p.name + '年' + slipNum(a);
    else if (p.head) t = L.village + '戸人' + (p.sex === 'M' ? '公乗' : '大女') + p.name + '年' + slipNum(a) + (big && a <= 56 ? '　算一' : '');
    else {
      var r = p.rel ? REL[p.rel] || '' : (L.sex === 'F' && L.married ? '妻' : p.sex === 'M' ? '子男' : '子女');
      t = headName + r + (p.sex === 'F' && big && r.indexOf('子') < 0 ? '大女' : '') + p.name + '年' + slipNum(a);
    }
    if (p.soldier) t += '　従軍';
    if (p.injury) t += '　傷' + p.injury;
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
    placeText: placeText, focusOptions: focusOptions, setFocus: setFocus, FOCUS: FOCUS, traitWords: traitWords, hobbyText: hobbyText, condText: condText, TALENT: TALENT, ecoView: ecoView,
    spendOptions: spendOptions, spend: spend, relLabel: relLabel, famLevel: famLevel, lifeTier: lifeTier, polsAt: polsAt, atmosAt: atmosAt, regionView: regionView, lifeSummary: lifeSummary, heirOf: heirOf, afterlife: afterlife, afterword: afterword, endAch: endAch, isHead: isHead, autoAnswer: autoAnswer, fmt: fmt, LANDP: LANDP, CAUSE_SHORT: CAUSE_SHORT, CAUSE_STAT: CAUSE_STAT, POP_SCALE: POP_SCALE, stats: stats
  };
})(SGD);
if (typeof module !== 'undefined') module.exports = SGE;
