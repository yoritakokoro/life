/* 五千万分之一 —— 界面与播放 */
(function () {
  'use strict';
  var D = SGD, E = SGE;
  var $ = function (id) { return document.getElementById(id); };
  var cn = E.cnNum;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function h(tag, cls, html) { var el = document.createElement(tag); if (cls) el.className = cls; if (html != null) el.innerHTML = html; return el; }

  /* ---------- 本地记录 ---------- */
  var KEY = 'yishi-hanmo-v1';
  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && d.lives && d.met) return d; } catch (e) { /* 无痕模式等 */ }
    return { lives: [], met: {}, speed: 6 };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* 忽略 */ } }
  var store = load();

  var SPEEDS = [['慢', 12], ['中', 6], ['快', 2.5], ['极快', 0.7]];
  var MODES = { history: 'H', zhongping: 'Z', jianan: 'J', chaos: 'C', blind: 'B', xiping: 'X', sanguo: 'S', weijin: 'W', taikang: 'T', mirror: 'M', heir: 'G' };
  var MODE_NAME = { history: '史实人生', zhongping: '生于中平', jianan: '生于建安', chaos: '乱世之子', blind: '真正的随机', xiping: '生于熹平', sanguo: '三国鼎立', weijin: '魏晋之际', taikang: '生于太康', mirror: '我若生于那个时代', heir: '传家' };
  var GNAME = function (g, y) { return { han: '汉', wei: y < 220 ? '曹操' : '魏', shu: y < 221 ? '刘备' : '蜀汉', wu: y < 222 ? '孙氏' : '吴', jin: y >= 317 ? '东晋' : '晋', other: '其他势力' }[g]; };

  var S = { speed: store.speed || 6, playing: true, last: 0, t: 0, queue: [], yearActive: false, L: null, comps: [], statsCache: {} };

  /* ---------- 屏幕切换 ---------- */
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

  /* ---------- 统计（同时代人） ---------- */
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

  /* ---------- 开篇 ---------- */
  var PROV = [
    ['北京', ['广阳郡', '渔阳郡', '上谷郡', '涿郡']], ['天津', ['渔阳郡', '勃海郡', '河间国']],
    ['河北', ['涿郡', '中山国', '常山国', '巨鹿郡', '赵国', '安平国', '河间国', '清河国', '勃海郡', '魏郡', '代郡', '上谷郡']],
    ['山西', ['太原郡', '上党郡', '雁门郡', '西河郡', '河东郡']], ['内蒙古', ['云中郡', '五原郡', '代郡'], '当时多为鲜卑、匈奴游牧之地，取最近的汉郡。'],
    ['辽宁', ['辽东郡', '辽西郡', '玄菟郡']], ['吉林', ['玄菟郡', '辽东郡'], '当时多为夫余、高句丽之地，取最近的汉郡。'], ['黑龙江', ['玄菟郡', '辽东郡'], '当时在汉朝疆域之外，取最近的汉郡。'],
    ['上海', ['吴郡']], ['江苏', ['下邳国', '彭城国', '东海郡', '广陵郡', '吴郡', '丹杨郡']], ['浙江', ['吴郡', '会稽郡']],
    ['安徽', ['九江郡', '庐江郡', '沛国', '汝南郡', '丹杨郡']], ['福建', ['会稽郡'], '福建当时属会稽郡南部（东冶）。'], ['江西', ['豫章郡']],
    ['山东', ['济南国', '平原郡', '乐安国', '北海国', '东莱郡', '齐国', '泰山郡', '鲁国', '琅邪国', '东平国', '任城国', '济北国', '山阳郡', '济阴郡', '东郡']],
    ['河南', ['河南尹', '河内郡', '弘农郡', '颍川郡', '汝南郡', '陈国', '梁国', '陈留郡', '南阳郡']],
    ['湖北', ['南郡', '江夏郡', '南阳郡']], ['湖南', ['长沙郡', '零陵郡', '桂阳郡', '武陵郡']],
    ['广东', ['南海郡', '苍梧郡', '合浦郡']], ['广西', ['苍梧郡', '郁林郡', '合浦郡']], ['海南', ['合浦郡'], '海南岛当时属合浦郡。'],
    ['香港', ['南海郡']], ['澳门', ['南海郡']], ['重庆', ['巴郡']], ['四川', ['蜀郡', '广汉郡', '犍为郡', '巴郡', '越巂郡']],
    ['贵州', ['牂柯郡']], ['云南', ['益州郡', '永昌郡', '越巂郡']], ['西藏', ['蜀郡', '越巂郡'], '当时在汉朝疆域之外，取最近的汉郡。'],
    ['陕西', ['京兆尹', '左冯翊', '右扶风', '汉中郡']], ['甘肃', ['汉阳郡', '陇西郡', '武威郡', '张掖郡', '酒泉郡', '敦煌郡', '武都郡', '安定郡']],
    ['宁夏', ['北地郡', '安定郡']], ['青海', ['金城郡']], ['新疆', ['敦煌郡'], '西域当时归西域长史管辖，取最近的敦煌郡。'],
    ['台湾', ['会稽郡'], '台湾当时称"夷洲"，孙吴曾于230年遣甲士万人浮海至此；取会稽郡。'], ['海外或其他', null]
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
      if (!c) { toast('命数的格式像这样：H-1K3X9Q'); return; }
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
    $('intro-ledger').innerHTML = n ? '你已转世 <b class="num">' + n + '</b> 次 · 名册 <b class="num">' + met + '/' + D.FIGURES.length + '</b>' : '';
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
    if (S.blind) return { big: '某年', sub: g + '年' };
    var e = E.era(zone, y);
    return { big: e.text, sub: '公元' + y + ' · ' + g };
  }

  function renderBirth() {
    var L = S.L, y = L.by, el = eraLine(L, y, L.zone);
    var Z = D.ZONES[L.zone], jun = D.JUN[L.jun][0];
    var rank = L.rank === 1 ? (L.sex === 'M' ? '长子' : '长女') : '第' + cn(L.rank) + (L.sex === 'M' ? '子' : '女');
    var landTxt = L.land > 0 ? '<span class="num">' + L.land + '</span> 亩' : { tenant: '无（佃种豪强之田）', tuntian: '无（耕种官田）', slave: '无（身为奴婢）', tribal: '无（族人共有山林草场）', soldier: '无' }[L.cls] || '无';
    var father = L.kin[0], mother = L.kin[1];
    var hh = 1 + L.kin.filter(function (k) { return k.alive; }).length;
    var next = D.MILESTONES.filter(function (m) { return m[0] >= y; })[0];
    var cd = '';
    if (S.blind) cd = '你不知道这是哪一年。只知道是' + E.ganzhi(y) + '年。';
    else if (next && next[0] === y) cd = '这一年，' + next[1] + '。';
    else if (next) cd = '此时距离' + next[1] + '还有 <span class="num">' + (next[0] - y) + '</span> 年。';
    var mirror = '';
    if (S.opts.mirror) {
      var M = S.opts.mirror;
      mirror = '<p class="mirror-note">你填写的是：' + esc(M.prov) + ' · 家境' + esc(M.tier) + ' · ' + esc(M.edu) + (M.extra ? ' · ' + esc(M.extra) : '') + '。' + esc(M.note) +
        '在东汉，大约八成人口是农民和佃客，士族不到百分之三。你的现代条件改变了抽签的权重，但签还是要抽的——这一次，你落在了「' + clsName(L) + '」。</p>';
    }
    var fl = E.famLevel(L, hh), laws = L.eth ? [] : E.polsAt(L.zone, y);
    $('birth-main').innerHTML =
      '<p class="kicker">' + (S.blind ? '真正的随机' : MODE_NAME[S.mode]) + '</p>' +
      '<h2 class="birth-name"><span>你是</span>' + esc(L.name) + '</h2>' +
      '<p class="birth-name-sub">' + nameNote(L) + '</p>' +
      (S.opts.heir ? '<p class="mirror-note">你是' + esc(S.opts.heir.parentName) + '的' + (L.sex === 'M' ? '儿子' : '女儿') + '。上一世的你，' + (S.opts.heir.dy) + '年去世时，你' + cn(Math.max(0, S.opts.heir.age)) + '岁。' + lineageText(S.opts.heir.lineage, L) + '</p>' : '') +
      '<p class="era-big">' + el.big + '<small>' + (S.blind ? el.sub : '（' + y + '）' + E.ganzhi(y)) + '</small></p>' +
      '<p class="born-line">你出生了。</p>' +
      '<dl class="facts">' +
      '<dt>出生地</dt><dd>' + Z.zhou + ' · ' + jun + ' · ' + L.county + (L.eth ? '（山野）' : L.urban ? '（县城）' : '（' + L.village + '）') + '</dd>' +
      '<dt>性别</dt><dd>' + (L.sex === 'M' ? '男' : '女') + '</dd>' +
      '<dt>家庭</dt><dd>' + (L.eth ? D.ETH[L.eth].tribe : clsName(L)) + '</dd>' +
      (L.clanName ? '<dt>门第</dt><dd>' + esc(L.clanName) + '，' + L.gateName + '</dd>' : '') +
      (L.dishu ? '<dt>嫡庶</dt><dd>' + (L.shu ? '庶出（生母' + esc(mother.name) + '是父亲的妾）' : '嫡出（正室所生）') + '</dd>' : '') +
      '<dt>家中排行</dt><dd>' + rank + '</dd>' +
      '<dt>父亲识字</dt><dd>' + (father.alive ? (father.lit ? '是' : '否') : '父亲已殁') + '</dd>' +
      '<dt>母亲存活</dt><dd>' + (mother.alive ? '是' : '否') + '</dd>' +
      '<dt>家有田地</dt><dd>' + landTxt + '</dd>' +
      '<dt>家庭人口</dt><dd><span class="num">' + hh + '</span> 人</dd>' +
      '<dt>家境</dt><dd><b>' + fl.lv + '</b></dd>' +
      (laws.length ? '<dt>此地法令</dt><dd>' + laws.map(function (p) { return esc(p.n); }).join('、') + '</dd>' : '') +
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
    return '家谱：' + lin.map(function (x) { return x.name + '（' + x.by + '–' + x.dy + '）'; }).join(' → ') + ' → 你。';
  }
  function nameNote(L) {
    if (L.eth) return D.ETH[L.eth].n + '人。汉人的户籍上没有你的名字。';
    if (L.cls === 'slave') return '小名' + L.xiao + '。在主人家的簿籍上，你记作"户下' + (L.sex === 'M' ? '奴' : '婢') + L.given + '"。';
    if (L.sex === 'F') return '大人们叫你' + L.xiao + '。长大后，户籍上会记作"大女' + L.name + '"；出了门，人们多半只称你"' + L.sur + '氏"。';
    return '小名' + L.xiao + '。' + (L.cls === 'gentry' || L.cls === 'clerk' ? '等你行了冠礼，还会有一个字。' : '');
  }

  var ATTR = [['body', '体魄'], ['wealth', '家业'], ['learn', '才学'], ['standing', '人望'], ['fame', '名声']];
  function renderAttrs(el, a, L) {
    el.innerHTML = '';
    ATTR.forEach(function (x) {
      var v = Math.round(a[x[0]] || 0);
      var row = h('div', 'attr');
      if (x[0] === 'fame' && v <= 0) { row.innerHTML = '<span>' + x[1] + '</span><span class="attr-note">尚无名声</span><span class="v">—</span>'; }
      else row.innerHTML = '<span>' + x[1] + '</span><span class="bar"><i style="width:' + v + '%"></i></span><span class="v">' + v + '</span>';
      el.appendChild(row);
    });
  }
  function renderSpeed(el) {
    el.innerHTML = '';
    SPEEDS.forEach(function (s) {
      var b = h('button', '', s[0]);
      b.type = 'button'; b.setAttribute('aria-pressed', String(S.speed === s[1])); b.title = '一年约 ' + s[1] + ' 秒';
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

  /* ---------- 编年的阅读方向：默认像聊天记录一样，新事出现在下面，自动跟随 ---------- */
  function narrow() { return window.innerWidth <= 860; }
  // 默认最新在上
  function upMode() { return store.chronUp !== false; }
  function follow() {
    var c = $('chron'); if (S.stick === false) return;
    if (narrow()) { if (!upMode() && S.playing !== false) { var r = c.getBoundingClientRect(); if (r.bottom > window.innerHeight) window.scrollBy(0, r.bottom - window.innerHeight + 12); } return; }
    if (!upMode()) c.scrollTop = c.scrollHeight; else c.scrollTop = 0;
  }
  // 让编年框正好填满到窗口底部，最新的事总在眼前
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
    if (b) b.textContent = upMode() ? '最新在上 ⇅' : '最新在下 ⇅';
  }
  function toggleChronOrder() {
    store.chronUp = !upMode(); save();
    var c = $('chron'), secs = Array.prototype.slice.call(c.children).reverse();
    secs.forEach(function (x) { c.appendChild(x); });
    S.stick = true; setChronOrder(); follow();
    toast(upMode() ? '最新的年份显示在最上面' : '最新的事显示在最下面，并自动跟随');
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
    // 年初：抬头、舆图、户籍、同时辰
    var el = eraLine(L, y, L.zone);
    $('hud-era').textContent = el.big;
    $('hud-sub').textContent = el.sub;
    $('hud-age').textContent = L.age;
    $('hud-name').textContent = L.name;
    $('hud-place').textContent = D.ZONES[L.zone].zhou + ' · ' + D.JUN[L.jun][0] + ' · ' + L.county;
    var fk = E.ctrl(L.zone, y), g = E.group(fk), chip = $('hud-ctrl');
    chip.className = 'chip g-' + (S.blind ? 'other' : g);
    chip.lastChild.textContent = S.blind ? '治所不明' : E.fname(fk, y);
    chip.hidden = S.blind;
    var world = (D.EVENTS.filter(function (e) { return e.y === y; }).map(function (e) { return e.w; })).join(' ');
    $('ticker').lastElementChild.textContent = world || '史书上没有记下这一年的大事。';
    updateMap(y);
    renderComps($('comps'), y, false);
    renderRegister(y);
    renderHanji($('hanji-scroll'), $('hanji-tip'), y - 1, y);
    // 编年中的年份
    var sec = h('section', 'yr');
    var head = h('div', 'yr-head');
    head.innerHTML = '<b>' + (S.blind ? E.ganzhi(y) : esc(el.big)) + '</b><span>' + (S.blind ? '' : y + ' · ' + E.ganzhi(y) + '<br>') + (L.age === 0 ? '出生' : L.age + ' 岁') + '</span>';
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
        S.ol.appendChild(h('li', 'e e-choice', esc(c.q) + ' —— 交给命运：<b>' + esc(c.o[i]) + '</b>')); follow();
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
    html += '<p>' + esc(c.q) + '</p>' + (c.info ? '<p class="info">' + esc(c.info) + '</p>' : '') + '<div class="opts"></div><p class="hint">' + esc(c.hint || '选择会改变概率，但不会决定结果。') + '</p>';
    card.innerHTML = html;
    var box = card.querySelector('.opts');
    c.o.forEach(function (label, i) {
      var b = h('button', '', esc(label) + (c.dis && c.dis[i] ? '<small>' + esc(c.dis[i]) + '</small>' : '')); b.type = 'button';
      if (c.dis && c.dis[i]) { b.disabled = true; b.className = 'off'; }
      b.onclick = function () {
        E.answer(S.L, i);
        var done = h('li', 'e e-choice', (c.pre ? esc(c.pre) + '<br>' : '') + esc(c.q) + (c.narr ? '<b>' : ' —— 你选择了：<b>') + esc(label) + '</b>');
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

  var TAGS = { fun: '趣闻', law: '法令', hist: '本地', rumor: '传闻', war: '军', move: '迁', meet: '奇遇', far: '远方', spend: '支用' };
  function ledgerEl(lg, age) {
    var li = h('li', 'e e-ledger');
    var who = lg.solo ? '你今年' : age < 15 || !lg.head ? '家中今年' : '你家今年';
    var sum = who + '：收入 ' + E.fmt(lg.I) + ' · 支出 ' + E.fmt(lg.X) + ' · 岁余 <b class="' + (lg.net < 0 ? 'neg' : 'pos') + '">' + (lg.net >= 0 ? '+' : '') + E.fmt(lg.net) + '</b> 钱值';
    var rows = function (arr, sign) { return arr.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td>' + sign + E.fmt(x[1]) + '</td></tr>'; }).join(''); };
    li.innerHTML = '<details><summary>' + sum + '</summary><table class="ledger"><tbody>' + rows(lg.inc, '+') + rows(lg.exp, '−') + '<tr class="tot"><td>岁余</td><td>' + (lg.net >= 0 ? '+' : '') + E.fmt(lg.net) + '</td></tr></tbody></table></details>';
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

  /* ---------- 户籍、状态、亲人 ---------- */
  function renderRegister(y) {
    var L = S.L, box = $('slips');
    box.innerHTML = '';
    if (L.eth) {
      box.classList.add('tribal');
      box.innerHTML = '<p class="tribal-note">你是' + D.ETH[L.eth].n + '人。你的族人不在汉人的户籍之中，官府只按部落计口。</p>';
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
    if (E2 && !E2.done) return '在' + E2.city + E2.n + '读书';
    if (E2 && E2.passed) return E2.n + '出身' + (L.learn >= 60 ? '，通经' : '');
    if (E2) return '曾在' + E2.city + E2.n + '求学';
    return L.literate ? (L.learn >= 60 ? '通晓经学' : L.learn >= 35 ? '读过几年书' : '识字') : '不识字';
  }
  function renderStatus(y) {
    var L = S.L;
    var married = L.married ? '已婚' : L.widowed ? (L.sex === 'F' ? '寡居' : '丧妻') : '未婚';
    var LOC = { 亭长: 1, 里正: 1, 乡啬夫: 1, 游徼: 1 }, COURT = { 郎官: 1, 尚书郎: 1, 九卿: 1 };
    var job = L.band ? '行伍 · 随' + D.BANDS[L.band].who + '征战' : L.soldier ? '行伍 · ' + (L.job || '军卒') :
      L.office ? (LOC[L.office] ? '乡里 · ' + L.office : L.office === '幕僚' ? '幕府 · ' + (L.officeMax || '掾属') : COURT[L.office] ? '朝中 · ' + L.office : '州郡 · ' + L.office) :
      L.age < 14 ? '孩童' : L.cls === 'tenant' && (!L.job || L.job === '农' || L.job === '佃户') ? '佃农' : (L.job || '农');
    var land = L.land > 0 ? L.land + ' 亩' : '无';
    var who = L.sex === 'F' && L.married && L.spouseK ? esc(L.spouseK.name) + (L.flags.isConc ? '之妾' : '之妻') + '（' + (L.flags.fcPal || clsName(L)) + '）' : L.sex === 'F' && L.widowed ? '寡妇（' + clsName(L) + '）' : clsName(L);
    $('status').innerHTML = '<dt>身份</dt><dd>' + who + '</dd><dt>营生</dt><dd>' + esc(job) + '</dd><dt>婚姻</dt><dd>' + married + '</dd><dt>田地</dt><dd>' + land + '</dd><dt>学业</dt><dd>' + eduText(L) + '</dd>' + (L.zi ? '<dt>字</dt><dd>' + esc(L.zi) + '</dd>' : '') +
      (L.clanName ? '<dt>门第</dt><dd>' + esc(L.clanName) + '</dd>' : '') + (L.dishu ? '<dt>嫡庶</dt><dd>' + L.dishu + '</dd>' : '') + (L.milMax ? '<dt>军职</dt><dd>' + L.milMax + '</dd>' : '') +
      (L.eth ? '' : '<dt>家境</dt><dd>' + E.lifeTier(L, y).lv + '</dd>') + (E.condText(L) ? '<dt>体况</dt><dd>' + E.condText(L) + '</dd>' : '') + (L.hobby ? '<dt>爱好</dt><dd>' + E.hobbyText(L) + '</dd>' : '') + (L.age >= 6 ? '<dt>性情</dt><dd>' + E.traitWords(L).join('、') + '</dd>' : '') +
      (Object.keys(L.found).length ? '<dt>天资</dt><dd>' + Object.keys(L.found).map(function (k) { return E.TALENT[k].n; }).join('、') + '</dd>' : '');
  }
  function renderRegion(y) {
    var L = S.L, v = E.regionView(L, y), el = $('reg');
    if (!v || L.eth) { $('reg-name').textContent = ''; el.innerHTML = L.eth ? '<dt>本地</dt><dd>山野之中，没有郡县的簿籍。</dd>' : ''; $('reg-note').textContent = ''; return; }
    $('reg-name').textContent = v.jun + ' · ' + v.ruler + '治下';
    var arrow = v.trend === 'up' ? ' <span class="up">↑</span>' : v.trend === 'down' ? ' <span class="down">↓</span>' : '';
    el.innerHTML =
      '<dt>户口</dt><dd>约 <span class="num">' + (v.pop >= 10 ? Math.round(v.pop) : v.pop.toFixed(1)) + '</span> 万口</dd>' +
      '<dt>治安</dt><dd><span class="meter"><i style="width:' + v.order + '%"></i></span> ' + v.orderL + '</dd>' +
      '<dt>粮价</dt><dd>每石约 <span class="num">' + E.fmt(v.price) + '</span> 钱' + arrow + '<br><span class="sub">平年约 100 钱</span></dd>' +
      '<dt>流民</dt><dd>' + v.refL + (v.refN >= 100 && !(v.out >= 0.1) ? '<br><span class="sub">约 ' + E.fmt(v.refN) + ' 人</span>' : '') + '</dd>';
    $('reg-note').textContent = v.note || '';
  }
  function renderLaws(y) {
    var L = S.L, ul = $('laws'), ps = L.eth ? [] : E.polsAt(L.zone, y);
    $('laws-ruler').textContent = L.eth ? '' : E.fname(E.ctrl(L.zone, y), y) + '治下';
    ul.innerHTML = L.eth ? '<li class="empty">你的族人不受汉家律令管束，只听部落首领的。</li>' : ps.length ? '' : '<li class="empty">沿用旧制，没有特别的法令。</li>';
    ps.forEach(function (p) { ul.appendChild(h('li', '', '<b>' + esc(p.n) + '</b><span>' + esc(p.s) + '</span>')); });
    var at = !L.eth && E.atmosAt(L.zone, y); if (at) ul.insertBefore(h('li', 'atmos', '<b>世风·' + esc(at.n) + '</b><span>' + esc(at.s) + '</span>'), ul.firstChild);
  }
  function renderEco() {
    var L = S.L, v = E.ecoView(L), el = $('eco'), det = $('eco-detail');
    if (v.slave) { $('eco-head').textContent = ''; el.innerHTML = '<dt>家计</dt><dd>衣食仰给于主家</dd><dt>私蓄</dt><dd class="num">' + E.fmt(v.priv) + ' 钱值</dd>'; det.innerHTML = ''; return; }
    $('eco-head').textContent = v.head ? '你是户主' : L.age < 15 ? '由家人操持' : '归家主支配';
    var assets = [];
    if (v.land) assets.push('田' + v.land + '亩');
    if (v.ox) assets.push('牛' + v.ox + '头');
    if (v.stock) assets.push(L.cls === 'merchant' ? '货本' : L.cls === 'tribal' ? '牲畜' : '作坊');
    assets.push(L.cls === 'gentry' ? '坞壁宅院' : '屋舍');
    el.innerHTML = '<dt>家资</dt><dd>' + assets.join(' · ') + '<br><span class="sub">折 ' + E.fmt(v.assets) + ' 钱值</span></dd>' +
      (v.months != null ? '<dt>粮储</dt><dd>' + (v.months >= 12 ? '自家的粮足支一年' : (v.months > 0 ? '自家的粮约可支撑 ' + v.months + ' 个月' : '自家不产粮，靠买粮度日')) + (v.months < 12 ? '<br><span class="sub">余财还能买 ' + (v.buyMonths >= 24 ? '两年以上' : '约 ' + v.buyMonths + ' 个月') + '的口粮</span>' : '') + '</dd>' : '') +
      '<dt>余财</dt><dd class="num">' + E.fmt(v.cash) + ' 钱值</dd>' +
      '<dt>私蓄</dt><dd class="num">' + E.fmt(v.priv) + ' 钱值</dd>' +
      '<dt>债务</dt><dd class="num' + (v.debt ? ' neg' : '') + '">' + (v.debt ? E.fmt(v.debt) + ' 钱值' : '无') + '</dd>';
    det.innerHTML = '<p class="sub">余财是钱币、布帛、粮谷折算成钱后的总数：</p><table class="ledger"><tbody>' +
      v.comp.map(function (x) { return '<tr><td>' + x[0] + '</td><td>' + E.fmt(x[1]) + '</td></tr>'; }).join('') + '</tbody></table>' +
      (v.coinNote ? '<p class="sub">' + v.coinNote + '。</p>' : '');
    var sp = $('btn-spend');
    sp.disabled = !L.alive || L.age < 15 || L.cls === 'slave';
    sp.title = L.age < 15 ? '十五岁以后才能自己谋划、支用钱财' : '每年可以主动谋划一件事，也可以支用余财';
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
    if (!F || F.eff === 'grow') why = '你还在襁褓之中，一切由家人照料。';
    else if (F.dev) why = '你原本打算' + E.FOCUS[F.man].v + '，不过' + E.FOCUS[F.auto].pull + '，这一年还是' + E.FOCUS[F.auto].v + '。';
    else if (F.man) why = '这是你定的方向。' + (F.auto !== F.man ? '若由他自己，会更想' + E.FOCUS[F.auto].v + '。' : '这也正合他的心意。');
    else why = '系统判断：' + F.why + '，因此你近来将更多心力放在「' + E.FOCUS[F.eff].n + '」上。';
    if (L.sex === 'F' && F && F.man) why = why.replace(/他/g, '她');
    $('focus-why').textContent = why;
  }
  function focusChanged(manual) {
    var L = S.L;
    if (!L) return;
    if (manual) { E.setFocus(L, $('focus-select').value); $('focus-auto').checked = false; }
    else { E.setFocus(L, $('focus-auto').checked ? null : $('focus-select').value); }
    $('focus-why').textContent = L.focusManual ? '自明年起，你将把心力放在「' + E.FOCUS[L.focusManual].n + '」上——不过人不一定全听你的。' : '自明年起，交由系统按此人的性情与处境判断。';
  }

  /* ---------- 支用余财 ---------- */
  function openSpend() {
    var L = S.L;
    if (!L || L.age < 15) return;
    S.wasPlaying = S.playing; S.playing = false; setPlayIcon();
    renderSpend();
    $('dlg-spend').showModal();
  }
  function renderSpend() {
    var L = S.L, o = E.spendOptions(L), r = o.room;
    $('spend-room').innerHTML = '可支配余财 <b class="num">' + E.fmt(o.can) + '</b> 钱值<br><span class="sub">私蓄 ' + E.fmt(r.priv) + (r.head ? ' · 家中余财 ' + E.fmt(r.house) + '（你是户主）' : ' · 家中尚有余财 ' + E.fmt(r.family) + '，但不归你支配') + '</span>';
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
        var b = h('button', 'btn', it.plan && it.st === 'ok' ? '去做' : it.st === 'ok' ? '支用' : it.st === 'ask' ? '请家主出钱' : it.st === 'no' ? '去不了' : '买不起');
        b.type = 'button'; b.disabled = it.st === 'poor' || it.st === 'no';
        b.onclick = function () {
          var res = E.spend(L, it.id);
          var e = { k: 'spend', t: res.t };
          if (S.ol) { S.ol.appendChild(entryEl(e)); follow(); }
          toast(res.ok ? '已支用 ' + E.fmt(res.c) + ' 钱值' : '没有成功');
          renderSpend(); renderEco(); renderAttrs($('attrs'), { body: L.body, wealth: L.wealth, learn: L.learn, standing: L.standing, fame: L.fame }, L);
        };
        row.appendChild(b);
        sec.appendChild(row);
      });
      box.appendChild(sec);
    });
    if (o.can < 300) box.prepend(h('p', 'spend-poor', '……你好像什么都买不起。'));
  }
  function renderFamily(y) {
    var L = S.L, ul = $('family');
    ul.innerHTML = '';
    var order = { gp: 0, father: 1, mother: 2, spouse: 3, conc: 3.5, sib: 4, child: 5 };
    var ks = L.kin.filter(function (k) { return k.by <= y; }).slice().sort(function (a, b) { return order[a.rel] - order[b.rel] || a.by - b.by; });
    if (!ks.length) { ul.innerHTML = '<li class="empty">无</li>'; return; }
    ks.forEach(function (k) {
      var dead = !k.alive && k.dy < y + 1 && k.dy <= y;
      var st;
      if (dead) st = '殁 · ' + (k.dy - k.by) + '岁';
      else if (k.apart) st = k.given ? '送与他人' : k.sold ? '卖与他人' : k.bonded ? '为人奴婢' : '音讯全无';
      else if (k.out) st = k.rel === 'child' ? '已嫁' : '娘家';
      else if (k.soldier) st = '从军 · ' + (y - k.by) + '岁';
      else st = (y - k.by) + '岁';
      if (!dead && !k.apart) st += (k.job && !k.soldier ? ' · ' + k.job : '') + (k.aff != null && y - k.by >= 8 && L.age >= 8 ? ' · ' + E.relLabel(k.aff) : '');
      var li = h('li', dead ? 'dead' : '');
      li.innerHTML = '<span class="r">' + E.relName(L, k) + '</span><span class="n">' + esc(k.name) + (k.zi ? '<small class="alias">字' + esc(k.zi) + '</small>' : '') + (k.shu ? '<small class="alias">庶出</small>' : '') + '</span><span class="s">' + st + '</span>';
      ul.appendChild(li);
    });
  }

  var FRC = { childHi: '玩伴', girlHi: '姐妹', scholar: '同道', child: '玩伴', school: '同窗', army: '同伍', office: '同僚', trade: '伙伴', girl: '姐妹', village: '乡邻', band: '同袍', old: '老友' };
  function renderFriends(y) {
    var L = S.L, ul = $('friends');
    var fs = (L.friends || []).filter(function (f) { return f.since <= y; });
    if (!fs.length) { ul.innerHTML = '<li class="empty">还没有</li>'; return; }
    ul.innerHTML = fs.map(function (f) {
      var dead = !f.alive;
      var st = dead ? '殁 · ' + f.fate : f.apart ? '音讯全无' : (y - f.by) + '岁' + (f.job ? ' · ' + f.job : '') + ' · ' + E.relLabel(f.aff);
      return '<li class="' + (dead ? 'dead' : '') + '"><span class="r">' + (f.lover ? '心上人' : FRC[f.ctx] || '朋友') + '</span><span class="n">' + esc(f.name) + '</span><span class="s">' + esc(st) + '</span></li>';
    }).join('');
  }

  /* ---------- 同时辰 ---------- */
  function compStatus(c, y) {
    var idx = y - c.by, rec = c.years[Math.min(idx, c.years.length - 1)];
    var dead = !c.alive && y >= c.dy;
    var zone = rec ? rec.zoneEnd : c.zone;
    if (dead) return { dead: true, txt: '卒，年 ' + (c.dy - c.by) + ' · ' + E.CAUSE_SHORT[c.cause], zone: zone };
    var job = idx < 14 ? '' : ' · ' + (c.job || '农');
    return { dead: false, txt: (idx === 0 ? '初生' : idx + ' 岁') + ' · ' + D.ZONES[zone].zhou + job, zone: zone };
  }
  function renderComps(el, y, final) {
    el.innerHTML = '';
    S.comps.forEach(function (c, i) {
      var st = final ? { dead: true, txt: '活了 ' + (c.dy - c.by) + ' 年 · ' + E.CAUSE_SHORT[c.cause] } : compStatus(c, y);
      var d = h('div', 'comp' + (st.dead ? ' dead' : ''));
      var who = (c.sex === 'M' ? '男' : '女') + ' · 生于' + D.ZONES[c.birthZone].zhou + D.JUN[c.birthJun][0] + ' · ' + clsName(c);
      var html = '<span class="no">' + (i + 1) + '</span><div><b>' + esc(c.name) + '</b><div class="who">' + who + '</div><div class="st">' + esc(st.txt) + '</div>';
      if (final) {
        var last = c.years[c.years.length - 1];
        var dt = last && last.entries.filter(function (e) { return e.k === 'death'; })[0];
        if (dt) html += '<div class="who">' + esc(dt.t) + '</div>';
        html += '<div class="go"><button class="btn" type="button">去经历 TA 的一生</button></div>';
      }
      d.innerHTML = html + '</div>';
      if (final) d.querySelector('button').onclick = function () { startLife(c.cseed, { mode: 'history', year: c.by }); };
      el.appendChild(d);
    });
  }

  /* ---------- 舆图 ---------- */
  var NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function buildMap() {
    var wrap = $('map-wrap');
    wrap.innerHTML = '';
    var svg = svgEl('svg', { viewBox: '0 -10 720 640', class: 'map', role: 'img', 'aria-label': '各州郡的人口与归属' });
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
      g.querySelector('title').textContent = Z.zhou + '·' + Z.label + '：约 ' + Math.round(pop) + ' 万口' + (S.blind ? '' : '，属' + E.fname(fk, y));
    });
    // 标记
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
      '<span><i class="me"></i>你</span><span><i class="co"></i>同时辰者</span>';
    $('pop-note').textContent = '圆的大小代表估算人口' + (S.blind ? '' : '；此时天下约 ' + Math.round(E.totalPop(y)).toLocaleString('zh-CN') + ' 万口') + '（含未入籍者的估计）。';
  }

  /* ---------- 汉纪 · 一格一年 ---------- */
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
    var rows = [{ lab: '你', L: L, lim: all ? L.dy : upTo }].concat(S.comps.map(function (c, i) { return { lab: (i + 1) + ' ' + c.name, L: c, lim: all ? c.dy : upTo }; }));
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
            i.title = (S.blind && !all ? E.ganzhi(y) : y) + ' · ' + (y - r.L.by) + '岁';
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
        tip.textContent = (S.blind && !all ? E.ganzhi(yy) : yy + '年') + ' · ' + who.lab + ' ' + (yy - who.L.by) + '岁 · ' + cellNote(who.L, yy);
      });
    });
    var keep = box.scrollLeft;
    box.innerHTML = '';
    box.appendChild(g);
    box.scrollLeft = all ? 0 : Math.max(keep, (cur - y0) * CW - box.clientWidth + 120);
    var lg = box.parentNode.querySelector('.legend');
    if (lg && !lg.innerHTML) lg.innerHTML = '<span><i class="c-normal"></i>寻常一年</span><span><i class="c-hard"></i>兵祸饥疫</span><span><i class="c-move"></i>迁徙</span><span><i class="c-kid"></i>添丁</span><span><i class="c-meet"></i>奇遇</span><span><i class="c-death"></i>卒年</span>';
  }

  /* ---------- 终章 ---------- */
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
    lines.push(age === 0 ? '你没有活过一岁。' : '你活了' + cn(age) + '年。');
    lines.push(E.reignText(L.birthZone, L.by) + '生。');
    if (L.cause === 'fade') lines.push(E.reignText(L.zone, L.dy) + '以后，不知所终。');
    else if (age > 0) lines.push(E.reignText(L.zone, L.dy) + '卒。');
    if (L.clanName || L.dishu) lines.splice(1, 0, (L.clanName ? '出身' + L.clanName + (L.dishu ? '，' + L.dishu : '') : (L.dishu === '庶出' ? '庶出' : '')) + '。');
    if (lines[1] === '。') lines.splice(1, 1);
    var F = L.flags || {};
    if (F.palaceIn) lines.push(F.palaceIn + '年入宫为' + (F.palaceIn < 190 ? '采女' : '宫人') + ((F.palace || 0) >= 1 ? '，位至' + F.palaceTop : '') + '。' + (F.palaceOut ? F.palaceOut + '年放出宫。' : ''));
    if (F.isConc) lines.push('为' + (L.kin.filter(function (k) { return k.rel === 'spouse'; })[0] || { name: '显贵' }).name + '之妾。');
    if (L.edu) lines.push(L.edu.passed ? L.edu.city + L.edu.n + '出身。' : '曾在' + L.edu.city + L.edu.n + '求学。');
    if (L.sex === 'M' && age >= 20) lines.push(L.officeMax && L.milMax ? '曾任' + L.officeMax + '，又从军，官至' + L.milMax + '。' : L.officeMax ? '曾任' + L.officeMax + '。' : L.milMax ? '官至' + L.milMax + '。' : '一生未曾入仕。');
    if (F.loyal) lines.push(F.loyal + '败亡后，不仕新朝。');
    if (L.sex === 'F' && age >= 15 && !L.married && !L.widowed && !L.divorced && L.kidsBorn === 0) lines.push('终身未嫁。');
    if (L.divorced) lines.push('曾被夫家休弃。');
    if (L.flags.abducted) lines.push('曾被乱兵掳走，流落异乡。');
    if (L.soldierYears > 0) lines.push('从军' + cn(L.soldierYears) + '年。');
    if (L.moves > 0) lines.push('迁居' + cn(L.moves) + '次。');
    if ((L.visited || []).length >= 2) lines.push('游历' + L.visited.slice(0, 4).join('、') + (L.visited.length > 4 ? '等地' : '') + '。');
    else if (age >= 10) lines.push('一生未曾离开' + D.JUN[L.birthJun][0] + '。');
    if (L.kidsBorn > 0) lines.push('生育' + cn(L.kidsBorn) + '子女，' + (adultKids === 0 ? '无一人' : cn(adultKids) + '人') + '活至成年。');
    if (L.grandkids > 0) lines.push('有孙辈' + cn(L.grandkids) + '人。');
    var lit = L.kin.filter(function (k) { return k.rel === 'child' && k.lit; }).length;
    if (lit) lines.push(cn(lit) + '个孩子识字。');
    if (age >= 15 && L.cls !== 'slave') {
      if (L.eco.debt > 0) lines.push('身后还欠着' + E.fmt(L.eco.debt) + '钱值的债。');
      else if (L.land > 0) lines.push('身后留下田' + cn(L.land) + '亩。');
      else if (L.eco.cash + L.eco.priv < 300) lines.push('身后几乎一无所有。');
    }
    if (L.flags.coffin) lines.push('你早早为自己备好了寿材。');
    if (age >= 10) lines.push('你是一个' + E.traitWords(L).join('、') + '的人。');
    if (L.lineage && L.lineage.length) { var pa = L.lineage[L.lineage.length - 1]; lines.splice(1, 0, '你是' + pa.name + '的' + (L.sex === 'M' ? '儿子' : '女儿') + '。'); }
    var last = '';
    if (L.cause === 'fade') last = '史笔写到这一年就停了。你后来的日子，只有你自己知道。';
    else if (L.by < 300 && L.dy >= 349) last = '你从晋室的天下一直活到了后赵的崩溃。';
    else if (L.by < 266 && L.dy >= 317) last = '你从三国的余烬一直活到了衣冠南渡。';
    else if (L.by < 300 && L.dy >= 311 && L.dy < 317) last = '你经历了永嘉之乱。';
    else if (L.by < 184 && L.dy >= 280) last = '你从黄巾之乱一直活到了三国归晋。';
    else if (L.by < 220 && L.dy >= 265) last = '你经历了两个王朝的终结。';
    else if (L.by < 220 && L.dy >= 220) last = '你经历了一个王朝的终结。';
    else if (L.by < 184 && L.dy >= 184) last = '你见证了一个太平年代的结束。';
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
    $('afterword').innerHTML = '<h2 class="sect-title">后记</h2>' + aw.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') +
      (al.length ? '<h2 class="sect-title">身后</h2>' + al.map(function (x) { return '<p class="after">' + esc(x) + '</p>'; }).join('') : '');
    $('end-tiles').innerHTML = E.lifeSummary(L).map(function (t) { return '<div class="tile"><span class="tl">' + esc(t.l) + '</span><b class="tv">' + esc(t.v) + '</b>' + (t.s ? '<span class="ts">' + esc(t.s) + '</span>' : '') + '</div>'; }).join('');
    var ec = L.echoes || [];
    $('end-echo-wrap').hidden = !ec.length;
    $('end-echo').innerHTML = ec.map(function (e) { return '<li><p class="was">' + e.y0 + ' 年，你' + cn(e.a0) + '岁：「' + esc(e.o) + '」</p><p class="now">' + e.y1 + ' 年，你' + cn(e.a1) + '岁：' + esc(e.t) + '</p></li>'; }).join('');
    renderEndFamily(L);
    S.heir = E.heirOf(L);
    var hb = $('btn-heir');
    hb.hidden = !S.heir;
    if (S.heir) hb.textContent = '以' + (S.heir.sex === 'M' ? '儿子' : '女儿') + S.heir.xiao + '之身继续';
    $('seed-code').innerHTML = '命数 <code>' + codeOf(S.seed, S.mode) + '</code>';
    renderHanji($('end-hanji'), $('end-hanji-tip'), L.dy, L.dy, true);
    renderFullChron(L);
    var st = S.statsCache[S.sk];
    if (st && st.done) renderStats(); else { $('verdict').textContent = '正在推演同时代的其他人生……'; S.onStats = renderStats; }
  }

  var KIN_CAUSE = { plag: '死于疫病', fam: '死于饥荒', war: '死于兵祸', flood: '死于水灾', corv: '死于劳役', battle: '战死', massacre: '城破被杀', executed: '受牵连被杀', childbirth: '死于难产', road: '死于逃难途中' };
  function kinFate(L, k) {
    if (k.alive) {
      if (k.apart) return '从此音讯全无';
      var a = L.dy - k.by;
      return '你去世时' + (a <= 0 ? '尚在襁褓' : a + '岁') + (k.out && k.rel === 'child' && k.sex === 'F' ? '，已出嫁' : '') + (k.soldier ? '，在军中' : '');
    }
    var age = k.dy - k.by;
    var c = KIN_CAUSE[k.cause] || (age <= 1 ? '夭折' : age < 15 ? '夭折' : age >= 55 ? '寿终' : '病故');
    return k.dy + '年' + c + '，年' + age;
  }
  function kinExtra(k) { return [k.job, k.aff != null && k.rel !== 'gp' && (k.alive || k.dy - k.by >= 8) ? '与你' + E.relLabel(k.aff) : ''].filter(Boolean).join(' · '); }
  function renderEndFamily(L) {
    var groups = [['父母', ['father', 'mother']], ['祖辈', ['gp']], ['配偶', ['spouse', 'conc']], ['兄弟姐妹', ['sib']], ['子女', ['child']]];
    var box = $('end-family'), html = '', born = 0, lived = 0;
    groups.forEach(function (g) {
      var ks = L.kin.filter(function (k) { return g[1].indexOf(k.rel) >= 0 && k.by <= L.dy; }).sort(function (a, b) { return a.by - b.by; });
      if (!ks.length) return;
      html += '<div class="fam-group"><h3>' + g[0] + '</h3><ul>' + ks.map(function (k) {
        if (k.rel === 'child') { born++; if ((k.alive ? L.dy : k.dy) - k.by >= 15) lived++; }
        var dead = !k.alive && k.dy <= L.dy;
        var marks = (k.adopted ? '<span class="mk">收养</span>' : '') + (k.lit ? '<span class="mk">识字</span>' : '');
        var alias = [k.xiao && k.xiao !== k.name ? '小名' + k.xiao : '', k.zi ? '字' + k.zi : '', k.shu ? '庶出' + (k.momName ? '，生母' + k.momName : '') : ''].filter(Boolean).join('，');
        return '<li class="' + (dead ? 'dead' : '') + '"><span class="r">' + E.relName(L, k) + '</span><span class="n">' + esc(k.name) + (alias ? '<small class="alias">（' + esc(alias) + '）</small>' : '') + marks + '</span><span class="s">' + (k.by ? k.by + '年生 · ' : '') + esc(kinFate(L, k)) + (kinExtra(k) ? '<br>' + esc(kinExtra(k)) : '') + '</span></li>';
      }).join('') + '</ul></div>';
    });
    box.innerHTML = html || '<p class="empty">无</p>';
    $('family-sum').textContent = born ? '子女' + born + '人，' + lived + '人活过十五岁' : '';
    var fs = L.friends || [];
    $('friends-sum').textContent = fs.length ? '一生结交' + fs.length + '人' : '';
    $('end-friends').innerHTML = fs.length ? '<div class="fam-group"><ul>' + fs.map(function (f) {
      var fate = !f.alive ? f.dy + '年' + f.fate : f.apart ? f.fate || '音讯全无' : '你去世时仍在世' + (f.job ? '，做着' + f.job : '');
      return '<li class="' + (!f.alive ? 'dead' : '') + '"><span class="r">' + (f.lover ? '心上人' : FRC[f.ctx] || '朋友') + '</span><span class="n">' + esc(f.name) + '</span><span class="s">' + f.since + '年相识 · ' + esc(fate) + '<br>' + (f.alive && !f.apart ? '交情' : '最后的交情') + '：' + E.relLabel(f.aff) + '</span></li>';
    }).join('') + '</ul></div>' : '<p class="empty">你这一生，没有留下可以称作朋友的人。</p>';
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
      sec.innerHTML = '<div class="yr-head"><b>' + esc(big) + '</b><span>' + rec.y + ' · ' + (rec.age === 0 ? '出生' : rec.age + ' 岁') + '</span></div>';
      var ol = h('ol');
      choices.filter(function (c) { return c.y === rec.y; }).forEach(function (c) { ol.appendChild(h('li', 'e e-choice', esc(c.q) + (c.narr ? '<b>' : ' —— 你选择了：<b>') + esc(c.a) + '</b>')); });
      rec.entries.forEach(function (e) { ol.appendChild(entryEl(e)); });
      if (rec.ledger && (rec.age >= 14 || rec.ledger.net < 0)) ol.appendChild(ledgerEl(rec.ledger, rec.age));
      (L.spendLog || []).filter(function (x) { return x.y === rec.y; }).forEach(function (x) { ol.appendChild(entryEl({ k: 'spend', t: x.t })); });
      sec.appendChild(ol);
      box.appendChild(sec);
    });
  }

  // 现代中国（约 2020 年）的近似生存比例，仅作参照
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
    $('verdict').innerHTML = '在模拟的同时代 <b>' + N.toLocaleString('zh-CN') + '</b> 人里，' + pct(under5) + ' 没有活过五岁，平均寿命 <b>' + mean.toFixed(1) + '</b> 岁。<br>你活了 <b>' + my + '</b> 岁，比 ' + pct(shorter) + ' 的人活得长。';
    survChart($('surv'), ages, my);
    // 死因
    var cnt = {}, mine = E.CAUSE_STAT[L.cause];
    st.causes.forEach(function (c) { var k = E.CAUSE_STAT[c] || '其他'; cnt[k] = (cnt[k] || 0) + 1; });
    var rows = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; });
    var max = cnt[rows[0]];
    $('causes').innerHTML = rows.map(function (k) {
      return '<div class="row' + (k === mine ? ' me' : '') + '"><span>' + k + (k === mine ? ' ·你' : '') + '</span><span class="b"><i style="width:' + (cnt[k] / max * 100).toFixed(1) + '%"></i></span><span>' + (cnt[k] / N < 0.001 ? '<0.1' : (cnt[k] / N * 100).toFixed(1)) + '%</span></div>';
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
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="生存曲线：汉末与现代中国对比">';
    s += '<g class="grid">';
    [0, 25, 50, 75, 100].forEach(function (p) { s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(p) + '" y2="' + Y(p) + '"/>'; });
    s += '</g><g class="axis">';
    [0, 25, 50, 75, 100].forEach(function (p) { s += '<text x="' + (m.l - 6) + '" y="' + (Y(p) + 4) + '" text-anchor="end">' + p + '%</text>'; });
    for (var t = 0; t <= 90; t += 10) s += '<text x="' + X(t) + '" y="' + (H - 8) + '" text-anchor="middle">' + t + (t === 90 ? '岁' : '') + '</text>';
    s += '</g>';
    s += '<path class="area" d="' + path(han) + ' L' + X(90) + ' ' + Y(0) + ' L' + X(0) + ' ' + Y(0) + ' Z"/>';
    s += '<path class="line s-mod" d="' + path(mod) + '"/>';
    s += '<path class="line s-han" d="' + path(han) + '"/>';
    var endH = han[90][1], endM = mod[90][1];
    var yH = Y(endH), yM = Y(endM);
    if (Math.abs(yH - yM) < 16) { if (yH > yM) yH = yM + 16; else yM = yH + 16; }
    s += '<text class="lbl" x="' + (X(90) + 8) + '" y="' + (yM + 4) + '">现代 ' + Math.round(endM) + '%</text>';
    s += '<text class="lbl" x="' + (X(90) + 8) + '" y="' + (yH + 4) + '">汉末 ' + endH.toFixed(1) + '%</text>';
    var myA = Math.min(my, 90), myP = alive(myA);
    s += '<circle class="dot" cx="' + X(myA) + '" cy="' + Y(myP) + '" r="5"/>';
    var lx = X(myA) + 9, anchor = 'start';
    if (lx > W - m.r - 60) { lx = X(myA) - 9; anchor = 'end'; }
    var ly = Y(myP) - 9 < m.t + 14 ? Y(myP) + 20 : Y(myP) - 9;
    s += '<text class="lbl" x="' + lx + '" y="' + ly + '" text-anchor="' + anchor + '">你 · ' + my + '岁</text>';
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
      tip.innerHTML = a + ' 岁仍在世：汉末 ' + han[a][1].toFixed(1) + '% · 现代 ' + mod[a][1].toFixed(1) + '%';
    }
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', function () { xh.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    var rowsT = [0, 1, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90];
    $('surv-table').innerHTML = '<table class="sr-table"><thead><tr><th>年龄</th><th>汉末</th><th>现代</th></tr></thead><tbody>' +
      rowsT.map(function (a) { return '<tr><td>' + a + ' 岁</td><td>' + alive(a).toFixed(1) + '%</td><td>' + modAt(a).toFixed(1) + '%</td></tr>'; }).join('') + '</tbody></table>';
  }

  /* ---------- 名册 / 前世 ---------- */
  function openCodex() {
    var met = store.met, n = 0;
    $('codex').innerHTML = D.FIGURES.map(function (f) {
      var m = met[f.id]; if (m) n++;
      return '<div class="fig' + (m ? ' seen' : '') + '"><b>' + f.n + '</b><span>' + f.d + '</span><span class="when">' + (m ? '于 ' + m.y + ' 年，由「' + esc(m.name) + '」得见' : '未曾谋面') + '</span></div>';
    }).join('');
    $('codex-sum').textContent = '已见 ' + n + ' / ' + D.FIGURES.length + '。绝大多数人终其一生，一个也见不到。';
    $('dlg-codex').showModal();
  }
  function openLives() {
    var L = store.lives;
    if (!L.length) { $('lives').innerHTML = '<li class="empty">还没有前世。</li>'; $('lives-sum').textContent = ''; }
    else {
      var ages = L.map(function (x) { return x.dy - x.by; });
      var mean = ages.reduce(function (s, a) { return s + a; }, 0) / ages.length;
      $('lives-sum').textContent = '共转世 ' + L.length + ' 次，平均活了 ' + mean.toFixed(1) + ' 年，最长 ' + Math.max.apply(null, ages) + ' 年。';
      $('lives').innerHTML = L.slice(0, 120).map(function (x) {
        return '<li><div>' + esc(x.name) + ' <span>' + (x.sex === 'M' ? '男' : '女') + ' · ' + esc(x.place) + ' · ' + esc(x.cls) + ' · ' + (MODE_NAME[x.mode] || '') + ' · 命数 ' + esc(x.code) + '</span></div>' +
          '<div class="a">' + x.by + '–' + x.dy + '<br><span>' + (x.dy - x.by) + '岁 · ' + (E.CAUSE_SHORT[x.cause] || '') + (x.ach ? ' · 奇遇' + x.ach : '') + '</span></div></li>';
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
      achievements(L).map(function (a) { return '\n【' + a + '】'; }).join('') + '\n\n' + E.afterword(L).join('\n') + '\n—— 五千万分之一 · 命数 ' + codeOf(S.seed, S.mode);
    var done = function () { toast('墓志已复制'); };
    try {
      navigator.clipboard.writeText(txt).then(done, fallback);
    } catch (e) { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e2) { toast('无法自动复制，请手动选择文字'); }
      ta.remove();
    }
  }

  function setPlayIcon() {
    var b = $('btn-play');
    b.innerHTML = S.playing ? '<svg viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12"/><rect x="8.5" y="1" width="3.5" height="12"/></svg>' : '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1 L12 7 L3 13 Z"/></svg>';
    b.setAttribute('aria-label', S.playing ? '暂停' : '继续');
  }

  /* ---------- 绑定 ---------- */
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
    $('auto-spend').onchange = function () { store.autoSpend = $('auto-spend').checked; save(); if (S.L) S.L.autoSpendOn = store.autoSpend; toast(store.autoSpend ? '已开启自动支用' : '已关闭自动支用'); };
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
