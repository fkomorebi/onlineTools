/* ============================================
   核心模块加载器 —— 让浏览器的 *-core.js 能在 Node.js 里跑
   ----------------------------------------------------------
   网站的 `assets/js/*-core.js` 是纯计算逻辑，不碰 DOM，
   但它们统一用 `})(window)` 收尾，直接 require 到 Node 会报
   `window is not defined`。

   这里不改网站源码，而是在 Node 侧临时挂一个 `window` 别名指向
   globalThis，再把核心脚本读进来 eval —— 网站本身零改动，
   核心逻辑只有一份实现。
   ============================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'js');

/** 站点里可复用的核心模块（纯计算，不依赖 DOM） */
const CORE_MODULES = [
  'util.js',        // U：通用工具函数（json.js 在加载时依赖它）
  'json.js',        // JSONTool：解析 / 格式化 / 统计 / 路径取值
  'encode-core.js', // EncodeCore：Base64 / URL / Hex / HTML 实体
  'url-core.js',    // UrlCore：URL 拆解 / query 拼装
  'csv-core.js',    // CsvCore：CSV ⇄ JSON
  'datetime-core.js', // DateTimeCore：时间解析 / 时区 / 格式化
  'diff-core.js',   // DiffCore：LCS 行级 / 字符级差异
  'regex-core.js',  // RegexCore：编译 / 匹配 / 解释
  'color-core.js',  // ColorCore：颜色格式互转 / WCAG 对比度
  'password-core.js', // PasswordCore：密码生成 / 熵 / 弱口令
  'gif-core.js',    // GifCore：GIF89a 编码器
  'watermark-core.js', // WatermarkCore：去水印补片算法
  'image-core.js',  // ImageCore：依赖 canvas，Node 下不可用
  'audio-core.js'   // AudioCore：依赖 AudioContext，Node 下不可用
];

let loaded = null;

/**
 * 载入全部核心模块并挂到 globalThis 上。
 * @returns {object} 载入后的全局对象
 */
function loadCore() {
  if (loaded) return loaded;

  // 网站脚本以 `})(window)` 收尾 —— 在 Node 里补一个 window 别名。
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
  }

  // 少数核心模块用了浏览器专属的 Blob（json.js 的 stats 用它算字节数）。
  // Node 18+ 有 global Blob，但这里要保证 text/plain 下的 size 与浏览器一致。
  if (typeof globalThis.Blob === 'undefined') {
    globalThis.Blob = class Blob {
      constructor(parts) {
        this._text = (parts || [])
          .map(function (p) {
            return typeof p === 'string' ? p : String(p);
          })
          .join('');
      }
      get size() {
        return Buffer.byteLength(this._text, 'utf8');
      }
      text() {
        return Promise.resolve(this._text);
      }
    };
  }

  for (const file of CORE_MODULES) {
    const full = path.join(ASSETS_DIR, file);
    if (!fs.existsSync(full)) continue;
    const code = fs.readFileSync(full, 'utf8');
    try {
      // eslint-disable-next-line no-eval
      (0, eval)(code);
    } catch (e) {
      // image-core / audio-core 依赖浏览器 API，在 Node 下会失败；
      // 这类模块跳过即可 —— 它们的服务端实现走独立的 sharp / ffmpeg 路径。
      if (file === 'image-core.js' || file === 'audio-core.js') continue;
      throw new Error(`加载核心模块 ${file} 失败：${e.message}`);
    }
  }

  loaded = globalThis;
  return loaded;
}

/** 取得某个核心模块的导出，缺失时返回 null */
function core(name) {
  loadCore();
  return globalThis[name] || null;
}

module.exports = { loadCore, core, CORE_MODULES, ASSETS_DIR };
