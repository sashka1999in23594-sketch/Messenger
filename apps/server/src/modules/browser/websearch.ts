/**
 * Поиск по всему интернету для браузера Sunnet. Сервер сам спрашивает открытые
 * поисковые выдачи (Bing RSS, запасной — DuckDuckGo HTML) и Википедию, разбирает
 * ответ в простой список ссылок. В браузер пользователя не уходит ничего, кроме
 * этого списка: ни куки поисковиков, ни их скрипты.
 */

export interface WebResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 SunnetBrowser/1.0';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#039': "'", '#x27': "'" };
export const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (ENTITIES[e.toLowerCase()]) return ENTITIES[e.toLowerCase()]!;
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
      }
      return m;
    })
    // В RSS теги бывают экранированы (&lt;b&gt;) — после расшифровки снимаем их ещё раз
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Только обычные веб-ссылки: никаких javascript:, data: и прочего. */
export function cleanUrl(raw: string): string | null {
  try {
    const u = new URL(decode(raw));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Bing RSS: <item><title>…</title><link>…</link><description>…</description></item> */
export function parseBingRss(xml: string): WebResult[] {
  const out: WebResult[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1]!;
    const pick = (tag: string) => body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '';
    const url = cleanUrl(pick('link'));
    const title = decode(pick('title'));
    if (url && title) out.push({ title, url, snippet: decode(pick('description')).slice(0, 300), source: new URL(url).hostname.replace(/^www\./, '') });
  }
  return out;
}

/** DuckDuckGo HTML: ссылки result__a ведут через //duckduckgo.com/l/?uddg=<настоящий адрес> */
export function parseDuckHtml(html: string): WebResult[] {
  const out: WebResult[] = [];
  const blocks = html.split(/class="result results_links/).slice(1);
  for (const b of blocks) {
    const a = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let href = decode(a[1]!);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]!);
    if (href.startsWith('//')) href = `https:${href}`;
    const url = cleanUrl(href);
    if (!url || /duckduckgo\.com\/y\.js/.test(url)) continue; // реклама
    const snippet = decode(b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '');
    out.push({ title: decode(a[2]!), url, snippet: snippet.slice(0, 300), source: new URL(url).hostname.replace(/^www\./, '') });
  }
  return out;
}

async function get(url: string, ms = 7000): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.7' }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return text.slice(0, 2_000_000);
}

async function wikipedia(q: string): Promise<WebResult[]> {
  const api = `https://ru.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=4&srsearch=${encodeURIComponent(q)}`;
  const data = JSON.parse(await get(api)) as { query?: { search?: { title: string; snippet: string }[] } };
  return (data.query?.search ?? []).map((r) => ({
    title: r.title,
    url: `https://ru.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
    snippet: decode(r.snippet),
    source: 'Википедия',
  }));
}

/** Сводная выдача: сначала интернет, Википедия в конце; без повторов, не больше 24 ссылок. */
export async function webSearch(q: string): Promise<WebResult[]> {
  const enc = encodeURIComponent(q);
  const [bing, wiki] = await Promise.allSettled([get(`https://www.bing.com/search?format=rss&setlang=ru&cc=RU&count=30&q=${enc}`).then(parseBingRss), wikipedia(q)]);
  let web = bing.status === 'fulfilled' ? bing.value : [];
  if (web.length < 5) {
    const duck = await get(`https://html.duckduckgo.com/html/?kl=ru-ru&q=${enc}`).then(parseDuckHtml).catch(() => []);
    web = [...web, ...duck];
  }
  const all = [...web, ...(wiki.status === 'fulfilled' ? wiki.value : [])];
  const seen = new Set<string>();
  return all
    .filter((r) => {
      const key = r.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 24);
}
