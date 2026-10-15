/* 一世·汉末 —— 界面与播放 */
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
  var MODES = { history: 'H', zhongping: 'Z', jianan: 'J', chaos: 'C', blind: 'B', mirror: 'M' };
  var MODE_NAME = { history: '史实人生', zhongping: '生于中平', jianan: '生于建安', chaos: '乱世之子', blind: '真正的随机', mirror: '我若生于那个时代' };
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
    var m = /^\s*([HZJCBM])\s*-?\s*([0-9A-Z]+)\s*$/i.exec(s || '');
    if (!m) return null;
    var mode = Object.keys(MODES).filter(function (k) { return MODES[k] === m[1].toUpperCase(); })[0];
    var seed = parseInt(m[2], 36);
    if (!isFinite(seed)) return null;
    return { seed: seed >>> 0, mode: mode === 'mirror' ? 'history' : mode };
  }
  function compSeed(seed, i) { return (seed ^ Math.imul(0x9E3779B9, i + 1)) >>> 0; }

  /* ---------- 统计（同时代人） ---------- */
  function statsMode(mode) { return mode === 'blind' || mode === 'mirror' ? 'history' : mode; }
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
      opts.mirror = { prov: p[0], note: p[2] || '', tier: $('m-tier').selectedOptions[0].textContent, edu: $('m-edu').selectedOptions[0].textContent };
      startLife(newSeed(), opts);
    };
    $('btn-seed').onclick = function () {
      var c = parseCode($('seed-input').value);
      if (!c) { toast('命数的格式像这样：H-1K3X9Q'); return; }
      startLife(c.seed, { mode: c.mode });
    };
    var hm = /^#m([HZJCB][0-9A-Z]+)$/i.exec(location.hash || '');
    if (hm) { $('seed-input').value = hm[1].slice(0, 1) + '-' + hm[1].slice(1); $('seed-panel').open = true; }
    $('btn-home').onclick = goHome;
    $('btn-back').onclick = goHome;
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
    S.L = E.create(seed, o);
    S.comps = [0, 1, 2].map(function (i) {
      var c = E.create(compSeed(seed, i), { auto: true, year: S.L.by, mode: 'history' });
      c.cseed = compSeed(seed, i);
      return E.runToEnd(c);
    });
    ensureStats(statsMode(opts.mode));
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
      mirror = '<p class="mirror-note">你填写的是：' + esc(M.prov) + ' · 家境' + esc(M.tier) + ' · ' + esc(M.edu) + '。' + esc(M.note) +
        '在东汉，大约八成人口是农民和佃客，士族不到百分之三。你的现代条件改变了抽签的权重，但签还是要抽的——这一次，你落在了「' + clsName(L) + '」。</p>';
    }
    $('birth-main').innerHTML =
      '<p class="kicker">' + (S.blind ? '真正的随机' : MODE_NAME[S.mode]) + '</p>' +
      '<p class="era-big">' + el.big + '<small>' + (S.blind ? el.sub : '（' + y + '）' + E.ganzhi(y)) + '</small></p>' +
      '<p class="born-line">你出生了。</p>' +
      '<dl class="facts">' +
      '<dt>出生地</dt><dd>' + Z.zhou + ' · ' + jun + ' · ' + L.county + (L.eth ? '（山野）' : L.urban ? '（县城）' : '（' + L.village + '）') + '</dd>' +
      '<dt>性别</dt><dd>' + (L.sex === 'M' ? '男' : '女') + '</dd>' +
      '<dt>家庭</dt><dd>' + (L.eth ? D.ETH[L.eth].tribe : clsName(L)) + '</dd>' +
      '<dt>家中排行</dt><dd>' + rank + '</dd>' +
      '<dt>父亲识字</dt><dd>' + (father.alive ? (father.lit ? '是' : '否') : '父亲已殁') + '</dd>' +
      '<dt>母亲存活</dt><dd>' + (mother.alive ? '是' : '否') + '</dd>' +
      '<dt>家有田地</dt><dd>' + landTxt + '</dd>' +
      '<dt>家庭人口</dt><dd><span class="num">' + hh + '</span> 人</dd>' +
      '</dl>' + mirror +
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

  /* ---------- 人生播放 ---------- */
  function stopLife() { S.yearActive = false; S.queue = []; clearTimeout(S.endTimer); S.choiceOpen = false; }

  function beginPlayback() {
    show('life');
    $('chron').innerHTML = '';
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
    $('chron').prepend(sec);
    S.ol = ol;
    S.t = 0; setSeason(0);
    stepLoop();
  }

  function stepLoop() {
    var r = E.step(S.L);
    if (r && r.pending) { showChoice(r.pending); return; }
    S.rec = r;
    S.queue = r.entries.slice();
    S.t = 0;
    S.yearActive = true;
  }

  function showChoice(c) {
    S.choiceOpen = true;
    var card = h('li', 'choice-card');
    var html = '';
    if (c.pre) html += '<p class="pre">' + esc(c.pre) + '</p>';
    html += '<p>' + esc(c.q) + '</p><div class="opts"></div><p class="hint">选择会改变概率，但不会决定结果。</p>';
    card.innerHTML = html;
    var box = card.querySelector('.opts');
    c.o.forEach(function (label, i) {
      var b = h('button', '', esc(label)); b.type = 'button';
      b.onclick = function () {
        E.answer(S.L, i);
        var done = h('li', 'e e-choice', (c.pre ? esc(c.pre) + '<br>' : '') + esc(c.q) + ' —— 你选择了：<b>' + esc(label) + '</b>');
        card.replaceWith(done);
        S.choiceOpen = false;
        stepLoop();
      };
      box.appendChild(b);
    });
    S.ol.appendChild(card);
    var first = box.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  var TAGS = { hist: '本地', rumor: '传闻', war: '军', move: '迁', meet: '奇遇', far: '远方' };
  function entryEl(e) {
    var tag = TAGS[e.k] && e.k !== 'far' ? '<span class="tag">' + TAGS[e.k] + '</span>' : '';
    return h('li', 'e e-' + e.k, tag + esc(e.t));
  }
  function revealEntry(e) {
    S.ol.appendChild(entryEl(e));
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
    S.L.auto = true;
    S.yearActive = false; S.queue = []; S.choiceOpen = false;
    if (S.L.pending) S.L.pending.answer = S.L.R() < S.L.pending.auto ? 0 : 1;
    E.runToEnd(S.L);
    finish();
  }

  /* ---------- 户籍、状态、亲人 ---------- */
  function renderRegister(y) {
    var L = S.L, box = $('slips');
    box.innerHTML = '';
    if (L.eth) {
      box.innerHTML = '<p class="tribal-note">你是' + D.ETH[L.eth].n + '人。你的族人不在汉人的户籍之中，官府只按部落计口。</p>';
    } else {
      var list = E.household(L, y), head = list[0];
      list.forEach(function (p) {
        var s = h('div', 'slip' + (p.me ? ' me' : ''), esc(E.slipText(L, p, head.name)));
        box.appendChild(s);
      });
    }
    renderStatus(y);
    renderFamily(y);
  }
  function renderStatus(y) {
    var L = S.L;
    var married = L.married ? '已婚' : L.widowed ? (L.sex === 'F' ? '寡居' : '丧妻') : '未婚';
    var job = L.band ? '随' + D.BANDS[L.band].who + '征战' : L.office ? L.office : L.soldier ? (L.job || '军卒') : L.age < 14 ? '孩童' : (L.job || '农');
    var land = L.land > 0 ? L.land + ' 亩' : '无';
    $('status').innerHTML = '<dt>身份</dt><dd>' + clsName(L) + '</dd><dt>营生</dt><dd>' + esc(job) + '</dd><dt>婚姻</dt><dd>' + married + '</dd><dt>田地</dt><dd>' + land + '</dd><dt>识字</dt><dd>' + (L.literate ? '识字' : '不识字') + '</dd>' + (L.zi ? '<dt>字</dt><dd>' + esc(L.zi) + '</dd>' : '');
  }
  function renderFamily(y) {
    var L = S.L, ul = $('family');
    ul.innerHTML = '';
    var order = { gp: 0, father: 1, mother: 2, spouse: 3, sib: 4, child: 5 };
    var ks = L.kin.filter(function (k) { return k.by <= y; }).slice().sort(function (a, b) { return order[a.rel] - order[b.rel] || a.by - b.by; });
    if (!ks.length) { ul.innerHTML = '<li class="empty">无</li>'; return; }
    ks.forEach(function (k) {
      var dead = !k.alive && k.dy < y + 1 && k.dy <= y;
      var st;
      if (dead) st = '殁 · ' + (k.dy - k.by) + '岁';
      else if (k.apart) st = '音讯全无';
      else if (k.out) st = k.rel === 'child' ? '已嫁' : '娘家';
      else if (k.soldier) st = '从军 · ' + (y - k.by) + '岁';
      else st = (y - k.by) + '岁';
      var li = h('li', dead ? 'dead' : '');
      li.innerHTML = '<span class="r">' + E.relName(L, k) + '</span><span class="n">' + esc(k.name) + '</span><span class="s">' + st + '</span>';
      ul.appendChild(li);
    });
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
    if (age > 0) lines.push(E.reignText(L.zone, L.dy) + '卒。');
    if (L.sex === 'M' && age >= 20) lines.push(L.officeMax ? '曾任' + L.officeMax + '。' : '一生未曾入仕。');
    if (L.soldierYears > 0) lines.push('从军' + cn(L.soldierYears) + '年。');
    if (L.moves > 0) lines.push('迁居' + cn(L.moves) + '次。');
    else if (age >= 10) lines.push('一生未曾离开' + D.JUN[L.birthJun][0] + '。');
    if (L.kidsBorn > 0) lines.push('生育' + cn(L.kidsBorn) + '子女，' + (adultKids === 0 ? '无一人' : cn(adultKids) + '人') + '活至成年。');
    if (L.grandkids > 0) lines.push('有孙辈' + cn(L.grandkids) + '人。');
    var last = '';
    if (L.by < 184 && L.dy >= 280) last = '你从黄巾之乱一直活到了三国归晋。';
    else if (L.by < 220 && L.dy >= 265) last = '你经历了两个王朝的终结。';
    else if (L.by < 220 && L.dy >= 220) last = '你经历了一个王朝的终结。';
    else if (L.by < 184 && L.dy >= 184) last = '你见证了一个太平年代的结束。';
    return { lines: lines, last: last };
  }

  function achievements(L) {
    var a = L.achievements.slice();
    L.meetLog.forEach(function (m) { if (a.indexOf(m.ach) < 0) a.push(m.ach); });
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
    $('seed-code').innerHTML = '命数 <code>' + codeOf(S.seed, S.mode) + '</code>';
    renderHanji($('end-hanji'), $('end-hanji-tip'), L.dy, L.dy, true);
    renderFullChron(L);
    var st = S.statsCache[statsMode(S.mode)];
    if (st && st.done) renderStats(); else { $('verdict').textContent = '正在推演同时代的其他人生……'; S.onStats = renderStats; }
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
      choices.filter(function (c) { return c.y === rec.y; }).forEach(function (c) { ol.appendChild(h('li', 'e e-choice', esc(c.q) + ' —— 你选择了：<b>' + esc(c.a) + '</b>')); });
      rec.entries.forEach(function (e) { ol.appendChild(entryEl(e)); });
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
    var L = S.L, st = S.statsCache[statsMode(S.mode)], ages = st.ages, N = ages.length;
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
      achievements(L).map(function (a) { return '\n【' + a + '】'; }).join('') + '\n—— 一世·汉末 · 命数 ' + codeOf(S.seed, S.mode);
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
    $('btn-play').onclick = function () { S.playing = !S.playing; setPlayIcon(); };
    $('btn-skip').onclick = skipToEnd;
    $('btn-again').onclick = function () { startLife(newSeed(), S.mode === 'mirror' ? S.opts : { mode: S.mode }); };
    $('btn-copy').onclick = copyEpitaph;
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
