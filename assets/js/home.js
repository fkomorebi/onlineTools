/* ============================================
   首页 —— 分类导航 + 搜索 + 快捷入口
   ============================================ */
(function (global) {
  'use strict';

  const { el } = global.U;
  const registry = global.ToolRegistry;

  let root = null;
  let gridHost = null;
  let resultCount = null;
  let searchInput = null;
  let activeCategory = 'all';
  let keyword = '';
  let filterTimer = null;

  /** 常用工具：首页顶部快捷入口 */
  const QUICK = ['#/json', '#/image', '#/convert', '#/datetime', '#/diff', '#/regex'];

  function toolByRoute(route) {
    return registry.tools.filter(function (t) { return t.route === route; })[0];
  }

  /** 渲染单张工具卡片 */
  function toolCard(t) {
    return el('a', { class: 'tool-card', href: t.route }, [
      el('div', { class: 'tool-card-head' }, [
        el('div', { class: 'tool-card-icon', text: t.icon }),
        el('span', { class: 'tool-card-cat', text: (registry.categoryMap[t.category] || {}).name || '' })
      ]),
      el('h3', { text: t.title }),
      el('p', { text: t.desc })
    ]);
  }

  /** 渲染某个分类下的工具网格 */
  function toolGrid(tools) {
    const grid = el('div', { class: 'tool-grid' });
    tools.forEach(function (t) { grid.appendChild(toolCard(t)); });
    return grid;
  }

  /** 顶部快捷入口 */
  function quickRow() {
    const row = el('div', { class: 'quick-row' });
    QUICK.forEach(function (route) {
      const t = toolByRoute(route);
      if (!t) return;
      row.appendChild(el('a', { class: 'quick-chip', href: t.route }, [
        el('span', { class: 'quick-chip-icon', text: t.icon }),
        el('span', { text: t.title })
      ]));
    });
    return row;
  }

  /** 分类筛选按钮 */
  function categoryBar() {
    const bar = el('div', { class: 'cat-bar', id: 'catBar' });

    const all = el('button', {
      class: 'cat-btn' + (activeCategory === 'all' ? ' active' : ''),
      type: 'button',
      text: '全部 ' + registry.tools.length,
      onclick: function () { setCategory('all'); }
    });
    bar.appendChild(all);

    registry.categories.forEach(function (c) {
      const count = registry.tools.filter(function (t) { return t.category === c.id; }).length;
      if (!count) return;
      const btn = el('button', {
        class: 'cat-btn' + (activeCategory === c.id ? ' active' : ''),
        type: 'button',
        onclick: function () { setCategory(c.id); }
      }, [
        el('span', { class: 'cat-btn-icon', text: c.icon }),
        el('span', { text: c.name }),
        el('span', { class: 'cat-btn-count', text: String(count) })
      ]);
      bar.appendChild(btn);
    });

    return bar;
  }

  function setCategory(id) {
    activeCategory = id;
    const bar = root.querySelector('#catBar');
    if (bar) {
      const btns = bar.querySelectorAll('.cat-btn');
      for (let i = 0; i < btns.length; i++) {
        const b = btns[i];
        const isAll = i === 0;
        b.classList.toggle('active', isAll ? id === 'all' : b.getAttribute('data-cat') === id);
      }
    }
    renderGrid();
  }

  /** 高亮当前分类按钮（不重新渲染列表） */
  function highlightCategory(id) {
    activeCategory = id;
    const bar = root && root.querySelector('#catBar');
    if (!bar) return;
    const btns = bar.querySelectorAll('.cat-btn');
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      const isAll = i === 0;
      b.classList.toggle('active', isAll ? id === 'all' : b.getAttribute('data-cat') === id);
    }
  }

  function currentTools() {
    let list = registry.search(keyword);
    if (activeCategory !== 'all') {
      list = list.filter(function (t) { return t.category === activeCategory; });
    }
    return list;
  }

  function renderGrid() {
    if (!gridHost) return;
    gridHost.innerHTML = '';

    const list = currentTools();

    if (resultCount) {
      resultCount.textContent = keyword
        ? '找到 ' + list.length + ' 个相关工具'
        : '共 ' + registry.tools.length + ' 个工具';
    }

    if (!list.length) {
      gridHost.appendChild(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-state-icon', text: '🔍' }),
        el('p', { text: '没有匹配「' + keyword + '」的工具' }),
        el('button', {
          class: 'empty-state-btn', type: 'button', text: '清空搜索',
          onclick: function () { keyword = ''; if (searchInput) searchInput.value = ''; setCategory('all'); }
        })
      ]));
      return;
    }

    // 无关键字时按分类分组展示，有关键字时统一平铺（避免分组割裂搜索结果）
    if (!keyword && activeCategory === 'all') {
      registry.grouped(list).forEach(function (group) {
        const section = el('section', { class: 'cat-section' });
        section.appendChild(el('div', { class: 'cat-section-head' }, [
          el('span', { class: 'cat-section-icon', text: group.category.icon }),
          el('h2', { class: 'cat-section-title', text: group.category.name }),
          el('span', { class: 'cat-section-count', text: group.tools.length + ' 个工具' })
        ]));
        section.appendChild(toolGrid(group.tools));
        gridHost.appendChild(section);
      });
    } else {
      gridHost.appendChild(toolGrid(list));
    }
  }

  function onSearchInput(value) {
    keyword = String(value || '');
    // 输入关键字时取消分类筛选，让搜索覆盖全部工具；清空关键字时同样恢复全部
    highlightCategory('all');
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(function () { renderGrid(); }, 90);
  }

  function render(elRoot) {
    root = elRoot;
    root.innerHTML = '';
    keyword = '';
    activeCategory = 'all';

    /* ---------- Hero ---------- */
    const hero = el('div', { class: 'hero' });
    hero.appendChild(el('h1', { text: '🧰 干净的在线工具箱' }));
    hero.appendChild(el('p', {
      text: '13 个常用工具，全部在浏览器里跑完 —— 没有广告、没有弹窗、没有追踪，文件不会上传到任何服务器。'
    }));

    // 搜索框
    const searchWrap = el('div', { class: 'home-search' }, [
      el('span', { class: 'home-search-icon', text: '🔍' }),
      el('input', {
        class: 'home-search-input', id: 'homeSearch', type: 'search',
        placeholder: '搜索工具，例如 JSON、图片、时间戳、正则…',
        spellcheck: 'false', autocomplete: 'off',
        'aria-label': '搜索工具'
      }),
      el('kbd', { class: 'home-search-kbd', text: 'Ctrl K' })
    ]);
    hero.appendChild(searchWrap);

    // 快捷入口
    const quick = el('div', { class: 'quick-wrap' });
    quick.appendChild(el('span', { class: 'quick-label', text: '常用' }));
    quick.appendChild(quickRow());
    hero.appendChild(quick);

    root.appendChild(hero);

    /* ---------- 分类 + 工具列表 ---------- */
    const listCard = el('div', { class: 'home-tools' });
    const listHead = el('div', { class: 'home-tools-head' }, [
      categoryBar(),
      el('span', { class: 'home-count', id: 'homeCount', text: '共 ' + registry.tools.length + ' 个工具' })
    ]);
    listCard.appendChild(listHead);

    gridHost = el('div', { id: 'homeGrid' });
    listCard.appendChild(gridHost);
    root.appendChild(listCard);

    /* ---------- 为什么做这个 ---------- */
    const card = el('div', { class: 'card', style: 'margin-top:26px' });
    card.appendChild(el('div', { class: 'card-title', text: '为什么做这个' }));
    const feats = el('div', { class: 'features' });
    [
      ['🔒 纯本地处理', '文件通过浏览器 File API 与 Canvas 在本机处理，不经过任何服务器，断网也能用。'],
      ['🚫 零广告', '没有横幅、弹窗、推荐位，也不写入任何追踪 Cookie。'],
      ['📦 无依赖', '纯原生 HTML/CSS/JS，无框架无 CDN，打开即用，加载极快。'],
      ['🔓 开源', '源码完全公开，欢迎 fork、提 issue 或自建部署。']
    ].forEach(function (f) {
      feats.appendChild(el('div', { class: 'feature' }, [
        el('h4', { text: f[0] }),
        el('p', { text: f[1] })
      ]));
    });
    card.appendChild(feats);
    root.appendChild(card);

    /* ---------- 快捷键 ---------- */
    const hintCard = el('div', { class: 'card', style: 'margin-top:18px' });
    hintCard.appendChild(el('div', { class: 'card-title', text: '快捷键' }));
    const kbdList = el('div', { class: 'kbd-list' });
    [
      ['Ctrl / ⌘ + K', '打开命令面板，快速搜索并跳转工具'],
      ['Esc', '关闭命令面板 / 清除去水印工具的选区']
    ].forEach(function (row) {
      kbdList.appendChild(el('div', { class: 'kbd-row' }, [
        el('span', { class: 'kbd', text: row[0] }),
        el('span', { text: row[1] })
      ]));
    });
    hintCard.appendChild(kbdList);
    root.appendChild(hintCard);

    /* ---------- 事件绑定 ---------- */
    searchInput = root.querySelector('#homeSearch');
    resultCount = root.querySelector('#homeCount');

    if (searchInput) {
      searchInput.addEventListener('input', function () { onSearchInput(searchInput.value); });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          searchInput.value = '';
          onSearchInput('');
        }
      });
    }

    // 分类按钮带上 data-cat，便于高亮切换
    const btns = root.querySelectorAll('#catBar .cat-btn');
    registry.categories.forEach(function (c, i) {
      // 第一个按钮是「全部」，其余按分类顺序对应
      const target = btns[i + 1];
      if (target) target.setAttribute('data-cat', c.id);
    });

    renderGrid();
  }

  global.HomePage = { render: render };
})(window);
