/* ============================================
   关于页
   ============================================ */
(function (global) {
  'use strict';

  const { el } = global.U;

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: '关于' }));
    head.appendChild(el('p', { text: '这个工具箱的由来与工作方式。' }));
    root.appendChild(head);

    const card = el('div', { class: 'card' });
    const box = el('div', { class: 'prose' });
    box.innerHTML = `
      <h2>为什么做这个</h2>
      <p>网上的在线工具站大多靠广告变现，打开一个 JSON 格式化页面可能弹出五六个广告窗口，
      更糟糕的是有些会偷偷读取你粘贴的数据。这个站点只做一件事：<strong>把常用的几个小工具
      干净地放在一个页面里</strong>。</p>

      <h2>隐私</h2>
      <p>所有工具都是纯前端实现：</p>
      <ul>
        <li>图片用 <code>FileReader</code> 读取，用 <code>Canvas</code> 缩放与编码，全程在浏览器内存中完成。</li>
        <li>JSON 用浏览器内置的 <code>JSON.parse</code> / <code>JSON.stringify</code> 处理。</li>
        <li>时间换算用浏览器内置的 <code>Date</code> 与 <code>Intl.DateTimeFormat</code>，
        时间戳直接来自 <code>Date.now()</code>，不经过任何服务器。</li>
        <li>本站没有后端、没有数据库、不发送任何分析事件。</li>
        <li>页面里不写 <code>localStorage</code> 或 <code>cookie</code>，刷新后一切归零。</li>
      </ul>
      <p>唯一的一次网络请求是加载页面本身的 HTML / CSS / JS 静态文件（部署在 GitHub Pages 上）。</p>

      <h2>浏览器要求</h2>
      <p>需要支持 <code>Blob</code>、<code>FileReader</code>、<code>Canvas.toBlob</code> 与
      WebP 编码的现代浏览器 —— Chrome / Edge / Firefox / Safari 16+ 均可。
      WebP 输出依赖浏览器的 <code>canvas.toBlob('image/webp')</code> 支持度，
      主流浏览器均已原生支持。</p>

      <h2>快捷键</h2>
      <ul>
        <li><span class="kbd">Ctrl</span> / <span class="kbd">Cmd</span> + <span class="kbd">Enter</span> —— 格式化 JSON</li>
      </ul>

      <h2>源码与部署</h2>
      <p>站点是纯静态文件，没有构建步骤，GitHub Pages 可以直接托管仓库根目录。
      本地预览只需任意静态服务器，例如：</p>
      <pre><code>npx serve .
# 或
python -m http.server 8080</code></pre>
      <p>如需改造，核心文件结构如下：</p>
      <ul>
        <li><code>index.html</code> —— 页面骨架</li>
        <li><code>assets/css/style.css</code> —— 全部样式</li>
        <li><code>assets/js/app.js</code> —— 路由与启动</li>
        <li><code>assets/js/util.js</code> —— 通用工具函数</li>
        <li><code>assets/js/json.js</code> —— JSON 工具</li>
        <li><code>assets/js/image-core.js</code> —— 图片处理核心</li>
        <li><code>assets/js/image.js</code> —— 图片压缩</li>
        <li><code>assets/js/convert.js</code> —— 格式转换</li>
        <li><code>assets/js/datetime-core.js</code> —— 时间格式化核心</li>
        <li><code>assets/js/datetime.js</code> —— 时间格式化</li>
      </ul>
    `;
    card.appendChild(box);
    root.appendChild(card);
  }

  global.AboutPage = { render: render };
})(window);
