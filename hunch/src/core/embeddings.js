// Optional "similar meaning" search with OpenAI embeddings. Each file becomes a short
// vector; a search description becomes one too, and nearby vectors mean related
// content even when no words match ("car insurance renewal" finds "auto policy").
const ENDPOINT = 'https://api.openai.com/v1/embeddings';
const MODEL = 'text-embedding-3-small';
const DIMENSIONS = 256; // plenty for file search, and 6x smaller than the default
const PRICE_PER_M = 0.02; // USD, for estimates only

class Embedder {
  constructor({ apiKey, transport = null }) {
    this.apiKey = apiKey;
    this.transport = transport;
    this.model = `${MODEL}@${DIMENSIONS}`;
  }

  /** Embeds strings in one request. Returns Float32Array[] in input order. */
  async embed(inputs) {
    const body = { model: MODEL, input: inputs, dimensions: DIMENSIONS };
    let json;
    if (this.transport) json = (await this.transport(body)).json;
    else {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
      json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${json?.error?.message ?? 'request failed'}`);
    }
    return json.data.sort((a, b) => a.index - b.index).map((d) => normalize(Float32Array.from(d.embedding)));
  }
}

function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Dot product of two unit vectors = cosine similarity. */
function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** What we embed for a file: its name, where it lives, its tags and the start of its text. */
function fileEmbeddingText(rec) {
  const tags = rec.jev ? [rec.jev.category?.id, rec.jev.doctype?.id].filter(Boolean).join(', ') : '';
  return [`File: ${rec.name}`, `Folder: ${rec.folder}`, tags && `Tags: ${tags}`, rec.title && `Title: ${rec.title}`, (rec.text ?? '').slice(0, 1500)]
    .filter(Boolean).join('\n');
}

const toBase64 = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
const fromBase64 = (s) => {
  const b = Buffer.from(s, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

module.exports = { Embedder, cosine, normalize, fileEmbeddingText, toBase64, fromBase64, PRICE_PER_M, DIMENSIONS };
