/** Серверная котировка корзины: браузер не получает закупку и не назначает скидку. */
(function () {
  'use strict';
  var KEY='iron_cart', METHOD='iron_payment_method', endpoint=(window.IRON_CONFIG||{}).cartQuoteUrl||'https://order-bot.4489530.workers.dev/cart-quote';
  var current=null, signature='', requestId=0, timer, pendingResolve;
  if(!document.querySelector('link[data-cart-pricing]')){var css=document.createElement('link');css.rel='stylesheet';css.href='/css/cart-pricing.css?v=2026-11-12';css.dataset.cartPricing='1';document.head.appendChild(css);}
  var en=/\/en\//.test(location.pathname);
  var money=function(n){return Number(n||0).toLocaleString(en?'en-US':'ru-RU')+' ₽';};
  function items(){try {var a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a:[];}catch(_){return [];}}
  function method(){var m=localStorage.getItem(METHOD)||'cash';return ['cash','card','invoice'].includes(m)?m:'cash';}
  function qty(p){var n=Number(p.orderQty)||1;return Math.max(1,Math.min(99,Math.trunc(n)));}
  function boxFor(root){
    var box=root.querySelector('.bundle-quote');if(box)return box;
    box=document.createElement('div');box.className='bundle-quote';box.setAttribute('aria-live','polite');
    var anchor=root.querySelector('.cart-summary,.pd-cart__sum');
    if(anchor)anchor.after(box);else root.appendChild(box);
    return box;
  }
  function roots(){return Array.from(document.querySelectorAll('#cart-panel,.pd-cart')).filter(function(x){return !x.closest('.rs-cart');});}
  function disable(on){document.querySelectorAll('#cart-telegram,#hybrid-cart-telegram,#offerCheckoutTelegram,#offer-cart-telegram,#cart-pay-card,#cart-pay-sbp,#hybrid-cart-pay-card,#hybrid-cart-pay-sbp').forEach(function(b){b.disabled=on;});}
  function render(q,error){
    roots().forEach(function(root){
      var box=boxFor(root);box.hidden=!items().length;
      box.replaceChildren();
      var note=document.createElement('p');note.className='bundle-quote__deal';
      note.textContent=error||(q?(q.discount.amount?(en?'You save ':'🎉 Ваша скидка: −')+money(q.discount.amount):(en?'Automatic savings from 2 devices over ₽50,000 each':'🎁 Автоскидка от 2 устройств дороже 50 000 ₽ каждое')):(en?'Calculating…':'Считаем скидку…'));
      box.appendChild(note);
      if(!q)return;
      if(q.discount.amount){var old=document.createElement('p');old.className='bundle-quote__before';old.textContent=(en?'Before discount: ':'До скидки: ')+money(q.subtotal);box.appendChild(old);}
      var labels={cash:en?'Cash':'Наличными',invoice:en?'Company invoice':'По счёту организации',card:en?'Card':'Картой'};
      Object.keys(labels).forEach(function(k){var label=document.createElement('label');label.className='bundle-payment';
        var input=document.createElement('input');input.type='radio';input.name='payment-'+(root.id||'detail');input.value=k;input.checked=method()===k;
        input.addEventListener('change',function(){localStorage.setItem(METHOD,k);update(items(),true);});
        var text=document.createElement('span');text.textContent=labels[k];var price=document.createElement('strong');price.textContent=money(q.payments[k]);
        label.append(input,text,price);box.appendChild(label);
      });
      var hint=document.createElement('small');hint.textContent=en?'We apply the best available discount, without stacking.':'Применяем самую выгодную скидку, без сложения.';box.appendChild(hint);
    });
    if(q){
      ['cart-total','cart-total-mobile','hybrid-cart-total-mobile','hybrid-cart-sum-mobile','offer-cart-total'].forEach(function(id){var e=document.getElementById(id);if(e)e.textContent=money(q.total);});
      document.querySelectorAll('#cart-pay-card,#hybrid-cart-pay-card').forEach(function(e){e.hidden=false;e.disabled=false;e.textContent=(en?'Pay by card · ':'Картой онлайн · ')+money(q.payments.card);});
      document.querySelectorAll('#cart-pay-breakdown').forEach(function(e){e.hidden=true;});
      document.querySelectorAll('#cart-pay-sbp,#hybrid-cart-pay-sbp').forEach(function(e){e.hidden=true;});
      var payUrl=String((window.IRON_CONFIG||{}).payApiUrl||'');
      if(payUrl&&window.IRON_PAY)Promise.all([window.IRON_PAY.load(),fetch(payUrl+'?action=modes').then(function(r){return r.json();}).catch(function(){return {};})]).then(function(v){if(!v[1].sbp_direct)return;document.querySelectorAll('#cart-pay-sbp,#hybrid-cart-pay-sbp').forEach(function(e){e.hidden=false;e.textContent=(en?'SBP · ':'СБП · ')+money(window.IRON_PAY.gross(q.cashTotal,'сбп',v[0]));});});
    }
  }
  function update(cart,force){
    cart=cart||items();var sig=JSON.stringify([cart,method()]);
    if(!force&&sig===signature){if(current)render(current);return Promise.resolve(current);}
    signature=sig;current=null;disable(!!cart.length);render(null);
    var id=++requestId;clearTimeout(timer);if(pendingResolve){pendingResolve(null);pendingResolve=null;}
    if(!cart.length){disable(true);return Promise.resolve(null);}
    return new Promise(function(resolve){pendingResolve=resolve;timer=setTimeout(function(){
      fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:cart,paymentMethod:method()})})
        .then(function(r){return r.json();}).then(function(d){if(id!==requestId){resolve(null);return;}if(!d.ok)throw Error(d.error||'Не удалось посчитать скидку');current=d.quote;render(current);disable(false);resolve(current);})
        .catch(function(e){if(id===requestId){render(null,en?'Could not calculate the cart. Retry.':e.message);disable(true);}resolve(null);});
    },100);});
  }
  window.IRON_CART_PRICE={update:update,getMethod:method,getQuote:function(){return current;},quantity:qty,
    payload:function(cart){return {items:cart,paymentMethod:method(),pricingVersion:'bundle-v1',expectedTotal:current&&current.total};}};
  window.addEventListener('storage',function(){update(items(),true);});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){update();});else update();
})();
