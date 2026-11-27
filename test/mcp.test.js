/* ============================================
   MCP 工具层测试
   ----------------------------------------------------------
   通过真实的 MCP 客户端 ↔ 服务器握手来验证每个工具，
   走的不是直接调函数，而是完整的 JSON-RPC 协议链路。
   ============================================ */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

const { createServer, TOOLS } = require('../mcp/server');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ->  ' + detail : ''));
}

/** 调用一个工具并解析返回的 JSON */
async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args || {} });
  const text = (res.content || []).map(function (c) { return c.text; }).join('');
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* 错误路径不一定是 JSON */ }
  return { res, text, data };
}

(async () => {
  console.log('\n=== MCP 工具层 ===');

  const server = createServer();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);

  /* ---------------- 工具清单 ---------------- */

  const listed = await client.listTools();
  check('tools/list 返回全部工具', listed.tools.length === TOOLS.length,
    listed.tools.length + ' 个');
  check('每个工具都有 inputSchema',
    listed.tools.every(function (t) { return t.inputSchema && t.inputSchema.type === 'object'; }));
  check('每个工具都有描述',
    listed.tools.every(function (t) { return t.description && t.description.length > 10; }));

  /* ---------------- JSON ---------------- */

  let r = await call(client, 'json_format', { text: '{"b":2,"a":[1,2]}' });
  check('json_format 格式化', r.data && r.data.ok && r.data.formatted.includes('\n  '),
    r.data && r.data.formatted);
  check('json_format 给出统计', r.data && r.data.stats && r.data.stats.keys === 2,
    JSON.stringify(r.data && r.data.stats));

  r = await call(client, 'json_format', { text: '{bad json}' });
  check('json_format 报错时标记 isError', r.res.isError === true, r.text.slice(0, 60));

  r = await call(client, 'json_query', { text: '{"user":{"roles":["a","b"]}}', path: '$.user.roles[1]' });
  check('json_query 取值', r.data && r.data.ok && r.data.value === 'b',
    JSON.stringify(r.data && r.data.value));

  /* ---------------- CSV ---------------- */

  r = await call(client, 'csv_to_json', { text: 'name,age\nAlice,30\nBob,25', typed: true });
  check('csv_to_json 转换', r.data && r.data.ok && r.data.rows === 2,
    r.data && r.data.json);
  check('csv_to_json 类型推断', r.data && r.data.json && r.data.json.includes('30'),
    r.data && r.data.json && r.data.json.replace(/\s+/g, ' '));

  r = await call(client, 'json_to_csv', { text: '[{"a":1,"b":"x,y"}]' });
  check('json_to_csv 转义含逗号字段', r.data && r.data.ok && r.data.csv.includes('"x,y"'),
    r.data && r.data.csv);

  /* ---------------- 编码 ---------------- */

  r = await call(client, 'encode', { text: 'hello', type: 'base64' });
  check('encode base64', r.data && r.data.output === 'aGVsbG8=', r.data && r.data.output);

  r = await call(client, 'decode', { text: 'aGVsbG8=', type: 'base64' });
  check('decode base64', r.data && r.data.output === 'hello', r.data && r.data.output);

  r = await call(client, 'detect_encoding', { text: 'aGVsbG8=' });
  check('detect_encoding 识别 Base64', r.data && r.data.type === 'base64',
    r.data && r.data.type);

  /* ---------------- URL ---------------- */

  r = await call(client, 'url_parse', { url: 'https://user:pw@example.com:8443/a/b?x=1&y=2#frag' });
  check('url_parse 拆解', r.data && r.data.ok && r.data.hostname === 'example.com'
    && r.data.port === '8443' && r.data.path === '/a/b' && r.data.hash === 'frag',
    r.data && r.data.hostname + '|' + r.data.port + '|' + r.data.path);
  check('url_parse 列出参数', r.data && r.data.params.length === 2,
    JSON.stringify(r.data && r.data.params));
  check('url_parse 不泄露密码', r.data && r.data.password === '***', r.data && r.data.password);

  r = await call(client, 'url_build', {
    scheme: 'https', hostname: 'example.com', path: '/x',
    params: [{ key: 'q', value: 'a b' }]
  });
  check('url_build 拼装并编码', r.data && r.data.url === 'https://example.com/x?q=a%20b',
    r.data && r.data.url);

  /* ---------------- 时间 ---------------- */

  r = await call(client, 'datetime_convert', {
    time: '2026-11-24 15:45:04', timezone: 'Asia/Shanghai'
  });
  check('datetime_convert 换算时区', r.data && r.data.ok && r.data.offset === '+08:00',
    r.data && r.data.offset);
  check('datetime_convert 给出多种格式', r.data && r.data.formats.length > 5,
    r.data && r.data.formats.length + ' 种');

  r = await call(client, 'datetime_convert', {
    time: '1763960700', timezone: 'UTC', pattern: 'yyyy-MM-dd HH:mm:ss'
  });
  check('datetime_convert 自定义格式串', r.data && r.data.custom === '2025-11-24 05:05:00',
    r.data && r.data.custom);

  r = await call(client, 'datetime_convert', {
    time: '1763960700', timezone: 'Asia/Shanghai', pattern: 'yyyy-MM-dd HH:mm:ss'
  });
  check('datetime_convert 按目标时区渲染', r.data && r.data.custom === '2025-11-24 13:05:00',
    r.data && r.data.custom);

  r = await call(client, 'datetime_diff', { a: '2026-01-01', b: '2026-01-03' });
  check('datetime_diff 计算差值', r.data && r.data.ok && r.data.days === 2,
    r.data && r.data.days);

  /* ---------------- 差异对比 ---------------- */

  r = await call(client, 'diff_text', { oldText: 'a\nb\nc', newText: 'a\nB\nc' });
  check('diff_text 统计', r.data && r.data.stats.added === 1 && r.data.stats.removed === 1,
    JSON.stringify(r.data && r.data.stats));
  check('diff_text 生成 Unified Diff', r.data && r.data.unified && r.data.unified.includes('@@'),
    r.data && r.data.unified && r.data.unified.split('\n')[0]);

  /* ---------------- 正则 ---------------- */

  r = await call(client, 'regex_test', { pattern: '(\\d+)', text: 'a1 b22 c333' });
  check('regex_test 匹配', r.data && r.data.ok && r.data.matches.length === 3,
    r.data && r.data.matches.length);
  check('regex_test 捕获组', r.data && r.data.matches[0].groups[1].value === '1',
    JSON.stringify(r.data && r.data.matches[0].groupValues));

  r = await call(client, 'regex_test', { pattern: '([', text: 'x' });
  check('regex_test 非法表达式报错', r.res.isError === true, r.text.slice(0, 60));

  r = await call(client, 'regex_explain', { pattern: '(\\d{2,4})+', flags: 'g' });
  check('regex_explain 拆解', r.data && r.data.ok && r.data.segments.length > 0,
    r.data && r.data.segments.length + ' 段');

  /* ---------------- 颜色 ---------------- */

  r = await call(client, 'color_convert', { color: '#ff8800' });
  check('color_convert 互转', r.data && r.data.formats.hsl === 'hsl(32, 100%, 50%)',
    r.data && r.data.formats.hsl);

  r = await call(client, 'color_contrast', { foreground: '#000000', background: '#ffffff' });
  check('color_contrast 对比度', r.data && r.data.ratio === 21 && r.data.aaa === true,
    r.data && r.data.ratio);

  r = await call(client, 'color_palette', { color: '#ff8800' });
  check('color_palette 生成配色', r.data && r.data.shades.length === 9
    && r.data.complementary.hex.length === 7,
    r.data && r.data.complementary.hex);

  /* ---------------- 密码 ---------------- */

  r = await call(client, 'password_generate', { length: 20, count: 3 });
  check('password_generate 批量生成', r.data && r.data.passwords.length === 3
    && r.data.passwords[0].password.length === 20,
    r.data && r.data.passwords.length + ' 个');
  check('password_generate 熵值合理', r.data && r.data.entropyBits > 60,
    r.data && r.data.entropyBits + ' bit');
  check('password_generate 每次结果不同',
    r.data && r.data.passwords[0].password !== r.data.passwords[1].password);

  r = await call(client, 'password_check', { password: 'password123' });
  check('password_check 检出弱口令', r.data && r.data.weakPatterns.length > 0,
    JSON.stringify(r.data && r.data.weakPatterns.map(function (w) { return w.type; })));

  /* ---------------- 未知工具 ---------------- */

  const bad = await client.callTool({ name: 'no_such_tool', arguments: {} });
  check('未知工具返回错误', bad.isError === true,
    (bad.content || []).map(function (c) { return c.text; }).join(''));

  await client.close();
  await server.close();

  /* ---------------- 图片工具（需要真实文件） ---------------- */

  console.log('\n=== 图片工具 ===');
  const sharp = require('sharp');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ot-mcp-test-'));
  const src = path.join(tmp, 'src.png');
  await sharp({
    create: { width: 120, height: 90, channels: 3, background: { r: 200, g: 100, b: 50 } }
  }).png().toFile(src);

  const server2 = createServer();
  const client2 = new Client({ name: 'test-client', version: '1.0.0' });
  const [ct2, st2] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server2.connect(st2),
    client2.connect(ct2)
  ]);

  r = await call(client2, 'image_convert', { path: src, format: 'webp' });
  check('image_convert 转换格式', r.data && r.data.ok && r.data.format === 'webp',
    r.data && r.data.outputPath);

  r = await call(client2, 'image_convert', { path: src, format: 'avif' });
  check('image_convert 转 AVIF', r.data && r.data.ok && r.data.format === 'avif'
    && fs.existsSync(r.data.outputPath),
    r.data && r.data.outputPath);

  r = await call(client2, 'image_compress', { path: src, format: 'webp', quality: 50 });
  check('image_compress 压缩', r.data && r.data.ok && r.data.compressedBytes > 0,
    r.data && r.data.compressedBytes + ' bytes');

  r = await call(client2, 'image_compress', { path: src, format: 'webp', targetBytes: 1000 });
  check('image_compress 命中目标体积',
    r.data && r.data.ok && r.data.compressedBytes <= 1000,
    r.data && r.data.compressedBytes + ' bytes');

  r = await call(client2, 'image_gif', { paths: [src, src], delay: 100 });
  check('image_gif 合成动画', r.data && r.data.ok && r.data.frameCount === 2
    && fs.existsSync(r.data.outputPath),
    r.data && r.data.outputPath);
  check('image_gif 输出合法 GIF 头',
    r.data && fs.existsSync(r.data.outputPath)
    && fs.readFileSync(r.data.outputPath).slice(0, 3).toString() === 'GIF',
    r.data && r.data.bytes + ' bytes');

  r = await call(client2, 'image_watermark', {
    path: src, x: 10, y: 10, width: 20, height: 20, method: 'blur'
  });
  check('image_watermark 去水印', r.data && r.data.ok && r.data.changedPixels > 0,
    r.data && r.data.changedPixels + ' px');

  r = await call(client2, 'image_watermark', {
    path: src, x: 10, y: 10, width: 20, height: 20, method: 'smart'
  });
  check('image_watermark 自动补片',
    r.data && r.data.ok && r.data.method === 'smart' && r.data.changedPixels > 0,
    r.data && r.data.detail);

  r = await call(client2, 'image_compress', { path: path.join(tmp, 'missing.png') });
  check('图片工具对不存在的文件报错', r.res.isError === true, r.text.slice(0, 60));

  await client2.close();
  await server2.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  /* ---------------- 汇总 ---------------- */

  const failed = results.filter(function (r) { return !r.ok; });
  console.log('\n=== 汇总 ===');
  console.log('  通过 ' + (results.length - failed.length) + ' / ' + results.length);
  if (failed.length) {
    failed.forEach(function (f) { console.log('  FAIL  ' + f.name + '  ->  ' + (f.detail || '')); });
    process.exit(1);
  }
})().catch(function (e) {
  console.error('测试异常终止：', e);
  process.exit(1);
});
