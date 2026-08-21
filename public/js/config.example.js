/**
 * Шаблон конфигурации сайта.
 * При деплое копируется в config.js (см. .github/workflows/pages.yml).
 * Локально: cp public/js/config.example.js public/js/config.js
 * Секреты (apiToken) — через GitHub Secrets, не коммитьте в config.js.
 */
window.IRON_CONFIG = {
  apiUrl: "",
  apiToken: "",
  notifyPhone: "+79288509404",

  googleSheetId: "11xhKh4rPN5XfZA7y8D14_rVxzT1dfvOjs_nv1HMSols",
  googleSheetTab: "Prices",
  telegramOrderUser: "ironsochi",
  /**
   * Личный чат IRON SERVICE в MAX (не бот).
   * Получить: MAX на рабочем телефоне → Настройки → QR профиля → Поделиться → max.ru/u/…
   */
  maxOrderChatUrl: "https://max.ru/u/f9LHodD0cOKlZ_elHjnvsmd373HrpTVtuoGG97clDc4Pd9YoT_9wa7HEQtU",
  /** Запасной :share — экран «выбрать контакт», без фиксированного получателя */
  maxShareUrl: "https://max.ru/:share",
  maxBotUrl: "https://max.ru/id231708534609_bot",
  maxFunctionUrl: "https://functions.yandexcloud.net/d4etdogrrq9ersodqqpl",
  /** Тот же секрет, что MAX_BOOKING_PUBLIC_TOKEN в Yandex (max-bot). Можно оставить пустым. */
  maxBookingPublicToken: "",
  /**
   * URL функции yandex-pay (создание заказа Яндекс Пэй). Пусто = кнопка «Оплатить онлайн» скрыта.
   * Пример: https://functions.yandexcloud.net/<id-функции-yandex-pay>
   *
   * НЕ ЗАПОЛНЯТЬ И НЕ ВКЛЮЧАТЬ без решения владельца. Яндекс Пэй берёт комиссию
   * с каждой транзакции — это фактически наценка на товар, и владелец пока не
   * решил, закладывать её в цену или гасить самому. Код кнопки/страниц готов
   * (см. коммит "Онлайн-оплата через Яндекс Пэй" от 27.07.2026), но сознательно
   * держится невключённым и непрозведённым на прод, пока решение не принято.
   */
  yandexPayApiUrl: "",
  siteUrl: "https://1iron.ru",

  // URL Web App PersonalOffer.js (Deploy → Web app, Anyone).
  // Обновлено 21.08.2026: прежний деплой AKfycbyl… отдавал не JSON, а форму
  // логина Google (проверено курлом) — offer.html молча терял запасной путь
  // загрузки предложения по токену. Текущий деплой тот же, что у channel-bot
  // для daily-offer, и отвечает анонимно.
  personalOfferApiUrl: "https://script.google.com/macros/s/AKfycbxrUfD6zplItTSN5gnsEiBn0I8awbs5t5eFwRkeFNd6kHLIyqlQg-hc5hsHo2n5jjVR/exec",

  map: {
    lat: 43.5854,
    lon: 39.724,
    zoom: 18,
    orgId: "1716684342",
    address: "Сочи, ул. Московская, 5 (цоколь, вход со двора ул. Островского)",
  },
};
