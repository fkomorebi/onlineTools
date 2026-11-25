/* ============================================
   顶部导航「更多」下拉菜单
   —— 按分类列出全部工具，避免导航栏过长
   ============================================ */
(function (global) {
  'use strict';

  const { el } = global.U;
  const registry = global.ToolRegistry;

  /** 顶部直接展示的工具（其余全部收进「更多」下拉） */
  const PINNED = ['#/json', '#/image', '#/datetime', '#/regex'];

  let trigger = null;
  let menu = null;
  let nav = null;
  let open = false;

  function isPinned(route) {
    return PINNED.indexOf(route) !== -1;
  }

  /** 构建下拉菜单内容 */
  function buildMenu() {
    menu.innerHTML = '';

    const groups = registry.grouped(
      registry.tools.filter(function (t) { return !isPinned(t.route); })
    );

    groups.forEach(function (group) {
      const sec = el('div', { class: 'nav-menu-group' }, [
        el('div', { class: 'nav-menu-title' }, [
          el('span', { class: 'nav-menu-title-icon', text: group.category.icon }),
          el('span', { text: group.category.name })
        ])
      ]);

      const list = el('div', { class: 'nav-menu-items' });
      group.tools.forEach(function (t) {
        list.appendChild(el('a', {
          class: 'nav-menu-item', href: t.route, role: 'menuitem', 'data-route': t.route
        }, [
          el('span', { class: 'nav-menu-item-icon', text: t.icon }),
          el('span', { class: 'nav-menu-item-title', text: t.title })
        ]));
      });
      sec.appendChild(list);
      menu.appendChild(sec);
    });

    menu.appendChild(el('a', {
      class: 'nav-menu-all', href: '#/', role: 'menuitem'
    }, [
      el('span', { text: '🏠' }),
      el('span', { text: '查看全部工具' })
    ]));
  }

  function show() {
    if (open) return;
    menu.hidden = false;
    open = true;
    trigger.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    // 下一帧再定位，确保菜单已有尺寸
    requestAnimationFrame(function () { menu.classList.add('visible'); });
  }

  function hide() {
    if (!open) return;
    open = false;
    menu.classList.remove('visible');
    trigger.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    setTimeout(function () {
      if (!open) menu.hidden = true;
    }, 140);
  }

  function toggle() {
    if (open) hide(); else show();
  }

  /** 高亮当前路由所在的菜单项 */
  function setActive(route) {
    if (!menu) return;
    menu.querySelectorAll('.nav-menu-item').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === route);
    });
  }

  function init() {
    trigger = document.getElementById('navMore');
    menu = document.getElementById('navMoreMenu');
    nav = document.getElementById('nav');
    if (!trigger || !menu) return;

    // 菜单内容在初始化时构建一次，之后仅切换显隐
    buildMenu();

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      toggle();
    });

    // 点击菜单外关闭
    document.addEventListener('click', function (e) {
      if (!open) return;
      if (menu.contains(e.target) || trigger.contains(e.target)) return;
      hide();
    });

    // Esc 关闭
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) {
        hide();
        trigger.focus();
      }
    });

    // 键盘导航：上下移动焦点
    menu.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [].slice.call(menu.querySelectorAll('a'));
      const idx = items.indexOf(document.activeElement);
      let next;
      if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % items.length;
      else next = idx <= 0 ? items.length - 1 : idx - 1;
      items[next].focus();
    });

    // 选择菜单项后关闭
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) hide();
    });

    // 路由变化时同步高亮
    global.addEventListener('hashchange', function () {
      const hash = location.hash;
      setActive(hash === '#/' || hash === '' ? null : hash);
      if (nav) nav.classList.remove('open');
      hide();
    });
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);

  global.NavMenu = {
    open: show,
    close: hide,
    toggle: toggle,
    setActive: setActive,
    pinned: PINNED
  };
})(window);
