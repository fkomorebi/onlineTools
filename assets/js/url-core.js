/* ============================================
   URL / Query 解析核心 —— 纯 JS，无依赖
   ============================================ */
(function (global) {
  'use strict';

  /**
   * 解析一个 URL，拆成结构化字段
   * 不依赖浏览器的 URL 构造器，因此相对路径也能解析
   *
   * @param {string} input
   * @returns {{
   *   ok: boolean,
   *   error: string,
   *   raw: string,
   *   scheme: string, username: string, password: string,
   *   host: string, hostname: string, port: string,
   *   path: string, query: string, hash: string,
   *   params: Array<{key:string, value:string, decodedKey:string, decodedValue:string}>,
   *   origin: string
   * }}
   */
  function parseUrl(input) {
    const raw = input == null ? '' : String(input);
    const s = raw.trim();

    const out = {
      ok: false,
      error: '',
      raw: s,
      scheme: '',
      username: '',
      password: '',
      host: '',
      hostname: '',
      port: '',
      path: '',
      query: '',
      hash: '',
      params: [],
      origin: ''
    };

    if (!s) {
      out.error = '请输入 URL';
      return out;
    }

    let rest = s;

    // 协议：scheme://
    const schemeMatch = rest.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(\/\/)?/);
    if (schemeMatch) {
      out.scheme = schemeMatch[1].toLowerCase();
      // 只切掉 "scheme:"，"//" 留给下面的 authority 拆分处理
      rest = rest.slice(schemeMatch[1].length + 1);
    }

    // 去掉 fragment
    const hashIdx = rest.indexOf('#');
    if (hashIdx !== -1) {
      out.hash = rest.slice(hashIdx + 1);
      rest = rest.slice(0, hashIdx);
    }

    // 去掉 query
    const qIdx = rest.indexOf('?');
    if (qIdx !== -1) {
      out.query = rest.slice(qIdx + 1);
      rest = rest.slice(0, qIdx);
    }

    // 拆 authority 与 path
    if (rest.indexOf('//') === 0) {
      rest = rest.slice(2);
      const slashIdx = rest.indexOf('/');
      let authority, path;
      if (slashIdx === -1) {
        authority = rest;
        path = '';
      } else {
        authority = rest.slice(0, slashIdx);
        path = rest.slice(slashIdx);
      }
      out.host = authority;

      // user:pass@host
      const atIdx = authority.lastIndexOf('@');
      if (atIdx !== -1) {
        const userinfo = authority.slice(0, atIdx);
        out.host = authority.slice(atIdx + 1);
        const colonIdx = userinfo.indexOf(':');
        if (colonIdx === -1) {
          out.username = userinfo;
        } else {
          out.username = userinfo.slice(0, colonIdx);
          out.password = userinfo.slice(colonIdx + 1);
        }
      }

      // IPv6 字面量 [::1]:8080
      const hostOnly = out.host;
      if (hostOnly.charAt(0) === '[') {
        const close = hostOnly.indexOf(']');
        if (close !== -1) {
          out.hostname = hostOnly.slice(0, close + 1);
          const after = hostOnly.slice(close + 1);
          if (after.charAt(0) === ':') out.port = after.slice(1);
        } else {
          out.hostname = hostOnly;
        }
      } else {
        const pIdx = hostOnly.indexOf(':');
        if (pIdx !== -1) {
          out.hostname = hostOnly.slice(0, pIdx);
          out.port = hostOnly.slice(pIdx + 1);
        } else {
          out.hostname = hostOnly;
        }
      }

      out.path = path || '/';
    } else {
      out.path = rest;
    }

    if (!out.hostname && out.host) out.hostname = out.host;

    // origin
    if (out.scheme && out.hostname) {
      out.origin = out.scheme + '://' + out.hostname + (out.port ? ':' + out.port : '');
    } else if (out.scheme && !out.hostname) {
      out.origin = out.scheme + ':';
    }

    // query 参数
    out.params = parseQuery(out.query);

    // 校验主机名
    if (out.scheme && /^(https?|ftp)$/.test(out.scheme) && !out.hostname) {
      out.error = 'URL 缺少主机名';
      return out;
    }

    out.ok = true;
    return out;
  }

  /**
   * 解析 query string 为参数数组
   * 支持 a=1&a=2（重复键）与 a（无值）
   * @param {string} query
   */
  function parseQuery(query) {
    const q = query == null ? '' : String(query);
    if (!q) return [];
    const parts = q.replace(/^[?&]/, '').split('&');
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === '') continue;
      const eq = parts[i].indexOf('=');
      const k = eq === -1 ? parts[i] : parts[i].slice(0, eq);
      const v = eq === -1 ? '' : parts[i].slice(eq + 1);
      out.push({
        key: k,
        value: v,
        decodedKey: safeDecode(k),
        decodedValue: safeDecode(v)
      });
    }
    return out;
  }

  /**
   * 由参数数组构建 query string
   * @param {Array<{key:string,value:string}>} params
   * @param {{encode?:boolean, sort?:boolean}} opts
   */
  function buildQuery(params, opts) {
    opts = opts || {};
    const encode = opts.encode !== false;
    let list = (params || []).filter(function (p) {
      return p && p.key !== undefined && p.key !== null && String(p.key) !== '';
    });
    if (opts.sort) {
      list = list.slice().sort(function (a, b) {
        const ka = String(a.key), kb = String(b.key);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
    }
    return list.map(function (p) {
      const k = encode ? encodeURIComponent(String(p.key)) : String(p.key);
      const hasValue = p.value !== undefined && p.value !== null && String(p.value) !== '';
      const v = encode ? encodeURIComponent(String(p.value == null ? '' : p.value)) : String(p.value);
      return hasValue ? k + '=' + v : k;
    }).join('&');
  }

  /** 把解析结果重新组装成 URL */
  function buildUrl(parts, opts) {
    opts = opts || {};
    let s = '';
    if (parts.scheme) {
      s += parts.scheme + '://';
      if (parts.username) {
        s += parts.username;
        if (parts.password) s += ':' + parts.password;
        s += '@';
      }
      s += parts.hostname || '';
      if (parts.port) s += ':' + parts.port;
    }
    s += parts.path || '';
    const query = opts.query !== undefined ? opts.query : buildQuery(parts.params, opts);
    if (query) s += '?' + query;
    if (parts.hash) s += '#' + parts.hash;
    return s;
  }

  /** 安全解码（非法转义时退回原串） */
  function safeDecode(str) {
    try {
      return decodeURIComponent(str);
    } catch (e) {
      return str;
    }
  }

  /** 安全编码 */
  function safeEncode(str) {
    try {
      return encodeURIComponent(str);
    } catch (e) {
      return String(str);
    }
  }

  /**
   * 智能猜测输入的编码类型
   * @returns {{type:string, label:string, decoded:string}}
   */
  function detectEncoding(input) {
    const s = input == null ? '' : String(input).trim();
    if (!s) return { type: 'plain', label: '纯文本', decoded: '' };

    // Base64
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0 && s.length >= 4) {
      try {
        const text = decodeURIComponent(escape(atob(s)));
        if (isMostlyPrintable(text)) {
          return { type: 'base64', label: 'Base64', decoded: text };
        }
      } catch (e) { /* 不是合法 Base64 */ }
    }

    // URL 编码
    if (/%[0-9a-fA-F]{2}/.test(s)) {
      try {
        const text = decodeURIComponent(s);
        if (text !== s) {
          return { type: 'url', label: 'URL 百分号编码', decoded: text };
        }
      } catch (e) { /* 非法转义 */ }
    }

    // 十六进制
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 8) {
      const bytes = [];
      for (let i = 0; i < s.length; i += 2) bytes.push(parseInt(s.substr(i, 2), 16));
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
        if (isMostlyPrintable(text)) {
          return { type: 'hex', label: '十六进制', decoded: text };
        }
      } catch (e) { /* 不是 UTF-8 文本 */ }
    }

    // HTML 实体
    if (/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/.test(s)) {
      const text = decodeEntities(s);
      if (text !== s) return { type: 'html', label: 'HTML 实体', decoded: text };
    }

    return { type: 'plain', label: '纯文本', decoded: s };
  }

  /** 判断字符串是否大部分为可打印字符 */
  function isMostlyPrintable(str) {
    if (!str.length) return false;
    let ok = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126) || code > 255) ok++;
    }
    return ok / str.length >= 0.85;
  }

  /** 解码 HTML 实体 */
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

  /** 编码 HTML 实体 */
  function encodeEntities(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  global.UrlCore = {
    parseUrl: parseUrl,
    parseQuery: parseQuery,
    buildQuery: buildQuery,
    buildUrl: buildUrl,
    safeDecode: safeDecode,
    safeEncode: safeEncode,
    detectEncoding: detectEncoding,
    decodeEntities: decodeEntities,
    encodeEntities: encodeEntities,
    isMostlyPrintable: isMostlyPrintable
  };
})(window);
