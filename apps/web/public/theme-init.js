(function () {
  try {
    var raw = localStorage.getItem('omni.prefs');
    var p = raw ? JSON.parse(raw).state || {} : {};
    var theme = p.theme || 'system';
    if (theme === 'system') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    var d = document.documentElement;
    d.dataset.theme = theme;
    d.dataset.accent = p.accent || 'violet';
    d.style.setProperty('--font-scale', String(p.fontScale || 1));
    if (p.density) d.dataset.density = p.density;
    if (p.reduceMotion) d.dataset.reduceMotion = 'true';
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
