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
  siteUrl: "https://1iron.ru",

  map: {
    lat: 43.5854,
    lon: 39.724,
    zoom: 18,
    orgId: "1716684342",
    address: "Сочи, ул. Московская, 5 (цоколь, вход со двора ул. Островского)",
  },
};
