/* ============================================
   编码 / 解码核心 —— Base64、URL、Hex、HTML 实体
   纯 JS，无依赖
   ============================================ */
(function (global) {
  'use strict';

  /** UTF-8 编码为字节数组 */
  function utf8Bytes(str) {
    const s = String(str == null ? '' : str);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(s);
    }
    // 手动 UTF-8 编码（兼容没有 TextEncoder 的旧环境）
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      let cp = s.codePointAt(i);
      if (cp > 0xffff) i++; // 跳过代理项低位
      if (cp < 0x80) {
        bytes.push(cp);
      } else if (cp < 0x800) {
        bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      } else if (cp < 0x10000) {
        bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else {
        bytes.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
      }
    }
    return new Uint8Array(bytes);
  }

  /** UTF-8 字节数组解码为字符串 */
  function utf8String(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(arr);
    }
    let out = '';
    let i = 0;
    while (i < arr.length) {
      const b = arr[i++];
      let cp;
      if (b < 0x80) cp = b;
      else if (b < 0xe0) cp = ((b & 0x1f) << 6) | (arr[i++] & 0x3f);
      else if (b < 0xf0) cp = ((b & 0x0f) << 12) | ((arr[i++] & 0x3f) << 6) | (arr[i++] & 0x3f);
      else cp = ((b & 0x07) << 18) | ((arr[i++] & 0x3f) << 12) | ((arr[i++] & 0x3f) << 6) | (arr[i++] & 0x3f);
      if (cp > 0xffff) {
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return out;
  }

  /** 字节 → Base64 */
  function bytesToBase64(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < arr.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, arr.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  /** Base64 → 字节（自动忽略空白，允许 URL-safe 变体） */
  function base64ToBytes(str) {
    let s = String(str == null ? '' : str).replace(/\s+/g, '');
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    // 补齐 padding
    const pad = s.length % 4;
    if (pad === 1) throw new Error('Base64 长度不合法（无法补齐）');
    if (pad > 0) s += '='.repeat(4 - pad);
    const binary = atob(s);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /** 字节 → 十六进制字符串 */
  function bytesToHex(bytes, opts) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const sep = opts && opts.separator !== undefined ? opts.separator : '';
    const upper = !!(opts && opts.uppercase);
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      out.push((upper ? arr[i].toString(16) : arr[i].toString(16).padStart(2, '0')).padStart(2, '0'));
    }
    return out.join(sep);
  }

  /** 十六进制字符串 → 字节 */
  function hexToBytes(str) {
    let s = String(str == null ? '' : str).replace(/\s+/g, '').replace(/^0x/i, '');
    if (s.indexOf(':') !== -1) s = s.replace(/:/g, '');
    if (s.length % 2 !== 0) throw new Error('十六进制长度必须是偶数');
    if (!/^[0-9a-fA-F]*$/.test(s)) throw new Error('包含非十六进制字符');
    const bytes = new Uint8Array(s.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(s.substr(i * 2, 2), 16);
    }
    return bytes;
  }

  /** 编码类型清单 */
  const ENCODERS = [
    { id: 'base64', label: 'Base64' },
    { id: 'base64url', label: 'Base64 URL-safe' },
    { id: 'url', label: 'URL 百分号编码' },
    { id: 'urlplus', label: 'URL 编码（空格转 +）' },
    { id: 'hex', label: '十六进制' },
    { id: 'html', label: 'HTML 实体' }
  ];

  /**
   * 按类型编码
   * @param {string} input
   * @param {string} type  ENCODERS 里的 id
   * @returns {{ok:boolean, error:string, output:string}}
   */
  function encode(input, type) {
    const s = input == null ? '' : String(input);
    try {
      switch (type) {
        case 'base64':
          return { ok: true, error: '', output: bytesToBase64(utf8Bytes(s)) };
        case 'base64url':
          return { ok: true, error: '', output: bytesToBase64(utf8Bytes(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
        case 'url':
          return { ok: true, error: '', output: encodeURIComponent(s) };
        case 'urlplus':
          return { ok: true, error: '', output: encodeURIComponent(s).replace(/%20/g, '+') };
        case 'hex':
          return { ok: true, error: '', output: bytesToHex(utf8Bytes(s), { uppercase: false }) };
        case 'html':
          return { ok: true, error: '', output: encodeEntities(s) };
        default:
          return { ok: false, error: '未知的编码类型：' + type, output: '' };
      }
    } catch (e) {
      return { ok: false, error: e.message, output: '' };
    }
  }

  /**
   * 按类型解码
   * @param {string} input
   * @param {string} type
   * @returns {{ok:boolean, error:string, output:string, binary?:boolean}}
   */
  function decode(input, type) {
    const s = input == null ? '' : String(input);
    try {
      switch (type) {
        case 'base64':
        case 'base64url': {
          const bytes = base64ToBytes(s);
          const text = utf8String(bytes);
          // 若是二进制内容（不可打印比例高），额外给出十六进制
          const binary = !isMostlyPrintable(text);
          return { ok: true, error: '', output: text, binary: binary };
        }
        case 'url':
          return { ok: true, error: '', output: decodeURIComponent(s) };
        case 'urlplus':
          return { ok: true, error: '', output: decodeURIComponent(s.replace(/\+/g, ' ')) };
        case 'hex': {
          const bytes = hexToBytes(s);
          const text = utf8String(bytes);
          return { ok: true, error: '', output: text, binary: !isMostlyPrintable(text) };
        }
        case 'html':
          return { ok: true, error: '', output: decodeEntities(s) };
        default:
          return { ok: false, error: '未知的解码类型：' + type, output: '' };
      }
    } catch (e) {
      return { ok: false, error: e.message, output: '' };
    }
  }

  /** 判断字符串是否大部分为可打印字符 */
  function isMostlyPrintable(str) {
    if (!str || !str.length) return false;
    let ok = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) || code > 255) ok++;
    }
    return ok / str.length >= 0.85;
  }

  /** HTML 实体编码 */
  function encodeEntities(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** HTML 实体解码 */
  function decodeEntities(str) {
    return String(str).replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, function (m, body) {
      if (body.charAt(0) === '#') {
        const code = body.charAt(1) === 'x' || body.charAt(1) === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        if (!isNaN(code) && code >= 0 && code <= 0x10ffff) {
          try { return String.fromCodePoint(code); } catch (e) { return m; }
        }
        return m;
      }
      const named = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
        copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–',
        laquo: '«', raquo: '»', middot: '·', bull: '•', trade: '™'
      };
      const lower = body.toLowerCase();
      return Object.prototype.hasOwnProperty.call(named, lower) ? named[lower] : m;
    });
  }

  /**
   * 智能检测输入的编码类型
   * @returns {{type:string, label:string, decoded:string, confidence:string}}
   */
  function detect(input) {
    const s = input == null ? '' : String(input);
    const trimmed = s.trim();
    if (!trimmed) return { type: 'plain', label: '纯文本', decoded: '', confidence: 'none' };

    // Base64
    if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed) && trimmed.length % 4 !== 1 && trimmed.length >= 4) {
      try {
        const bytes = base64ToBytes(trimmed);
        const text = utf8String(bytes);
        if (bytes.length > 0 && isMostlyPrintable(text)) {
          return { type: 'base64', label: 'Base64', decoded: text, confidence: 'high' };
        }
      } catch (e) { /* 继续尝试其它类型 */ }
    }

    // URL 百分号编码
    if (/%[0-9a-fA-F]{2}/.test(trimmed)) {
      try {
        const text = decodeURIComponent(trimmed);
        if (text !== trimmed) {
          return { type: 'url', label: 'URL 百分号编码', decoded: text, confidence: 'high' };
        }
      } catch (e) { /* 非法转义 */ }
    }

    // HTML 实体
    if (/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/.test(trimmed)) {
      const text = decodeEntities(trimmed);
      if (text !== trimmed) {
        return { type: 'html', label: 'HTML 实体', decoded: text, confidence: 'high' };
      }
    }

    // 十六进制
    if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0 && trimmed.length >= 8) {
      try {
        const bytes = hexToBytes(trimmed);
        const text = utf8String(bytes);
        if (isMostlyPrintable(text)) {
          return { type: 'hex', label: '十六进制', decoded: text, confidence: 'medium' };
        }
      } catch (e) { /* 不是合法十六进制文本 */ }
    }

    return { type: 'plain', label: '纯文本', decoded: s, confidence: 'low' };
  }

  global.EncodeCore = {
    ENCODERS: ENCODERS,
    utf8Bytes: utf8Bytes,
    utf8String: utf8String,
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    bytesToHex: bytesToHex,
    hexToBytes: hexToBytes,
    encode: encode,
    decode: decode,
    detect: detect,
    encodeEntities: encodeEntities,
    decodeEntities: decodeEntities,
    isMostlyPrintable: isMostlyPrintable
  };
})(window);
