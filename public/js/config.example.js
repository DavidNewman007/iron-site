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
  /** Диплинк MAX — подставляет текст заявки (работает внутри MAX без VPN) */
  maxShareUrl: "https://max.ru/:share",
  maxBotUrl: "https://max.ru/id231708534609_bot",
  maxFunctionUrl: "https://functions.yandexcloud.net/d4etdogrrq9ersodqqpl",
  /** Тот же секрет, что MAX_BOOKING_PUBLIC_TOKEN в Yandex (max-bot). Можно оставить пустым. */
  maxBookingPublicToken: "",
  siteUrl: "https://1iron.ru",

  // URL Web App PersonalOffer.js (Deploy → Web app, Anyone)
  personalOfferApiUrl: "https://script.google.com/macros/s/AKfycbylyHTrL3Wj3533w4ZbKeFoE1x5aHaSLCiucWaRMRI/exec",

  map: {
    lat: 43.5854,
    lon: 39.724,
    zoom: 18,
    orgId: "1716684342",
    address: "Сочи, ул. Московская, 5 (цоколь, вход со двора ул. Островского)",
  },
};
