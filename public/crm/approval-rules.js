(function(root){
 'use strict';
 const sheet='CRM — согласования';
 const text=v=>String(v??'').trim(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function snapshot(order){return {number:text(order.number),row:+order.row,device:text(order.device),master:text(order.master),status:text(order.status),total:text(order.total),type:text(order.type),work:text(order.work),issue:text(order.issue),parts:text(order.parts),serviceMeta:text(order.serviceMeta),phones:[...(order.phones||[])].sort()};}
 function active(order){return order&&(!text(order.type)||text(order.type).toLowerCase()==='ремонт')&&!/^(выполн|закрыт|отказ|ремонт невозмож|без ремонта|готов)/i.test(text(order.status));}
 function matches(a,b,{waiting=false}={}){const x=snapshot(a),y=snapshot(b);if(waiting)x.status=y.status='На согласовании';return same(x,y);}
 function amount(value){const s=text(value).replace(/[\s₽]/g,'').replace(',','.');if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const n=+s;return Number.isFinite(n)&&n<=1e7?n:null;}
 const code=id=>text(id).replace(/[^a-z0-9]/gi,'').slice(-6).toUpperCase();
 function passwordMessage({number,device,firstName='',note=''}){const name=text(firstName);return `Здравствуйте${name&&name!=='Клиент'?', '+name:''}! Для дальнейшей проверки вашего устройства (${device}, заказ №${number}) нам потребуется код разблокировки или пароль входа в устройство.\n\nКод будет записан в заказ и передан мастеру, который выполняет проверку. Используем его для диагностики и проверки устройства. Нужен только код устройства — не пароль Apple ID/Google, не банковские пароли и не коды из SMS.\n\nЕсли не готовы сообщить код, можете прийти и ввести его лично. В таком случае проверка может затянуться, а вводить код, возможно, потребуется несколько раз.\n\nПришлите код ответом на это сообщение или напишите, что хотите ввести его лично.${text(note)?'\n\n'+text(note):''}`;}
 function matchesPassword(a,b){const select=x=>{const s=snapshot(x);return {number:s.number,row:s.row,device:s.device,master:s.master,type:s.type,phones:s.phones};};return same(select(a),select(b));}
 function message({id,number,device,plan,total,stage='diagnosis',note=''}){
  return `Согласование ремонта №${number}\n${device}\n\n${stage==='preliminary'?'Предварительный план':'По результатам диагностики'}:\n${text(plan)}\n\nСтоимость перечисленных работ и запчастей: ${Number(total).toLocaleString('ru-RU')} ₽.\n${text(note)?text(note)+'\n':''}Дополнительные работы и изменение стоимости согласуем отдельно.\n\nСогласуете выполнение этих работ? Ответьте на это сообщение «Согласен» или «Делайте». Если есть вопросы — напишите.\nКод согласования: ${code(id)}`;
 }
 function decision(value,total,id){
  let s=text(value).toLowerCase().replace(new RegExp(code(id),'ig'),'').trim();
  if(!s||s.includes('?')||/\bhttps?:|@|[\n]/i.test(s))return 'question';
  if(/(?:^|\s)(?:нет|не\s+надо|отказ|отмен|стоп|не\s+дела|не\s+соглас)/i.test(s))return 'declined';
  if(/(?:^|\s)(?:но|если|после|пока|когда|только|подум|подума|подожд|дорого|скид|дешев|может)/i.test(s))return 'question';
  const price=s.match(/\s+за\s+(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|рублей|р\.?)?\s*[.!]*$/i);
  if(price){if(amount(price[1])!==+total)return 'question';s=s.slice(0,price.index);}
  s=s.replace(/[.,!\s]+$/g,'').trim();
  if(/^(?:да|ок|окей|okay|ok|хорошо|согласен|согласна|согласны|делайте|приступайте|ремонтируйте|меняйте|давайте делать|давайте ремонтировать|можно делать)(?:[,!\s]+(?:да|ок|хорошо|делайте|приступайте|согласен|согласна))*$/i.test(s))return 'accepted';
  return 'question';
 }
 const api={sheet,snapshot,active,matches,matchesPassword,amount,code,message,passwordMessage,decision};root.IRON_APPROVAL_RULES=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
