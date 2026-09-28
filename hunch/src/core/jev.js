// Client for TypeSafe's Jev decision model, served by OpenRouter.
//
// Jev is not a chat model: you send a `state` (the data) and named `questions`
// ("choice" picks one of your options, "noul" is a yes/no probability), and it
// returns typed answers with probabilities. Endpoint and request shape follow
// OpenRouter's /api/alpha/decisions API, as used by nexibeo/jev-organize.
const { CATEGORIES, DOC_TYPES } = require('./taxonomy');
const { GROUPS } = require('./kinds');

const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const DEFAULT_MODEL = '~typesafe/jev-latest'; // the tilde is part of the id
const PRICE_PER_M_INPUT = 0.042; // USD, Jev 1.13 on OpenRouter, Sept 2026; used for estimates only
const RETRY = new Set([408, 429, 500, 502, 503, 524, 529]);
const MAX_CONTENT = 5000;

class JevError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
const noul = (instructions) => ({ type: 'noul', instructions });

/** Sorted [[option, probability], ...] of a choice answer, best first. */
const ranked = (answer) => Object.entries(answer?.probabilities ?? {}).sort((a, b) => b[1] - a[1]);

// Masks values nobody needs to send to a classifier.
function redact(text) {
  return text
    .replace(/[\w.+-]+@([\w-]+\.)+[\w-]{2,}/g, (m) => `[email at ${m.split('@')[1]}]`)
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[CARD OR ACCOUNT NUMBER]')
    .replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b/g, '[IBAN]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ID NUMBER]')
    .replace(/(?:\+|\b)\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/g, '[PHONE]')
    .replace(/\b(?:password|passcode|pin|api[_ -]?key|secret|token)\b\s*[:=]\s*\S+/gi, (m) => `${m.split(/[:=]/)[0]}: [SECRET]`);
}

function clip(text, max) {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.75);
  return `${text.slice(0, head)}\n[... skipped ...]\n${text.slice(-(max - head))}`;
}

const describe = (obj) => Object.fromEntries(Object.entries(obj).map(([id, v]) => [id, typeof v === 'string' ? v : v.description]));

class Jev {
  /**
   * @param {{ apiKey: string, model?: string, transport?: (body) => Promise<{status:number,json:any,text?:string}> }} opts
   * `transport` replaces the network (tests and the offline demo use it).
   */
  constructor({ apiKey, model = DEFAULT_MODEL, transport = null }) {
    this.apiKey = apiKey;
    this.model = model || DEFAULT_MODEL;
    this.transport = transport;
    this.usage = { calls: 0, inputTokens: 0, cost: 0 };
  }

  async post(body) {
    if (this.transport) return this.transport(body);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Hunch file finder',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep text for the error */ }
    return { status: res.status, json, text };
  }

  /** Ask Jev. Returns the answers map keyed by question id. */
  async ask(state, questions, { retries = 3 } = {}) {
    if (!this.apiKey && !this.transport) throw new JevError('No OpenRouter API key set', 0, 'no_key');
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await this.post({ model: this.model, state, questions });
      } catch (err) {
        if (attempt < retries && err.name !== 'TimeoutError') { await sleep(400 * 2 ** attempt); continue; }
        throw new JevError(`Could not reach OpenRouter: ${err.message}`, 0, 'network');
      }
      if (RETRY.has(res.status) && attempt < retries) { await sleep(600 * 2 ** attempt); continue; }
      if (res.status < 200 || res.status >= 300) {
        const detail = res.json?.error?.message ?? res.json?.error ?? res.text ?? '';
        const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
        const code = res.status === 401 ? 'bad_key' : res.status === 402 ? 'no_credit' : /context|too (long|large)|max_tokens/i.test(text) ? 'too_large' : `http_${res.status}`;
        throw new JevError(`Jev HTTP ${res.status}: ${text.slice(0, 200)}`, res.status, code);
      }
      this.usage.calls++;
      this.usage.inputTokens += res.json?.usage?.input_tokens ?? 0;
      this.usage.cost += res.json?.usage?.cost ?? 0;
      return { answers: res.json?.answers ?? {}, model: res.json?.model ?? this.model };
    }
  }

  /**
   * Tag one file. `file` is an index record; `opts.namesOnly` sends no content.
   * Returns the `jev` field stored on the record.
   */
  async tagFile(file, { namesOnly = false, redactValues = true, dates = [] } = {}) {
    let maxChars = MAX_CONTENT;
    for (let attempt = 0; ; attempt++) {
      const { state, questions } = buildFileRequest(file, { namesOnly, redactValues, dates, maxChars });
      try {
        const { answers, model } = await this.ask(state, questions);
        return interpretFile(answers, dates, model);
      } catch (err) {
        if (err instanceof JevError && (err.code === 'too_large' || err.status === 400) && attempt < 2 && maxChars > 800) {
          maxChars = Math.floor(maxChars / 3);
          continue;
        }
        throw err;
      }
    }
  }

  /** Read a search description: which area of life and which kind of file it points at. */
  async readQuery(text, now = new Date()) {
    const { state, questions } = buildQueryRequest(text, now);
    const { answers } = await this.ask(state, questions, { retries: 1 });
    return interpretQuery(answers);
  }
}

function buildFileRequest(file, { namesOnly = false, redactValues = true, dates = [], maxChars = MAX_CONTENT } = {}) {
  const raw = namesOnly ? '' : (file.text ?? '');
  const content = raw.trim() ? clip(redactValues ? redact(raw) : raw, maxChars) : '';
  const state = {
    file: {
      name: file.name,
      folder: file.folder,
      kind: file.kindLabel,
      modified: new Date(file.mtime).toISOString().slice(0, 10),
      ...(file.title ? { title: file.title } : {}),
    },
    content: content || (namesOnly
      ? '(content not sent: judge from the file name and folder only)'
      : `(no readable text in this ${file.kindLabel}: judge from the file name and folder only)`),
    ...(content && redactValues ? { note: 'Sensitive values in `content` were replaced by placeholders such as [email at domain], [PHONE] or [SECRET] before sending.' } : {}),
  };
  const judge = 'These are one person\'s own files on their home PC. Judge mainly by `content`; the name and folder are hints and can be misleading.';
  const questions = {
    category: choice({ task: 'Which area of the owner\'s life does this file belong to?', note: judge }, describe(CATEGORIES)),
    doctype: choice({ task: 'What kind of document or file is it?', note: judge }, describe(DOC_TYPES)),
    important: noul('This is an important record worth keeping safe and hard to replace: an ID, certificate, contract, lease, tax return, insurance policy, deed, diploma or similar official document.'),
    sensitive: noul('`content` holds sensitive personal data: account or card numbers, ID numbers, medical details, salary, passwords, or a [SECRET], [IBAN] or [CARD OR ACCOUNT NUMBER] placeholder.'),
  };
  if (dates.length && content) {
    questions.date = choice(
      'Which date is the date of the document itself: when it was written, issued, sent, signed or when the event it records happened (a purchase, a trip, a visit)? Not a due date, a birth date or a date mentioned in passing. If none of them is, choose none.',
      Object.fromEntries([...dates.map((d, i) => [`d${i}`, `${d.value} (written as "${d.raw}")`]), ['none', 'None of these is the document\'s own date']]),
    );
  }
  return { state, questions };
}

const round = (x) => Math.round((x ?? 0) * 1000) / 1000;

function interpretFile(answers, dates, model) {
  const top = (a) => {
    const r = ranked(a);
    return { id: a?.choice ?? r[0]?.[0] ?? 'other', confidence: round(a?.confidence ?? r[0]?.[1]), probs: Object.fromEntries(r.slice(0, 3).map(([k, v]) => [k, round(v)])) };
  };
  const d = answers.date;
  const docDate = d && d.choice && d.choice !== 'none' ? dates[Number(d.choice.slice(1))]?.value ?? null : null;
  return {
    category: top(answers.category),
    doctype: top(answers.doctype),
    important: round(answers.important?.noul),
    sensitive: round(answers.sensitive?.noul),
    docDate,
    model,
    at: Date.now(),
  };
}

const QUERY_KINDS = {
  document: 'A written document (Word, PDF or similar)',
  spreadsheet: 'A spreadsheet or table',
  presentation: 'A slide presentation',
  image: 'A photo, picture, scan or screenshot',
  video: 'A video',
  audio: 'Music or an audio recording',
  archive: 'A zip or other archive',
  code: 'Code or a configuration file',
  installer: 'An app or installer',
  any: 'Not clear from the description',
};

function buildQueryRequest(text, now = new Date()) {
  const cats = describe(CATEGORIES);
  delete cats.other;
  return {
    state: { search: text, today: now.toISOString().slice(0, 10), context: 'A person is describing one of their own files on their home PC, from memory, to find it again.' },
    questions: {
      category: choice('Which area of life is the file they describe most likely about? Choose any if the description gives no clue.', { ...cats, any: 'No clue in the description' }),
      kind: choice('What kind of file are they looking for?', QUERY_KINDS),
    },
  };
}

function interpretQuery(answers) {
  const categories = {};
  for (const [id, p] of ranked(answers.category)) {
    if (id !== 'any' && p >= 0.12) categories[id] = round(p);
  }
  // A confident "no clue" wipes weak guesses.
  if ((answers.category?.probabilities?.any ?? 0) > 0.5) for (const k of Object.keys(categories)) if (categories[k] < 0.4) delete categories[k];
  const kinds = {};
  for (const [id, p] of ranked(answers.kind)) if (id !== 'any' && p >= 0.2 && GROUPS[id]) kinds[id] = round(p);
  return { categories, kinds };
}

/** Rough cost in USD to tag files with the given total characters of content. */
function estimateCost(fileCount, contentChars) {
  const tokens = fileCount * 700 + contentChars / 3.5; // ~700 tokens of questions per call
  return (tokens / 1e6) * PRICE_PER_M_INPUT;
}

module.exports = { Jev, JevError, buildFileRequest, buildQueryRequest, interpretFile, interpretQuery, redact, estimateCost, ranked, DEFAULT_MODEL, ENDPOINT };
