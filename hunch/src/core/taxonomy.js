// The vocabulary Hunch sorts files into. Jev picks from these lists; the local
// fallback (no API key) guesses from the keywords.

// Areas of life. `description` is what Jev reads; `keywords` drive the local guess
// and the query parser (a few Japanese terms included for mixed-language folders).
const CATEGORIES = {
  money: {
    label: 'Money & Banking', color: '#34c759',
    description: 'Bank and card statements, budgets, savings, investments, loans, pay slips and other personal finance records',
    keywords: ['bank', 'statement', 'budget', 'savings', 'investment', 'invest', 'loan', 'payslip', 'paystub', 'salary', 'pension', 'brokerage', 'finance', 'finances', '給与', '銀行', '明細'],
  },
  bills: {
    label: 'Bills & Utilities', color: '#ff9f0a',
    description: 'Bills and invoices for electricity, gas, water, internet, phone and subscriptions',
    keywords: ['bill', 'bills', 'invoice', 'utility', 'utilities', 'electric', 'electricity', 'water', 'gas', 'internet', 'phone', 'subscription', '請求書', '電気', '水道'],
  },
  receipts: {
    label: 'Receipts & Purchases', color: '#ffcc00',
    description: 'Receipts, order confirmations, warranties and proof of purchase for things bought',
    keywords: ['receipt', 'receipts', 'order', 'purchase', 'purchased', 'bought', 'warranty', 'amazon', 'refund', '領収書', 'レシート'],
  },
  taxes: {
    label: 'Taxes', color: '#ff453a',
    description: 'Tax returns, tax forms and slips, deductions and letters from the tax office',
    keywords: ['tax', 'taxes', 'w2', 'w-2', '1099', 'irs', 'hmrc', 'deduction', 'return', '確定申告', '源泉徴収', '税'],
  },
  insurance: {
    label: 'Insurance', color: '#5e5ce6',
    description: 'Insurance policies, coverage documents, premiums and claims (health, car, home, life, travel)',
    keywords: ['insurance', 'policy', 'claim', 'premium', 'coverage', '保険'],
  },
  health: {
    label: 'Health & Medical', color: '#ff375f',
    description: 'Medical records, test results, prescriptions, doctor and dentist visits, vaccination records',
    keywords: ['medical', 'health', 'doctor', 'hospital', 'clinic', 'prescription', 'dentist', 'dental', 'vaccine', 'vaccination', 'lab', 'blood', '病院', '診断'],
  },
  home: {
    label: 'Home & Property', color: '#bf5af2',
    description: 'Lease or rental agreements, mortgage, house repairs, appliances, floor plans, moving and household paperwork',
    keywords: ['lease', 'rent', 'rental', 'mortgage', 'apartment', 'house', 'landlord', 'tenant', 'repair', 'appliance', 'moving', 'floorplan', '賃貸', '契約'],
  },
  car: {
    label: 'Car & Transport', color: '#64d2ff',
    description: 'Car registration, driving, parking, fuel, maintenance and service records, public transport passes',
    keywords: ['car', 'vehicle', 'registration', 'dmv', 'parking', 'fuel', 'mileage', 'service', 'toll', '車検', '車'],
  },
  work: {
    label: 'Work & Career', color: '#0a84ff',
    description: 'Resumes, job applications and offers, work projects, meeting notes, reports and work presentations',
    keywords: ['resume', 'cv', 'job', 'work', 'offer', 'interview', 'meeting', 'project', 'report', 'client', 'proposal', 'career'],
  },
  school: {
    label: 'School & Learning', color: '#30d158',
    description: 'Coursework, assignments, essays, research papers, lecture notes, transcripts and study material',
    keywords: ['school', 'class', 'course', 'homework', 'assignment', 'thesis', 'essay', 'paper', 'lecture', 'university', 'college', 'study', 'research', 'syllabus', 'transcript'],
  },
  travel: {
    label: 'Travel', color: '#0fb5ae',
    description: 'Flight and train tickets, hotel bookings, itineraries, travel plans and visas for trips',
    keywords: ['trip', 'travel', 'flight', 'hotel', 'itinerary', 'booking', 'reservation', 'ticket', 'boarding', 'vacation', 'holiday', '旅行', '予約'],
  },
  identity: {
    label: 'IDs & Legal', color: '#8e8e93',
    description: 'Passports, ID cards, licenses, birth and marriage certificates, residence cards, contracts, wills and other legal documents',
    keywords: ['passport', 'visa', 'license', 'licence', 'certificate', 'birth', 'marriage', 'contract', 'agreement', 'will', 'legal', 'id', '在留', '免許', '証明書'],
  },
  family: {
    label: 'Family & Personal', color: '#ff6482',
    description: 'Personal letters, cards, journals, family matters, events, invitations and personal writing',
    keywords: ['family', 'letter', 'journal', 'diary', 'wedding', 'birthday', 'invitation', 'kids', 'personal'],
  },
  food: {
    label: 'Recipes & Food', color: '#ffb340',
    description: 'Recipes, meal plans, shopping lists and cooking notes',
    keywords: ['recipe', 'recipes', 'cooking', 'meal', 'grocery', 'groceries', 'food', 'レシピ'],
  },
  hobbies: {
    label: 'Hobbies & Projects', color: '#ac8e68',
    description: 'Hobby and side projects: music, games, crafts, DIY, gardening, smart home and maker projects',
    keywords: ['hobby', 'diy', 'garden', 'gardening', 'craft', 'game', 'guitar', 'music', 'build', 'homeassistant'],
  },
  tech: {
    label: 'Software & Tech', color: '#636366',
    description: 'Installers, source code, configuration files, device manuals, drivers and technical notes',
    keywords: ['installer', 'setup', 'driver', 'manual', 'config', 'code', 'script', 'firmware', 'software'],
  },
  media: {
    label: 'Photos & Media', color: '#ff9500',
    description: 'Photos, screenshots, videos, music and other media files',
    keywords: ['photo', 'photos', 'picture', 'video', 'screenshot', 'song', 'album'],
  },
  other: {
    label: 'Other', color: '#aeaeb2',
    description: 'None of the other areas fits',
    keywords: [],
  },
};

// What kind of document it is, independent of the area of life.
const DOC_TYPES = {
  letter: { label: 'Letter or notice', description: 'A letter, email or notice addressed to someone' },
  invoice: { label: 'Bill or invoice', description: 'A bill or invoice asking for payment' },
  receipt: { label: 'Receipt', description: 'A receipt or order confirmation for a payment already made' },
  statement: { label: 'Statement', description: 'A periodic account statement (bank, card, pension, utility usage)' },
  form: { label: 'Form', description: 'A form or application, filled in or blank' },
  contract: { label: 'Contract', description: 'A contract, agreement, lease or terms that parties sign' },
  certificate: { label: 'Certificate or ID', description: 'A certificate, ID document, license or official record' },
  ticket: { label: 'Ticket or booking', description: 'A ticket, boarding pass, booking or reservation confirmation' },
  manual: { label: 'Manual', description: 'A manual, guide or instructions' },
  resume: { label: 'Resume', description: 'A resume or CV' },
  notes: { label: 'Notes', description: 'Notes, a to-do list or rough personal writing' },
  report: { label: 'Report or essay', description: 'A report, essay, article or paper' },
  table: { label: 'Table or list', description: 'A table, list, budget or tracker of rows and columns' },
  presentation: { label: 'Presentation', description: 'Slides or a presentation' },
  code: { label: 'Code or config', description: 'Source code, a script or a configuration file' },
  other: { label: 'Other', description: 'Something else' },
};

module.exports = { CATEGORIES, DOC_TYPES };
