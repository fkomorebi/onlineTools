/* ============================================
   应用入口 —— 哈希路由
   ============================================ */
(function (global) {
  'use strict';

  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');

  const ROUTES = {
    '':        { page: () => global.HomePage,    nav: null },
    '#/':      { page: () => global.HomePage,    nav: null },
    '#/json':  { page: () => global.JSONTool,    nav: '#/json' },
    '#/image': { page: () => global.ImageTool,   nav: '#/image' },
    '#/convert': { page: () => global.ConvertTool, nav: '#/convert' },
    '#/gif': { page: () => global.GifTool,    nav: '#/gif' },
    '#/datetime': { page: () => global.DateTimeTool, nav: '#/datetime' },
    '#/diff': { page: () => global.DiffTool,    nav: '#/diff' },
    '#/password': { page: () => global.PasswordTool, nav: '#/password' },
    '#/color': { page: () => global.ColorTool,  nav: '#/color' },
    '#/url': { page: () => global.UrlTool,      nav: '#/url' },
    '#/csv': { page: () => global.CsvTool,      nav: '#/csv' },
    '#/encode': { page: () => global.EncodeTool, nav: '#/encode' },
    '#/regex': { page: () => global.RegexTool,   nav: '#/regex' },
    '#/watermark': { page: () => global.WatermarkTool, nav: '#/watermark' },
    '#/about': { page: () => global.AboutPage,   nav: '#/about' }
  };

  function resolve(hash) {
    const h = (hash || '').replace(/^#/, '');
    return ROUTES[hash] || ROUTES['#' + h] || ROUTES[''];
  }

  function route() {
    const hash = location.hash;
    const entry = resolve(hash);
    const mod = entry.page();

    // 切页前清理上一页的全局状态
    if (mod && typeof mod.destroy === 'function') {
      try { mod.destroy(); } catch (e) { /* ignore */ }
    }

    if (!mod) {
      app.innerHTML = '<div class="card">页面不存在。<a href="#/">返回首页</a></div>';
      return;
    }
    mod.render(app);

    // 导航高亮
    nav.querySelectorAll('a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === entry.nav);
    });

    // 「更多」下拉菜单内的高亮
    if (global.NavMenu) global.NavMenu.setActive(entry.nav);

    nav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');

    // 回到顶部
    window.scrollTo(0, 0);
  }

  navToggle.addEventListener('click', function () {
    const open = nav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  const paletteTrigger = document.getElementById('paletteTrigger');
  if (paletteTrigger && global.CommandPalette) {
    paletteTrigger.addEventListener('click', function () {
      global.CommandPalette.toggle();
    });
  }

  global.addEventListener('hashchange', route);
  global.addEventListener('DOMContentLoaded', route);

  if (document.readyState !== 'loading') route();
})(window);
