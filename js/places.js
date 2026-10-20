/*
 * 本地地球 Local Earth — P2 离线地名 / 坐标搜索增强
 * ---------------------------------------------------------------------------
 * 在保留原有 LETools 自然地球地名搜索的基础上，增加：
 *   - 内置中国城市离线地名库 data/public/places/zh-cities.json（中文名 / 拼音 /
 *     拼音首字母 / 别名 / 经纬度 / 等级，约 400 条；来源 Natural Earth + 人工整理）
 *   - 「经度,纬度」/「经度 纬度」坐标直达
 *   - 统一结果列表（本地地名 + 原有索引合并去重）、键盘上下/回车、最近搜索
 *   - 最近搜索持久化到 localStorage（key: localEarth.searchRecent）
 *
 * 对外 API：window.LEPlaces
 *   init(le)
 *   isReady() / getDatasetStats()
 *   search(q)                       -> [{name,lon,lat,height,kind,source,entity?}]
 *   flyTo(item)
 *   getRecent() / clearRecent()
 *
 * 兼容策略：不修改 js/tools.js；在 #search-input 的捕获阶段接管交互
 * （stopImmediatePropagation），原有 LETools.search() 仍被调用并合并结果，
 * 因此 “昆明 / 北京 / 102.4,25.05” 等原有搜索行为不回归。
 */
(function () {
  'use strict';

  const C = window.Cesium;
  const STORE_KEY = 'localEarth.searchRecent';
  const MAX_RECENT = 8;
  const DATASET_URL = 'data/public/places/zh-cities.json';

  // 拼音音节表（无声调），用于把连续拼音切分为音节后取首字母。
  // 覆盖常见普通话音节；个别多音/歧义切分不影响整体可用性（另有关键城市手工别名）。
  const SYLLABLE_TEXT =
    'a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu ' +
    'ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou ' +
    'chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo ' +
    'da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo ' +
    'e ei en eng er fa fan fang fei fen feng fo fou fu ' +
    'ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ' +
    'ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo ' +
    'ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ' +
    'ka kai kan kang kao ke ken keng kong kou ku kua kuai kuan kuang kui kun kuo ' +
    'la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu long lou lu luan lue lun luo lv lve ' +
    'ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu ' +
    'na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nue nuo nv nve ' +
    'o ou pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu ' +
    'qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ' +
    'ran rang rao re ren reng ri rong rou ru ruan rui run ruo ' +
    'sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou ' +
    'shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ' +
    'ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo ' +
    'wa wai wan wang wei wen weng wo wu ' +
    'xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ' +
    'ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun ' +
    'za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi ' +
    'zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo';
  const SYLLABLES = new Set(SYLLABLE_TEXT.split(' '));

  const state = {
    le: null,
    ready: false,
    failed: false,
    places: [],
    items: [], // 本地地名索引项
    recent: [],
    results: [],
    activeIndex: -1,
    mode: 'query', // query | recent
    timer: 0,
    bound: false,
    lastQuery: '',
  };

  const byId = (id) => document.getElementById(id);

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  /* --------------------------- 拼音首字母 --------------------------- */

  function splitPinyin(py) {
    const out = [];
    let i = 0;
    while (i < py.length) {
      let matched = '';
      for (let len = Math.min(6, py.length - i); len >= 1; len--) {
        const sub = py.slice(i, i + len);
        if (SYLLABLES.has(sub)) {
          matched = sub;
          break;
        }
      }
      if (!matched) matched = py[i];
      out.push(matched);
      i += matched.length;
    }
    return out;
  }

  function abbrOf(py) {
    return splitPinyin(String(py || '').toLowerCase())
      .map((s) => s[0] || '')
      .join('');
  }

  /* --------------------------- 数据加载 --------------------------- */

  function buildItems(places) {
    const items = [];
    places.forEach((p, i) => {
      if (!p || !p.name || !isFinite(p.lon) || !isFinite(p.lat)) return;
      const pinyin = String(p.pinyin || '').toLowerCase();
      const aliases = Array.isArray(p.aliases) ? p.aliases : [];
      const aliasesLower = aliases.map((a) => String(a).toLowerCase());
      items.push({
        idx: i,
        name: String(p.name),
        pinyin,
        abbr: abbrOf(pinyin),
        aliasesLower,
        lon: Number(p.lon),
        lat: Number(p.lat),
        level: p.level || '地名',
        height: 40000,
        kind: p.level || '地名',
        source: 'local',
      });
    });
    return items;
  }

  async function loadDataset() {
    try {
      const res = await fetch(DATASET_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const places = Array.isArray(data) ? data : data.places || [];
      state.places = places;
      state.items = buildItems(places);
      state.ready = true;
      updateBadge();
      return state.items;
    } catch (err) {
      state.failed = true;
      console.warn('[LEPlaces] 离线地名库加载失败（搜索仍可用原有索引与坐标）', err);
      updateBadge();
      return [];
    }
  }

  function updateBadge() {
    const badge = byId('search-badge');
    if (!badge) return;
    if (state.ready) {
      badge.textContent = '地名 ' + state.items.length;
      badge.title = '离线中国城市地名库：' + state.items.length + ' 条（Natural Earth + 人工整理）';
      badge.classList.remove('hidden');
    } else if (state.failed) {
      badge.textContent = '地名 --';
      badge.title = '离线地名库加载失败，仅使用原有索引与坐标搜索';
      badge.classList.remove('hidden');
    }
  }

  /* --------------------------- 最近搜索 --------------------------- */

  function loadRecent() {
    try {
      const raw = window.localStorage && window.localStorage.getItem(STORE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      state.recent = Array.isArray(arr) ? arr.slice(0, MAX_RECENT) : [];
    } catch (err) {
      state.recent = [];
    }
  }

  function saveRecent() {
    try {
      if (window.localStorage) window.localStorage.setItem(STORE_KEY, JSON.stringify(state.recent));
    } catch (err) {
      /* ignore */
    }
  }

  function recordRecent(item) {
    if (!item || item.source === 'recent') return;
    const height = item.height != null ? item.height : 40000;
    const entry = {
      name: item.name,
      lon: Number(item.lon),
      lat: Number(item.lat),
      height,
      kind: item.kind || '地名',
      source: item.source || 'local',
    };
    if (!isFinite(entry.lon) || !isFinite(entry.lat)) return;
    state.recent = state.recent.filter(
      (r) => !(Math.abs(r.lon - entry.lon) < 0.0005 && Math.abs(r.lat - entry.lat) < 0.0005)
    );
    state.recent.unshift(entry);
    state.recent = state.recent.slice(0, MAX_RECENT);
    saveRecent();
  }

  /* --------------------------- 搜索/排序 --------------------------- */

  function parseCoordinate(q) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,，;；\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(q);
    if (!m) return null;
    const lon = Number(m[1]);
    const lat = Number(m[2]);
    if (!isFinite(lon) || !isFinite(lat)) return null;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    const fmt = (v) => String(Math.round(v * 1e6) / 1e6);
    return {
      name: '坐标 ' + fmt(lon) + ', ' + fmt(lat),
      lon,
      lat,
      height: 12000,
      kind: '坐标',
      source: 'coord',
    };
  }

  function scoreLocal(item, q) {
    const name = item.name.toLowerCase();
    if (name === q) return 0;
    if (item.pinyin === q || item.abbr === q) return 0.5;
    if (item.aliasesLower.indexOf(q) >= 0) return 0.8;
    if (name.indexOf(q) === 0) return 1;
    if (item.pinyin.indexOf(q) === 0) return 1.2;
    if (item.abbr.indexOf(q) === 0) return 1.4;
    for (let i = 0; i < item.aliasesLower.length; i++) {
      const a = item.aliasesLower[i];
      if (a.indexOf(q) === 0) return 1.6;
      if (a.indexOf(q) > 0) return 3.2;
    }
    if (name.indexOf(q) > 0) return 2.4;
    if (item.pinyin.indexOf(q) > 0) return 3.4;
    return -1;
  }

  const LEVEL_WEIGHT = {
    直辖市: 0,
    省会: 1,
    特别行政区: 1,
    地级市: 2,
    县级市: 3,
    坐标: -1,
  };

  function searchLocal(q) {
    const hits = [];
    for (let i = 0; i < state.items.length; i++) {
      const item = state.items[i];
      const score = scoreLocal(item, q);
      if (score < 0) continue;
      hits.push({ item, score });
    }
    hits.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const la = LEVEL_WEIGHT[a.item.level] != null ? LEVEL_WEIGHT[a.item.level] : 9;
      const lb = LEVEL_WEIGHT[b.item.level] != null ? LEVEL_WEIGHT[b.item.level] : 9;
      if (la !== lb) return la - lb;
      return a.item.name.length - b.item.name.length;
    });
    return hits.slice(0, 8).map((h) => {
      const it = h.item;
      return {
        name: it.name,
        lon: it.lon,
        lat: it.lat,
        height: it.height,
        kind: it.level,
        source: 'local',
        pinyin: it.pinyin,
      };
    });
  }

  function mergeBaseResults(q, local) {
    const base = [];
    try {
      if (window.LETools && typeof window.LETools.search === 'function') {
        base.push.apply(base, window.LETools.search(q) || []);
      }
    } catch (err) {
      console.warn('[LEPlaces] 原有搜索索引不可用', err);
    }
    const merged = local.slice();
    const near = (lon, lat) =>
      merged.some((m) => Math.abs(m.lon - lon) < 0.02 && Math.abs(m.lat - lat) < 0.02);
    for (const item of base) {
      if (!item || !isFinite(item.lon) || !isFinite(item.lat)) continue;
      if (near(item.lon, item.lat)) continue;
      if (merged.some((m) => m.name.toLowerCase() === String(item.name).toLowerCase())) continue;
      merged.push({
        name: item.name,
        lon: item.lon,
        lat: item.lat,
        height: item.height || 40000,
        kind: item.kind || '地名',
        source: 'index',
        entity: item.entity || null,
      });
      if (merged.length >= 12) break;
    }
    return merged.slice(0, 12);
  }

  /** 统一搜索：坐标 → 本地地名库 → 原有索引（合并去重）。 */
  function search(query) {
    const q = String(query == null ? '' : query).trim();
    if (!q) return [];
    const coord = parseCoordinate(q);
    if (coord) return [coord];
    const lower = q.toLowerCase();
    const local = state.ready ? searchLocal(lower) : [];
    return mergeBaseResults(q, local);
  }

  /* --------------------------- 结果渲染 --------------------------- */

  function render(items, opts) {
    const box = byId('search-results');
    if (!box) return;
    const o = opts || {};
    state.results = items;
    state.activeIndex = items.length ? 0 : -1;
    if (!items.length) {
      box.innerHTML =
        '<div class="empty">没有找到“' + escapeHtml(o.query || '') + '”</div>' +
        '<div class="search-foot">支持中文名 / 拼音 / 首字母 / 经纬度（如 102.4,25.05）</div>';
      box.classList.remove('hidden');
      return;
    }
    const rows = items.map((item, i) => {
      const kind = item.kind || (item.source === 'local' ? '地名' : '地标');
      const pinyin = item.pinyin ? '<span class="search-pinyin">' + escapeHtml(item.pinyin) + '</span>' : '';
      return (
        '<div class="item' + (i === 0 ? ' active' : '') + '" data-idx="' + i + '" role="option" aria-selected="' +
        (i === 0 ? 'true' : 'false') + '">' +
        '<span class="name">' + escapeHtml(item.name) + pinyin + '</span>' +
        '<span class="kind">' + escapeHtml(kind) + '</span>' +
        '</div>'
      );
    });
    let head = '';
    if (o.recent) {
      head =
        '<div class="search-group-head"><span>最近搜索</span>' +
        '<button type="button" class="search-recent-clear" title="清除最近搜索">清除</button></div>';
    }
    box.innerHTML =
      head +
      rows.join('') +
      '<div class="search-foot">' + (state.ready ? '本地地名库 ' + state.items.length + ' 条' : '本地地名库加载中') +
      ' · ↑↓ 选择 · Enter 飞到 · 支持坐标/拼音/首字母</div>';
    box.classList.remove('hidden');
  }

  function hideResults() {
    const box = byId('search-results');
    if (box) box.classList.add('hidden');
    state.activeIndex = -1;
  }

  function highlight() {
    const box = byId('search-results');
    if (!box) return;
    const items = Array.from(box.querySelectorAll('.item'));
    items.forEach((el, i) => {
      const on = i === state.activeIndex;
      el.classList.toggle('active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function showRecent() {
    loadRecent();
    state.mode = 'recent';
    if (!state.recent.length) {
      hideResults();
      return;
    }
    render(
      state.recent.map((r) => Object.assign({ source: 'recent' }, r)),
      { recent: true }
    );
  }

  function runQuery(q) {
    state.mode = 'query';
    state.lastQuery = q;
    const items = search(q);
    render(items, { query: q });
  }

  /* --------------------------- 飞行与最近记录 --------------------------- */

  function flyTo(item) {
    if (!item) return null;
    hideResults();
    const le = state.le;
    if (!le) return null;
    try {
      if (item.entity && window.LETools && typeof window.LETools.gotoItem === 'function') {
        window.LETools.gotoItem(item);
      } else {
        le.flyTo({
          longitude: Number(item.lon),
          latitude: Number(item.lat),
          height: item.height != null ? item.height : 40000,
        });
      }
      recordRecent(item);
      if (typeof le.status === 'function') {
        le.status('已飞到：' + item.name + (item.source === 'coord' ? '（坐标）' : ''));
      }
      return item;
    } catch (err) {
      console.error('[LEPlaces] 飞行失败', err);
      if (le.toast) le.toast('飞行失败：' + err.message, 'error', 4000);
      return null;
    }
  }

  /* --------------------------- 交互接管 --------------------------- */

  function choose(index) {
    const item = state.results[index];
    if (!item) return false;
    flyTo(item);
    const input = byId('search-input');
    if (input) input.blur();
    return true;
  }

  function bindEvents(le) {
    const input = byId('search-input');
    if (!input || state.bound) return;
    state.bound = true;

    // 捕获阶段接管：阻止 tools.js 的同名气泡监听覆盖结果列表；
    // 原有 LETools.search 仍由本模块调用并合并，原搜索能力不丢失。
    input.addEventListener(
      'input',
      (ev) => {
        ev.stopImmediatePropagation();
        clearTimeout(state.timer);
        const q = input.value;
        state.timer = setTimeout(() => {
          try {
            if (!q.trim()) showRecent();
            else runQuery(q);
          } catch (err) {
            console.error('[LEPlaces] 搜索失败', err);
          }
        }, 120);
      },
      true
    );

    input.addEventListener(
      'focus',
      (ev) => {
        ev.stopImmediatePropagation();
        try {
          if (input.value.trim()) runQuery(input.value);
          else showRecent();
        } catch (err) {
          console.error('[LEPlaces] 搜索失败', err);
        }
      },
      true
    );

    input.addEventListener(
      'keydown',
      (ev) => {
        ev.stopImmediatePropagation();
        const box = byId('search-results');
        if (ev.key === 'Escape') {
          hideResults();
          input.blur();
          return;
        }
        const visible = box && !box.classList.contains('hidden');
        if (!visible) {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            runQuery(input.value);
            if (state.results.length === 1) choose(0);
          }
          return;
        }
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          if (!state.results.length) return;
          ev.preventDefault();
          const dir = ev.key === 'ArrowDown' ? 1 : -1;
          state.activeIndex =
            (state.activeIndex + dir + state.results.length) % state.results.length;
          highlight();
          return;
        }
        if (ev.key === 'Enter') {
          ev.preventDefault();
          if (state.results.length) choose(Math.max(0, state.activeIndex));
          return;
        }
      },
      true
    );

    const box = byId('search-results');
    if (box) {
      box.addEventListener('click', (ev) => {
        const clearBtn = ev.target.closest ? ev.target.closest('.search-recent-clear') : null;
        if (clearBtn) {
          ev.preventDefault();
          ev.stopPropagation();
          clearRecent();
          const q = input.value;
          if (!q.trim()) showRecent();
          return;
        }
        const el = ev.target.closest ? ev.target.closest('.item') : null;
        if (!el) return;
        const idx = Number(el.dataset.idx);
        if (!isFinite(idx)) return;
        choose(idx);
        input.blur();
      });
    }

    const clearRecentBtn = byId('btn-clear-recent');
    if (clearRecentBtn) clearRecentBtn.addEventListener('click', clearRecent);

    document.addEventListener('mousedown', (ev) => {
      if (!ev.target.closest || !ev.target.closest('.searchbox')) hideResults();
    });
  }

  function clearRecent() {
    state.recent = [];
    saveRecent();
    const box = byId('search-results');
    if (box) hideResults();
    if (state.le && state.le.toast) state.le.toast('已清除最近搜索', null, 2200);
  }

  /* --------------------------- 初始化 / API --------------------------- */

  function init(le) {
    if (state.le) return state.ready;
    state.le = le || window.LE;
    if (!state.le || !state.le.viewer) return false;
    loadRecent();
    bindEvents(state.le);
    const input = byId('search-input');
    if (input) {
      input.placeholder = '搜索地名 / 拼音 / 首字母 / 经纬度（如 102.4,25.05）';
      input.setAttribute('aria-label', '搜索地名、拼音、首字母或经纬度');
    }
    loadDataset();
    return true;
  }

  window.LEPlaces = {
    init,
    isReady: () => state.ready,
    getDatasetStats: () => ({
      ready: state.ready,
      failed: state.failed,
      count: state.items.length,
      recent: state.recent.length,
      url: DATASET_URL,
    }),
    search,
    flyTo,
    getRecent: () => state.recent.map((r) => Object.assign({}, r)),
    clearRecent,
    getResults: () => state.results.map((r) => Object.assign({}, r)),
    // 调试：拼音首字母（例如 beijing -> bj）
    toAbbr: abbrOf,
  };

  document.addEventListener(
    'local-earth-ready',
    () => {
      try {
        init(window.LE || (window.MaoMaoEarth && window.MaoMaoEarth.LE));
      } catch (err) {
        console.error('[LEPlaces] 初始化失败', err);
      }
    },
    { once: true }
  );
})();
