/*
 * Сторож запуска: если через 15 секунд интерфейс так и не появился (устаревший
 * кэш после обновления сайта, сломанный service worker), один раз чистим кэш
 * оболочки и перезагружаем страницу. Личные данные и вход не трогаем.
 */
(function () {
  var KEY = 'sunnet-boot-retry';
  function mounted() {
    var r = document.getElementById('root');
    return !!(r && r.childElementCount);
  }
  setTimeout(function () {
    if (mounted()) {
      try { sessionStorage.removeItem(KEY); } catch (e) {}
      return;
    }
    try {
      if (sessionStorage.getItem(KEY)) return; // уже пробовали — не зацикливаемся
      sessionStorage.setItem(KEY, '1');
    } catch (e) {}
    var jobs = [];
    if ('caches' in window) jobs.push(caches.keys().then(function (k) { return Promise.all(k.map(function (n) { return caches.delete(n); })); }));
    if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
    Promise.all(jobs).catch(function () {}).then(function () { location.reload(); });
  }, 15000);
})();
