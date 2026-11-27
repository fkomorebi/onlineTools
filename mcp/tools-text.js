/* ============================================
   MCP 工具层 —— 文本与数据类
   ----------------------------------------------------------
   每个工具都直接复用网站 `assets/js/*-core.js` 里的算法，
   不重复实现逻辑 —— 网站与 AI 工具共用同一套核心代码。
   ============================================ */
'use strict';

const { core } = require('./core-loader');

/** 把核心模块的返回统一成 MCP 的 { ok, error, ... } 结构 */
function fail(error) {
  return { ok: false, error: String(error == null ? '未知错误' : error) };
}

/* ---------------------------------------------------------- */
/*  JSON 格式化 / 校验 / 取值                                  */
/* ---------------------------------------------------------- */

function jsonFormat(input) {
  const JSONTool = core('JSONTool');
  const raw = typeof input.text === 'string' ? input.text : '';
  const parsed = JSONTool.parse(raw);
  if (!parsed.ok) {
    return fail(parsed.error || 'JSON 解析失败');
  }
  const indent = input.indent === undefined ? 2 : input.indent;
  const formatted = JSONTool.stringify(parsed.value, indent);
  return {
    ok: true,
    formatted: formatted,
    minified: JSONTool.minify(raw),
    stats: JSONTool.stats(parsed.value, raw),
    typeBreakdown: JSONTool.typeBreakdown(parsed.value),
    error: null
  };
}

function jsonQuery(input) {
  const JSONTool = core('JSONTool');
  const parsed = JSONTool.parse(input.text);
  if (!parsed.ok) return fail(parsed.error || 'JSON 解析失败');
  const path = String(input.path || '').trim();
  if (!path) return fail('请提供 path，例如 $.a.b[0].c');
  const value = JSONTool.getPath(parsed.value, path);
  if (value === undefined) return fail('路径不存在：' + path);
  return {
    ok: true,
    path: path,
    value: value,
    valueType: Array.isArray(value) ? 'array' : (value === null ? 'null' : typeof value),
    json: JSON.stringify(value, null, 2)
  };
}

/* ---------------------------------------------------------- */
/*  CSV ⇄ JSON                                                */
/* ---------------------------------------------------------- */

function csvToJson(input) {
  const CsvCore = core('CsvCore');
  const r = CsvCore.csvToJson(input.text, {
    delimiter: input.delimiter,
    header: input.header,
    typed: input.typed,
    indent: input.indent
  });
  if (!r.ok) return fail(r.error);
  return { ok: true, json: r.json, rows: r.rows, columns: r.columns };
}

function jsonToCsv(input) {
  const CsvCore = core('CsvCore');
  const r = CsvCore.jsonToCsv(input.text, {
    delimiter: input.delimiter,
    columns: input.columns,
    header: input.header,
    newline: input.newline
  });
  if (!r.ok) return fail(r.error);
  return { ok: true, csv: r.csv, rows: r.rows, columns: r.columns };
}

/* ---------------------------------------------------------- */
/*  编码 / 解码                                               */
/* ---------------------------------------------------------- */

function encode(input) {
  const EncodeCore = core('EncodeCore');
  const r = EncodeCore.encode(input.text, input.type);
  if (!r.ok) return fail(r.error);
  return { ok: true, type: input.type, output: r.output };
}

function decode(input) {
  const EncodeCore = core('EncodeCore');
  const r = EncodeCore.decode(input.text, input.type);
  if (!r.ok) return fail(r.error);
  return { ok: true, type: input.type, output: r.output, binary: !!r.binary };
}

function detectEncoding(input) {
  const EncodeCore = core('EncodeCore');
  const r = EncodeCore.detect(input.text);
  return { ok: true, type: r.type, label: r.label, confidence: r.confidence, decoded: r.decoded };
}

/* ---------------------------------------------------------- */
/*  URL 解析 / 拼装                                           */
/* ---------------------------------------------------------- */

function urlParse(input) {
  const UrlCore = core('UrlCore');
  const r = UrlCore.parseUrl(input.url);
  if (!r.ok) return fail(r.error);
  return {
    ok: true,
    scheme: r.scheme,
    username: r.username,
    password: r.password ? '***' : '',
    host: r.host,
    hostname: r.hostname,
    port: r.port,
    path: r.path,
    query: r.query,
    hash: r.hash,
    origin: r.origin,
    params: r.params
  };
}

function urlBuild(input) {
  const UrlCore = core('UrlCore');
  const parts = {
    scheme: input.scheme || 'https',
    hostname: input.hostname || '',
    port: input.port || '',
    path: input.path || '',
    hash: input.hash || '',
    params: input.params || []
  };
  const url = UrlCore.buildUrl(parts, { encode: input.encode !== false });
  return { ok: true, url: url };
}

/* ---------------------------------------------------------- */
/*  时间格式化                                                */
/* ---------------------------------------------------------- */

function datetimeConvert(input) {
  const DateTimeCore = core('DateTimeCore');
  const parsed = DateTimeCore.parseInput(input.time);
  if (!parsed.ok) return fail(parsed.error);

  const zone = input.timezone || 'UTC';
  const formats = DateTimeCore.commonFormats(parsed.date, zone);

  const out = {
    ok: true,
    input: input.time,
    detectedKind: parsed.kind,
    timeZone: zone,
    unixSeconds: Math.floor(parsed.date.getTime() / 1000),
    unixMillis: parsed.date.getTime(),
    isoUtc: parsed.date.toISOString(),
    offset: DateTimeCore.formatOffset(DateTimeCore.tzOffsetMinutes(parsed.date, zone)),
    isDST: DateTimeCore.isDST(parsed.date, zone),
    formats: formats
  };

  if (input.pattern) {
    out.custom = DateTimeCore.format(parsed.date, input.pattern, zone);
  }
  if (Array.isArray(input.zones) && input.zones.length) {
    out.timezoneTable = DateTimeCore.timezoneTable(parsed.date, input.zones);
  }
  return out;
}

function datetimeDiff(input) {
  const DateTimeCore = core('DateTimeCore');
  const a = DateTimeCore.parseInput(input.a);
  const b = DateTimeCore.parseInput(input.b);
  if (!a.ok) return fail('第一个时间无法解析：' + a.error);
  if (!b.ok) return fail('第二个时间无法解析：' + b.error);
  const d = DateTimeCore.diff(a.date, b.date);
  return {
    ok: true,
    a: a.date.toISOString(),
    b: b.date.toISOString(),
    ...d
  };
}

/* ---------------------------------------------------------- */
/*  文本差异对比                                              */
/* ---------------------------------------------------------- */

function diffText(input) {
  const DiffCore = core('DiffCore');
  const rows = DiffCore.diffLines(input.oldText, input.newText, {
    ignoreWhitespace: !!input.ignoreWhitespace
  });
  const stats = DiffCore.stats(rows);
  const out = {
    ok: true,
    stats: stats,
    rows: rows.map(function (r) {
      return {
        type: r.type,
        oldLine: r.oldLine,
        newLine: r.newLine,
        text: r.text
      };
    })
  };
  if (input.unified !== false) {
    out.unified = DiffCore.unifiedDiff(input.oldText, input.newText, input.context);
  }
  return out;
}

/* ---------------------------------------------------------- */
/*  正则测试                                                  */
/* ---------------------------------------------------------- */

function regexTest(input) {
  const RegexCore = core('RegexCore');
  const compiled = RegexCore.compile(input.pattern, input.flags);
  if (!compiled.ok) {
    return fail(compiled.error || '正则表达式无效');
  }
  const matches = RegexCore.execAll(input.text, compiled.regex, { limit: input.limit || 100 });
  return {
    ok: true,
    source: compiled.source,
    flags: compiled.flags,
    matchCount: matches.count !== undefined ? matches.count : matches.matches.length,
    truncated: !!matches.truncated,
    matches: matches.matches.map(function (m) {
      // groups 是 {name,value,index,named} 对象的数组；
      // 同时给出一份「组名 -> 值」的扁平映射，方便 AI 直接用。
      const groups = m.groups || [];
      const map = {};
      groups.forEach(function (g) {
        if (!g.whole) map[g.name] = g.value;
      });
      return {
        index: m.index,
        end: m.end,
        text: m.text,
        groups: groups.map(function (g) {
          return { name: g.name, value: g.value, index: g.index, named: !!g.named };
        }),
        groupValues: map
      };
    }),
    explanation: RegexCore.explain(compiled.source)
  };
}

function regexExplain(input) {
  const RegexCore = core('RegexCore');
  const compiled = RegexCore.compile(input.pattern, input.flags);
  if (!compiled.ok) return fail(compiled.error || '正则表达式无效');
  return {
    ok: true,
    source: compiled.source,
    flags: compiled.flags,
    segments: RegexCore.explain(compiled.source)
  };
}

/* ---------------------------------------------------------- */
/*  颜色工具                                                  */
/* ---------------------------------------------------------- */

function colorConvert(input) {
  const ColorCore = core('ColorCore');
  const c = ColorCore.parse(input.color);
  if (!c) return fail('无法识别的颜色：' + input.color);
  return { ok: true, input: input.color, formats: ColorCore.toFormats(c) };
}

function colorContrast(input) {
  const ColorCore = core('ColorCore');
  const fg = ColorCore.parse(input.foreground);
  const bg = ColorCore.parse(input.background);
  if (!fg) return fail('无法识别的前景色：' + input.foreground);
  if (!bg) return fail('无法识别的背景色：' + input.background);
  const result = ColorCore.wcag(fg, bg, input.textSize || 'normal');
  return {
    ok: true,
    foreground: input.foreground,
    background: input.background,
    ...result
  };
}

function colorPalette(input) {
  const ColorCore = core('ColorCore');
  const c = ColorCore.parse(input.color);
  if (!c) return fail('无法识别的颜色：' + input.color);
  return {
    ok: true,
    base: input.color,
    shades: ColorCore.shades(c, input.steps || 9),
    analogous: ColorCore.analogous(c, input.spread || 30),
    complementary: ColorCore.complementary(c),
    triadic: ColorCore.triadic(c)
  };
}

/* ---------------------------------------------------------- */
/*  密码生成                                                  */
/* ---------------------------------------------------------- */

function passwordGenerate(input) {
  const PasswordCore = core('PasswordCore');
  const count = Math.max(1, Math.min(50, input.count || 1));
  const opts = {
    length: input.length || 16,
    lower: input.lower,
    upper: input.upper,
    digits: input.digits,
    symbols: input.symbols,
    excludeAmbiguous: input.excludeAmbiguous,
    custom: input.custom,
    requireEach: input.requireEach
  };

  const results = [];
  for (let i = 0; i < count; i++) {
    const r = PasswordCore.generate(opts);
    if (!r.ok) return fail(r.error);
    const strength = PasswordCore.strength(r.password, opts);
    results.push({
      password: r.password,
      bits: strength.bits,
      level: strength.level,
      label: strength.label,
      crackTime: strength.crackTime,
      weakPatterns: PasswordCore.weakPatterns(r.password)
    });
  }
  return {
    ok: true,
    count: count,
    entropyBits: results[0] ? results[0].bits : 0,
    passwords: results
  };
}

function passwordCheck(input) {
  const PasswordCore = core('PasswordCore');
  const strength = PasswordCore.strength(input.password, input);
  return {
    ok: true,
    bits: strength.bits,
    level: strength.level,
    label: strength.label,
    crackTime: strength.crackTime,
    weakPatterns: PasswordCore.weakPatterns(input.password)
  };
}

module.exports = {
  jsonFormat,
  jsonQuery,
  csvToJson,
  jsonToCsv,
  encode,
  decode,
  detectEncoding,
  urlParse,
  urlBuild,
  datetimeConvert,
  datetimeDiff,
  diffText,
  regexTest,
  regexExplain,
  colorConvert,
  colorContrast,
  colorPalette,
  passwordGenerate,
  passwordCheck
};
