/* 五千万分之一 —— 界面与播放 */
(function () {
  'use strict';
  var D = SGD, E = SGE;
  var $ = function (id) { return document.getElementById(id); };
  var cn = E.cnNum;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function h(tag, cls, html) { var el = document.createElement(tag); if (cls) el.className = cls; if (html != null) el.innerHTML = html; return el; }

  /* ---------- 本地記録 ---------- */
  var KEY = 'yishi-hanmo-v1-ja';
  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && d.lives && d.met) return d; } catch (e) { /* 無痕模式等 */ }
    return { lives: [], met: {}, speed: 6 };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* 忽略 */ } }
  var store = load();

  var SPEEDS = [['ゆっくり', 12], ['ふつう', 6], ['速い', 2.5], ['最速', 0.7]];
  var MODES = { history: 'H', zhongping: 'Z', jianan: 'J', chaos: 'C', blind: 'B', xiping: 'X', sanguo: 'S', weijin: 'W', taikang: 'T', mirror: 'M', heir: 'G' };
  var MODE_NAME = { history: '史実の人生', zhongping: '中平生まれ', jianan: '建安生まれ', chaos: '乱世の子', blind: '真のランダム', xiping: '熹平生まれ', sanguo: '三国鼎立', weijin: '魏晋の際', taikang: '太康生まれ', mirror: 'もし私があの時代に生まれたら', heir: '家を継ぐ' };
  var GNAME = function (g, y) { return { han: '漢', wei: y < 220 ? '曹操' : '魏', shu: y < 221 ? '劉備' : '蜀漢', wu: y < 222 ? '孫氏' : '呉', jin: y >= 317 ? '東晋' : '晋', other: 'その他の勢力' }[g]; };

  var S = { speed: store.speed || 6, playing: true, last: 0, t: 0, queue: [], yearActive: false, L: null, comps: [], statsCache: {} };

  /* ---------- 屏幕切換 ---------- */
  function show(id) {
    ['intro', 'birth', 'life', 'end'].forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }

  /* ---------- 命数 ---------- */
  function newSeed() { return (Math.random() * 4294967296) >>> 0; }
  function codeOf(seed, mode) { return MODES[mode] + '-' + seed.toString(36).toUpperCase(); }
  function parseCode(s) {
    var m = /^\s*([HZJCBXSWTM])\s*-?\s*([0-9A-Z]+)\s*$/i.exec(s || '');
    if (!m) return null;
    var mode = Object.keys(MODES).filter(function (k) { return MODES[k] === m[1].toUpperCase(); })[0];
    var seed = parseInt(m[2], 36);
    if (!isFinite(seed)) return null;
    return { seed: seed >>> 0, mode: mode === 'mirror' || mode === 'heir' ? 'history' : mode };
  }
  function compSeed(seed, i) { return (seed ^ Math.imul(0x9E3779B9, i + 1)) >>> 0; }

  /* ---------- 統計（同時代人） ---------- */
  function statsMode(mode) { return mode === 'blind' || mode === 'mirror' || mode === 'heir' ? 'history' : mode; }
  function ensureStats(mode) {
    if (S.statsCache[mode]) return;
    var st = { ages: [], causes: [], done: false, n: 0 };
    S.statsCache[mode] = st;
    var N = 2400, i = 0;
    (function chunk() {
      var end = Math.min(N, i + 120);
      for (; i < end; i++) {
        var L = E.create(compSeed(0x5EED1234 + i * 7919, i % 7), { auto: true, mode: mode });
        E.runToEnd(L);
        st.ages.push(L.years.length - 1);
        st.causes.push(L.cause);
      }
      st.n = i;
      if (i < N) setTimeout(chunk, 0); else { st.done = true; if (S.onStats) S.onStats(); }
    })();
  }

  /* ---------- 開篇 ---------- */
  var PROV = [
    ['北京', ['広陽郡', '漁陽郡', '上谷郡', '涿郡']], ['天津', ['漁陽郡', '勃海郡', '河間国']],
    ['河北', ['涿郡', '中山国', '常山国', '鉅鹿郡', '趙国', '安平国', '河間国', '清河国', '勃海郡', '魏郡', '代郡', '上谷郡']],
    ['山西', ['太原郡', '上党郡', '雁門郡', '西河郡', '河東郡']], ['内蒙古', ['雲中郡', '五原郡', '代郡'], '当時は主に鮮卑・匈奴の遊牧の地だったため、最も近い漢の郡とする。'],
    ['遼寧', ['遼東郡', '遼西郡', '玄菟郡']], ['吉林', ['玄菟郡', '遼東郡'], '当時は主に夫余・高句麗の地だったため、最も近い漢の郡とする。'], ['黒竜江', ['玄菟郡', '遼東郡'], '当時は漢の領域外だったため、最も近い漢の郡とする。'],
    ['上海', ['呉郡']], ['江蘇', ['下邳国', '彭城国', '東海郡', '広陵郡', '呉郡', '丹楊郡']], ['浙江', ['呉郡', '会稽郡']],
    ['安徽', ['九江郡', '廬江郡', '沛国', '汝南郡', '丹楊郡']], ['福建', ['会稽郡'], '福建は当時、会稽郡の南部（東冶）に属していた。'], ['江西', ['予章郡']],
    ['山東', ['済南国', '平原郡', '楽安国', '北海国', '東莱郡', '斉国', '泰山郡', '魯国', '琅邪国', '東平国', '任城国', '済北国', '山陽郡', '済陰郡', '東郡']],
    ['河南', ['河南尹', '河内郡', '弘農郡', '潁川郡', '汝南郡', '陳国', '梁国', '陳留郡', '南陽郡']],
    ['湖北', ['南郡', '江夏郡', '南陽郡']], ['湖南', ['長沙郡', '零陵郡', '桂陽郡', '武陵郡']],
    ['広東', ['南海郡', '蒼梧郡', '合浦郡']], ['広西', ['蒼梧郡', '鬱林郡', '合浦郡']], ['海南', ['合浦郡'], '海南島は当時、合浦郡に属していた。'],
    ['香港', ['南海郡']], ['澳門', ['南海郡']], ['重慶', ['巴郡']], ['四川', ['蜀郡', '広漢郡', '犍為郡', '巴郡', '越巂郡']],
    ['貴州', ['牂柯郡']], ['雲南', ['益州郡', '永昌郡', '越巂郡']], ['西蔵', ['蜀郡', '越巂郡'], '当時は漢の領域外だったため、最も近い漢の郡とする。'],
    ['陝西', ['京兆尹', '左馮翊', '右扶風', '漢中郡']], ['甘粛', ['漢陽郡', '隴西郡', '武威郡', '張掖郡', '酒泉郡', '敦煌郡', '武都郡', '安定郡']],
    ['寧夏', ['北地郡', '安定郡']], ['青海', ['金城郡']], ['新疆', ['敦煌郡'], '西域は当時、西域長史の管轄下にあったため、最も近い敦煌郡とする。'],
    ['台湾', ['会稽郡'], '台湾は当時「夷洲」と呼ばれ、孫呉は230年に兵一万を海の向こうへ送り込んだ。会稽郡とする。'], ['海外・その他', null]
  ];
  function initIntro() {
    var sel = $('m-prov');
    PROV.forEach(function (p, i) { var o = document.createElement('option'); o.value = i; o.textContent = p[0]; if (p[0] === '河南') o.selected = true; sel.appendChild(o); });
    $('btn-born').onclick = function () {
      var mode = document.querySelector('input[name="mode"]:checked').value;
      startLife(newSeed(), { mode: mode });
    };
    $('btn-mirror').onclick = function () {
      var p = PROV[+$('m-prov').value];
      var opts = { mode: 'mirror', sex: $('m-sex').value, tier: +$('m-tier').value, edu: $('m-edu').value };
      if (p[1]) opts.juns = p[1];
      var job = $('m-job').value, tmp = $('m-temper').value, bd = +$('m-body').value;
      if ($('m-era').value !== 'history') opts.era = $('m-era').value;
      var JOB = {
        army: { mjob: 'army', mflag: 'martial', mtal: { strength: 0.3 }, mtr: { act: 6 } },
        civil: { mjob: 'civil', mtr: { cau: 6 } },
        edu: { mjob: 'edu', mtal: { memory: 0.25 }, mtr: { cur: 6 } },
        med: { mjob: 'edu', mtal: { memory: 0.15 }, mtr: { cur: 10, cau: 4 } },
        biz: { mjob: 'biz', mtal: { charm: 0.25 }, mtr: { soc: 6 } },
        craft: { mjob: 'craft', mtal: { craft: 0.3 }, mtr: { per: 6 } },
        farm: { mjob: 'farm', mtal: { strength: 0.15 }, mtr: { per: 4 } },
        art: { mtal: { craft: 0.15, charm: 0.1 }, mtr: { cur: 8, ind: 6 } }
      }[job] || {};
      var TMP = { out: { soc: 12, act: 8 }, 'in': { soc: -10, cau: 8 }, cau: { cau: 15, act: -4 }, bold: { ind: 10, act: 10, cau: -10 } }[tmp] || {};
      var mtr = {}; [JOB.mtr || {}, TMP].forEach(function (o) { for (var k in o) mtr[k] = (mtr[k] || 0) + o[k]; });
      if (Object.keys(mtr).length) opts.mtr = mtr;
      if (JOB.mtal) opts.mtal = JOB.mtal;
      if (JOB.mjob) opts.mjob = JOB.mjob;
      if (JOB.mflag) opts.mflag = JOB.mflag;
      if (bd) opts.mbody = bd;
      var extra = [];
      if (opts.era) extra.push($('m-era').selectedOptions[0].textContent.replace(/（.*$/, ''));
      if (job) extra.push($('m-job').selectedOptions[0].textContent);
      if (tmp) extra.push($('m-temper').selectedOptions[0].textContent);
      if (bd) extra.push($('m-body').selectedOptions[0].textContent);
      opts.mirror = { prov: p[0], note: p[2] || '', tier: $('m-tier').selectedOptions[0].textContent, edu: $('m-edu').selectedOptions[0].textContent, extra: extra.join(' · ') };
      startLife(newSeed(), opts);
    };
    $('btn-seed').onclick = function () {
      var c = parseCode($('seed-input').value);
      if (!c) { toast('命数は H-1K3X9Q のような形式です'); return; }
      startLife(c.seed, { mode: c.mode });
    };
    var hm = /^#m([HZJCBXSWT][0-9A-Z]+)$/i.exec(location.hash || '');
    if (hm) { $('seed-input').value = hm[1].slice(0, 1) + '-' + hm[1].slice(1); $('seed-panel').open = true; }
    $('btn-home').onclick = goHome;
    $('btn-back').onclick = goHome;
    $('harsh').checked = !!store.harsh;
    $('harsh').onchange = function () { store.harsh = $('harsh').checked; save(); };
    renderLedger();
  }
  function goHome() { stopLife(); show('intro'); renderLedger(); }
  function renderLedger() {
    var n = store.lives.length, met = Object.keys(store.met).length;
    $('intro-ledger').innerHTML = n ? 'これまでの転生 <b class="num">' + n + '</b> 回 · 名簿 <b class="num">' + met + '/' + D.FIGURES.length + '</b>' : '';
  }

  /* ---------- 降生 ---------- */
  function startLife(seed, opts) {
    stopLife();
    S.seed = seed; S.opts = opts; S.mode = opts.mode; S.blind = opts.mode === 'blind'; S.saved = false;
    var o = {}; for (var k in opts) if (k !== 'mirror') o[k] = opts[k];
    o.harsh = !!store.harsh;
    S.L = E.create(seed, o);
    S.L.autoSpendOn = !!store.autoSpend;
    S.comps = [0, 1, 2].map(function (i) {
      var c = E.create(compSeed(seed, i), { auto: true, year: S.L.by, mode: 'history' });
      c.cseed = compSeed(seed, i);
      return E.runToEnd(c);
    });
    S.sk = opts.era || statsMode(opts.mode);
    ensureStats(S.sk);
    renderBirth();
    show('birth');
    $('btn-start').focus({ preventScroll: true });
  }

  function clsName(L) { return L.eth ? D.ETH[L.eth].n + '人' : D.CLASSES[L.cls].n; }
  function eraLine(L, y, zone) {
    var g = E.ganzhi(y);
    if (S.blind) return { big: 'ある年', sub: g + '年' };
    var e = E.era(zone, y);
    return { big: e.text, sub: '西暦' + y + ' · ' + g };
  }

  function renderBirth() {
    var L = S.L, y = L.by, el = eraLine(L, y, L.zone);
    var Z = D.ZONES[L.zone], jun = D.JUN[L.jun][0];
    var rank = L.rank === 1 ? (L.sex === 'M' ? '長男' : '長女') : '第' + cn(L.rank) + (L.sex === 'M' ? '子' : '女');
    var landTxt = L.land > 0 ? '<span class="num">' + L.land + '</span> 畝' : { tenant: 'なし（豪族の田を小作）', tuntian: 'なし（官田を耕作）', slave: 'なし（奴婢の身）', tribal: 'なし（一族で山林・草地を共有）', soldier: 'なし' }[L.cls] || 'なし';
    var father = L.kin[0], mother = L.kin[1];
    var hh = 1 + L.kin.filter(function (k) { return k.alive; }).length;
    var next = D.MILESTONES.filter(function (m) { return m[0] >= y; })[0];
    var cd = '';
    if (S.blind) cd = 'それが何年なのか、あなたは知らない。わかるのは' + E.ganzhi(y) + '年ということだけだ。';
    else if (next && next[0] === y) cd = 'この年、「' + next[1] + '」が起こる。';
    else if (next) cd = '「' + next[1] + '」まで、あと <span class="num">' + (next[0] - y) + '</span> 年。';
    var mirror = '';
    if (S.opts.mirror) {
      var M = S.opts.mirror;
      mirror = '<p class="mirror-note">あなたの入力：' + esc(M.prov) + ' · 家計' + esc(M.tier) + ' · ' + esc(M.edu) + (M.extra ? ' · ' + esc(M.extra) : '') + '。' + esc(M.note) +
        '後漢では人口のおよそ八割が農民と佃客で、士族は三パーセントに満たなかった。あなたの現代の条件はくじの重みを変えたが、くじは引かねばならない——今回、あなたが引き当てたのは「' + clsName(L) + '」だった。</p>';
    }
    var fl = E.famLevel(L, hh), laws = L.eth ? [] : E.polsAt(L.zone, y);
    $('birth-main').innerHTML =
      '<p class="kicker">' + (S.blind ? '真のランダム' : MODE_NAME[S.mode]) + '</p>' +
      '<h2 class="birth-name"><span>あなたは</span>' + esc(L.name) + '</h2>' +
      '<p class="birth-name-sub">' + nameNote(L) + '</p>' +
      (S.opts.heir ? '<p class="mirror-note">あなたは' + esc(S.opts.heir.parentName) + 'の' + (L.sex === 'M' ? '息子' : '娘') + '。前世のあなたが' + (S.opts.heir.dy) + '年に世を去ったとき、あなたは' + cn(Math.max(0, S.opts.heir.age)) + '歳だった。' + lineageText(S.opts.heir.lineage, L) + '</p>' : '') +
      '<p class="era-big">' + el.big + '<small>' + (S.blind ? el.sub : '（' + y + '）' + E.ganzhi(y)) + '</small></p>' +
      '<p class="born-line">あなたは生まれた。</p>' +
      '<dl class="facts">' +
      '<dt>出生地</dt><dd>' + Z.zhou + ' · ' + jun + ' · ' + L.county + (L.eth ? '（山野）' : L.urban ? '（県城）' : '（' + L.village + '）') + '</dd>' +
      '<dt>性別</dt><dd>' + (L.sex === 'M' ? '男' : '女') + '</dd>' +
      '<dt>家柄</dt><dd>' + (L.eth ? D.ETH[L.eth].tribe : clsName(L)) + '</dd>' +
      (L.clanName ? '<dt>門第</dt><dd>' + esc(L.clanName) + '、' + L.gateName + '</dd>' : '') +
      (L.dishu ? '<dt>嫡庶</dt><dd>' + (L.shu ? '庶出（生母' + esc(mother.name) + 'は父の妾）' : '嫡出（正室の子）') + '</dd>' : '') +
      '<dt>兄弟順</dt><dd>' + rank + '</dd>' +
      '<dt>父の読み書き</dt><dd>' + (father.alive ? (father.lit ? 'できる' : 'できない') : '父はすでに亡い') + '</dd>' +
      '<dt>母の存命</dt><dd>' + (mother.alive ? '存命' : '死去') + '</dd>' +
      '<dt>田地</dt><dd>' + landTxt + '</dd>' +
      '<dt>家族の人数</dt><dd><span class="num">' + hh + '</span> 人</dd>' +
      '<dt>暮らし向き</dt><dd><b>' + fl.lv + '</b></dd>' +
      (laws.length ? '<dt>この地の法令</dt><dd>' + laws.map(function (p) { return esc(p.n); }).join('、') + '</dd>' : '') +
      '</dl>' +
      '<p class="fam-note">' + esc(fl.t) + (fl.r ? '<span>' + esc(fl.r) + '</span>' : '') + '</p>' + mirror +
      '<p class="countdown">' + cd + '</p>';
    renderAttrs($('birth-attrs'), { body: L.body, wealth: L.wealth, learn: 0, standing: L.standing, fame: 0 }, L);
    var bc = $('birth-comps'); bc.innerHTML = '';
    S.comps.forEach(function (c, i) {
      var d = h('div', 'comp');
      d.innerHTML = '<span class="no">' + (i + 1) + '</span><div><b>' + esc(c.name) + '</b> <span class="who">' + (c.sex === 'M' ? '男' : '女') + ' · ' + D.ZONES[c.birthZone].zhou + D.JUN[c.birthJun][0] + ' · ' + clsName(c) + '</span></div>';
      bc.appendChild(d);
    });
    renderSpeed($('speed-birth'));
  }

  function lineageText(lin, L) {
    if (!lin || lin.length < 2) return '';
    return '家系：' + lin.map(function (x) { return x.name + '（' + x.by + '–' + x.dy + '）'; }).join(' → ') + ' → あなた。';
  }
  function nameNote(L) {
    if (L.eth) return D.ETH[L.eth].n + '人。漢人の戸籍にあなたの名はない。';
    if (L.cls === 'slave') return '幼名は' + L.xiao + '。主家の帳簿には「戸下' + (L.sex === 'M' ? '奴' : '婢') + L.given + '」と記されている。';
    if (L.sex === 'F') return '大人たちはあなたを' + L.xiao + 'と呼ぶ。大きくなれば戸籍には「大女' + L.name + '」と記され、外に出れば、人はたいていあなたを「' + L.sur + '氏」とだけ呼ぶ。';
    return '幼名は' + L.xiao + '。' + (L.cls === 'gentry' || L.cls === 'clerk' ? '冠礼を済ませれば、字（あざな）も持つことになる。' : '');
  }

  var ATTR = [['body', '体魄'], ['wealth', '家業'], ['learn', '才学'], ['standing', '人望'], ['fame', '名声']];
  function renderAttrs(el, a, L) {
    el.innerHTML = '';
    ATTR.forEach(function (x) {
      var v = Math.round(a[x[0]] || 0);
      var row = h('div', 'attr');
      if (x[0] === 'fame' && v <= 0) { row.innerHTML = '<span>' + x[1] + '</span><span class="attr-note">まだ名声はない</span><span class="v">—</span>'; }
      else row.innerHTML = '<span>' + x[1] + '</span><span class="bar"><i style="width:' + v + '%"></i></span><span class="v">' + v + '</span>';
      el.appendChild(row);
    });
  }
  function renderSpeed(el) {
    el.innerHTML = '';
    SPEEDS.forEach(function (s) {
      var b = h('button', '', s[0]);
      b.type = 'button'; b.setAttribute('aria-pressed', String(S.speed === s[1])); b.title = '一年あたり約 ' + s[1] + ' 秒';
      b.onclick = function () { setSpeed(s[1]); };
      el.appendChild(b);
    });
  }
  function setSpeed(v) {
    var old = S.speed;
    S.t = S.t * v / old;
    S.speed = v; store.speed = v; save();
    renderSpeed($('speed-birth')); renderSpeed($('speed-hud'));
  }

  /* ---------- 編年的閲読方向：黙認像聊天記録一様，新事出現在下面，自動跟随 ---------- */
  function narrow() { return window.innerWidth <= 860; }
  // 黙認最新在上
  function upMode() { return store.chronUp !== false; }
  function follow() {
    var c = $('chron'); if (S.stick === false) return;
    if (narrow()) { if (!upMode() && S.playing !== false) { var r = c.getBoundingClientRect(); if (r.bottom > window.innerHeight) window.scrollBy(0, r.bottom - window.innerHeight + 12); } return; }
    if (!upMode()) c.scrollTop = c.scrollHeight; else c.scrollTop = 0;
  }
  // 譲編年框正好塡満到窗口底部，最新的事総在眼前
  function fitChron() {
    var c = $('chron'); if (!c || !c.offsetParent) return;
    if (narrow()) { c.style.maxHeight = 'none'; return; }
    var top = c.getBoundingClientRect().top + window.scrollY;
    c.style.maxHeight = Math.max(window.innerWidth <= 860 ? 260 : 320, window.innerHeight - top - 16) + 'px';
  }
  function setChronOrder() {
    fitChron();
    var c = $('chron'), b = $('chron-order');
    c.classList.toggle('up', !!upMode());
    if (b) b.textContent = upMode() ? '最新を上に ⇅' : '最新を下に ⇅';
  }
  function toggleChronOrder() {
    store.chronUp = !upMode(); save();
    var c = $('chron'), secs = Array.prototype.slice.call(c.children).reverse();
    secs.forEach(function (x) { c.appendChild(x); });
    S.stick = true; setChronOrder(); follow();
    toast(upMode() ? '最新の年をいちばん上に表示します' : '最新の出来事をいちばん下に表示し、自動で追いかけます');
  }

  /* ---------- 人生播放 ---------- */
  function stopLife() { S.yearActive = false; S.queue = []; clearTimeout(S.endTimer); S.choiceOpen = false; }

  function beginPlayback() {
    show('life');
    $('chron').innerHTML = '';
    S.stick = true; setChronOrder();
    S.playing = true; setPlayIcon();
    renderSpeed($('speed-hud'));
    buildMap();
    $('ticker').hidden = S.blind;
    nextYear();
  }

  function nextYear() {
    var L = S.L;
    if (!L.alive) { finish(); return; }
    var y = L.by + L.age;
    S.y = y;
    // 年初：抬頭、輿図、戸籍、同時辰
    var el = eraLine(L, y, L.zone);
    $('hud-era').textContent = el.big;
    $('hud-sub').textContent = el.sub;
    $('hud-age').textContent = L.age;
    $('hud-name').textContent = L.name;
    $('hud-place').textContent = D.ZONES[L.zone].zhou + ' · ' + D.JUN[L.jun][0] + ' · ' + L.county;
    var fk = E.ctrl(L.zone, y), g = E.group(fk), chip = $('hud-ctrl');
    chip.className = 'chip g-' + (S.blind ? 'other' : g);
    chip.lastChild.textContent = S.blind ? '支配者不明' : E.fname(fk, y);
    chip.hidden = S.blind;
    var world = (D.EVENTS.filter(function (e) { return e.y === y; }).map(function (e) { return e.w; })).join(' ');
    var bs = E.figBirths(y).map(function (f) { return f.n; }); if (bs.length) world = (world ? world + ' ' : '') + y + '年、' + bs.join('・') + 'が生まれた。';
    $('ticker').lastElementChild.textContent = world || '史書はこの年の大事を何も記していない。';
    updateMap(y);
    renderComps($('comps'), y, false);
    renderRegister(y);
    renderHanji($('hanji-scroll'), $('hanji-tip'), y - 1, y);
    // 編年中的年份
    var sec = h('section', 'yr');
    var head = h('div', 'yr-head');
    head.innerHTML = '<b>' + (S.blind ? E.ganzhi(y) : esc(el.big)) + '</b><span>' + (S.blind ? '' : y + ' · ' + E.ganzhi(y) + '<br>') + (L.age === 0 ? '誕生' : L.age + ' 歳') + '</span>';
    var ol = h('ol');
    sec.appendChild(head); sec.appendChild(ol);
    if (upMode()) $('chron').prepend(sec); else $('chron').appendChild(sec);
    if (L.age <= 1) fitChron();
    follow();
    S.ol = ol;
    S.t = 0; setSeason(0);
    stepLoop();
  }

  function stepLoop() {
    var r = E.step(S.L);
    if (r && r.pending) {
      if ($('auto-choice').checked) {
        var c = r.pending, i = E.autoAnswer(S.L);
        S.ol.appendChild(h('li', 'e e-choice', esc(c.q) + ' —— 運命に任せた：<b>' + esc(c.o[i]) + '</b>')); follow();
        stepLoop(); return;
      }
      showChoice(r.pending); return;
    }
    S.rec = r;
    S.queue = r.entries.slice();
    if (r.ledger && (r.age >= 14 || r.ledger.net < 0)) { S.queue.push({ s: 3.93, k: 'ledger', t: '', lg: r.ledger, age: r.age }); }
    renderFocus(r);
    S.t = 0;
    S.yearActive = true;
  }

  function showChoice(c) {
    S.choiceOpen = true;
    var card = h('li', 'choice-card');
    var html = '';
    if (c.pre) html += '<p class="pre">' + esc(c.pre) + '</p>';
    html += '<p>' + esc(c.q) + '</p>' + (c.info ? '<p class="info">' + esc(c.info) + '</p>' : '') + '<div class="opts"></div><p class="hint">' + esc(c.hint || '選択は確率を変えるが、結果を決めはしない。') + '</p>';
    card.innerHTML = html;
    var box = card.querySelector('.opts');
    c.o.forEach(function (label, i) {
      var b = h('button', '', esc(label) + (c.dis && c.dis[i] ? '<small>' + esc(c.dis[i]) + '</small>' : '')); b.type = 'button';
      if (c.dis && c.dis[i]) { b.disabled = true; b.className = 'off'; }
      b.onclick = function () {
        E.answer(S.L, i);
        var done = h('li', 'e e-choice', (c.pre ? esc(c.pre) + '<br>' : '') + esc(c.q) + (c.narr ? '<b>' : ' —— あなたの選択：<b>') + esc(label) + '</b>');
        card.replaceWith(done);
        S.choiceOpen = false;
        stepLoop();
      };
      box.appendChild(b);
    });
    S.ol.appendChild(card); S.stick = true; follow();
    var first = box.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  var TAGS = { fun: '逸話', law: '法令', hist: '地元', rumor: '噂', war: '軍', move: '移住', meet: '奇遇', far: '遠方', spend: '支出' };
  function ledgerEl(lg, age) {
    var li = h('li', 'e e-ledger');
    var who = lg.solo ? '今年のあなた' : age < 15 || !lg.head ? '今年の家計' : '今年のあなたの家';
    var sum = who + '：収入 ' + E.fmt(lg.I) + ' · 支出 ' + E.fmt(lg.X) + ' · 余剰 <b class="' + (lg.net < 0 ? 'neg' : 'pos') + '">' + (lg.net >= 0 ? '+' : '') + E.fmt(lg.net) + '</b> 銭';
    var rows = function (arr, sign) { return arr.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td>' + sign + E.fmt(x[1]) + '</td></tr>'; }).join(''); };
    li.innerHTML = '<details><summary>' + sum + '</summary><table class="ledger"><tbody>' + rows(lg.inc, '+') + rows(lg.exp, '−') + '<tr class="tot"><td>余剰</td><td>' + (lg.net >= 0 ? '+' : '') + E.fmt(lg.net) + '</td></tr></tbody></table></details>';
    return li;
  }
  function entryEl(e) {
    if (e.k === 'ledger') return ledgerEl(e.lg, e.age);
    var tag = TAGS[e.k] && e.k !== 'far' ? '<span class="tag">' + TAGS[e.k] + '</span>' : '';
    return h('li', 'e e-' + e.k, tag + esc(e.t));
  }
  function revealEntry(e) {
    S.ol.appendChild(entryEl(e)); follow();
    if (e.k === 'death') S.dying = true;
  }
  function revealAt(e) { return (Math.min(e.s, 3.95) / 4) * S.speed * 0.95 + Math.min(0.25, S.speed * 0.05); }

  function frame(ts) {
    var dt = S.last ? Math.min(0.1, (ts - S.last) / 1000) : 0;
    S.last = ts;
    if (S.yearActive && S.playing && !S.choiceOpen) {
      S.t += dt;
      while (S.queue.length && revealAt(S.queue[0]) <= S.t) revealEntry(S.queue.shift());
      setSeason(S.t / S.speed);
      var L = S.L;
      $('hud-days').textContent = '在世 ' + Math.floor((L.years.length - 1 + Math.min(1, S.t / S.speed)) * 365.25).toLocaleString('zh-CN') + ' 日';
      if (!S.queue.length && (S.t >= S.speed || S.dying)) endYear();
    }
    requestAnimationFrame(frame);
  }

  function setSeason(p) {
    var spans = $('season').children;
    for (var i = 0; i < 4; i++) {
      var f = Math.max(0, Math.min(1, p * 4 - i));
      spans[i].style.setProperty('--p', (f * 100) + '%');
      spans[i].classList.toggle('on', p * 4 >= i && p * 4 < i + 1);
    }
  }

  function endYear() {
    S.yearActive = false;
    var L = S.L, rec = S.rec;
    renderAttrs($('attrs'), rec.attr, L);
    renderStatus(L.alive ? L.by + L.age - 1 : L.dy);
    renderEco();
    renderHanji($('hanji-scroll'), $('hanji-tip'), rec.y, rec.y);
    if (rec.death || !L.alive) {
      S.dying = false;
      S.endTimer = setTimeout(finish, Math.max(1200, Math.min(2600, S.speed * 400)));
      return;
    }
    nextYear();
  }

  function skipToEnd() {
    if (!S.L) return;
    S.L.skip = true; // 只是快进：不改变这一生的规则
    S.yearActive = false; S.queue = []; S.choiceOpen = false;
    if (S.L.pending) E.autoAnswer(S.L);
    if ($('dlg-spend').open) $('dlg-spend').close();
    E.runToEnd(S.L);
    finish();
  }

  /* ---------- 戸籍、状態、親人 ---------- */
  function renderRegister(y) {
    var L = S.L, box = $('slips');
    box.innerHTML = '';
    if (L.eth) {
      box.classList.add('tribal');
      box.innerHTML = '<p class="tribal-note">あなたは' + D.ETH[L.eth].n + '人。あなたの一族は漢人の戸籍には載らず、官府は部落ごとに人数を数えるだけだ。</p>';
    } else {
      box.classList.remove('tribal');
      var list = E.household(L, y), head = list[0];
      list.forEach(function (p) {
        var s = h('div', 'slip' + (p.me ? ' me' : ''), esc(E.slipText(L, p, head.name)));
        box.appendChild(s);
      });
    }
    renderStatus(y);
    renderLaws(y);
    renderRegion(y);
    renderFamily(y);
    renderFriends(y);
    renderEco();
  }
  function eduText(L) {
    var E2 = L.edu;
    if (E2 && !E2.done) return E2.city + E2.n + 'で学んでいる';
    if (E2 && E2.passed) return E2.n + '出身' + (L.learn >= 60 ? '、経学に通じる' : '');
    if (E2) return 'かつて' + E2.city + E2.n + 'で学んだ';
    return L.literate ? (L.learn >= 60 ? '経学に通じる' : L.learn >= 35 ? '数年学問をした' : '読み書きができる') : '読み書きできない';
  }
  function renderStatus(y) {
    var L = S.L;
    var married = L.married ? '既婚' : L.widowed ? (L.sex === 'F' ? '寡婦' : '妻と死別') : '未婚';
    var LOC = { 亭長: 1, 里正: 1, 郷嗇夫: 1, 遊徼: 1 }, COURT = { 郎官: 1, 尚書郎: 1, 九卿: 1 };
    var job = L.band ? '軍中 · ' + D.BANDS[L.band].who + 'に従って転戦' : L.soldier ? '軍中 · ' + (L.job || '軍卒') :
      L.office ? (LOC[L.office] ? '郷里 · ' + L.office : L.office === '幕僚' ? '幕府 · ' + (L.officeMax || '掾属') : COURT[L.office] ? '朝廷 · ' + L.office : '州郡 · ' + L.office) :
      L.age < 14 ? '孩童' : L.cls === 'tenant' && (!L.job || L.job === '農' || L.job === '佃戸') ? '佃農' : (L.job || '農');
    var land = L.land > 0 ? L.land + ' 畝' : 'なし';
    var who = L.sex === 'F' && L.married && L.spouseK ? esc(L.spouseK.name) + (L.flags.isConc ? 'の妾' : 'の妻') + '（' + (L.flags.fcPal || clsName(L)) + '）' : L.sex === 'F' && L.widowed ? '寡婦（' + clsName(L) + '）' : clsName(L);
    $('status').innerHTML = '<dt>身分</dt><dd>' + who + '</dd><dt>生業</dt><dd>' + esc(job) + '</dd><dt>婚姻</dt><dd>' + married + '</dd><dt>田地</dt><dd>' + land + '</dd><dt>学業</dt><dd>' + eduText(L) + '</dd>' + (L.zi ? '<dt>字</dt><dd>' + esc(L.zi) + '</dd>' : '') +
      (L.clanName ? '<dt>門第</dt><dd>' + esc(L.clanName) + '</dd>' : '') + (L.dishu ? '<dt>嫡庶</dt><dd>' + L.dishu + '</dd>' : '') + (L.milMax ? '<dt>軍職</dt><dd>' + L.milMax + '</dd>' : '') +
      (L.eth ? '' : '<dt>暮らし向き</dt><dd>' + E.lifeTier(L, y).lv + '</dd>') + (E.condText(L) ? '<dt>体調</dt><dd>' + E.condText(L) + '</dd>' : '') + (L.hobby ? '<dt>趣味</dt><dd>' + E.hobbyText(L) + '</dd>' : '') + (L.age >= 6 ? '<dt>性情</dt><dd>' + E.traitWords(L).join('、') + '</dd>' : '') +
      (Object.keys(L.found).length ? '<dt>天分</dt><dd>' + Object.keys(L.found).map(function (k) { return E.TALENT[k].n; }).join('、') + '</dd>' : '');
  }
  function renderRegion(y) {
    var L = S.L, v = E.regionView(L, y), el = $('reg');
    if (!v || L.eth) { $('reg-name').textContent = ''; el.innerHTML = L.eth ? '<dt>この地</dt><dd>山野の中で、郡県の帳簿はない。</dd>' : ''; $('reg-note').textContent = ''; return; }
    $('reg-name').textContent = v.jun + ' · ' + v.ruler + 'の治下';
    var arrow = v.trend === 'up' ? ' <span class="up">↑</span>' : v.trend === 'down' ? ' <span class="down">↓</span>' : '';
    el.innerHTML =
      '<dt>戸口</dt><dd>約 <span class="num">' + (v.pop >= 10 ? Math.round(v.pop) : v.pop.toFixed(1)) + '</span> 万人</dd>' +
      '<dt>治安</dt><dd><span class="meter"><i style="width:' + v.order + '%"></i></span> ' + v.orderL + '</dd>' +
      '<dt>穀物の値</dt><dd>一石あたり約 <span class="num">' + E.fmt(v.price) + '</span> 銭' + arrow + '<br><span class="sub">平年は約 100 銭</span></dd>' +
      '<dt>流民</dt><dd>' + v.refL + (v.refN >= 100 && !(v.out >= 0.1) ? '<br><span class="sub">約 ' + E.fmt(v.refN) + ' 人</span>' : '') + '</dd>';
    $('reg-note').textContent = v.note || '';
  }
  function renderLaws(y) {
    var L = S.L, ul = $('laws'), ps = L.eth ? [] : E.polsAt(L.zone, y);
    $('laws-ruler').textContent = L.eth ? '' : E.fname(E.ctrl(L.zone, y), y) + 'の治下';
    ul.innerHTML = L.eth ? '<li class="empty">あなたの一族は漢の律令に縛られず、部落の首領にだけ従う。</li>' : ps.length ? '' : '<li class="empty">旧制のままで、特別な法令はない。</li>';
    ps.forEach(function (p) { ul.appendChild(h('li', '', '<b>' + esc(p.n) + '</b><span>' + esc(p.s) + '</span>')); });
    var at = !L.eth && E.atmosAt(L.zone, y); if (at) ul.insertBefore(h('li', 'atmos', '<b>気風・' + esc(at.n) + '</b><span>' + esc(at.s) + '</span>'), ul.firstChild);
  }
  function renderEco() {
    var L = S.L, v = E.ecoView(L), el = $('eco'), det = $('eco-detail');
    if (v.slave) { $('eco-head').textContent = ''; el.innerHTML = '<dt>家計</dt><dd>衣食は主家に頼る</dd><dt>私財</dt><dd class="num">' + E.fmt(v.priv) + ' 銭</dd>'; det.innerHTML = ''; return; }
    $('eco-head').textContent = v.head ? 'あなたが戸主' : L.age < 15 ? '家族が切り盛り' : '家長が管理';
    var assets = [];
    if (v.land) assets.push('田' + v.land + '畝');
    if (v.ox) assets.push('牛' + v.ox + '頭');
    if (v.stock) assets.push(L.cls === 'merchant' ? '商いの元手' : L.cls === 'tribal' ? '家畜' : '工房');
    assets.push(L.cls === 'gentry' ? '塢壁の屋敷' : '家屋');
    el.innerHTML = '<dt>家産</dt><dd>' + assets.join(' · ') + '<br><span class="sub">換算 ' + E.fmt(v.assets) + ' 銭</span></dd>' +
      (v.months != null ? '<dt>食糧の蓄え</dt><dd>' + (v.months >= 12 ? '自家の穀物で一年は足りる' : (v.months > 0 ? '自家の穀物で約 ' + v.months + ' か月もつ' : '自家では穀物を作らず、買って暮らす')) + (v.months < 12 ? '<br><span class="sub">余財であと ' + (v.buyMonths >= 24 ? '二年以上' : '約 ' + v.buyMonths + ' か月') + '分の食糧が買える</span>' : '') + '</dd>' : '') +
      '<dt>余財</dt><dd class="num">' + E.fmt(v.cash) + ' 銭</dd>' +
      '<dt>私財</dt><dd class="num">' + E.fmt(v.priv) + ' 銭</dd>' +
      '<dt>負債</dt><dd class="num' + (v.debt ? ' neg' : '') + '">' + (v.debt ? E.fmt(v.debt) + ' 銭' : 'なし') + '</dd>';
    det.innerHTML = '<p class="sub">余財は銭貨・布帛・穀物を銭に換算した合計：</p><table class="ledger"><tbody>' +
      v.comp.map(function (x) { return '<tr><td>' + x[0] + '</td><td>' + E.fmt(x[1]) + '</td></tr>'; }).join('') + '</tbody></table>' +
      (v.coinNote ? '<p class="sub">' + v.coinNote + '。</p>' : '');
    var sp = $('btn-spend');
    sp.disabled = !L.alive || L.age < 15 || L.cls === 'slave';
    sp.title = L.age < 15 ? '十五歳になるまでは、自分で計画を立てたり金を使ったりできない' : '毎年ひとつ自分から計画を立てられ、余財を使うこともできる';
  }

  /* ---------- 眼下所重 ---------- */
  function renderFocus(rec) {
    var L = S.L, F = rec.focus, sel = $('focus-select'), opts = E.focusOptions(L).slice();
    if (F && opts.indexOf(F.eff) < 0) opts.unshift(F.eff);
    var cur = L.focusManual || (F ? F.eff : opts[0]);
    sel.innerHTML = opts.map(function (k) { return '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + E.FOCUS[k].n + '</option>'; }).join('');
    sel.disabled = opts.length < 2;
    $('focus-auto').checked = !L.focusManual;
    var why;
    if (!F || F.eff === 'grow') why = 'あなたはまだ産着にくるまれた赤子で、何もかも家族が世話をしている。';
    else if (F.dev) why = 'あなたは' + E.FOCUS[F.man].v + 'つもりだったが、' + E.FOCUS[F.auto].pull + '。この一年は結局' + E.FOCUS[F.auto].v + 'ことになった。';
    else if (F.man) why = 'これはあなたが決めた方向だ。' + (F.auto !== F.man ? '本人に任せれば、むしろ' + E.FOCUS[F.auto].v + 'ほうを選ぶだろう。' : 'これは本人の望みにもかなっている。');
    else why = 'システムの判断：' + F.why + '。そのため近ごろは「' + E.FOCUS[F.eff].n + '」に多くの心力を注いでいる。';
    if (L.sex === 'F' && F && F.man) why = why.replace(/他/g, '她');
    $('focus-why').textContent = why;
  }
  function focusChanged(manual) {
    var L = S.L;
    if (!L) return;
    if (manual) { E.setFocus(L, $('focus-select').value); $('focus-auto').checked = false; }
    else { E.setFocus(L, $('focus-auto').checked ? null : $('focus-select').value); }
    $('focus-why').textContent = L.focusManual ? '来年から、心力を「' + E.FOCUS[L.focusManual].n + '」に注ぐことにする——ただし人は、あなたの言うことを全部聞くとは限らない。' : '来年からは、この人の性情と境遇に応じてシステムが判断する。';
  }

  /* ---------- 支用余財 ---------- */
  function openSpend() {
    var L = S.L;
    if (!L || L.age < 15) return;
    S.wasPlaying = S.playing; S.playing = false; setPlayIcon();
    renderSpend();
    $('dlg-spend').showModal();
  }
  function renderSpend() {
    var L = S.L, o = E.spendOptions(L), r = o.room;
    $('spend-room').innerHTML = '使える余財 <b class="num">' + E.fmt(o.can) + '</b> 銭<br><span class="sub">私財 ' + E.fmt(r.priv) + (r.head ? ' · 家の余財 ' + E.fmt(r.house) + '（あなたが戸主）' : ' · 家にはまだ余財 ' + E.fmt(r.family) + ' があるが、あなたには使えない') + '</span>';
    var groups = {};
    o.items.forEach(function (it) { (groups[it.g] = groups[it.g] || []).push(it); });
    var box = $('spend-list');
    box.innerHTML = '';
    Object.keys(groups).forEach(function (g) {
      var sec = h('div', 'spend-group');
      sec.appendChild(h('h3', 'sect-title', g));
      groups[g].forEach(function (it) {
        var row = h('div', 'spend-row ' + it.st);
        row.innerHTML = '<span class="n">' + esc(it.n) + (it.sub || it.why ? '<small>' + esc(it.why ? it.why + (it.sub ? ' · ' + it.sub : '') : it.sub) + '</small>' : '') + '</span><span class="c num">' + E.fmt(it.c) + '</span>';
        var b = h('button', 'btn', it.plan && it.st === 'ok' ? '実行' : it.st === 'ok' ? '支出' : it.st === 'ask' ? '家長に頼む' : it.st === 'no' ? '行けない' : '買えない');
        b.type = 'button'; b.disabled = it.st === 'poor' || it.st === 'no';
        b.onclick = function () {
          var res = E.spend(L, it.id);
          var e = { k: 'spend', t: res.t };
          if (S.ol) { S.ol.appendChild(entryEl(e)); follow(); }
          toast(res.ok ? '支出 ' + E.fmt(res.c) + ' 銭' : 'うまくいかなかった');
          renderSpend(); renderEco(); renderAttrs($('attrs'), { body: L.body, wealth: L.wealth, learn: L.learn, standing: L.standing, fame: L.fame }, L);
        };
        row.appendChild(b);
        sec.appendChild(row);
      });
      box.appendChild(sec);
    });
    if (o.can < 300) box.prepend(h('p', 'spend-poor', '……何ひとつ買えそうにない。'));
  }
  function renderFamily(y) {
    var L = S.L, ul = $('family');
    ul.innerHTML = '';
    var order = { gp: 0, father: 1, mother: 2, spouse: 3, conc: 3.5, sib: 4, child: 5 };
    var ks = L.kin.filter(function (k) { return k.by <= y; }).slice().sort(function (a, b) { return order[a.rel] - order[b.rel] || a.by - b.by; });
    if (!ks.length) { ul.innerHTML = '<li class="empty">なし</li>'; return; }
    ks.forEach(function (k) {
      var dead = !k.alive && k.dy < y + 1 && k.dy <= y;
      var st;
      if (dead) st = '没 · ' + (k.dy - k.by) + '歳';
      else if (k.apart) st = k.given ? '他家にやられた' : k.sold ? '他人に売られた' : k.bonded ? '他家の奴婢' : '消息不明';
      else if (k.out) st = k.rel === 'child' ? '嫁いだ' : '実家に戻った';
      else if (k.soldier) st = '従軍 · ' + (y - k.by) + '歳';
      else st = (y - k.by) + '歳';
      if (!dead && !k.apart) st += (k.job && !k.soldier ? ' · ' + k.job : '') + (k.aff != null && y - k.by >= 8 && L.age >= 8 ? ' · ' + E.relLabel(k.aff) : '');
      var li = h('li', dead ? 'dead' : '');
      li.innerHTML = '<span class="r">' + E.relName(L, k) + '</span><span class="n">' + esc(k.name) + (k.zi ? '<small class="alias">字' + esc(k.zi) + '</small>' : '') + (k.shu ? '<small class="alias">庶出</small>' : '') + '</span><span class="s">' + st + '</span>';
      ul.appendChild(li);
    });
  }

  var FRC = { childHi: '遊び仲間', girlHi: '姉妹分', scholar: '同志', child: '遊び仲間', school: '同窓', army: '同じ隊', office: '同僚', trade: '仲間', girl: '姉妹分', village: '近所', band: '戦友', old: '旧友' };
  function renderFriends(y) {
    var L = S.L, ul = $('friends');
    var fs = (L.friends || []).filter(function (f) { return f.since <= y; });
    if (!fs.length) { ul.innerHTML = '<li class="empty">まだいない</li>'; return; }
    ul.innerHTML = fs.map(function (f) {
      var dead = !f.alive;
      var st = dead ? '没 · ' + f.fate : f.apart ? '消息不明' : (y - f.by) + '歳' + (f.job ? ' · ' + f.job : '') + ' · ' + E.relLabel(f.aff);
      return '<li class="' + (dead ? 'dead' : '') + '"><span class="r">' + (f.lover ? '想い人' : FRC[f.ctx] || '友人') + '</span><span class="n">' + esc(f.name) + '</span><span class="s">' + esc(st) + '</span></li>';
    }).join('');
  }

  /* ---------- 同時辰 ---------- */
  function compStatus(c, y) {
    var idx = y - c.by, rec = c.years[Math.min(idx, c.years.length - 1)];
    var dead = !c.alive && y >= c.dy;
    var zone = rec ? rec.zoneEnd : c.zone;
    if (dead) return { dead: true, txt: '没、享年 ' + (c.dy - c.by) + ' · ' + E.CAUSE_SHORT[c.cause], zone: zone };
    var job = idx < 14 ? '' : ' · ' + (c.job || '農');
    return { dead: false, txt: (idx === 0 ? '誕生' : idx + ' 歳') + ' · ' + D.ZONES[zone].zhou + job, zone: zone };
  }
  function renderComps(el, y, final) {
    el.innerHTML = '';
    S.comps.forEach(function (c, i) {
      var st = final ? { dead: true, txt: '生涯 ' + (c.dy - c.by) + ' 年 · ' + E.CAUSE_SHORT[c.cause] } : compStatus(c, y);
      var d = h('div', 'comp' + (st.dead ? ' dead' : ''));
      var who = (c.sex === 'M' ? '男' : '女') + ' · 出身：' + D.ZONES[c.birthZone].zhou + D.JUN[c.birthJun][0] + ' · ' + clsName(c);
      var html = '<span class="no">' + (i + 1) + '</span><div><b>' + esc(c.name) + '</b><div class="who">' + who + '</div><div class="st">' + esc(st.txt) + '</div>';
      if (final) {
        var last = c.years[c.years.length - 1];
        var dt = last && last.entries.filter(function (e) { return e.k === 'death'; })[0];
        if (dt) html += '<div class="who">' + esc(dt.t) + '</div>';
        html += '<div class="go"><button class="btn" type="button">この人の一生を生きる</button></div>';
      }
      d.innerHTML = html + '</div>';
      if (final) d.querySelector('button').onclick = function () { startLife(c.cseed, { mode: 'history', year: c.by }); };
      el.appendChild(d);
    });
  }

  /* ---------- 輿図 ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function buildMap() {
    var wrap = $('map-wrap');
    wrap.innerHTML = '';
    var svg = svgEl('svg', { viewBox: '0 -10 720 640', class: 'map', role: 'img', 'aria-label': '各州郡の人口と帰属' });
    // 河、江（示意）
    svg.appendChild(svgEl('path', { class: 'river', d: 'M60 205 C 120 150, 170 60, 245 55 S 300 120, 300 190 S 380 205, 430 200 S 560 175, 640 128' }));
    svg.appendChild(svgEl('path', { class: 'river', d: 'M40 470 C 110 440, 160 470, 220 452 S 300 395, 360 405 S 450 440, 500 425 S 600 420, 690 410' }));
    var t1 = svgEl('text', { x: 255, y: 44, class: 'lbl2', 'font-size': 12, fill: 'currentColor' }); t1.textContent = '河';
    var t2 = svgEl('text', { x: 690, y: 400, class: 'lbl2', 'font-size': 12, fill: 'currentColor' }); t2.textContent = '江';
    [t1, t2].forEach(function (t) { t.setAttribute('style', 'fill:var(--ink-3);font-family:var(--font-ui)'); svg.appendChild(t); });
    var zl = svgEl('g', {});
    Object.keys(D.ZONES).forEach(function (z) {
      var Z = D.ZONES[z];
      var g = svgEl('g', { class: 'z', id: 'z-' + z });
      g.appendChild(svgEl('circle', { cx: Z.x, cy: Z.y, r: 20 }));
      var a = svgEl('text', { x: Z.x, y: Z.y, class: 'zl' }); a.textContent = Z.label;
      var b = svgEl('text', { x: Z.x, y: Z.y, class: 'zc' });
      g.appendChild(a); g.appendChild(b);
      var tt = svgEl('title', {}); g.appendChild(tt);
      zl.appendChild(g);
    });
    svg.appendChild(zl);
    var mk = svgEl('g', { id: 'map-marks' });
    svg.appendChild(mk);
    wrap.appendChild(svg);
  }
  function updateMap(y) {
    var groups = {}, radius = {};
    var L = S.L;
    Object.keys(D.ZONES).forEach(function (z) {
      var Z = D.ZONES[z], g = $('z-' + z);
      if (!g) return;
      var pop = E.zonePop(z, y) * E.POP_SCALE;
      var r = 5 + 1.7 * Math.sqrt(pop);
      radius[z] = r;
      var fk = E.ctrl(z, y), grp = S.blind ? 'other' : E.group(fk);
      groups[grp] = 1;
      g.setAttribute('class', 'z g-' + grp + (z === L.zone ? ' here' : ''));
      var c = g.querySelector('circle'); c.setAttribute('r', r.toFixed(1));
      var a = g.querySelector('.zl'), b = g.querySelector('.zc');
      if (r >= 31) { a.setAttribute('y', Z.y + 2); b.setAttribute('y', Z.y + 21); }
      else { a.setAttribute('y', Z.y + r + 20); b.setAttribute('y', Z.y + r + 37); }
      b.textContent = S.blind ? '' : E.fname(fk, y);
      g.querySelector('title').textContent = Z.zhou + '·' + Z.label + '：約 ' + Math.round(pop) + ' 万人' + (S.blind ? '' : '、所属：' + E.fname(fk, y));
    });
    // 標記
    var mk = $('map-marks');
    mk.innerHTML = '';
    var spots = {};
    function spot(z) { spots[z] = (spots[z] || 0) + 1; var n = spots[z] - 1, Z = D.ZONES[z], rr = Math.max(14, radius[z]); var ang = -Math.PI / 4 + n * 0.9; return { x: Z.x + Math.cos(ang) * rr, y: Z.y + Math.sin(ang) * rr }; }
    var p = spot(L.zone);
    mk.appendChild(svgEl('circle', { class: 'me-ring', cx: p.x, cy: p.y, r: 9 }));
    mk.appendChild(svgEl('rect', { class: 'me-mark', x: p.x - 8, y: p.y - 8, width: 16, height: 16, rx: 2 }));
    S.comps.forEach(function (c, i) {
      var st = compStatus(c, y);
      if (st.dead || y < c.by) return;
      var q = spot(st.zone);
      var g = svgEl('g', { class: 'co-mark' });
      g.appendChild(svgEl('circle', { cx: q.x, cy: q.y, r: 10 }));
      var t = svgEl('text', { x: q.x, y: q.y + 0.5 }); t.textContent = i + 1;
      g.appendChild(t);
      mk.appendChild(g);
    });
    $('map-year').textContent = S.blind ? '' : y + ' 年';
    var lg = $('map-legend');
    var order = ['han', 'wei', 'shu', 'wu', 'jin', 'other'];
    lg.innerHTML = (S.blind ? '' : order.filter(function (g) { return groups[g]; }).map(function (g) { return '<span class="g-' + g + '"><i></i>' + GNAME(g, y) + '</span>'; }).join('')) +
      '<span><i class="me"></i>あなた</span><span><i class="co"></i>同じ時刻に生まれた者</span>';
    $('pop-note').textContent = '円の大きさは推定人口を表す' + (S.blind ? '' : '。このとき天下は約 ' + Math.round(E.totalPop(y)).toLocaleString('zh-CN') + ' 万人') + '（戸籍外の人々の推計を含む）。';
  }

  /* ---------- 漢紀 · 一格一年 ---------- */
  function cellClass(L, y) {
    if (y < L.by) return '';
    var rec = L.years[y - L.by];
    if (!rec) return '';
    if (rec.death) return 'd';
    var t = rec.tags;
    if (t.indexOf('meet') >= 0) return 'm';
    if (t.indexOf('kid') >= 0) return 'k';
    if (t.indexOf('move') >= 0) return 'mv';
    if (t.indexOf('hard') >= 0 || t.indexOf('war') >= 0 || t.indexOf('loss') >= 0 || t.indexOf('band') >= 0) return 'h';
    return 'n';
  }
  function cellNote(L, y) {
    var rec = L.years[y - L.by];
    if (!rec) return '';
    var pri = ['death', 'meet', 'move', 'war', 'good', 'bad', 'fam', 'hist', 'life'];
    var best = null;
    pri.some(function (k) { best = rec.entries.filter(function (e) { return e.k === k; })[0]; return !!best; });
    return best ? best.t : '';
  }
  function renderHanji(box, tip, upTo, cur, all) {
    var L = S.L, y0 = L.by;
    var y1 = all ? Math.max.apply(null, [L.dy].concat(S.comps.map(function (c) { return c.dy; }))) : Math.max(upTo, y0);
    var span = Math.max(y1, y0 + 30);
    var rows = [{ lab: 'あなた', L: L, lim: all ? L.dy : upTo }].concat(S.comps.map(function (c, i) { return { lab: (i + 1) + ' ' + c.name, L: c, lim: all ? c.dy : upTo }; }));
    var g = h('div', 'hj');
    var CW = 13;
    g.appendChild(h('span', 'lab', ''));
    var marks = h('div', 'marks');
    marks.style.width = ((span - y0 + 1) * CW) + 'px';
    var prev = -99, hi = false;
    D.MARKS.forEach(function (m) {
      if (m[0] < y0 || m[0] > span) return;
      hi = m[0] - prev < 7 ? !hi : false; prev = m[0];
      var s = h('span', (hi ? 'hi' : 'lo') + (m[0] <= (all ? y1 : cur) ? ' past' : ''), (S.blind && !all ? '' : m[0] + ' ') + m[1]);
      s.style.left = ((m[0] - y0) * CW + 5) + 'px';
      if (S.blind && !all) s.textContent = m[1];
      marks.appendChild(s);
    });
    g.appendChild(marks);
    rows.forEach(function (r) {
      g.appendChild(h('span', 'lab', esc(r.lab)));
      var cells = h('div', 'cells');
      for (var y = y0; y <= span; y++) {
        var i = document.createElement('i');
        if (y <= r.lim) {
          i.className = cellClass(r.L, y);
          if (i.className) {
            i.dataset.y = y; i.dataset.r = r.lab;
            i.title = (S.blind && !all ? E.ganzhi(y) : y) + ' · ' + (y - r.L.by) + '歳';
          }
        }
        if (!all && y === cur && r.L === L) i.classList.add('cur');
        cells.appendChild(i);
      }
      g.appendChild(cells);
      cells.addEventListener('mouseover', function (ev) {
        var t = ev.target;
        if (!t.dataset || !t.dataset.y) return;
        var yy = +t.dataset.y, who = rows.filter(function (x) { return x.lab === t.dataset.r; })[0];
        tip.textContent = (S.blind && !all ? E.ganzhi(yy) : yy + '年') + ' · ' + who.lab + ' ' + (yy - who.L.by) + '歳 · ' + cellNote(who.L, yy);
      });
    });
    var keep = box.scrollLeft;
    box.innerHTML = '';
    box.appendChild(g);
    box.scrollLeft = all ? 0 : Math.max(keep, (cur - y0) * CW - box.clientWidth + 120);
    var lg = box.parentNode.querySelector('.legend');
    if (lg && !lg.innerHTML) lg.innerHTML = '<span><i class="c-normal"></i>平穏な年</span><span><i class="c-hard"></i>戦乱・飢饉・疫病</span><span><i class="c-move"></i>移住</span><span><i class="c-kid"></i>子の誕生</span><span><i class="c-meet"></i>奇遇</span><span><i class="c-death"></i>没年</span>';
  }

  /* ---------- 終章 ---------- */
  function finish() {
    clearTimeout(S.endTimer);
    S.yearActive = false;
    var L = S.L;
    if (L.alive) E.runToEnd(L);
    persist(L);
    renderEnd();
    show('end');
  }

  function epitaph(L) {
    var age = L.dy - L.by, lines = [];
    var adultKids = L.kin.filter(function (k) { return k.rel === 'child' && ((k.alive ? L.dy : k.dy) - k.by) >= 15; }).length;
    lines.push(age === 0 ? 'あなたは一歳まで生きられなかった。' : 'あなたは' + cn(age) + '年生きた。');
    lines.push(E.reignText(L.birthZone, L.by) + '生まれ。');
    if (L.cause === 'fade') lines.push(E.reignText(L.zone, L.dy) + '以降、行方知れず。');
    else if (age > 0) lines.push(E.reignText(L.zone, L.dy) + '没。');
    if (L.clanName || L.dishu) lines.splice(1, 0, (L.clanName ? L.clanName + 'の出身' + (L.dishu ? '、' + L.dishu : '') : (L.dishu === '庶出' ? '庶出' : '')) + '。');
    if (lines[1] === '。') lines.splice(1, 1);
    var F = L.flags || {};
    if (F.palaceIn) lines.push(F.palaceIn + '年、' + (F.palaceIn < 190 ? '采女' : '宮人') + 'として入宮' + ((F.palace || 0) >= 1 ? 'し、' + F.palaceTop + 'の位に至った' : 'した') + '。' + (F.palaceOut ? F.palaceOut + '年に宮を出された。' : ''));
    if (F.isConc) lines.push((L.kin.filter(function (k) { return k.rel === 'spouse'; })[0] || { name: '貴人' }).name + 'の妾となった。');
    if (L.edu) lines.push(L.edu.passed ? L.edu.city + L.edu.n + '出身。' : 'かつて' + L.edu.city + L.edu.n + 'で学んだ。');
    if (L.sex === 'M' && age >= 20) lines.push(L.officeMax && L.milMax ? 'かつて' + L.officeMax + 'を務め、のちに従軍して' + L.milMax + 'に至った。' : L.officeMax ? 'かつて' + L.officeMax + 'を務めた。' : L.milMax ? '官は' + L.milMax + 'に至った。' : '生涯、仕官しなかった。');
    if (F.loyal) lines.push(F.loyal + 'が滅びたのち、新しい朝廷には仕えなかった。');
    if (L.sex === 'F' && age >= 15 && !L.married && !L.widowed && !L.divorced && L.kidsBorn === 0 && !F.palaceIn && !F.concubineOf && !F.isConc) lines.push('生涯、嫁がなかった。');
    if (L.divorced) lines.push('夫の家から離縁されたことがある。');
    if (L.flags.abducted) lines.push('乱兵にさらわれ、異郷をさまよったことがある。');
    var ORPH_EPI = { uncle: '幼くして両親を失い、叔父に育てられた。', clan: '幼くして両親を失い、一族の伯父に育てられた。', mat: '幼くして両親を失い、母方の祖父の家で育った。', neigh: '幼くして両親を失い、村の老人に引き取られた。', jiazi: '幼くして両親を失い、ある将軍の仮子となった。', yangnv: '幼くして両親を失い、人の養女となった。', sold: '幼くして両親を失い、一族の者に奴婢として売られた。', beg: '幼くして両親を失い、城門のそばで物乞いをした。', sib: '幼くして両親を失い、兄や姉が家を支えた。' }, OLD_EPI = ['祖父はかつて県令を務めた。', '家はもと郡の名族で、党錮で没落した。', '先祖はかつて豪商だった。'];
    if (F.orphanK && ORPH_EPI[F.orphanK]) lines.push(ORPH_EPI[F.orphanK]);
    if (F.oldFam != null) lines.push(OLD_EPI[F.oldFam]);
    if (F.declineY) lines.push(F.declineY + '年、家運が傾いた。');
    if (F.wasLM) lines.push('流民となったことがある。');
    if (F.wasShan) lines.push(F.shanF && L.sex === 'F' ? '山賊にさらわれ、山へ連れていかれたことがある。' : F.wasShan + 'の仲間として山に上ったことがある。');
    if (F.moru) lines.push(F.moru + '年、官に没収された。');
    else if (F.maidWas) lines.push(F.maidWas === 'bi' ? '身を売って婢となったことがある。' : '大家に侍女として仕えた。');
    if (F.concubineOf && !F.isConc) lines.push('主人の妾となった。');
    if (L.job === '太妃') lines.push('のちに子に従って封国へ移り、王太妃となった。');
    if (L.soldierYears > 0) lines.push('従軍' + cn(L.soldierYears) + '年。');
    var jh = L.junHist && L.junHist.length ? L.junHist : [L.birthJun];
    if (L.moves > 0) lines.push(jh.length <= 1 ? '移住' + cn(L.moves) + '度、いずれも' + D.JUN[L.birthJun][0] + 'の内だった。' : '移住' + cn(L.moves) + '度、' + jh.slice(0, 4).map(function (i) { return D.JUN[i][0]; }).join('・') + (jh.length > 4 ? 'など' : '') + 'に住んだ。');
    if ((L.visited || []).length >= 1) lines.push('各地を巡った：' + L.visited.slice(0, 4).join('、') + (L.visited.length > 4 ? 'など' : '') + '。');
    else if (L.moves === 0 && age >= 10) lines.push('生涯、' + D.JUN[L.birthJun][0] + 'を離れることはなかった。');
    if (L.kidsBorn > 0) lines.push('子を' + cn(L.kidsBorn) + '人もうけ、' + (adultKids === 0 ? '成人した者はいなかった' : cn(adultKids) + '人が成人した') + '。');
    if (L.grandkids > 0) lines.push('孫は' + cn(L.grandkids) + '人。');
    var lit = L.kin.filter(function (k) { return k.rel === 'child' && k.lit; }).length;
    if (lit) lines.push(cn(lit) + '人の子が読み書きできた。');
    if (age >= 15 && L.cls !== 'slave') {
      if (L.eco.debt > 0) lines.push('死後にも' + E.fmt(L.eco.debt) + '銭の借金が残った。');
      else if (L.land > 0 && !(F.palaceIn && !F.palaceOut) && !F.famousConc) lines.push('死後、田' + cn(L.land) + '畝を遺した。');
      else if (L.eco.cash + L.eco.priv < 300) lines.push('死後にはほとんど何も残らなかった。');
    }
    if (L.flags.coffin) lines.push('あなたは早くから自分の棺を用意していた。');
    if (age >= 10) lines.push('あなたは' + E.traitWords(L).join('、') + 'の人だった。');
    if (L.lineage && L.lineage.length) { var pa = L.lineage[L.lineage.length - 1]; lines.splice(1, 0, 'あなたは' + pa.name + 'の' + (L.sex === 'M' ? '息子' : '娘') + 'だった。'); }
    var last = '';
    if (L.cause === 'fade') last = '史書の筆はこの年で止まった。その後のあなたの日々は、あなた自身しか知らない。';
    else if (L.by < 300 && L.dy >= 349) last = 'あなたは晋室の天下から後趙の崩壊まで生き抜いた。';
    else if (L.by < 266 && L.dy >= 317) last = 'あなたは三国の残り火の時代から、衣冠南渡（晋室の南遷）まで生き抜いた。';
    else if (L.by < 300 && L.dy >= 311 && L.dy < 317) last = 'あなたは永嘉の乱を経験した。';
    else if (L.by < 184 && L.dy >= 280) last = 'あなたは黄巾の乱から、三国が晋に帰するまで生き抜いた。';
    else if (L.by < 220 && L.dy >= 265) last = 'あなたは二つの王朝の終わりを見届けた。';
    else if (L.by < 220 && L.dy >= 220) last = 'あなたは一つの王朝の終わりを経験した。';
    else if (L.by < 184 && L.dy >= 184) last = 'あなたは太平の時代の終わりを見届けた。';
    return { lines: lines, last: last };
  }

  function achievements(L) {
    var a = L.achievements.slice();
    L.meetLog.forEach(function (m) { if (a.indexOf(m.ach) < 0) a.push(m.ach); });
    if (!L.alive) E.endAch(L).forEach(function (x) { if (a.indexOf(x) < 0) a.push(x); });
    return a;
  }

  function persist(L) {
    if (S.saved) return;
    S.saved = true;
    Object.keys(L.met).forEach(function (id) { if (!store.met[id]) store.met[id] = { y: L.met[id], name: L.name, t: Date.now() }; });
    store.lives.unshift({ code: codeOf(S.seed, S.mode), name: L.name, sex: L.sex, by: L.by, dy: L.dy, cause: L.cause, place: D.ZONES[L.birthZone].zhou + D.JUN[L.birthJun][0], cls: clsName(L), mode: S.mode, ach: achievements(L).length, t: Date.now() });
    if (store.lives.length > 300) store.lives.length = 300;
    save();
  }

  function renderEnd() {
    var L = S.L, ep = epitaph(L);
    var nm = L.eth ? L.name : L.sex === 'F' ? L.sur + '氏' : L.name;
    var sub = L.sex === 'F' && !L.eth ? '（' + L.xiao + '）' : L.zi ? '（字' + L.zi + '）' : '';
    $('stele').innerHTML = '<div class="stele-name">' + esc(nm) + '<small>' + esc(sub) + '</small></div>' +
      '<div class="stele-text"><p class="first">' + ep.lines[0] + '</p>' + ep.lines.slice(1).map(function (l) { return '<p>' + l + '</p>'; }).join('') +
      '<p class="cause">' + esc(L.causeText || '') + '</p>' + (ep.last ? '<p class="last">' + ep.last + '</p>' : '') + '</div>';
    var achs = achievements(L);
    $('achs').innerHTML = achs.map(function (t) { return '<p class="ach">【' + esc(t) + '】</p>'; }).join('');
    renderComps($('end-comps'), L.dy, true);
    var aw = E.afterword(L), al = E.afterlife(L);
    $('afterword').innerHTML = '<h2 class="sect-title">あとがき</h2>' + aw.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') +
      (al.length ? '<h2 class="sect-title">死後</h2>' + al.map(function (x) { return '<p class="after">' + esc(x) + '</p>'; }).join('') : '');
    $('end-tiles').innerHTML = E.lifeSummary(L).map(function (t) { return '<div class="tile"><span class="tl">' + esc(t.l) + '</span><b class="tv">' + esc(t.v) + '</b>' + (t.s ? '<span class="ts">' + esc(t.s) + '</span>' : '') + '</div>'; }).join('');
    var ec = L.echoes || [];
    $('end-echo-wrap').hidden = !ec.length;
    $('end-echo').innerHTML = ec.map(function (e) { return '<li><p class="was">' + e.y0 + ' 年、あなたは' + cn(e.a0) + '歳：「' + esc(e.o) + '」</p><p class="now">' + e.y1 + ' 年、あなたは' + cn(e.a1) + '歳：' + esc(e.t) + '</p></li>'; }).join('');
    renderEndFamily(L);
    S.heir = E.heirOf(L);
    var hb = $('btn-heir');
    hb.hidden = !S.heir;
    if (S.heir) hb.textContent = (S.heir.sex === 'M' ? '息子の' : '娘の') + S.heir.xiao + 'として続ける';
    $('seed-code').innerHTML = '命数 <code>' + codeOf(S.seed, S.mode) + '</code>';
    renderHanji($('end-hanji'), $('end-hanji-tip'), L.dy, L.dy, true);
    renderFullChron(L);
    var st = S.statsCache[S.sk];
    if (st && st.done) renderStats(); else { $('verdict').textContent = '同時代のほかの人生を推計しています……'; S.onStats = renderStats; }
  }

  var KIN_CAUSE = { plag: '疫病で死去', fam: '飢饉で死去', war: '戦乱で死去', flood: '水害で死去', corv: '労役で死去', battle: '戦死', massacre: '落城の際に殺害', executed: '連座して処刑', childbirth: '難産で死去', road: '逃避行の途中で死去' };
  function kinFate(L, k) {
    if (k.alive) {
      if (k.apart) return 'それきり消息不明';
      var a = L.dy - k.by;
      return 'あなたの死去時、' + (a <= 0 ? 'まだ赤子' : a + '歳') + (k.out && k.rel === 'child' && k.sex === 'F' ? '、すでに嫁いでいた' : '') + (k.soldier ? '、軍中にあった' : '');
    }
    var age = k.dy - k.by;
    var c = KIN_CAUSE[k.cause] || (age <= 1 ? '夭折' : age < 15 ? '夭折' : age >= 55 ? '天寿を全う' : '病死');
    return k.dy + '年' + c + '、享年' + age;
  }
  function kinExtra(k) { return [k.job, k.aff != null && k.rel !== 'gp' && (k.alive || k.dy - k.by >= 8) ? 'あなたとは' + E.relLabel(k.aff) : ''].filter(Boolean).join(' · '); }
  function renderEndFamily(L) {
    var groups = [['父母', ['father', 'mother']], ['祖父母', ['gp']], ['配偶者', ['spouse', 'conc']], ['兄弟姉妹', ['sib']], ['子ども', ['child']]];
    var box = $('end-family'), html = '', born = 0, lived = 0;
    groups.forEach(function (g) {
      var ks = L.kin.filter(function (k) { return g[1].indexOf(k.rel) >= 0 && k.by <= L.dy; }).sort(function (a, b) { return a.by - b.by; });
      if (!ks.length) return;
      html += '<div class="fam-group"><h3>' + g[0] + '</h3><ul>' + ks.map(function (k) {
        if (k.rel === 'child') { born++; if ((k.alive ? L.dy : k.dy) - k.by >= 15) lived++; }
        var dead = !k.alive && k.dy <= L.dy;
        var marks = (k.adopted ? '<span class="mk">養子</span>' : '') + (k.lit ? '<span class="mk">読み書き</span>' : '');
        var alias = [k.xiao && k.xiao !== k.name ? '幼名' + k.xiao : '', k.zi ? '字' + k.zi : '', k.shu ? '庶出' + (k.momName ? '、生母' + k.momName : '') : ''].filter(Boolean).join('、');
        return '<li class="' + (dead ? 'dead' : '') + '"><span class="r">' + E.relName(L, k) + '</span><span class="n">' + esc(k.name) + (alias ? '<small class="alias">（' + esc(alias) + '）</small>' : '') + marks + '</span><span class="s">' + (k.by ? k.by + '年生まれ · ' : '') + esc(kinFate(L, k)) + (kinExtra(k) ? '<br>' + esc(kinExtra(k)) : '') + '</span></li>';
      }).join('') + '</ul></div>';
    });
    box.innerHTML = html || '<p class="empty">なし</p>';
    $('family-sum').textContent = born ? '子ども' + born + '人、うち' + lived + '人が十五歳を越えた' : '';
    var fs = L.friends || [];
    $('friends-sum').textContent = fs.length ? '生涯の友 ' + fs.length + '人' : '';
    $('end-friends').innerHTML = fs.length ? '<div class="fam-group"><ul>' + fs.map(function (f) {
      var fate = !f.alive ? f.dy + '年' + f.fate : f.apart ? f.fate || '消息不明' : 'あなたの死去時も存命' + (f.job ? '、' + f.job : '');
      return '<li class="' + (!f.alive ? 'dead' : '') + '"><span class="r">' + (f.lover ? '想い人' : FRC[f.ctx] || '友人') + '</span><span class="n">' + esc(f.name) + '</span><span class="s">' + f.since + '年に知り合う · ' + esc(fate) + '<br>' + (f.alive && !f.apart ? '間柄' : '最後の間柄') + '：' + E.relLabel(f.aff) + '</span></li>';
    }).join('') + '</ul></div>' : '<p class="empty">この一生で、友と呼べる人はひとりもいなかった。</p>';
    var lin = (L.lineage || []).concat([{ name: L.name, by: L.by, dy: L.dy, me: true }]);
    $('lineage').innerHTML = lin.length > 1 ? '<p class="lineage-line">' + lin.map(function (x) { return '<span' + (x.me ? ' class="me"' : '') + '>' + esc(x.name) + '<small>' + x.by + '–' + x.dy + '</small></span>'; }).join('<i>→</i>') + '</p>' : '';
  }
  function renderFullChron(L) {
    var box = $('end-chron');
    box.innerHTML = '';
    var choices = (L.choiceLog || []).slice();
    L.years.forEach(function (rec) {
      var sec = h('section', 'yr');
      var el = eraLine(L, rec.y, rec.zone);
      var big = S.blind ? E.ganzhi(rec.y) : el.big;
      sec.innerHTML = '<div class="yr-head"><b>' + esc(big) + '</b><span>' + rec.y + ' · ' + (rec.age === 0 ? '誕生' : rec.age + ' 歳') + '</span></div>';
      var ol = h('ol');
      choices.filter(function (c) { return c.y === rec.y; }).forEach(function (c) { ol.appendChild(h('li', 'e e-choice', esc(c.q) + (c.narr ? '<b>' : ' —— あなたの選択：<b>') + esc(c.a) + '</b>')); });
      rec.entries.forEach(function (e) { ol.appendChild(entryEl(e)); });
      if (rec.ledger && (rec.age >= 14 || rec.ledger.net < 0)) ol.appendChild(ledgerEl(rec.ledger, rec.age));
      (L.spendLog || []).filter(function (x) { return x.y === rec.y; }).forEach(function (x) { ol.appendChild(entryEl({ k: 'spend', t: x.t })); });
      sec.appendChild(ol);
      box.appendChild(sec);
    });
  }

  // 現代中国（約 2020 年）的近似生存比例，僅作参照
  var MODERN = [[0, 100], [1, 99.4], [5, 99.3], [20, 99], [40, 98], [50, 96.5], [60, 92.5], [65, 89], [70, 83], [75, 74], [80, 61], [85, 43], [90, 24]];
  function modAt(a) {
    for (var i = 1; i < MODERN.length; i++) if (a <= MODERN[i][0]) { var p = MODERN[i - 1], q = MODERN[i]; return p[1] + (q[1] - p[1]) * (a - p[0]) / (q[0] - p[0]); }
    return MODERN[MODERN.length - 1][1];
  }

  function renderStats() {
    S.onStats = null;
    var L = S.L, st = S.statsCache[S.sk], ages = st.ages, N = ages.length;
    var my = L.dy - L.by;
    var under5 = ages.filter(function (a) { return a < 5; }).length / N;
    var mean = ages.reduce(function (s, a) { return s + a; }, 0) / N;
    var shorter = ages.filter(function (a) { return a < my; }).length / N;
    var pct = function (x) { return '<b>' + Math.round(x * 100) + '%</b>'; };
    $('verdict').innerHTML = 'シミュレートした同時代の <b>' + N.toLocaleString('zh-CN') + '</b> 人のうち、' + pct(under5) + ' は五歳まで生きられず、平均寿命は <b>' + mean.toFixed(1) + '</b> 歳。<br>あなたは <b>' + my + '</b> 歳まで生き、' + pct(shorter) + ' の人より長生きした。';
    survChart($('surv'), ages, my);
    // 死因
    var cnt = {}, mine = E.CAUSE_STAT[L.cause];
    st.causes.forEach(function (c) { var k = E.CAUSE_STAT[c] || 'その他'; cnt[k] = (cnt[k] || 0) + 1; });
    var rows = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
    var max = cnt[rows[0]];
    $('causes').innerHTML = rows.map(function (k) {
      return '<div class="row' + (k === mine ? ' me' : '') + '"><span>' + k + (k === mine ? ' ·あなた' : '') + '</span><span class="b"><i style="width:' + (cnt[k] / max * 100).toFixed(1) + '%"></i></span><span>' + (cnt[k] / N < 0.001 ? '<0.1' : (cnt[k] / N * 100).toFixed(1)) + '%</span></div>';
    }).join('');
  }

  function survChart(box, ages, my) {
    var N = ages.length, W = 640, H = 270, m = { l: 40, r: 92, t: 14, b: 30 };
    var X = function (a) { return m.l + a / 90 * (W - m.l - m.r); };
    var Y = function (p) { return m.t + (1 - p / 100) * (H - m.t - m.b); };
    var sorted = ages.slice().sort(function (a, b) { return a - b; });
    var alive = function (a) { var lo = 0, hi = N; while (lo < hi) { var mid = (lo + hi) >> 1; if (sorted[mid] < a) lo = mid + 1; else hi = mid; } return (N - lo) / N * 100; };
    var han = [], mod = [];
    for (var a = 0; a <= 90; a++) { han.push([a, alive(a)]); mod.push([a, modAt(a)]); }
    var path = function (pts) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join(' '); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="生存曲線：漢末と現代中国の比較">';
    s += '<g class="grid">';
    [0, 25, 50, 75, 100].forEach(function (p) { s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(p) + '" y2="' + Y(p) + '"/>'; });
    s += '</g><g class="axis">';
    [0, 25, 50, 75, 100].forEach(function (p) { s += '<text x="' + (m.l - 6) + '" y="' + (Y(p) + 4) + '" text-anchor="end">' + p + '%</text>'; });
    for (var t = 0; t <= 90; t += 10) s += '<text x="' + X(t) + '" y="' + (H - 8) + '" text-anchor="middle">' + t + (t === 90 ? '歳' : '') + '</text>';
    s += '</g>';
    s += '<path class="area" d="' + path(han) + ' L' + X(90) + ' ' + Y(0) + ' L' + X(0) + ' ' + Y(0) + ' Z"/>';
    s += '<path class="line s-mod" d="' + path(mod) + '"/>';
    s += '<path class="line s-han" d="' + path(han) + '"/>';
    var endH = han[90][1], endM = mod[90][1];
    var yH = Y(endH), yM = Y(endM);
    if (Math.abs(yH - yM) < 16) { if (yH > yM) yH = yM + 16; else yM = yH + 16; }
    s += '<text class="lbl" x="' + (X(90) + 8) + '" y="' + (yM + 4) + '">現代 ' + Math.round(endM) + '%</text>';
    s += '<text class="lbl" x="' + (X(90) + 8) + '" y="' + (yH + 4) + '">漢末 ' + endH.toFixed(1) + '%</text>';
    var myA = Math.min(my, 90), myP = alive(myA);
    s += '<circle class="dot" cx="' + X(myA) + '" cy="' + Y(myP) + '" r="5"/>';
    var lx = X(myA) + 9, anchor = 'start';
    if (lx > W - m.r - 60) { lx = X(myA) - 9; anchor = 'end'; }
    var ly = Y(myP) - 9 < m.t + 14 ? Y(myP) + 20 : Y(myP) - 9;
    s += '<text class="lbl" x="' + lx + '" y="' + ly + '" text-anchor="' + anchor + '">あなた · ' + my + '歳</text>';
    s += '<line class="xh" id="surv-xh" x1="0" x2="0" y1="' + m.t + '" y2="' + (H - m.b) + '" visibility="hidden"/>';
    s += '<rect id="surv-hit" x="' + m.l + '" y="' + m.t + '" width="' + (W - m.l - m.r) + '" height="' + (H - m.t - m.b) + '" fill="transparent"/>';
    s += '</svg>';
    box.innerHTML = s + '<div class="tip" id="surv-tip" hidden></div>';
    var svg = box.querySelector('svg'), hit = box.querySelector('#surv-hit'), xh = box.querySelector('#surv-xh'), tip = box.querySelector('#surv-tip');
    function move(ev) {
      var r = svg.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * W;
      var a = Math.round((sx - m.l) / (W - m.l - m.r) * 90);
      a = Math.max(0, Math.min(90, a));
      xh.setAttribute('x1', X(a)); xh.setAttribute('x2', X(a)); xh.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.style.left = (X(a) / W * r.width) + 'px';
      tip.style.top = (Y(Math.max(han[a][1], mod[a][1])) / H * r.height) + 'px';
      tip.innerHTML = a + ' 歳で存命：漢末 ' + han[a][1].toFixed(1) + '% · 現代 ' + mod[a][1].toFixed(1) + '%';
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', function () { xh.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    var rowsT = [0, 1, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90];
    $('surv-table').innerHTML = '<table class="sr-table"><thead><tr><th>年齢</th><th>漢末</th><th>現代</th></tr></thead><tbody>' +
      rowsT.map(function (a) { return '<tr><td>' + a + ' 歳</td><td>' + alive(a).toFixed(1) + '%</td><td>' + modAt(a).toFixed(1) + '%</td></tr>'; }).join('') + '</tbody></table>';
  }

  /* ---------- 名冊 / 前世 ---------- */
  function openCodex() {
    var met = store.met, n = 0;
    $('codex').innerHTML = D.FIGURES.map(function (f) {
      var m = met[f.id]; if (m) n++;
      return '<div class="fig' + (m ? ' seen' : '') + '"><b>' + f.n + '</b><span>' + f.d + '</span><span class="when">' + (m ? m.y + ' 年、「' + esc(m.name) + '」として対面' : 'まだ会っていない') + '</span></div>';
    }).join('');
    $('codex-sum').textContent = '対面済み ' + n + ' / ' + D.FIGURES.length + '。ほとんどの人は、一生のうちにひとりとして会うことはない。';
    $('dlg-codex').showModal();
  }
  function openLives() {
    var L = store.lives;
    if (!L.length) { $('lives').innerHTML = '<li class="empty">まだ前世はない。</li>'; $('lives-sum').textContent = ''; }
    else {
      var ages = L.map(function (x) { return x.dy - x.by; });
      var mean = ages.reduce(function (s, a) { return s + a; }, 0) / ages.length;
      $('lives-sum').textContent = '転生 ' + L.length + ' 回、平均寿命 ' + mean.toFixed(1) + ' 年、最長 ' + Math.max.apply(null, ages) + ' 年。';
      $('lives').innerHTML = L.slice(0, 120).map(function (x) {
        return '<li><div>' + esc(x.name) + ' <span>' + (x.sex === 'M' ? '男' : '女') + ' · ' + esc(x.place) + ' · ' + esc(x.cls) + ' · ' + (MODE_NAME[x.mode] || '') + ' · 命数 ' + esc(x.code) + '</span></div>' +
          '<div class="a">' + x.by + '–' + x.dy + '<br><span>' + (x.dy - x.by) + '歳 · ' + (E.CAUSE_SHORT[x.cause] || '') + (x.ach ? ' · 奇遇' + x.ach : '') + '</span></div></li>';
      }).join('');
    }
    $('dlg-lives').showModal();
  }

  function toast(msg) {
    var t = h('div', 'toast', esc(msg));
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  function copyEpitaph() {
    var L = S.L, ep = epitaph(L);
    var txt = ep.lines.join('\n') + (L.causeText ? '\n' + L.causeText : '') + (ep.last ? '\n' + ep.last : '') +
      achievements(L).map(function (a) { return '\n【' + a + '】'; }).join('') + '\n\n' + E.afterword(L).join('\n') + '\n—— 五千万分の一 · 命数 ' + codeOf(S.seed, S.mode);
    var done = function () { toast('墓誌をコピーしました'); };
    try {
      navigator.clipboard.writeText(txt).then(done, fallback);
    } catch (e) { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e2) { toast('自動でコピーできませんでした。手動で文字を選択してください'); }
      ta.remove();
    }
  }

  function setPlayIcon() {
    var b = $('btn-play');
    b.innerHTML = S.playing ? '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12"/><rect x="8.5" y="1" width="3.5" height="12"/></svg>' : '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1 L12 7 L3 13 Z"/></svg>';
    b.setAttribute('aria-label', S.playing ? '一時停止' : '再生');
  }

  /* ---------- 綁定 ---------- */
  function init() {
    initIntro();
    $('btn-start').onclick = beginPlayback;
    $('focus-select').onchange = function () { focusChanged(true); };
    $('focus-auto').onchange = function () { focusChanged(false); };
    $('btn-spend').onclick = openSpend;
    $('chron-order').onclick = toggleChronOrder;
    window.addEventListener('resize', function () { fitChron(); follow(); });
    $('chron').addEventListener('scroll', function () { if (narrow()) return; var c = $('chron'); S.stick = upMode() ? c.scrollTop < 60 : c.scrollHeight - c.scrollTop - c.clientHeight < 80; });
    window.addEventListener('scroll', function () { if (!narrow() || !S.L || !$('chron').offsetParent) return; var r = $('chron').getBoundingClientRect(); S.stick = upMode() ? true : r.bottom - window.innerHeight < 160; }, { passive: true });
    $('auto-spend').checked = !!store.autoSpend;
    $('auto-spend').onchange = function () { store.autoSpend = $('auto-spend').checked; save(); if (S.L) S.L.autoSpendOn = store.autoSpend; toast(store.autoSpend ? '自動支出をオンにしました' : '自動支出をオフにしました'); };
    $('dlg-spend').addEventListener('close', function () { if (S.wasPlaying) { S.playing = true; setPlayIcon(); } S.wasPlaying = false; });
    $('btn-play').onclick = function () { S.playing = !S.playing; setPlayIcon(); };
    $('btn-skip').onclick = skipToEnd;
    $('btn-again').onclick = function () { startLife(newSeed(), S.mode === 'mirror' ? S.opts : { mode: S.mode }); };
    $('btn-copy').onclick = copyEpitaph;
    $('btn-heir').onclick = function () { if (S.heir) startLife(newSeed(), { mode: 'heir', heir: S.heir }); };
    $('btn-codex').onclick = openCodex;
    $('btn-lives').onclick = openLives;
    $('btn-about').onclick = function () { $('dlg-about').showModal(); };
    document.querySelectorAll('dialog').forEach(function (d) {
      d.querySelector('[data-close]').onclick = function () { d.close(); };
      d.addEventListener('click', function (ev) { if (ev.target === d) d.close(); });
    });
    $('tabs').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.tab === 'hanji') { $('hanji').scrollIntoView({ behavior: 'smooth' }); return; }
      $('life-grid').dataset.tab = b.dataset.tab;
      $('tabs').querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.code !== 'Space' || $('life').hidden || /INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) return;
      ev.preventDefault(); S.playing = !S.playing; setPlayIcon();
    });
    requestAnimationFrame(frame);
    ensureStats('history');
  }

  window.SGUI = { S: S, startLife: startLife, skipToEnd: skipToEnd };
  init();
})();
