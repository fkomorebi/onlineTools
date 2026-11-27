#!/usr/bin/env node
/* ============================================
   在线工具箱 —— MCP 服务器
   ----------------------------------------------------------
   把网站 `assets/js/*-core.js` 里的算法暴露给 AI 调用。
   核心逻辑只有一份实现：网站与 MCP 服务共用同一套代码。

   用法：
     node mcp/server.js              # stdio 传输（大多数 MCP 客户端的默认方式）
     node mcp/server.js --http PORT   # Streamable HTTP 传输

   典型客户端配置（Claude Desktop / Cursor / VS Code 等）：
     {
       "mcpServers": {
         "online-tools": {
           "command": "node",
           "args": ["<仓库路径>/mcp/server.js"]
         }
       }
     }
   ============================================ */
'use strict';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

const { TOOLS } = require('./tools-registry');

const SERVER_NAME = 'online-tools';
const SERVER_VERSION = '1.0.0';

/**
 * 把工具的返回整理成 MCP 的 CallToolResult。
 * 出错时返回 isError，让 AI 能看到失败原因并自行纠正。
 */
function toCallToolResult(result) {
  if (result && result.ok === false) {
    return {
      isError: true,
      content: [{ type: 'text', text: '错误：' + (result.error || '未知错误') }]
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  };
}

function createServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(function (t) {
      return {
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.schema
      };
    })
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments || {};

    const tool = TOOLS.find(function (t) { return t.name === name; });
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: '错误：未知的工具 ' + name }]
      };
    }

    try {
      const result = await tool.handler(args);
      return toCallToolResult(result);
    } catch (e) {
      return {
        isError: true,
        content: [{ type: 'text', text: '错误：' + (e && e.message ? e.message : String(e)) }]
      };
    }
  });

  return server;
}

/** 启动 stdio 传输 */
async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout 属于 MCP 协议通道，任何日志都必须走 stderr
  console.error('[online-tools] MCP 服务器已启动，共 ' + TOOLS.length + ' 个工具。');
}

if (require.main === module) {
  main().catch(function (err) {
    console.error('[online-tools] 启动失败：', err);
    process.exit(1);
  });
}

module.exports = { createServer, main, TOOLS };
