/**
 * Скопируйте в config.js и заполните перед деплоем.
 * config.js не коммитьте в git, если там секреты.
 */
window.IRON_CONFIG = {
  // URL вашего backend (Node на VDS или Yandex Cloud Function-прокси)
  apiUrl: "",

  // Токен для Yandex Function (заголовок X-Function-Token), если форма шлёт напрямую
  apiToken: "",

  // Телефон менеджера для уведомлений в Telegram (через вашу функцию Send-to-telegram)
  notifyPhone: "+79288509404",

  googleSheetId: "11xhKh4rPN5XfZA7y8D14_rVxzT1dfvOjs_nv1HMSols",
  googleSheetTab: "Prices",
  telegramOrderUser: "ironsochi",
  siteUrl: "https://ваш-домен.ru",

  // Яндекс.Карты: координаты входа (уточните при необходимости)
  map: {
    lat: 43.5852,
    lon: 39.7231,
    zoom: 17,
    address: "Сочи, ул. Московская, 5 (цоколь, вход со двора ул. Островского)",
  },
};
