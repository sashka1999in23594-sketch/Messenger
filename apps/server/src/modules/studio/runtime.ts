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

/** Скрипт-мост: API `sunnet` и `screen` внутри песочницы. */
const BRIDGE = `
(function(){
  var send=function(type,data){parent.postMessage(Object.assign({__sunnet:1,type:type},data||{}),'*');};
  function wrap(node){ if(!node) return null; return {
    node:node,
    onClick:function(fn){node.addEventListener('click',function(e){try{fn(e)}catch(err){send('error',{text:String(err&&err.message||err)})}});return this;},
    setText:function(t){node.textContent=String(t);return this;},
    getText:function(){return node.value!==undefined&&node.tagName==='INPUT'?node.value:node.textContent;},
    show:function(){node.style.display='';return this;},
    hide:function(){node.style.display='none';return this;},
    move:function(x,y){node.style.left=x+'px';node.style.top=y+'px';return this;},
    style:function(k,v){node.style[k]=v;return this;},
    animate:function(name,o){var d=(o&&o.duration)||600;node.style.animation='none';void node.offsetWidth;node.style.animation='sn-'+name+' '+d+'ms ease';return this;}
  };}
  window.screen = { find:function(name){var n=document.querySelector('[data-name="'+String(name).replace(/"/g,'')+'"]:not([hidden] *)')||document.querySelector('[data-name="'+String(name).replace(/"/g,'')+'"]');return wrap(n);} };
  window.ui = { button:function(text){var b=document.createElement('button');b.className='sn-el sn-btn';b.textContent=text;b.style.position='static';document.body.appendChild(b);return wrap(b);},
                text:function(t){var p=document.createElement('div');p.className='sn-el';p.textContent=t;p.style.position='static';document.body.appendChild(p);return wrap(p);} };
  window.sunnet = {
    notify:function(text){send('notify',{text:String(text).slice(0,300)});},
    go:function(screenName){document.querySelectorAll('.sn-screen').forEach(function(s){s.hidden=s.getAttribute('data-screen')!==String(screenName);});},
    request:function(permission){send('request',{permission:String(permission)});},
    state:{},
    version:'1.0'
  };
  window.addEventListener('error',function(e){send('error',{text:String(e.message)});});
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
          if (e.type === 'image') return `<img ${attrs} src="${esc(safeSrc(e.src))}" alt="${esc(e.name)}">`;
          if (e.type === 'button') return `<button ${attrs}>${esc(e.text ?? '')}</button>`;
          if (e.type === 'input') return `<input ${attrs} placeholder="${esc(e.text ?? '')}">`;
          return `<div ${attrs}>${esc(e.text ?? '')}</div>`;
        })
        .join('');
      return `<section class="sn-screen" data-screen="${esc(s.name)}" ${i ? 'hidden' : ''} style="${safeCss(s.bg) ? `background:${safeCss(s.bg)}` : ''}">${els}</section>`;
    })
    .join('');
  // Код пользователя — внутри <script>; закрывающий тег экранируется
  const code = p.scripts.map((s) => `try{\n${s.code.replace(/<\/script/gi, '<\\/script')}\n}catch(e){parent.postMessage({__sunnet:1,type:'error',text:String(e&&e.message||e)},'*')}`).join('\n');
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
