/** Небольшой живой огонь: canvas-слои пламени и искры, без видео/GPU-моделей. */
(function(){'use strict';
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('[data-bundle-fire]').forEach(function(canvas){
    var ctx=canvas.getContext('2d');if(!ctx)return;
    var w=90,h=85,dpr=Math.min(window.devicePixelRatio||1,2),active=true,frame=0;
    canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);
    function draw(ms){
      var t=reduce?1:ms*.001;ctx.clearRect(0,0,w,h);
      var glow=ctx.createRadialGradient(45,68,1,45,65,42);glow.addColorStop(0,'rgba(255,150,31,.27)');glow.addColorStop(1,'rgba(255,90,0,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
      for(var i=0;i<7;i++){
        var x=24+i*6,lean=Math.sin(t*3.1+i*2)*5+Math.sin(t*7+i)*2;
        var rise=26+Math.sin(t*4.3+i*1.7)*9+(i%3)*7,tip=x+lean;
        var g=ctx.createLinearGradient(x,72,tip,72-rise);g.addColorStop(0,'rgba(255,205,64,.95)');g.addColorStop(.35,'rgba(255,154,22,.82)');g.addColorStop(.78,'rgba(246,66,4,.67)');g.addColorStop(1,'rgba(244,60,0,0)');
        ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(x-10,73);ctx.bezierCurveTo(x-17,55,tip-5,58-rise*.55,tip,72-rise);ctx.bezierCurveTo(tip+2,59-rise*.35,x+17,62,x+10,73);ctx.closePath();ctx.fill();
      }
      var core=ctx.createRadialGradient(45,69,1,45,67,18);core.addColorStop(0,'rgba(255,250,195,.95)');core.addColorStop(.5,'rgba(255,201,40,.7)');core.addColorStop(1,'rgba(255,131,0,0)');ctx.fillStyle=core;ctx.fillRect(24,49,42,32);
      for(var p=0;p<4;p++){var age=(t*.25+p*.27)%1;ctx.globalAlpha=(1-age)*.75;ctx.fillStyle='#ffd474';ctx.beginPath();ctx.arc(39+Math.sin(p*4+t)*14,67-age*55,.5+(p%2)*.25,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;
      if(!reduce&&active&&!document.hidden)frame=requestAnimationFrame(draw);
    }
    function resume(){cancelAnimationFrame(frame);if(active&&!document.hidden)draw(performance.now());}
    if('IntersectionObserver' in window)new IntersectionObserver(function(entries){active=entries[0].isIntersecting;resume();}).observe(canvas);
    document.addEventListener('visibilitychange',resume);draw(1000);
  });
})();
