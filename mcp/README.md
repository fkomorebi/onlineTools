# 🤖 MCP 服务器 —— 让 AI 直接调用这个网站

[Model Context Protocol](https://modelcontextprotocol.io)（MCP）服务器把本站的
**核心算法**暴露给 AI，让 AI 直接调用，而不是自己再写一遍 Base64 编码、CSV 解析、
GIF 编码、时区换算……

> **核心逻辑只有一份实现。** MCP 服务器直接加载网站自己的 `assets/js/*-core.js`，
> 没有任何复制粘贴的第二套算法。网站改了，AI 拿到的行为同步就变了。

---

## 🚀 快速开始

```bash
npm install                 # 安装依赖（@modelcontextprotocol/sdk + sharp）
npm run mcp                 # 启动 stdio 服务器
```

把下面这段加进你的 MCP 客户端配置（`command` / `args` 按实际路径改）：

```json
{
  "mcpServers": {
    "online-tools": {
      "command": "node",
      "args": ["C:/Users/fkomo/Documents/GitHub/onlineTools/mcp/server.js"]
    }
  }
}
```

| 客户端 | 配置文件位置 |
|--------|--------------|
| Claude Desktop | `~/AppData/Roaming/Claude/claude_desktop_config.json` |
| Claude Code | `claude mcp add online-tools -- node <仓库路径>/mcp/server.js` |
| Cursor | 项目根目录 `.cursor/mcp.json` |
| VS Code | 工作区 `.vscode/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

> Windows 上如果路径含反斜杠，记得在 JSON 里写成 `C:/Users/...` 这种正斜杠形式，
> 或对反斜杠做 `\\` 转义。

### 不接客户端也能试

```bash
npm run mcp:inspect                                # 列出全部工具
npm run mcp:inspect -- color_convert '{"color":"#ff8800"}'
npm run mcp:inspect -- datetime_convert '{"time":"1763960700","timezone":"Asia/Shanghai"}'
```

---

## 🔧 工具清单（23 个）

### 文本与数据

| 工具 | 说明 |
|------|------|
| `json_format` | 校验 JSON、格式化、统计体积 / 键数 / 深度 / 类型分布；非法时给出中文错误与行列位置 |
| `json_query` | 按 `$.a.b[0].c` 路径取值 |
| `csv_to_json` | CSV → JSON，自动识别分隔符，支持类型推断 |
| `json_to_csv` | JSON → CSV，自动处理引号与逗号转义 |
| `encode` | 编码为 Base64 / Base64URL / URL / URL+ / 十六进制 / HTML 实体 |
| `decode` | 解码上述任一格式 |
| `detect_encoding` | 自动识别文本的编码类型并解码 |

### 开发调试

| 工具 | 说明 |
|------|------|
| `url_parse` | 拆解 URL：协议 / 主机 / 端口 / 路径 / 查询参数 / 锚点 |
| `url_build` | 由各字段拼装 URL，自动编码查询参数 |
| `datetime_convert` | 时间 → ISO 8601 / RFC 7231 / RFC 2822 / Unix 时间戳 / 自定义格式串 / 多时区对照 |
| `datetime_diff` | 两个时间相差多少年 / 天 / 小时 / 分钟 / 秒 |
| `diff_text` | 逐行对比两段文本，输出增删改统计与标准 Unified Diff |
| `regex_test` | 正则匹配，列出位置、匹配文本、捕获组，并给出表达式拆解 |
| `regex_explain` | 把正则拆成带中文说明的片段 |

### 设计与安全

| 工具 | 说明 |
|------|------|
| `color_convert` | HEX / RGB / HSL / CMYK / HSLA 互转 |
| `color_contrast` | WCAG 对比度计算与 AA / AAA 达标判定 |
| `color_palette` | 生成明度阶梯、互补色、邻近色、三角配色 |
| `password_generate` | 批量生成高强度密码，可控字符集 / 长度，返回熵值与破解时间 |
| `password_check` | 检测弱口令模式（常见词、连续序列、重复字符） |

### 图片

| 工具 | 说明 |
|------|------|
| `image_convert` | PNG / JPEG / WebP / AVIF 互转 |
| `image_compress` | 按质量或目标体积压缩（二分搜索调质） |
| `image_gif` | 多张图片合成动画 GIF（自研 GIF89a 编码器） |
| `image_watermark` | 框选区域去水印（自动补片 / 边界扩散 / 模糊 / 中位数 / 手动补片） |

---

## 🧩 它是怎么工作的

```
mcp/
├── server.js           MCP 服务器入口（stdio 传输 + 工具调度）
├── core-loader.js      把浏览器的 *-core.js 加载进 Node
├── tools-registry.js   23 个工具的声明式定义（名称 / 说明 / JSON Schema）
├── tools-text.js       文本与数据类工具实现
├── tools-image.js      图片类工具实现（sharp + GifCore）
└── inspect.js          命令行速查 / 调试台
```

### 核心逻辑零复制

网站的 `*-core.js` 是纯计算代码，不碰 DOM。但它们统一以 `})(window)` 收尾，
直接 `require` 到 Node 会报 `window is not defined`。

`core-loader.js` 不改网站源码，而是在 Node 侧挂一个 `window` 别名指向 `globalThis`，
再把核心脚本读进来 `eval`：

```js
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}
(0, eval)(fs.readFileSync(file, 'utf8'));
```

这样网站本身零改动，MCP 与网页共用同一套实现。

### 与浏览器端的差异

| | 网站（浏览器） | MCP（Node） |
|---|---|---|
| JSON / CSV / 编码 / URL / 时间 / 差异 / 正则 / 颜色 / 密码 | `*-core.js` | **同一份** `*-core.js` |
| GIF 合成 | `gif-core.js` | **同一份** `gif-core.js` |
| 去水印 | `watermark-core.js` | **同一份** `watermark-core.js` |
| 图片编解码 | Canvas + `createImageBitmap` | `sharp`（服务端原生） |
| 音频 | Web Audio + ffmpeg.wasm | 未提供（需要 WASM 运行时，收益有限） |

> `image-core.js` 和 `audio-core.js` 依赖 `canvas` / `AudioContext`，
> 在 Node 下不可用 —— 加载器会跳过它们，图片类工具改走 `sharp` 路径。

---

## 🧪 测试

```bash
npm run test:mcp
```

41 项断言，走的是**真实的 MCP 协议链路**：用 SDK 的 `Client` 与 `Server`
通过内存传输完成握手，再逐个调用工具 —— 不是直接调函数。
图片类工具用 `sharp` 生成真实的 120×90 PNG 输入，校验输出字节。

---

## 📝 新增一个工具

1. 在 `mcp/tools-text.js` 或 `mcp/tools-image.js` 里写实现函数，
   返回 `{ ok: true, ... }` 或 `{ ok: false, error: '中文原因' }`。
2. 在 `mcp/tools-registry.js` 里登记：名称、标题、给 AI 看的描述、JSON Schema。
3. 在 `test/mcp.test.js` 里加断言。

`description` 是写给 AI 看的 —— 写清楚「什么时候该用它」，比写清楚它怎么实现更有用。
