/* Applies the saved colour theme before the page renders (avoids a light/dark flash). */
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('kcms-theme') || 'system'; } catch (e) { /* storage blocked */ }
  var dark = pref === 'dark' || (pref === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme-pref', pref);
})();
