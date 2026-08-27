"""Перевод детальных карточек товара на английский (18.08.2026).

Зачем это здесь, а не на сайте: страницы генерируются скриптом и лежат в
репозитории готовым HTML. Переводить их на клиенте — значит отдавать поисковику
русскую страницу с пометкой lang="en"; для англоязычного поиска, ради которого
всё и затевалось, это бесполезно. Поэтому перевод происходит при генерации, и
английская карточка становится обычной статической страницей с английским
текстом внутри.

Характеристики приходят из каталога поставщика (dr-store) и переводятся тремя
слоями, строго в этом порядке:

1. PHRASES — устойчивые сочетания целиком. Нужны там, где пословный перевод даёт
   неверный порядок слов: «датчик приближения» пословно превращается в «sensor
   proximity», а не в «proximity sensor».
2. UNITS — единицы измерения правилом. Значений с числами в каталоге сколько
   угодно («4252 мАч», «163.4 мм»), перечислять их бессмысленно.
3. WORDS — пословно, всё остальное.

Не перевелось хотя бы одно русское слово — строка остаётся русской ЦЕЛИКОМ (то
же правило «всё или ничего», что в магазине). Наполовину переведённая
характеристика читается как поломка сайта, а русская — просто как русская.
Правило действует на отдельную характеристику, а не на страницу: остальные
строки таблицы от одного незнакомого слова не страдают.
"""

from __future__ import annotations

import re

# Подписи интерфейса карточки.
UI = {
    "back": "← Back to Shop",
    "price": "Price:",
    "price_note": "Cash price · from the current IRON SERVICE price list",
    "specs": "Specifications",
    "pick": "+ Select",
    "preorder": "🛩️ to order, 1–2 days",
    "about": "<strong>IRON SERVICE</strong> — Apple shop and repair workshop in Sochi, Moskovskaya Street 5.",
    "order": "Orders:",
    "footer_legal": "Independent Apple service in Sochi. Not an official Apple Inc. website.",
    "meta_description": "{name} — current price and specifications at IRON SERVICE, Sochi.",
}

# Названия характеристик. Список закрытый: в каталоге их 82.
SPEC_KEYS = {
    "Аудиотехнологии": "Audio technologies",
    "Беспроводная зарядка": "Wireless charging",
    "Беспроводные модули": "Wireless",
    "Быстрая зарядка": "Fast charging",
    "Вес": "Weight",
    "Веб-камера": "Webcam",
    "Влагозащищенный корпус": "Water-resistant body",
    "Водонепроницаемость": "Water resistance",
    "Время зарядки": "Charging time",
    "Время работы": "Battery life",
    "Встроенная память": "Storage",
    "Встроенный динамик": "Built-in speaker",
    "Встроенный микрофон": "Built-in microphone",
    "Высота": "Height",
    "Голосовой помощник": "Voice assistant",
    "Графический процессор": "Graphics",
    "Датчики": "Sensors",
    "Диагональ": "Screen size",
    "Диаметр": "Diameter",
    "Диафрагма основной камеры": "Rear camera aperture",
    "Диафрагма фронтальной камеры": "Front camera aperture",
    "Длина": "Length",
    "Дополнительно": "Additional",
    "Замедленная видеосъемка": "Slow-motion video",
    "Интерфейсы": "Ports",
    "Клавиатура": "Keyboard",
    "Количество графических ядер": "GPU cores",
    "Количество основных (тыловых) камер": "Rear cameras",
    "Количество ядер процессора": "CPU cores",
    "Контрастность": "Contrast ratio",
    "Максимальная яркость": "Peak brightness",
    "Материал": "Material",
    "Материал ремешка": "Strap material",
    "Модель": "Model",
    "Мониторинг": "Tracking",
    "Недостаток": "Limitation",
    "Оперативная память": "Memory",
    "Операционная система": "Operating system",
    "Оптическая стабилизация": "Optical stabilisation",
    "Особенности": "Features",
    "Особенности экрана": "Display features",
    "Плотность пикселей": "Pixel density",
    "Поддержка": "Support",
    "Поддержка гаммы P3": "P3 wide colour",
    "Подсветка клавиш": "Backlit keys",
    "Покрытие экрана": "Screen coating",
    "Производитель": "Manufacturer",
    "Процессор": "Processor",
    "Разрешение": "Resolution",
    "Разрешение видеосъемки": "Video resolution",
    "Разрешение основной камеры": "Rear camera",
    "Разрешение фронтальной камеры": "Front camera",
    "Размер ремешка": "Strap size",
    "SIM-карта": "SIM",
    "Сенсорный экран": "Touchscreen",
    "Сертификация": "Certification",
    "Системы навигации": "Navigation",
    "Совместимость": "Compatibility",
    "Сотовая и беспроводная сеть": "Cellular and wireless",
    "Спутниковая навигация": "Satellite navigation",
    "Срок гарантии": "Warranty period",
    "Стандарт влагозащиты": "Water and dust resistance",
    "Страна производства": "Country of manufacture",
    "Технологии": "Technologies",
    "Технологии камеры": "Camera technologies",
    "Технология дисплея": "Display technology",
    "Тип аккумулятора": "Battery type",
    "Тип дисплея": "Display type",
    "Тип матрицы": "Panel type",
    "Тип питания": "Power",
    "Тип устройства": "Device type",
    "Толщина": "Depth",
    "Трекпад": "Trackpad",
    "Уведомления": "Notifications",
    "Устойчивое к царапинам стекло": "Scratch-resistant glass",
    "Функции": "Functions",
    "Цвет": "Colour",
    "Цвет ремешка": "Strap colour",
    "Частота процессора": "CPU frequency",
    "Ширина": "Width",
    "Яркость": "Brightness",
    "Ёмкость аккумулятора": "Battery capacity",
}

# Устойчивые сочетания. Порядок применения — от длинных к коротким, иначе
# короткая фраза съедает кусок длинной и остаток становится непереводимым.
PHRASES = {
    "невозможно установить и использовать RuStore": "the RuStore app store cannot be installed or used",
    "Always-On display. ProMotion с адаптивной частотой обновления до 120 Гц":
        "Always-On display. ProMotion with adaptive refresh rate up to 120 Hz",
    "ProMotion с адаптивной частотой обновления до 120 Гц":
        "ProMotion with adaptive refresh rate up to 120 Hz",
    "гироскоп с высоким динамическим диапазоном": "high dynamic range gyroscope",
    "акселерометр с высокой перегрузкой": "high-g accelerometer",
    "датчик приближения": "proximity sensor",
    "датчик внешней освещенности": "ambient light sensor",
    "датчик внешней освещённости": "ambient light sensor",
    "Датчик внешней освещенности": "Ambient light sensor",
    "датчик освещенности": "light sensor",
    "датчик освещённости": "light sensor",
    "Датчик освещенности": "Light sensor",
    "Датчик освещённости": "Light sensor",
    "датчик отпечатка пальца": "fingerprint sensor",
    "Датчик отпечатка пальца": "Fingerprint sensor",
    "сканер отпечатка пальца": "fingerprint scanner",
    "датчик температуры воды": "water temperature sensor",
    "датчик температуры": "temperature sensor",
    "датчик уровня кислорода в крови": "blood oxygen sensor",
    "датчик кислорода в крови": "blood oxygen sensor",
    "Электрический датчик сердечного ритма": "Electrical heart rate sensor",
    "электрический датчик сердечной активности": "electrical heart sensor",
    "Оптический датчик сердечного ритма третьего поколения": "Third-generation optical heart rate sensor",
    "оптический датчик сердечного ритма": "optical heart rate sensor",
    "мониторинг частоты сердечных сокращений": "heart rate monitoring",
    "Барометрический высотомер": "Barometric altimeter",
    "барометрический высотомер": "barometric altimeter",
    "трёхосевой гироскоп": "three-axis gyroscope",
    "Трехосевой гироскоп": "Three-axis gyroscope",
    "трехосевой гироскоп": "three-axis gyroscope",
    "гироскопический датчик": "gyroscope",
    "геомагнитный датчик": "geomagnetic sensor",
    "датчик Холла": "Hall sensor",
    "датчик падения": "fall detection",
    "Датчик падения": "Fall detection",
    "детектор ДТП": "crash detection",
    "распознавание аварий": "crash detection",
    "экстренная помощь": "emergency SOS",
    "экстренные вызовы": "emergency calls",
    "обнаружение падения": "fall detection",
    "стадии сна": "sleep stages",
    "Постоянно включенный дисплей": "Always-On display",
    "постоянно включенный дисплей": "always-on display",
    "всегда включённый дисплей": "always-on display",
    "поддержка Dolby Atmos": "Dolby Atmos support",
    "с поддержкой Dolby Atmos": "with Dolby Atmos support",
    "NFC с поддержкой режима считывания": "NFC with reader mode",
    "экспресс-карты с резервным питанием": "express cards with power reserve",
    "экспресс‑карты с резервным питанием": "express cards with power reserve",
    "Стереодинамики": "Stereo speakers",
    "стерео динамики": "stereo speakers",
    "стереодинамики": "stereo speakers",
    "звуковая система с двумя динамиками": "two-speaker sound system",
    "встроенные динамики": "built-in speakers",
    "моно динамик": "mono speaker",
    "активное шумоподавление": "active noise cancellation",
    "активного шумоподавления": "active noise cancellation",
    "с активным шумоподавлением": "with active noise cancellation",
    "режим прозрачности": "transparency mode",
    "двухчастотный GPS": "dual-frequency GPS",
    "Умные часы": "Smartwatch",
    "умные часы": "smartwatch",
    "Собственный аккумулятор": "Built-in battery",
    "Женского здоровья": "Cycle tracking",
    "Физическая активность": "Activity",
    "По видам спорта": "Workout types",
    "О входящем звонке": "Incoming calls",
    "О нерегулярном ритме сердца": "Irregular heart rhythm",
    "О разряде батареи": "Low battery",
    "О слишком низком и высоком пульсе": "High and low heart rate",
    "От смартфона": "From the phone",
    "Встроенная, без цифрового блока": "Built-in, no numeric keypad",
    "Встроенный, с поддержкой Force Touch и Multitouch": "Built-in, Force Touch and Multitouch",
    "продается отдельно": "sold separately",
    "через адаптер": "via adapter",
    "водонепроницаемость на глубине до": "water resistant to a depth of",
    "защита от пыли": "dust protection",
    "Глянцевый, антибликовый": "Glossy, anti-reflective",
    "Антибликовое покрытие": "Anti-reflective coating",
    "антибликовое покрытие": "anti-reflective coating",
    "титановый корпус": "titanium body",
    "алюминиевая рамка": "aluminium frame",
    "закаленное стекло": "tempered glass",
    "из сапфирового стекла": "sapphire crystal",
    "при обычном использовании": "in typical use",
    "в режиме пониженного энергопотребления": "in low power mode",
    "Сияющая звезда": "Starlight",
    "розовое золото": "rose gold",
    "с поддержкой": "with",
    "распознавания голоса": "voice recognition",
    "с формированием луча": "with beamforming",
    "с двойным обращенным внутрь микрофоном": "with dual inward-facing microphone",
    "определения усилия": "force detection",
    "обнаружения положения в ухе": "in-ear detection",
    "сенсорное управление": "touch controls",
    "магнитное крепление": "magnetic attachment",
    "функция поиска": "find my support",
    "подходит для запястий": "fits wrists",
    "управление жестами": "gesture control",
    "отслеживание цикла с ретроспективной оценкой овуляции":
        "cycle tracking with retrospective ovulation estimates",
    "система изоляции голоса": "voice isolation",
    "широкое стерео": "wide stereo",
    "многоканального звука": "multichannel audio",
    "пространственного звука": "spatial audio",
    "при воспроизведении музыки или видео": "for music and video playback",
    "мегапиксельная камера": "MP camera",
    "с поддержкой записи видео высокой четкости": "with high-definition video recording",
    "камера Center Stage": "Center Stage camera",
}

# Единицы измерения — правилом, а не перечислением.
UNITS = [
    (r"\bкд/\s*м2\b", "cd/m²"),
    (r"\bкд/﻿?м²", "cd/m²"),
    (r"\bпикс/дюйм\b", "ppi"),
    (r"\bпикселей/дюйм\b", "ppi"),
    (r"\bпикселей\b", "pixels"),
    (r"\bмАч\b", "mAh"),
    (r"\bВт/ч\b", "Wh"),
    (r"\bвТч\b", "Wh"),
    (r"\bВт\b", "W"),
    (r"\bМп\b|\bМП\b", "MP"),
    (r"\bГГц\b", "GHz"),
    (r"\bГц\b", "Hz"),
    (r"Гб/с", "Gbps"),
    (r"Мб/с", "Mbps"),
    (r"\bГБ\b|(?<![а-яА-ЯёЁ])Гб\b", "GB"),
    (r"\bТБ\b|\bТб\b", "TB"),
    (r"\bМБ\b|(?<![а-яА-ЯёЁ])Мб\b", "MB"),
    (r"\bмм\b", "mm"),
    (r"\bсм\b", "cm"),
    (r"(?<=\d\s)м\b|(?<=\d)м\b", "m"),
    (r"\bг\b", "g"),
    (r"\bкг\b", "kg"),
    (r"\bч\b", "h"),
    (r"\bмин\b", "min"),
    (r"\bядер\b|\bядра\b|\bядро\b", "cores"),
    (r"\bмесяцев\b|\bмесяца\b", "months"),
    (r"\bчасов\b|\bчаса\b", "hours"),
    (r"\bметров\b", "metres"),
    (r"\bгод\b|\bлет\b", "year"),
]

# Пословный фолбэк для всего, что не попало в фразы.
WORDS = {
    "с": "with", "и": "and", "до": "up to", "в": "in", "для": "for", "от": "from",
    "или": "or", "без": "without", "на": "at", "при": "in", "по": "by", "о": "for",
    "через": "via", "из": "from", "два": "two", "три": "three", "один": "one",
    "восемь": "eight", "да": "yes", "есть": "yes", "нет": "no",
    "поддержка": "support", "поддержкой": "support", "поддерживается": "supported",
    "датчик": "sensor", "датчика": "sensors", "датчики": "sensors",
    "акселерометр": "accelerometer", "гироскоп": "gyroscope", "барометр": "barometer",
    "компас": "compass", "альтиметр": "altimeter", "высотомер": "altimeter",
    "глубиномер": "depth gauge", "приближения": "proximity",
    "освещенности": "ambient light", "освещённости": "ambient light",
    "внешней": "ambient", "температуры": "temperature", "воды": "water",
    "сердечного": "heart", "сердечной": "heart", "сердечных": "heart",
    "ритма": "rate", "ритме": "rhythm", "сокращений": "rate", "активности": "activity",
    "кислорода": "oxygen", "крови": "blood", "оптический": "optical",
    "электрический": "electrical", "трёхосевой": "three-axis", "трехосевой": "three-axis",
    "гироскопический": "gyroscope", "геомагнитный": "geomagnetic", "холла": "Hall",
    "падения": "fall detection", "поколения": "generation", "третьего": "third",
    "высокой": "high", "высоким": "high", "динамическим": "dynamic",
    "диапазоном": "range", "перегрузкой": "g-force",
    "основная": "main", "сверхширокоугольная": "ultra-wide", "телефото": "telephoto",
    "широкоугольный": "wide-angle", "камера": "camera", "камеры": "cameras",
    "мегапиксельная": "megapixel", "разрешением": "resolution",
    "стекло": "glass", "стекла": "glass", "алюминий": "aluminium",
    "алюминиевая": "aluminium", "титан": "titanium", "титановый": "titanium",
    "титановая": "titanium", "рамка": "frame", "корпус": "body", "корпуса": "body",
    "материал": "material", "металл": "metal", "поликарбонат": "polycarbonate",
    "полиуретан": "polyurethane", "фторэластомер": "fluoroelastomer", "тпу": "TPU",
    "авиационный": "aerospace-grade", "сапфирового": "sapphire",
    "закаленное": "tempered", "устройства": "device", "устройство": "device",
    "чёрный": "black", "черный": "black", "белый": "white", "синий": "blue",
    "голубой": "light blue", "красный": "red", "серый": "grey", "серебристый": "silver",
    "золото": "gold", "золотой": "gold", "розовое": "rose", "розовый": "pink",
    "фиолетовый": "purple", "сиреневый": "lilac", "пустынный": "desert",
    "цветной": "colour", "цвет": "colour",
    "сияющая": "starlight", "звезда": "starlight",
    "динамик": "speaker", "динамики": "speakers", "динамиками": "speakers",
    "динамиках": "speakers", "микрофон": "microphone", "микрофона": "microphones",
    "микрофоны": "microphones", "микрофонов": "microphones", "наушник": "earbud",
    "наушников": "earbuds", "наушниках": "earbuds", "кейс": "case", "кейсе": "case",
    "амбушюра": "ear tip", "уха": "ear", "ухе": "ear", "левая": "left",
    "звука": "audio", "звук": "audio", "аудио-": "audio", "стерео": "stereo",
    "моно": "mono", "шумоподавление": "noise cancellation",
    "шумоподавления": "noise cancellation", "шумоподавлением": "noise cancellation",
    "шумоподавлении": "noise cancellation", "прозрачности": "transparency",
    "изоляции": "isolation", "голоса": "voice", "голосовой": "voice",
    "речи": "speech", "разговора": "call", "телефона": "phone", "смартфона": "phone",
    "видеозвонках": "video calls", "звонке": "call", "звонок": "call",
    "дисплей": "display", "экран": "screen", "экрана": "screen",
    "матрицы": "panel", "покрытие": "coating", "глянцевый": "glossy",
    "антибликовый": "anti-reflective", "антибликовое": "anti-reflective",
    "яркость": "brightness", "контрастность": "contrast",
    "четкости": "definition", "четкость": "clarity", "видео": "video",
    "записи": "recording", "воспроизведении": "playback", "музыки": "music",
    "аккумулятор": "battery", "батареи": "battery", "аккумулятора": "battery",
    "зарядка": "charging", "заряд": "charge", "питанием": "power", "питания": "power",
    "энергопотребления": "power consumption", "пониженного": "low",
    "работы": "life", "работа": "operation", "время": "time",
    "режим": "mode", "режима": "mode", "режиме": "mode", "режимы": "modes",
    "считывания": "reader", "экспресс": "express", "карты": "cards",
    "резервным": "reserve", "обновления": "refresh", "частотой": "rate",
    "частоты": "rate", "адаптивной": "adaptive", "постоянно": "always",
    "включенный": "on", "включённый": "on", "включенной": "on", "включенным": "on",
    "выключенном": "off", "всегда": "always",
    "невозможно": "cannot be", "установить": "installed", "использовать": "used",
    "использовании": "use", "обычном": "typical",
    "мониторинг": "tracking", "отслеживание": "tracking", "цикла": "cycle",
    "ретроспективной": "retrospective", "оценкой": "estimates", "овуляции": "ovulation",
    "бег": "running", "бега": "running", "плавание": "swimming",
    "плавания": "swimming", "велотренировок": "cycling", "спорта": "sports",
    "видам": "types", "пульс": "heart rate", "пульсе": "heart rate",
    "сон": "sleep", "сна": "sleep", "шагомер": "step counter",
    "здоровья": "health", "женского": "women's", "физическая": "physical",
    "активность": "activity", "низком": "low", "высоком": "high",
    "слишком": "too", "разряде": "low", "нерегулярном": "irregular",
    "входящем": "incoming", "уведомления": "notifications",
    "часы": "watch", "умные": "smart", "часов": "hours",
    "запястий": "wrists", "подходит": "fits", "жестами": "gestures",
    "управление": "control", "поиска": "find", "функция": "feature",
    "функцией": "feature", "особенности": "features",
    "водонепроницаемость": "water resistance", "защита": "protection",
    "пыли": "dust", "глубине": "depth", "погружение": "immersion",
    "механических": "mechanical", "повреждений": "damage", "загрязнений": "dirt",
    "уровня": "level", "система": "system", "системы": "system",
    "многоканального": "multichannel", "пространственного": "spatial",
    "широкое": "wide", "широким": "wide", "широкополосного": "wideband",
    "спектром": "spectrum", "действия": "range", "направленных": "directional",
    "направленным": "directional", "формированием": "beamforming", "луча": "beam",
    "импедансом": "impedance", "расширенная": "extended", "расширенный": "extended",
    "улучшенная": "improved", "повышения": "enhanced", "определения": "detection",
    "обнаружение": "detection", "обнаружения": "detection", "движения": "motion",
    "положения": "position", "усилия": "force", "распознавания": "recognition",
    "распознавание": "recognition", "аварий": "crash", "дтп": "crash",
    "экстренные": "emergency", "экстренная": "emergency", "помощь": "SOS",
    "вызовы": "calls", "стадии": "stages",
    "встроенная": "built-in", "встроенный": "built-in", "встроенные": "built-in",
    "встроенных": "built-in", "цифрового": "numeric", "блока": "keypad",
    "порта": "ports", "выход": "output", "аудиовыход": "audio output",
    "адаптер": "adapter", "продается": "sold", "отдельно": "separately",
    "клавиатура": "keyboard", "подсветка": "backlight", "клавиш": "keys",
    "трекпад": "trackpad", "сканер": "scanner", "отпечатка": "fingerprint",
    "пальца": "sensor", "сенсорное": "touch", "сенсорный": "touch",
    "спутниковая": "satellite", "связь": "connectivity", "навигация": "navigation",
    "двухчастотный": "dual-frequency", "глонасс": "GLONASS",
    "активные": "active", "активным": "active", "активного": "active",
    "активное": "active", "собственный": "built-in", "дополнительный": "additional",
    "общих": "shared", "передачи": "transfer", "сотового": "cellular",
    "стандартная": "standard", "производитель": "manufacturer",
    "страна": "country", "производства": "manufacture",
    "китай": "China", "вьетнам": "Vietnam", "еас": "EAC",
    "сопряжение": "pairing", "крепление": "attachment", "магнитное": "magnetic",
    "кадр": "frame", "лица": "face", "света": "light", "внутрь": "inward",
    "обращенный": "facing", "двойным": "dual", "виртуальный": "virtual",
    "технологией": "technology", "технологии": "technologies",
    "пиковом": "peak", "го": "th", "п": "p", "х": "x", "мп": "MP",
    "барометрический": "barometric", "детектор": "detector",
    "прослушивания": "listening", "тренировок": "workouts",
    "недостаток": "limitation", "модель": "model", "тип": "type",
    "размер": "size", "ремешка": "strap", "диаметр": "diameter",
    "совместимость": "compatibility", "поддержки": "support",
}

_СЛОВО = re.compile(r"[а-яА-ЯёЁ][а-яА-ЯёЁ-]*")
_КИРИЛЛИЦА = re.compile(r"[а-яА-ЯёЁ]")


def _применить_фразы(text: str) -> str:
    # Регистр не учитываем, но сохраняем: каталог пишет одну и ту же
    # формулировку по-разному («Детектор ДТП» в начале перечня и «детектор
    # ДТП» в середине), а заводить обе строчки в словарь — лишний труд.
    for ru in sorted(PHRASES, key=len, reverse=True):
        en = PHRASES[ru]

        def _замена(m: re.Match[str], en: str = en) -> str:
            найдено = m.group(0)
            return en[0].upper() + en[1:] if найдено[0].isupper() else en

        text = re.sub(re.escape(ru), _замена, text, flags=re.IGNORECASE)
    return text


def _применить_единицы(text: str) -> str:
    for шаблон, en in UNITS:
        text = re.sub(шаблон, en, text)
    return text


def spec_key(key: str) -> str:
    """Название характеристики. Незнакомое — остаётся русским."""
    return SPEC_KEYS.get(key.strip(), key)


def spec_value(value: str) -> str:
    """Значение характеристики. Правило «всё или ничего» — см. модульный докстринг."""
    text = str(value or "")
    if not _КИРИЛЛИЦА.search(text):
        return text

    out = _применить_единицы(_применить_фразы(text))
    if not _КИРИЛЛИЦА.search(out):
        return re.sub(r"\s{2,}", " ", out).strip()

    неизвестное = False

    def замена(m: re.Match[str]) -> str:
        nonlocal неизвестное
        слово = m.group(0)
        en = WORDS.get(слово.lower())
        if not en:
            неизвестное = True
            return слово
        return en[0].upper() + en[1:] if слово[0].isupper() else en

    out = _СЛОВО.sub(замена, out)
    if неизвестное:
        return text
    return re.sub(r"\s{2,}", " ", out).strip()


def translate_specs(specs: list[dict]) -> list[dict]:
    return [{"key": spec_key(s["key"]), "value": spec_value(s["value"])} for s in specs]
