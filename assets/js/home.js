/* ============================================
   首页
   ============================================ */
(function (global) {
  'use strict';

  const { el } = global.U;

  function render(root) {
    root.innerHTML = '';

    const hero = el('div', { class: 'hero' });
    hero.appendChild(el('h1', { text: '🧰 干净的在线工具箱' }));
    hero.appendChild(el('p', {
      text: 'JSON 格式化、图片压缩、格式转换、GIF 制作、时间格式化、文本对比、密码生成、颜色工具 —— 没有广告、没有弹窗、没有追踪。所有计算都在你的浏览器里完成。'
    }));
    root.appendChild(hero);

    const grid = el('div', { class: 'tool-grid' });
    const tools = [
      {
        icon: '📋', route: '#/json', title: 'JSON 格式化',
        desc: '格式化、压缩、校验，错误定位到行列，树形视图浏览结构，路径查询取值。'
      },
      {
        icon: '🗜️', route: '#/image', title: '图片压缩',
        desc: '批量压缩，WebP / JPEG 输出，可指定目标体积与最大尺寸，自动调节画质。'
      },
      {
        icon: '🔄', route: '#/convert', title: '格式转换',
        desc: 'PNG 转 WebP、WebP 转 PNG、JPEG 互转，保留透明通道，转换前后对比。'
      },
      {
        icon: '🎞️', route: '#/gif', title: 'GIF 制作',
        desc: '多张图片合成动画 GIF，可调帧延时、颜色数与尺寸压缩体积，支持拖拽排序。'
      },
      {
        icon: '🕒', route: '#/datetime', title: '时间格式化',
        desc: '时间转 UTC、ISO 8601、RFC、Unix 时间戳，多时区对照与自定义格式串。'
      },
      {
        icon: '🔍', route: '#/diff', title: '文本差异对比',
        desc: '逐行比较两段文本，标记新增 / 删除 / 修改，支持行内字符级高亮。'
      },
      {
        icon: '🔐', route: '#/password', title: '密码生成器',
        desc: '用密码学随机源生成高强度密码，显示熵值与估算破解时间，可批量导出。'
      },
      {
        icon: '🎨', route: '#/color', title: '颜色工具',
        desc: 'HEX / RGB / HSL / CMYK 互转，生成明度阶梯与和谐色板，WCAG 对比度检查。'
      }
    ];
    tools.forEach(function (t) {
      grid.appendChild(el('a', { class: 'tool-card', href: t.route }, [
        el('div', { class: 'tool-card-icon', text: t.icon }),
        el('h3', { text: t.title }),
        el('p', { text: t.desc })
      ]));
    });
    root.appendChild(grid);

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
  }

  global.HomePage = { render: render };
})(window);
