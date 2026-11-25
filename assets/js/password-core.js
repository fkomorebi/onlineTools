/* ============================================
   密码生成器 —— 核心算法（纯 JS，无依赖）
   ============================================ */
(function (global) {
  'use strict';

  const CHARSETS = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    symbols: '!@#$%^&*()-_=+[]{};:,.<>?/~'
  };

  // 容易被混淆的字符（可选择排除）
  const AMBIGUOUS = 'Il1O0o|`\'";:,.{}[]()/\\';

  /**
   * 按「字符」切分字符串
   *
   * 用 Array.from 而非 split('')，否则中文等 BMP 之外的字符（代理对）会被拆成两半。
   */
  function splitChars(str) {
    return Array.from(String(str == null ? '' : str));
  }

  /**
   * 使用密码学安全的随机数源生成 [0, max) 的整数
   *
   * 用拒绝采样消除取模偏差 —— 直接用 % 会让低位字符出现概率略高。
   *
   * @param {number} max
   * @param {Array} [rng] 可注入的随机源（测试用）
   */
  function randomInt(max, rng) {
    if (max <= 0) return 0;
    const source = rng || defaultRng;
    // 取最大的 2 的幂上界，超出即重试
    const limit = Math.floor(0xFFFFFFFF / max) * max;
    const buf = new Uint32Array(1);
    let v;
    do {
      source(buf);
      v = buf[0];
    } while (v >= limit);
    return v % max;
  }

  /** 默认随机源：crypto.getRandomValues */
  function defaultRng(buf) {
    const c = global.crypto || global.msCrypto;
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(buf);
      return;
    }
    // 极端降级（无 crypto 的老环境）—— 仅在必要时使用
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 0x100000000);
  }

  /** 是否有可用的密码学随机源 */
  function hasCrypto() {
    const c = global.crypto || global.msCrypto;
    return !!(c && typeof c.getRandomValues === 'function');
  }

  /**
   * 构造字符池
   * @param {Object} opts
   *   lower/upper/digits/symbols: boolean
   *   excludeAmbiguous: boolean
   *   custom: string 自定义字符集 —— 一旦填写就**取代**内置符号集，
   *            这样该输入框才有实际作用（否则自定义字符会被内置符号集淹没）
   */
  function buildPool(opts) {
    const o = opts || {};
    let pool = '';
    if (o.lower !== false) pool += CHARSETS.lower;
    if (o.upper !== false) pool += CHARSETS.upper;
    if (o.digits !== false) pool += CHARSETS.digits;
    const custom = o.custom ? String(o.custom) : '';
    if (custom) pool += custom;
    else if (o.symbols !== false) pool += CHARSETS.symbols;
    if (o.excludeAmbiguous) {
      pool = splitChars(pool).filter(function (c) {
        return AMBIGUOUS.indexOf(c) === -1;
      }).join('');
    }
    // 去重
    const seen = new Set();
    let out = '';
    for (const c of splitChars(pool)) {
      if (!seen.has(c)) { seen.add(c); out += c; }
    }
    return out;
  }

  /**
   * 生成密码
   *
   * 规则：先按类别各取至少一个（保证「每类必含」），再用整个字符池补足剩余长度。
   *
   * @param {Object} opts
   *   length: number
   *   lower/upper/digits/symbols: boolean
   *   excludeAmbiguous: boolean
   *   custom: string
   *   requireEach: boolean 每类至少一个
   *   rng: Array 可注入随机源
   * @returns {{password:string, ok:boolean, error?:string}}
   */
  function generate(opts) {
    const o = opts || {};
    const length = Math.max(1, Math.floor(o.length == null ? 16 : o.length));

    const pool = buildPool(o);
    if (!pool) {
      return { password: '', ok: false, error: '字符集为空，请至少启用一类字符。' };
    }

    const groups = [];
    if (o.lower !== false) groups.push(filterGroup(CHARSETS.lower, o));
    if (o.upper !== false) groups.push(filterGroup(CHARSETS.upper, o));
    if (o.digits !== false) groups.push(filterGroup(CHARSETS.digits, o));
    // 自定义字符集一旦填写就取代内置符号集（与 buildPool 保持一致）
    if (o.custom) groups.push(filterGroup(String(o.custom), o));
    else if (o.symbols !== false) groups.push(filterGroup(CHARSETS.symbols, o));

    const needEach = o.requireEach !== false;
    const usable = groups.filter(function (g) { return g.length > 0; });

    if (needEach && usable.length > length) {
      return {
        password: '',
        ok: false,
        error: '长度不足：需要每类字符至少各一个，共需 ' + usable.length + ' 位。'
      };
    }

    const chars = [];
    if (needEach) {
      usable.forEach(function (g) {
        chars.push(g[randomInt(g.length, o.rng)]);
      });
    }

    while (chars.length < length) {
      chars.push(pool[randomInt(pool.length, o.rng)]);
    }

    // Fisher-Yates 洗牌（用密码学随机源）
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1, o.rng);
      const t = chars[i]; chars[i] = chars[j]; chars[j] = t;
    }

    return { password: chars.join(''), ok: true };
  }

  /** 按排除规则过滤某一类字符 */
  function filterGroup(group, o) {
    let g = splitChars(group);
    if (o.excludeAmbiguous) {
      g = g.filter(function (c) { return AMBIGUOUS.indexOf(c) === -1; });
    }
    // 去重
    const seen = new Set();
    return g.filter(function (c) {
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    });
  }

  /**
   * 计算熵（bit）
   *
   * 字符池大小为 N、长度为 L 时，理论熵 = L * log2(N)。
   * 随机字符序（而非固定位置）时这个值是准确的。
   */
  function entropyBits(password, opts) {
    const pool = buildPool(opts);
    if (!pool.length || !password.length) return 0;
    return password.length * Math.log2(pool.length);
  }

  /**
   * 人类可读的强度描述
   * @returns {{bits:number, level:string, label:string, color:string, crackTime:string}}
   */
  function strength(password, opts) {
    const bits = entropyBits(password, opts);
    let level = 'weak', label = '弱', color = 'red';
    if (bits >= 128) { level = 'strong'; label = '强'; color = 'green'; }
    else if (bits >= 80) { level = 'good'; label = '中'; color = 'yellow'; }
    else if (bits >= 60) { level = 'fair'; label = '偏弱'; color = 'yellow'; }
    return {
      bits: Math.round(bits * 10) / 10,
      level: level,
      label: label,
      color: color,
      crackTime: crackTime(bits)
    };
  }

  /**
   * 估算破解时间
   *
   * 离线暴力破解，假设每秒 1e11 次尝试（对 SHA-256 类哈希而言是乐观估计）。
   */
  function crackTime(bits) {
    if (bits <= 0) return '瞬间';
    const attempts = Math.pow(2, bits);
    const perSecond = 1e11;
    const seconds = attempts / perSecond;
    if (seconds < 1) return '瞬间';
    if (seconds < 60) return Math.round(seconds) + ' 秒';
    if (seconds < 3600) return Math.round(seconds / 60) + ' 分钟';
    if (seconds < 86400) return Math.round(seconds / 3600) + ' 小时';
    if (seconds < 86400 * 30) return Math.round(seconds / 86400) + ' 天';
    if (seconds < 86400 * 365) return Math.round(seconds / (86400 * 30)) + ' 个月';
    const years = seconds / (86400 * 365);
    if (years < 1000) return Math.round(years) + ' 年';
    if (years < 1e6) return Math.round(years / 1000) + ' 千年';
    if (years < 1e9) return Math.round(years / 1e6) + ' 百万年';
    return '数十亿年以上';
  }

  /**
   * 检测密码里的弱模式（重复、连续、键盘序）
   * @returns {Array<{type:string, message:string}>}
   */
  function weakPatterns(password) {
    const issues = [];
    const p = String(password || '');
    if (!p) return issues;

    // 单字符重复
    if (/(.)\1{2,}/.test(p)) {
      issues.push({ type: 'repeat', message: '存在连续重复的相同字符' });
    }
    // 连续递增 / 递减序列
    if (/abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz/i.test(p)) {
      issues.push({ type: 'sequence', message: '包含字母顺序片段（如 abc）' });
    }
    if (/123|234|345|456|567|678|789|012|987|876|765|654|543|432|321/.test(p)) {
      issues.push({ type: 'sequence', message: '包含数字顺序片段（如 123）' });
    }
    // 常见弱口令
    const weak = ['password', 'passwd', 'admin', 'root', 'qwerty', 'letmein', 'welcome',
      'iloveyou', 'monkey', 'dragon', 'abc123', '123456', '12345678', '000000', '111111'];
    const lower = p.toLowerCase();
    weak.forEach(function (w) {
      if (lower.indexOf(w) !== -1) {
        issues.push({ type: 'common', message: '包含常见弱口令片段「' + w + '」' });
      }
    });
    // 键盘序
    if (/qwer|asdf|zxcv|1qaz|2wsx/.test(lower)) {
      issues.push({ type: 'keyboard', message: '包含键盘相邻按键序列' });
    }
    return issues;
  }

  global.PasswordCore = {
    CHARSETS: CHARSETS,
    AMBIGUOUS: AMBIGUOUS,
    generate: generate,
    buildPool: buildPool,
    entropyBits: entropyBits,
    strength: strength,
    crackTime: crackTime,
    weakPatterns: weakPatterns,
    randomInt: randomInt,
    hasCrypto: hasCrypto
  };
})(window);
