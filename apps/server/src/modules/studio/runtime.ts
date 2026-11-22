/**
 * Сборка приложения Студии в HTML для изолированного запуска.
 * Документ отдаётся с CSP `sandbox allow-scripts`: у него «непрозрачный» источник,
 * поэтому нет доступа к cookie, хранилищу и API Sunnet. Сеть запрещена (connect-src 'none').
 * С Sunnet приложение общается только сообщениями postMessage, а окно Sunnet
 * само решает, выполнять ли просьбу (уведомление, переход и т. п.) по выданным разрешениям.
 */
import { z } from 'zod';

const el = z.object({
  id: z.string().max(40),
  type: z.enum(['text', 'image', 'button', 'box', 'input']),
  name: z.string().max(80),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  text: z.string().max(2000).optional(),
  src: z.string().max(2000).optional(),
  color: z.string().max(40).optional(),
  bg: z.string().max(200).optional(),
  radius: z.number().optional(),
  fontSize: z.number().optional(),
  weight: z.number().optional(),
  anim: z.enum(['none', 'pulse', 'float', 'spin', 'fade', 'pop']).optional(),
});
export const projectSchema = z.object({
  screens: z
    .array(z.object({ id: z.string().max(40), name: z.string().max(80), bg: z.string().max(200).optional(), elements: z.array(el).max(300) }))
    .min(1)
    .max(30),
  scripts: z.array(z.object({ id: z.string().max(40), name: z.string().max(80), code: z.string().max(100_000) })).max(30),
  css: z.string().max(50_000).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type Project = z.infer<typeof projectSchema>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Цвет/фон: только безопасные значения (без url() и выражений). */
const safeCss = (v: string | undefined) => (v && /^[#\w\s(),.%-]+$/.test(v) && !/url\s*\(|expression/i.test(v) ? v : '');
const safeSrc = (v: string | undefined) => (v && /^(https:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(v) ? v : '');
const num = (n: number | undefined, d = 0) => (Number.isFinite(n) ? Math.round(n!) : d);

/**
 * Скрипт-мост: API `sunnet`, `screen`, `ui` внутри песочницы.
 * Всё, что выходит за пределы приложения (хранилище, профиль, интернет, оплата),
 * — это просьба к окну Sunnet через postMessage: оно проверяет разрешения, само
 * показывает окно оплаты и отвечает. Код приложения не видит ни cookie, ни API Sunnet.
 */
const BRIDGE = `
(function(){
  var seq=0, waits={};
  var send=function(type,data){parent.postMessage(Object.assign({__sunnet:1,type:type},data||{}),'*');};
  var call=function(method,args){return new Promise(function(ok,fail){var id=++seq;waits[id]={ok:ok,fail:fail};send('call',{id:id,method:method,args:args===undefined?null:args});});};
  window.addEventListener('message',function(e){
    if(e.source!==parent)return; var d=e.data; if(!d||!d.__sunnetReply||!waits[d.id])return;
    var w=waits[d.id]; delete waits[d.id]; if(d.ok)w.ok(d.data); else w.fail(new Error(String(d.error||'Ошибка')));
  });
  var report=function(err){send('error',{text:String(err&&err.message||err)});};
  var guard=function(fn){return function(e){try{var r=fn(e); if(r&&r.catch)r.catch(report);}catch(err){report(err)}};};
  function wrap(node){ if(!node) return null; return {
    node:node,
    onClick:function(fn){node.addEventListener('click',guard(fn));return this;},
    on:function(ev,fn){node.addEventListener(String(ev),guard(fn));return this;},
    setText:function(t){node.textContent=String(t);return this;},
    getText:function(){return node.tagName==='INPUT'?node.value:node.textContent;},
    value:function(v){if(v===undefined)return node.value;node.value=String(v);return this;},
    show:function(){node.style.display='';return this;},
    hide:function(){node.style.display='none';return this;},
    toggle:function(){node.style.display=node.style.display==='none'?'':'none';return this;},
    move:function(x,y,ms){if(ms){node.style.transition='left '+ms+'ms ease, top '+ms+'ms ease';}node.style.left=x+'px';node.style.top=y+'px';return this;},
    size:function(w,h){node.style.width=w+'px';node.style.height=h+'px';return this;},
    style:function(k,v){node.style[k]=v;return this;},
    setImage:function(src){if(node.tagName==='IMG'&&/^(https:|data:image)/.test(String(src)))node.src=String(src);return this;},
    animate:function(name,o){var d=(o&&o.duration)||600;node.style.animation='none';void node.offsetWidth;node.style.animation='sn-'+name+' '+d+'ms ease';return this;},
    remove:function(){node.remove();}
  };}
  var flow=function(el){el.style.position='static';el.style.margin='8px auto';document.querySelector('.sn-screen:not([hidden])')?document.querySelector('.sn-screen:not([hidden])').appendChild(el):document.body.appendChild(el);return wrap(el);};
  window.screen = {
    find:function(name){var q='[data-name="'+String(name).replace(/["\\\\]/g,'')+'"]';return wrap(document.querySelector('.sn-screen:not([hidden]) '+q)||document.querySelector(q));},
    all:function(){return Array.prototype.map.call(document.querySelectorAll('.sn-screen:not([hidden]) [data-name]'),function(n){return n.getAttribute('data-name');});}
  };
  window.ui = {
    button:function(text){var b=document.createElement('button');b.className='sn-el sn-button';b.textContent=text;b.style.padding='12px 22px';b.style.borderRadius='999px';return flow(b);},
    text:function(t){var p=document.createElement('div');p.className='sn-el';p.textContent=t;return flow(p);},
    input:function(ph){var i=document.createElement('input');i.className='sn-el sn-input';i.placeholder=ph||'';i.style.height='42px';i.style.borderRadius='14px';return flow(i);},
    image:function(src){var i=document.createElement('img');i.className='sn-el sn-image';if(/^(https:|data:image)/.test(String(src)))i.src=String(src);i.style.maxWidth='90%';return flow(i);},
    clear:function(){document.querySelectorAll('.sn-screen:not([hidden]) .sn-el:not([data-name])').forEach(function(n){n.remove();});}
  };
  var audio=null;
  var tone=function(f,d,t){try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();var o=audio.createOscillator(),g=audio.createGain();o.type=t||'sine';o.frequency.value=f;g.gain.setValueAtTime(.18,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+d);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+d);}catch(e){}};
  var SOUNDS={click:[[880,.06]],success:[[660,.12],[990,.18]],error:[[220,.25,'square']],coin:[[988,.08],[1319,.25]],pop:[[520,.08,'triangle']]};
  var listeners={};
  window.sunnet = {
    version:'2.0',
    state:{},
    notify:function(text){send('notify',{text:String(text).slice(0,300)});},
    go:function(screenName){document.querySelectorAll('.sn-screen').forEach(function(s){s.hidden=s.getAttribute('data-screen')!==String(screenName);});(listeners.screen||[]).forEach(function(f){guard(f)(String(screenName));});},
    on:function(ev,fn){(listeners[ev]=listeners[ev]||[]).push(fn);},
    request:function(permission){return call('request',String(permission));},
    user:function(){return call('user');},
    storage:{
      get:function(k){return call('storage.get',String(k));},
      set:function(k,v){return call('storage.set',{key:String(k),value:JSON.stringify(v===undefined?null:v)});},
      remove:function(k){return call('storage.remove',String(k));},
      keys:function(){return call('storage.keys');}
    },
    fetch:function(url){return call('fetch',String(url)).then(function(r){return {status:r.status,ok:r.status<400,text:function(){return r.text;},json:function(){return JSON.parse(r.text);}};});},
    pay:function(o){o=o||{};return call('pay',{amount:Number(o.amount),description:String(o.description||'Оплата').slice(0,128),method:o.method==='card'?'card':'sbp'});},
    sound:function(name){(SOUNDS[name]||SOUNDS.click).forEach(function(s,i){setTimeout(function(){tone(s[0],s[1],s[2]);},i*110);});},
    vibrate:function(ms){try{navigator.vibrate&&navigator.vibrate(Math.min(1000,ms||50));}catch(e){}},
    wait:function(ms){return new Promise(function(r){setTimeout(r,Math.max(0,ms|0));});},
    every:function(ms,fn){return setInterval(guard(fn),Math.max(16,ms|0));},
    after:function(ms,fn){return setTimeout(guard(fn),Math.max(0,ms|0));},
    stop:function(t){clearInterval(t);clearTimeout(t);},
    random:function(a,b){a=Number(a)||0;b=b===undefined?1:Number(b);return Math.floor(a+Math.random()*(b-a+1));},
    confetti:function(){var c=document.createElement('canvas');c.width=innerWidth;c.height=innerHeight;c.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:99';document.body.appendChild(c);var x=c.getContext('2d'),P=[],cols=['#ffb341','#ff6f61','#4aa3ff','#34d399','#c084fc'];for(var i=0;i<140;i++)P.push({x:c.width/2,y:c.height/3,vx:(Math.random()-.5)*12,vy:Math.random()*-12-3,r:Math.random()*6+3,c:cols[i%5],a:Math.random()*6});var t=0;(function f(){x.clearRect(0,0,c.width,c.height);P.forEach(function(p){p.vy+=.35;p.x+=p.vx;p.y+=p.vy;p.a+=.2;x.fillStyle=p.c;x.save();x.translate(p.x,p.y);x.rotate(p.a);x.fillRect(-p.r/2,-p.r/2,p.r,p.r*.6);x.restore();});if(++t<120)requestAnimationFrame(f);else c.remove();})();},
    log:function(){send('log',{text:Array.prototype.map.call(arguments,function(a){try{return typeof a==='string'?a:JSON.stringify(a);}catch(e){return String(a);}}).join(' ').slice(0,500)});}
  };
  window.addEventListener('error',function(e){report(e.message);});
  window.addEventListener('unhandledrejection',function(e){report(e.reason);});
})();`;

export function buildHtml(p: Project): string {
  const w = num(p.width, 420);
  const h = num(p.height, 640);
  const screens = p.screens
    .map((s, i) => {
      const els = s.elements
        .map((e) => {
          const st = `left:${num(e.x)}px;top:${num(e.y)}px;width:${num(e.w, 100)}px;height:${num(e.h, 40)}px;${safeCss(e.color) ? `color:${safeCss(e.color)};` : ''}${safeCss(e.bg) ? `background:${safeCss(e.bg)};` : ''}border-radius:${num(e.radius)}px;font-size:${num(e.fontSize, 16)}px;font-weight:${num(e.weight, 500)};${e.anim && e.anim !== 'none' ? `animation:sn-${e.anim} 2.4s ease-in-out infinite;` : ''}`;
          const attrs = `class="sn-el sn-${e.type}" data-name="${esc(e.name)}" style="${st}"`;
          if (e.type === 'image') return safeSrc(e.src) ? `<img ${attrs} src="${esc(safeSrc(e.src))}" alt="${esc(e.name)}">` : `<div ${attrs}></div>`;
          if (e.type === 'button') return `<button ${attrs}>${esc(e.text ?? '')}</button>`;
          if (e.type === 'input') return `<input ${attrs} placeholder="${esc(e.text ?? '')}">`;
          return `<div ${attrs}>${esc(e.text ?? '')}</div>`;
        })
        .join('');
      return `<section class="sn-screen" data-screen="${esc(s.name)}" ${i ? 'hidden' : ''} style="${safeCss(s.bg) ? `background:${safeCss(s.bg)}` : ''}">${els}</section>`;
    })
    .join('');
  // Код пользователя — внутри <script>; закрывающий тег экранируется
  // Каждый скрипт — асинхронная функция: можно писать await sunnet.storage.get(…) прямо сверху
  const code = p.scripts
    .map((s) => `(async function(){\n${s.code.replace(/<\/script/gi, '<\\/script')}\n})().catch(function(e){parent.postMessage({__sunnet:1,type:'error',text:String(e&&e.message||e)},'*')});`)
    .join('\n');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#fff}
.sn-screen{position:relative;width:${w}px;height:${h}px;max-width:100%;margin:0 auto;overflow:hidden;background:linear-gradient(180deg,#eaf3ff,#fff)}
.sn-el{position:absolute;display:flex;align-items:center;justify-content:center;text-align:center;border:0;padding:0;overflow:hidden}
.sn-image{object-fit:cover}.sn-button{cursor:pointer;background:#2f7cf6;color:#fff;transition:transform .2s}.sn-button:active{transform:scale(.96)}
.sn-input{border:1px solid #cfd8e6;padding:0 10px;background:#fff;text-align:left}
@keyframes sn-pulse{50%{transform:scale(1.06)}}@keyframes sn-float{50%{transform:translateY(-8px)}}@keyframes sn-spin{to{transform:rotate(360deg)}}
@keyframes sn-fade{50%{opacity:.4}}@keyframes sn-pop{0%{transform:scale(.6);opacity:0}100%{transform:none;opacity:1}}
${(p.css ?? '').replace(/<\/style/gi, '')}
</style></head><body>${screens}<script>${BRIDGE}</script><script>${code}</script></body></html>`;
}

export const RUNTIME_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; media-src data: https:; font-src data:; connect-src 'none'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'";
