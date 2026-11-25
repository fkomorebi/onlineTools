/* ============================================
   命令面板（Ctrl / ⌘ + K）
   —— 快速跳转工具、执行动作
   ============================================ */
(function (global) {
  'use strict';

  const { el } = global.U;

  // 工具清单：与首页工具卡片保持一致
  const TOOLS = [
    { icon: '📋', route: '#/json', title: 'JSON 格式化', desc: '格式化 / 压缩 / 校验 / 树形浏览' },
    { icon: '🗜️', route: '#/image', title: '图片压缩', desc: '批量压缩，WebP / JPEG 输出' },
    { icon: '🔄', route: '#/convert', title: '格式转换', desc: 'PNG / WebP / JPEG 互转' },
    { icon: '🎞️', route: '#/gif', title: 'GIF 制作', desc: '多图合成动画 GIF' },
    { icon: '🕒', route: '#/datetime', title: '时间格式化', desc: '时区 / ISO / Unix 时间戳' },
    { icon: '🔍', route: '#/diff', title: '文本差异对比', desc: '逐行对比与字符级高亮' },
    { icon: '🔐', route: '#/password', title: '密码生成器', desc: '高强度密码与熵值' },
    { icon: '🎨', route: '#/color', title: '颜色工具', desc: '色彩空间互转与对比度' },
    { icon: '🔗', route: '#/url', title: 'URL 解析', desc: '拆解 URL 与查询参数' },
    { icon: '📊', route: '#/csv', title: 'CSV ⇄ JSON', desc: '表格数据互转' },
    { icon: '🔣', route: '#/encode', title: '编码转换', desc: 'Base64 / URL / Hex 编码' },
    { icon: '🎯', route: '#/regex', title: '正则测试台', desc: '实时匹配与表达式拆解' },
    { icon: '🧽', route: '#/watermark', title: '图片去水印', desc: '框选水印并重建像素' },
    { icon: 'ℹ️', route: '#/about', title: '关于', desc: '项目说明与隐私' }
  ];

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
      let score = -1;
      if (title === q) score = 0;
      else if (title.indexOf(q) === 0) score = 1;
      else if (title.indexOf(q) !== -1) score = 2;
      else if (desc.indexOf(q) !== -1) score = 3;
      else if (t.route.indexOf(q) !== -1) score = 4;
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
