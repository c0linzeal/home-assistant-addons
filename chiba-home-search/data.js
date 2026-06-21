/*
 * data.js — Reference data for the Chiba Home Search tool.
 * Everything an English speaker needs to translate their search into the
 * Japanese terms the property portals actually use.
 */

// Major cities & towns in Chiba prefecture (千葉県).
// `jis` is the official municipality code, handy for precise searches.
const CHIBA_CITIES = [
  { en: "All of Chiba (no city filter)", ja: "千葉県全域", jis: "" },
  { en: "Chiba City", ja: "千葉市", jis: "12100" },
  { en: "Funabashi", ja: "船橋市", jis: "12204" },
  { en: "Matsudo", ja: "松戸市", jis: "12207" },
  { en: "Ichikawa", ja: "市川市", jis: "12203" },
  { en: "Kashiwa", ja: "柏市", jis: "12217" },
  { en: "Urayasu", ja: "浦安市", jis: "12227" },
  { en: "Narashino", ja: "習志野市", jis: "12216" },
  { en: "Ichihara", ja: "市原市", jis: "12219" },
  { en: "Nagareyama", ja: "流山市", jis: "12220" },
  { en: "Yachiyo", ja: "八千代市", jis: "12221" },
  { en: "Kamagaya", ja: "鎌ケ谷市", jis: "12224" },
  { en: "Noda", ja: "野田市", jis: "12208" },
  { en: "Abiko", ja: "我孫子市", jis: "12222" },
  { en: "Inzai", ja: "印西市", jis: "12231" },
  { en: "Sakura", ja: "佐倉市", jis: "12212" },
  { en: "Narita", ja: "成田市", jis: "12211" },
  { en: "Kisarazu", ja: "木更津市", jis: "12206" },
  { en: "Sodegaura", ja: "袖ケ浦市", jis: "12229" },
  { en: "Kimitsu", ja: "君津市", jis: "12225" },
  { en: "Mobara", ja: "茂原市", jis: "12210" },
  { en: "Tateyama", ja: "館山市", jis: "12205" },
  { en: "Choshi", ja: "銚子市", jis: "12202" },
];

// Property types for buying, with each portal's category landing path for Chiba.
// `gq` is the Japanese keyword used to build precise Google searches.
const PROPERTY_TYPES = [
  {
    key: "used_apartment",
    en: "Used apartment / condo",
    ja: "中古マンション",
    gq: "中古マンション",
    suumo: "https://suumo.jp/ms/chuko/chiba/",
    homes: "https://www.homes.co.jp/mansion/chuko/chiba/",
    athome: "https://www.athome.co.jp/mansion/chuko/chiba/list/",
    housedo: "https://www.housedo.com/used_mansion_chiba/",
  },
  {
    key: "new_apartment",
    en: "New apartment / condo",
    ja: "新築マンション",
    gq: "新築マンション",
    suumo: "https://suumo.jp/ms/shinchiku/chiba/",
    homes: "https://www.homes.co.jp/mansion/shinchiku/chiba/",
    athome: "https://www.athome.co.jp/mansion/shinchiku/chiba/list/",
    housedo: "https://www.housedo.com/new_mansion_chiba/",
  },
  {
    key: "used_house",
    en: "Used house (detached)",
    ja: "中古一戸建て",
    gq: "中古一戸建て",
    suumo: "https://suumo.jp/chukoikkodate/chiba/",
    homes: "https://www.homes.co.jp/kodate/chuko/chiba/",
    athome: "https://www.athome.co.jp/kodate/chuko/chiba/list/",
    housedo: "https://www.housedo.com/used_ikkodate_chiba/",
  },
  {
    key: "new_house",
    en: "New house (detached / newly built)",
    ja: "新築一戸建て",
    gq: "新築一戸建て",
    suumo: "https://suumo.jp/ikkodate/chiba/",
    homes: "https://www.homes.co.jp/kodate/shinchiku/chiba/",
    athome: "https://www.athome.co.jp/kodate/shinchiku/chiba/list/",
    housedo: "https://www.housedo.com/new_ikkodate_chiba/",
  },
  {
    key: "land",
    en: "Land (build your own)",
    ja: "土地",
    gq: "土地",
    suumo: "https://suumo.jp/tochi/chiba/",
    homes: "https://www.homes.co.jp/tochi/chiba/",
    athome: "https://www.athome.co.jp/tochi/chiba/list/",
    housedo: "https://www.housedo.com/tochi_chiba/",
  },
];

// Floor-plan layouts (間取り). R/K/DK/LDK explained in the glossary.
const LAYOUTS = [
  { key: "any", en: "Any layout", ja: "指定なし" },
  { key: "studio", en: "Studio (1R / 1K / 1DK)", ja: "ワンルーム・1K・1DK" },
  { key: "1ldk", en: "1LDK", ja: "1LDK" },
  { key: "2ldk", en: "2LDK", ja: "2LDK" },
  { key: "3ldk", en: "3LDK", ja: "3LDK" },
  { key: "4ldk", en: "4LDK or larger", ja: "4LDK以上" },
];

// Max walking time to the nearest train station (駅徒歩).
const WALK_TIMES = [
  { key: "any", en: "Any distance", ja: "指定なし" },
  { key: "5", en: "Within 5 min walk", ja: "徒歩5分以内" },
  { key: "10", en: "Within 10 min walk", ja: "徒歩10分以内" },
  { key: "15", en: "Within 15 min walk", ja: "徒歩15分以内" },
  { key: "20", en: "Within 20 min walk", ja: "徒歩20分以内" },
];

// Building age (築年数) — only meaningful for used properties.
const BUILDING_AGES = [
  { key: "any", en: "Any age", ja: "指定なし" },
  { key: "5", en: "Built within 5 years", ja: "築5年以内" },
  { key: "10", en: "Built within 10 years", ja: "築10年以内" },
  { key: "20", en: "Built within 20 years", ja: "築20年以内" },
  { key: "25", en: "Built within 25 years", ja: "築25年以内" },
];

// Plain-English glossary of the Japanese real-estate terms you'll see on the sites.
const GLOSSARY = [
  { term: "マンション", read: "manshon", meaning: "A unit in a concrete apartment/condo building (not a 'mansion' in English!)." },
  { term: "一戸建て / 戸建", read: "ikkodate / kodate", meaning: "A detached, standalone house." },
  { term: "土地", read: "tochi", meaning: "Land / a plot to build on." },
  { term: "中古", read: "chuko", meaning: "Used / pre-owned (second-hand)." },
  { term: "新築", read: "shinchiku", meaning: "Brand new / newly built." },
  { term: "万円", read: "man-en", meaning: "10,000 yen. A price of '3,000万円' = ¥30,000,000." },
  { term: "億 / 億円", read: "oku", meaning: "100,000,000 yen. '1億円' = ¥100,000,000 = 10,000万円." },
  { term: "LDK", read: "—", meaning: "Living + Dining + Kitchen. '3LDK' = 3 bedrooms plus a living/dining/kitchen room." },
  { term: "DK", read: "—", meaning: "Dining + Kitchen (smaller combined eat-in kitchen than LDK)." },
  { term: "K", read: "—", meaning: "Kitchen only. '1K' = one room plus a separate small kitchen." },
  { term: "R / ワンルーム", read: "one-room", meaning: "Studio — a single room with the kitchen inside it." },
  { term: "間取り", read: "madori", meaning: "Floor plan / layout (e.g. 2LDK)." },
  { term: "専有面積", read: "senyu menseki", meaning: "Interior floor area of the unit, in square meters (㎡)." },
  { term: "徒歩", read: "toho", meaning: "Walking. '徒歩10分' = a 10-minute walk (≈80m per minute)." },
  { term: "駅", read: "eki", meaning: "Train station." },
  { term: "沿線", read: "ensen", meaning: "Train line / railway line." },
  { term: "築", read: "chiku", meaning: "Building age. '築15年' = built 15 years ago." },
  { term: "管理費", read: "kanrihi", meaning: "Monthly building management fee (apartments)." },
  { term: "修繕積立金", read: "shuzen tsumitatekin", meaning: "Monthly repair-reserve fund contribution (apartments)." },
  { term: "建ぺい率 / 容積率", read: "kenpeiritsu / yosekiritsu", meaning: "Building-coverage and floor-area ratios — how much you may build on land." },
  { term: "南向き", read: "minami muki", meaning: "South-facing (prized for sunlight)." },
  { term: "角部屋", read: "kado beya", meaning: "Corner unit (more windows, more privacy)." },
  { term: "リフォーム / リノベ", read: "reform / renovation", meaning: "Renovated or refurbished." },
  { term: "ペット可", read: "petto ka", meaning: "Pets allowed." },
  { term: "駐車場", read: "chushajo", meaning: "Parking space." },
];
