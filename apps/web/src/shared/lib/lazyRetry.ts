/**
 * Загрузка части приложения с повторами. После обновления сайта открытая вкладка
 * может просить уже удалённый файл старой сборки — тогда один раз перезагружаем
 * страницу, чтобы взять новую версию (вместо «Не удалось показать это окно»).
 */
export const isChunkError = (e: unknown) =>
  e instanceof Error && /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|error loading dynamically/i.test(e.message);

export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem('sunnet-chunk-reload') || 0);
    if (Date.now() - last < 60_000) return false; // уже перезагружались только что — не зацикливаемся
    sessionStorage.setItem('sunnet-chunk-reload', String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

export function lazyRetry<T>(load: () => Promise<T>): Promise<T> {
  return load()
    .catch(() => new Promise<T>((ok, fail) => setTimeout(() => load().then(ok, fail), 800)))
    .catch((e: unknown) => {
      if (isChunkError(e)) reloadForNewVersion();
      throw e;
    });
}
