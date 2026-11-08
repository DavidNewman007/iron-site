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
    iphoneVersion: [['base','Обычный'],['plus','Plus'],['pro','Pro'],['pro_max','Pro Max'],['mini','mini'],['air','Air'],['e','e'],['se','SE']],
    part: [['','Определить по тексту'],['display','Дисплей / экран'],['battery','Аккумулятор'],['keyboard','Клавиатура'],['housing','Корпус / задняя крышка'],['camera','Камера'],['charging','Разъём / шлейф зарядки'],['speaker','Динамик'],['board','Плата'],['other','Другая деталь']],
  };
  const defaults = {enabled:true,kind:'auto',category:'auto',condition:'any',supply:'any',quality:'any',event:'available',policy:'continuous',part:'',model:'',sku:'',chip:'',ramMin:'',storageMin:'',batteryMin:'',colors:'',sim:'',exclude:'',maxDays:'',expires:'',iphoneFrom:'',iphoneTo:'',iphoneVariants:''};
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
    const phone=iphoneFilter(w,'',w.category); if(phone.issues.length)return phone.issues[0];
    const excluded=exclusionIssue(w); if(excluded)return excluded;
    if(w.batteryMin&&Number(w.batteryMin)>100)return 'Состояние аккумулятора — от 0 до 100%';
    if(w.expires&&!/^\d{4}-\d{2}-\d{2}$/.test(w.expires))return 'Проверьте срок актуальности';
    return '';
  }
  function retailKind(kind) { return ['auto','goods','price','accessory'].includes(kind); }
  function usedBot(w, kind=w.kind, condition=w.condition) { return retailKind(kind) && condition==='used'; }
  function versionCodes(value) { return String(value||'').split(/[,;\s]+/).filter(Boolean); }
  function textPhoneVersions(text) {
    let t=String(text||'').toLowerCase().replace(/ё/g,'е').replace(/про\s*макс|pro\s*max/g,'pro_max').replace(/(?<![а-я])про(?![а-я])/g,'pro').replace(/плюс/g,'plus').replace(/обычн[а-я]*|базов[а-я]*/g,'base');
    const positive=[],negative=[];
    for(const m of t.matchAll(/(^|[^a-zа-я])(pro_max|plus|pro|base|mini|air|se|e)(?=$|[^a-zа-я])/g)){
      const before=t.slice(Math.max(0,m.index-18),m.index);
      ((/\b(?:not|except)\s*$|(?:не|без|кроме)\s*$/.test(before))?negative:positive).push(m[2]);
    }
    return {positive:[...new Set(positive)],negative:[...new Set(negative)]};
  }
  function iphoneFilter(w,text='',category=w.category) {
    const out={from:null,to:null,variants:[],issues:[],textRange:false};
    if(category!=='iphone' && !(category==='auto'&&/iphone|айфон|ифон/i.test(text)))return out;
    const explicit=versionCodes(w.iphoneVariants),allowed=options.iphoneVersion.map(x=>x[0]);
    if(explicit.some(x=>!allowed.includes(x)))out.issues.push('Уточните версии iPhone');
    if(w.iphoneFrom||w.iphoneTo){
      if(!/^\d{1,2}$/.test(w.iphoneFrom)||!/^\d{1,2}$/.test(w.iphoneTo)||+w.iphoneFrom<4||+w.iphoneTo>99||+w.iphoneFrom>+w.iphoneTo)out.issues.push('Поколения iPhone: заполните обе границы от меньшего к большему');
      else {out.from=+w.iphoneFrom;out.to=+w.iphoneTo;}
    }
    const t=String(text||'').toLowerCase().replace(/ё/g,'е');
    const range=t.match(/(?:от\s*|(?<!\d))(\d{1,2})\s*(?:до|по|[-–—])\s*(\d{1,2})(?!\d)/);
    if(range){
      const after=t.slice(range.index+range[0].length).trim(),before=t.slice(Math.max(0,range.index-18),range.index);
      const unit=/^(?:тыс|т\.?\s*р|руб|₽|к\b|гб|gb|тб|tb|дн|час|%|ноябр|декабр|январ|феврал|март|апрел|мая|июн|июл|август|сентябр|октябр)/.test(after);
      if(!unit&&!/(?:бюджет|цена)\s*$/.test(before)){
        const lo=+range[1],hi=+range[2];
        if(lo<4||hi>99||lo>hi)out.issues.push('Уточните диапазон поколений iPhone в тексте');
        else {out.from=out.from==null?lo:Math.max(out.from,lo);out.to=out.to==null?hi:Math.min(out.to,hi);out.textRange=true;if(out.from>out.to)out.issues.push('Диапазон iPhone в тексте и списках расходится');}
      }
    }
    const words=textPhoneVersions(text);
    out.variants=explicit.length?(words.positive.length?explicit.filter(x=>words.positive.includes(x)):explicit):words.positive;
    if(explicit.length&&words.positive.length&&!out.variants.length)out.issues.push('Версии iPhone в тексте и списках расходятся');
    if(words.negative.length){
      if(!out.variants.length)out.issues.push('Уточните исключённые версии iPhone переключателями');
      out.variants=out.variants.filter(x=>!words.negative.includes(x));
      if((explicit.length||words.positive.length)&&!out.variants.length)out.issues.push('Все выбранные версии iPhone исключены текстом');
    }
    out.variants=[...new Set(out.variants)];return out;
  }
  function variantLabel(code) {return options.iphoneVersion.find(x=>x[0]===code)?.[1]||code;}
  function iphoneFits(filter,model) {
    const t=String(model||'').toLowerCase().replace(/про\s*макс|pro\s*max/g,'pro_max').replace(/плюс/g,'plus').replace(/(?<![а-я])про(?![а-я])/g,'pro');
    if(/(?:iphone|айфон|ифон)\s*se(?:\s|\d|$)/.test(t))return filter.from==null&&filter.to==null&&(!filter.variants.length||filter.variants.includes('se'));
    const m=t.match(/(?:iphone|айфон|ифон)\s*(\d{1,2})\s*(pro_max|plus|pro|mini|air|e)?(?:\s|$)/);
    if(!m)return false;
    return (filter.from==null||+m[1]>=filter.from)&&(filter.to==null||+m[1]<=filter.to)&&(!filter.variants.length||filter.variants.includes(m[2]||'base'));
  }
  function exclusionIssue(w) {
    if(!retailKind(w.kind)||!w.category||w.category==='auto')return '';
    const names={macbook:'(?:macbook|макбук)',iphone:'(?:iphone|айфон|ифон)',ipad:'(?:ipad|айпад)',airpods:'airpods',watch:'(?:apple\\s*)?watch'};
    const name=names[w.category];if(!name)return '';
    const type=w.condition==='used'?'(?:б\\s*[/ ]?\\s*у|used)':w.condition==='new'?'(?:нов[а-я]*|new)':null;
    for(const raw of String(w.exclude||'').split(/[,;\n]+/)){
      const t=raw.trim().toLowerCase();
      if(new RegExp('^'+name+'$').test(t)||type&&(new RegExp('^'+name+'\\s*'+type+'$').test(t)||new RegExp('^'+type+'\\s*'+name+'$').test(t)))return 'В «Не предлагать» указан сам нужный товар. Уточните или уберите это исключение.';
    }
    return '';
  }
  function describe(w) {
    const label=(key,value)=>options[key]?.find(x=>x[0]===value)?.[1]||'';
    const f=iphoneFilter(w,'',w.category),phone=f.from!=null?`iPhone ${f.from}–${f.to}`:w.category==='iphone'?'iPhone':'';
    return [label('condition',w.condition),phone||label('category',w.category),f.variants.length?f.variants.map(variantLabel).join(' или '):'',w.model,usedBot(w)?'раздел «Б/у техника» в боте':label('supply',w.supply),w.exclude?'Не предлагать: '+w.exclude:''].filter(Boolean).join(' · ');
  }
  function hasCriteria(m) {
    const w=watch(m.watch);
    return !!(String(m.subject||'').trim()||String(m.requirements||'').trim()||
      !['auto','other'].includes(w.category)||w.model||w.sku||w.part&&w.part!=='other');
  }
  // label — подпись в списке. В разбор условий идут только subject/requirements/watch.
  function title(m) {
    if(String(m.subject||'').trim())return String(m.subject).trim().slice(0,250);
    const w=watch(m.watch),f=iphoneFilter(w,'',w.category);
    const category=options.category.find(x=>x[0]===w.category)?.[1];
    const device=w.category==='iphone'&&f.from!=null?`iPhone ${f.from}–${f.to}`:!['auto','other'].includes(w.category)?category:'';
    const detail=[w.condition==='used'?'Б/у':w.condition==='new'?'Новое':'',device,
      f.variants.map(variantLabel).join(' или '),w.model,
      w.part?options.part.find(x=>x[0]===w.part)?.[1]:'',w.sku].filter(Boolean).join(' · ');
    return (detail||String(m.requirements||'').trim().split('\n')[0]||'Напоминание').slice(0,250);
  }
  const stoppedStatus = v => /неактуально|отказ|закрыт|в работе|выполнен|готов|продан|выкуплен|обмен оформлен|разобран|в залоге|ремонт невозможен|без ремонта|выдан/.test(String(v||'').toLowerCase().replace(/ё/g,'е'));
  const api={options,defaults,watch,invalid,stoppedStatus,retailKind,usedBot,versionCodes,iphoneFilter,iphoneFits,variantLabel,exclusionIssue,describe,hasCriteria,title};root.IRON_REMINDER_RULES=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
