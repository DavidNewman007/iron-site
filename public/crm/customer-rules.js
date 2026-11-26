/* Shared CRM customer rules. Mirror to public/crm/customer-rules.js; tests enforce identical bytes. */
var IRON_CUSTOMER_RULES = (function () {
  'use strict';
  var givenNames = new Set(["азамат", "аида", "айгуль", "айдамир", "александр", "александра", "алексей", "алена", "аленка", "алик", "алина", "алиса", "алия", "алла", "алсу", "альберт", "альбина", "алёна", "алёнка", "амбарцум", "анаит", "анастасия", "анатолий", "ангелина", "андрей", "анжела", "анна", "антон", "антонина", "анюта", "аня", "арам", "аркадий", "армен", "армине", "арсен", "арсений", "артем", "артур", "артём", "арут", "ася", "ахмед", "ашот", "богдан", "борис", "булат", "вадим", "валентин", "валентина", "валера", "валерий", "валерия", "ваня", "вардан", "варя", "василий", "вася", "вера", "вероника", "вика", "виктор", "виктория", "виталий", "витя", "влад", "владимир", "владислав", "вова", "володя", "вячеслав", "галина", "галя", "геннадий", "георгий", "гера", "герман", "гиви", "глеб", "гоша", "григорий", "гриша", "гульнара", "давид", "даниил", "данил", "данила", "даня", "дарик", "дарья", "даша", "денис", "диана", "дианна", "дима", "димон", "динара", "дионис", "дмитрий", "ева", "евгений", "евгения", "егор", "екатерина", "елена", "елизавета", "ервант", "жанна", "женя", "жора", "зара", "зарина", "заур", "захар", "зина", "зинаида", "зураб", "иван", "иветта", "игорь", "илона", "илья", "инга", "инна", "ира", "ирина", "иришка", "кадрия", "карен", "карина", "карине", "катя", "кирилл", "кнарик", "коля", "константин", "костя", "кристина", "ксения", "ксюша", "лана", "лариса", "лев", "лева", "левон", "лейла", "лена", "леонид", "леша", "лиана", "лидия", "лиза", "лизавета", "лилия", "лиля", "лолита", "любовь", "люда", "людмила", "лёва", "лёша", "магомед", "маджид", "мадина", "майя", "макар", "макс", "максим", "мальвина", "марат", "маргарита", "марго", "марик", "марина", "маришка", "мария", "марк", "маруся", "матвей", "маша", "машенька", "медина", "милана", "михаил", "миша", "мурад", "надежда", "надя", "наиль", "наира", "настя", "наталия", "наталья", "натан", "наташа", "нелли", "нелля", "ника", "никита", "николай", "нина", "нино", "нодар", "нонна", "нора", "нугзар", "нюра", "оксана", "олег", "олеся", "ольга", "оля", "павел", "паша", "петр", "полина", "пётр", "радмир", "раиса", "рауф", "рафаэль", "реваз", "регина", "римма", "ринат", "рита", "роберт", "роза", "рома", "роман", "рубен", "руслан", "рустам", "сабина", "самвел", "саня", "саркис", "саша", "сашка", "света", "светлана", "семен", "семён", "серафима", "сергей", "сережа", "серж", "серёжа", "слава", "славик", "снежана", "соня", "софия", "софья", "станислав", "стас", "степан", "султан", "сурен", "сусанна", "сюзана", "сюзанна", "тамара", "танюша", "таня", "тарас", "тася", "татьяна", "теймураз", "тема", "тигран", "тимофей", "тимур", "тина", "толик", "толя", "тоня", "тёма", "ульяна", "фатима", "федор", "феликс", "филипп", "флора", "фёдор", "хатуна", "хачатур", "шамиль", "эдик", "эдуард", "элла", "эльвира", "эльдар", "эмма", "эрик", "юлия", "юля", "юра", "юрий", "яна", "ярослав"]);
  function digits(v) { return String(v == null ? '' : v).replace(/\D/g,''); }
  // 10 цифр с ведущей 7 — НЕ дополняем: это незавершённый ввод «7 9xx…», а не номер
  // без префикса. Дополнение давало «77…» и порчу номера прямо во время ввода (26.11.2026).
  function key(v) { var d=digits(v);if(/^\s*\+(?!7)/.test(String(v)))return d;return d.length===10&&d[0]!=='7'?'7'+d:d.length===11&&d[0]==='8'?'7'+d.slice(1):d; }
  // Абхазия (940, 941) и Южная Осетия (943) живут в плане +7, но звонки туда платные —
  // владелец просит показывать их как +7, чтобы карточка сразу говорила «писать/звонить
  // только через WhatsApp/Telegram». Остальные российские — привычные 8-xxx.
  function display(v) { var d=key(v);if(/^7\d{10}$/.test(d)){var c=d.slice(1,4);return /^(940|941|943)$/.test(c)?'+7-'+c+'-'+d.slice(4,7)+'-'+d.slice(7,9)+'-'+d.slice(9):'8-'+d.slice(1,4)+'-'+d.slice(4,7)+'-'+d.slice(7,9)+'-'+d.slice(9);}return String(v).trim(); }
  function runParts(run) {
    var d=digits(run),pos=[];for(var i=0;i<run.length;i++)if(/\d/.test(run[i]))pos.push(i);
    if(/^\+/.test(run)&&!/^\+7/.test(run)&&d.length>=10&&d.length<=15)return [{raw:run,d:d,text:run.trim()}];
    if(d.length===10||d.length===11)return [{raw:run,d:key(run),text:display(run)}];
    if(d.length>=12&&d.length<=15)return [{raw:run,d:d,text:run.trim()}];
    for(var size of [11,10])if(d.length>size&&d.length%size===0){
      var out=[],valid=true;
      for(var j=0;j<d.length;j+=size){
        var part=d.slice(j,j+size),gap=j?run.slice(pos[j-1]+1,pos[j]):'';
        if(!(size===11?/^[78]/.test(part):/^[3489]/.test(part))||(j&&!/[. \t()\-–—]/.test(gap))){valid=false;break;}
        var raw=run.slice(pos[j],pos[j+size-1]+1);out.push({raw:raw,d:key(part),text:display(raw)});
      }
      if(valid)return out;
    }
    return [];
  }
  var runs=/\+?\d(?:[\d(). \t\u00a0\-–—]*\d)?/g;
  function parse(v) {
    var out=[],seen=new Set();String(v==null?'':v).replace(runs,function(run){
      runParts(run).forEach(function(p){if(!seen.has(p.d)){seen.add(p.d);out.push(p);}});return run;
    });return out;
  }
  function format(v) {
    return String(v==null?'':v).replace(runs,function(run){var pp=runParts(run);return pp.length?pp.map(function(p){return p.text;}).join('\n'):run;}).replace(/\r\n/g,'\n').replace(/\n\s*\n/g,'\n').trim();
  }
  function phoneMatches(phone,query) {
    var d=digits(query),p=key(phone);if(d.length===11||d.length===10)d=key(d);
    return !!d&&(p.indexOf(d)>=0||(d[0]==='8'&&d.length>=4&&p.indexOf('7'+d.slice(1))>=0));
  }
  function isPhoneQuery(q) { return /^[+\d\s().\-–—]+$/.test(String(q).trim()); }
  function normalizedWord(v) { return String(v||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я-]/g,''); }
  function splitName(raw) {
    var words=String(raw||'').split('\n')[0].replace(/\([^)]*\)/g,' ').split(/\s+/).filter(Boolean);
    var matches=words.map(function(w,i){return givenNames.has(normalizedWord(w))?i:-1;}).filter(function(i){return i>=0;});
    if(matches.length!==1)return {firstName:'',lastName:'',uncertain:true};
    var at=matches[0],first=words[at].replace(/[^a-zа-яёA-ZА-ЯЁ-]/g,''),rest=words.filter(function(_,i){return i!==at;}).filter(function(w){return !/^(клиент|клиентка|фио)$/i.test(w);});
    return {firstName:first[0].toUpperCase()+first.slice(1).toLowerCase(),lastName:rest.join(' '),reordered:at>0,uncertain:false};
  }
  // Обращение — первое слово ячейки ФИО, как было до 24.11 (решение владельца 26.11:
  // не гадать по словарю, имя разберёт тот, кто вводит; словарь оставлен только
  // для аудита перепутанных контактов).
  function personName(raw) { var w=String(raw==null?'':raw).split('\n')[0].trim().split(/\s+/)[0]||''; w=w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu,''); return w?w[0].toUpperCase()+w.slice(1).toLowerCase():''; }
  function internal(data) {return /^внутренний ремонт/i.test(String(data.dealType||data.type||''));}
  function candidates(data) {
    var out=[],seen=new Set(),contact=data.contact||{};
    for(var pair of [[data.phone,'client',data.name],[contact.phone,'proxy',contact.name]])parse(pair[0]).forEach(function(p){if(!seen.has(p.d)){seen.add(p.d);out.push({d:p.d,text:p.text,kind:pair[1],name:pair[2]||''});}});
    return out;
  }
  function policy(raw) {
    // Пустая политика = null (маршрутизация по умолчанию). Ложные значения из
    // колонок-чекбоксов (boolean false, текст "FALSE"/"TRUE", 0) — тоже пустота,
    // а не «инвалидная политика»: иначе уведомления молча выключаются (25.11.2026).
    if(raw==null||raw===false||raw===true||raw===0)return null;
    var s=String(raw).trim();if(!s||/^false$/i.test(s)||/^true$/i.test(s))return null;
    try{var p=typeof raw==='string'?JSON.parse(raw):raw;if(p.v!==1||!Array.isArray(p.status)||!Array.isArray(p.report))throw Error('invalid');return p;}catch(e){return {v:1,status:[],report:[],invalid:true};}
  }
  function targets(data,phase) {
    if(internal(data))return [];
    var all=candidates(data),p=policy(data.notify),kind=phase==='report'?'report':'status',selected;
    if(p)selected=p[kind].map(digits);
    else if(kind==='report')selected=all.filter(function(x){return x.kind==='client';}).slice(0,1).map(function(x){return x.d;});
    else {var proxy=all.filter(function(x){return x.kind==='proxy';}),same=!!String(data.name||'').trim()&&String(data.name||'').toLowerCase().trim()===String((data.contact||{}).name||'').toLowerCase().trim();selected=(proxy.length&&!same?proxy:all).map(function(x){return x.d;});}
    return all.filter(function(x){return selected.indexOf(x.d)>=0;});
  }
  return {digits:digits,key:key,display:display,parse:parse,format:format,phoneMatches:phoneMatches,isPhoneQuery:isPhoneQuery,personName:personName,splitName:splitName,candidates:candidates,policy:policy,targets:targets,internal:internal};
})();
if(typeof module==='object'&&module.exports)module.exports=IRON_CUSTOMER_RULES;
if(typeof globalThis!=='undefined')globalThis.IRON_CUSTOMER_RULES=IRON_CUSTOMER_RULES;
