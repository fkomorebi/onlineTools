/* ============================================
   通用工具函数
   ============================================ */
(function (global) {
  'use strict';

  /** 字节数 → 人类可读 */
  function formatBytes(bytes) {
    if (bytes === 0 || bytes == null) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), units.length - 1);
    const v = bytes / Math.pow(1024, i);
    const d = v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2;
    return v.toFixed(d) + ' ' + units[i];
  }

  /** 字节数 → 纯数字字符串（用于下载文件名） */
  function bytesToSize(bytes) {
    return formatBytes(bytes).replace(/\s+/g, '');
  }

  /** 安全创建 DOM 元素 */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  /** HTML 转义 */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** 触发浏览器下载 */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  /** 复制文本到剪贴板（带降级方案） */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      const ta = el('textarea', {
        style: 'position:fixed;top:-9999px;left:-9999px;opacity:0',
        text: text
      });
      document.body.appendChild(ta);
      ta.select();
      try {
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('execCommand failed'));
      } catch (e) {
        document.body.removeChild(ta);
        reject(e);
      }
    });
  }

  /** 读取文件为 ArrayBuffer */
  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('读取文件失败')); };
      fr.readAsArrayBuffer(file);
    });
  }

  /** 读取文件为文本 */
  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error || new Error('读取文件失败')); };
      fr.readAsText(file);
    });
  }

  /** 图片文件 → HTMLImageElement（从 blob URL 加载，保证 canvas 不污染） */
  function loadImage(blob) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片解码失败'));
      };
      img.src = url;
    });
  }

  /** 数字缩写：1234 → 1.2K */
  function compactNumber(n) {
    if (n < 1000) return String(n);
    if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'K';
    return (n / 1000000).toFixed(1) + 'M';
  }

  /** 简易防抖 */
  function debounce(fn, wait) {
    let t;
    return function () {
      const args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }

  /** 用自然排序比较文件名 */
  function naturalSort(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  global.U = {
    formatBytes: formatBytes,
    bytesToSize: bytesToSize,
    el: el,
    escapeHtml: escapeHtml,
    downloadBlob: downloadBlob,
    copyText: copyText,
    readFileAsArrayBuffer: readFileAsArrayBuffer,
    readFileAsText: readFileAsText,
    loadImage: loadImage,
    compactNumber: compactNumber,
    debounce: debounce,
    naturalSort: naturalSort
  };
})(window);
