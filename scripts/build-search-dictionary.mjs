#!/usr/bin/env node
/**
 * Пересборка search-dictionary.js из прайса Google Sheets + «Товары список.txt».
 *
 * Использование:
 *   node scripts/build-search-dictionary.mjs
 *   node scripts/build-search-dictionary.mjs "../Товары список.txt"
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultInput = path.resolve(__dirname, "../../Товары список.txt");
const outputFile = path.resolve(__dirname, "../public/js/search-dictionary.js");
const configFile = path.resolve(__dirname, "../public/js/config.js");
const inputFile = process.argv[2] ? path.resolve(process.argv[2]) : defaultInput;

// ⚠️ Дополнено 19.09.2026: было ["Prices", "Prices-2"]. Словарь собирался из
// двух листов из четырёх, поэтому не знал ни склада «под заказ» (Prices-3,
// заведён 27.08.2026), ни предзаказа новых айфонов (Prices-4, 15.09.2026).
// Симптом тихий: поиск в магазине просто не находил часть товаров по русскому
// написанию, а сам словарь выглядел живым. Заводя лист прайса, правь и здесь —
// это ЧЕТВЁРТОЕ место, где листы перечислены поимённо (см. план 45).
const SHEET_TABS = ["Prices", "Prices-2", "Prices-3", "Prices-4"];

// Витрина запчастей (план 66). Названия деталей и моделей оттуда тоже должны
// попадать в словарь: клиент ищет «akb 13 pro» и «displey», а в данных лежит
// «АКБ» и «дисплей».
const partsFile = path.resolve(__dirname, "../public/data/parts.json");

const BASE_TRANSLIT = {
  iphone: ["айфон", "аифон", "айфоон", "ифон"],
  ipad: ["айпад", "айпэд", "айпед", "ипад"],
  macbook: ["макбук", "мак бук", "мэкбук", "макбук"],
  airpods: ["аирподс", "аирподсы", "эирподс", "эирподсы", "эйрподс", "эйрподсы", "аир подс", "эир подс"],
  airpod: ["аирпод", "эирпод", "эйрпод"],
  air: ["аир", "эир", "эйр"],
  watch: ["вотч", "воуч", "часы", "ватч"],
  watches: ["вотчес", "часы", "ватчи"],
  ultra: ["ультра", "ульта"],
  series: ["сериес", "серия", "серии", "сириес"],
  samsung: ["самсунг", "самсум", "сасунг"],
  galaxy: ["галакси", "галакси"],
  pencil: ["пенсил", "пэнсил", "пенсель", "пэнсиль"],
  playstation: ["плейстейшн", "плейстейшен", "пс", "плэйстейшн"],
  dyson: ["дайсон", "дисон"],
  skyler: ["скайлер", "скилер", "скйлер", "скиллер", "скайлер"],
  oakley: ["оакли", "оакле", "оукли", "окли", "оуклей"],
  wayfarer: ["вейфарер", "уэйфарер", "вайфарер", "вейферер", "уейфарер"],
  meta: ["мета", "мэта"],
  hstn: ["хстн", "эйчэстэн", "хстен"],
  pro: ["про", "про"],
  max: ["макс"],
  plus: ["плюс", "плас"],
  mini: ["мини", "миди"],
  neo: ["нео", "нио"],
  ancel: ["анцел"],
  anc: ["анц", "энс"],
  cellular: ["селюлар", "селлар", "сотик"],
  gps: ["гпс", "джипиэс", "джи пи эс"],
  lte: ["лте", "л т е"],
  esim: ["есим", "е сим", "эсим", "и сим"],
  sim: ["сим", "симка"],
  wifi: ["вайфай", "вай фай", "wi fi", "вайфи"],
  usb: ["юсб", "усб"],
  gen: ["ген", "поколение"],
  size: ["сайз", "размер"],
  sport: ["спорт", "спортивный"],
  band: ["банд", "ремешок", "браслет"],
  ocean: ["океан", "морской"],
  alpine: ["альпийский", "альпин", "горный"],
  trail: ["трейл", "тропа", "походный"],
  touch: ["тач", "тач"],
  id: ["айди", "ид"],
  blush: ["блаш", "блёш"],
  fog: ["фог", "туман"],
  graphite: ["графит", "графайт"],
  gradient: ["градиент", "градиент"],
  transitions: ["трансишнс", "транзишнс"],
  transition: ["трансишн", "транзишн"],
  amethyst: ["аметист", "аметист"],
  sapphire: ["сапфир", "сапфайр"],
  violet: ["виолет", "виолет"],
  lavender: ["лавендер", "лавандер"],
  ultramarine: ["ультрамарин", "ультрамарин"],
  starlight: ["старлайт", "стар лайт"],
  midnight: ["миднайт", "мид найт"],
  teal: ["тил", "тиал"],
  sage: ["сейдж", "сэйдж"],
  indigo: ["индиго", "индиго"],
  citrus: ["цитрус", "ситрус"],
  orange: ["оранж", "орандж"],
  silver: ["сильвер", "силвер"],
  black: ["блэк", "блек"],
  white: ["вайт", "вейт"],
  blue: ["блю", "блу"],
  pink: ["пинк", "пинк"],
  green: ["грин", "грин"],
  gold: ["голд", "гоулд"],
  gray: ["грей", "грэй"],
  grey: ["грей", "грэй"],
  shiny: ["шайни", "шини"],
  matte: ["матт", "мат"],
  natural: ["нэчурал", "натурал"],
  cosmic: ["космик", "космос"],
  mystic: ["мистик", "мистик"],
  light: ["лайт", "лит"],
  space: ["спейс", "спэйс"],
  cloud: ["клауд", "клауд"],
  soft: ["софт", "софт"],
  mist: ["мист", "мист"],
  jet: ["джет", "джет"],
  rose: ["роуз", "роуз"],
  pur: ["пур", "пюр"],
  shadow: ["шэдоу", "шадоу"],
  accessories: ["аксессуары", "аксесуары", "акссесуары"],
  gb: ["гб", "гигабайт", "гигабайта"],
  tb: ["тб", "терабайт", "терабайта"],
  mm: ["мм", "millimetр", "миллиметров"],
};

// Запчасти (добавлено 19.09.2026). Направление то же, что у остального
// словаря: латиница или английское слово → как это пишут по-русски. Сюда же
// латинская раскладка русских слов — клиент часто набирает «displey», «akb»,
// «shleyf», не переключая язык.
const PARTS_TRANSLIT = {
  display: ["дисплей", "дисплэй", "экран", "диспл"],
  displey: ["дисплей", "экран"],
  screen: ["экран", "дисплей"],
  lcd: ["лсд", "матрица", "дисплей"],
  oled: ["олед", "олед дисплей"],
  battery: ["акб", "аккумулятор", "батарея", "батарейка"],
  akb: ["акб", "аккумулятор", "батарея"],
  akkumulyator: ["аккумулятор", "акб"],
  bataree: ["батарея", "акб"],
  camera: ["камера", "камеру", "камеры"],
  kamera: ["камера"],
  glass: ["стекло", "стекла", "стёкла"],
  steklo: ["стекло"],
  back: ["задняя", "заднее", "зад"],
  zadnee: ["заднее", "задняя"],
  housing: ["корпус", "корпуса"],
  korpus: ["корпус"],
  flex: ["шлейф", "шлейфа", "шлейфы"],
  shleyf: ["шлейф"],
  speaker: ["динамик", "динамика"],
  dinamik: ["динамик"],
  buzzer: ["полифонический динамик", "бузер", "динамик"],
  earpiece: ["слуховой динамик", "разговорный динамик"],
  mic: ["микрофон"],
  microphone: ["микрофон"],
  antenna: ["антенна", "антенны"],
  board: ["материнская плата", "плата", "мать"],
  motherboard: ["материнская плата", "плата"],
  plata: ["плата", "материнская плата"],
  proximity: ["датчик приближения", "приближения"],
  datchik: ["датчик"],
  flash: ["вспышка", "вспышки", "флеш"],
  vspyshka: ["вспышка"],
  adhesive: ["проклейка", "скотч", "клей"],
  proklejka: ["проклейка"],
  magsafe: ["магсейф", "магнит", "магсэйф"],
  magnit: ["магнит", "магсейф"],
  cable: ["кабель", "провод", "шнур"],
  kabel: ["кабель"],
  charger: ["зарядное устройство", "зарядка", "сзу", "блок питания"],
  szu: ["сзу", "зарядное устройство", "зарядка"],
  adapter: ["переходник", "адаптер"],
  perehodnik: ["переходник"],
  original: ["оригинал", "оригинальный"],
  service: ["сервисный", "сервис"],
  copy: ["копия", "аналог", "неоригинал"],
  analog: ["аналог", "копия"],
  zapchast: ["запчасть", "запчасти", "деталь"],
  spare: ["запчасть", "запчасти", "деталь"],
  part: ["деталь", "запчасть"],
};

const EXTENDED_TRANSLIT = {
  instax: ["инстакс", "instax"],
  ps5: ["пс5", "ps 5", "плейстейшн"],
  gamepad: ["геймпад", "джойстик"],
  portal: ["портал"],
  pulse: ["пульс"],
  charging: ["зарядка", "чarging"],
  station: ["станция"],
  yandex: ["яндекс"],
  buds: ["бадс", "buds", "будс"],
  smarttag2: ["смарттег", "smart tag", "метка"],
  pitaka: ["питака"],
  remax: ["римакс", "remax"],
  jbl: ["джи би эл", "jbl"],
  gopro: ["гоупро", "go pro"],
  whoop: ["вуп", "whoop"],
  airtag: ["эйртег", "air tag", "метка apple"],
  apple: ["эпл", "apple", "apple"],
  a16: ["а16", "a16"],
  a18: ["а18", "a18"],
  a37: ["а37", "a37"],
  a56: ["а56", "a56"],
  a57: ["а57", "a57"],
  m3: ["м3", "m3"],
  m4: ["м4", "m4"],
  m5: ["м5", "m5"],
  s11: ["s11", "эс11", "series 11"],
  s25: ["s25", "эс25"],
  s26: ["s26", "эс26"],
  se3: ["se3", "se 3"],
  charcoal: ["charcoal", "чаркоал", "угольный"],
  graygreen: ["graygreen", "грейгрин", "серозеленый"],
  lightgray: ["lightgray", "лайтгрей", "светлосерый"],
  icyblue: ["icyblue", "айсибlue", "ледяной"],
  lilac: ["lilac", "лайлак", "сиреневый"],
  silvershadow: ["silvershadow", "silver shadow"],
  prussian: ["prussian", "prussian blue"],
  yellow: ["yellow", "еллоу", "желтый"],
  purple: ["purple", "пурпл", "фиолетовый"],
  red: ["red", "ред", "красный"],
  brown: ["brown", "braун", "коричневый"],
  cobalt: ["cobalt", "кобalt"],
  navy: ["navy", "нэви", "темносиний"],
  cream: ["cream", "крим", "кремовый"],
  tan: ["tan", "бежевый"],
  flip: ["flip", "флип"],
  link: ["link", "линк"],
  evo: ["evo", "эво"],
  g15: ["g15", "g 15"],
  camouflage: ["camouflage", "камуфляж"],
  carbon: ["carbon", "карбон"],
  ceramic: ["ceramic", "керамик"],
  magnetic: ["magnetic", "магнит"],
  woven: ["woven", "тканевый"],
  milky: ["milky", "milky way", "млечный"],
  wallet: ["wallet", "валлет", "кошелек"],
  loop: ["loop", "луп", "петля"],
  "ray-ban": ["ray ban", "рей бан", "rayban"],
  marshall: ["marshall", "маршал"],
  edge: ["edge", "эдж"],
  chroma: ["chroma", "хрома"],
  audio: ["audio", "аудио"],
  major: ["major", "major iv"],
  peak: ["peak", "peak pro"],
  life: ["life", "sport life"],
  zigbee: ["zigbee", "zig bee"],
  anchor: ["anchor", "анкор"],
  classic: ["classic", "классик"],
  digital: ["digital", "диджитал"],
  polar: ["polar", "полар"],
  hero: ["hero", "хиро"],
  elite: ["elite", "элит"],
  gaming: ["gaming", "гейминг"],
  gadgets: ["gadgets", "гаджеты"],
  glasses: ["glasses", "очки"],
  headliner: ["headliner", "хедлайнер"],
  magic: ["magic", "мэджик"],
  mouse: ["mouse", "маус", "мышь"],
  slim: ["slim", "слим"],
  core: ["core", "кор"],
  disk: ["disk", "диск"],
  dual: ["dual", "дуал"],
  pack: ["pack", "пак"],
  with: ["with", "with"],
  cooper: ["cooper", "купер"],
  cobalt: ["cobalt", "кобalt"],
  amber: ["amber", "амбер"],
  apricot: ["apricot", "априкot"],
  topaz: ["topaz", "тopaz"],
  plum: ["plum", "plum"],
  jasper: ["jasper", "jasper"],
  velvet: ["velvet", "velvet"],
  glint: ["glint", "glint"],
  lucid: ["lucid", "lucid"],
  moonrise: ["moonrise", "moonrise"],
  nickel: ["nickel", "nickel"],
  prussian: ["prussian", "prussian"],
  silk: ["silk", "silk"],
  sunset: ["sunset", "sunset"],
  sterling: ["sterling", "sterling"],
  volcanic: ["volcanic", "volcanic"],
  vinca: ["vinca", "vinca"],
  bright: ["bright", "bright"],
  golden: ["golden", "golden"],
  jetblack: ["jetblack", "jet black"],
  sky: ["sky", "sky"],
  star: ["star", "star"],
  mid: ["mid", "mid"],
  graph: ["graph", "graph"],
  way: ["way", "way"],
  "co-anda": ["coanda", "коанда"],
};

const EXTENDED_TRANSLATE = [
  ["back glass", ["заднее стекло", "задняя крышка", "зад стекло"]],
  ["back cover", ["задняя крышка", "заднее стекло"]],
  ["camera glass", ["стекло камеры", "стеклышко камеры"]],
  ["protective glass", ["защитное стекло", "защита экрана"]],
  ["front camera", ["фронтальная камера", "фронталка", "селфи камера"]],
  ["rear camera", ["основная камера", "задняя камера"]],
  ["charging port", ["нижний шлейф", "разъём зарядки", "разъем зарядки"]],
  ["dock connector", ["нижний шлейф", "разъём зарядки"]],
  ["power flex", ["шлейф кнопок", "шлейф кнопки питания"]],
  ["volume flex", ["шлейф кнопок", "шлейф громкости"]],
  ["proximity sensor", ["шлейф датчика приближения", "датчик приближения"]],
  ["flash flex", ["шлейф вспышки", "вспышка"]],
  ["loud speaker", ["полифонический динамик", "нижний динамик"]],
  ["ear speaker", ["слуховой динамик", "разговорный динамик", "верхний динамик"]],
  ["logic board", ["материнская плата", "системная плата"]],
  ["service original", ["сервисный оригинал", "оригинал сервисный"]],

  ["airpods max 2026", ["аирподс макс 2026", "эирподс макс", "наушники max 2026"]],
  ["airpods max 2024", ["аирподс макс 2024", "эирподс макс", "наушники max"]],
  ["airpods max", ["аирподс макс", "эирподс макс", "эйрподс макс", "наушники max"]],
  ["airpods pro 3", ["аирподс про 3", "эирподс про 3", "pro 3"]],
  ["airpods 4 anc", ["аирподс 4 anc", "аирподс 4 с шумодавом", "airpods 4 with anc"]],
  ["ps5 pro 2tb", ["пс5 про 2тб", "ps5 pro 2tb", "playstation 5 pro"]],
  ["ps5 pro", ["пс5 про", "ps5 pro", "плейстейшн 5 про"]],
  ["ps5 portal", ["портал ps5", "portal ps5", "плейстейшн портал"]],
  ["ps5 pulse elite", ["pulse elite", "пульс элит", "наушники ps5 elite"]],
  ["ps5 pulse 3d", ["pulse 3d", "пульс 3д", "наушники ps5 3d"]],
  ["dual charging station", ["док станция", "зарядная станция dual", "станция зарядки"]],
  ["gamepad ps5", ["геймпад ps5", "геймпад пс5", "джойстик ps5"]],
  ["подставка ps5", ["подставка ps5", "стойка ps5", "stand ps5"]],
  ["instax mini link 3", ["инстакс link 3", "mini link 3", "instax link"]],
  ["instax mini evo", ["инстакс evo", "mini evo", "instax evo"]],
  ["instax mini 12", ["инстакс mini 12", "instax 12", "полароид mini 12"]],
  ["instax mini", ["инстакс мини", "instax mini", "полароид"]],
  ["galaxy smarttag2", ["smarttag2", "smart tag 2", "метка samsung", "смарт тег"]],
  ["galaxy buds 3 pro", ["galaxy buds 3 pro", "галакси buds pro", "наушники samsung pro"]],
  ["galaxy buds 3", ["galaxy buds 3", "галакси buds 3", "наушники samsung"]],
  ["galaxy buds", ["galaxy buds", "галакси бадс", "наушники samsung"]],
  ["galaxy watch ultra", ["galaxy watch ultra", "галакси вотч ультра", "часы samsung ultra"]],
  ["galaxy watch 8 classic", ["galaxy watch 8 classic", "watch 8 classic", "часы samsung classic"]],
  ["galaxy watch 8", ["galaxy watch 8", "watch 8", "часы samsung 8"]],
  ["galaxy watch 7", ["galaxy watch 7", "watch 7", "часы samsung 7"]],
  ["galaxy watch", ["galaxy watch", "галакси вотч", "часы samsung"]],
  ["s26 ultra", ["с26 ультра", "s26 ultra", "galaxy s26 ultra", "самсунг s26"]],
  ["s25 ultra", ["с25 ультра", "s25 ultra", "galaxy s25 ultra"]],
  ["samsung a57", ["samsung a57", "а57", "самсунг а57", "galaxy a57"]],
  ["samsung a56", ["samsung a56", "а56", "самсунг а56", "galaxy a56"]],
  ["samsung a37", ["samsung a37", "а37", "самсунг а37", "galaxy a37"]],
  ["яндекс станция миди", ["яндекс станция midi", "станция midi", "алиса midi"]],
  ["яндекс станция мини 3 про", ["станция мини 3 про", "мини 3 про", "алиса мини про"]],
  ["яндекс станция мини 3", ["станция мини 3", "мини 3", "алиса мини"]],
  ["яндекс станция лайт 2", ["станция лайт 2", "лайт 2", "алиса лайт"]],
  ["яндекс станция", ["яндекс станция", "станция алиса", "алиса станция", "yandex station"]],
  ["яндекс модуль 2", ["модуль 2", "яндекс модуль", "hub module"]],
  ["dyson airstrait", ["dyson airstrait", "эйрстrait", "выпрямитель dyson"]],
  ["dyson airwrap", ["dyson airwrap", "эйррап", "стайлер dyson"]],
  ["dyson supersonic", ["dyson supersonic", "супersonic", "фен dyson"]],
  ["dyson wash g1", ["dyson wash g1", "wash g1", "мойка dyson"]],
  ["dyson v16", ["dyson v16", "v16", "пылесос dyson v16"]],
  ["dyson", ["дайсон", "dyson", "дисон"]],
  ["jbl flip 7", ["jbl flip 7", "flip 7", "колонка jbl flip"]],
  ["jbl charge 6", ["jbl charge 6", "charge 6", "колонка jbl charge"]],
  ["jbl tune 770", ["jbl tune 770", "tune 770", "наушники jbl"]],
  ["jbl", ["jbl", "джи би эл", "джибиэл"]],
  ["gopro hero 13", ["gopro hero 13", "hero 13", "гоупро 13"]],
  ["gopro", ["gopro", "go pro", "гоупро", "экшн камера"]],
  ["whoop 5", ["whoop 5", "whoop peak", "вуп 5", "браслет whoop"]],
  ["whoop", ["whoop", "вуп", "whoop life"]],
  ["airtag", ["airtag", "эйртег", "air tag", "метка apple"]],
  ["apple pencil pro", ["apple pencil pro", "эпл пенсил про", "pencil pro"]],
  ["apple pencil usb-c", ["apple pencil usb-c", "эпл пенсил usb", "pencil usb c"]],
  ["apple pencil 2", ["apple pencil 2", "эпл пенсил 2", "pencil 2"]],
  ["apple pencil", ["apple pencil", "эпл пенсил", "карандаш apple"]],
  ["ipad pro 11 m5", ["ipad pro 11 m5", "айпад про 11 m5", "айпэд про 11"]],
  ["ipad pro 11", ["ipad pro 11", "айпад про 11", "айпэд про"]],
  ["ipad air 11 m4", ["ipad air 11 m4", "айпад эир 11 m4", "айпэд air m4"]],
  ["ipad air 11 m3", ["ipad air 11 m3", "айпад эир 11 m3", "айпэд air m3"]],
  ["ipad air", ["ipad air", "айпад эир", "айпэд air"]],
  ["ipad 11 a16", ["ipad 11 a16", "айпад 11 a16", "айпэд 11"]],
  ["macbook air 15 m5", ["macbook air 15 m5", "макбук эир 15 m5", "макбук air 15"]],
  ["macbook air 13 m5", ["macbook air 13 m5", "макбук эир 13 m5", "макбук air 13 m5"]],
  ["macbook air 13 m4", ["macbook air 13 m4", "макбук эир 13 m4", "макбук air 13 m4"]],
  ["macbook neo 13 a18 pro", ["macbook neo 13", "макбук нео 13 a18", "neo a18 pro"]],
  ["macbook neo touch id", ["macbook neo touch id", "макбук нео touch id", "neo touch id"]],
  ["a18 pro", ["a18 pro", "а18 про"]],
  ["16+ 512gb", ["16 гб 512 гб", "16гб 512гб", "16 512"]],
  ["16+ 256gb", ["16 гб 256 гб", "16гб 256гб", "16 256"]],
  ["8+ 512gb", ["8 гб 512 гб", "8гб 512гб", "8 512"]],
  ["8+ 256gb", ["8 гб 256 гб", "8гб 256гб", "8 256"]],
  ["12+ 512gb", ["12 гб 512 гб", "12гб 512гб", "12 512"]],
  ["12+ 256gb", ["12 гб 256 гб", "12гб 256гб", "12 256"]],
  ["8/256", ["8 256", "8/256", "8 на 256"]],
  ["8/128", ["8 128", "8/128", "8 на 128"]],
  ["12/512", ["12 512", "12/512", "12 на 512"]],
  ["12/256", ["12 256", "12/256", "12 на 256"]],
  ["series 11 46mm", ["series 11 46mm", "watch 11 46", "s11 46mm"]],
  ["series 11 42mm", ["series 11 42mm", "watch 11 42", "s11 42mm"]],
  ["series 11", ["series 11", "серия 11", "watch 11", "s11"]],
  ["s11 46mm", ["s11 46mm", "series 11 46", "watch 46"]],
  ["s11 42mm", ["s11 42mm", "series 11 42", "watch 42"]],
  ["s11", ["s11", "series 11", "эпл вотч 11", "watch 11"]],
  ["series se 3", ["series se 3", "se 3", "watch se 3", "se3"]],
  ["se3 44mm", ["se3 44mm", "se 3 44", "watch se 44"]],
  ["se3 40mm", ["se3 40mm", "se 3 40", "watch se 40"]],
  ["se3", ["se3", "se 3", "watch se3"]],
  ["pitaka galaxy watch", ["pitaka watch", "питака galaxy watch", "ремешок pitaka watch"]],
  ["pitaka", ["pitaka", "питака"]],
  ["защитное стекло remax", ["стекло remax", "remax стекло", "защитное remax"]],
  ["remax", ["remax", "римакс"]],
  ["чехол pitaka", ["чехол pitaka", "pitaka case", "питака чехол"]],
  ["чехол-bумажник pitaka", ["чехол бумажник pitaka", "pitaka wallet", "питака кошелек"]],
  ["milky way", ["milky way", "млечный путь", "milkyway"]],
  ["charcoal", ["угольный", "charcoal", "серый", "графитовый"]],
  ["graygreen", ["серозеленый", "gray green", "серо зеленый"]],
  ["lightgray", ["светлосерый", "light gray", "светло серый"]],
  ["icyblue", ["ледяной синий", "icy blue", "айси блю"]],
  ["lilac", ["сиреневый", "lilac", "лиловый"]],
  ["silvershadow", ["silver shadow", "серебряная тень", "серебристый"]],
  ["prussian", ["прусский синий", "prussian blue", "темно синий"]],
  ["yellow", ["желтый", "жёлтый", "yellow"]],
  ["purple", ["фиолетовый", "purple", "пурпурный"]],
  ["red", ["красный", "red"]],
  ["brown", ["коричневый", "brown"]],
  ["cobalt", ["кobalt", "кобальт", "синий"]],
  ["navy", ["navy", "темносиний", "темно синий"]],
  ["cream", ["кремовый", "cream", "бежевый"]],
  ["tan", ["бежевый", "tan", "загар"]],
  ["camouflage", ["камуфляж", "camo", "camouflage"]],
  ["carbon", ["carbon", "карбон", "карбоновый"]],
  ["marshall major iv", ["marshall major 4", "major iv", "маршал major"]],
  ["marshall", ["marshall", "маршал"]],
  ["ray-ban meta", ["ray ban meta", "рей бан meta", "очки ray ban meta"]],
  ["ray-ban", ["ray ban", "рей бан", "rayban"]],
];

const IGNORE_TOKEN =
  /^(?:[a-z]{1,2}\/a|(?:mw|md|me|mx|mf|sm)[a-z0-9]{2,6}|(?:mxp|mx2|muw|mfh|mee|meh|meu|mev|mew|mf0)[a-z0-9]{2,5}|tb-\d+|zaf)$/i;

function readSheetId() {
  if (!fs.existsSync(configFile)) return "";
  const text = fs.readFileSync(configFile, "utf8");
  const match = text.match(/googleSheetId:\s*"([^"]+)"/);
  return match?.[1] || "";
}

async function fetchSheetLines(sheetId) {
  const lines = [];
  for (const tab of SHEET_TABS) {
    const url =
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}&range=A1:F2000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Sheet ${tab}: HTTP ${res.status}`);
    const text = await res.text();
    const jsonText = text.match(/setResponse\(([\s\S]*)\);?\s*$/)?.[1];
    if (!jsonText) continue;
    const data = JSON.parse(jsonText);
    for (const row of data?.table?.rows || []) {
      const cells = row.c || [];
      const parts = [];
      for (let i = 0; i < Math.min(4, cells.length); i += 1) {
        if (cells[i]?.v != null) parts.push(String(cells[i].v).trim());
      }
      if (parts.length) lines.push(parts.join(" "));
    }
  }
  return lines;
}

function normalizeLine(line) {
  return line
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLatinTokens(lines) {
  const tokens = new Set();
  for (const raw of lines) {
    const line = normalizeLine(raw).toLowerCase();
    if (!line) continue;
    const words = line.match(/[a-z][a-z0-9+./-]*/gi) || [];
    for (const word of words) {
      const token = word.replace(/\./g, "");
      if (token.length < 2 || /^\d+$/.test(token)) continue;
      if (IGNORE_TOKEN.test(token)) continue;
      tokens.add(token);
    }
  }
  return [...tokens].sort();
}

function parseExistingDict(content) {
  const match = content.match(/window\.IRON_SEARCH_DICT\s*=\s*(\{[\s\S]*\})\s*;\s*$/);
  if (!match) {
    throw new Error("Не удалось прочитать IRON_SEARCH_DICT из " + outputFile);
  }
  return Function(`"use strict"; return (${match[1]});`)();
}

function mergeTranslate(existing, additions) {
  const seen = new Set(existing.map(([en]) => en.toLowerCase()));
  const merged = [...existing];
  for (const entry of additions) {
    const key = entry[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged.sort((a, b) => b[0].length - a[0].length);
}

function mergeTranslit(existing, base, extended, tokens) {
  const merged = { ...existing, ...base, ...extended };
  for (const token of tokens) {
    if (merged[token] || !/^[a-z]/.test(token)) continue;
    merged[token] = [token];
  }
  return Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => a.localeCompare(b, "en"))
  );
}

async function main() {
  const sheetId = readSheetId();
  const sourceLines = [];
  const источники = [];

  if (fs.existsSync(inputFile)) {
    sourceLines.push(...fs.readFileSync(inputFile, "utf8").split(/\r?\n/));
    источники.push(path.basename(inputFile));
  } else {
    console.warn("Файл списка товаров не найден, пропускаю:", inputFile);
  }

  // Витрина запчастей — такой же источник строк, как прайс: из неё берутся
  // латинские токены (модели, A-номера матриц MacBook) и она же держит словарь
  // честным, когда у Витали появляются новые позиции.
  if (fs.existsSync(partsFile)) {
    try {
      const parts = JSON.parse(fs.readFileSync(partsFile, "utf8"));
      const lines = (parts["позиции"] || []).map((i) =>
        [i["узел"], i["модель"], i["вариант"], i["цвет"]].filter(Boolean).join(" "));
      sourceLines.push(...lines);
      источники.push("витрина запчастей");
      console.log("Строк из витрины запчастей:", lines.length);
    } catch (err) {
      console.warn("parts.json не прочитан:", err.message);
    }
  }

  if (sheetId) {
    try {
      const sheetLines = await fetchSheetLines(sheetId);
      sourceLines.push(...sheetLines);
      источники.push(`листы прайса (${SHEET_TABS.join(", ")})`);
      console.log("Строк из Google Sheet:", sheetLines.length);
    } catch (err) {
      console.warn("Google Sheet недоступен:", err.message);
    }
  } else {
    console.warn("googleSheetId не найден в config.js");
  }

  if (!sourceLines.length) {
    console.error("Нет данных для сборки словаря");
    process.exit(1);
  }

  const tokens = extractLatinTokens(sourceLines);
  const existing = parseExistingDict(fs.readFileSync(outputFile, "utf8"));
  const translit = mergeTranslit(existing.translit, BASE_TRANSLIT, { ...EXTENDED_TRANSLIT, ...PARTS_TRANSLIT }, tokens);
  const translate = mergeTranslate(existing.translate, EXTENDED_TRANSLATE);

  // Шапка перечисляет ТОЛЬКО те источники, которые реально прочитались.
  // Раньше здесь всегда стояло «из Google Sheet + Товары список.txt», даже
  // когда файла не было на диске. В ежедневном прогоне на GitHub Actions его
  // не бывает вовсе — там выложен только репозиторий сайта, а список товаров
  // лежит в соседнем, приватном. Потерь от этого нет (слияние умеет только
  // добавлять), но шапка обязана говорить правду: по ней судят, свежий ли
  // словарь и откуда он собран.
  const header = `/**
 * Словари поиска магазина IRON SERVICE.
 * Сгенерировано: ${new Date().toISOString().slice(0, 10)}
 * Источники: ${источники.join(", ") || "только прежний словарь"}
 * Пересборка: node scripts/build-search-dictionary.mjs
 */
window.IRON_SEARCH_DICT = {
  /** en/латиница → варианты русской записи и транслита */
  translit: ${JSON.stringify(translit, null, 4).replace(/^/gm, "  ")},
  /**
   * Прямой перевод EN → RU с синонимами. Длинные фразы — выше в списке.
   * Формат: [ "английский термин", ["синоним1", "синоним2", ...] ]
   */
  translate: ${JSON.stringify(translate, null, 4).replace(/^/gm, "  ")},
};
`;

  // ——— Проверка перед записью (19.09.2026) ——————————————————————————
  //
  // Пересборка идёт автоматически в ежедневном прогоне карточек, и файл после
  // неё коммитится и уезжает на боевой сайт. Значит «собралось как-то» здесь
  // недопустимо: молча испорченный словарь никто не заметит, потому что
  // потребители (`prices.js`, `parts.js`) переживают его отсутствие тихо —
  // поиск просто перестаёт понимать «айфон» и «akb».
  //
  // Три проверки, все дешёвые:
  //   1) результат разбирается тем же парсером, что читает существующий файл;
  //   2) словарь не УМЕНЬШИЛСЯ — слияние умеет только добавлять, поэтому
  //      падение числа записей означает поломку, а не изменение прайса;
  //   3) в нём есть опорные слова, без которых поиск заведомо сломан.
  // Не прошло — файл не трогаем и выходим с ненулевым кодом.
  const ОПОРНЫЕ = ["iphone", "ipad", "macbook", "airpods", "watch"];
  const было = { translit: Object.keys(existing.translit).length, translate: existing.translate.length };
  const стало = { translit: Object.keys(translit).length, translate: translate.length };

  const беды = [];
  const проверка = parseExistingDict(header);
  if (!proverkaOk(проверка)) беды.push("результат не разбирается обратно");
  if (стало.translit < было.translit) беды.push(`токенов стало меньше: ${было.translit} → ${стало.translit}`);
  if (стало.translate < было.translate) беды.push(`переводов стало меньше: ${было.translate} → ${стало.translate}`);
  const нет = ОПОРНЫЕ.filter((k) => !translit[k]);
  if (нет.length) беды.push(`пропали опорные слова: ${нет.join(", ")}`);

  if (беды.length) {
    console.error("Словарь НЕ записан, проверки не прошли:");
    беды.forEach((b) => console.error("  •", b));
    console.error("Прежний файл оставлен как был:", outputFile);
    process.exit(1);
  }

  fs.writeFileSync(outputFile, header, "utf8");
  console.log("OK:", outputFile);
  console.log(`Токенов translit: ${стало.translit} (было ${было.translit})`);
  console.log(`Записей translate: ${стало.translate} (было ${было.translate})`);
  console.log("Строк в источнике:", sourceLines.length);
}

/** Разбор вернул непустые словари обеих половин. */
function proverkaOk(parsed) {
  return Boolean(parsed)
    && parsed.translit && Object.keys(parsed.translit).length > 0
    && Array.isArray(parsed.translate) && parsed.translate.length > 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
