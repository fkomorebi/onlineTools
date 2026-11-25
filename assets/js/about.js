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
        <li>动画 GIF 由页面自带的 GIF89a 编码器在浏览器内生成 —— 浏览器原生只能编码静态位图，
        动画 GIF 的字节流是这里手写实现的，图片同样不会离开本机。</li>
        <li>JSON 用浏览器内置的 <code>JSON.parse</code> / <code>JSON.stringify</code> 处理。</li>
        <li>时间换算用浏览器内置的 <code>Date</code> 与 <code>Intl.DateTimeFormat</code>，
        时间戳直接来自 <code>Date.now()</code>，不经过任何服务器。</li>
        <li>文本差异对比在浏览器内计算最长公共子序列；密码由 <code>crypto.getRandomValues</code>
        本地生成；颜色格式转换与对比度计算都是纯数学运算 —— 都不上传任何输入内容。</li>
        <li>URL 解析、CSV 转换、编码转换、正则测试全部是纯文本运算，不发任何请求。</li>
        <li>图片去水印在 <code>Canvas</code> 上重建像素：把框选区域当作损坏区域，
        用周围像素做模糊 / 中位数 / 补片填充，图片像素始终留在本机。</li>
        <li>本站没有后端、没有数据库、不发送任何分析事件。</li>
        <li>页面里不写 <code>localStorage</code> 或 <code>cookie</code>，刷新后一切归零。</li>
      </ul>
      <p>唯一的一次网络请求是加载页面本身的 HTML / CSS / JS 静态文件（部署在 GitHub Pages 上）。</p>

      <h2>浏览器要求</h2>
      <p>需要支持 <code>Blob</code>、<code>FileReader</code>、<code>Canvas.toBlob</code> 与
      WebP 编码的现代浏览器 —— Chrome / Edge / Firefox / Safari 16+ 均可。
      WebP 输出依赖浏览器的 <code>canvas.toBlob('image/webp')</code> 支持度，
      主流浏览器均已原生支持。</p>
      <p>GIF 制作不依赖任何浏览器扩展能力 —— GIF89a 编码器是页面自带的纯 JS 实现，
      任何支持 <code>Canvas</code> 读取像素的浏览器都能用。</p>

      <h2>快捷键</h2>
      <ul>
        <li><span class="kbd">Ctrl</span> / <span class="kbd">Cmd</span> + <span class="kbd">Enter</span> —— 格式化 JSON</li>
        <li><span class="kbd">Ctrl</span> / <span class="kbd">Cmd</span> + <span class="kbd">K</span> —— 打开命令面板，快速搜索并跳转工具</li>
        <li><span class="kbd">Esc</span> —— 关闭命令面板，或清除去水印工具的选区</li>
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
        <li><code>assets/js/gif-core.js</code> —— GIF89a 编码核心</li>
        <li><code>assets/js/gif.js</code> —— GIF 制作</li>
        <li><code>assets/js/datetime-core.js</code> —— 时间格式化核心</li>
        <li><code>assets/js/datetime.js</code> —— 时间格式化</li>
        <li><code>assets/js/diff-core.js</code> —— 文本差异核心</li>
        <li><code>assets/js/diff.js</code> —— 文本差异对比</li>
        <li><code>assets/js/password-core.js</code> —— 密码生成核心</li>
        <li><code>assets/js/password.js</code> —— 密码生成器</li>
        <li><code>assets/js/color-core.js</code> —— 颜色转换核心</li>
        <li><code>assets/js/color.js</code> —— 颜色工具</li>
        <li><code>assets/js/url-core.js</code> —— URL 解析核心</li>
        <li><code>assets/js/url.js</code> —— URL 解析</li>
        <li><code>assets/js/csv-core.js</code> —— CSV / JSON 转换核心</li>
        <li><code>assets/js/csv.js</code> —— CSV ⇄ JSON</li>
        <li><code>assets/js/encode-core.js</code> —— 编码转换核心</li>
        <li><code>assets/js/encode.js</code> —— 编码转换</li>
        <li><code>assets/js/regex-core.js</code> —— 正则编译与解释核心</li>
        <li><code>assets/js/regex.js</code> —— 正则测试台</li>
        <li><code>assets/js/watermark-core.js</code> —— 像素重建核心</li>
        <li><code>assets/js/watermark.js</code> —— 图片去水印</li>
        <li><code>assets/js/palette.js</code> —— 命令面板</li>
      </ul>
    `;
    card.appendChild(box);
    root.appendChild(card);
  }

  global.AboutPage = { render: render };
})(window);
