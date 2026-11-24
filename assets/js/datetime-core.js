/* ============================================
   时间格式化核心 —— 解析、时区换算与格式化
   纯函数，无 DOM 依赖，便于测试
   ============================================ */
(function (global) {
  'use strict';

  const WEEKDAY_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const WEEKDAY_SHORT_CN = ['日', '一', '二', '三', '四', '五', '六'];

  /* ---------------- 偏移量表示 ---------------- */

  /**
   * 把 ±HH:mm / ±HHmm / ±HH 形式的偏移量转成分钟数
   * @returns {number|null} 分钟数，无效返回 null
   */
  function parseOffset(str) {
    if (str == null) return null;
    const m = String(str).trim().match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    const h = parseInt(m[2], 10);
    const min = m[3] ? parseInt(m[3], 10) : 0;
    if (min > 59) return null;
    return sign * (h * 60 + min);
  }

  /** 偏移分钟数 → "+08:00" */
  function formatOffset(minutes) {
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return sign + pad2(h) + ':' + pad2(m);
  }

  /** 偏移分钟数 → "+0800" */
  function formatOffsetCompact(minutes) {
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return sign + pad2(Math.floor(abs / 60)) + pad2(abs % 60);
  }

  /* ---------------- 月份名称 ---------------- */

  const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_FULL_EN = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_FULL_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /* ---------------- 日期解析 ---------------- */

  /**
   * 宽松解析用户输入的时间文本
   * 支持：ISO 字符串、Unix 秒 / 毫秒、常见日期格式（YYYY-MM-DD HH:mm:ss 等）
   * @returns {{ok:boolean, date?:Date, error?:string, kind?:string}}
   */
  function parseInput(raw) {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) {
      return { ok: false, error: '请输入要转换的时间' };
    }

    // 纯数字：Unix 时间戳（秒 / 毫秒）
    if (/^[+-]?\d+(\.\d+)?$/.test(text)) {
      const n = Number(text);
      if (!isFinite(n)) return { ok: false, error: '时间戳不是一个有效数字' };
      // 依据位数判断是秒还是毫秒
      const abs = Math.abs(n);
      let date, kind;
      if (abs < 1e11) {
        date = new Date(n * 1000);
        kind = 'Unix 时间戳（秒）';
      } else if (abs < 1e14) {
        date = new Date(n);
        kind = 'Unix 时间戳（毫秒）';
      } else {
        // 过大：按微秒 / 纳秒处理
        date = new Date(n / 1000);
        kind = 'Unix 时间戳（微秒）';
      }
      if (isNaN(date.getTime())) return { ok: false, error: '时间戳超出可表示范围' };
      return { ok: true, date: date, kind: kind };
    }

    // 带偏移或 Z 结尾的 ISO 字符串
    const isoWithZone = text.match(
      /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|z|[+-]\d{2}:?\d{2}|[+-]\d{2})$/);
    if (isoWithZone) {
      const date = new Date(text.replace(' ', 'T'));
      if (isNaN(date.getTime())) return { ok: false, error: '无法解析该时间：' + text };
      return { ok: true, date: date, kind: '带时区的 ISO 时间' };
    }

    // 本地日期时间（无时区）
    const local = text.match(
      /^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?(?:[T ]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
    if (local) {
      const y = +local[1], mo = +local[2], d = +local[3];
      const h = local[4] ? +local[4] : 0;
      const mi = local[5] ? +local[5] : 0;
      const s = local[6] ? +local[6] : 0;
      if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) {
        return { ok: false, error: '日期或时间的数值超出范围' };
      }
      const date = new Date(y, mo - 1, d, h, mi, s, 0);
      if (isNaN(date.getTime())) return { ok: false, error: '无法解析该时间：' + text };
      return { ok: true, date: date, kind: '本地日期时间' };
    }

    // 兜底：交给浏览器解析
    const fallback = new Date(text);
    if (!isNaN(fallback.getTime())) {
      return { ok: true, date: fallback, kind: '自动识别' };
    }
    return { ok: false, error: '无法识别的时间格式，请尝试 2026-11-24 15:45 或 1763960700' };
  }

  /* ---------------- 时区 ---------------- */

  /** 获取某个 UTC 瞬间在指定 IANA 时区下的偏移量（分钟） */
  function tzOffsetMinutes(date, timeZone) {
    if (!timeZone) return -date.getTimezoneOffset();
    try {
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      const parts = dtf.formatToParts(date);
      const map = {};
      parts.forEach(function (p) { map[p.type] = p.value; });
      let hour = parseInt(map.hour, 10);
      if (hour === 24) hour = 0; // 部分实现会返回 24
      const asUtc = Date.UTC(
        parseInt(map.year, 10),
        parseInt(map.month, 10) - 1,
        parseInt(map.day, 10),
        hour,
        parseInt(map.minute, 10),
        parseInt(map.second, 10)
      );
      // asUtc 对应"墙上时间被当作 UTC"，与真实 UTC 的差即为偏移
      return Math.round((asUtc - date.getTime() - date.getMilliseconds()) / 60000);
    } catch (e) {
      return -date.getTimezoneOffset();
    }
  }

  /**
   * 列出可用的 IANA 时区（若浏览器支持 Intl.supportedValuesOf）
   */
  function listTimeZones() {
    if (global.Intl && typeof global.Intl.supportedValuesOf === 'function') {
      try {
        return global.Intl.supportedValuesOf('timeZone');
      } catch (e) { /* 忽略 */ }
    }
    return [];
  }

  /** 猜测用户当前所在时区 */
  function guessTimeZone() {
    try {
      return global.Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (e) {
      return '';
    }
  }

  /** 某个时区当前是否处于夏令时 */
  function isDST(date, timeZone) {
    if (!timeZone) {
      // 本地时区：用标准偏移与夏令时偏移比较
      const year = date.getFullYear();
      const jan = new Date(year, 0, 15);
      const jul = new Date(year, 6, 15);
      const janOff = tzOffsetMinutes(jan, null);
      const julOff = tzOffsetMinutes(jul, null);
      if (janOff === julOff) return false;
      const std = Math.min(janOff, julOff);
      return tzOffsetMinutes(date, null) !== std;
    }
    // 用标准偏移与夏令时偏移比较
    const year = date.getUTCFullYear();
    const jan = new Date(Date.UTC(year, 0, 15));
    const jul = new Date(Date.UTC(year, 6, 15));
    const janOff = tzOffsetMinutes(jan, timeZone);
    const julOff = tzOffsetMinutes(jul, timeZone);
    if (janOff === julOff) return false; // 无夏令时
    const std = Math.min(janOff, julOff);
    const dst = Math.max(janOff, julOff);
    const cur = tzOffsetMinutes(date, timeZone);
    return cur === dst && cur !== std;
  }

  /* ---------------- 格式化 ---------------- */

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function pad3(n) { return n < 10 ? '00' + n : n < 100 ? '0' + n : String(n); }

  /**
   * 把一个 UTC 瞬间换算成目标时区的"墙上时间"字段
   * @returns {{year, month, day, hour, minute, second, ms, weekday, offset}}
   */
  function zonedParts(date, timeZone) {
    const offset = tzOffsetMinutes(date, timeZone);
    const shifted = new Date(date.getTime() + offset * 60000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
      ms: shifted.getUTCMilliseconds(),
      weekday: shifted.getUTCDay(),
      offset: offset
    };
  }

  /** 按给定格式串格式化时间 */
  function format(date, pattern, timeZone) {
    const p = zonedParts(date, timeZone);
    const offset = p.offset;
    const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
    const map = {
      'yyyy': String(p.year),
      'yy': pad2(p.year % 100),
      'MMMM': MONTH_FULL_EN[p.month - 1],
      'MMM': MONTH_EN[p.month - 1],
      'MM': pad2(p.month),
      'M': String(p.month),
      'dd': pad2(p.day),
      'd': String(p.day),
      'EEEE': DAY_FULL_EN[p.weekday],
      'EEE': DAY_EN[p.weekday],
      'HH': pad2(p.hour),
      'H': String(p.hour),
      'hh': pad2(h12),
      'h': String(h12),
      'mm': pad2(p.minute),
      'm': String(p.minute),
      'ss': pad2(p.second),
      's': String(p.second),
      'SSS': pad3(p.ms),
      'E': WEEKDAY_CN[p.weekday],
      'eee': WEEKDAY_SHORT_CN[p.weekday],
      'a': p.hour < 12 ? '上午' : '下午',
      'Z': formatOffset(offset),
      'ZZ': formatOffsetCompact(offset),
      'X': String(Math.floor(date.getTime() / 1000)),
      'x': String(date.getTime())
    };
    // 长的 token 必须排在前面，否则 "MM" 会先于 "MMMM" 被匹配
    const TOKEN = /MMMM|MMM|EEEE|EEE|yyyy|yy|MM|M|dd|d|HH|H|hh|h|mm|m|ss|s|SSS|eee|E|a|ZZ|Z|X|x/g;
    // 先把单引号包裹的文本标记成不可替换的占位符
    const literals = [];
    const masked = String(pattern).replace(/'([^']*)'/g, function (_, inner) {
      literals.push(inner);
      return '\u0001' + (literals.length - 1) + '\u0001';
    });
    const out = masked.replace(TOKEN, function (tok) {
      return map[tok] !== undefined ? map[tok] : tok;
    });
    // 把占位符还原成原文
    return out.replace(/\u0001(\d+)\u0001/g, function (_, i) { return literals[+i]; });
  }

  /**
   * 生成一组常用格式
   * @returns {Array<{label:string, value:string, note?:string}>}
   */
  function commonFormats(date, timeZone) {
    const p = zonedParts(date, timeZone);
    const utc = new Date(date.getTime());
    const u = zonedParts(utc, 'UTC');

    return [
      {
        label: 'ISO 8601（本地时区）',
        value: format(date, 'yyyy-MM-dd\'T\'HH:mm:ss' + formatOffset(p.offset), timeZone),
        note: '带本地偏移量的标准格式'
      },
      {
        label: 'ISO 8601（UTC）',
        value: u.year + '-' + pad2(u.month) + '-' + pad2(u.day) + 'T' +
          pad2(u.hour) + ':' + pad2(u.minute) + ':' + pad2(u.second) + 'Z',
        note: '以 Z 结尾'
      },
      {
        label: 'RFC 7231 / HTTP',
        value: format(date, 'EEE, dd MMM yyyy HH:mm:ss', 'UTC') + ' GMT',
        note: 'HTTP 日期头格式'
      },
      {
        label: 'RFC 2822',
        value: format(date, 'EEE, dd MMM yyyy HH:mm:ss Z', timeZone),
        note: '邮件标准日期格式'
      },
      {
        label: '可读日期（中文）',
        value: p.year + ' 年 ' + p.month + ' 月 ' + p.day + ' 日 ' +
          WEEKDAY_CN[p.weekday] + ' ' + pad2(p.hour) + ':' + pad2(p.minute) + ':' + pad2(p.second),
        note: '中文习惯写法'
      },
      {
        label: '紧凑格式',
        value: String(p.year) + pad2(p.month) + pad2(p.day) + '-' + pad2(p.hour) + pad2(p.minute) + pad2(p.second),
        note: '适合做文件名'
      },
      {
        label: '日期（yyyy-MM-dd）',
        value: format(date, 'yyyy-MM-dd', timeZone)
      },
      {
        label: '时间（HH:mm:ss）',
        value: format(date, 'HH:mm:ss', timeZone)
      },
      {
        label: '日期时间（yyyy-MM-dd HH:mm:ss）',
        value: format(date, 'yyyy-MM-dd HH:mm:ss', timeZone)
      },
      {
        label: '12 小时制（hh:mm:ss a）',
        value: format(date, 'hh:mm:ss a', timeZone)
      },
      {
        label: 'Unix 时间戳（秒）',
        value: String(Math.floor(date.getTime() / 1000)),
        note: '10 位整数'
      },
      {
        label: 'Unix 时间戳（毫秒）',
        value: String(date.getTime()),
        note: '13 位整数'
      }
    ];
  }

  /**
   * 时区对照表：当前时间在多个时区的显示
   */
  function timezoneTable(date, zones) {
    return zones.map(function (z) {
      const off = tzOffsetMinutes(date, z);
      const p = zonedParts(date, z);
      return {
        zone: z,
        offset: formatOffset(off),
        offsetMinutes: off,
        text: p.year + '-' + pad2(p.month) + '-' + pad2(p.day) + ' ' +
          pad2(p.hour) + ':' + pad2(p.minute) + ':' + pad2(p.second),
        dst: isDST(date, z)
      };
    });
  }

  /**
   * 计算两个时间之间的差值
   * @param {Date} a
   * @param {Date} b
   */
  function diff(a, b) {
    const ms = Math.abs(a.getTime() - b.getTime());
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const years = Math.floor(days / 365.2425);
    return {
      ms: ms,
      seconds: seconds,
      minutes: minutes,
      hours: hours,
      days: days,
      years: years,
      // 余下的部分（不足一天 / 一小时 / 一分钟）
      restHours: hours % 24,
      restMinutes: minutes % 60,
      restSeconds: seconds % 60,
      restDays: days - years * 365,
      text: humanizeDiff(ms)
    };
  }

  function humanizeDiff(ms) {
    if (ms < 1000) return ms + ' 毫秒';
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + ' 秒';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' 分 ' + (s % 60) + ' 秒';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时 ' + (m % 60) + ' 分';
    const d = Math.floor(h / 24);
    if (d < 365) return d + ' 天 ' + (h % 24) + ' 小时';
    const y = Math.floor(d / 365);
    return y + ' 年 ' + (d - y * 365) + ' 天';
  }

  global.DateTimeCore = {
    parseInput: parseInput,
    parseOffset: parseOffset,
    formatOffset: formatOffset,
    formatOffsetCompact: formatOffsetCompact,
    tzOffsetMinutes: tzOffsetMinutes,
    zonedParts: zonedParts,
    format: format,
    commonFormats: commonFormats,
    timezoneTable: timezoneTable,
    listTimeZones: listTimeZones,
    guessTimeZone: guessTimeZone,
    isDST: isDST,
    diff: diff,
    humanizeDiff: humanizeDiff,
    WEEKDAY_CN: WEEKDAY_CN
  };
})(typeof window !== 'undefined' ? window : globalThis);
