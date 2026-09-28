// Hunch window: sidebar, toolbar search, list and icon views, preview pane, Quick Look,
// settings and the first-run welcome. Talks to the main process through window.hunch.
(() => {
  const api = window.hunch;
  const { UI, KIND_ICON, fileIcon } = window.Icons;
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name) => UI[name] ?? '';
  const fillIcons = (root = document) => $$('[data-icon]', root).forEach((el) => { if (!el.firstChild) el.innerHTML = icon(el.dataset.icon); });

  const ROW_H = { browse: 26, search: 46 };
  const EXAMPLES = [
    'that spreadsheet about the trip budget from last spring',
    'car insurance renewal',
    'receipt for the vacuum cleaner',
    'screenshot from last week',
    'my lease agreement',
    'essay about integration and meaning-making',
  ];

  const state = {
    platform: 'win32',
    settings: {},
    overview: { total: 0, roots: [], categories: [], kinds: [], tags: {} },
    status: null,
    scope: { type: 'recent' },
    searchIn: 'all',
    query: '',
    ignore: [],
    removedChips: [],
    mode: 'browse',
    items: [],
    total: 0,
    chips: [],
    ai: null,
    aiPending: false,
    sel: -1,
    view: 'list',
    sort: { key: 'date', dir: -1 },
    back: [],
    fwd: [],
    defaultRoots: [],
    categories: {},
  };

  // ---------- formatting ----------

  function fmtDate(ms, long = false) {
    if (!ms) return '--';
    const d = new Date(ms);
    const now = new Date();
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ms >= startToday) return `Today${long ? ' at' : ','} ${time}`;
    if (ms >= startToday - 86400000) return `Yesterday${long ? ' at' : ','} ${time}`;
    const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return long ? `${day} at ${time}` : day;
  }
  const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  function fmtSize(n) {
    if (n == null) return '--';
    if (n < 1000) return `${n} bytes`;
    const u = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1000; i++; } while (n >= 1000 && i < u.length - 1);
    return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
  }
  const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : /(s|x|ch|sh)$/.test(w) ? 'es' : 's'}`;
  const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;

  // ---------- thumbnails ----------

  const thumbs = new Map();
  function canThumb(item) {
    if (item.group === 'image') return true;
    const shell = state.platform === 'win32' || state.platform === 'darwin';
    return shell && ['pdf', 'video', 'document', 'presentation'].includes(item.group);
  }
  function getThumb(item, size) {
    const key = `${size}:${item.path}:${item.mtime}`;
    if (!thumbs.has(key)) thumbs.set(key, canThumb(item) ? api.thumb(item.path, size).catch(() => null) : Promise.resolve(null));
    return thumbs.get(key);
  }
  function iconHtml(item) {
    return fileIcon(item.group, item.ext);
  }
  function applyThumb(el, item, size) {
    if (!canThumb(item)) return;
    getThumb(item, size).then((url) => {
      if (url && el.isConnected && el.dataset.path === item.path) el.innerHTML = `<img src="${url}" alt="">`;
    });
  }

  // ---------- sidebar ----------

  function rootIcon(name) {
    const n = name.toLowerCase();
    if (n.includes('desktop') || n.includes('デスクトップ')) return 'monitor';
    if (n.includes('download') || n.includes('ダウンロード')) return 'download';
    if (n.includes('picture') || n.includes('photo') || n.includes('ピクチャ')) return 'photo';
    if (n.includes('document') || n.includes('ドキュメント')) return 'doc';
    return 'folder';
  }

  const sameScope = (a, b) => a.type === b.type && (a.id ?? null) === (b.id ?? null);

  function renderSidebar() {
    const o = state.overview;
    const s = state.settings;
    const item = (scope, ic, label, badge, extra = '') => `
      <button class="side-item${state.mode === 'browse' && sameScope(scope, state.scope) ? ' active' : ''}" data-scope='${esc(JSON.stringify(scope))}' title="${esc(label)}">
        ${ic}<span class="label">${esc(label)}</span>${extra}${badge != null ? `<span class="badge">${badge.toLocaleString()}</span>` : ''}
      </button>`;
    const ic = (name) => `<span class="ic">${icon(name)}</span>`;
    const dot = (color) => `<span class="dot" style="background:${color}"></span>`;
    const jevOn = s.hasOpenrouterKey || s.demo;
    let html = `<div class="side-section"><div class="side-heading">Favorites</div>
      ${item({ type: 'recent' }, ic('clock'), 'Recents')}
      ${o.roots.map((r) => item({ type: 'root', id: r.id }, ic(rootIcon(r.name)), r.name, r.count, r.private ? `<span class="lock" title="Private: never sent to AI">${icon('lockFill')}</span>` : '')).join('')}
    </div>`;
    if (o.categories.length) {
      html += `<div class="side-section"><div class="side-heading"><span>${jevOn ? 'Sorted by Jev' : 'Sorted'}</span>${jevOn ? `<span class="jev-badge">${icon('sparkle')}</span>` : '<span class="jev-badge">local guess</span>'}</div>
        ${o.categories.map((c) => item({ type: 'category', id: c.id }, dot(c.color), c.label, c.count)).join('')}</div>`;
    }
    if (o.tags.important || o.tags.sensitive) {
      html += `<div class="side-section"><div class="side-heading">Flags</div>
        ${o.tags.important ? item({ type: 'tag', id: 'important' }, `<span class="ic" style="color:#ff9f0a">${icon('starFill')}</span>`, 'Important', o.tags.important) : ''}
        ${o.tags.sensitive ? item({ type: 'tag', id: 'sensitive' }, `<span class="ic" style="color:var(--text-2)">${icon('lock')}</span>`, 'Sensitive', o.tags.sensitive) : ''}</div>`;
    }
    if (o.kinds.length) {
      html += `<div class="side-section"><div class="side-heading">Kinds</div>
        ${o.kinds.map((k) => item({ type: 'kind', id: k.id }, ic(KIND_ICON[k.id] ?? 'other'), k.label, k.count)).join('')}</div>`;
    }
    $('#sidebar-nav').innerHTML = html;
  }

  function scopeTitle(scope) {
    const o = state.overview;
    switch (scope.type) {
      case 'recent': return 'Recents';
      case 'root': return o.roots.find((r) => r.id === scope.id)?.name ?? 'Folder';
      case 'category': return o.categories.find((c) => c.id === scope.id)?.label ?? 'Sorted';
      case 'kind': return o.kinds.find((k) => k.id === scope.id)?.label ?? 'Kind';
      case 'tag': return scope.id === 'important' ? 'Important' : 'Sensitive';
      default: return 'This PC';
    }
  }

  // ---------- navigation ----------

  const snapshot = () => ({ scope: state.scope, query: state.query, ignore: state.ignore, removedChips: state.removedChips, searchIn: state.searchIn });

  function go(next, { push = true } = {}) {
    if (push) { state.back.push(snapshot()); state.fwd = []; }
    Object.assign(state, { ignore: [], removedChips: [], ...next });
    $('#search').value = state.query;
    state.sel = -1;
    if (state.query.trim()) runSearch({ ai: true, keepIgnore: true });
    else loadBrowse();
    updateNavButtons();
  }

  function updateNavButtons() {
    $('#back-btn').disabled = !state.back.length;
    $('#fwd-btn').disabled = !state.fwd.length;
  }

  async function loadBrowse({ keepSelection = false } = {}) {
    const prevPath = keepSelection ? currentItem()?.path : null;
    const r = await api.browse(state.scope);
    state.mode = 'browse';
    state.items = r.results;
    state.total = r.total;
    state.chips = [];
    if (!['name', 'date', 'size', 'kind', 'tag'].includes(state.sort.key)) state.sort = { key: 'date', dir: -1 };
    sortItems();
    state.sel = prevPath ? state.items.findIndex((i) => i.path === prevPath) : -1;
    render();
  }

  // ---------- search ----------

  let searchSeq = 0;
  let aiTimer = null;
  const aiAvailable = () => state.settings.hasOpenrouterKey || state.settings.hasOpenaiKey || state.settings.demo;

  function onSearchInput() {
    state.query = $('#search').value;
    state.ignore = [];
    state.removedChips = [];
    $('#search-clear').hidden = !state.query;
    clearTimeout(aiTimer);
    clearTimeout(onSearchInput.t);
    if (!state.query.trim()) {
      state.aiPending = false;
      updateAiIndicator();
      loadBrowse();
      return;
    }
    onSearchInput.t = setTimeout(() => runSearch({ ai: false }), 90);
    if (aiAvailable()) aiTimer = setTimeout(() => runSearch({ ai: true }), 700);
  }

  async function runSearch({ ai = false, keepIgnore = false } = {}) {
    const text = state.query.trim();
    if (!text) return loadBrowse();
    const seq = ++searchSeq;
    if (ai && aiAvailable()) { state.aiPending = true; updateAiIndicator(); }
    const scope = state.searchIn === 'current' && state.scope.type !== 'recent' ? state.scope : null;
    const prevPath = currentItem()?.path;
    let r;
    try {
      r = await api.search({ text, scope, ai: ai && aiAvailable(), ignore: state.ignore });
    } catch (err) {
      toast(`Search failed: ${err.message}`);
      return;
    } finally {
      if (seq === searchSeq && ai) { state.aiPending = false; updateAiIndicator(); }
    }
    if (seq !== searchSeq) return; // a newer search is on its way
    state.mode = 'search';
    state.items = r.results;
    state.total = r.total;
    state.chips = r.chips;
    state.ai = r.ai;
    if (!['relevance', 'name', 'date', 'size', 'kind', 'tag'].includes(state.sort.key) || state.sort.key === 'date') state.sort = { key: 'relevance', dir: -1 };
    sortItems();
    const keep = prevPath ? state.items.findIndex((i) => i.path === prevPath) : -1;
    state.sel = keep >= 0 ? keep : (state.items.length ? 0 : -1);
    render();
  }

  function updateAiIndicator() {
    $('#ai-indicator').hidden = !state.aiPending;
  }

  function toggleChip(chip) {
    const key = chip.type === 'category' ? `category:${chip.id}` : chip.type;
    if (state.ignore.includes(key)) {
      state.ignore = state.ignore.filter((k) => k !== key);
      state.removedChips = state.removedChips.filter((c) => !(c.type === chip.type && c.id === chip.id));
    } else {
      state.ignore = [...state.ignore, key];
      state.removedChips = [...state.removedChips, chip];
    }
    runSearch({ ai: true, keepIgnore: true });
  }

  // ---------- sorting ----------

  function sortItems() {
    const { key, dir } = state.sort;
    if (key === 'relevance') { state.items.sort((a, b) => b.score - a.score || b.mtime - a.mtime); return; }
    const val = {
      name: (i) => i.name.toLowerCase(),
      date: (i) => i.mtime,
      size: (i) => i.size,
      kind: (i) => i.kindLabel,
      tag: (i) => i.category?.label ?? '~',
    }[key];
    state.items.sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir || b.mtime - a.mtime;
    });
  }

  function setSort(key) {
    if (state.sort.key === key) state.sort = { key, dir: key === 'relevance' ? -1 : -state.sort.dir };
    else state.sort = { key, dir: key === 'name' || key === 'kind' || key === 'tag' ? 1 : -1 };
    const path = currentItem()?.path;
    sortItems();
    state.sel = path ? state.items.findIndex((i) => i.path === path) : -1;
    render();
  }

  // ---------- rendering ----------

  const currentItem = () => state.items[state.sel] ?? null;

  function render() {
    document.body.classList.toggle('searching', state.mode === 'search');
    $('#location-title').textContent = state.mode === 'search' ? 'Searching' : scopeTitle(state.scope);
    renderSidebar();
    renderScopeBar();
    renderViews();
    renderPathbar();
    renderInspector();
  }

  function renderScopeBar() {
    const bar = $('#scope-bar');
    bar.hidden = state.mode !== 'search';
    if (bar.hidden) return;
    const cur = $('#scope-current');
    const canScope = state.scope.type !== 'recent';
    cur.hidden = !canScope;
    cur.textContent = `“${scopeTitle(state.scope)}”`;
    $$('.scope-pill', bar).forEach((b) => b.classList.toggle('on', (b.dataset.scope === 'current' && canScope) ? state.searchIn === 'current' : state.searchIn === 'all' || !canScope));

    const chipIcon = (c) => {
      if (c.type === 'when') return `<span class="chip-ic">${icon('clock')}</span>`;
      if (c.type === 'kind') return `<span class="chip-ic">${icon(KIND_ICON[c.id.split(',')[0]] ?? 'doc')}</span>`;
      if (c.type === 'folder') return `<span class="chip-ic">${icon('folder')}</span>`;
      if (c.type === 'meaning') return `<span class="chip-ic">${icon('sparkle')}</span>`;
      if (c.type === 'category') {
        const color = state.categories[c.id]?.color ?? '#8e8e93';
        return `${c.source === 'jev' ? `<span class="chip-ic">${icon('sparkle')}</span>` : ''}<span class="dot" style="background:${color}"></span>`;
      }
      return '';
    };
    const chipHtml = (c, off) => `<span class="chip${c.source === 'jev' || c.source === 'openai' ? ' ai' : ''}${off ? ' off' : ''}" title="${esc(chipTitle(c, off))}">
      ${chipIcon(c)}<span>${esc(c.label)}</span>
      <button data-chip='${esc(JSON.stringify({ type: c.type, id: c.id, label: c.label, source: c.source }))}' aria-label="${off ? 'Restore' : 'Remove'}">${off ? icon('plus') : icon('x')}</button></span>`;
    const all = [...state.chips.map((c) => chipHtml(c, false)), ...state.removedChips.map((c) => chipHtml(c, true))];
    let extra = '';
    if (!aiAvailable()) extra = `<button class="setup-link" data-action="setup-ai">${'Set up Jev for smarter search'}</button>`;
    else if (state.ai?.error && !state.aiPending) extra = `<span class="scope-label" title="${esc(state.ai.error)}" style="color:var(--warn)">AI unavailable, local results</span>`;
    $('#understood-label').hidden = !all.length;
    $('#chips').innerHTML = all.join('') + extra;
  }

  function chipTitle(c, off) {
    if (off) return 'Removed from this search. Click + to use it again.';
    if (c.source === 'jev') return `Jev thinks the file is about ${c.label} (${pct(c.confidence)}). Click × if it isn't.`;
    if (c.source === 'openai') return 'Also matching files with similar meaning (OpenAI embeddings)';
    if (c.type === 'when') return 'Files dated or modified around this time. Click × to search any date.';
    return 'Click × to drop this from the search';
  }

  // List columns: name, date, size, kind, tag
  const COLS = [
    { key: 'name', label: 'Name', width: 'minmax(200px, 1fr)' },
    { key: 'date', label: 'Date Modified', width: '132px' },
    { key: 'size', label: 'Size', width: '82px', right: true },
    { key: 'kind', label: 'Kind', width: '160px', cls: 'kind' },
    { key: 'tag', label: 'Sorted as', width: '168px' },
  ];
  const showKind = () => $('#content').clientWidth >= 900;
  const gridCols = () => COLS.filter((c) => c.cls !== 'kind' || showKind()).map((c) => c.width).join(' ');

  function renderViews() {
    const empty = !state.items.length;
    $('#list-view').hidden = state.view !== 'list' || empty;
    $('#icon-view').hidden = state.view !== 'icons' || empty;
    $$('#view-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
    renderEmpty();
    if (empty) return;
    if (state.view === 'list') renderList(true); else renderIcons();
  }

  function renderEmpty() {
    const el = $('#empty-state');
    el.hidden = state.items.length > 0;
    if (el.hidden) return;
    const st = state.status;
    const examples = `<div class="examples">${EXAMPLES.slice(0, state.settings.demo ? 6 : 4).map((e) => `<button class="example" data-example="${esc(e)}">${icon('sparkle')}${esc(e)}</button>`).join('')}</div>`;
    if (state.mode === 'search') {
      el.innerHTML = `<div class="big-ic">${icon('search')}</div><h2>No files match that hunch</h2>
        <p>Try fewer or different words, or remove one of the filters above. Hunch reads names, folders and the text inside documents${aiAvailable() ? ', and Jev reads what you mean' : ''}.</p>`;
    } else if (!state.overview.total) {
      const busy = st && st.phase !== 'idle';
      el.innerHTML = busy
        ? `<div class="big-ic">${icon('refresh')}</div><h2>Looking through your folders…</h2><p>Files will appear here as Hunch finds them. You can start searching straight away.</p>`
        : `<div class="big-ic">${icon('folder')}</div><h2>No folders to search yet</h2><p>Choose the folders Hunch should look in.</p><button class="btn primary big" data-action="open-settings" data-tab="folders">Choose Folders…</button>`;
    } else {
      el.innerHTML = `<div class="big-ic">${icon('folder')}</div><h2>Nothing here</h2><p>No files in this place yet.</p>`;
    }
    if (state.mode === 'search' || state.overview.total) el.insertAdjacentHTML('beforeend', `<p class="small muted" style="margin-top:14px">Try describing a file the way you remember it:</p>${examples}`);
  }

  // Virtualized list: only the visible rows exist in the DOM.
  function renderList(resetScroll = false) {
    const cols = gridCols();
    const header = $('#list-header');
    header.style.gridTemplateColumns = cols;
    const arrow = (dir) => `<svg class="arrow" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${dir > 0 ? 'M2 6.5l3-3 3 3' : 'M2 3.5l3 3 3-3'}"/></svg>`;
    header.innerHTML = COLS.filter((c) => c.cls !== 'kind' || showKind()).map((c) => {
      const isName = c.key === 'name';
      const byRelevance = state.sort.key === 'relevance';
      const sorted = state.sort.key === c.key || (isName && byRelevance);
      const label = isName && byRelevance ? 'Name <span style="font-weight:400;color:var(--text-3)">· best match first</span>' : c.label;
      // In search results, Name switches between best match and A to Z.
      const next = isName && state.mode === 'search' ? (byRelevance ? 'name' : 'relevance') : c.key;
      return `<div class="col${c.right ? ' right' : ''}${c.cls ? ` ${c.cls}` : ''}${sorted ? ' sorted' : ''}" data-sort="${next}">${label}${sorted && !byRelevance ? arrow(state.sort.dir) : ''}</div>`;
    }).join('');
    const scroll = $('#list-scroll');
    if (resetScroll) scroll.scrollTop = 0;
    const h = ROW_H[state.mode];
    $('#list-spacer').style.height = `${state.items.length * h}px`;
    paintRows();
  }

  function paintRows() {
    const scroll = $('#list-scroll');
    const spacer = $('#list-spacer');
    const h = ROW_H[state.mode];
    const first = Math.max(0, Math.floor(scroll.scrollTop / h) - 8);
    const last = Math.min(state.items.length, Math.ceil((scroll.scrollTop + scroll.clientHeight) / h) + 8);
    const cols = gridCols();
    const kindCol = showKind();
    let html = '';
    for (let i = first; i < last; i++) {
      const it = state.items[i];
      const cat = it.category;
      const flags = `${it.important ? `<span class="flag" title="Important">${icon('starFill')}</span>` : ''}`;
      const nameInner = state.mode === 'search'
        ? `<span class="name-stack"><span class="nm">${esc(it.name)}</span><span class="why">${whyLine(it)}</span></span>`
        : `<span class="nm">${esc(it.name)}</span>`;
      html += `<div class="row${state.mode === 'search' ? ' two-line' : ''}${i === state.sel ? ' selected' : ''}" data-i="${i}" draggable="true"
        style="top:${i * h}px;height:${h}px;grid-template-columns:${cols}">
        <div class="cell name"><span class="thumb" data-path="${esc(it.path)}">${iconHtml(it)}</span>${nameInner}${flags}</div>
        <div class="cell">${fmtDate(it.mtime)}</div>
        <div class="cell right">${fmtSize(it.size)}</div>
        ${kindCol ? `<div class="cell kind">${esc(it.kindLabel)}</div>` : ''}
        <div class="cell tagcell">${cat ? `<span class="dot" style="background:${cat.color}"></span><span class="${cat.local ? 'local' : ''}" title="${cat.local ? 'A local guess. Jev has not sorted this file.' : `Sorted by Jev, ${pct(cat.confidence)} sure`}">${esc(cat.label)}</span>` : '<span class="local">--</span>'}</div>
      </div>`;
    }
    spacer.innerHTML = html;
    $$('.thumb', spacer).forEach((el) => {
      const it = state.items[Number(el.parentElement.parentElement.dataset.i)];
      if (it) applyThumb(el, it, 64);
    });
  }

  function whyLine(it) {
    const parts = [];
    const textReason = it.reasons.find((r) => r.type === 'text');
    if (it.snippet && textReason) parts.push(highlight(it.snippet));
    for (const r of it.reasons) {
      if (r.type === 'text' && it.snippet) continue;
      const ai = r.type === 'category' && r.text.startsWith('Jev') ? '<span class="ai-dot">✦</span> ' : '';
      parts.push(`${ai}${esc(r.text)}`);
    }
    if (!parts.length) parts.push(esc(it.folder.replace(/\//g, ' › ')));
    return parts.join('<span class="sep">·</span>');
  }

  function highlight(snip) {
    const t = snip.text;
    const off = snip.offset;
    let out = '', pos = 0;
    for (const [a, b] of snip.marks) {
      const s = a + off, e = b + off;
      if (s < pos) continue;
      out += esc(t.slice(pos, s)) + `<mark>${esc(t.slice(s, e))}</mark>`;
      pos = e;
    }
    return `“${out + esc(t.slice(pos))}”`;
  }

  let tileObserver = null;
  function renderIcons() {
    const grid = $('#icon-grid');
    const items = state.items.slice(0, 800);
    grid.innerHTML = items.map((it, i) => `
      <div class="tile${i === state.sel ? ' selected' : ''}" data-i="${i}" draggable="true" title="${esc(it.name)}">
        <div class="big" data-path="${esc(it.path)}">${iconHtml(it)}</div>
        <div class="cap">${esc(it.name)}</div>
        ${it.category && !it.category.local ? `<div class="sub"><span class="dot" style="background:${it.category.color}"></span>${esc(it.category.label)}</div>` : ''}
      </div>`).join('');
    tileObserver?.disconnect();
    tileObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target;
        tileObserver.unobserve(el);
        const it = state.items[Number(el.parentElement.dataset.i)];
        if (it) applyThumb(el, it, 256);
      }
    }, { root: grid, rootMargin: '200px' });
    $$('.big', grid).forEach((el) => tileObserver.observe(el));
  }

  function updateSelectionClasses() {
    $$('.row.selected, .tile.selected').forEach((el) => el.classList.remove('selected'));
    const sel = document.querySelector(`.row[data-i="${state.sel}"], .tile[data-i="${state.sel}"]`);
    sel?.classList.add('selected');
  }

  function select(i, { scroll = true } = {}) {
    if (!state.items.length) return;
    state.sel = Math.max(0, Math.min(state.items.length - 1, i));
    if (scroll) scrollToSelection();
    updateSelectionClasses();
    renderPathbar();
    renderInspector();
    if (!$('#quicklook').hidden) openQuickLook();
  }

  function scrollToSelection() {
    if (state.view === 'list') {
      const scroll = $('#list-scroll');
      const h = ROW_H[state.mode];
      const top = state.sel * h;
      if (top < scroll.scrollTop) scroll.scrollTop = top;
      else if (top + h > scroll.scrollTop + scroll.clientHeight) scroll.scrollTop = top + h - scroll.clientHeight;
      paintRows();
    } else {
      document.querySelector(`.tile[data-i="${state.sel}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderPathbar() {
    const it = currentItem();
    $('#count').textContent = state.mode === 'search'
      ? `${plural(state.total, 'match')}${state.total > state.items.length ? `, showing ${state.items.length}` : ''}`
      : `${plural(state.total, 'item')}${it ? `, 1 selected` : ''}`;
    if (!it) { $('#crumbs').innerHTML = ''; return; }
    const parts = it.folder.split('/');
    const chevron = `<span class="sep">${icon('chevronRight')}</span>`;
    $('#crumbs').innerHTML = parts.map((p, i) => `<span class="crumb">${i === 0 ? icon(rootIcon(p)) : icon('folder')}${esc(p)}</span>`).join(chevron)
      + chevron + `<span class="crumb file">${esc(it.name)}</span>`;
  }

  // ---------- inspector ----------

  const detailCache = new Map();
  let inspectorSeq = 0;
  async function renderInspector() {
    const el = $('#inspector');
    if (document.body.classList.contains('no-inspector')) return;
    const it = currentItem();
    if (!it) {
      el.innerHTML = `<div class="none">${icon('eye')}<div>Select a file to preview it</div></div>`;
      return;
    }
    const seq = ++inspectorSeq;
    const key = `${it.path}:${it.mtime}`;
    if (!detailCache.has(key)) detailCache.set(key, api.details(it.path));
    const d = await detailCache.get(key);
    if (seq !== inspectorSeq || !d) return;
    const j = d.jev;
    const cat = d.category;
    const rows = (pairs) => pairs.filter(Boolean).map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${v}</div>`).join('');
    let aiBlock;
    if (j) {
      aiBlock = `<div class="kv">${rows([
        ['Area', `<span class="dot" style="background:${cat.color}"></span>${esc(cat.label)}<span class="conf">${pct(j.category.confidence)}</span>`],
        j.doctype && ['Looks like', `${esc(j.doctypeLabel ?? j.doctype.id)}<span class="conf">${pct(j.doctype.confidence)}</span>`],
        j.docDate && ['Dated', `${fmtDay(j.docDate)} <span class="conf">inside the file</span>`],
      ])}</div>`;
    } else if (d.private) {
      aiBlock = `<p class="note">This folder is private: its files are searched on this PC only and never sent to Jev or OpenAI.${cat ? ` Local guess: <b>${esc(cat.label)}</b>.` : ''}</p>`;
    } else if (d.jevError) {
      aiBlock = `<p class="note warn">Jev could not sort this file: ${esc(d.jevError)}</p>`;
    } else if (['image', 'video', 'audio'].includes(d.group)) {
      aiBlock = `<p class="note">Photos, movies and music are found by name, folder and date. Jev only reads text.</p>`;
    } else if (!state.settings.hasOpenrouterKey && !state.settings.demo) {
      aiBlock = `<p class="note">${cat ? `Local guess: <b>${esc(cat.label)}</b>. ` : ''}<button class="linkish" data-action="setup-ai">Set up Jev</button> to have every file sorted by what it's about.</p>`;
    } else {
      aiBlock = `<p class="note">Waiting for Jev to sort this file…</p>`;
    }
    const why = state.mode === 'search' && it.reasons.length
      ? `<div class="insp-section"><h3>Why it matched</h3><ul class="reasons">${it.reasons.map((r) => `<li>${icon('checkCircle')}<span>${esc(r.text)}</span></li>`).join('')}</ul></div>` : '';
    const peek = d.text ? `<div class="insp-section"><h3 style="color:var(--text)">Text</h3><div class="text-peek">${esc(d.text.slice(0, 900))}</div></div>`
      : d.cloudSkipped ? `<div class="insp-section"><p class="note">This file is in a cloud-sync folder, so Hunch didn't open it (that could download it). You can change this in Settings › Privacy.</p></div>` : '';
    el.innerHTML = `
      <div class="insp-preview" data-path="${esc(d.path)}">${iconHtml(d)}</div>
      <div class="insp-name">${esc(d.name)}</div>
      <div class="insp-sub">${esc(d.kindLabel)} · ${fmtSize(d.size)}</div>
      <div class="insp-badges">
        ${d.important ? `<span class="badge-pill important">${icon('starFill')}Important</span>` : ''}
        ${d.sensitive ? `<span class="badge-pill sensitive">${icon('lock')}Sensitive</span>` : ''}
        ${d.private ? `<span class="badge-pill private">${icon('shield')}Private folder</span>` : ''}
      </div>
      <div class="insp-actions">
        <button class="btn primary" data-action="open">${icon('openBox')}Open</button>
        <button class="btn" data-action="reveal">${icon('folder')}${state.platform === 'darwin' ? 'Show in Finder' : 'Show in Folder'}</button>
        <button class="btn" data-action="copy" title="Copy path">${icon('copy')}</button>
      </div>
      ${why}
      <div class="insp-section"><h3>${icon('sparkle')}${j ? 'Sorted by Jev' : 'Sorting'}</h3>${aiBlock}</div>
      <div class="insp-section"><h3 style="color:var(--text)">Information</h3><div class="kv">${rows([
        ['Created', esc(fmtDate(d.ctime, true))],
        ['Modified', esc(fmtDate(d.mtime, true))],
        ['Where', esc(d.path.slice(0, d.path.length - d.name.length - 1))],
      ])}</div></div>
      ${peek}`;
    applyThumb($('.insp-preview', el), d, 512);
  }

  // ---------- quick look ----------

  async function openQuickLook() {
    const it = currentItem();
    if (!it) return;
    const ql = $('#quicklook');
    ql.hidden = false;
    $('#ql-title').textContent = it.name;
    const body = $('#ql-body');
    body.innerHTML = `<div class="ql-icon">${iconHtml(it)}<div>${esc(it.kindLabel)} · ${fmtSize(it.size)}</div></div>`;
    const path = it.path;
    if (canThumb(it)) {
      const url = await getThumb(it, 1024);
      if (url && currentItem()?.path === path) { body.innerHTML = `<img src="${url}" alt="">`; return; }
    }
    const d = await api.details(path);
    if (d?.text && currentItem()?.path === path) body.innerHTML = `<div class="ql-text">${esc(d.text)}</div>`;
  }
  const closeQuickLook = () => { $('#quicklook').hidden = true; };

  // ---------- actions ----------

  async function act(action, it = currentItem()) {
    if (!it) return;
    if (action === 'open') {
      const err = await api.open(it.path);
      if (err) toast(err);
    } else if (action === 'reveal') api.reveal(it.path);
    else if (action === 'copy') { await api.copyPath(it.path); toast('Path copied'); }
    else if (action === 'quicklook') openQuickLook();
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // ---------- status ----------

  function renderStatus() {
    const s = state.status;
    if (!s) return;
    const el = $('#index-status');
    let line, sub, progress = null, cls = 'busy';
    const jevOn = s.jev.enabled;
    if (s.jev.paused) {
      cls = 'paused'; line = 'Jev paused'; sub = s.jev.paused;
    } else if (s.phase === 'scanning') {
      line = 'Looking through folders…'; sub = plural(s.files, 'file') + ' found';
    } else if (s.phase === 'reading') {
      line = 'Reading files…'; sub = `${s.toRead.toLocaleString()} to go`;
    } else if (s.phase === 'tagging') {
      line = 'Jev is sorting files…'; sub = `${s.tagged.toLocaleString()} of ${s.tagEligible.toLocaleString()}`;
      progress = s.tagEligible ? s.tagged / s.tagEligible : 0;
    } else if (s.phase === 'embedding') {
      line = 'Learning what files mean…'; sub = `${s.toEmbed.toLocaleString()} to go`;
    } else {
      cls = 'idle'; line = 'Up to date';
      sub = `${plural(s.files, 'file')}${jevOn ? ` · ${s.tagged.toLocaleString()} sorted` : ' · Jev not set up'}`;
    }
    el.className = `${cls}${progress != null ? ' determinate' : ''}`;
    $('.status-line', el).textContent = line;
    $('.status-sub', el).textContent = sub;
    const bar = $('.status-ring .bar', el);
    bar.style.strokeDashoffset = cls === 'busy' ? String(50.27 * (1 - (progress ?? 0.25))) : '0';
    el.title = s.lastError ? `Last problem: ${s.lastError}` : '';
  }

  // ---------- settings & welcome ----------

  let sheetTab = 'folders';
  let draft = null;

  function openSheet(html, { onClick, onInput } = {}) {
    const back = $('#sheet-backdrop');
    const sheet = $('#sheet');
    sheet.innerHTML = html;
    fillIcons(sheet);
    back.hidden = false;
    sheet.onclick = onClick ?? null;
    sheet.oninput = onInput ?? null;
    sheet.onchange = onInput ?? null;
  }
  const closeSheet = () => { $('#sheet-backdrop').hidden = true; draft = null; };

  function openSettings(tab = sheetTab) {
    sheetTab = tab;
    const s = state.settings;
    draft ??= { roots: [...s.roots], privateRoots: [...s.privateRoots] };
    const st = state.status ?? {};
    const tabs = [['folders', 'Folders'], ['ai', 'AI'], ['privacy', 'Privacy'], ['about', 'About']];
    const counts = Object.fromEntries(state.overview.roots.map((r) => [r.id, r.count]));
    const toggle = (name, checked, attrs = '') => `<label class="toggle"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''} ${attrs}><span></span></label>`;
    let body = '';
    if (tab === 'folders') {
      body = `<div class="group-title"><span>Folders Hunch searches</span><span class="small muted">Private folders are never sent to AI</span></div>
        <div class="group">${draft.roots.map((r) => `
          <div class="group-row"><span class="folder-ic">${icon(rootIcon(r.split(/[\\/]/).pop()))}</span>
            <div class="grow"><div class="title">${esc(r.split(/[\\/]/).pop() || r)}</div><div class="path">${esc(r)}${counts[r] != null ? ` · ${plural(counts[r], 'file')}` : ''}</div></div>
            <span class="small muted">Private</span>${toggle('private', draft.privateRoots.includes(r), `data-root="${esc(r)}"`)}
            <button class="icon-btn" data-remove="${esc(r)}" title="Stop searching this folder">${icon('minus')}</button>
          </div>`).join('') || '<div class="group-row muted">No folders yet.</div>'}
        </div>
        <div style="display:flex;gap:8px"><button class="btn" data-action="add-folder">${icon('plus')}Add Folder…</button><button class="btn" data-action="rescan">${icon('refresh')}Look for changes now</button></div>
        <p class="note" style="margin-top:14px">Hunch skips system and program folders (like node_modules and AppData) and watches the folders above for new and changed files.</p>`;
    } else if (tab === 'ai') {
      const jevState = s.demo ? '<span class="pill-status ok">Demo (simulated)</span>' : s.hasOpenrouterKey ? (st.jev?.paused ? '<span class="pill-status warn">Paused</span>' : '<span class="pill-status ok">Connected</span>') : '<span class="pill-status off">Not set up</span>';
      const oaState = s.hasOpenaiKey ? (st.embeddings?.paused ? '<span class="pill-status warn">Paused</span>' : '<span class="pill-status ok">Connected</span>') : '<span class="pill-status off">Optional</span>';
      body = `
        <div class="group-title"><span>Jev by TypeSafe · sorts every file and reads your searches</span>${jevState}</div>
        <div class="group">
          <div class="group-row"><div class="grow">
            <div class="title">OpenRouter API key</div>
            <div class="desc">Jev runs on OpenRouter. <button class="linkish" data-link="https://openrouter.ai/settings/keys">Create a key</button>, add a few dollars of credit, and paste it here. Sorting 1,000 files costs about 20 cents.</div>
            <div class="key-row" style="margin-top:8px"><input class="field" type="password" name="openrouterKey" placeholder="${s.hasOpenrouterKey ? `Saved (${esc(s.openrouterKeyHint)}). Paste a new key to replace it.` : 'sk-or-v1-…'}" autocomplete="off">
            ${s.hasOpenrouterKey ? '<button class="btn danger" data-action="clear-key" data-key="openrouterKey">Remove</button>' : ''}</div>
            ${st.jev?.paused ? `<p class="note warn" style="margin:6px 0 0">${esc(st.jev.paused)}</p>` : ''}
          </div></div>
          <label class="radio-row"><input type="radio" name="jevMode" value="content" ${s.jevMode === 'content' ? 'checked' : ''}><div><div class="title">Read file text (recommended)</div><div class="desc">Sends the name, folder and an excerpt of each document's text, with emails, phone and card numbers masked.</div></div></label>
          <label class="radio-row"><input type="radio" name="jevMode" value="names" ${s.jevMode === 'names' ? 'checked' : ''}><div><div class="title">File names only</div><div class="desc">Sends only names and folders. Cheaper and more private, less accurate.</div></div></label>
          <label class="radio-row"><input type="radio" name="jevMode" value="off" ${s.jevMode === 'off' ? 'checked' : ''}><div><div class="title">Off</div><div class="desc">Nothing is sent. Search uses names, folders, dates and text on this PC.</div></div></label>
          <div class="group-row"><div class="grow small muted">${st.jev?.enabled ? `${st.tagged?.toLocaleString() ?? 0} of ${st.tagEligible?.toLocaleString() ?? 0} files sorted. ${st.estimate > 0 ? `The rest will cost about $${st.estimate < 0.01 ? '0.01 or less' : st.estimate.toFixed(2)}.` : ''} ${st.jev.usage ? `This session: ${st.jev.usage.calls} calls, $${st.jev.usage.cost.toFixed(4)}.` : ''}` : 'Paste a key above to start sorting.'}</div>
            <button class="btn" data-action="retag" ${st.jev?.enabled ? '' : 'disabled'}>${icon('refresh')}Sort everything again</button></div>
        </div>
        <div class="group-title"><span>OpenAI · "similar meaning" search</span>${oaState}</div>
        <div class="group">
          <div class="group-row"><div class="grow">
            <div class="title">OpenAI API key <span class="muted small">(optional)</span></div>
            <div class="desc">Finds files that mean the same thing even when no words match, like "auto policy" for "car insurance". Uses text-embedding-3-small: pennies for thousands of files. <button class="linkish" data-link="https://platform.openai.com/api-keys">Get a key</button></div>
            <div class="key-row" style="margin-top:8px"><input class="field" type="password" name="openaiKey" placeholder="${s.hasOpenaiKey ? `Saved (${esc(s.openaiKeyHint)}). Paste a new key to replace it.` : 'sk-…'}" autocomplete="off">
            ${s.hasOpenaiKey ? '<button class="btn danger" data-action="clear-key" data-key="openaiKey">Remove</button>' : ''}</div>
          </div></div>
          <div class="group-row"><div class="grow"><div class="title">Similar-meaning search</div><div class="desc">${st.embeddings?.enabled ? `${st.embedded?.toLocaleString() ?? 0} files understood.` : 'Needs an OpenAI key.'}</div></div>${toggle('embeddings', s.embeddings)}</div>
        </div>
        <p class="note">${s.keysEncrypted ? 'Keys are stored encrypted with your Windows account (DPAPI) and never shown to the page.' : 'Keys are stored in the app settings file on this PC.'}</p>`;
    } else if (tab === 'privacy') {
      body = `<div class="group">
          <div class="group-row"><div class="grow"><div class="title">Mask personal details before sending</div><div class="desc">Emails, phone numbers, card and account numbers, ID numbers and passwords are replaced with placeholders before any text goes to Jev.</div></div>${toggle('redact', s.redact)}</div>
          <div class="group-row"><div class="grow"><div class="title">Read files in OneDrive, Dropbox and Google Drive</div><div class="desc">Off by default: opening an online-only file makes Windows download it. When off, those files are found by name, folder and date.</div></div>${toggle('readCloudFiles', s.readCloudFiles)}</div>
        </div>
        <div class="group-title"><span>What leaves this PC</span></div>
        <div class="group"><div class="group-row"><div class="grow small" style="line-height:1.6">
          <b>Jev (OpenRouter):</b> for each document outside private folders, its name, folder, modified date and up to 5,000 characters of text (or only the name, in names-only mode). Your search sentences, to understand them.<br>
          <b>OpenAI:</b> if you add a key, the name, folder, tags and first 1,500 characters of each document, and your searches.<br>
          <b>Never sent:</b> photos, movies, music, anything in a private folder, and the files themselves. The index lives only on this PC.
        </div></div></div>`;
    } else {
      body = `<div class="welcome-hero" style="padding-top:8px"><div class="logo">${icon('logo')}</div><h1>Hunch</h1><p>Version ${esc(state.version)}. Find files by describing them the way you remember them.</p></div>
        <div class="group"><div class="group-row"><div class="grow small" style="line-height:1.6">
          <b>How it works:</b> Hunch indexes the folders you choose on this PC. Jev, TypeSafe's decision model, sorts each file into an area of life and a document type, and reads each search to guess what you mean. Dates like "last spring" and kinds like "spreadsheet" are understood on this PC. With an OpenAI key, files with similar meaning are found too.<br><br>
          <b>Keyboard:</b> Ctrl+F search · ↑↓ select · Enter open · Space Quick Look · Ctrl+1/2 icons or list · Ctrl+, settings
        </div></div></div>
        ${s.demo ? '<p class="note">Demo mode: sample files and a simulated Jev that works offline. Start Hunch normally to use your own files.</p>' : '<button class="btn" data-action="try-demo">Try the demo with sample files</button>'}`;
    }
    openSheet(`
      <div class="sheet-head"><h2>Settings</h2>
        <div class="segmented sheet-tabs">${tabs.map(([id, label]) => `<button data-tab="${id}" class="${id === tab ? 'on' : ''}">${label}</button>`).join('')}</div></div>
      <div class="sheet-body">${body}</div>
      <div class="sheet-foot"><button class="btn primary" data-action="done">Done</button></div>`, { onClick: settingsClick, onInput: settingsInput });
  }

  async function saveSettings(patch) {
    state.settings = await api.setSettings(patch);
    state.status = await api.status();
    renderStatus();
  }

  async function settingsClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) { openSettings(b.dataset.tab); return; }
    if (b.dataset.link) { api.openExternal(b.dataset.link); return; }
    if (b.dataset.remove) {
      draft.roots = draft.roots.filter((r) => r !== b.dataset.remove);
      draft.privateRoots = draft.privateRoots.filter((r) => r !== b.dataset.remove);
      await saveSettings({ roots: draft.roots, privateRoots: draft.privateRoots });
      openSettings('folders');
      return;
    }
    switch (b.dataset.action) {
      case 'done': await commitKeys(); closeSheet(); refreshAll(); break;
      case 'add-folder': {
        const picked = await api.pickFolder();
        if (picked.length) {
          draft.roots = [...new Set([...draft.roots, ...picked])];
          await saveSettings({ roots: draft.roots });
          openSettings('folders');
        }
        break;
      }
      case 'rescan': api.rescan(); toast('Looking for changes…'); break;
      case 'retag': await api.retag(); toast('Jev will sort everything again'); break;
      case 'clear-key': await saveSettings({ [b.dataset.key]: '' }); openSettings('ai'); break;
      case 'try-demo': api.tryDemo(); break;
    }
  }

  async function settingsInput(e) {
    const t = e.target;
    if (e.type === 'input') return; // keys are saved on Done; toggles on change
    if (t.name === 'private') {
      const r = t.dataset.root;
      draft.privateRoots = t.checked ? [...new Set([...draft.privateRoots, r])] : draft.privateRoots.filter((x) => x !== r);
      await saveSettings({ privateRoots: draft.privateRoots });
    } else if (t.name === 'jevMode') await saveSettings({ jevMode: t.value });
    else if (['redact', 'embeddings', 'readCloudFiles'].includes(t.name)) await saveSettings({ [t.name]: t.checked });
    else if (t.name === 'openrouterKey' || t.name === 'openaiKey') await commitKeys();
  }

  async function commitKeys() {
    const patch = {};
    for (const name of ['openrouterKey', 'openaiKey']) {
      const f = $(`#sheet input[name="${name}"]`);
      if (f && f.value.trim()) { patch[name] = f.value.trim(); f.value = ''; }
    }
    if (Object.keys(patch).length) {
      await saveSettings(patch);
      toast('Key saved');
      if (sheetTab === 'ai' && !$('#sheet-backdrop').hidden) openSettings('ai');
    }
  }

  function openWelcome() {
    const roots = state.defaultRoots;
    const chosen = new Set(roots);
    const extra = [];
    const render = () => {
      const all = [...roots, ...extra];
      openSheet(`
        <div class="welcome-hero"><div class="logo">${icon('logo')}</div>
          <h1>Find files from a hunch</h1>
          <p>Describe a file the way you remember it: "that spreadsheet about the trip budget from last spring". Hunch finds it.</p></div>
        <div class="sheet-body" style="padding-top:4px">
          <div class="step-title"><span class="step-num">1</span>Where should Hunch look?</div>
          <div class="group">${all.map((r) => `<div class="group-row"><span class="folder-ic">${icon(rootIcon(r.split(/[\\/]/).pop()))}</span>
            <div class="grow"><div class="title">${esc(r.split(/[\\/]/).pop())}</div><div class="path">${esc(r)}</div></div>
            <label class="toggle"><input type="checkbox" data-root="${esc(r)}" ${chosen.has(r) ? 'checked' : ''}><span></span></label></div>`).join('')}
            <div class="group-row"><button class="btn" data-action="add">${icon('plus')}Add Folder…</button></div></div>
          <div class="step-title"><span class="step-num">2</span>Let Jev sort your files <span class="muted small" style="font-weight:400">(optional, recommended)</span></div>
          <div class="group"><div class="group-row"><div class="grow">
            <div class="desc" style="margin-bottom:8px">Jev reads each document's name and an excerpt of its text (personal details masked) and files it under Money, Travel, Health and so on. It also reads your searches. Paste an <button class="linkish" data-link="https://openrouter.ai/settings/keys">OpenRouter key</button>; sorting 1,000 files costs about 20 cents.</div>
            <input class="field" type="password" name="openrouterKey" placeholder="sk-or-v1-…   (you can add this later in Settings)" autocomplete="off">
          </div></div></div>
          <p class="note">Nothing is read or sent until you press Start. You can mark folders as private later so they never leave this PC.</p>
        </div>
        <div class="sheet-foot"><button class="btn left" data-action="demo">Try the demo first</button><button class="btn primary big" data-action="start">Start</button></div>`, {
        onClick: async (e) => {
          const b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.link) return api.openExternal(b.dataset.link);
          if (b.dataset.action === 'add') {
            const picked = await api.pickFolder();
            for (const p of picked) if (!roots.includes(p) && !extra.includes(p)) { extra.push(p); chosen.add(p); }
            render();
          } else if (b.dataset.action === 'demo') api.tryDemo();
          else if (b.dataset.action === 'start') {
            const key = $('#sheet input[name="openrouterKey"]').value.trim();
            await saveSettings({ roots: [...chosen], firstRunDone: true, ...(key ? { openrouterKey: key } : {}) });
            closeSheet();
            refreshAll();
          }
        },
        onInput: (e) => {
          const r = e.target.dataset.root;
          if (r) { if (e.target.checked) chosen.add(r); else chosen.delete(r); }
        },
      });
    };
    render();
  }

  // ---------- refresh ----------

  async function refreshAll() {
    const init = await api.init();
    state.settings = init.settings;
    state.overview = init.overview;
    state.status = init.status;
    renderStatus();
    if (state.mode === 'search') runSearch({ ai: false, keepIgnore: true });
    else loadBrowse({ keepSelection: true });
  }

  let changedTimer = null;
  function onChanged(overview) {
    state.overview = overview;
    renderSidebar();
    // Keep browse views live while indexing; searches stay put under the user's eyes.
    if (state.mode === 'browse' && !changedTimer) {
      changedTimer = setTimeout(() => { changedTimer = null; loadBrowse({ keepSelection: true }); }, 1500);
    }
    if (!state.items.length) renderEmpty();
  }

  // ---------- events ----------

  function bind() {
    $('#search').addEventListener('input', onSearchInput);
    $('#search').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { clearTimeout(aiTimer); runSearch({ ai: true }); $('#content').focus(); if (state.items.length && state.sel < 0) select(0); }
      else if (e.key === 'Escape') { $('#search').value = ''; onSearchInput(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); $('#content').focus(); select(state.sel < 0 ? 0 : state.sel + 1); }
    });
    $('#search-clear').addEventListener('click', () => { $('#search').value = ''; onSearchInput(); $('#search').focus(); });

    $('#sidebar-nav').addEventListener('click', (e) => {
      const b = e.target.closest('.side-item');
      if (!b) return;
      go({ scope: JSON.parse(b.dataset.scope), query: '', searchIn: 'all' });
    });
    $('#back-btn').addEventListener('click', () => { if (state.back.length) { state.fwd.push(snapshot()); go(state.back.pop(), { push: false }); } });
    $('#fwd-btn').addEventListener('click', () => { if (state.fwd.length) { state.back.push(snapshot()); go(state.fwd.pop(), { push: false }); } });

    $('#view-toggle').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) setView(b.dataset.view);
    });
    $('#inspector-btn').addEventListener('click', () => toggleInspector());
    $('#settings-btn').addEventListener('click', () => openSettings());
    $('#index-status').addEventListener('click', (e) => { if (!e.target.closest('#settings-btn')) openSettings(state.status?.jev?.paused ? 'ai' : 'folders'); });

    $('#scope-bar').addEventListener('click', (e) => {
      const pill = e.target.closest('.scope-pill');
      if (pill) { state.searchIn = pill.dataset.scope === 'current' ? 'current' : 'all'; runSearch({ ai: true, keepIgnore: true }); return; }
      const chipBtn = e.target.closest('[data-chip]');
      if (chipBtn) { toggleChip(JSON.parse(chipBtn.dataset.chip)); return; }
      if (e.target.closest('[data-action="setup-ai"]')) openSettings('ai');
    });

    $('#list-header').addEventListener('click', (e) => {
      const col = e.target.closest('.col');
      if (col) setSort(col.dataset.sort);
    });
    let painting = false;
    $('#list-scroll').addEventListener('scroll', () => {
      if (painting) return;
      painting = true;
      requestAnimationFrame(() => { painting = false; paintRows(); });
    }, { passive: true });

    const content = $('#content');
    content.addEventListener('mousedown', (e) => {
      const el = e.target.closest('[data-i]');
      if (el) select(Number(el.dataset.i), { scroll: false });
    });
    content.addEventListener('dblclick', (e) => { if (e.target.closest('[data-i]')) act('open'); });
    content.addEventListener('contextmenu', async (e) => {
      const el = e.target.closest('[data-i]');
      if (!el) return;
      e.preventDefault();
      select(Number(el.dataset.i), { scroll: false });
      const choice = await api.contextMenu(currentItem().path);
      if (choice) act(choice);
    });
    content.addEventListener('dragstart', (e) => {
      const el = e.target.closest('[data-i]');
      if (!el) return;
      e.preventDefault();
      api.startDrag(state.items[Number(el.dataset.i)].path);
    });
    content.addEventListener('click', (e) => {
      const ex = e.target.closest('[data-example]');
      if (ex) { $('#search').value = ex.dataset.example; onSearchInput(); clearTimeout(aiTimer); runSearch({ ai: true }); return; }
      const a = e.target.closest('[data-action]');
      if (a?.dataset.action === 'open-settings') openSettings(a.dataset.tab);
    });

    $('#inspector').addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      if (b.dataset.action === 'setup-ai') openSettings('ai'); else act(b.dataset.action);
    });

    $('#ql-close').addEventListener('click', closeQuickLook);
    $('#ql-open').addEventListener('click', () => act('open'));
    $('#quicklook').addEventListener('mousedown', (e) => { if (e.target.id === 'quicklook') closeQuickLook(); });
    $('#sheet-backdrop').addEventListener('mousedown', (e) => { if (e.target.id === 'sheet-backdrop' && state.settings.firstRunDone) { commitKeys(); closeSheet(); refreshAll(); } });

    document.addEventListener('keydown', onKey);
    new ResizeObserver(() => { if (state.view === 'list' && state.items.length) renderList(); }).observe($('#content'));
    api.onStatus((s) => { state.status = s; renderStatus(); });
    api.onChanged(onChanged);
    api.onFocus((f) => document.body.classList.toggle('blurred', !f));
  }

  function onKey(e) {
    const mod = e.ctrlKey || e.metaKey;
    const inField = e.target.matches('input, textarea');
    const sheetOpen = !$('#sheet-backdrop').hidden;
    if (sheetOpen) {
      if (e.key === 'Escape' && state.settings.firstRunDone) { closeSheet(); refreshAll(); }
      return;
    }
    if (mod && (e.key === 'f' || e.key === 'k')) { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
    if (mod && e.key === ',') { e.preventDefault(); openSettings(); return; }
    if (mod && e.key === '1') { e.preventDefault(); setView('icons'); return; }
    if (mod && e.key === '2') { e.preventDefault(); setView('list'); return; }
    if (e.altKey && e.key === 'ArrowLeft') { $('#back-btn').click(); return; }
    if (e.altKey && e.key === 'ArrowRight') { $('#fwd-btn').click(); return; }
    if (inField) return;
    const ql = !$('#quicklook').hidden;
    if (e.key === 'Escape') { if (ql) closeQuickLook(); else if (state.query) { $('#search').value = ''; onSearchInput(); } return; }
    if (e.key === ' ') { e.preventDefault(); if (ql) closeQuickLook(); else openQuickLook(); return; }
    if (e.key === 'Enter') { e.preventDefault(); act('open'); return; }
    const perRow = state.view === 'icons' ? Math.max(1, Math.floor($('#icon-grid').clientWidth / 116)) : 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); select(state.sel < 0 ? 0 : state.sel + perRow); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); select(state.sel - perRow); }
    else if (e.key === 'ArrowRight' && state.view === 'icons') { e.preventDefault(); select(state.sel + 1); }
    else if (e.key === 'ArrowLeft' && state.view === 'icons') { e.preventDefault(); select(state.sel - 1); }
    else if (e.key === 'Home') select(0);
    else if (e.key === 'End') select(state.items.length - 1);
    else if (mod && e.key === 'c' && currentItem()) act('copy');
    else if (e.key.length === 1 && !mod && !e.altKey) { $('#search').focus(); }
  }

  function setView(v) {
    state.view = v;
    api.setSettings({ view: v });
    renderViews();
    if (state.sel >= 0) scrollToSelection();
  }

  function toggleInspector(force) {
    const show = force ?? document.body.classList.contains('no-inspector');
    document.body.classList.toggle('no-inspector', !show);
    $('#inspector-btn').classList.toggle('on', show);
    if (force === undefined) api.setSettings({ inspector: show });
    if (show) renderInspector();
    if (state.view === 'list' && state.items.length) renderList();
  }

  // ---------- start ----------

  async function start() {
    const init = await api.init();
    state.platform = init.platform;
    state.settings = init.settings;
    state.overview = init.overview;
    state.status = init.status;
    state.defaultRoots = init.defaultRoots;
    state.version = init.version;
    state.categories = init.categories;
    state.view = init.settings.view === 'icons' ? 'icons' : 'list';
    document.body.classList.add(init.platform === 'darwin' ? 'mac' : init.platform === 'win32' ? 'win' : 'linux');
    fillIcons();
    if (init.settings.demo) $('.brand').insertAdjacentHTML('beforeend', '<span class="pill-status warn" style="margin-left:2px">DEMO</span>');
    toggleInspector(init.settings.inspector !== false);
    bind();
    renderStatus();
    await loadBrowse();
    if (!init.settings.firstRunDone) openWelcome();
    else $('#search').focus();
  }

  start();
})();
