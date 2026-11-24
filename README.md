# 🧰 在线工具箱

一个**纯前端、零广告、无追踪**的在线工具网站，直接部署在 GitHub Pages 上。

所有计算都在浏览器本地完成 —— 图片和 JSON 数据不会上传到任何服务器。

![首页](test/shots/01-home.png)

## ✨ 功能

| 工具 | 说明 |
|------|------|
| 📋 [JSON 格式化](index.html#/json) | 格式化 / 压缩 / 校验，错误定位到行列，树形视图，路径查询（如 `$.a.b[0].c`），统计与类型分布 |
| 🗜️ [图片压缩](index.html#/image) | 批量压缩，输出 WebP / JPEG / PNG，可指定目标体积（自动二分调质）与最大尺寸 |
| 🔄 [格式转换](index.html#/convert) | PNG ⇄ WebP ⇄ JPEG 互转，保留透明通道，转换前后体积对比 |
| 🕒 [时间格式化](index.html#/datetime) | 时间转 UTC / ISO 8601 / RFC / Unix 时间戳，多时区对照，自定义格式串，时间差计算 |

### JSON 格式化

- 缩进可选：2 空格 / 4 空格 / Tab / 不缩进
- 错误提示定位到**具体行列**并用 `^` 标出出错位置，报错信息为中文
- **树形视图**：语法高亮，点击箭头展开 / 折叠
- **路径查询**：`$.user.roles[1]`、`$.a.b.c` 形式直接取值
- 统计面板：体积、字符数、行数、键数量、数组 / 对象数、最大深度、根类型
- 类型分布：字符串 / 数字 / 布尔 / null / 对象 / 数组 各有多少个
- 快捷键 `Ctrl` / `Cmd` + `Enter` 格式化

### 图片压缩

- **批量**处理，支持拖拽多文件
- 输出格式：WebP（推荐）/ JPEG / PNG
- **目标体积**模式：设定每张图的 KB 上限，自动二分搜索质量参数逼近目标
- **最大宽高**限制：超出时等比缩小（不会放大小图）
- 逐张显示压缩前后体积与节省百分比，可单独或批量下载

实测：1400×1000 的 PNG **3.37 MB → 132 KB（省 96%）**，画质 MAE 4.11。

### 格式转换

- PNG → WebP、WebP → PNG、JPEG → WebP 等互转
- 批量处理，转换前后并排预览 + 体积对比
- PNG 保留透明通道（alpha 精确保留）

### 时间格式化

- **输入任意时间**：ISO 字符串、`2026-11-24 15:45:04`、`2026/11/24`、Unix 秒 / 毫秒时间戳
- **常用格式一键复制**：ISO 8601（本地 & UTC）、RFC 7231 / HTTP、RFC 2822、中文可读日期、紧凑格式、Unix 时间戳（秒 / 毫秒）
- **多时区对照**：内置 14 个常用时区（UTC、上海、东京、伦敦、纽约……），显示各自 UTC 偏移与当地时间，夏令时标记 `DST`
- **自定义格式串**：`yyyy-MM-dd HH:mm:ss`、`yyyyMMddHHmmss`、`EEE, dd MMM yyyy HH:mm:ss` 等，支持 `Z` / `ZZ` 时区偏移、`X` / `x` 时间戳
- **时区自由切换**：时区下拉框可选任意 IANA 时区（`Intl.supportedValuesOf`），可搜索添加
- **时间差计算**：两个时间相差多少天 / 小时 / 分钟 / 秒
- **实时更新**：打开即显示当前时间，每秒刷新

## 🚀 部署到 GitHub Pages

本项目是**纯静态文件，没有构建步骤**。

### 方式一：GitHub Actions 自动部署（推荐）

仓库已附带 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)，推送即自动部署。

启用步骤：

1. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
2. 直接 push 触发 workflow，或在 **Actions** 面板手动运行 `Deploy to GitHub Pages`。

工作流会把 `index.html`、`assets/`、`.nojekyll`（以及 `CNAME`，若存在）收集到
`_site/` 再发布 —— 不会把 `node_modules/` 和测试代码带上去。

站点地址为 `https://<你的用户名>.github.io/<仓库名>/`。

### 方式二：直接从分支部署

1. **Settings → Pages → Build and deployment → Source** 选 `Deploy from a branch`，
   分支 `main`，目录 `/ (root)`。
2. 保存后等待一两分钟即可。

> 仓库根目录下的 `.nojekyll` 会让 GitHub Pages 跳过 Jekyll 处理，
> 确保 `assets/` 目录原样发布。

### 自定义域名

在 **Settings → Pages → Custom domain** 填入域名，
并在域名服务商处添加指向 `<用户名>.github.io` 的 CNAME 记录。
也可以在仓库根目录放一个 `CNAME` 文件记录域名（部署时会一并带上）。

## 💻 本地预览

任意静态服务器都可以：

```bash
npm start          # npx serve . -l 8080
# 或
npm run serve      # python -m http.server 8080
```

然后打开 `http://localhost:8080`。

> 直接双击 `index.html` 用 `file://` 打开也能用，但建议用静态服务器以获得一致的浏览器行为。

## 🧪 测试

```bash
npm install        # 安装测试依赖（jsdom / sharp）
npm test           # 全部测试
```

| 命令 | 说明 |
|------|------|
| `npm run test:dom` | 130 项 DOM 集成测试 —— 在 jsdom 中加载真实页面并驱动真实代码 |
| `npm run test:encode` | 18 项真实编解码测试 —— 用 sharp 生成/校验真实 PNG/WebP/JPEG 字节 |
| `npm run test:browser` | 28 项真实浏览器测试 —— 需要先启动无头 Edge（见下） |
| `npm run test:actions` | 校验 workflow 用到的 GitHub Action 均不依赖 Node.js 20 |
| `npm run shots` | 截图各页面到 `test/shots/` |

> `test:actions` 会拉取每个 action 的 `action.yml` 读取 `runs.using` 字段，
> 对 composite 动作还会递归检查其内部依赖。GitHub 已于 2025-09-19 弃用
> Actions runner 上的 Node.js 20，用它可以在升级 action 版本时避免遗漏。

浏览器测试需要一个开启调试端口的 Edge：

```powershell
$d = Join-Path $env:TEMP "cdp"
Start-Process "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" `
  -ArgumentList "--headless=new","--remote-debugging-port=9350","--user-data-dir=$d",`
                "--no-first-run","--disable-gpu","--no-sandbox","about:blank" -WindowStyle Hidden
$env:CDP_PORT = 9350
npm run test:browser
```

## 📁 项目结构

```
.
├── index.html                    页面骨架
├── .nojekyll                     让 GitHub Pages 跳过 Jekyll
├── .github/workflows/deploy.yml  GitHub Actions 自动部署
├── assets/
│   ├── css/style.css             全部样式（深色主题）
│   └── js/
│       ├── util.js               通用工具函数（字节格式化、下载、剪贴板等）
│       ├── home.js               首页
│       ├── about.js              关于页
│       ├── json.js               JSON 格式化工具
│       ├── image-core.js         图片处理核心（Canvas 编码 / 目标体积二分）
│       ├── image.js              图片压缩工具
│       ├── convert.js            格式转换工具
│       ├── datetime-core.js      时间格式化核心（解析 / 时区换算 / 格式串）
│       ├── datetime.js           时间格式化工具
│       └── app.js                哈希路由与启动
└── test/
    ├── dom.test.js               DOM 集成测试（jsdom）
    ├── encode.test.js            真实编解码测试（sharp）
    ├── browser-image.js          浏览器图片压缩验证
    ├── browser-convert.js        浏览器格式转换验证
    ├── check-workflow.ps1        校验 Actions 版本（Node 24）
    └── shot2.js                  截图脚本
```

## 🛡️ 隐私

- 图片通过 `FileReader` 读取、`Canvas` 缩放与编码，全程在浏览器内存内完成。
- JSON 使用浏览器内置 `JSON.parse` / `JSON.stringify`。
- 无后端、无数据库、无分析事件、不写 `cookie` 或 `localStorage`。
- 唯一的网络请求是加载页面本身的静态文件。

## 📄 License

MIT
