/* ============================================
   正则表达式测试台 —— 核心算法（纯 JS，无依赖）
   ============================================ */
(function (global) {
  'use strict';

  /**
   * 编译正则（同时支持字面量形式 /pattern/flags 与纯模式）
   *
   * @param {string} pattern
   * @param {string} flags
   * @returns {{ok:boolean, error:string, regex:RegExp|null, source:string, flags:string}}
   */
  function compile(pattern, flags) {
    const p = pattern == null ? '' : String(pattern);
    const f = flags == null ? '' : String(flags);

    // 支持直接粘贴 /abc/gi 这样的字面量
    let realPattern = p;
    let realFlags = f;
    const literal = p.match(/^\/(.*)\/([a-z]*)$/);
    if (literal && !f) {
      realPattern = literal[1];
      realFlags = literal[2];
    }

    if (realPattern === '') {
      return { ok: false, error: '请输入正则表达式', regex: null, source: '', flags: realFlags };
    }

    // 校验 flags 合法性
    const validFlags = 'dgimsuvy';
    for (let i = 0; i < realFlags.length; i++) {
      const c = realFlags.charAt(i);
      if (validFlags.indexOf(c) === -1) {
        return { ok: false, error: '无效的修饰符：/' + c + '/', regex: null, source: realPattern, flags: realFlags };
      }
      if (realFlags.indexOf(c) !== i) {
        return { ok: false, error: '修饰符重复：/' + c + '/', regex: null, source: realPattern, flags: realFlags };
      }
    }

    try {
      const regex = new RegExp(realPattern, realFlags);
      return { ok: true, error: '', regex: regex, source: realPattern, flags: realFlags };
    } catch (e) {
      return {
        ok: false,
        error: friendlyError(e, realPattern),
        regex: null,
        source: realPattern,
        flags: realFlags
      };
    }
  }

  /** 把英文报错信息转成中文提示 */
  function friendlyError(err, pattern) {
    const msg = err && err.message ? err.message : String(err);
    if (/Nothing to repeat/i.test(msg)) return '重复的量词：* 后面没有可重复的内容';
    if (/Unterminated group/i.test(msg)) return '分组没有闭合：缺少 )';
    if (/Unterminated character class/i.test(msg)) return '字符类没有闭合：缺少 ]';
    if (/Invalid escape/i.test(msg)) return '无效的转义序列';
    if (/Invalid group/i.test(msg)) return '无效的分组引用';
    if (/out of order/i.test(msg)) return '量词位置错误：例如 * 前面缺少可重复的内容';
    if (/Invalid quantifier/i.test(msg)) return '无效的量词';
    if (/Lone quantifier brackets/i.test(msg)) return '孤立的量词括号';
    if (/Nothing to repeat/.test(msg)) return '重复的量词';
    return msg.replace(/^Invalid regular expression:\s*/, '');
  }

  /**
   * 在文本中执行正则，返回所有匹配
   *
   * @param {string} text
   * @param {RegExp} regex
   * @param {{limit?:number}} opts
   * @returns {{
   *   matches: Array<{
   *     index:number, end:number, text:string,
   *     groups:Array<{name:string, value:string, index:number, named:boolean}>
   *   }>,
   *   count:number, truncated:boolean
   * }}
   */
  function execAll(text, regex, opts) {
    opts = opts || {};
    const limit = opts.limit || 1000;
    const s = text == null ? '' : String(text);
    const matches = [];
    let truncated = false;

    // 全局匹配需要独立的正则实例，避免 lastIndex 互相影响
    const re = new RegExp(regex.source, regex.flags.indexOf('g') === -1 ? regex.flags + 'g' : regex.flags);

    let m;
    let guard = 0;
    while ((m = re.exec(s)) !== null) {
      if (++guard > 100000) break;
      const groups = [];
      // 分组 0 是整体匹配
      groups.push({ name: '0', value: m[0], index: m.index, named: false, whole: true });
      for (let i = 1; i < m.length; i++) {
        groups.push({
          name: String(i),
          value: m[i] === undefined ? '' : m[i],
          index: m[i] === undefined ? -1 : m.index + m[0].indexOf(m[i]),
          named: false,
          undefined: m[i] === undefined
        });
      }
      // 具名分组
      if (m.groups) {
        for (const name in m.groups) {
          if (!Object.prototype.hasOwnProperty.call(m.groups, name)) continue;
          groups.push({
            name: name,
            value: m.groups[name] === undefined ? '' : m.groups[name],
            index: m.groups[name] === undefined ? -1 : m.index + m[0].indexOf(m.groups[name]),
            named: true,
            undefined: m.groups[name] === undefined
          });
        }
      }

      matches.push({
        index: m.index,
        end: m.index + m[0].length,
        text: m[0],
        groups: groups
      });

      if (matches.length >= limit) { truncated = true; break; }

      // 零长度匹配 —— 手动推进，避免死循环
      if (m[0].length === 0) {
        re.lastIndex++;
      }
    }

    return { matches: matches, count: matches.length, truncated: truncated };
  }

  /**
   * 逐 token 解析正则，生成说明
   * @param {string} pattern
   * @returns {Array<{token:string, type:string, desc:string}>}
   */
  function explain(pattern) {
    const p = pattern == null ? '' : String(pattern);
    const out = [];
    let i = 0;

    const push = function (token, type, desc) {
      out.push({ token: token, type: type, desc: desc });
    };

    while (i < p.length) {
      const ch = p.charAt(i);

      // 转义
      if (ch === '\\') {
        const next = p.charAt(i + 1);
        if (next === '') { push('\\', 'escape', '末尾的反斜杠（无效）'); i++; continue; }
        if ('dDwWsSbBnrtfv'.indexOf(next) !== -1) {
          push('\\' + next, 'escape', ESCAPE_DESC[next]);
          i += 2;
          continue;
        }
        if (next === 'u') {
          const hex = p.substr(i + 2, 4);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            push('\\u' + hex, 'escape', 'Unicode 码点 U+' + hex.toUpperCase());
            i += 6;
            continue;
          }
        }
        if (next === 'x') {
          const hex = p.substr(i + 2, 2);
          if (/^[0-9a-fA-F]{2}$/.test(hex)) {
            push('\\x' + hex, 'escape', '十六进制字符 0x' + hex.toUpperCase());
            i += 4;
            continue;
          }
        }
        if (/[0-9]/.test(next)) {
          push('\\' + next, 'escape', '反向引用：第 ' + next + ' 个捕获组');
          i += 2;
          continue;
        }
        if (next === 'k' && p.charAt(i + 2) === '<') {
          const close = p.indexOf('>', i + 3);
          if (close !== -1) {
            const name = p.slice(i + 3, close);
            push('\\k<' + name + '>', 'escape', '具名反向引用：' + name);
            i = close + 1;
            continue;
          }
        }
        push('\\' + next, 'escape', '转义字符 “' + next + '”（按字面匹配）');
        i += 2;
        continue;
      }

      // 字符类 [...]
      if (ch === '[') {
        let j = i + 1;
        let negated = false;
        if (p.charAt(j) === '^') { negated = true; j++; }
        let body = '';
        while (j < p.length) {
          const c = p.charAt(j);
          if (c === '\\') { body += c + p.charAt(j + 1); j += 2; continue; }
          if (c === ']') break;
          body += c;
          j++;
        }
        if (j >= p.length) {
          push('[', 'class', '字符类没有闭合');
          i++;
          continue;
        }
        const raw = p.slice(i, j + 1);
        push(raw, 'class', (negated ? '否定字符类：匹配不在 ' : '字符类：匹配 ') + describeClass(body) + ' 中的任意字符');
        i = j + 1;
        continue;
      }

      // 分组 (...)
      if (ch === '(') {
        // 判断是非捕获 / 具名 / 断言
        if (p.substr(i, 2) === '(?') {
          const kind = p.substr(i, 3);
          if (kind === '?:') {
            push('(?:', 'group', '非捕获分组：只分组不记录内容');
            i += 3;
            continue;
          }
          if (kind === '?=') {
            push('(?=', 'group', '正向前瞻：右边必须匹配，但不消耗字符');
            i += 3;
            continue;
          }
          if (kind === '?!') {
            push('(?!', 'group', '负向前瞻：右边必须不匹配');
            i += 3;
            continue;
          }
          if (kind === '?<=' || kind === '?<!') {
            push(kind, 'group', kind === '?<=' ? '正向后瞻：左边必须匹配' : '负向后瞻：左边必须不匹配');
            i += 3;
            continue;
          }
          if (kind === '?<' || kind === "?<'") {
            const close = p.indexOf('>', i + 3);
            if (close !== -1) {
              const name = p.slice(i + 3, close);
              push('(?<' + name + '>', 'group', '具名捕获组：' + name);
              i = close + 1;
              continue;
            }
          }
        }
        push('(', 'group', '捕获组：记录括号内的匹配内容');
        i++;
        continue;
      }

      if (ch === ')') {
        push(')', 'group', '分组结束');
        i++;
        continue;
      }

      // 量词
      if ('*+?'.indexOf(ch) !== -1) {
        const prev = out.length ? out[out.length - 1].token : '';
        if (ch === '*') push('*', 'quantifier', '重复 0 次或多次（贪婪）');
        else if (ch === '+') push('+', 'quantifier', '重复 1 次或多次（贪婪）');
        else push('?', 'quantifier', '重复 0 次或 1 次（可选）');
        i++;
        continue;
      }
      if (ch === '{') {
        const close = p.indexOf('}', i);
        if (close !== -1) {
          const body = p.slice(i + 1, close);
          if (/^\d+(,\d*)?$/.test(body)) {
            const parts = body.split(',');
            let desc;
            if (parts.length === 1) desc = '重复恰好 ' + parts[0] + ' 次';
            else if (parts[1] === '') desc = '重复至少 ' + parts[0] + ' 次';
            else desc = '重复 ' + parts[0] + ' 到 ' + parts[1] + ' 次';
            push(p.slice(i, close + 1), 'quantifier', desc);
            i = close + 1;
            continue;
          }
        }
        push('{', 'literal', '字面量 “{”');
        i++;
        continue;
      }

      if (ch === '|') {
        push('|', 'alternation', '或：分隔多个可选分支');
        i++;
        continue;
      }

      if (ch === '^') {
        push('^', 'anchor', '行首（或字符串开头，取决于 m 修饰符）');
        i++;
        continue;
      }
      if (ch === '$') {
        push('$', 'anchor', '行尾（或字符串结尾，取决于 m 修饰符）');
        i++;
        continue;
      }

      if (ch === '.') {
        push('.', 'wildcard', '任意字符（除了换行，s 修饰符下包含换行）');
        i++;
        continue;
      }

      // 普通字面量
      push(ch, 'literal', '字面量 “' + ch + '”');
      i++;
    }

    return out;
  }

  const ESCAPE_DESC = {
    d: '数字字符 [0-9]',
    D: '非数字字符（除 0-9 以外）',
    w: '单词字符 [A-Za-z0-9_]',
    W: '非单词字符',
    s: '空白字符（空格 / 制表 / 换行等）',
    S: '非空白字符',
    b: '单词边界（在 \\w 与非 \\w 之间）',
    B: '非单词边界',
    n: '换行符 LF',
    r: '回车符 CR',
    t: '制表符 TAB',
    f: '换页符 FF',
    v: '垂直制表符 VT',
    '0': '空字符 NUL'
  };

  /** 描述字符类内容 */
  function describeClass(body) {
    if (!body) return '（空）';
    return body.replace(/\\d/g, '数字')
      .replace(/\\w/g, '单词字符')
      .replace(/\\s/g, '空白')
      .replace(/\\./g, '')
      .replace(/\^/g, '排除 ');
  }

  /**
   * 生成能匹配某个正则的示例字符串（尽力而为）
   *
   * @param {string} pattern
   * @param {string} flags
   * @returns {{ok:boolean, error:string, sample:string}}
   */
  function generateSample(pattern, flags) {
    const c = compile(pattern, flags);
    if (!c.ok) return { ok: false, error: c.error, sample: '' };

    const p = c.source;
    let out = '';
    let i = 0;
    let guard = 0;

    while (i < p.length && guard++ < 2000) {
      const ch = p.charAt(i);

      if (ch === '\\') {
        const next = p.charAt(i + 1);
        i += 2;
        switch (next) {
          case 'd': out += '5'; break;
          case 'D': out += 'x'; break;
          case 'w': out += 'a'; break;
          case 'W': out += '-'; break;
          case 's': out += ' '; break;
          case 'S': out += 'x'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case '0': out += '\0'; break;
          case 'b': case 'B': break;
          case 'u': {
            const hex = p.substr(i, 4);
            i += 4;
            out += String.fromCharCode(parseInt(hex, 16));
            break;
          }
          case 'x': {
            const hex = p.substr(i, 2);
            i += 2;
            out += String.fromCharCode(parseInt(hex, 16));
            break;
          }
          default:
            if (/[0-9]/.test(next)) out += ''; // 反向引用无法生成，跳过
            else out += next;
        }
        continue;
      }

      if (ch === '[') {
        let j = i + 1;
        let negated = false;
        if (p.charAt(j) === '^') { negated = true; j++; }
        let picked = '';
        while (j < p.length) {
          const c2 = p.charAt(j);
          if (c2 === '\\') {
            const n2 = p.charAt(j + 1);
            j += 2;
            if (n2 === 'd') picked = '5';
            else if (n2 === 'w') picked = 'a';
            else if (n2 === 's') picked = ' ';
            else if (n2 === 'u') { picked = String.fromCharCode(parseInt(p.substr(j, 4), 16)); j += 4; }
            else if (n2 === 'x') { picked = String.fromCharCode(parseInt(p.substr(j, 2), 16)); j += 2; }
            else picked = n2;
            continue;
          }
          if (c2 === ']') break;
          if (!picked) picked = c2;
          j++;
        }
        i = j + 1;
        out += negated ? 'x' : (picked || 'a');
        continue;
      }

      if (ch === '(') {
        if (p.substr(i, 3) === '(?:' || p.substr(i, 3) === '(?=' || p.substr(i, 3) === '(?!') i += 3;
        else if (p.substr(i, 4) === '(?<=' || p.substr(i, 4) === '(?<!') i += 4;
        else if (p.substr(i, 3) === '(?<' || p.substr(i, 2) === '(?') {
          const close = p.indexOf('>', i + 3);
          i = close !== -1 ? close + 1 : i + 1;
        } else i += 1;
        continue;
      }

      if (ch === ')') { i++; continue; }
      if (ch === '|') { i++; continue; }
      if (ch === '^' || ch === '$') { i++; continue; }
      if (ch === '.') { out += 'x'; i++; continue; }

      // 量词修饰的是前一个字符 —— 整个 {m,n} 都要跳过，
      // 若带明确次数 {m} 则把上一个字符重复 m 次
      if (ch === '{') {
        const close = p.indexOf('}', i);
        const quant = close !== -1 ? p.slice(i, close + 1) : '';
        const m = /^\{(\d+)\}$/.exec(quant);
        if (m) {
          const times = Math.min(parseInt(m[1], 10), 64);
          const last = out.length ? out.charAt(out.length - 1) : '';
          if (last) {
            out = out.slice(0, out.length - 1) + new Array(times + 1).join(last);
          }
          i = close + 1;
          continue;
        }
        if (close !== -1 && /^\{\d+(,\d*)?\}$/.test(quant)) {
          i = close + 1;
          continue;
        }
        out += ch;
        i++;
        continue;
      }

      // 星号 / 加号 / 问号量词：保持前一个字符重复一次即可
      if ('*+?'.indexOf(ch) !== -1) { i++; continue; }

      out += ch;
      i++;
    }

    return { ok: true, error: '', sample: out };
  }

  /**
   * 常用正则速查表
   */
  const PRESETS = [
    { name: '邮箱', pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.]{2,}', flags: 'g' },
    { name: 'URL', pattern: 'https?:\\/\\/[^\\s]+', flags: 'g' },
    { name: '手机号（中国大陆）', pattern: '1[3-9]\\d{9}', flags: 'g' },
    { name: 'IPv4 地址', pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b', flags: 'g' },
    { name: '日期（YYYY-MM-DD）', pattern: '\\d{4}-\\d{2}-\\d{2}', flags: 'g' },
    { name: '十六进制颜色', pattern: '#(?:[0-9a-fA-F]{3}){1,2}\\b', flags: 'g' },
    { name: '空白字符', pattern: '\\s+', flags: 'g' },
    { name: '重复单词', pattern: '\\b(\\w+)\\s+\\1\\b', flags: 'gi' },
    { name: '中文字符', pattern: '[\\u4e00-\\u9fa5]+', flags: 'g' },
    { name: 'HTML 标签', pattern: '<\\/?[a-z][\\w-]*(?:\\s[^>]*)?>', flags: 'gi' }
  ];

  global.RegexCore = {
    compile: compile,
    execAll: execAll,
    explain: explain,
    generateSample: generateSample,
    friendlyError: friendlyError,
    PRESETS: PRESETS
  };
})(window);
