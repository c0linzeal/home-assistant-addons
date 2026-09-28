// Line icons in the spirit of SF Symbols, and Finder-style document icons drawn as SVG.
(function () {
  const g = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

  const UI = {
    logo: `<svg viewBox="0 0 32 32"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#5e5ce6"/></linearGradient></defs><rect x="1" y="1" width="30" height="30" rx="8" fill="url(#lg)"/><circle cx="14" cy="14" r="6.2" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M18.6 18.6 24 24" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M24.5 5.5l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" fill="#fff"/></svg>`,
    chevronLeft: g('<path d="M15 5l-7 7 7 7"/>'),
    chevronRight: g('<path d="M9 5l7 7-7 7"/>'),
    grid: g('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
    list: g('<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r=".9" fill="currentColor"/><circle cx="4.8" cy="12" r=".9" fill="currentColor"/><circle cx="4.8" cy="17.5" r=".9" fill="currentColor"/>'),
    sidebarRight: g('<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M14.5 4.5v15"/><path d="M16.8 8h1.8M16.8 11h1.8"/>'),
    search: g('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>'),
    sparkle: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5c.5 3.9 1.7 6.3 3.2 7.5 1.5 1.2 3.6 1.7 6.3 2-2.7.3-4.8.8-6.3 2-1.5 1.2-2.7 3.6-3.2 7.5-.5-3.9-1.7-6.3-3.2-7.5-1.5-1.2-3.6-1.7-6.3-2 2.7-.3 4.8-.8 6.3-2 1.5-1.2 2.7-3.6 3.2-7.5z"/><path d="M19 2l.5 1.5L21 4l-1.5.5L19 6l-.5-1.5L17 4l1.5-.5z" opacity=".7"/></svg>`,
    xCircle: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M9 9l6 6M15 9l-6 6" stroke="var(--clear-x, #fff)" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    x: g('<path d="M6 6l12 12M18 6L6 18"/>'),
    gear: g('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    clock: g('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    monitor: g('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>'),
    doc: g('<path d="M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M14 3.5V8h4.5"/>'),
    download: g('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v8M8.5 12.5 12 16l3.5-3.5"/>'),
    photo: g('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>'),
    folder: g('<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
    star: g('<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>'),
    starFill: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/></svg>`,
    lock: g('<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
    lockFill: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 10V8a4 4 0 0 1 8 0v2h.5A2.5 2.5 0 0 1 19 12.5v5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 17.5v-5A2.5 2.5 0 0 1 7.5 10zm2 0h4V8a2 2 0 1 0-4 0z"/></svg>`,
    tag: g('<path d="M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2l8.3 8.3a1.5 1.5 0 0 1 0 2.1l-7.1 7.1a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8" cy="8" r="1.3"/>'),
    plus: g('<path d="M12 5v14M5 12h14"/>'),
    minus: g('<path d="M5 12h14"/>'),
    openBox: g('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
    copy: g('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
    eye: g('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
    info: g('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>'),
    warning: g('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.2"/>'),
    check: g('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    checkCircle: g('<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.3l2.6 2.6 5-5.3"/>'),
    cloud: g('<path d="M7 18.5h10a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.7-1A4.5 4.5 0 0 0 7 18.5z"/>'),
    film: g('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M8 4.5v15M16 4.5v15M3.5 9h4.5M3.5 15h4.5M16 9h4.5M16 15h4.5"/>'),
    music: g('<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
    archive: g('<rect x="3.5" y="4" width="17" height="4.5" rx="1"/><path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12h4"/>'),
    code: g('<path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5"/>'),
    app: g('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v6M9 11.5 12 14.5 15 11.5"/>'),
    table: g('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15"/>'),
    slides: g('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M12 16.5V20M8.5 20h7"/>'),
    text: g('<path d="M5 6h14M5 10h14M5 14h9M5 18h11"/>'),
    pdf: g('<path d="M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M8.5 16.5c2-1 4.5-5 3.5-7s-2 1.5 0 4 4 2.5 4 1.5-3-.5-7.5 1.5"/>'),
    other: g('<circle cx="12" cy="12" r="8.5"/><path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="2.4"/>'),
    shield: g('<path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z"/>'),
    key: g('<circle cx="8" cy="15" r="4"/><path d="M11 12l8.5-8.5M16.5 6.5l2 2M14.5 8.5l1.5 1.5"/>'),
    refresh: g('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4.5V11h-6.5"/>'),
    external: g('<path d="M14 4h6v6M20 4l-9 9"/>'),
  };

  const KIND_ICON = { document: 'doc', pdf: 'pdf', spreadsheet: 'table', presentation: 'slides', text: 'text', image: 'photo', video: 'film', audio: 'music', archive: 'archive', code: 'code', installer: 'app', other: 'other' };

  const FILE_COLORS = {
    pdf: '#e5484d', document: '#2f6fed', spreadsheet: '#1f9d55', presentation: '#ef7a2f', text: '#8e8e93',
    image: '#0fa3b1', video: '#8e5cf6', audio: '#ff2d78', archive: '#a67c52', code: '#5e5ce6', installer: '#007aff', other: '#8e8e93',
  };

  // Glyph drawn on the page above the label.
  const GLYPH = {
    document: '<path d="M11 14h18M11 18h18M11 22h13" stroke="#b8b8c0" stroke-width="1.6" stroke-linecap="round"/>',
    text: '<path d="M11 14h18M11 18h18M11 22h13" stroke="#b8b8c0" stroke-width="1.6" stroke-linecap="round"/>',
    pdf: '<path d="M13 25c3-1.5 7-8 5.5-11s-3 2.5 0 6.3 6 3.7 6 2.2-4.5-.8-11.5 2.5" stroke="#e5484d" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    spreadsheet: '<g stroke="#9fb5a6" stroke-width="1.2"><rect x="10.5" y="12.5" width="19" height="12" rx="1" fill="#eef7f1"/><path d="M10.5 16.5h19M10.5 20.5h19M16.5 12.5v12M23 12.5v12"/></g>',
    presentation: '<rect x="10.5" y="12.5" width="19" height="12" rx="1.5" fill="#fdf0e7" stroke="#efb088" stroke-width="1.2"/><path d="M14 21l4-4 3 3 2-2 3 3" stroke="#ef7a2f" stroke-width="1.3" fill="none" stroke-linejoin="round"/>',
    image: '<rect x="10.5" y="12.5" width="19" height="13" rx="1.5" fill="#e6f6f7" stroke="#8ccfd5" stroke-width="1.2"/><circle cx="15" cy="16.5" r="1.6" fill="#0fa3b1"/><path d="M11 24.5l5.5-5 3.5 3 3-2.5 6.5 4.5" stroke="#0fa3b1" stroke-width="1.3" fill="none" stroke-linejoin="round"/>',
    video: '<rect x="10.5" y="12.5" width="19" height="13" rx="1.5" fill="#f1ebfe" stroke="#b9a2f8" stroke-width="1.2"/><path d="M18 16v6l5-3z" fill="#8e5cf6"/>',
    audio: '<path d="M17.5 23.5v-9l7-1.5v8.5" stroke="#ff2d78" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="16" cy="23.5" r="1.9" fill="#ff2d78"/><circle cx="23" cy="21.5" r="1.9" fill="#ff2d78"/>',
    archive: '<path d="M20 4v23" stroke="#a67c52" stroke-width="2.4" stroke-dasharray="2 2"/><rect x="18" y="23" width="4" height="4" rx="1" fill="#a67c52"/>',
    code: '<path d="M16 14l-4.5 4.5L16 23M24 14l4.5 4.5L24 23" stroke="#5e5ce6" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    other: '<path d="M11 14h18M11 18h14" stroke="#c8c8ce" stroke-width="1.6" stroke-linecap="round"/>',
  };

  let uid = 0;
  function fileIcon(group, ext) {
    const color = FILE_COLORS[group] ?? FILE_COLORS.other;
    const id = `fi${++uid}`;
    if (group === 'installer') {
      return `<svg viewBox="0 0 40 48" class="file-svg"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#007aff"/></linearGradient></defs>
        <rect x="3" y="7" width="34" height="34" rx="9" fill="url(#${id})"/><path d="M20 15v13M14.5 23.5 20 29l5.5-5.5" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 33.5h14" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/></svg>`;
    }
    const label = (ext || '').slice(0, 4).toUpperCase();
    return `<svg viewBox="0 0 40 48" class="file-svg"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f2f2f5"/></linearGradient></defs>
      <path d="M7 1.5h18.5L35.5 11.5V44a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 44V4A2.5 2.5 0 0 1 7 1.5z" fill="url(#${id})" stroke="#c9c9cf" stroke-width="1"/>
      <path d="M25.5 1.5V9a2.5 2.5 0 0 0 2.5 2.5h7.5" fill="#e9e9ee" stroke="#c9c9cf" stroke-width="1" stroke-linejoin="round"/>
      ${GLYPH[group] ?? GLYPH.other}
      ${label ? `<rect x="7.5" y="31" width="25" height="11" rx="2.6" fill="${color}"/><text x="20" y="39.2" text-anchor="middle" font-family="-apple-system, 'Segoe UI', sans-serif" font-size="${label.length > 3 ? 6.6 : 7.6}" font-weight="700" fill="#fff" letter-spacing=".3">${label}</text>` : ''}
    </svg>`;
  }

  window.Icons = { UI, KIND_ICON, FILE_COLORS, fileIcon };
})();
