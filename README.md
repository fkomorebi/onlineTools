# 🧰 在线工具箱

一个**纯前端、零广告、无追踪**的在线工具网站，直接部署在 GitHub Pages 上。

所有计算都在浏览器本地完成 —— 图片和 JSON 数据不会上传到任何服务器。

> 按 `Ctrl` / `⌘` + `K` 打开**命令面板**，可搜索并跳转到任意工具。

![首页](test/shots/01-home.png)

## ✨ 功能

| 工具 | 说明 |
|------|------|
| 📋 [JSON 格式化](index.html#/json) | 格式化 / 压缩 / 校验，错误定位到行列，树形视图，路径查询（如 `$.a.b[0].c`），统计与类型分布 |
| 🗜️ [图片压缩](index.html#/image) | 批量压缩，输出 WebP / JPEG / PNG，可指定目标体积（自动二分调质）与最大尺寸 |
| 🔄 [格式转换](index.html#/convert) | PNG ⇄ WebP ⇄ JPEG 互转，保留透明通道，转换前后体积对比 |
| 🎞️ [GIF 制作](index.html#/gif) | 多张图片合成动画 GIF，自研 GIF89a 编码器，可调帧延时、颜色数与尺寸压缩体积 |
| 🕒 [时间格式化](index.html#/datetime) | 时间转 UTC / ISO 8601 / RFC / Unix 时间戳，多时区对照，自定义格式串，时间差计算 |
| 🔍 [文本差异对比](index.html#/diff) | 两段文本并排 / Unified Diff 对比，字符级高亮，忽略空白，导出 `.diff` |
| 🔐 [密码生成器](index.html#/password) | 本地生成高强度密码，可控字符集与长度，熵值与破解时间估算，弱口令检测，批量生成 |
| 🎨 [颜色工具](index.html#/color) | HEX / RGB / HSL / CMYK 互转，明度阶梯与配色方案，WCAG 对比度检查 |
| 🔗 [URL 解析](index.html#/url) | URL 结构拆解（协议 / 主机 / 路径 / 锚点 / 认证信息），查询参数表可编辑并即时重拼，编码类型自动识别 |
| 📊 [CSV ⇄ JSON](index.html#/csv) | 表格数据互转，自动识别分隔符，类型自动推断（数字 / 布尔 / null），可下载 |
| 🔣 [编码转换](index.html#/encode) | Base64 / Base64 URL-safe / URL 百分号 / 十六进制 / HTML 实体互转，输入自动识别编码类型 |
| 🎯 [正则测试台](index.html#/regex) | 实时匹配高亮，捕获组列表，10 个常用模板，表达式逐段拆解，生成示例文本 |
| 🧽 [图片去水印](index.html#/watermark) | 框选水印区域后自动补片重建（多分辨率 patch match），可自动检测候选区域 |

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

### GIF 制作

把多张图片合成一段动画 GIF，**完全在浏览器里完成**。

> 浏览器原生只能编码静态位图，动画 GIF 必须自己写字节 ——
> 所以这里实现了一个完整的 GIF89a 编码器（无任何第三方依赖）。

- **多图合成**：拖拽上传多张图片，可拖动排序，也可按名称排序 / 反向排序，顺序即播放顺序
- **帧延时**：50 / 100 / 200 / 500 / 1000 ms 或自定义，单位毫秒
- **压缩手段**（可组合）：
  - **颜色数**：256 → 16 色，体积可降到 1/3 左右（渐变丰富的图会看出色带）
  - **输出尺寸**：等比缩放，缩小尺寸是最有效的压缩方式
  - **帧间差分**：只编码与上一帧不同的矩形区域，显著减少数据量
- **尺寸不一致时**：等比缩放并留白（可自定义背景色），或拉伸铺满
- **循环次数**：无限 / 1 / 2 / 3 / 5 次
- 结果可直接预览动画并下载

编码器内部包含：中位切分（median cut）颜色量化、GIF 变长码 LZW 压缩、
帧间差分与矩形裁剪、Netscape 2.0 循环扩展块。

### 时间格式化

- **输入任意时间**：ISO 字符串、`2026-11-24 15:45:04`、`2026/11/24`、Unix 秒 / 毫秒时间戳
- **常用格式一键复制**：ISO 8601（本地 & UTC）、RFC 7231 / HTTP、RFC 2822、中文可读日期、紧凑格式、Unix 时间戳（秒 / 毫秒）
- **多时区对照**：内置 14 个常用时区（UTC、上海、东京、伦敦、纽约……），显示各自 UTC 偏移与当地时间，夏令时标记 `DST`
- **自定义格式串**：`yyyy-MM-dd HH:mm:ss`、`yyyyMMddHHmmss`、`EEE, dd MMM yyyy HH:mm:ss` 等，支持 `Z` / `ZZ` 时区偏移、`X` / `x` 时间戳
- **时区自由切换**：时区下拉框可选任意 IANA 时区（`Intl.supportedValuesOf`），可搜索添加
- **时间差计算**：两个时间相差多少天 / 小时 / 分钟 / 秒
- **实时更新**：打开即显示当前时间，每秒刷新

### 文本差异对比

对比两段文本，找出行级与字符级差异 —— 纯前端实现的 LCS 差异算法。

- **并排视图**：左右两栏同步滚动，删除行标红、新增行标绿，右侧行号独立
- **字符级高亮**：修改过的行内部再逐字符标出差异（可关闭）
- **Unified Diff**：生成标准 `@@ -a,b +c,d @@` 补丁格式，可直接复制或下载 `.diff` 文件
- **忽略空白**：勾选后忽略行首尾空格与空行差异
- **统计面板**：新增 / 删除 / 修改 / 未变行数
- 一键**交换两边**、载入示例、清空

### 密码生成器

在浏览器里生成高强度密码 —— 密码不会离开你的设备。

- 使用 `crypto.getRandomValues` + **拒绝采样**，无取模偏差
- 字符集可控：小写 / 大写 / 数字 / 符号，可排除易混淆字符（`Il1O0o`）
- 长度 4–128，滑块与数字框双向同步
- **自定义字符集**：填写后**取代**内置符号集（可含中文等非 ASCII 字符）
- **每类字符至少各一个**（可关闭）
- **熵值与破解时间估算**：按 10¹¹ 次/秒 的离线爆破速度折算
- **弱口令检测**：识别重复串、连续序列（如 `123`）、常见弱口令片段、键盘走位
- **批量生成**并导出表格

### 颜色工具

- **多格式互转**：HEX / RGB / HSL / CMYK 一键复制（也支持 `#rgb`、`#rgba`、`rgb()`、`rgba()`、`hsl()`、`hsla()` 输入）
- **明度阶梯**：生成 9 档明度梯度，保持同一色相
- **配色方案**：类似色、互补色、三分色
- **WCAG 对比度检查**：前景 / 背景色对比度，AA / AAA 是否通过（区分普通与大号文本）
- 实时预览与**随机颜色 / 随机色板**生成

### URL 解析

把一个 URL 拆开看清楚里面到底有什么 —— 全程在浏览器里完成。

- **结构拆解**：协议、用户名 / 密码、主机名、端口、路径、查询串、锚点、origin
- **参数表**：每个查询参数一行，含编码前后的键值对照；**改任意一格，URL 立即重拼**
- **反向生成**：从协议 / 主机 / 路径 / 参数表拼出 URL
- **编码自动识别**：识别 Base64、URL 百分号编码、HTML 实体等并直接解码
- 兼容相对路径、IPv6 字面量（`[::1]`）、重复键、无值键

### CSV ⇄ JSON

- **双向转换**：CSV → JSON 与 JSON → CSV 两个标签页
- **分隔符自动识别**：逗号 / 制表符 / 分号 / 竖线，也能手动指定
- **表头模式**：第一行作为字段名；关闭时自动生成 `column1`、`column2`…
- **类型推断**：数字、布尔、`null` 自动识别，可关闭保持全部为字符串
- 引号转义、字段内换行、`""` 双写转义均正确处理
- 结果可复制或直接下载 `.json` / `.csv`

### 编码转换

- 支持 **Base64**、**Base64 URL-safe**、**URL 百分号编码**、**URL 编码（空格转 +）**、**十六进制**、**HTML 实体**
- 输入时**自动识别**编码类型并给出置信度，识别失败则按当前类型编码
- 十六进制与 Base64 输入非法时报中文错误，不抛异常
- 完整支持 UTF-8 与 Emoji（代理对）往返

### 正则测试台

- **实时匹配**：修改表达式立即重跑，匹配数量、耗时、正则长度实时统计
- **捕获组列表**：每个匹配的完整文本、各捕获组内容与起始位置
- **修饰符开关**：`g` `i` `m` `s` `u` `y` 一键切换
- **10 个常用模板**：邮箱、URL、手机号、IPv4、日期、十六进制颜色、空白、重复单词、中文、HTML 标签
- **表达式拆解**：把正则逐段翻译成人话（分组、量词、字符类、锚点、转义…）
- **生成示例文本**：按表达式造一条能匹配的样例串

### 图片去水印

框选图片上的水印区域，用周围的像素把它"抹掉"。

- **五种修复方式**：
  - **自动补片（默认，照片首选）**：把选区当成一个"洞"，在整张图里自动搜索与选区四周最相似的区域，把那块**真实画面**搬过来。纹理、边缘、渐变全都接得上，不会糊成一块色块
  - **边界扩散填充**：从选区边缘的真实像素逐层向内扩散，保留原来的明暗过渡，适合纯色或渐变背景
  - **邻域均值**：用周围的平均色填满，只在背景完全是纯色时用
  - **邻域中位数**：用周围像素的中位数填满，能压掉噪点，但细节会被抹平
  - **手动补片**：自己指定取样偏移，从别处搬一块过来
- **大图也不卡**：自动补片采用多分辨率搜索（先在缩略图上粗找，再逐层放大精修），3000×3000 的图约 0.1 秒
- **自动检测**：扫描与背景差异明显的连通区域，按"颜色统一性 × 密度"打分排序，给出候选水印框
- **框选**：在预览图上拖拽选择区域（鼠标 / 触摸都支持），`Esc` 清除
- **前后对比**：原图与结果并排，统计被修改的像素数与本次修复方式
- 结果可导出 PNG / JPEG / WebP

> 所有像素运算都在 `Canvas` 里完成，图片不会上传到任何服务器。

### ⌨️ 命令面板

按 `Ctrl` / `⌘` + `K` 打开，快速跳转到任意工具。

- 输入关键字即时过滤，匹配工具名与描述
- `↑` `↓` 或 `Tab` 切换，`Enter` 打开，`Esc` 关闭
- 桌面端与移动端都可用（导航栏右侧也有按钮）

## 🚀 部署到 GitHub Pages

本项目是**纯静态文件，没有构建步骤**。

### 方式一：GitHub Actions 自动部署（推荐）

仓库已附带 [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)，推送即自动部署。

启用步骤：

1. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
2. 直接 push 触发 workflow，或在 **Actions** 面板手动运行 `Deploy to GitHub Pages`。

工作流会把 `index.html`、`assets/`、`.nojekyll`（以及 `CNAME`，若存在）收集到
`_site/` 再发布 —— 不会把 `node_modules/` 和测试代码带上去。

工作流分为两个 job：`build` 负责收集文件并上传 `github-pages` 产物，
`deploy` 通过 `needs: build` 依赖它并执行发布。

> **为什么必须拆成两个 job**：`actions/deploy-pages` 是通过 artifact 元数据接口
> 按「当前 workflow run」查找名为 `github-pages` 的产物的。上传与部署写在同一个
> job 时，刚上传的产物可能还没对该接口可见，部署就会失败并报
> `No artifacts named "github-pages" were found for this workflow run`。
> 拆开并用 `needs:` 建立依赖后，部署开始时产物已经可见 ——
> 这也是 GitHub 官方 Pages 模板的做法。
>
> `npm run test:actions` 会校验这个结构，避免以后改动时不小心改回单 job。

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
| `npm run test:dom` | 437 项 DOM 集成测试 —— 在 jsdom 中加载真实页面并驱动真实代码 |
| `npm run test:encode` | 18 项真实编解码测试 —— 用 sharp 生成/校验真实 PNG/WebP/JPEG 字节 |
| `npm run test:gif` | 47 项 GIF 编码测试 —— 用 sharp（libgif）校验自研 GIF89a 编码器输出的真实字节 |
| `npm run test:browser` | 54 项真实浏览器测试 —— 需要先启动无头 Edge（见下） |
| `npm run test:actions` | 校验 workflow 用到的 GitHub Action 均不依赖 Node.js 20，并检查 build/deploy 是否拆成了两个 job |
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
│       ├── gif-core.js           GIF89a 编码核心（量化 / LZW / 帧间差分）
│       ├── gif.js                GIF 制作工具
│       ├── datetime-core.js      时间格式化核心（解析 / 时区换算 / 格式串）
│       ├── datetime.js           时间格式化工具
│       ├── diff-core.js          文本差异核心（LCS 行级 / 字符级 / Unified Diff）
│       ├── diff.js               文本差异对比工具
│       ├── password-core.js      密码生成核心（拒绝采样 / 熵值 / 弱模式检测）
│       ├── password.js           密码生成器
│       ├── color-core.js         颜色转换核心（格式互转 / WCAG / 配色方案）
│       ├── color.js              颜色工具
│       ├── url-core.js           URL 解析核心（结构拆解 / 参数表 / 编码识别）
│       ├── url.js                URL 解析工具
│       ├── csv-core.js           CSV ⇄ JSON 转换核心（分隔符识别 / 类型推断）
│       ├── csv.js                CSV ⇄ JSON 工具
│       ├── encode-core.js        编码转换核心（Base64 / URL / Hex / HTML 实体）
│       ├── encode.js             编码转换工具
│       ├── regex-core.js         正则核心（编译 / 匹配 / 表达式拆解 / 示例生成）
│       ├── regex.js              正则测试台
│       ├── watermark-core.js     去水印核心（自动补片 / 边界扩散 / 模糊 / 中位数 / 手动补片 / 水印检测）
│       ├── watermark.js          图片去水印工具
│       ├── palette.js            Ctrl+K 命令面板
│       └── app.js                哈希路由与启动
└── test/
    ├── dom.test.js               DOM 集成测试（jsdom）
    ├── encode.test.js            真实编解码测试（sharp）
    ├── gif-encode.test.js        GIF 编码字节测试（sharp 校验 GIF89a 输出）
    ├── gif-flow.test.js          GIF 页面端到端流程测试（jsdom + sharp）
    ├── browser-image.js          浏览器图片压缩验证
    ├── browser-convert.js        浏览器格式转换验证
    ├── browser-gif.js            浏览器 GIF 制作验证
    ├── browser-watermark.js      浏览器图片去水印验证（真实像素比对）
    ├── check-workflow.ps1        校验 Actions 版本（Node 24）
    └── shot2.js                  截图脚本
```

## 🛡️ 隐私

- 图片通过 `FileReader` 读取、`Canvas` 缩放与编码，全程在浏览器内存内完成。
- GIF 由自研的 GIF89a 编码器在浏览器内生成，字节不上传。
- JSON 使用浏览器内置 `JSON.parse` / `JSON.stringify`。
- 文本差异对比在浏览器内计算 LCS，密码由 `crypto.getRandomValues` 本地生成，颜色转换为纯计算 —— 都不上传任何数据。
- URL 解析、CSV ⇄ JSON、编码转换、正则测试台全部是纯字符串处理，数据不出浏览器。
- 去水印的图片由 `FileReader` 读入 `Canvas`，像素运算在本地完成，导出后才产生文件。
- 无后端、无数据库、无分析事件、不写 `cookie` 或 `localStorage`。
- 唯一的网络请求是加载页面本身的静态文件。

## 📄 License

MIT
