#!/usr/bin/env node
/* ============================================
   MCP 工具速查 / 调试台
   ----------------------------------------------------------
   不启动 MCP 客户端也能直接试这些工具，方便排查问题。

     node mcp/inspect.js                       # 列出全部工具
     node mcp/inspect.js json_format '{"a":1}' # 调用某个工具
     node mcp/inspect.js datetime_convert '{"time":"1763960700","timezone":"Asia/Shanghai"}'
   ============================================ */
'use strict';

const { TOOLS } = require('./tools-registry');

const argv = process.argv.slice(2);

if (!argv.length) {
  console.log('共 ' + TOOLS.length + ' 个工具：\n');
  TOOLS.forEach(function (t) {
    const req = (t.schema.required || []).join(', ');
    console.log('  ' + t.name.padEnd(20) + t.title);
    console.log('  ' + ' '.repeat(20) + '参数：' + req);
  });
  console.log('\n用法：node mcp/inspect.js <工具名> [JSON 参数]');
  process.exit(0);
}

const name = argv[0];
const tool = TOOLS.find(function (t) { return t.name === name; });
if (!tool) {
  console.error('未知工具：' + name);
  console.error('可用工具：' + TOOLS.map(function (t) { return t.name; }).join(', '));
  process.exit(1);
}

let args = {};
if (argv[1]) {
  try {
    args = JSON.parse(argv[1]);
  } catch (e) {
    console.error('参数不是合法 JSON：' + e.message);
    process.exit(1);
  }
}

Promise.resolve(tool.handler(args))
  .then(function (result) {
    console.log(JSON.stringify(result, null, 2));
    if (result && result.ok === false) process.exit(1);
  })
  .catch(function (e) {
    console.error('执行失败：' + (e && e.message ? e.message : e));
    process.exit(1);
  });
