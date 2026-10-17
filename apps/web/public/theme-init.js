(function () {
  // Тема применяется до отрисовки (без «вспышки»); внешний файл — совместим со строгим CSP
  var d = document.documentElement;
  try {
    var raw = localStorage.getItem('omni.prefs');
    var p = raw ? JSON.parse(raw).state || {} : {};
    var theme = p.theme || 'dark';
    if (theme === 'system') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    var accent = p.accent || 'auto';
    if (accent === 'teal') accent = 'cyan';
    d.dataset.theme = theme;
    d.dataset.palette = p.palette || 'aurora';
    d.dataset.accent = accent;
    d.dataset.glass = p.glass === false ? 'off' : 'on';
    d.dataset.aurora = p.aurora || 'animated';
    d.style.setProperty('--font-scale', String(p.fontScale || 1));
    if (p.density) d.dataset.density = p.density;
    if (p.reduceMotion) d.dataset.reduceMotion = 'true';
  } catch (e) {
    d.dataset.theme = 'dark';
    d.dataset.palette = 'aurora';
    d.dataset.accent = 'auto';
  }
})();
