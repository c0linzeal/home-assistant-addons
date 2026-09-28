// Demo mode: a realistic set of personal files and an offline stand-in for Jev, so the
// app can be tried (and tested) without API keys. The stand-in picks options by word
// overlap; the real Jev reads meaning and is far better.
const fs = require('node:fs/promises');
const path = require('node:path');
const { deflateSync, crc32 } = require('node:zlib');
const { CATEGORIES } = require('./taxonomy');
const { stem, tokenize } = require('./query');

// ---------- tiny file writers ----------

function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function docx(paragraphs, title = '') {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
    'docProps/core.xml': `<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(title)}</dc:title></cp:coreProperties>`,
  });
}

function xlsx(sheetName, rows) {
  const cells = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
    const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(String(v))}</t></is></c>`;
  }).join('')}</row>`).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet><sheetData>${cells}</sheetData></worksheet>`,
  });
}

function pptx(slides) {
  const files = { '[Content_Types].xml': '<?xml version="1.0"?><Types/>' };
  slides.forEach((lines, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = `<?xml version="1.0"?><p:sld><p:cSld><p:spTree>${lines.map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`).join('')}</p:spTree></p:cSld></p:sld>`;
  });
  return zip(files);
}

function pdf(lines) {
  const text = lines.map((l, i) => `BT /F1 11 Tf 56 ${780 - i * 16} Td (${l.replace(/[\\()]/g, '\\$&')}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A soft gradient PNG, standing in for a photo. */
function png(w, h, top, bottom, blob = null) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = y / (h - 1);
      let c = top.map((v, i) => Math.round(v + (bottom[i] - v) * t));
      if (blob) {
        const d = Math.hypot(x - blob.x * w, y - blob.y * h) / (blob.r * w);
        if (d < 1) c = c.map((v, i) => Math.round(v + (blob.c[i] - v) * (1 - d * d)));
      }
      raw.set(c, y * (w * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- the sample files ----------

const SAMPLES = [
  ['Documents/Taxes/2025 Tax Return - Final.pdf', '2026-04-10', () => pdf(['Form 1040 U.S. Individual Income Tax Return 2025', 'Filing status: Single', 'Total income: 68,420', 'Refund: 1,214', 'Prepared April 10, 2026'])],
  ['Documents/Taxes/W-2 Acme Corp 2025.pdf', '2026-01-30', () => pdf(['Form W-2 Wage and Tax Statement 2025', 'Employer: Acme Corp', 'Wages, tips, other compensation: 64,000', 'Federal income tax withheld: 7,900'])],
  ['Documents/Insurance/Car insurance renewal 2026.pdf', '2026-03-18', () => pdf(['Tokio Marine Nichido - Auto Insurance', 'Policy renewal notice', 'Vehicle: Toyota Aqua 2019', 'Renewal date: April 2, 2026', 'Annual premium: 58,300 JPY', 'Coverage: comprehensive, roadside assistance'])],
  ['Documents/Insurance/Health plan summary.docx', '2025-11-04', () => docx(['Summary of Benefits and Coverage', 'National Health Insurance enrollment', 'Covers 70% of doctor, hospital and prescription costs', 'Effective November 1, 2025'], 'Health plan summary')],
  ['Documents/Home/Apartment lease agreement.docx', '2025-03-03', () => docx(['Residential Lease Agreement', 'Landlord: Sakura Realty Co.', 'Tenant: Colin Zeal', 'Premises: 2-14-7 Makuhari, Chiba, Apartment 402', 'Monthly rent: 112,000 JPY, deposit two months', 'Term: two years starting April 1, 2025', 'Signed March 3, 2025'], 'Lease agreement')],
  ['Documents/Home/Moving checklist.xlsx', '2025-03-20', () => xlsx('Checklist', [['Task', 'Done'], ['Book moving truck', 'yes'], ['Transfer electricity and gas', 'yes'], ['Register address at city hall', 'no'], ['Change address with bank', 'no']])],
  ['Documents/Travel/Kyoto trip budget.xlsx', '2026-04-14', () => xlsx('Budget', [['Item', 'Cost (JPY)'], ['Shinkansen Tokyo to Kyoto round trip', 28340], ['Ryokan two nights', 46000], ['Temple entry fees', 3500], ['Food and snacks', 18000], ['Total', 95840]])],
  ['Documents/Travel/Flight booking - JAL Osaka.pdf', '2026-04-22', () => pdf(['Japan Airlines - Booking confirmation', 'Passenger: ZEAL/COLIN MR', 'JL 123 Haneda to Itami, departure May 2, 2026 08:00', 'Booking reference: X7QK2P', 'Seat 23A'])],
  ['Documents/Work/Resume 2026.docx', '2026-02-11', () => docx(['Colin Zeal', 'Resume', 'Experience: home automation consultant, software engineer', 'Skills: Home Assistant, Node.js, Python, bilingual English and Japanese'], 'Resume')],
  ['Documents/Work/Q2 planning notes.md', '2026-04-03', () => Buffer.from('# Q2 planning\n\n- Launch the smart home client pilot\n- Hire one contractor\n- Review the budget with finance on April 20\n')],
  ['Documents/Work/Client proposal - smart home.pptx', '2026-05-19', () => pptx([['Smart home proposal', 'For the Tanaka family'], ['Scope', 'Lighting scenes, energy monitoring, bilingual voice announcements'], ['Price', '380,000 JPY including installation']])],
  ['Documents/Health/Blood test results.pdf', '2026-03-09', () => pdf(['Makuhari Clinic - Laboratory report', 'Patient: Colin Zeal', 'Collected March 6, 2026', 'Cholesterol: within normal range', 'Vitamin D: slightly low, supplement recommended'])],
  ['Documents/Recipes/Grandmas curry.txt', '2024-12-01', () => Buffer.from('Grandma\'s Japanese curry\n\nOnions, carrots, potatoes, pork, curry roux, grated apple and a spoon of honey.\nSimmer slowly for an hour.\n')],
  ['Documents/School/Transpersonal psychology essay - integration.docx', '2025-10-22', () => docx(['Integration after peak experiences', 'An essay on meaning-making and development in transpersonal psychology', 'Drawing on Wilber, Grof and Maslow, this paper explores how insights are integrated into daily life.'], 'Integration after peak experiences')],
  ['Documents/Money/Budget 2026.xlsx', '2026-01-05', () => xlsx('2026', [['Category', 'Monthly'], ['Rent', 112000], ['Food', 60000], ['Utilities', 18000], ['Savings', 50000], ['Fun', 25000]])],
  ['Documents/Money/Bank statement Aug 2026.pdf', '2026-09-02', () => pdf(['Sumitomo Mitsui Banking Corporation', 'Account statement August 2026', 'Opening balance: 842,100 JPY', 'Closing balance: 901,655 JPY', 'Salary deposit Acme Corp August 25, 2026'])],
  ['Documents/Receipts/Amazon order - Air purifier.pdf', '2026-06-12', () => pdf(['Amazon.co.jp order confirmation', 'Order placed: June 12, 2026', 'Sharp Plasmacluster air purifier KC-50', 'Total: 32,800 JPY', 'Warranty: 1 year from purchase'])],
  ['Documents/Receipts/領収書_ビックカメラ.docx', '2026-07-21', () => docx(['領収書', 'ビックカメラ 船橋店', '2026年7月21日', 'ダイソン コードレス掃除機 V12', '合計 69,800円 (税込)'], '領収書')],
  ['Documents/IDs/Passport scan.png', '2024-08-15', () => png(160, 110, [205, 196, 170], [180, 170, 140], { x: 0.25, y: 0.5, r: 0.18, c: [120, 110, 100] })],
  ['Documents/IDs/Residence card copy.pdf', '2025-06-30', () => pdf(['Residence Card (Zairyu Card) copy', 'Name: ZEAL COLIN', 'Status of residence: Engineer / Specialist in Humanities', 'Period of stay until June 30, 2028'])],
  ['Documents/Bills/Electricity bill July 2026.pdf', '2026-08-05', () => pdf(['TEPCO Energy Partner - Electricity bill', 'Billing period: July 2026', 'Usage: 412 kWh', 'Amount due: 13,920 JPY by August 25, 2026'])],
  ['Documents/Bills/Internet invoice 2026-08.pdf', '2026-08-28', () => pdf(['NURO Hikari - Monthly invoice', 'Service: fiber internet 2 Gbps', 'Invoice date: August 28, 2026', 'Amount: 5,200 JPY'])],
  ['Desktop/Screenshot 2026-09-20 101512.png', '2026-09-20', () => png(320, 200, [238, 240, 244], [222, 226, 232], { x: 0.3, y: 0.4, r: 0.2, c: [10, 132, 255] })],
  ['Desktop/todo.txt', '2026-09-26', () => Buffer.from('- renew residence card (June 2028, set reminder)\n- call landlord about the aircon\n- pay electricity bill\n')],
  ['Desktop/Home Assistant automation ideas.md', '2026-09-14', () => Buffer.from('# Automation ideas\n\n- Good morning greeting in English and Japanese when the bedroom motion sensor triggers\n- Air purifier on when PM2.5 is high\n- Rice cooker reminder\n')],
  ['Downloads/invoice_88341.pdf', '2026-09-03', () => pdf(['Invoice 88341', 'Smart Home Parts Ltd', 'Zigbee motion sensors x4, smart plugs x6', 'Invoice date: September 3, 2026', 'Total due: 24,600 JPY'])],
  ['Downloads/warranty_card.pdf', '2025-02-16', () => pdf(['Panasonic warranty certificate', 'Product: IH rice cooker SR-FE101', 'Date of purchase: February 14, 2025', 'Warranty period: one year'])],
  ['Downloads/IMG_4432.png', '2026-07-04', () => png(240, 180, [120, 170, 220], [230, 200, 160], { x: 0.7, y: 0.35, r: 0.12, c: [255, 240, 200] })],
  ['Downloads/balenaEtcher-Setup-2.1.exe', '2026-05-30', () => Buffer.from('MZ fake installer for the demo')],
  ['Pictures/Kyoto 2026/IMG_2201.png', '2026-05-03', () => png(240, 180, [250, 190, 200], [120, 160, 110], { x: 0.5, y: 0.45, r: 0.25, c: [200, 60, 60] })],
  ['Pictures/Kyoto 2026/IMG_2214.png', '2026-05-03', () => png(240, 180, [140, 190, 240], [70, 110, 80], { x: 0.3, y: 0.6, r: 0.2, c: [150, 90, 50] })],
  ['Pictures/Kyoto 2026/IMG_2230.png', '2026-05-04', () => png(240, 180, [255, 200, 150], [90, 60, 90], { x: 0.6, y: 0.3, r: 0.15, c: [255, 230, 120] })],
  ['Pictures/Screenshots/Screenshot 2026-08-02.png', '2026-08-02', () => png(320, 200, [30, 30, 34], [44, 44, 50], { x: 0.5, y: 0.5, r: 0.25, c: [48, 209, 88] })],
];

/** Writes the sample files under `dir` and returns the four root folders. */
async function createDemoFiles(dir) {
  for (const [rel, date, make] of SAMPLES) {
    const full = path.join(dir, ...rel.split('/'));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, make());
    const t = new Date(`${date}T10:30:00`);
    await fs.utimes(full, t, t);
  }
  return ['Documents', 'Desktop', 'Downloads', 'Pictures'].map((r) => path.join(dir, r));
}

// ---------- offline stand-in for Jev ----------

const words = (s) => new Set(tokenize(String(s)).map(stem));
const DOCTYPE_HINTS = {
  contract: 'lease agreement contract tenant signed', ticket: 'booking flight boarding reservation seat', invoice: 'invoice bill amount due',
  receipt: 'receipt order total 領収書', statement: 'statement balance wage', table: 'budget checklist cost total xlsx', report: 'essay report results laboratory',
  certificate: 'passport residence card certificate warranty', form: 'form return filing', resume: 'resume experience skills', presentation: 'proposal slides pptx',
  notes: 'notes todo ideas planning', letter: 'dear notice', manual: 'manual instructions guide', code: 'config script',
};

function fakeJevTransport({ log = null } = {}) {
  return async (body) => {
    log?.push(body);
    const stateText = JSON.stringify(body.state).toLowerCase();
    const stateWords = words(stateText);
    const fileText = `${body.state.file?.name ?? ''} ${body.state.content ?? ''}`.toLowerCase();
    const answers = {};
    for (const [id, q] of Object.entries(body.questions)) {
      if (q.type === 'noul') {
        const p = id === 'important'
          ? (/passport|certificate|lease agreement|tax return|residence card|policy renewal|warranty/.test(fileText) ? 0.86 : 0.08)
          : (/account|passport|residence card|patient|salary|\[secret\]|\[card/.test(fileText) ? 0.81 : 0.05);
        answers[id] = { type: 'noul', noul: p };
        continue;
      }
      if (id === 'date') {
        const first = Object.keys(q.criteria).find((k) => k !== 'none');
        answers[id] = { type: 'choice', choice: first ?? 'none', probabilities: { [first ?? 'none']: 0.8 }, confidence: 0.8 };
        continue;
      }
      // Option names and category keywords count most; description words only break ties.
      const nameWords = words(`${body.state.file?.name ?? ''} ${body.state.file?.folder ?? ''} ${body.state.search ?? ''}`);
      const scored = Object.entries(q.criteria).map(([opt, desc]) => {
        desc = typeof desc === 'string' ? desc : desc?.description ?? '';
        let s = 0;
        for (const w of words(`${opt} ${(CATEGORIES[opt]?.keywords ?? []).join(' ')} ${id === 'doctype' ? DOCTYPE_HINTS[opt] ?? '' : ''}`)) {
          if (w.length < 3) continue;
          if (nameWords.has(w)) s += 3;
          else if (stateWords.has(w)) s += 1;
        }
        for (const w of words(desc)) if (w.length > 4 && stateWords.has(w)) s += 0.2;
        if (opt === 'other' || opt === 'any') s = 0.6;
        return [opt, s];
      }).sort((a, b) => b[1] - a[1]);
      const total = scored.reduce((n, [, s]) => n + s * s + 0.05, 0);
      const probabilities = Object.fromEntries(scored.map(([o, s]) => [o, (s * s + 0.05) / total]));
      answers[id] = { type: 'choice', choice: scored[0][0], probabilities, confidence: probabilities[scored[0][0]] };
    }
    await new Promise((r) => setTimeout(r, 30));
    return { status: 200, json: { model: 'demo/offline-jev', answers, usage: { input_tokens: 0, cost: 0 } } };
  };
}

module.exports = { createDemoFiles, fakeJevTransport, zip, docx, xlsx, pptx, pdf, png, SAMPLES };
