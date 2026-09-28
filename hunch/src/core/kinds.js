// File kinds by extension. `group` is what search filters and the sidebar use;
// `label` is the Finder-style "Kind" column text.

const GROUPS = {
  document: 'Documents',
  pdf: 'PDFs',
  spreadsheet: 'Spreadsheets',
  presentation: 'Presentations',
  text: 'Text & Notes',
  image: 'Images',
  video: 'Movies',
  audio: 'Music & Audio',
  archive: 'Archives',
  code: 'Code',
  installer: 'Apps & Installers',
  other: 'Other',
};

const BY_EXT = {};
function add(group, label, exts) {
  for (const ext of exts.split(' ')) BY_EXT[ext] = { group, label: label.replace('%', ext.toUpperCase()) };
}

add('pdf', 'PDF document', 'pdf');
add('document', 'Word document', 'docx doc docm dotx');
add('document', 'OpenDocument text', 'odt');
add('document', 'Rich text document', 'rtf');
add('document', 'Pages document', 'pages');
add('document', 'EPUB book', 'epub');
add('spreadsheet', 'Excel spreadsheet', 'xlsx xls xlsm');
add('spreadsheet', 'OpenDocument spreadsheet', 'ods');
add('spreadsheet', 'CSV table', 'csv tsv');
add('spreadsheet', 'Numbers spreadsheet', 'numbers');
add('presentation', 'PowerPoint presentation', 'pptx ppt');
add('presentation', 'OpenDocument presentation', 'odp');
add('presentation', 'Keynote presentation', 'key');
add('text', 'Plain text', 'txt text log');
add('text', 'Markdown document', 'md markdown');
add('text', 'Email message', 'eml msg');
add('text', 'Web page', 'html htm mhtml');
add('image', '% image', 'jpg jpeg png gif webp bmp tif tiff heic heif avif');
add('image', 'RAW photo', 'raw cr2 cr3 nef arw dng orf rw2');
add('image', 'SVG image', 'svg');
add('image', 'Photoshop image', 'psd');
add('video', '% movie', 'mp4 mov m4v avi mkv wmv webm mts 3gp');
add('audio', '% audio', 'mp3 m4a wav flac aac ogg wma aiff opus');
add('archive', '% archive', 'zip rar 7z tar gz tgz bz2 xz');
add('archive', 'Disk image', 'iso dmg img');
add('code', 'Source code', 'js mjs cjs ts tsx jsx py rb go rs java kt c h cpp hpp cs php swift sh ps1 bat cmd lua r sql');
add('code', 'Configuration file', 'json yaml yml toml ini cfg conf xml env');
add('installer', 'Windows installer', 'msi msix appx');
add('installer', 'Application', 'exe');
add('installer', 'Android app', 'apk');

// Extensions whose text we try to read.
const TEXT_EXTS = new Set(['txt', 'text', 'log', 'md', 'markdown', 'csv', 'tsv', 'eml', 'html', 'htm', 'rtf',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs',
  'php', 'swift', 'sh', 'ps1', 'bat', 'cmd', 'lua', 'r', 'sql', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml']);
const OFFICE_EXTS = new Set(['docx', 'docm', 'dotx', 'xlsx', 'xlsm', 'pptx', 'odt', 'ods', 'odp']);

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function kindOf(name) {
  const ext = extOf(name);
  const k = BY_EXT[ext];
  if (k) return { ext, group: k.group, label: k.label };
  return { ext, group: 'other', label: ext ? `${ext.toUpperCase()} file` : 'Document' };
}

const isReadable = (ext) => TEXT_EXTS.has(ext) || OFFICE_EXTS.has(ext) || ext === 'pdf';
const isMedia = (group) => group === 'image' || group === 'video' || group === 'audio';

module.exports = { GROUPS, kindOf, extOf, isReadable, isMedia, TEXT_EXTS, OFFICE_EXTS };
