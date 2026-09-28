const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { parseWhen, dateCandidates } = require('../src/core/dates');
const { parseQuery } = require('../src/core/query');
const { countMatches } = require('../src/core/search');
const { extractText } = require('../src/core/extract');
const { redact, buildFileRequest, interpretQuery } = require('../src/core/jev');
const { Engine } = require('../src/core/engine');
const { createDemoFiles, fakeJevTransport, docx, xlsx, pdf } = require('../src/core/demo');

const NOW = new Date('2026-09-28T12:00:00');
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('vague dates become ranges', () => {
  const spring = parseWhen('from last spring', NOW);
  assert.equal(localDay(spring.from), '2026-03-01');
  assert.equal(localDay(spring.to), '2026-05-31');

  const march = parseWhen('the letter from last march', NOW);
  assert.equal(localDay(march.from), '2026-03-01');

  const y = parseWhen('taxes 2023', NOW);
  assert.equal(y.label, '2023');

  assert.equal(parseWhen('it may be somewhere', NOW), null, '"may" alone is not a month');
  assert.equal(localDay(parseWhen('in may', NOW).from), '2026-05-01');

  const summer = parseWhen('summer 2024 photos', NOW);
  assert.equal(localDay(summer.from), '2024-06-01');
  assert.equal(localDay(summer.to), '2024-08-31');

  const few = parseWhen('a few months ago', NOW);
  assert.ok(few.from < NOW.getTime() - 60 * 86400000 && few.to < NOW.getTime() - 20 * 86400000, 'a few months ago is well in the past');

  const xmas = parseWhen('around christmas', NOW);
  assert.equal(localDay(xmas.from), '2025-12-15');

  const winter = parseWhen('last winter', NOW);
  assert.equal(localDay(winter.from), '2025-12-01');
  assert.equal(localDay(winter.to), '2026-02-28');
});

test('query parser pulls out kinds, dates, areas and keywords', () => {
  const q = parseQuery('that spreadsheet about the trip budget from last spring', NOW);
  assert.deepEqual(q.kinds, ['spreadsheet']);
  assert.deepEqual(q.terms, ['trip', 'budget']);
  assert.ok(q.categories.travel && q.categories.money);
  assert.equal(q.when.label, 'Spring 2026');

  const s = parseQuery('screenshot of the error in my downloads', NOW);
  assert.equal(s.hint, 'screenshot');
  assert.equal(s.folder, 'downloads');
  assert.deepEqual(s.terms, ['error']);

  const quoted = parseQuery('"booking reference" pdf', NOW);
  assert.deepEqual(quoted.phrases, ['booking reference']);
  assert.deepEqual(quoted.kinds, ['pdf']);
});

test('word matching allows plurals but not other words', () => {
  assert.equal(countMatches('two cars parked', 'car'), 1);
  assert.equal(countMatches('credit card', 'car'), 0);
  assert.equal(countMatches('insurance policies', 'policy'), 1);
  assert.equal(countMatches('the invoices', 'invoice'), 1);
  assert.equal(countMatches('領収書 ビックカメラ', '領収書'), 1);
});

test('dates written in documents are found', () => {
  const found = dateCandidates('Invoice date: March 14, 2026. Due 2026/04/13. 令和6年3月14日', NOW).map((d) => d.value);
  assert.deepEqual(found, ['2026-03-14', '2026-04-13', '2024-03-14']);
});

test('redaction hides emails, card numbers and secrets', () => {
  const out = redact('mail colin@example.com card 4111 1111 1111 1111 password: hunter2');
  assert.match(out, /\[email at example\.com\]/);
  assert.match(out, /\[CARD OR ACCOUNT NUMBER\]/);
  assert.match(out, /password: \[SECRET\]/);
  assert.doesNotMatch(out, /hunter2|4111/);
});

test('names-only requests carry no content', () => {
  const rec = { name: 'Bank statement.pdf', folder: 'Documents/Money', kindLabel: 'PDF document', mtime: NOW.getTime(), text: 'Account 1234 balance' };
  const { state } = buildFileRequest(rec, { namesOnly: true });
  assert.doesNotMatch(JSON.stringify(state), /balance/);
});

test('query intent keeps confident areas only', () => {
  const intent = interpretQuery({
    category: { choice: 'travel', probabilities: { travel: 0.7, money: 0.2, any: 0.1 } },
    kind: { choice: 'spreadsheet', probabilities: { spreadsheet: 0.8, any: 0.2 } },
  });
  assert.deepEqual(intent.categories, { travel: 0.7, money: 0.2 });
  assert.deepEqual(intent.kinds, { spreadsheet: 0.8 });
});

test('text comes out of docx, xlsx and pdf', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hunch-x-'));
  await fs.writeFile(path.join(dir, 'a.docx'), docx(['Hello lease', 'Second line'], 'My title'));
  await fs.writeFile(path.join(dir, 'b.xlsx'), xlsx('Budget', [['Item', 'Cost'], ['Hotel', 46000]]));
  await fs.writeFile(path.join(dir, 'c.pdf'), pdf(['Booking confirmation', 'Seat 23A']));
  const a = await extractText(path.join(dir, 'a.docx'), 'docx', 1000);
  assert.match(a.text, /Hello lease\nSecond line/);
  assert.equal(a.title, 'My title');
  const b = await extractText(path.join(dir, 'b.xlsx'), 'xlsx', 1000);
  assert.match(b.text, /Hotel\t46000/);
  const c = await extractText(path.join(dir, 'c.pdf'), 'pdf', 1000);
  assert.match(c.text, /Booking confirmation/);
  await fs.rm(dir, { recursive: true });
});

async function demoEngine(extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hunch-e-'));
  const roots = await createDemoFiles(path.join(dir, 'files'));
  const log = [];
  const engine = new Engine({
    indexPath: path.join(dir, 'index.json'),
    settings: { roots, ...extra },
    jevTransport: fakeJevTransport({ log }),
    now: () => NOW,
  });
  await engine.start();
  await waitIdle(engine);
  return { engine, dir, log, roots };
}

async function waitIdle(engine, timeout = 20000) {
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 100));
  while (Date.now() - t0 < timeout) {
    const s = engine.status();
    if (s.phase === 'idle' && s.toRead === 0 && s.toTag === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`engine not idle: ${JSON.stringify(engine.status())}`);
}

test('engine indexes, tags and finds files from vague descriptions', async () => {
  const { engine, dir } = await demoEngine();
  try {
    const st = engine.status();
    assert.equal(st.files, 33);
    assert.equal(st.tagged, st.tagEligible, 'every non-media file was tagged');

    const top = async (text, ai = true) => (await engine.query({ text, ai })).results[0]?.name;
    assert.equal(await top('that spreadsheet about the trip budget from last spring'), 'Kyoto trip budget.xlsx');
    assert.equal(await top('car insurance renewal'), 'Car insurance renewal 2026.pdf');
    assert.equal(await top('ダイソン 掃除機'), '領収書_ビックカメラ.docx');
    const vacuum = await engine.query({ text: 'receipt for the vacuum cleaner', ai: true });
    assert.ok(vacuum.results.slice(0, 3).some((r) => r.name === '領収書_ビックカメラ.docx'), 'an English description finds the Japanese receipt through its tag');
    assert.equal(await top('the lease for my apartment'), 'Apartment lease agreement.docx');
    assert.equal(await top('essay about integration and meaning-making'), 'Transpersonal psychology essay - integration.docx');
    assert.equal(await top('screenshot from last week'), 'Screenshot 2026-09-20 101512.png');

    const photos = await engine.query({ text: 'photos from the kyoto trip' });
    assert.ok(photos.results.slice(0, 3).every((r) => r.group === 'image' && r.folder.includes('Kyoto')), 'Kyoto photos come first');

    const bills = await engine.query({ text: 'bills from this summer' });
    assert.ok(bills.chips.some((c) => c.type === 'when'));
    assert.ok(bills.results.some((r) => r.name === 'Electricity bill July 2026.pdf'));

    // Removing the date chip drops the date filter.
    const all = await engine.query({ text: 'bills from 2019', ignore: ['when'] });
    assert.ok(all.results.length > 0);
    assert.equal((await engine.query({ text: 'bills from 2019' })).results.length, 0);

    const lease = engine.details(engine.browse({ type: 'category', id: 'home' }).results.find((r) => r.name.startsWith('Apartment')).path);
    assert.equal(lease.jev.docDate, '2025-04-01', 'first written date chosen by the (fake) Jev');
    assert.ok(lease.important);

    const ov = engine.overview();
    assert.equal(ov.roots.length, 4);
    assert.ok(ov.categories.find((c) => c.id === 'travel').count >= 2);
  } finally {
    await engine.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('private folders never reach Jev, and names-only mode sends no text', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hunch-p-'));
  const roots = await createDemoFiles(path.join(dir, 'files'));
  const log = [];
  const engine = new Engine({
    indexPath: path.join(dir, 'index.json'),
    settings: { roots, privateRoots: [path.join(roots[0], 'Health'), path.join(roots[0], 'IDs')], jevMode: 'names' },
    jevTransport: fakeJevTransport({ log }),
    now: () => NOW,
  });
  try {
    await engine.start();
    await waitIdle(engine);
    const names = log.filter((b) => b.state.file).map((b) => b.state.file.name).join('\n');
    const sent = JSON.stringify(log.map((b) => b.state));
    assert.doesNotMatch(names, /Blood test|Residence card|Passport/i, 'private folders stay local');
    assert.doesNotMatch(sent, /Tokio Marine|Shinkansen/, 'names-only sends no content');
    assert.match(names, /Car insurance renewal/, 'but names do go');
    // Private files are still searchable locally.
    const r = await engine.query({ text: 'blood test' });
    assert.equal(r.results[0]?.name, 'Blood test results.pdf');
  } finally {
    await engine.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('index survives a restart and picks up new and deleted files', async () => {
  const { engine, dir, roots } = await demoEngine();
  await engine.stop();
  const again = new Engine({ indexPath: path.join(dir, 'index.json'), settings: { roots }, jevTransport: fakeJevTransport(), now: () => NOW });
  try {
    await again.load();
    assert.equal(again.records.size, 33);
    assert.ok([...again.records.values()].filter((r) => r.jev).length > 20, 'tags were saved');
    await fs.writeFile(path.join(roots[0], 'new note about the garden.txt'), 'Tomatoes and basil on the balcony');
    await fs.rm(path.join(roots[1], 'todo.txt'));
    await again.rescan();
    await waitIdle(again);
    assert.equal(again.records.size, 33);
    assert.equal((await again.query({ text: 'garden tomatoes' })).results[0]?.name, 'new note about the garden.txt');
  } finally {
    await again.stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
