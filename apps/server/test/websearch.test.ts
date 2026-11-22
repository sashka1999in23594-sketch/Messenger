import { describe, expect, it } from 'vitest';
import { cleanUrl, decode, parseBingRss, parseDuckHtml } from '../src/modules/browser/websearch.js';

describe('web search parsers', () => {
  it('parses Bing RSS and drops unsafe links', () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Bing</title>
      <item><title>Telegram &amp; ты</title><link>https://telegram.org/</link><description>Быстрый &lt;b&gt;мессенджер&lt;/b&gt;</description></item>
      <item><title>Плохая</title><link>javascript:alert(1)</link><description>x</description></item>
      <item><title>Вики</title><link>https://ru.wikipedia.org/wiki/Telegram</link><description><![CDATA[Статья]]></description></item>
    </channel></rss>`;
    const r = parseBingRss(xml);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ title: 'Telegram & ты', url: 'https://telegram.org/', snippet: 'Быстрый мессенджер', source: 'telegram.org' });
    expect(r[1]!.snippet).toBe('Статья');
  });

  it('parses DuckDuckGo HTML, unwraps redirect links and skips ads', () => {
    const html = `
      <div class="result results_links results_links_deep web-result">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.twitch.tv%2F&amp;rut=abc">Twitch</a>
        <a class="result__snippet" href="#">Стримы &#x27;вживую&#x27;</a>
      </div>
      <div class="result results_links results_links_deep result--ad">
        <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad=1">Реклама</a>
      </div>`;
    const r = parseDuckHtml(html);
    expect(r).toEqual([{ title: 'Twitch', url: 'https://www.twitch.tv/', snippet: "Стримы 'вживую'", source: 'twitch.tv' }]);
  });

  it('decodes entities and rejects non-web schemes', () => {
    expect(decode('a &amp; b &#1092; &nbsp;c')).toBe('a & b ф c');
    expect(cleanUrl('data:text/html,hi')).toBeNull();
    expect(cleanUrl('https://example.com/a?b=1&amp;c=2')).toBe('https://example.com/a?b=1&c=2');
  });
});
