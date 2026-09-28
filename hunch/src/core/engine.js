// The engine: keeps the index, walks and watches folders, reads files, asks Jev to tag
// them, embeds them when OpenAI is set up, and answers searches. It has no Electron
// dependency, so tests and scripts can drive it directly.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { walk, skipFile, skipDir, isCloudPath } = require('./crawler');
const { kindOf, isReadable, isMedia, GROUPS } = require('./kinds');
const { extractText } = require('./extract');
const { parseQuery } = require('./query');
const { dateCandidates } = require('./dates');
const { Jev, JevError, estimateCost } = require('./jev');
const { Embedder, fileEmbeddingText, toBase64 } = require('./embeddings');
const { localCategory } = require('./local-tags');
const { search, browse, prepare, effectiveCategory } = require('./search');
const { CATEGORIES, DOC_TYPES } = require('./taxonomy');

const INDEX_VERSION = 1;
const RESCAN_MS = 30 * 60 * 1000;

const DEFAULT_SETTINGS = {
  roots: [],
  privateRoots: [],     // indexed, but never sent to any AI service
  jevMode: 'content',   // 'content' | 'names' | 'off'
  redact: true,
  embeddings: true,     // used only when an OpenAI key is set
  readCloudFiles: false,
  openrouterKey: '',
  openaiKey: '',
  jevModel: '',
};

class LruCache {
  constructor(max = 100) { this.max = max; this.map = new Map(); }
  get(k) { const v = this.map.get(k); if (v !== undefined) { this.map.delete(k); this.map.set(k, v); } return v; }
  set(k, v) { this.map.set(k, v); if (this.map.size > this.max) this.map.delete(this.map.keys().next().value); }
}

class Engine extends EventEmitter {
  /**
   * @param {{ indexPath: string, settings?: object, jevTransport?: Function, embedTransport?: Function, now?: () => Date }} opts
   */
  constructor({ indexPath, settings = {}, jevTransport = null, embedTransport = null, now = () => new Date() }) {
    super();
    this.indexPath = indexPath;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.jevTransport = jevTransport;
    this.embedTransport = embedTransport;
    this.now = now;
    this.records = new Map();
    this.queues = { read: new Set(), tag: new Set(), embed: new Set() };
    this.active = { read: 0, tag: 0, embed: 0 };
    this.phase = 'idle';
    this.scanning = false;
    this.pausedReason = null; // e.g. a bad API key stops tagging until settings change
    this.lastError = null;
    this.watchers = [];
    this.intentCache = new LruCache(200);
    this.vecCache = new LruCache(200);
    this.stopped = false;
    this.configureClients();
  }

  // ---------- setup ----------

  configureClients() {
    const s = this.settings;
    this.jev = (s.openrouterKey || this.jevTransport) && s.jevMode !== 'off'
      ? new Jev({ apiKey: s.openrouterKey, model: s.jevModel, transport: this.jevTransport }) : null;
    this.embedder = (s.openaiKey || this.embedTransport) && s.embeddings
      ? new Embedder({ apiKey: s.openaiKey, transport: this.embedTransport }) : null;
  }

  async load() {
    try {
      const data = JSON.parse(await fsp.readFile(this.indexPath, 'utf8'));
      if (data.version === INDEX_VERSION) for (const r of data.records) this.records.set(r.path, prepare(r));
    } catch { /* first run or unreadable index: start empty */ }
    return this;
  }

  async start() {
    await this.load();
    this.emitChanged();
    this.resumeWork();
    this.rescan();
    this.watchRoots();
    this.rescanTimer = setInterval(() => this.rescan(), RESCAN_MS);
    this.rescanTimer.unref?.();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.rescanTimer);
    this.unwatch();
    await this.save();
  }

  updateSettings(patch) {
    const before = this.settings;
    this.settings = { ...before, ...patch };
    this.pausedReason = null;
    this.pausedEmbed = null;
    this.intentCache = new LruCache(200);
    this.vecCache = new LruCache(200);
    this.configureClients();
    const rootsChanged = JSON.stringify(before.roots) !== JSON.stringify(this.settings.roots);
    if (rootsChanged) {
      // Forget files outside the chosen folders, then look at the new ones.
      for (const p of [...this.records.keys()]) if (!this.rootOf(p)) this.records.delete(p);
      this.unwatch();
      this.watchRoots();
      this.rescan();
    } else {
      this.resumeWork();
    }
    this.emitChanged();
    this.emitStatus();
  }

  rootOf(p) {
    const roots = [...this.settings.roots].sort((a, b) => b.length - a.length);
    return roots.find((r) => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) ?? null;
  }

  isPrivate(p) {
    return this.settings.privateRoots.some((r) => p === r || p.startsWith(r.endsWith(path.sep) ? r : r + path.sep));
  }

  // ---------- scanning ----------

  async rescan() {
    if (this.scanning) { this.rescanAgain = true; return; }
    this.scanning = true;
    this.emitStatus();
    const seen = new Set();
    try {
      for (const root of this.settings.roots) {
        for await (const f of walk(root, { shouldStop: () => this.stopped })) {
          seen.add(f.path);
          this.upsert(f, root);
        }
      }
      for (const p of [...this.records.keys()]) {
        if (!seen.has(p) && !this.stopped) {
          // Only drop files we are sure are gone (a folder may be temporarily unreadable).
          try { await fsp.access(p); } catch { this.remove(p); }
        }
      }
    } finally {
      this.scanning = false;
      this.emitChanged();
      this.emitStatus();
      this.scheduleSave();
      this.pump();
    }
    if (this.rescanAgain) { this.rescanAgain = false; this.rescan(); }
  }

  upsert(f, root = this.rootOf(f.path)) {
    if (!root) return;
    const old = this.records.get(f.path);
    if (old && old.size === f.size && old.mtime === f.mtime) return;
    const name = path.basename(f.path);
    const kind = kindOf(name);
    const rel = path.relative(path.dirname(root), path.dirname(f.path));
    const rec = {
      path: f.path, name, ext: kind.ext, group: kind.group, kindLabel: kind.label,
      root, folder: rel.split(path.sep).join('/'), size: f.size, mtime: f.mtime, ctime: f.ctime,
      text: '', title: '', readAt: null, jev: null, local: null, vec: null,
    };
    rec.local = localCategory(rec);
    this.records.set(f.path, prepare(rec));
    if (isReadable(rec.ext) && (this.settings.readCloudFiles || !isCloudPath(f.path))) this.queues.read.add(f.path);
    else this.afterRead(rec);
    this.dirty = true;
    this.pump();
  }

  remove(p) {
    if (this.records.delete(p)) {
      for (const q of Object.values(this.queues)) q.delete(p);
      this.dirty = true;
    }
  }

  watchRoots() {
    for (const root of this.settings.roots) {
      try {
        const w = fs.watch(root, { recursive: true }, (_evt, filename) => {
          if (filename) this.touch(path.join(root, filename.toString()));
        });
        w.on('error', () => {});
        this.watchers.push(w);
      } catch { /* recursive watch unsupported: the periodic rescan covers it */ }
    }
  }

  unwatch() {
    for (const w of this.watchers) w.close();
    this.watchers = [];
  }

  // Watch events arrive in bursts; look at each path once things settle.
  touch(p) {
    this.touched ??= new Set();
    this.touched.add(p);
    clearTimeout(this.touchTimer);
    this.touchTimer = setTimeout(() => this.flushTouched(), 1200);
  }

  async flushTouched() {
    const paths = [...this.touched];
    this.touched.clear();
    for (const p of paths) {
      const root = this.rootOf(p);
      if (!root) continue;
      const parts = path.relative(root, p).split(path.sep);
      if (parts.slice(0, -1).some((s) => skipDir(s)) || skipFile(path.basename(p))) continue;
      let st;
      try { st = await fsp.stat(p); } catch {
        // Gone: a file, or a whole folder.
        this.remove(p);
        const prefix = p + path.sep;
        for (const k of [...this.records.keys()]) if (k.startsWith(prefix)) this.remove(k);
        continue;
      }
      if (st.isDirectory()) {
        for await (const f of walk(p)) this.upsert(f);
      } else if (st.isFile()) {
        this.upsert({ path: p, size: st.size, mtime: Math.round(st.mtimeMs), ctime: Math.round(st.birthtimeMs || st.ctimeMs) });
      }
    }
    this.emitChanged();
    this.scheduleSave();
  }

  // ---------- work queues ----------

  canTag(rec) {
    return this.jev && !this.pausedReason && !isMedia(rec.group) && !this.isPrivate(rec.path);
  }

  afterRead(rec) {
    if (!rec.jev && this.canTag(rec)) this.queues.tag.add(rec.path);
    else if (!rec.vec && this.embedder && !this.isPrivate(rec.path)) this.queues.embed.add(rec.path);
  }

  /** Queue whatever each record still needs: reading, tagging or embedding. */
  resumeWork() {
    for (const r of this.records.values()) {
      if (r.readAt === null && isReadable(r.ext) && (this.settings.readCloudFiles || !isCloudPath(r.path))) this.queues.read.add(r.path);
      else this.afterRead(r);
    }
    this.pump();
  }

  pump() {
    if (this.stopped) return;
    const take = (q) => { const p = q.values().next().value; q.delete(p); return this.records.get(p); };
    while (this.queues.read.size && this.active.read < 2) {
      const rec = take(this.queues.read);
      if (rec) this.run('read', () => this.readOne(rec));
    }
    while (this.queues.tag.size && this.active.tag < 4 && this.jev && !this.pausedReason) {
      const rec = take(this.queues.tag);
      if (rec) this.run('tag', () => this.tagOne(rec));
    }
    if (this.queues.embed.size && this.active.embed < 1 && this.embedder && !this.pausedEmbed) {
      const batch = [];
      while (this.queues.embed.size && batch.length < 64) { const r = take(this.queues.embed); if (r) batch.push(r); }
      if (batch.length) this.run('embed', () => this.embedBatch(batch));
    }
    this.emitStatus();
  }

  run(kind, fn) {
    this.active[kind]++;
    fn().catch((err) => { this.lastError = err.message; })
      .finally(() => {
        this.active[kind]--;
        this.dirty = true;
        this.scheduleSave();
        this.emitChanged();
        this.pump();
      });
  }

  async readOne(rec) {
    if (this.records.get(rec.path) !== rec) return; // replaced meanwhile
    try {
      const r = await extractText(rec.path, rec.ext, rec.size);
      rec.text = r.text;
      rec.title = r.title;
      if (r.skipped) rec.readError = r.skipped;
    } catch (err) {
      rec.readError = err.message;
    }
    rec.readAt = Date.now();
    rec.local = localCategory(rec);
    prepare(rec);
    this.afterRead(rec);
  }

  async tagOne(rec) {
    if (this.records.get(rec.path) !== rec || !this.jev) return;
    const namesOnly = this.settings.jevMode === 'names';
    try {
      rec.jev = await this.jev.tagFile(rec, { namesOnly, redactValues: this.settings.redact, dates: namesOnly ? [] : dateCandidates(rec.text ?? '', this.now()) });
      delete rec.jevError;
      prepare(rec);
      if (!rec.vec && this.embedder && !this.isPrivate(rec.path)) this.queues.embed.add(rec.path);
    } catch (err) {
      if (err instanceof JevError && ['bad_key', 'no_credit', 'no_key'].includes(err.code)) {
        this.pausedReason = err.code === 'no_credit' ? 'Your OpenRouter account is out of credit.' : 'OpenRouter did not accept the API key.';
        this.queues.tag.add(rec.path);
      } else {
        rec.jevError = err.message;
      }
      this.lastError = err.message;
    }
  }

  async embedBatch(batch) {
    const live = batch.filter((r) => this.records.get(r.path) === r);
    if (!live.length) return;
    try {
      const vecs = await this.embedder.embed(live.map(fileEmbeddingText));
      live.forEach((r, i) => { r.vec = toBase64(vecs[i]); r.vecModel = this.embedder.model; prepare(r); });
    } catch (err) {
      this.lastError = err.message;
      if (/HTTP 40[12]/.test(err.message)) this.pausedEmbed = 'OpenAI did not accept the API key.';
      else live.forEach((r) => this.queues.embed.add(r.path));
      if (!this.pausedEmbed) await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // ---------- persistence ----------

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 3000);
    this.saveTimer.unref?.();
  }

  async save() {
    if (!this.dirty) return;
    this.dirty = false;
    const records = [...this.records.values()].map((r) => {
      const o = {};
      for (const [k, v] of Object.entries(r)) if (!k.startsWith('_')) o[k] = v;
      return o;
    });
    const tmp = `${this.indexPath}.tmp`;
    await fsp.mkdir(path.dirname(this.indexPath), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify({ version: INDEX_VERSION, savedAt: Date.now(), records }));
    await fsp.rename(tmp, this.indexPath);
  }

  // ---------- status & events ----------

  status() {
    const recs = [...this.records.values()];
    const tagEligible = this.settings.jevMode !== 'off' ? recs.filter((r) => !isMedia(r.group) && !this.isPrivate(r.path)) : [];
    const pendingTag = tagEligible.filter((r) => !r.jev);
    let phase = 'idle';
    if (this.scanning) phase = 'scanning';
    else if (this.queues.read.size || this.active.read) phase = 'reading';
    else if (this.jev && !this.pausedReason && (this.queues.tag.size || this.active.tag)) phase = 'tagging';
    else if (this.embedder && !this.pausedEmbed && (this.queues.embed.size || this.active.embed)) phase = 'embedding';
    return {
      phase,
      files: recs.length,
      toRead: this.queues.read.size + this.active.read,
      tagged: tagEligible.length - pendingTag.length,
      tagEligible: tagEligible.length,
      toTag: this.queues.tag.size + this.active.tag,
      embedded: recs.filter((r) => r.vec).length,
      toEmbed: this.queues.embed.size + this.active.embed,
      jev: { enabled: !!this.jev, paused: this.pausedReason, usage: this.jev?.usage ?? null },
      embeddings: { enabled: !!this.embedder, paused: this.pausedEmbed ?? null },
      estimate: this.jev ? estimateCost(pendingTag.length, pendingTag.reduce((n, r) => n + Math.min(5000, r.text?.length ?? 0), 0)) : 0,
      lastError: this.lastError,
    };
  }

  emitStatus() {
    if (this.statusTimer) return;
    this.statusTimer = setTimeout(() => { this.statusTimer = null; this.emit('status', this.status()); }, 250);
  }

  emitChanged() {
    if (this.changedTimer) return;
    this.changedTimer = setTimeout(() => { this.changedTimer = null; this.emit('changed'); }, 800);
  }

  // ---------- queries ----------

  overview() {
    const recs = [...this.records.values()];
    const count = (fn) => { const m = {}; for (const r of recs) { const k = fn(r); if (k) m[k] = (m[k] ?? 0) + 1; } return m; };
    const byRoot = count((r) => r.root);
    const byCat = count((r) => effectiveCategory(r)?.id);
    const byKind = count((r) => r.group);
    return {
      total: recs.length,
      roots: this.settings.roots.map((p) => ({ id: p, name: path.basename(p) || p, path: p, count: byRoot[p] ?? 0, private: this.isPrivate(p) })),
      categories: Object.entries(CATEGORIES).filter(([id]) => byCat[id]).map(([id, c]) => ({ id, label: c.label, color: c.color, count: byCat[id] })),
      kinds: Object.entries(GROUPS).filter(([id]) => byKind[id]).map(([id, label]) => ({ id, label, count: byKind[id] })),
      tags: {
        important: recs.filter((r) => (r.jev?.important ?? 0) >= 0.6).length,
        sensitive: recs.filter((r) => (r.jev?.sensitive ?? 0) >= 0.6).length,
      },
    };
  }

  browse(scope) {
    const out = browse([...this.records.values()], scope);
    return { total: out.total, results: out.results.map((x) => this.dto(x)) };
  }

  /**
   * @param {{ text: string, scope?: object, ai?: boolean, ignore?: string[] }} q
   * `ai` asks Jev (and OpenAI) to read the description; without it the search is local and instant.
   */
  async query({ text, scope = null, ai = false, ignore = [] }) {
    const t0 = Date.now();
    const parsed = parseQuery(text, this.now());
    const aiInfo = { used: false, error: null };
    let intent = null;
    let queryVec = null;
    if (ai && text.trim().length > 2) {
      const tasks = [];
      if (this.jev && !this.pausedReason) {
        tasks.push(this.cached(this.intentCache, text.trim().toLowerCase(), () => this.jev.readQuery(text, this.now()))
          .then((v) => { intent = v; aiInfo.used = true; }).catch((e) => { aiInfo.error = e.message; }));
      }
      if (this.embedder && !this.pausedEmbed && !ignore.includes('meaning') && this.hasVectors()) {
        tasks.push(this.cached(this.vecCache, text.trim().toLowerCase(), async () => (await this.embedder.embed([text]))[0])
          .then((v) => { queryVec = v; aiInfo.used = true; }).catch((e) => { aiInfo.error = e.message; }));
      }
      await Promise.race([Promise.all(tasks), new Promise((r) => setTimeout(r, 6000))]);
    }

    // The user can switch off any part of the interpretation by removing its chip.
    if (ignore.includes('when')) parsed.when = null;
    if (ignore.includes('folder')) parsed.folder = null;
    if (ignore.includes('kind')) { parsed.kinds = []; parsed.hint = null; }
    if (intent) intent = { categories: { ...intent.categories }, kinds: ignore.includes('kind') ? {} : { ...intent.kinds } };
    for (const ig of ignore) {
      if (!ig.startsWith('category:')) continue;
      const id = ig.slice(9);
      delete parsed.categories[id];
      if (intent) delete intent.categories[id];
    }

    const chips = parsed.chips.filter((c) => !(c.type === 'category' && ignore.includes(`category:${c.id}`)) && !ignore.includes(c.type === 'category' ? `category:${c.id}` : c.type));
    if (intent) {
      for (const [id, p] of Object.entries(intent.categories)) {
        if (p >= 0.35 && !parsed.categories[id]) chips.push({ type: 'category', id, label: CATEGORIES[id].label, source: 'jev', confidence: p });
      }
    }
    if (queryVec) chips.push({ type: 'meaning', id: 'meaning', label: 'Similar meaning', source: 'openai' });

    const out = search([...this.records.values()], parsed, { intent, queryVec, scope });
    return {
      text,
      chips,
      total: out.total,
      results: out.results.map((x) => this.dto(x)),
      ms: Date.now() - t0,
      ai: aiInfo,
    };
  }

  hasVectors() {
    for (const r of this.records.values()) if (r._vec) return true;
    return false;
  }

  async cached(cache, key, fn) {
    const hit = cache.get(key);
    if (hit) return hit;
    const p = fn();
    cache.set(key, p);
    p.catch(() => cache.map.delete(key));
    return p;
  }

  dto({ rec: r, score = 0, reasons = [], snippet = null }) {
    const cat = effectiveCategory(r);
    return {
      path: r.path, name: r.name, ext: r.ext, group: r.group, kindLabel: r.kindLabel,
      size: r.size, mtime: r.mtime, ctime: r.ctime, folder: r.folder, root: r.root,
      category: cat ? { id: cat.id, label: CATEGORIES[cat.id]?.label ?? cat.id, color: CATEGORIES[cat.id]?.color, confidence: cat.confidence, local: !!cat.local } : null,
      doctype: r.jev?.doctype?.id ?? null,
      important: (r.jev?.important ?? 0) >= 0.6,
      sensitive: (r.jev?.sensitive ?? 0) >= 0.6,
      docDate: r.jev?.docDate ?? null,
      score, reasons, snippet,
    };
  }

  details(p) {
    const r = this.records.get(p);
    if (!r) return null;
    return {
      ...this.dto({ rec: r }),
      title: r.title,
      text: (r.text ?? '').slice(0, 4000),
      readError: r.readError ?? null,
      jev: r.jev ? {
        category: r.jev.category, doctype: r.jev.doctype, doctypeLabel: DOC_TYPES[r.jev.doctype?.id]?.label ?? null,
        important: r.jev.important, sensitive: r.jev.sensitive, docDate: r.jev.docDate, model: r.jev.model, at: r.jev.at,
      } : null,
      jevError: r.jevError ?? null,
      private: this.isPrivate(r.path),
      cloudSkipped: !this.settings.readCloudFiles && isCloudPath(r.path) && isReadable(r.ext),
      embedded: !!r.vec,
    };
  }

  /** Re-tag everything with Jev (e.g. after switching from names-only to content). */
  retagAll() {
    for (const r of this.records.values()) { r.jev = null; prepare(r); }
    this.pausedReason = null;
    this.resumeWork();
    this.emitChanged();
  }
}

module.exports = { Engine, DEFAULT_SETTINGS };
