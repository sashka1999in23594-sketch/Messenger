#!/usr/bin/env node
/**
 * Sunnet Connect — подключает ваш компьютер (или VPS, или сервис на Render) к Sunnet
 * как сервер. Без настройки роутера: соединение только исходящее (HTTPS к Sunnet),
 * проброс портов не нужен.
 *
 * Запуск:   node sunnet-connect.mjs КОД-ИЗ-SUNNET
 *           (или переменная SUNNET_CONNECT_CODE; адрес Sunnet — SUNNET_URL)
 * Статус:   откройте http://127.0.0.1:7470 — там видно, подключён ли сервер,
 *           какие ресурсы доступны, есть ли ошибки и что настроить.
 *
 * Программа только СООБЩАЕТ Sunnet о состоянии устройства. Она не принимает команд
 * извне, не открывает входящих портов наружу (страница статуса — только на 127.0.0.1)
 * и не трогает ваши файлы.
 */
import { createServer } from 'node:http';
import os from 'node:os';
import { statfs } from 'node:fs/promises';

const VERSION = '1.0.0';
const SERVER = (process.env.SUNNET_URL || 'https://omni-w0fb.onrender.com').replace(/\/+$/, '');
const CODE = (process.argv[2] || process.env.SUNNET_CONNECT_CODE || '').trim().toUpperCase();
const PORT = Number(process.env.SUNNET_CONNECT_PORT || 7470);
const EVERY_MS = 30_000;

const state = {
  connected: false,
  server: null,
  lastOk: null,
  lastError: null,
  latencyMs: null,
  checks: [],
  problems: [],
  resources: null,
};

const c = (n, s) => (process.stdout.isTTY ? `\x1b[${n}m${s}\x1b[0m` : s);

async function resources() {
  let diskFreeGb = null;
  try {
    const st = await statfs(os.homedir());
    diskFreeGb = Math.round(((st.bavail * st.bsize) / 1024 ** 3) * 10) / 10;
  } catch {
    /* старый Node или нет доступа — пропускаем */
  }
  const cores = os.cpus().length || 1;
  return {
    host: os.hostname().slice(0, 80),
    os: `${os.type()} ${os.release()}`.slice(0, 80),
    cpuLoad: Math.round((os.loadavg()[0] / cores) * 100),
    memFreeMb: Math.round(os.freemem() / 1024 ** 2),
    memTotalMb: Math.round(os.totalmem() / 1024 ** 2),
    diskFreeGb,
    cores,
  };
}

function diagnose(r, latencyMs) {
  const p = [];
  if (r.diskFreeGb !== null && r.diskFreeGb < 2) p.push(`Мало места на диске: ${r.diskFreeGb} ГБ (нужно от 2 ГБ)`);
  if (r.memFreeMb < 300) p.push(`Мало свободной памяти: ${r.memFreeMb} МБ`);
  if (r.cpuLoad > 90) p.push(`Процессор загружен на ${r.cpuLoad}% — сервер будет отвечать медленно`);
  if (latencyMs !== null && latencyMs > 1500) p.push(`Медленная связь с Sunnet: ${latencyMs} мс`);
  if (process.platform === 'win32') p.push('Windows: в «Электропитании» отключите сон, пока работает сервер');
  if (process.platform === 'darwin') p.push('macOS: в «Аккумуляторе» включите «Не переходить в сон при закрытой крышке» на время работы сервера');
  return p;
}

async function beat() {
  const r = await resources();
  const t0 = Date.now();
  try {
    const health = await fetch(`${SERVER}/api/v1/health`, { signal: AbortSignal.timeout(60_000) });
    if (!health.ok) throw new Error(`Sunnet ответил ${health.status} (возможно, сервер просыпается)`);
    const latencyMs = Date.now() - t0;
    const problems = diagnose(r, latencyMs);
    const res = await fetch(`${SERVER}/api/v1/connect/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: CODE, ...r, cores: undefined, latencyMs, version: VERSION, problems }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || `Sunnet не принял сигнал (${res.status})`);
    Object.assign(state, { connected: true, server: body.server, lastOk: new Date(), lastError: null, latencyMs, checks: body.checks || [], problems, resources: r });
    console.log(`${c(32, '●')} ${new Date().toLocaleTimeString('ru')}  Подключено к «${body.server}» · ${latencyMs} мс · CPU ${r.cpuLoad}% · свободно ${r.memFreeMb} МБ / ${r.diskFreeGb ?? '?'} ГБ`);
    for (const pr of problems) console.log(`  ${c(33, '!')} ${pr}`);
  } catch (e) {
    Object.assign(state, { connected: false, lastError: e?.message || String(e), resources: r });
    console.log(`${c(31, '●')} ${new Date().toLocaleTimeString('ru')}  Нет связи: ${state.lastError}`);
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[x]);

function page() {
  const r = state.resources || {};
  const row = (ok, text) => `<li class="${ok ? 'ok' : 'bad'}"><i></i>${esc(text)}</li>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="refresh" content="10"><title>Sunnet Connect</title>
<style>
body{margin:0;font:15px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;background:linear-gradient(180deg,#2c78e4,#86bdf6 60%,#fff);min-height:100vh;color:#0d1a2d}
main{max-width:620px;margin:40px auto;padding:28px;border-radius:28px;background:rgba(255,255,255,.88);box-shadow:0 30px 80px -20px rgba(10,40,100,.45)}
h1{margin:0;font-size:24px}.st{display:flex;gap:16px;align-items:center;margin:18px 0}
.dot{width:64px;height:64px;border-radius:50%;flex:none;background:${state.connected ? '#18a058' : '#e5484d'};box-shadow:0 0 0 10px ${state.connected ? 'rgba(24,160,88,.15)' : 'rgba(229,72,77,.15)'};animation:p 2s ease-in-out infinite}
@keyframes p{50%{box-shadow:0 0 0 16px transparent}}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}.grid div{padding:12px;border-radius:16px;background:#eef4fb}.grid b{display:block;font-size:20px}
ul{list-style:none;padding:0;margin:8px 0}li{display:flex;gap:10px;align-items:center;padding:6px 0}li i{width:10px;height:10px;border-radius:50%;background:#18a058;flex:none}li.bad i{background:#e5a100}
code{padding:2px 8px;border-radius:8px;background:#eef4fb}small{color:#5a6a85}
</style></head><body><main>
<h1>Sunnet Connect ${VERSION}</h1>
<div class="st"><span class="dot"></span><div><b>${state.connected ? `Подключено: «${esc(state.server)}»` : 'Не подключено'}</b><br>
<small>${state.connected ? `Последний сигнал ${esc(state.lastOk?.toLocaleTimeString('ru'))} · задержка ${esc(state.latencyMs)} мс` : esc(state.lastError || 'Подключаемся…')}</small></div></div>
<div class="grid"><div>Процессор<b>${esc(r.cpuLoad ?? '—')}%</b><small>${esc(r.cores ?? '')} ядер</small></div><div>Память<b>${esc(r.memFreeMb ?? '—')} МБ</b><small>свободно из ${esc(r.memTotalMb ?? '—')}</small></div><div>Диск<b>${esc(r.diskFreeGb ?? '—')} ГБ</b><small>свободно</small></div></div>
<h3>Проверка в Sunnet</h3><ul>${state.checks.map((x) => row(x.ok, x.label)).join('') || '<li>Появится после первого сигнала</li>'}</ul>
${state.problems.length ? `<h3>Что настроить</h3><ul>${state.problems.map((p) => row(false, p)).join('')}</ul>` : ''}
<h3>Данные для Sunnet</h3><p>Сервер Sunnet: <code>${esc(SERVER)}</code><br>Устройство: <code>${esc(r.host)}</code> · ${esc(r.os)}<br><small>Код подключения указан при запуске. Новый код — в Sunnet → Серверы → ваш сервер.</small></p>
</main></body></html>`;
}

if (!/^[A-Z0-9-]{10,40}$/.test(CODE)) {
  console.log(`${c(1, 'Sunnet Connect')} ${VERSION}\n\nУкажите код подключения из Sunnet → Серверы:\n  node sunnet-connect.mjs XXXX-XXXX-XXXX\n`);
  process.exit(1);
}

createServer((req, res) => {
  // Только локальная страница статуса, без каких-либо действий
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
  res.end(page());
}).listen(PORT, '127.0.0.1', () => console.log(`${c(1, 'Sunnet Connect')} ${VERSION} · статус: http://127.0.0.1:${PORT} · Sunnet: ${SERVER}\n`));

await beat();
setInterval(() => void beat(), EVERY_MS);
