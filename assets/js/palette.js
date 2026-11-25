/* ============================================
   命令面板（Ctrl / ⌘ + K）
   —— 快速跳转工具、执行动作
   ============================================ */
(function (global) {
  'use strict';

  const { el } = global.U;
  const registry = global.ToolRegistry;

  // 工具清单来自共享注册表（与首页卡片保持一致），额外附加「关于」入口
  const TOOLS = registry.tools.map(function (t) {
    return {
      icon: t.icon,
      route: t.route,
      title: t.title,
      desc: t.desc,
      keywords: t.keywords,
      category: t.category
    };
  });
  TOOLS.push({ icon: 'ℹ️', route: '#/about', title: '关于', desc: '项目说明与隐私', keywords: '关于 说明 隐私 介绍' });

  let overlay = null;
  let input = null;
  let listBox = null;
  let items = [];
  let activeIndex = 0;
  let lastFocused = null;

  function buildItems(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return TOOLS.slice();
    const scored = [];
    TOOLS.forEach(function (t) {
      const title = t.title.toLowerCase();
      const desc = t.desc.toLowerCase();
      const keywords = String(t.keywords || '').toLowerCase();
      let score = -1;
      if (title === q) score = 0;
      else if (title.indexOf(q) === 0) score = 1;
      else if (title.indexOf(q) !== -1) score = 2;
      else if (keywords.indexOf(q) !== -1) score = 3;
      else if (desc.indexOf(q) !== -1) score = 4;
      else if (t.route.indexOf(q) !== -1) score = 5;
      if (score !== -1) scored.push({ tool: t, score: score });
    });
    scored.sort(function (a, b) { return a.score - b.score; });
    return scored.map(function (s) { return s.tool; });
  }

  function renderList() {
    listBox.innerHTML = '';
    if (!items.length) {
      listBox.appendChild(el('div', { class: 'palette-empty', text: '没有匹配的工具' }));
      return;
    }
    items.forEach(function (t, i) {
      const row = el('div', {
        class: 'palette-item' + (i === activeIndex ? ' active' : ''),
        onclick: function () { choose(i); }
      }, [
        el('span', { class: 'palette-item-icon', text: t.icon }),
        el('span', { class: 'palette-item-main' }, [
          el('span', { class: 'palette-item-title', text: t.title }),
          el('span', { class: 'palette-item-desc', text: t.desc })
        ]),
        el('span', { class: 'palette-item-key', text: t.route })
      ]);
      listBox.appendChild(row);
    });
  }

  function setActive(i) {
    if (!items.length) return;
    activeIndex = (i + items.length) % items.length;
    const rows = listBox.querySelectorAll('.palette-item');
    rows.forEach(function (r, idx) { r.classList.toggle('active', idx === activeIndex); });
    const active = rows[activeIndex];
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const t = items[i];
    if (!t) return;
    close();
    if (location.hash === t.route) {
      global.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      location.hash = t.route;
    }
  }

  function open() {
    if (overlay) return;
    lastFocused = document.activeElement;
    overlay = el('div', { class: 'palette-overlay', id: 'palette-overlay' });
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });

    const box = el('div', { class: 'palette', role: 'dialog', 'aria-label': '命令面板' });
    const head = el('div', { class: 'palette-head' }, [
      el('span', { class: 'palette-head-icon', text: '⌘' }),
      el('input', {
        class: 'palette-input', id: 'palette-input', type: 'text',
        placeholder: '搜索工具…（↑↓ 选择，Enter 打开，Esc 关闭）', spellcheck: 'false', autocomplete: 'off'
      })
    ]);
    box.appendChild(head);

    listBox = el('div', { class: 'palette-list', id: 'palette-list' });
    box.appendChild(listBox);

    box.appendChild(el('div', { class: 'palette-foot' }, [
      el('span', { text: '↑↓ 选择' }),
      el('span', { text: 'Enter 打开' }),
      el('span', { text: 'Esc 关闭' })
    ]));

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    input = box.querySelector('.palette-input');
    items = buildItems('');
    activeIndex = 0;
    renderList();
    input.focus();

    input.addEventListener('input', function () {
      items = buildItems(input.value);
      activeIndex = 0;
      renderList();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(activeIndex); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') {
        e.preventDefault();
        setActive(activeIndex + (e.shiftKey ? -1 : 1));
      }
    });
  }

  function close() {
    if (!overlay) return;
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    input = null;
    listBox = null;
    if (lastFocused && lastFocused.focus) {
      try { lastFocused.focus(); } catch (e) { /* ignore */ }
    }
    lastFocused = null;
  }

  function isOpen() { return !!overlay; }

  /** 全局快捷键：Ctrl+K / ⌘+K */
  function onKeyDown(e) {
    const key = (e.key || '').toLowerCase();
    if (key === 'k' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (isOpen()) close(); else open();
      return;
    }
    if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      close();
    }
  }

  document.addEventListener('keydown', onKeyDown);

  global.CommandPalette = {
    open: open,
    close: close,
    toggle: function () { if (isOpen()) close(); else open(); },
    isOpen: isOpen,
    tools: TOOLS
  };
})(window);
