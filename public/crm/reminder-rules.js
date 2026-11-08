/* Общие классификаторы CRM/фонового подбора (план93 §11.78). Без данных клиентов. */
(function (root) {
  'use strict';
  const options = {
    kind: [['auto','Определить по тексту'],['goods','Техника'],['repair','Запчасть с установкой'],['part','Запчасть отдельно'],['accessory','Аксессуар'],['price','Снижение цены до бюджета'],['contact','Связаться с клиентом — вручную'],['manual','Другая просьба — вручную']],
    category: [['auto','Определить по тексту'],['iphone','iPhone'],['macbook','MacBook'],['ipad','iPad'],['desktop','iMac / Mac mini / Mac Studio'],['watch','Apple Watch'],['airpods','AirPods'],['android','Android'],['accessory','Аксессуар'],['other','Другое']],
    condition: [['any','Новое или б/у'],['new','Только новое'],['used','Только б/у']],
    supply: [['any','Все склады, включая под заказ'],['stock','В наличии, без предзаказа'],['own','Только у нас на полке'],['order','Только под заказ']],
    quality: [['any','Любое подходящее качество'],['original','Только оригинал'],['original_new','Оригинал новый'],['original_used','Оригинал б/у / переклей'],['oem','OEM'],['soft_oled','Soft OLED'],['incell','In-Cell'],['copy','Копия']],
    event: [['available','Проверить сейчас и следить дальше'],['arrival','Только новое поступление'],['price','Цена стала подходить под бюджет']],
    policy: [['once','Одно предложение, затем ждать ответа'],['continuous','Продолжать сообщать о новых вариантах']],
    part: [['','Определить по тексту'],['display','Дисплей / экран'],['battery','Аккумулятор'],['keyboard','Клавиатура'],['housing','Корпус / задняя крышка'],['camera','Камера'],['charging','Разъём / шлейф зарядки'],['speaker','Динамик'],['board','Плата'],['other','Другая деталь']],
  };
  const defaults = {enabled:true,kind:'auto',category:'auto',condition:'any',supply:'any',quality:'any',event:'available',policy:'continuous',part:'',model:'',sku:'',chip:'',ramMin:'',storageMin:'',batteryMin:'',colors:'',sim:'',exclude:'',maxDays:'',expires:''};
  function watch(value) {
    const x=value && typeof value==='object' && !Array.isArray(value)?value:{},out={...defaults};
    out.enabled = typeof x.enabled==='boolean'?x.enabled:true;
    for(const k of Object.keys(defaults)) {
      if(k==='enabled')continue;
      if(x[k]!=null)out[k]=String(x[k]).trim().slice(0,500);
      if(options[k]&&!options[k].some(o=>o[0]===out[k]))out[k]=defaults[k];
    }
    return out;
  }
  function invalid(w) {
    for(const k of ['ramMin','storageMin','batteryMin','maxDays'])if(w[k]&&!/^\d+(?:[.,]\d+)?$/.test(w[k]))return 'Проверьте поле «'+({ramMin:'Оперативная память',storageMin:'Накопитель',batteryMin:'Состояние аккумулятора',maxDays:'Срок поставки'}[k]||'Число')+'»';
    if(w.batteryMin&&Number(w.batteryMin)>100)return 'Состояние аккумулятора — от 0 до 100%';
    if(w.expires&&!/^\d{4}-\d{2}-\d{2}$/.test(w.expires))return 'Проверьте срок актуальности';
    return '';
  }
  const stoppedStatus = v => /неактуально|отказ|закрыт|в работе|выполнен|готов|продан|выкуплен|обмен оформлен|разобран|в залоге|ремонт невозможен|без ремонта|выдан/.test(String(v||'').toLowerCase().replace(/ё/g,'е'));
  const api={options,defaults,watch,invalid,stoppedStatus};root.IRON_REMINDER_RULES=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
