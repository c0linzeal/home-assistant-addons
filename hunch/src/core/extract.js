// Pulls searchable text out of files. Office files are ZIP archives of XML, read
// here with Node's zlib; PDFs go through unpdf (pdf.js). Everything else that is
// text is read directly. Scanned PDFs and images have no text: they are found by
// name, folder, date and (with Jev) their tags.
const fs = require('node:fs/promises');
const { inflateRawSync } = require('node:zlib');
const { TEXT_EXTS, OFFICE_EXTS } = require('./kinds');

const MAX_READ_BYTES = 40 * 1024 * 1024; // bigger files are indexed by name only
const MAX_TEXT_READ = 512 * 1024;        // plain text: read at most this much
const MAX_ENTRY_BYTES = 64 * 1024 * 1024; // zip-bomb guard
const KEEP_CHARS = 5000;                  // text kept in the index per file

// ---------- ZIP ----------

function listZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    entries.set(buf.toString('utf8', p + 46, p + 46 + nameLen), { method, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buf, entries, name) {
  const e = entries.get(name);
  if (!e || e.size > MAX_ENTRY_BYTES) return null;
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compSize);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
  return null;
}

// ---------- Office ----------

function decodeXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
const stripTags = (xml) => decodeXml(xml.replace(/<[^>]+>/g, ''));
const tidy = (s) => s.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();

function officeTitle(buf, entries) {
  const core = readZipEntry(buf, entries, 'docProps/core.xml')?.toString('utf8');
  const m = core?.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/);
  return m ? decodeXml(m[1]).trim() : '';
}

function officeText(buf, ext) {
  const entries = listZip(buf);
  const read = (n) => readZipEntry(buf, entries, n)?.toString('utf8') ?? '';
  let text = '';
  if (ext === 'docx' || ext === 'docm' || ext === 'dotx') {
    text = stripTags(read('word/document.xml')
      .replace(/<w:tab\/>/g, '\t').replace(/<w:(br|cr)\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, '\t'));
  } else if (ext === 'pptx') {
    const slides = [...entries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    text = slides.map((n) => stripTags(read(n).replace(/<\/a:p>/g, '\n'))).join('\n\n');
  } else if (ext === 'xlsx' || ext === 'xlsm') {
    const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
    const sheetNames = [...read('xl/workbook.xml').matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map((m) => decodeXml(m[1]));
    const sheets = [...entries.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
    const parts = [];
    sheets.forEach((n, i) => {
      const rows = [];
      for (const row of read(n).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        if (rows.length >= 300) break;
        const cells = [];
        for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const type = c[1].match(/t="([^"]+)"/)?.[1];
          const body = c[2] ?? '';
          let v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          if (type === 's') v = shared[Number(v)];
          else if (type === 'inlineStr') v = stripTags(body);
          else if (v != null) v = decodeXml(v);
          if (v != null && v !== '') cells.push(v);
        }
        if (cells.length) rows.push(cells.join('\t'));
      }
      parts.push(`${sheetNames[i] ?? `Sheet ${i + 1}`}\n${rows.join('\n')}`);
    });
    text = parts.join('\n\n');
  } else {
    // OpenDocument: all text lives in content.xml
    text = stripTags(read('content.xml').replace(/<\/text:(p|h)>/g, '\n').replace(/<text:tab\/>/g, '\t'));
  }
  return { text: tidy(text), title: officeTitle(buf, entries) };
}

// ---------- PDF ----------

let unpdf;
async function pdfText(buf) {
  unpdf ??= await import('unpdf');
  const doc = await unpdf.getDocumentProxy(new Uint8Array(buf));
  try {
    const pages = Math.min(doc.numPages, 15);
    const parts = [];
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join(''));
    }
    let title = '';
    try { title = (await doc.getMetadata())?.info?.Title ?? ''; } catch { /* no metadata */ }
    return { text: tidy(parts.join('\n\n')), title: String(title).trim() };
  } finally {
    await (doc.destroy?.() ?? doc.cleanup?.());
  }
}

// ---------- plain text ----------

function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  // Binary masquerading as text: lots of NULs means give up.
  const probe = buf.subarray(0, 4096);
  let nul = 0;
  for (const b of probe) if (b === 0) nul++;
  if (nul > probe.length / 10) return '';
  return buf.toString('utf8');
}

function plainText(buf, ext) {
  let text = decodeText(buf);
  if (ext === 'html' || ext === 'htm') {
    text = decodeXml(text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' '));
  } else if (ext === 'rtf') {
    text = text.replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^{}]*\}/g, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
  } else if (ext === 'eml') {
    // Keep the useful headers and the body; drop base64 attachments.
    const [head, ...rest] = text.split(/\r?\n\r?\n/);
    const keep = head.split(/\r?\n/).filter((l) => /^(from|to|subject|date):/i.test(l)).join('\n');
    text = `${keep}\n\n${rest.join('\n\n').replace(/^[A-Za-z0-9+/=]{60,}$/gm, '')}`;
  }
  return { text: tidy(text), title: '' };
}

// ---------- entry point ----------

/** Keep the start and end of long text, like a person skimming. */
function clip(text, max = KEEP_CHARS) {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.75);
  return `${text.slice(0, head)}\n…\n${text.slice(-(max - head))}`;
}

/**
 * Returns { text, title } for a file, or { text: '' } when there is nothing to read.
 * Throws only on unexpected I/O errors; malformed files give empty text.
 */
async function extractText(filePath, ext, size) {
  if (size > MAX_READ_BYTES) return { text: '', title: '', skipped: 'too large' };
  if (TEXT_EXTS.has(ext)) {
    const fh = await fs.open(filePath, 'r');
    try {
      const len = Math.min(size, MAX_TEXT_READ);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, 0);
      const r = plainText(buf, ext);
      return { text: clip(r.text), title: r.title };
    } finally {
      await fh.close();
    }
  }
  if (!OFFICE_EXTS.has(ext) && ext !== 'pdf') return { text: '', title: '' };
  const buf = await fs.readFile(filePath);
  try {
    const r = ext === 'pdf' ? await pdfText(buf) : officeText(buf, ext);
    return { text: clip(r.text), title: r.title };
  } catch (err) {
    return { text: '', title: '', skipped: `unreadable: ${err.message}` };
  }
}

module.exports = { extractText, officeText, plainText, listZip, readZipEntry, clip, KEEP_CHARS };
