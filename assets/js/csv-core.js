/* ============================================
   CSV ⇄ JSON 转换核心 —— 纯 JS，无依赖
   ============================================ */
(function (global) {
  'use strict';

  /**
   * 解析 CSV / TSV 文本
   * 支持：带引号的字段、字段内的换行、"" 转义双引号、自定义分隔符
   *
   * @param {string} text
   * @param {{delimiter?:string}} opts
   * @returns {{ok:boolean, error:string, rows:Array<Array<string>>, delimiter:string}}
   */
  function parseCsv(text, opts) {
    opts = opts || {};
    const s = text == null ? '' : String(text);
    const delimiter = opts.delimiter || detectDelimiter(s);

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    let i = 0;
    let line = 1;
    let fieldStarted = false;

    if (s === '') {
      return { ok: true, error: '', rows: [], delimiter: delimiter };
    }

    while (i < s.length) {
      const ch = s.charAt(i);

      if (inQuotes) {
        if (ch === '"') {
          // "" 是转义的双引号
          if (s.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        if (ch === '\n') line++;
        field += ch;
        i++;
        continue;
      }

      if (ch === '"' && !fieldStarted) {
        inQuotes = true;
        fieldStarted = true;
        i++;
        continue;
      }

      if (ch === delimiter) {
        row.push(field);
        field = '';
        fieldStarted = false;
        i++;
        continue;
      }

      if (ch === '\r') {
        i++;
        continue;
      }

      if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        fieldStarted = false;
        line++;
        i++;
        continue;
      }

      field += ch;
      fieldStarted = true;
      i++;
    }

    if (inQuotes) {
      return { ok: false, error: '引号没有闭合（起始于第 ' + line + ' 行）', rows: [], delimiter: delimiter };
    }

    // 末尾还有内容
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    // 去掉完全空白的行
    const cleaned = rows.filter(function (r) {
      return r.some(function (v) { return String(v).trim() !== ''; });
    });

    return { ok: true, error: '', rows: cleaned, delimiter: delimiter };
  }

  /** 猜测分隔符（逗号 / 制表符 / 分号 / 竖线） */
  function detectDelimiter(text) {
    const s = String(text || '');
    const sample = s.split('\n').slice(0, 10).join('\n');
    const candidates = [',', '\t', ';', '|'];
    let best = ',';
    let bestCount = -1;
    for (let i = 0; i < candidates.length; i++) {
      const d = candidates[i];
      const count = countOutsideQuotes(sample, d);
      if (count > bestCount) {
        bestCount = count;
        best = d;
      }
    }
    return best;
  }

  /** 统计引号外出现的分隔符个数（跳过第一行表头） */
  function countOutsideQuotes(text, delimiter) {
    let count = 0;
    let inQuotes = false;
    let inHeader = true;
    let lineHasContent = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { i++; continue; }
          inQuotes = false;
        }
        continue;
      }
      if (ch === '"') { inQuotes = true; lineHasContent = true; continue; }
      if (ch === '\n') {
        if (inHeader) { inHeader = false; }
        else if (lineHasContent) { /* 继续下一行 */ }
        lineHasContent = false;
        continue;
      }
      if (ch === delimiter) {
        if (inHeader) continue;
        count++;
        lineHasContent = true;
        continue;
      }
      if (ch !== '\r' && ch !== ' ') lineHasContent = true;
    }
    return count;
  }

  /**
   * CSV 表格 → JSON
   *
   * @param {string} text
   * @param {object} opts
   *   - delimiter: 分隔符（默认自动探测）
   *   - header: 是否首行是表头（true / false）
   *   - typed: 是否把 '123' / 'true' 转成数字与布尔
   *   - indent: 缩进
   * @returns {{ok:boolean, error:string, json:string, rows:number, columns:string[]}}
   */
  function csvToJson(text, opts) {
    opts = opts || {};
    const parsed = parseCsv(text, opts);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, json: '', rows: 0, columns: [] };
    }

    const rows = parsed.rows;
    if (!rows.length) {
      return { ok: true, error: '', json: '[]', rows: 0, columns: [] };
    }

    let columns;
    let dataRows;
    if (opts.header === false) {
      // 无表头：生成 column1 / column2 …，并用第一行数据推断列数
      const width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      columns = [];
      for (let i = 0; i < width; i++) columns.push('column' + (i + 1));
      dataRows = rows;
    } else {
      columns = rows[0].map(function (c, i) {
        const name = String(c).trim();
        return name === '' ? 'column' + (i + 1) : name;
      });
      dataRows = rows.slice(1);
    }

    const width = columns.length;
    const result = dataRows.map(function (r) {
      const obj = {};
      for (let i = 0; i < width; i++) {
        const raw = i < r.length ? r[i] : '';
        obj[columns[i]] = opts.typed ? convertValue(raw) : raw;
      }
      return obj;
    });

    const indent = opts.indent == null ? 2 : opts.indent;
    let json;
    try {
      json = JSON.stringify(result, null, indent);
    } catch (e) {
      return { ok: false, error: '序列化失败：' + e.message, json: '', rows: 0, columns: columns };
    }

    return {
      ok: true,
      error: '',
      json: json,
      rows: result.length,
      columns: columns
    };
  }

  /** 把 CSV 字段值转成数字 / 布尔 / null */
  function convertValue(raw) {
    const s = String(raw).trim();
    if (s === '') return '';
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    // 纯数字（含负号、小数、科学计数法）
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) {
      const n = Number(s);
      if (!isNaN(n) && Number.isFinite(n)) return n;
    }
    return s;
  }

  /**
   * JSON → CSV
   *
   * @param {string} jsonText
   * @param {object} opts
   *   - delimiter: 分隔符（默认逗号）
   *   - columns: 列顺序（数组）。缺省时取所有对象的键并集
   *   - header: 是否输出表头行
   *   - newline: 行尾（'\n' 或 '\r\n'）
   * @returns {{ok:boolean, error:string, csv:string, rows:number, columns:string[]}}
   */
  function jsonToCsv(jsonText, opts) {
    opts = opts || {};
    const delimiter = opts.delimiter || ',';
    const newline = opts.newline || '\n';

    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (e) {
      return { ok: false, error: 'JSON 解析失败：' + e.message, csv: '', rows: 0, columns: [] };
    }

    if (!Array.isArray(data)) {
      return { ok: false, error: 'JSON 顶层必须是数组', csv: '', rows: 0, columns: [] };
    }

    // 支持 [{...}] 与 [1,2,3]
    const isObjectArray = data.length === 0 || data.every(function (x) {
      return x && typeof x === 'object' && !Array.isArray(x);
    });

    let columns;
    let rows;

    if (isObjectArray) {
      if (opts.columns && opts.columns.length) {
        columns = opts.columns.slice();
      } else {
        const seen = {};
        columns = [];
        data.forEach(function (obj) {
          Object.keys(obj).forEach(function (k) {
            if (!Object.prototype.hasOwnProperty.call(seen, k)) {
              seen[k] = true;
              columns.push(k);
            }
          });
        });
      }
      rows = data.map(function (obj) {
        return columns.map(function (col) {
          return obj[col] === undefined || obj[col] === null ? '' : stringifyValue(obj[col]);
        });
      });
    } else {
      columns = ['value'];
      rows = data.map(function (v) { return [stringifyValue(v)]; });
    }

    const lines = [];
    if (opts.header !== false) {
      lines.push(columns.map(function (c) { return escapeCsv(String(c), delimiter); }).join(delimiter));
    }
    rows.forEach(function (r) {
      lines.push(r.map(function (v) { return escapeCsv(v, delimiter); }).join(delimiter));
    });

    return {
      ok: true,
      error: '',
      csv: lines.join(newline),
      rows: rows.length,
      columns: columns
    };
  }

  /** 把值转成 CSV 字段的字符串形式 */
  function stringifyValue(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  /**
   * 给字段加引号（必要时）
   */
  function escapeCsv(value, delimiter) {
    const s = value == null ? '' : String(value);
    const needsQuote =
      s.indexOf('"') !== -1 ||
      s.indexOf('\n') !== -1 ||
      s.indexOf('\r') !== -1 ||
      s.indexOf(delimiter) !== -1;
    if (!needsQuote) return s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /**
   * 智能探测 JSON 是不是「对象数组」并给出可用的列
   */
  function inspectJson(jsonText) {
    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (e) {
      return { ok: false, error: e.message, kind: '', columns: [], count: 0 };
    }
    if (!Array.isArray(data)) {
      return {
        ok: true,
        error: '',
        kind: Array.isArray(data) ? 'array' : typeof data,
        columns: [],
        count: 0
      };
    }
    const isObjectArray = data.length === 0 || data.every(function (x) {
      return x && typeof x === 'object' && !Array.isArray(x);
    });
    const columns = [];
    if (isObjectArray) {
      const seen = {};
      data.forEach(function (obj) {
        Object.keys(obj).forEach(function (k) {
          if (!Object.prototype.hasOwnProperty.call(seen, k)) {
            seen[k] = true;
            columns.push(k);
          }
        });
      });
    }
    return {
      ok: true,
      error: '',
      kind: isObjectArray ? 'objects' : 'values',
      columns: columns,
      count: data.length
    };
  }

  global.CsvCore = {
    parseCsv: parseCsv,
    detectDelimiter: detectDelimiter,
    csvToJson: csvToJson,
    jsonToCsv: jsonToCsv,
    convertValue: convertValue,
    escapeCsv: escapeCsv,
    inspectJson: inspectJson
  };
})(window);
