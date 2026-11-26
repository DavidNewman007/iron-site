(function(root){
 'use strict';
 const aliases={м:"m",а:"a",с:"s",х:"x",иксэр:"xr",иксэс:"xs",айфон:'iphone',айфоны:'iphone',макбук:'macbook',аймак:'imac',айпад:'ipad',эпл:'apple',эппл:'apple',про:'pro',макс:'max',плюс:'plus',мини:'mini',эйр:'air',аир:'air',эир:'air',се:'se',икс:'x',хр:'xr',хс:'xs',вотч:'watch',аирподс:'airpods',эйрподс:'airpods',самсунг:'samsung',галакси:'galaxy',сяоми:'xiaomi',ксиоми:'xiaomi',редми:'redmi',поко:'poco',хонор:'honor',хуавей:'huawei',хуавэй:'huawei',реалми:'realme',техно:'tecno',инфиникс:'infinix',виво:'vivo',оппо:'oppo',асус:'asus',асер:'acer',эйсер:'acer',леново:'lenovo',делл:'dell',ноут:'ноутбук'};
 const latin="qwertyuiop[]asdfghjkl;'zxcvbnm,.",cyr='йцукенгшщзхъфывапролджэячсмитьбю';
 function oneEdit(a,b){
  if(a===b)return true;if(Math.abs(a.length-b.length)>1)return false;
  if(a.length===b.length){const ix=[];for(let i=0;i<a.length;i++)if(a[i]!==b[i])ix.push(i);return ix.length===1||ix.length===2&&ix[1]===ix[0]+1&&a[ix[0]]===b[ix[1]]&&a[ix[1]]===b[ix[0]];}
  const [s,l]=a.length<b.length?[a,b]:[b,a];let i=0,j=0,n=0;while(i<s.length&&j<l.length){if(s[i]===l[j]){i++;j++;}else{if(++n>1)return false;j++;}}return true;
 }
 function prepare(value,query=false){
  const s=String(value||'').toLowerCase().replace(/ё/g,'е').replace(/mac\s*book|мак\s*бук/g,'macbook').replace(/i\s*phone|ай\s*фон/g,'iphone').replace(/про\s*макс|pro\s*max/g,'pro max').replace(/macbook(про|pro|эйр|эир|аир|air)/g,'macbook $1').replace(/(эйр|эир|аир|air)(?=[мm]\d)/g,'$1 ').replace(/iphone([xх](?:[rsср])?)(?=$|[^a-zа-я])/g,'iphone $1').replace(/([a-zа-я])(\d)/g,'$1 $2').replace(/(\d)([a-zа-я])/g,'$1 $2');
  const words=(s.match(/[a-zа-я0-9]+/g)||[]).map(w=>{if(aliases[w])return aliases[w];if(query&&w.length>=3){const a=Object.keys(aliases).find(a=>a.startsWith(w))||(w.length>=4?Object.keys(aliases).find(a=>oneEdit(a,w)):null);if(a)return aliases[a];}return w;});
  return {text:words.join(' '),words};
 }
 function layout(value,from,to){return [...value].map(c=>{const i=from.indexOf(c);return i<0?c:to[i];}).join('');}
 function queries(value){const q=String(value||'').toLowerCase();return [prepare(q,true),prepare(layout(q,latin,cyr),true),prepare(layout(q,cyr,latin),true)].filter((x,i,a)=>x.words.length&&a.findIndex(y=>y.text===x.text)===i);}
 function score(value,variants){
  const d=typeof value==='string'?prepare(value):value;let best=0;
  for(let i=0;i<variants.length;i++){
   const q=variants[i];if(!d?.words.length||!q.words.length)continue;
   let points=0,ok=true;
   for(const w of q.words){if(d.words.includes(w)){points+=30;continue;}if(!/^\d+$/.test(w)&&d.words.some(t=>t.startsWith(w))){points+=18;continue;}if(w.length>=4&&d.words.some(t=>!/^\d+$/.test(t)&&oneEdit(w,t))){points+=6;continue;}ok=false;break;}
   if(ok)best=Math.max(best,(d.text===q.text?1000:700+(d.text.includes(q.text)?80:0))+points-5*Math.max(0,d.words.length-q.words.length)-(i?3:0));
  }
  return best;
 }
 const api={prepare,queries,score};root.IRON_DEVICE_SEARCH=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
