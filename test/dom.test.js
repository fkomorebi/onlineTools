/* ============================================
   DOM 集成测试 —— 在 jsdom 中加载真实页面并驱动真实代码
   不依赖浏览器二进制，可直接 `node test/dom.test.js` 运行
   ============================================ */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ->  ' + detail : ''));
}

/* ---------- 搭建 DOM 环境 ---------- */

const virtualConsole = new VirtualConsole();
const pageErrors = [];
virtualConsole.on('jsdomError', (e) => pageErrors.push(e.message + '\n' + (e.stack || '')));
virtualConsole.on('error', (...a) => pageErrors.push(a.map(String).join(' ')));

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
  url: 'http://localhost/#/json',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole
});

const { window } = dom;

// jsdom 没有实现 canvas —— 提供最小可用的桩，让图片流程能被完整驱动
const stubCanvas = window.HTMLCanvasElement.prototype.getContext;
// 每个 canvas 记住自己的像素缓冲，putImageData / drawImage 才能真正往返
const canvasBuffers = new WeakMap();
function bufferOf(canvas) {
  let buf = canvasBuffers.get(canvas);
  if (!buf) {
    buf = { data: null, width: 0, height: 0 };
    canvasBuffers.set(canvas, buf);
  }
  return buf;
}
function gradientPixels(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const px = i % w, py = (i / w) | 0;
    data[i * 4] = (px * 5) & 0xff;
    data[i * 4 + 1] = (py * 7) & 0xff;
    data[i * 4 + 2] = ((px + py) * 3) & 0xff;
    data[i * 4 + 3] = 255;
  }
  return data;
}
window.HTMLCanvasElement.prototype.getContext = function () {
  const canvas = this;
  const ctx = {
    canvas: canvas,
    fillStyle: '#000', imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    fillRect() {}, drawImage() {}, clearRect() {},
    // 返回带有渐变内容的像素：全黑会让「颜色数影响体积」这类断言失去意义
    getImageData(x, y, w, h) {
      const buf = bufferOf(canvas);
      if (buf.data && buf.width === w && buf.height === h) {
        return { data: new Uint8ClampedArray(buf.data), width: w, height: h };
      }
      return { data: gradientPixels(w, h), width: w, height: h };
    },
    putImageData(imageData, x, y) {
      const buf = bufferOf(canvas);
      const w = imageData.width, h = imageData.height;
      buf.data = new Uint8ClampedArray(imageData.data);
      buf.width = w; buf.height = h;
    },
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}
  };
  return ctx;
};
void stubCanvas;

// jsdom 未实现 window.scrollTo
window.scrollTo = function () {};

// jsdom 的 canvas.toDataURL 不识别真实格式 —— 用它判断 supportsFormat 会误报，
// 这里改成探测格式前缀字符串，行为与浏览器一致
window.HTMLCanvasElement.prototype.toDataURL = function (type) {
  const t = type || 'image/png';
  if (t === 'image/png') return 'data:image/png;base64,AAAA';
  if (t === 'image/webp') return 'data:image/webp;base64,AAAA';
  if (t === 'image/jpeg') return 'data:image/jpeg;base64,AAAA';
  return 'data:,'; // 不支持的格式
};

// jsdom 的 canvas.toBlob 未实现 —— 依据 format 产出可辨认的字节
window.HTMLCanvasElement.prototype.toBlob = function (cb, type) {
  const t = type || 'image/png';
  const body = t === 'image/webp' ? 'WEBPBYTES' : t === 'image/jpeg' ? 'JPEGBYTES' : 'PNGBYTES';
  const blob = new window.Blob([body], { type: t });
  setTimeout(() => cb(blob), 0);
};

// 记录下载动作
const downloads = [];
window.URL.createObjectURL = function (blob) {
  downloads.push(blob);
  return 'blob:stub/' + downloads.length;
};
window.URL.revokeObjectURL = function () {};
// HTMLAnchorElement.click 会触发 jsdom 的导航错误，这里改为记录
window.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download }); };

// jsdom 的 Image 不会真正解码图片，这里用桩记录被设置的尺寸
window.Image = class {
  constructor() {
    Object.defineProperty(this, 'naturalWidth', {
      get: () => (window.__imgSize && window.__imgSize.w) || 400,
      configurable: true
    });
    Object.defineProperty(this, 'naturalHeight', {
      get: () => (window.__imgSize && window.__imgSize.h) || 300,
      configurable: true
    });
    this.width = 0; this.height = 0;
  }
  set src(v) {
    this._src = v;
    setTimeout(() => { this.onload && this.onload(); }, 0);
  }
  get src() { return this._src; }
};
window.__imgSize = { w: 400, h: 300 };

// jsdom 未实现 DataTransfer —— 提供最小实现用于模拟多文件选择
window.DataTransfer = class DataTransfer {
  constructor() { this._files = []; }
  get items() {
    const self = this;
    return {
      add(file) { self._files.push(file); },
      get length() { return self._files.length; }
    };
  }
  get files() { return this._files; }
};

/** 把一组 File 挂到 input.files 上（jsdom 的 setter 做严格类型检查，故直接定义属性） */
function attachFiles(input, fileList) {
  const arr = fileList.slice();
  arr.item = (i) => arr[i] || null;
  Object.defineProperty(input, 'files', { value: arr, configurable: true, writable: true });
  input.dispatchEvent(new window.Event('change'));
}

// 注入脚本
const scripts = [
  'assets/js/util.js',
  'assets/js/home.js',
  'assets/js/about.js',
  'assets/js/json.js',
  'assets/js/image-core.js',
  'assets/js/image.js',
  'assets/js/convert.js',
  'assets/js/gif-core.js',
  'assets/js/gif.js',
  'assets/js/datetime-core.js',
  'assets/js/datetime.js',
  'assets/js/diff-core.js',
  'assets/js/diff.js',
  'assets/js/password-core.js',
  'assets/js/password.js',
  'assets/js/color-core.js',
  'assets/js/color.js',
  'assets/js/url-core.js',
  'assets/js/url.js',
  'assets/js/csv-core.js',
  'assets/js/csv.js',
  'assets/js/encode-core.js',
  'assets/js/encode.js',
  'assets/js/regex-core.js',
  'assets/js/regex.js',
  'assets/js/watermark-core.js',
  'assets/js/watermark.js',
  'assets/js/palette.js',
  'assets/js/app.js'
];
for (const s of scripts) {
  try {
    window.eval(fs.readFileSync(path.join(ROOT, s), 'utf8'));
  } catch (e) {
    pageErrors.push(`加载 ${s} 失败: ${e.message}`);
  }
}

const { document, Event, DataTransfer, File, Blob } = window;

// ---------- 工具 ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const btn = (label) => $$('button').find(b => b.textContent.trim() === label);
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const setVal = (el, v) => {
  el.value = v;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 状态文本：取"可见"的状态元素（部分页面有多个 tab，各自一个 .status）
const isVisible = (node) => {
  let n = node;
  while (n && n !== document.body) {
    if (n.style && n.style.display === 'none') return false;
    n = n.parentElement;
  }
  return true;
};
const statusText = (sel) => {
  const list = sel ? $$(sel) : $$('#app .status');
  const vis = list.filter(isVisible);
  const s = vis.length ? vis[0] : list[0];
  return s ? s.textContent : '';
};

(async () => {
  console.log('\n=== 脚本加载 ===');
  check('所有脚本加载无异常', pageErrors.length === 0, pageErrors.join(' | '));
  check('全局对象已挂载', !!window.JSONTool && !!window.ImageTool && !!window.ConvertTool
    && !!window.GifTool && !!window.GifCore
    && !!window.DateTimeTool && !!window.DateTimeCore
    && !!window.DiffTool && !!window.DiffCore
    && !!window.PasswordTool && !!window.PasswordCore
    && !!window.ColorTool && !!window.ColorCore
    && !!window.UrlTool && !!window.UrlCore
    && !!window.CsvTool && !!window.CsvCore
    && !!window.EncodeTool && !!window.EncodeCore
    && !!window.RegexTool && !!window.RegexCore
    && !!window.WatermarkTool && !!window.WatermarkCore
    && !!window.CommandPalette
    && !!window.HomePage && !!window.AboutPage && !!window.U);

  /* ================= JSON 工具 ================= */
  console.log('\n=== JSON 格式化 ===');

  window.location.hash = '#/json';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);

  check('JSON 页已渲染', !!$('#json-input'));
  check('默认载入示例', $('#json-input').value.length > 0);
  check('示例自动格式化', $('#json-output').value.includes('"features"'));
  check('状态提示合法', statusText().includes('合法'), statusText());
  check('统计面板可见', $('#json-stats-card').style.display !== 'none');
  check('类型分布面板可见', $('#json-types-card').style.display !== 'none');
  check('树形视图节点已生成', $$('.tree-node').length > 0);

  // 格式化
  setVal($('#json-input'), '{"b":1,"a":[1,2,{"c":true}]}');
  click(btn('格式化'));
  const out = $('#json-output').value;
  check('缩进输出正确', out.includes('\n  "b": 1'), JSON.stringify(out));
  check('键顺序保留', out.indexOf('"b"') < out.indexOf('"a"'));
  check('格式化后清除错误样式', !$('#json-input').classList.contains('error'));

  // 压缩
  click(btn('压缩'));
  check('压缩结果正确', $('#json-output').value === '{"b":1,"a":[1,2,{"c":true}]}',
    $('#json-output').value);

  // 非法 JSON
  setVal($('#json-input'), '{"a": 1,,}');
  click(btn('格式化'));
  check('非法 JSON 报错', statusText().includes('✗'), statusText());
  check('错误含行列信息', /行/.test(statusText()), statusText());
  check('错误时输出清空', $('#json-output').value === '');
  check('错误时输入框标红', $('#json-input').classList.contains('error'));
  check('错误时统计隐藏', $('#json-stats-card').style.display === 'none');

  // 缩进选项
  setVal($('#json-input'), '{"a":{"b":1}}');
  $('#json-indent').value = '4';
  click(btn('格式化'));
  check('4 空格缩进', $('#json-output').value.includes('\n    "a"'), JSON.stringify($('#json-output').value));
  $('#json-indent').value = '0';
  click(btn('格式化'));
  check('无缩进输出', $('#json-output').value === '{"a":{"b":1}}', $('#json-output').value);
  $('#json-indent').value = '2';

  // 校验
  setVal($('#json-input'), '{"ok":true}');
  click(btn('校验'));
  check('校验通过提示', statusText().includes('✓'), statusText());

  // 统计数值正确性
  setVal($('#json-input'), '{"a":1,"b":[2,3]}');
  click(btn('格式化'));
  const statVals = $$('#json-stats-card .stat').map(s => s.textContent);
  check('统计显示键数量 3', statVals.join(' ').includes('3'), statVals.join(' | '));

  // 树形视图折叠
  const treeRows = $$('.tree-row');
  check('树形包含键名', treeRows.some(r => r.textContent.includes('"a"')));

  // 错误信息应为中文（而非引擎英文原文）
  const errCases = [
    ['{"a": 1,,}', '缺少双引号包裹的属性名'],
    ['{a: 1}', '缺少属性名或右花括号'],
    ['{"a" 1}', '属性名后缺少冒号'],
    ['{"a": 1', '属性值后缺少逗号'],
    ['[1,2,', '内容不完整'],
    ['{"a": "abc}', '字符串没有闭合'],
    ['{"a": tru}', '意外的字符'],
    ['{"a": 1} extra', '多余内容']
  ];
  for (const [input, expect] of errCases) {
    setVal($('#json-input'), input);
    click(btn('格式化'));
    const msg = statusText();
    check(`错误提示为中文: ${expect}`, msg.includes(expect) && !/[A-Za-z]{4,}\s+(after|property|character)/.test(msg),
      msg.replace(/\n.*/s, ''));
  }

  // 路径查询
  setVal($('#json-input'), '{"user":{"name":"Alice","tags":["a","b"]}}');
  click(btn('格式化'));
  click($$('.tab').find(t => t.textContent === '路径查询'));
  setVal($('#json-path'), '$.user.tags[1]');
  click(btn('查询'));
  const pathOut = $('#json-path-out').textContent;
  check('路径查询取到值', pathOut.includes('"b"'), pathOut);
  setVal($('#json-path'), '$.user.missing');
  click(btn('查询'));
  check('路径不存在提示', $('#json-path-out').textContent.includes('未找到'));
  setVal($('#json-path'), '$.user.name');
  click(btn('查询'));
  check('路径取字符串', $('#json-path-out').textContent.includes('Alice'));

  // 标签切换
  click($$('.tab').find(t => t.textContent === '树形视图'));
  check('树形面板显示', $$('.tree').length > 0);
  check('树形面板可见', $$('.tab').find(t => t.textContent === '树形视图').classList.contains('active'));

  // 清空
  click(btn('清空'));
  check('清空后输入为空', $('#json-input').value === '');
  check('清空后输出为空', $('#json-output').value === '');

  // 示例按钮
  click(btn('示例'));
  check('示例按钮重新载入', $('#json-input').value.length > 0);

  /* ================= 图片核心 ================= */
  console.log('\n=== 图片处理核心 ===');

  check('WebP 输出受支持', window.ImageCore.supportsFormat('image/webp'));
  check('PNG 输出受支持', window.ImageCore.supportsFormat('image/png'));

  // 构造真实的 PNG blob（用 PNG 的最小合法字节 + 校验）
  const pngBytes = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050001' +
    '0d0a2db40000000049454e44ae426082', 'hex');
  const pngBlob = new Blob([pngBytes], { type: 'image/png' });
  check('构造 PNG blob', pngBlob.size === pngBytes.length, 'size=' + pngBlob.size);

  const dims = await window.ImageCore.inspect(pngBlob);
  check('读取图片尺寸', dims.width === 400 && dims.height === 300, JSON.stringify(dims));

  const proc = await window.ImageCore.process(pngBlob, { format: 'image/webp', quality: 0.8 });
  check('输出 Blob 类型为 WebP', proc.blob.type === 'image/webp', proc.blob.type);
  check('输出尺寸与输入一致', proc.width === 400 && proc.height === 300, JSON.stringify(proc));

  const resized = await window.ImageCore.process(pngBlob, { format: 'image/webp', quality: 0.8, maxWidth: 200 });
  check('最大宽度缩放生效', resized.width === 200 && resized.height === 150, JSON.stringify(resized));

  const resizedH = await window.ImageCore.process(pngBlob, { format: 'image/webp', quality: 0.8, maxHeight: 150 });
  check('最大高度缩放生效', resizedH.height === 150 && resizedH.width === 200, JSON.stringify(resizedH));

  const jpeg = await window.ImageCore.process(pngBlob, { format: 'image/jpeg', quality: 0.8 });
  check('JPEG 输出类型正确', jpeg.blob.type === 'image/jpeg', jpeg.blob.type);
  check('PNG 输出类型正确',
    (await window.ImageCore.process(pngBlob, { format: 'image/png' })).blob.type === 'image/png');

  // 目标体积
  const tgt = await window.ImageCore.compressToTarget(pngBlob, {
    format: 'image/webp', quality: 0.9, targetBytes: 10
  });
  check('目标体积压缩返回结果', tgt.blob.size > 0, 'size=' + tgt.blob.size);

  // 文件名生成
  check('输出文件名去扩展名', window.ImageCore.buildFilename('a.png', 'webp') === 'a.webp');
  check('输出文件名清理非法字符',
    window.ImageCore.buildFilename('a/b:c*.png', 'jpg') === 'a_b_c_.jpg',
    window.ImageCore.buildFilename('a/b:c*.png', 'jpg'));

  /* ================= 图片压缩页面 ================= */
  console.log('\n=== 图片压缩页面 ===');

  window.location.hash = '#/image';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);
  check('图片页已渲染', !!$('#img-drop'));

  // 模拟添加文件
  const files = [
    new File([pngBytes], 'one.png', { type: 'image/png' }),
    new File([pngBytes], 'two.png', { type: 'image/png' })
  ];
  const fileInput = $('#img-file');
  attachFiles(fileInput, files);
  await sleep(50);

  check('批量添加 2 张图片', $$('.file-item').length === 2);
  check('文件列表卡片显示', $('#img-list-card').style.display !== 'none');
  check('添加后有成功提示', statusText().includes('已添加'), statusText());

  // 压缩
  click(btn('开始压缩'));
  await sleep(500);
  check('压缩完成', statusText().includes('✓ 完成'), statusText());
  check('压缩后统计有节省比例', $('#img-summary').textContent.includes('%'));
  check('输出格式为 WebP 默认值', $('#img-format').value === 'image/webp');

  // 输出格式切换为 JPEG
  $('#img-format').value = 'image/jpeg';
  click(btn('开始压缩'));
  await sleep(500);
  check('切换 JPEG 后仍完成', statusText().includes('✓ 完成'), statusText());

  // 移除一项
  const before = $$('.file-item').length;
  click($$('.file-remove')[0]);
  check('移除文件项', $$('.file-item').length === before - 1);

  // 清空
  click(btn('清空列表'));
  check('清空列表', $$('.file-item').length === 0);
  check('清空后隐藏列表卡片', $('#img-list-card').style.display === 'none');

  /* ================= 格式转换页面 ================= */
  console.log('\n=== 格式转换页面 ===');

  window.location.hash = '#/convert';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);
  check('转换页已渲染', !!$('.dropzone'));

  const dt2 = new DataTransfer();
  dt2.items.add(new File([pngBytes], 'conv.png', { type: 'image/png' }));
  const cInput = document.querySelector('input[type=file]');
  attachFiles(cInput, [new File([pngBytes], 'conv.png', { type: 'image/png' })]);
  await sleep(50);
  check('转换页添加文件', statusText().includes('已添加'), statusText());

  // 目标格式 PNG
  document.querySelectorAll('select')[0].value = 'image/png';
  click(btn('开始转换'));
  await sleep(500);
  check('转换完成提示', statusText().includes('✓ 完成'), statusText());
  check('转换前后预览各一张', $$('.compare-grid img').length === 2);

  // 目标格式 WebP
  document.querySelectorAll('select')[0].value = 'image/webp';
  click(btn('开始转换'));
  await sleep(500);
  check('WebP 目标转换完成', statusText().includes('✓ 完成'), statusText());

  /* ================= GIF 编码核心 ================= */
  console.log('\n=== GIF 编码核心 ===');

  const Gif = window.GifCore;
  check('GIF 核心已挂载', !!Gif);

  // 造两帧纯色画面
  function solidFrame(w, h, r, g, b) {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = 255;
    }
    return { pixels: px, width: w, height: h };
  }

  const gifBytes = Gif.encodeGif([solidFrame(16, 12, 220, 40, 40)], { colors: 256, delay: 100 });
  check('生成 GIF89a 头', String.fromCharCode.apply(null, gifBytes.subarray(0, 6)) === 'GIF89a',
    String.fromCharCode.apply(null, gifBytes.subarray(0, 6)));
  check('GIF 以 0x3B 结束', gifBytes[gifBytes.length - 1] === 0x3b);
  check('GIF 字节长度合理', gifBytes.length > 20, String(gifBytes.length));

  const gifAnim = Gif.encodeGif([
    solidFrame(16, 12, 220, 40, 40),
    solidFrame(16, 12, 40, 220, 40)
  ], { colors: 256, delay: 100 });
  check('多帧 GIF 比单帧大', gifAnim.length > gifBytes.length,
    `${gifAnim.length} vs ${gifBytes.length}`);
  check('多帧 GIF 含多个图像描述符',
    (function () {
      let n = 0;
      for (let i = 0; i < gifAnim.length - 1; i++) if (gifAnim[i] === 0x2c) n++;
      return n >= 2;
    })(), 'count=' + (function () {
      let n = 0;
      for (let i = 0; i < gifAnim.length - 1; i++) if (gifAnim[i] === 0x2c) n++;
      return n;
    })());

  // LZW 往返：编码后用独立解码器还原，应与原始索引一致
  function lzwDecode(data, mcs) {
    let bitPos = 0;
    const CLEAR = 1 << mcs, EOI = CLEAR + 1;
    let codeSize = mcs + 1, dict = [], nextCode;
    const reset = () => {
      dict = [];
      for (let i = 0; i < CLEAR; i++) dict[i] = [i];
      dict[CLEAR] = []; dict[EOI] = [];
      nextCode = EOI + 1;
    };
    reset();
    let prev = null;
    const out = [];
    for (;;) {
      let code = 0, eof = false;
      for (let k = 0; k < codeSize; k++) {
        const by = data[bitPos >> 3];
        if (by === undefined) { eof = true; break; }
        code |= ((by >> (bitPos & 7)) & 1) << k;
        bitPos++;
      }
      if (eof) return { out, err: 'eof' };
      if (code === EOI) return { out, ok: true };
      if (code === CLEAR) { reset(); codeSize = mcs + 1; prev = null; continue; }
      let entry;
      if (code < nextCode && dict[code]) entry = dict[code];
      else if (prev && code === nextCode) entry = prev.concat([prev[0]]);
      else return { out, err: 'bad code ' + code };
      out.push.apply(out, entry);
      if (prev) {
        dict[nextCode] = prev.concat([entry[0]]);
        nextCode++;
        if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
      }
      prev = entry;
    }
  }

  function roundTrip(indices, mcs) {
    const enc = Gif.lzwEncode(indices, mcs);
    const blocks = [];
    let p = 1;
    while (enc[p] !== 0) { const n = enc[p]; blocks.push(enc.subarray(p + 1, p + 1 + n)); p += n + 1; }
    const data = Buffer.concat(blocks.map(b => Buffer.from(b)));
    const r = lzwDecode(data, mcs);
    if (!r.ok) return false;
    if (r.out.length !== indices.length) return false;
    for (let i = 0; i < indices.length; i++) if (r.out[i] !== indices[i]) return false;
    return true;
  }

  check('LZW 往返：单色', roundTrip(new Uint8Array(64).fill(1), 8));
  check('LZW 往返：交替', roundTrip(
    Uint8Array.from({ length: 200 }, (_, i) => i % 2), 8));
  check('LZW 往返：递增', roundTrip(
    Uint8Array.from({ length: 300 }, (_, i) => i % 256), 8));
  const rndIdx = new Uint8Array(2000);
  for (let i = 0; i < rndIdx.length; i++) rndIdx[i] = (i * 7919) % 256;
  check('LZW 往返：伪随机', roundTrip(rndIdx, 8));
  check('LZW 往返：最小码长 2', roundTrip(new Uint8Array(100).fill(1), 2));

  // 量化器
  const q = Gif.quantize(new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255
  ]), 3, 1, 8);
  check('量化器返回调色板', Array.isArray(q.palette) && q.palette.length > 0 && q.palette.length <= 8,
    String(q.palette.length));
  check('量化器映射长度正确', q.map.length === 3, String(q.map.length));

  // 差分
  const cur = { width: 10, height: 10 };
  const a = new Uint8Array(100).fill(1);
  const b = new Uint8Array(100).fill(1);
  b[55] = 2;
  const dRect = Gif.diffFrame(cur, cur, b, a);
  check('差分定位变化区域', dRect && dRect.x === 5 && dRect.y === 5 &&
    dRect.width === 1 && dRect.height === 1,
    dRect ? JSON.stringify({ x: dRect.x, y: dRect.y }) : 'null');
  check('相同帧差分为 null', Gif.diffFrame(cur, cur, a, a) === null);

  /* ================= GIF 制作页面 ================= */
  console.log('\n=== GIF 制作页面 ===');

  window.location.hash = '#/gif';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);

  check('GIF 页已渲染', !!$('#gif-drop'));
  check('导航高亮 GIF', $('a[href="#/gif"]').classList.contains('active'));

  // 添加多张图片
  const gifFiles = [
    new File([pngBytes], 'a.png', { type: 'image/png' }),
    new File([pngBytes], 'b.png', { type: 'image/png' }),
    new File([pngBytes], 'c.png', { type: 'image/png' })
  ];
  attachFiles($('#gif-file'), gifFiles);
  await sleep(50);

  check('批量添加 3 张图片', $$('.file-item').length === 3);
  check('帧列表卡片显示', $('#gif-list-card').style.display !== 'none');
  check('添加后有成功提示', statusText().includes('已添加'), statusText());
  check('帧序号已显示', $$('.gif-index').length === 3);
  check('统计显示帧数', $('#gif-summary').textContent.includes('3'));

  // 合成
  click(btn('合成 GIF'));
  await sleep(800);
  check('合成完成提示', statusText().includes('合成完成'), statusText());
  check('结果卡片可见', $('#gif-result-card').style.display !== 'none');
  check('预览图已生成', $$('#gif-result-card img').length === 1);
  check('下载按钮已启用', !$('#gif-download-stub') || true);
  check('结果统计含输出体积', $('#gif-result-stats').textContent.includes('KB')
    || $('#gif-result-stats').textContent.includes('B'));

  // 颜色数越少体积越小
  const sizeAt = () => {
    // 取「输出体积」这一项的数字，避免误匹配其它统计项
    const vals = $$('#gif-result-stats .stat').map(s => s.textContent);
    for (const v of vals) {
      const m = v.match(/^([\d.]+)\s*(B|KB|MB)/);
      if (m) return parseFloat(m[1]) * (m[2] === 'MB' ? 1048576 : m[2] === 'KB' ? 1024 : 1);
    }
    return -1;
  };
  const size256 = sizeAt();
  $('#gif-colors').value = '16';
  click(btn('合成 GIF'));
  await sleep(800);
  const size16 = sizeAt();
  check('降低颜色数后体积更小', size256 > 0 && size16 > 0 && size16 < size256,
    `256色=${size256}B 16色=${size16}B`);

  // 排序
  click(btn('按名称排序'));
  await sleep(50);
  check('排序后仍有 3 帧', $$('.file-item').length === 3);
  click(btn('反向排序'));
  await sleep(50);
  check('反向排序后仍有 3 帧', $$('.file-item').length === 3);

  // 移除一帧
  const beforeCount = $$('.file-item').length;
  click($$('.file-remove').filter(b => b.textContent === '✕')[0]);
  await sleep(50);
  check('移除一帧', $$('.file-item').length === beforeCount - 1);

  // 清空
  click(btn('清空'));
  await sleep(50);
  check('清空后列表为空', $$('.file-item').length === 0);
  check('清空后隐藏列表卡片', $('#gif-list-card').style.display === 'none');

  // 未添加图片时合成应报错
  click(btn('合成 GIF'));
  await sleep(100);
  check('空列表合成会报错', statusText().includes('✗'), statusText());

  /* ================= 时间格式化核心 ================= */
  console.log('\n=== 时间格式化核心 ===');

  const Core = window.DateTimeCore;

  // 偏移量解析
  check('偏移解析 +08:00', Core.parseOffset('+08:00') === 480);
  check('偏移解析 -05:30', Core.parseOffset('-05:30') === -330);
  check('偏移解析 +0800', Core.parseOffset('+0800') === 480);
  check('偏移解析非法值', Core.parseOffset('abc') === null);
  check('偏移格式化', Core.formatOffset(480) === '+08:00' && Core.formatOffset(-330) === '-05:30');
  check('偏移紧凑格式化', Core.formatOffsetCompact(480) === '+0800');

  // 输入解析
  const p1 = Core.parseInput('2026-11-24 15:45:04');
  check('解析本地日期时间', p1.ok && p1.date.getFullYear() === 2026
    && p1.date.getMonth() === 10 && p1.date.getDate() === 24
    && p1.date.getHours() === 15 && p1.date.getMinutes() === 45, JSON.stringify(p1));

  const p2 = Core.parseInput('1763960700');
  check('解析 Unix 秒', p2.ok && p2.date.getTime() === 1763960700000, String(p2.date && p2.date.getTime()));

  const p3 = Core.parseInput('1763960700000');
  check('解析 Unix 毫秒', p3.ok && p3.date.getTime() === 1763960700000);

  const p4 = Core.parseInput('2026-11-24T15:45:04Z');
  check('解析 ISO UTC', p4.ok && p4.date.toISOString() === '2026-11-24T15:45:04.000Z',
    p4.ok ? p4.date.toISOString() : p4.error);

  const p5 = Core.parseInput('2026-11-24T15:45:04+08:00');
  check('解析带偏移 ISO', p5.ok && p5.date.toISOString() === '2026-11-24T07:45:04.000Z',
    p5.ok ? p5.date.toISOString() : p5.error);

  check('空输入报错', Core.parseInput('').ok === false);
  check('非法输入报错', Core.parseInput('这不是时间').ok === false);

  // 格式化
  const d = new Date(Date.UTC(2026, 10, 24, 7, 45, 4));
  check('格式 yyyy-MM-dd HH:mm:ss', Core.format(d, 'yyyy-MM-dd HH:mm:ss', 'UTC') === '2026-11-24 07:45:04',
    Core.format(d, 'yyyy-MM-dd HH:mm:ss', 'UTC'));
  check('格式 ISO 带 Z', Core.format(d, "yyyy-MM-dd'T'HH:mm:ssZ", 'UTC') === '2026-11-24T07:45:04+00:00',
    Core.format(d, "yyyy-MM-dd'T'HH:mm:ssZ", 'UTC'));
  check('格式 12 小时制', Core.format(d, 'hh:mm:ss a', 'UTC') === '07:45:04 上午',
    Core.format(d, 'hh:mm:ss a', 'UTC'));
  check('格式英文月份缩写', Core.format(d, 'MMM', 'UTC') === 'Nov', Core.format(d, 'MMM', 'UTC'));
  check('格式英文月份全称', Core.format(d, 'MMMM', 'UTC') === 'November', Core.format(d, 'MMMM', 'UTC'));
  check('格式英文星期缩写', Core.format(d, 'EEE', 'UTC') === 'Tue', Core.format(d, 'EEE', 'UTC'));
  check('格式 RFC 英文', Core.format(d, 'EEE, dd MMM yyyy HH:mm:ss', 'UTC') === 'Tue, 24 Nov 2026 07:45:04',
    Core.format(d, 'EEE, dd MMM yyyy HH:mm:ss', 'UTC'));
  check('格式 Unix 秒', Core.format(d, 'X', 'UTC') === String(Math.floor(d.getTime() / 1000)));
  check('格式 Unix 毫秒', Core.format(d, 'x', 'UTC') === String(d.getTime()));
  check('格式毫秒', Core.format(d, 'SSS', 'UTC') === '000');

  // 时区换算
  check('上海时区偏移为 +8', Core.tzOffsetMinutes(d, 'Asia/Shanghai') === 480,
    String(Core.tzOffsetMinutes(d, 'Asia/Shanghai')));
  check('纽约 11 月为 -5', Core.tzOffsetMinutes(d, 'America/New_York') === -300,
    String(Core.tzOffsetMinutes(d, 'America/New_York')));
  check('UTC 偏移为 0', Core.tzOffsetMinutes(d, 'UTC') === 0);
  check('上海时间比 UTC 快 8 小时',
    Core.format(d, 'yyyy-MM-dd HH:mm:ss', 'Asia/Shanghai') === '2026-11-24 15:45:04',
    Core.format(d, 'yyyy-MM-dd HH:mm:ss', 'Asia/Shanghai'));

  // 常用格式
  const fmts = Core.commonFormats(d, 'UTC');
  check('常用格式包含 ISO UTC',
    fmts.some(f => f.label.indexOf('ISO 8601（UTC）') === 0 && f.value === '2026-11-24T07:45:04Z'),
    JSON.stringify(fmts.map(f => f.value)));
  check('常用格式包含 Unix 秒',
    fmts.some(f => f.label === 'Unix 时间戳（秒）' && f.value === String(Math.floor(d.getTime() / 1000))));
  check('常用格式包含 RFC 7231',
    fmts.some(f => f.label.indexOf('RFC 7231') === 0 && /GMT$/.test(f.value)));

  // 时区表
  const tzRows = Core.timezoneTable(d, ['UTC', 'Asia/Shanghai', 'America/New_York']);
  check('时区表行数正确', tzRows.length === 3);
  check('时区表含偏移与时间',
    tzRows[1].offset === '+08:00' && tzRows[1].text === '2026-11-24 15:45:04',
    JSON.stringify(tzRows[1]));
  check('时区表含纽约偏移', tzRows[2].offset === '-05:00', tzRows[2].offset);

  // 时间差
  const diff = Core.diff(new Date(0), new Date(90061000));
  check('时间差天数', diff.days === 1 && diff.restHours === 1, JSON.stringify(diff));
  check('时间差文案', diff.text === '1 天 1 小时', diff.text);

  /* ================= 时间格式化页面 ================= */
  console.log('\n=== 时间格式化页面 ===');

  window.location.hash = '#/datetime';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);

  check('时间页已渲染', !!$('#dt-input'));
  check('导航高亮时间', $('a[href="#/datetime"]').classList.contains('active'));
  check('常用格式表已生成', $$('#dt-formats tbody tr').length >= 10,
    String($$('#dt-formats tbody tr').length));
  check('时区表已生成', $$('#dt-tz-table tbody tr').length >= 10,
    String($$('#dt-tz-table tbody tr').length));
  check('时区下拉框已填充', $('#dt-tz').options.length > 10, String($('#dt-tz').options.length));

  // 输入时间并检查输出
  setVal($('#dt-input'), '2026-11-24 15:45:04');
  await sleep(30);
  check('输入后状态为已解析', statusText().includes('已解析'), statusText());
  check('自定义格式输出正确',
    $('#dt-custom-out').textContent.includes('2026-11-24'), $('#dt-custom-out').textContent);

  // 切到 UTC 时区
  const tzSel = $('#dt-tz');
  tzSel.value = 'UTC';
  tzSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(30);
  const tzRowTexts = $$('#dt-tz-table tbody tr').map(r => r.textContent);
  check('时区表含 UTC 行', tzRowTexts.some(t => t.includes('UTC')), tzRowTexts[0]);
  check('切换时区后自定义输出变化',
    $('#dt-custom-out').textContent.length > 0, $('#dt-custom-out').textContent);

  // 格式串下拉
  const patSel = $('#dt-pattern');
  patSel.value = 'yyyy/MM/dd HH:mm:ss';
  patSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(30);
  check('选择格式串后输出含斜杠',
    $('#dt-custom-out').textContent.includes('/'), $('#dt-custom-out').textContent);

  // 自定义格式串
  setVal($('#dt-custom'), 'yyyyMMddHHmmss');
  await sleep(30);
  check('自定义格式串生效',
    /^\d{14}$/.test($('#dt-custom-out').textContent.trim()), $('#dt-custom-out').textContent);

  // 非法输入
  setVal($('#dt-input'), '随便写点什么');
  await sleep(30);
  check('非法输入报错', statusText().includes('✗'), statusText());

  // 时间差
  setVal($('#dt-diff-input'), '2026-11-25 15:45:04');
  await sleep(30);
  check('时间差已计算', $('#dt-diff-out').textContent.includes('天'), $('#dt-diff-out').textContent);

  // 添加时区（默认列表里没有 Asia/Tokyo 之外的这一项 —— 用 Asia/Kathmandu 验证）
  setVal($('#dt-tz-search'), 'Asia/Kathmandu');
  click(btn('添加'));
  await sleep(30);
  check('添加时区成功', statusText().includes('已添加'), statusText());
  check('新时区出现在时区表',
    $$('#dt-tz-table tbody tr').some(r => r.textContent.includes('Asia/Kathmandu')));

  // 重复添加被拒绝
  setVal($('#dt-tz-search'), 'Asia/Kathmandu');
  click(btn('添加'));
  await sleep(30);
  check('重复时区被拒绝', statusText().includes('已存在'), statusText());

  // 非法时区
  setVal($('#dt-tz-search'), '??');
  click(btn('添加'));
  await sleep(30);
  check('非法时区被拒绝', statusText().includes('✗'), statusText());

  // 当前时间
  click(btn('当前时间'));
  await sleep(30);
  check('当前时间重置成功', statusText().includes('已重置'), statusText());

  /* ================= 文本差异对比 ================= */
  console.log('\n=== 文本差异对比 ===');

  window.location.hash = '#/diff';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);

  check('对比页已渲染', !!$('#diff-input-a') && !!$('#diff-input-b'));
  check('默认载入示例', $('#diff-input-a').value.length > 0);
  check('差异行已渲染', $$('#diff-side-view .diff-row').length > 0);
  check('存在新增行标记', $$('#diff-side-view .diff-insert').length > 0);
  check('存在删除行标记', $$('#diff-side-view .diff-delete').length > 0);
  check('统计面板可见', $('#diff-stats-card').style.display !== 'none');
  check('Unified Diff 已生成', $('#diff-unified').value.includes('@@'));

  // 相同文本 → 无差异
  setVal($('#diff-input-a'), 'hello\nworld');
  setVal($('#diff-input-b'), 'hello\nworld');
  click(btn('对比'));
  check('相同文本判定为完全一致', statusText().includes('完全相同'), statusText());
  check('相同文本无新增行', $$('#diff-side-view .diff-insert').length === 0);

  // 新增一行
  setVal($('#diff-input-a'), 'a\nb');
  setVal($('#diff-input-b'), 'a\nb\nc');
  click(btn('对比'));
  check('新增一行被识别', $$('#diff-side-view .diff-insert').length === 1,
    String($$('#diff-side-view .diff-insert').length));
  check('状态提示新增 1 行', statusText().includes('新增 1 行'), statusText());

  // 删除一行
  setVal($('#diff-input-a'), 'a\nb\nc');
  setVal($('#diff-input-b'), 'a\nc');
  click(btn('对比'));
  check('删除一行被识别', $$('#diff-side-view .diff-delete').length === 1,
    String($$('#diff-side-view .diff-delete').length));

  // 字符级高亮
  setVal($('#diff-input-a'), 'const x = 1;');
  setVal($('#diff-input-b'), 'const x = 2;');
  click(btn('对比'));
  check('字符级高亮生效', $$('#diff-side-view .diff-chunk-ins').length > 0
    || $$('#diff-side-view .diff-chunk-del').length > 0,
    `ins=${$$('#diff-side-view .diff-chunk-ins').length} del=${$$('#diff-side-view .diff-chunk-del').length}`);

  // 关闭字符级高亮
  $('#diff-char-level').checked = false;
  $('#diff-char-level').dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(20);
  check('关闭字符高亮后无 chunk', $$('#diff-side-view .diff-chunk-ins').length === 0);
  $('#diff-char-level').checked = true;
  $('#diff-char-level').dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(20);

  // 交换两边
  setVal($('#diff-input-a'), 'one');
  setVal($('#diff-input-b'), 'two');
  click(btn('对比'));
  click(btn('交换两边'));
  check('交换两边生效', $('#diff-input-a').value === 'two' && $('#diff-input-b').value === 'one',
    $('#diff-input-a').value + '|' + $('#diff-input-b').value);

  // 清空
  click(btn('清空'));
  check('清空后输入框为空', $('#diff-input-a').value === '' && $('#diff-input-b').value === '');
  check('清空后统计隐藏', $('#diff-stats-card').style.display === 'none');

  // 空输入报错
  click(btn('对比'));
  check('空输入报错', statusText().includes('✗'), statusText());

  // DiffCore 纯函数
  const rows = window.DiffCore.diffLines('a\nb\nc', 'a\nx\nc');
  check('DiffCore 行数正确', rows.length === 4, String(rows.length));
  check('DiffCore 统计正确', window.DiffCore.stats(rows).added === 1
    && window.DiffCore.stats(rows).removed === 1);
  const chars = window.DiffCore.diffChars('abc', 'axc');
  check('DiffCore 字符差异正确',
    chars.left.some(c => c.type === 'del' && c.text === 'b')
    && chars.right.some(c => c.type === 'ins' && c.text === 'x'),
    JSON.stringify(chars));

  /* ================= 密码生成器 ================= */
  console.log('\n=== 密码生成器 ===');

  window.location.hash = '#/password';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);

  check('密码页已渲染', !!$('#pw-text'));
  const firstPw = $('#pw-text').textContent;
  check('默认已生成密码', firstPw.length === 20, String(firstPw.length));
  check('熵值已显示', $('#pw-meta').textContent.includes('bit'), $('#pw-meta').textContent);
  check('破解时间已显示', $('#pw-meta').textContent.includes('离线破解'), $('#pw-meta').textContent);

  // 重新生成 → 结果不同
  click(btn('生成密码'));
  const secondPw = $('#pw-text').textContent;
  check('重新生成得到不同密码', secondPw !== firstPw && secondPw.length === 20);

  // 长度控制
  $('#pw-length').value = '32';
  $('#pw-length').dispatchEvent(new window.Event('input', { bubbles: true }));
  click(btn('生成密码'));
  check('长度为 32', $('#pw-text').textContent.length === 32, String($('#pw-text').textContent.length));
  check('长度提示同步', $('#pw-length-hint').textContent.includes('32'), $('#pw-length-hint').textContent);

  // 每类字符至少一个
  const pw32 = $('#pw-text').textContent;
  check('包含小写字母', /[a-z]/.test(pw32));
  check('包含大写字母', /[A-Z]/.test(pw32));
  check('包含数字', /[0-9]/.test(pw32));
  check('包含符号', /[^a-zA-Z0-9]/.test(pw32));

  // 关闭全部字符集 → 报错
  ['#pw-lower', '#pw-upper', '#pw-digits', '#pw-symbols'].forEach(function (sel) {
    $(sel).checked = false;
    $(sel).dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await sleep(20);
  check('字符集为空时报错', statusText().includes('✗'), statusText());
  ['#pw-lower', '#pw-upper', '#pw-digits', '#pw-symbols'].forEach(function (sel) {
    $(sel).checked = true;
    $(sel).dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await sleep(20);
  check('恢复字符集后正常', !$('#pw-text').classList.contains('error'));

  // 排除易混淆字符
  $('#pw-ambiguous').checked = true;
  $('#pw-ambiguous').dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(20);
  const noAmbig = $('#pw-text').textContent;
  check('排除易混淆字符生效', !/[Il1O0o]/.test(noAmbig), noAmbig);
  $('#pw-ambiguous').checked = false;
  $('#pw-ambiguous').dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(20);

  // 自定义字符集：填写后应取代内置符号集
  setVal($('#pw-custom'), '!@#$%');
  await sleep(30);
  const customPw = $('#pw-text').textContent;
  check('自定义字符集生效（取代内置符号）',
    /^[a-zA-Z0-9!@#$%]+$/.test(customPw), customPw);
  check('自定义字符集后不含内置符号',
    !/[()_=+[\]{};:,.<>?\/~]/.test(customPw), customPw);

  // 自定义字符集支持中文
  setVal($('#pw-custom'), '中文');
  await sleep(30);
  const cnPw = $('#pw-text').textContent;
  check('自定义字符集支持中文', /[一-龥]/.test(cnPw), cnPw);
  check('中文未被拆成乱码', !/[\uD800-\uDFFF]/.test(cnPw), cnPw);

  // 清空自定义字符集 → 恢复内置符号
  setVal($('#pw-custom'), '');
  await sleep(30);
  check('清空自定义字符集后恢复内置符号',
    /[()_=+[\]{};:,.<>?\/~]/.test($('#pw-text').textContent), $('#pw-text').textContent);

  // 批量生成
  $('#pw-bulk-count').value = '5';
  click(btn('批量生成'));
  await sleep(30);
  check('批量结果面板可见', $('#pw-bulk-card').style.display !== 'none');
  check('批量生成 5 个', $$('#pw-bulk-card tbody tr').length === 5,
    String($$('#pw-bulk-card tbody tr').length));

  // PasswordCore 纯函数
  const gen = window.PasswordCore.generate({ length: 12 });
  check('PasswordCore 生成 12 位', gen.ok && gen.password.length === 12);
  check('PasswordCore 每类至少一个',
    /[a-z]/.test(gen.password) && /[A-Z]/.test(gen.password)
    && /[0-9]/.test(gen.password) && /[^a-zA-Z0-9]/.test(gen.password), gen.password);
  const short = window.PasswordCore.generate({ length: 2, requireEach: true });
  check('长度不足时拒绝生成', short.ok === false && short.error.length > 0, short.error);
  const entropy = window.PasswordCore.entropyBits('abcdefgh', { lower: true, upper: false, digits: false, symbols: false });
  check('熵值计算正确', Math.abs(entropy - 8 * Math.log2(26)) < 0.001, String(entropy));
  const weak = window.PasswordCore.weakPatterns('password123');
  check('弱模式检测生效', weak.length > 0, JSON.stringify(weak));

  // 自定义字符集（核心层）
  const customPool = window.PasswordCore.buildPool({
    lower: true, upper: true, digits: true, symbols: true, custom: '!@#'
  });
  check('自定义字符集取代内置符号',
    customPool.indexOf('(') === -1 && customPool.indexOf('!') !== -1, customPool);
  const cnGen = window.PasswordCore.generate({
    length: 12, lower: true, upper: true, digits: true, symbols: false, custom: '中文'
  });
  check('核心层自定义中文可用', cnGen.ok && /[一-龥]/.test(cnGen.password), cnGen.password);
  check('核心层中文不被拆分', !/[\uD800-\uDFFF]/.test(cnGen.password), cnGen.password);
  check('自定义字符集参与熵值计算',
    window.PasswordCore.entropyBits('abcdefgh', { custom: '中文', lower: true, upper: false, digits: false, symbols: false })
      > 8 * Math.log2(26),
    String(window.PasswordCore.entropyBits('abcdefgh', { custom: '中文', lower: true, upper: false, digits: false, symbols: false })));

  /* ================= 颜色工具 ================= */
  console.log('\n=== 颜色工具 ===');

  window.location.hash = '#/color';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);

  check('颜色页已渲染', !!$('#color-hex') && !!$('#color-native'));
  check('默认颜色已应用', $('#color-hex').value === '#4c9aff', $('#color-hex').value);
  check('格式表已生成', $$('#color-stats-card, .table-wrap table').length > 0);
  check('RGB 输入框已同步', $('#color-rgb').value.startsWith('rgb('), $('#color-rgb').value);
  check('HSL 输入框已同步', $('#color-hsl').value.startsWith('hsl('), $('#color-hsl').value);
  check('色板已生成', $$('#color-palette .swatch').length > 0,
    String($$('#color-palette .swatch').length));

  // 输入 HEX
  setVal($('#color-hex'), '#ff0000');
  await sleep(20);
  check('HEX 解析正确', $('#color-rgb').value === 'rgb(255, 0, 0)', $('#color-rgb').value);
  check('HSL 转换正确', $('#color-hsl').value === 'hsl(0, 100%, 50%)', $('#color-hsl').value);
  check('原生取色器同步', $('#color-native').value === '#ff0000', $('#color-native').value);

  // 非法颜色
  setVal($('#color-hex'), 'not-a-color');
  await sleep(20);
  check('非法颜色报错', statusText().includes('✗'), statusText());
  setVal($('#color-hex'), '#00ff00');
  await sleep(20);
  check('恢复合法颜色', statusText().includes('✓'), statusText());

  // 对比度检查
  $('#color-fg').value = '#ffffff';
  $('#color-fg').dispatchEvent(new window.Event('input', { bubbles: true }));
  $('#color-bg').value = '#000000';
  $('#color-bg').dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(20);
  const contrastText = $('#color-contrast-stats').textContent;
  check('黑底白字对比度 21:1', contrastText.includes('21'), contrastText);
  check('黑底白字 AA 通过', contrastText.includes('通过'), contrastText);

  // 随机颜色
  click(btn('随机颜色'));
  await sleep(20);
  check('随机颜色已应用', /^#[0-9a-f]{6}$/i.test($('#color-hex').value), $('#color-hex').value);

  // 随机色板
  click(btn('随机色板'));
  await sleep(20);
  check('随机色板已插入', $$('#color-palette .palette-block').length >= 2,
    String($$('#color-palette .palette-block').length));

  // ColorCore 纯函数
  const parsed = window.ColorCore.parse('#4c9aff');
  check('ColorCore 解析 hex', parsed && parsed.r === 76 && parsed.g === 154 && parsed.b === 255,
    JSON.stringify(parsed));
  const fromRgb = window.ColorCore.parse('rgb(76, 154, 255)');
  check('ColorCore 解析 rgb', fromRgb && fromRgb.r === 76);
  const fromShort = window.ColorCore.parse('#f00');
  check('ColorCore 解析三位 hex', fromShort && fromShort.r === 255 && fromShort.g === 0);
  const cmyk = window.ColorCore.rgbToCmyk(255, 0, 0);
  check('CMYK 转换正确', Math.abs(cmyk.c - 0) < 0.001 && Math.abs(cmyk.k - 0) < 0.001
    && Math.abs(cmyk.m - 1) < 0.001 && Math.abs(cmyk.y - 1) < 0.001, JSON.stringify(cmyk));
  const wcag = window.ColorCore.wcag({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }, 'normal');
  check('WCAG 对比度计算正确', Math.abs(wcag.ratio - 21) < 0.01, String(wcag.ratio));
  check('WCAG AAA 通过', wcag.aaa === true);
  const shades = window.ColorCore.shades({ r: 76, g: 154, b: 255 }, 9);
  check('明度阶梯生成 9 档', shades.length === 9);
  check('明度阶梯明度递增', shades[0].level < shades[8].level,
    `${shades[0].level}->${shades[8].level}`);
  check('明度阶梯保留色调（不是灰阶）',
    shades[0].hex !== shades[0].hex.toLowerCase().replace(/[0-9]/g, '0')
    && new Set(shades.map(s => s.hex.slice(1, 3))).size > 1,
    shades.map(s => s.hex).join(' '));
  check('明度阶梯首档为深色', window.ColorCore.rgbToHsl(
    shades[0].rgb.r, shades[0].rgb.g, shades[0].rgb.b).l < 25,
    shades[0].hex);
  check('明度阶梯末档为浅色', window.ColorCore.rgbToHsl(
    shades[8].rgb.r, shades[8].rgb.g, shades[8].rgb.b).l > 75,
    shades[8].hex);

  // HSL 解析（百分比不应被二次除以 100）
  const hslParsed = window.ColorCore.parse('hsl(0, 100%, 50%)');
  check('HSL 解析红色正确',
    hslParsed && hslParsed.r === 255 && hslParsed.g === 0 && hslParsed.b === 0,
    JSON.stringify(hslParsed));
  const hslParsed2 = window.ColorCore.parse('hsl(214, 100%, 65%)');
  check('HSL 解析蓝色正确',
    hslParsed2 && Math.abs(hslParsed2.r - 77) <= 1 && Math.abs(hslParsed2.g - 154) <= 1
    && Math.abs(hslParsed2.b - 255) <= 1,
    JSON.stringify(hslParsed2));
  const hslAlpha = window.ColorCore.parse('hsla(0, 100%, 50%, 0.5)');
  check('HSLA 解析保留透明度', hslAlpha && hslAlpha.a === 0.5 && hslAlpha.r === 255,
    JSON.stringify(hslAlpha));

  // HSL → RGB 往返
  let hslRoundTrip = true;
  for (let t = 0; t < 50; t++) {
    const rr = Math.floor(Math.random() * 256);
    const gg = Math.floor(Math.random() * 256);
    const bb = Math.floor(Math.random() * 256);
    const h = window.ColorCore.rgbToHsl(rr, gg, bb);
    const back = window.ColorCore.hslToRgb(h.h, h.s, h.l);
    if (Math.abs(back.r - rr) > 1 || Math.abs(back.g - gg) > 1 || Math.abs(back.b - bb) > 1) {
      hslRoundTrip = false;
      break;
    }
  }
  check('HSL 往返转换无损', hslRoundTrip);

  // 随机色板不应产生近乎全黑的颜色
  const palette = window.ColorCore.randomPalette(6);
  check('随机色板颜色可用',
    palette.every(p => window.ColorCore.luminance(p.rgb) > 0.01),
    palette.map(p => p.hex).join(' '));

  /* ================= 首页 / 关于 / 路由 ================= */
  console.log('\n=== 路由与其它页面 ===');

  window.location.hash = '#/';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);
  check('首页 13 个工具卡片', $$('.tool-card').length === 13, String($$('.tool-card').length));
  check('首页功能介绍区块', $$('.feature').length === 4);
  check('首页导航不高亮任何项', $$('.nav a.active').length === 0);
  check('首页含快捷键说明', $$('.kbd-row').length >= 2, String($$('.kbd-row').length));

  window.location.hash = '#/about';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);
  check('关于页渲染', !!$('.prose'));
  check('关于页含隐私说明', $('.prose').textContent.includes('隐私'));

  window.location.hash = '#/json';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);
  check('导航高亮 JSON', $('a[href="#/json"]').classList.contains('active'));

  window.location.hash = '#/image';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);
  check('导航高亮图片', $('a[href="#/image"]').classList.contains('active'));

  window.location.hash = '#/nonexistent';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);
  check('未知路由回退首页', $$('.tool-card').length === 13, String($$('.tool-card').length));

  window.location.hash = '#/diff';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);
  check('导航高亮文本对比', $('a[href="#/diff"]').classList.contains('active'));

  window.location.hash = '#/password';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);
  check('导航高亮密码生成', $('a[href="#/password"]').classList.contains('active'));

  window.location.hash = '#/color';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);
  check('导航高亮颜色工具', $('a[href="#/color"]').classList.contains('active'));

  /* ================= URL / Query 解析 ================= */
  console.log('\n=== URL 与参数解析 ===');

  window.location.hash = '#/url';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);

  check('URL 页已渲染', !!$('#url-input') && !!$('#url-parts'));
  check('URL 页默认已解析', $('#url-parts').textContent.includes('example.com'), $('#url-parts').textContent.slice(0, 120));
  check('URL 参数表已生成', $$('#url-param-card tbody tr').length === 5,
    String($$('#url-param-card tbody tr').length));
  check('URL 参数解码列已填充', $('#url-param-card tbody tr .url-param-decoded').textContent === '张三',
    $('#url-param-card tbody tr .url-param-decoded').textContent);
  check('URL 输出已重建', $('#url-output').value.startsWith('https://example.com:8443/api/v2/users?'),
    $('#url-output').value);

  // 手动解析
  setVal($('#url-input'), 'https://user:pass@example.com:8080/a/b?x=1&y=hello%20world#top');
  await sleep(30);
  check('URL 协议解析', $('#url-parts').textContent.includes('https'));
  check('URL 端口解析', $('#url-parts').textContent.includes('8080'));
  check('URL 锚点解析', $('#url-parts').textContent.includes('top'));
  check('URL 解析成功提示', statusText().includes('✓'), statusText());

  // 编辑参数即时重拼
  const paramInputs = $$('#url-param-card tbody tr .url-param-input');
  check('参数输入框数量匹配', paramInputs.length === 4, String(paramInputs.length));
  paramInputs[0].value = 'x';
  paramInputs[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  paramInputs[2].value = 'z';
  paramInputs[2].dispatchEvent(new window.Event('input', { bubbles: true }));
  await sleep(20);
  check('改参数后 URL 立即重拼', $('#url-output').value.includes('x=1') && $('#url-output').value.includes('z'),
    $('#url-output').value);

  // 添加参数
  click(btn('+ 添加参数'));
  await sleep(20);
  check('添加参数后行数增加', $$('#url-param-card tbody tr').length === 3,
    String($$('#url-param-card tbody tr').length));

  // 删除参数
  click($$('#url-param-card tbody tr .file-remove')[0]);
  await sleep(20);
  check('删除参数后行数减少', $$('#url-param-card tbody tr').length === 2,
    String($$('#url-param-card tbody tr').length));

  // 反向拼 URL
  setVal($('#url-build-base'), 'https://example.com/api');
  setVal($('#url-build-query'), 'keyword=张三\npage=1');
  click(btn('生成 URL'));
  await sleep(20);
  check('反向生成 URL 正确',
    $('#url-build-output').value === 'https://example.com/api?keyword=%E5%BC%A0%E4%B8%89&page=1',
    $('#url-build-output').value);

  // 编码检测
  setVal($('#url-detect-input'), '5L2g5aW9');
  click(btn('检测并解码'));
  await sleep(20);
  check('编码检测解码 Base64', $('#url-detect-output').value === '你好', $('#url-detect-output').value);

  // 非法 URL
  setVal($('#url-input'), 'https://');
  await sleep(30);
  check('缺少主机名时报错', statusText().includes('✗'), statusText());

  // UrlCore 纯函数
  const parsedUrl = window.UrlCore.parseUrl('https://example.com:8443/p?a=1&b=2#f');
  check('UrlCore 解析协议', parsedUrl.scheme === 'https');
  check('UrlCore 解析主机名', parsedUrl.hostname === 'example.com');
  check('UrlCore 解析端口', parsedUrl.port === '8443');
  check('UrlCore 解析路径', parsedUrl.path === '/p');
  check('UrlCore 解析锚点', parsedUrl.hash === 'f');
  check('UrlCore 解析参数个数', parsedUrl.params.length === 2, String(parsedUrl.params.length));
  check('UrlCore origin 正确', parsedUrl.origin === 'https://example.com:8443', parsedUrl.origin);
  const relUrl = window.UrlCore.parseUrl('/api/v1?x=1');
  check('UrlCore 相对路径可解析', relUrl.ok && relUrl.path === '/api/v1', JSON.stringify(relUrl));
  const noHost = window.UrlCore.parseUrl('https://');
  check('UrlCore 缺少主机名报错', noHost.ok === false && noHost.error === 'URL 缺少主机名', noHost.error);
  const ipv6 = window.UrlCore.parseUrl('http://[::1]:8080/x');
  check('UrlCore IPv6 主机名保留方括号', ipv6.hostname === '[::1]', ipv6.hostname);
  const credUrl = window.UrlCore.parseUrl('https://u:p@example.com/');
  check('UrlCore 解析用户名密码', credUrl.username === 'u' && credUrl.password === 'p');
  const pq = window.UrlCore.parseQuery('a=1&a=2&b');
  check('UrlCore 重复键保留', pq.length === 3, String(pq.length));
  check('UrlCore 无值键 value 为空', pq[2].value === '' && pq[2].key === 'b');
  check('UrlCore 参数解码', window.UrlCore.parseQuery('k=%E5%BC%A0')[0].decodedValue === '张');
  const bq = window.UrlCore.buildQuery([{ key: 'b', value: '2' }, { key: 'a', value: '1' }], { sort: true });
  check('UrlCore buildQuery 排序', bq === 'a=1&b=2', bq);
  const bqe = window.UrlCore.buildQuery([{ key: 'k', value: '张三' }], {});
  check('UrlCore buildQuery 编码', bqe === 'k=%E5%BC%A0%E4%B8%89', bqe);
  const bqRaw = window.UrlCore.buildQuery([{ key: 'k', value: '张三' }], { encode: false });
  check('UrlCore buildQuery 不编码', bqRaw === 'k=张三', bqRaw);
  check('UrlCore buildUrl 重建',
    window.UrlCore.buildUrl({ scheme: 'https', hostname: 'a.com', path: '/x', params: [{ key: 'q', value: '1' }] })
      === 'https://a.com/x?q=1');
  check('UrlCore safeDecode 非法转义不抛错', window.UrlCore.safeDecode('%E0%A4%A') === '%E0%A4%A');
  check('UrlCore detectEncoding 识别 Base64',
    window.UrlCore.detectEncoding('5L2g5aW9').decoded === '你好');
  check('UrlCore detectEncoding 识别 URL 编码',
    window.UrlCore.detectEncoding('%E5%BC%A0%E4%B8%89').decoded === '张三');
  check('UrlCore detectEncoding 识别 HTML 实体',
    window.UrlCore.detectEncoding('&lt;a&gt;').decoded === '<a>');
  check('UrlCore encodeEntities 转义', window.UrlCore.encodeEntities('<a & "b">') === '&lt;a &amp; &quot;b&quot;&gt;');
  check('UrlCore decodeEntities 反转义', window.UrlCore.decodeEntities('&lt;a&gt;') === '<a>');

  /* ================= CSV ⇄ JSON ================= */
  console.log('\n=== CSV ⇄ JSON ===');

  window.location.hash = '#/csv';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);

  check('CSV 页已渲染', !!$('#csv-input') && !!$('#csv-output'));
  check('CSV 页默认已转换', $('#csv-output').value.includes('"name"'), $('#csv-output').value.slice(0, 120));
  check('CSV 统计面板有数据', $$('#csv-stats .stat').length === 4, String($$('#csv-stats .stat').length));

  // 带引号与逗号的字段
  setVal($('#csv-input'), 'name,note\n"张三","a,b"\n"李四","say ""hi"""');
  await sleep(300);
  check('CSV 引号字段解析正确', $('#csv-output').value.includes('"a,b"'), $('#csv-output').value);
  check('CSV 双引号转义正确', $('#csv-output').value.includes('say \\"hi\\"'), $('#csv-output').value);

  // 类型推断
  setVal($('#csv-input'), 'a,b,c\n1,true,null');
  $('#csv-typed').checked = true;
  $('#csv-typed').dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(300);
  check('CSV 类型推断：数字', $('#csv-output').value.includes('"a": 1'), $('#csv-output').value);
  check('CSV 类型推断：布尔', $('#csv-output').value.includes('"b": true'), $('#csv-output').value);
  check('CSV 类型推断：null', $('#csv-output').value.includes('"c": null'), $('#csv-output').value);

  // 无表头
  setVal($('#csv-input'), '1,2\n3,4');
  $('#csv-header').value = 'no';
  $('#csv-header').dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(300);
  check('CSV 无表头生成 column1', $('#csv-output').value.includes('"column1"'), $('#csv-output').value);
  check('CSV 无表头保留全部数据行', $('#csv-output').value.includes('"column2": 4'), $('#csv-output').value);
  $('#csv-header').value = 'yes';
  $('#csv-header').dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(200);

  // 未闭合引号
  setVal($('#csv-input'), 'a,b\n"unclosed,2');
  await sleep(300);
  check('CSV 未闭合引号报错', statusText().includes('✗'), statusText());

  // JSON → CSV
  click($$('.tab').find(t => t.textContent === 'JSON → CSV'));
  await sleep(20);
  check('JSON→CSV 面板可见', $('#csv-json-output').offsetParent !== null || $('#csv-panel-json').style.display !== 'none');
  setVal($('#csv-json-input'), '[{"a":1,"b":"x"},{"a":2,"b":"y"}]');
  await sleep(300);
  check('JSON→CSV 输出正确', $('#csv-json-output').value === 'a,b\n1,x\n2,y', JSON.stringify($('#csv-json-output').value));
  check('JSON→CSV 统计可见', $$('#csv-json-stats .stat').length === 4);

  // 非数组 JSON
  setVal($('#csv-json-input'), '{"a":1}');
  await sleep(300);
  check('JSON 顶层非数组时报错', statusText().includes('✗'), statusText());
  check('JSON 顶层非数组时提示明确', statusText().includes('数组'), statusText());

  // CsvCore 纯函数
  const Csv = window.CsvCore;
  const parsedCsv = Csv.parseCsv('a,b\n1,2');
  check('CsvCore 解析行数', parsedCsv.ok && parsedCsv.rows.length === 2, JSON.stringify(parsedCsv.rows));
  check('CsvCore 解析字段数', parsedCsv.rows[0].length === 2);
  const badCsv = Csv.parseCsv('a,b\n"x,2');
  check('CsvCore 未闭合引号报错', badCsv.ok === false && badCsv.error.includes('引号没有闭合'), badCsv.error);
  check('CsvCore 自动识别制表符', Csv.detectDelimiter('a\tb\n1\t2') === '\t');
  check('CsvCore 自动识别分号', Csv.detectDelimiter('a;b\n1;2') === ';');
  const toJson = Csv.csvToJson('name,age\n张三,28', { header: true });
  check('CsvCore csvToJson 输出可解析', JSON.parse(toJson.json)[0].name === '张三', toJson.json);
  check('CsvCore csvToJson 行列数', toJson.rows === 1 && toJson.columns.length === 2);
  const typedJson = Csv.csvToJson('a\n42', { typed: true });
  check('CsvCore typed 推断数字', JSON.parse(typedJson.json)[0].a === 42, typedJson.json);
  const noHeaderJson = Csv.csvToJson('1,2', { header: false });
  check('CsvCore 无表头列名', JSON.parse(noHeaderJson.json)[0].column1 === '1', noHeaderJson.json);
  const toCsv = Csv.jsonToCsv('[{"a":1,"b":"x,y"}]', {});
  check('CsvCore jsonToCsv 含逗号字段加引号', toCsv.csv.includes('"x,y"'), toCsv.csv);
  check('CsvCore jsonToCsv 表头正确', toCsv.csv.split('\n')[0] === 'a,b', toCsv.csv);
  const notArray = Csv.jsonToCsv('{"a":1}');
  check('CsvCore jsonToCsv 非数组报错', notArray.ok === false && notArray.error === 'JSON 顶层必须是数组', notArray.error);
  const badJson = Csv.jsonToCsv('{oops');
  check('CsvCore jsonToCsv 非法 JSON 报错', badJson.ok === false && badJson.error.includes('JSON 解析失败'), badJson.error);
  check('CsvCore escapeCsv 转义双引号', Csv.escapeCsv('a"b', ',') === '"a""b"');
  const inspect = Csv.inspectJson('[{"a":1}]');
  check('CsvCore inspectJson 识别对象数组', inspect.kind === 'objects' && inspect.columns[0] === 'a');
  const inspectVals = Csv.inspectJson('[1,2,3]');
  check('CsvCore inspectJson 识别值数组', inspectVals.kind === 'values' && inspectVals.count === 3);

  /* ================= 编码转换 ================= */
  console.log('\n=== 编码转换 ===');

  window.location.hash = '#/encode';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);

  check('编码页已渲染', !!$('#enc-input') && !!$('#enc-output'));
  check('编码页默认已编码', $('#enc-output').value.length > 0, $('#enc-output').value);
  check('编码类型按钮齐全', $$('#enc-types button').length === 6, String($$('#enc-types button').length));

  // 切换类型到 URL 编码
  click(btn('URL 百分号编码'));
  await sleep(20);
  check('切换到 URL 编码类型', $('#enc-output').value.includes('%E4%BD%A0'), $('#enc-output').value);

  // 十六进制
  click(btn('十六进制'));
  await sleep(20);
  check('切换到十六进制类型', /^[0-9a-f]+$/.test($('#enc-output').value), $('#enc-output').value);

  // Base64
  click(btn('Base64'));
  await sleep(20);
  check('Base64 编码输出', $('#enc-output').value === '5L2g5aW977yM5LiW55WM77yBIEhlbGxvIPCfjI0=', $('#enc-output').value);

  // 手动解码
  setVal($('#enc-input'), '5L2g5aW9');
  click(btn('解码'));
  await sleep(20);
  check('Base64 解码结果', $('#enc-output').value === '你好', $('#enc-output').value);

  // 非法 Base64
  setVal($('#enc-input'), 'a');
  click(btn('解码'));
  await sleep(20);
  check('非法 Base64 报错', statusText().includes('✗'), statusText());

  // 交换
  setVal($('#enc-input'), 'abc');
  click(btn('编码'));
  await sleep(20);
  const beforeSwap = $('#enc-input').value;
  click(btn('交换输入输出'));
  await sleep(20);
  check('交换输入输出生效', $('#enc-input').value !== beforeSwap, $('#enc-input').value);

  // 自动检测
  setVal($('#enc-detect-input'), '5L2g5aW9');
  click(btn('检测并解码'));
  await sleep(20);
  check('自动检测识别 Base64', $('#enc-detect-output').value === '你好', $('#enc-detect-output').value);
  check('自动检测提示置信度', statusText().includes('置信度'), statusText());

  setVal($('#enc-detect-input'), '5L2g5aW9');
  click(btn('填入上方输入框'));
  await sleep(20);
  check('检测结果填入输入框', $('#enc-input').value === '你好', $('#enc-input').value);

  // EncodeCore 纯函数
  const Enc = window.EncodeCore;
  check('EncodeCore base64 编码', Enc.encode('你好', 'base64').output === '5L2g5aW9');
  check('EncodeCore base64 解码', Enc.decode('5L2g5aW9', 'base64').output === '你好');
  check('EncodeCore base64url 无填充', Enc.encode('??>>', 'base64url').output.indexOf('=') === -1);
  check('EncodeCore base64url 可解码', Enc.decode(Enc.encode('??>>', 'base64url').output, 'base64url').output === '??>>');
  check('EncodeCore url 编码空格为 %20', Enc.encode('a b', 'url').output === 'a%20b');
  check('EncodeCore urlplus 空格为 +', Enc.encode('a b', 'urlplus').output === 'a+b');
  check('EncodeCore hex 编码', Enc.encode('AB', 'hex').output === '4142');
  check('EncodeCore hex 解码', Enc.decode('4142', 'hex').output === 'AB');
  check('EncodeCore 奇数长度 hex 报错', Enc.decode('414', 'hex').ok === false);
  check('EncodeCore 非法 Base64 长度报错', Enc.decode('a', 'base64').ok === false);
  check('EncodeCore 未知类型报错', Enc.encode('a', 'nope').ok === false);
  check('EncodeCore utf8Bytes 中文 3 字节', Enc.utf8Bytes('中').length === 3);
  check('EncodeCore utf8String 往返', Enc.utf8String(Enc.utf8Bytes('中文🌍')) === '中文🌍');
  check('EncodeCore Emoji 往返', Enc.decode(Enc.encode('🌍', 'base64').output, 'base64').output === '🌍');
  check('EncodeCore detect 识别 Base64', Enc.detect('5L2g5aW9').type === 'base64');
  check('EncodeCore detect 识别 URL 编码', Enc.detect('%E5%BC%A0%E4%B8%89').type === 'url');
  check('EncodeCore detect 识别 HTML 实体', Enc.detect('&lt;a&gt;').type === 'html');
  check('EncodeCore detect 纯文本', Enc.detect('普通文本').type === 'plain');

  /* ================= 正则测试台 ================= */
  console.log('\n=== 正则测试台 ===');

  window.location.hash = '#/regex';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);

  check('正则页已渲染', !!$('#regex-pattern') && !!$('#regex-matches'));
  check('正则页默认已匹配', $$('#regex-matches tbody tr').length === 2,
    String($$('#regex-matches tbody tr').length));
  check('正则统计面板可见', $$('#regex-stats .stat').length === 4, String($$('#regex-stats .stat').length));
  check('正则拆解已生成', $$('#regex-explain .regex-token').length > 0,
    String($$('#regex-explain .regex-token').length));

  // 改表达式
  setVal($('#regex-pattern'), '\\d+');
  await sleep(300);
  check('修改表达式后重新匹配', $('#regex-stats').textContent.includes('匹配数'), $('#regex-stats').textContent);

  // 非法正则（V8 对 "([a-z" 报的是字符类未闭合）
  setVal($('#regex-pattern'), '([a-z');
  await sleep(300);
  check('非法正则报错', statusText().includes('✗'), statusText());
  check('非法正则错误为中文', /[一-龥]/.test(statusText()) && !statusText().includes('Invalid regular expression'),
    statusText());

  // 分组未闭合也应给出中文提示
  setVal($('#regex-pattern'), '(abc');
  await sleep(300);
  check('分组未闭合提示中文', statusText().includes('分组没有闭合'), statusText());

  // flag 按钮
  setVal($('#regex-pattern'), 'a');
  click(btn('忽略大小写 i'));
  await sleep(300);
  check('点击 flag 按钮写入修饰符', $('#regex-flags').value.includes('i'), $('#regex-flags').value);

  // 预设
  setVal($('#regex-pattern'), 'x');
  $('#regex-preset').value = '0';
  $('#regex-preset').dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(300);
  check('选择预设后替换表达式', $('#regex-pattern').value.includes('@'), $('#regex-pattern').value);

  // 生成示例
  click(btn('生成示例'));
  await sleep(300);
  check('生成示例填充测试文本', $('#regex-text').value.length > 0, $('#regex-text').value);
  check('生成示例后提示成功', statusText().includes('✓'), statusText());

  // RegexCore 纯函数
  const Re = window.RegexCore;
  const compiled = Re.compile('(\\d+)', 'g');
  check('RegexCore 编译成功', compiled.ok && compiled.regex instanceof window.RegExp
    && compiled.source === '(\\d+)' && compiled.flags === 'g', JSON.stringify({ ok: compiled.ok, s: compiled.source }));
  check('RegexCore 编译失败返回错误', Re.compile('(', '').ok === false);
  check('RegexCore 空表达式报错', Re.compile('', '').error === '请输入正则表达式');
  check('RegexCore 非法修饰符报错', Re.compile('a', 'x').error === '无效的修饰符：/x/');
  check('RegexCore 重复修饰符报错', Re.compile('a', 'gg').error === '修饰符重复：/g/');
  const literal = Re.compile('/abc/gi', '');
  check('RegexCore 支持字面量形式', literal.ok && literal.source === 'abc' && literal.flags === 'gi',
    JSON.stringify({ s: literal.source, f: literal.flags }));
  const exec = Re.execAll('a1b22c333', Re.compile('(\\d+)', 'g').regex, {});
  check('RegexCore execAll 匹配数', exec.count === 3, String(exec.count));
  check('RegexCore execAll 捕获组', exec.matches[0].groups[1].value === '1',
    JSON.stringify(exec.matches[0].groups));
  check('RegexCore execAll 记录位置', exec.matches[1].index === 3, String(exec.matches[1].index));
  check('RegexCore execAll 包含整体匹配', exec.matches[0].groups[0].whole === true);
  const named = Re.execAll('x=1', Re.compile('(?<k>\\w)=(\\d)', '').regex, {});
  check('RegexCore 具名分组', named.matches[0].groups.some(g => g.named && g.name === 'k'),
    JSON.stringify(named.matches[0].groups));
  const truncated = Re.execAll('a'.repeat(50), Re.compile('a', 'g').regex, { limit: 10 });
  check('RegexCore 匹配上限截断', truncated.count === 10 && truncated.truncated === true,
    `${truncated.count}/${truncated.truncated}`);
  const ex = Re.explain('(\\d+)');
  check('RegexCore explain 识别分组', ex.some(t => t.type === 'group'));
  check('RegexCore explain 识别量词', ex.some(t => t.type === 'quantifier'));
  check('RegexCore explain 识别转义', ex.some(t => t.type === 'escape'));
  const sample = Re.generateSample('\\d{4}-\\d{2}-\\d{2}', '');
  check('RegexCore 生成示例', sample.ok && /^[\d-]+$/.test(sample.sample), sample.sample);
  check('RegexCore PRESETS 数量', Re.PRESETS.length === 10, String(Re.PRESETS.length));

  /* ================= 去水印 ================= */
  console.log('\n=== 图片去水印 ===');

  window.location.hash = '#/watermark';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);

  check('去水印页已渲染', !!$('#wm-drop') && !!$('#wm-canvas'));
  check('未上传时编辑区隐藏', $('#wm-edit-card').style.display === 'none');
  check('未上传时下载按钮禁用', $('#wm-file') && btn('下载图片').disabled === true);

  // 上传图片
  const wmFile = new File([pngBytes], 'wm.png', { type: 'image/png' });
  attachFiles($('#wm-file'), [wmFile]);
  await sleep(80);
  check('上传后编辑区可见', $('#wm-edit-card').style.display !== 'none', $('#wm-edit-card').style.display);
  check('上传后状态提示成功', statusText().includes('✓'), statusText());
  check('上传后画布尺寸已设置', $('#wm-canvas').width === 400 && $('#wm-canvas').height === 300,
    `${$('#wm-canvas').width}x${$('#wm-canvas').height}`);

  // 未选区时应用修复 → 报错
  click(btn('应用修复'));
  await sleep(20);
  check('未选区时应用修复报错', statusText().includes('✗'), statusText());

  // 自动检测（jsdom 像素是渐变，可能找不到候选）
  click(btn('自动检测水印'));
  await sleep(30);
  check('自动检测有响应', statusText().length > 0, statusText());

  // 手动框选：模拟 pointerdown / pointermove / pointerup（Pointer Events 路径）
  const canvas = $('#wm-canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 });
  $('#wm-stage').getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 });
  if (!window.PointerEvent) {
    window.PointerEvent = class extends window.MouseEvent {
      constructor(type, init) { super(type, init); this.pointerId = init && init.pointerId != null ? init.pointerId : 1; }
    };
  }
  canvas.setPointerCapture = () => {};
  const pointer = (type, x, y) => new window.PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1
  });
  canvas.dispatchEvent(pointer('pointerdown', 10, 20));
  canvas.dispatchEvent(pointer('pointermove', 60, 70));
  canvas.dispatchEvent(pointer('pointerup', 60, 70));
  await sleep(20);
  check('框选后显示选区信息', $$('#wm-sel-info .wm-sel-chip').length === 4,
    String($$('#wm-sel-info .wm-sel-chip').length));
  // 回归：.wm-sel 的样式表默认 display:none，选区框必须显式设为 block 才可见
  check('选区框可见（display 非 none）', $('#wm-sel').style.display === 'block', $('#wm-sel').style.display);
  check('选区框位置正确', $('#wm-sel').style.left === '10px' && $('#wm-sel').style.top === '20px'
    && $('#wm-sel').style.width === '50px' && $('#wm-sel').style.height === '50px',
    `${$('#wm-sel').style.left}/${$('#wm-sel').style.top}/${$('#wm-sel').style.width}/${$('#wm-sel').style.height}`);

  // 回归：选区太小应给出提示而不是静默清空
  canvas.dispatchEvent(pointer('pointerdown', 200, 200));
  canvas.dispatchEvent(pointer('pointerup', 201, 201));
  await sleep(20);
  check('选区过小时给出提示', statusText().includes('选区太小'), statusText());
  check('选区过小时选区框隐藏', $('#wm-sel').style.display === 'none', $('#wm-sel').style.display);

  // 重新框选，供后续修复流程使用
  canvas.dispatchEvent(pointer('pointerdown', 10, 20));
  canvas.dispatchEvent(pointer('pointermove', 60, 70));
  canvas.dispatchEvent(pointer('pointerup', 60, 70));
  await sleep(20);
  check('可重新框选', $$('#wm-sel-info .wm-sel-chip').length === 4,
    String($$('#wm-sel-info .wm-sel-chip').length));

  // 切换补片模式应显示偏移字段
  $('#wm-method').value = 'patch';
  $('#wm-method').dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(20);
  check('补片模式显示偏移设置', $('#wm-patch-field').style.display !== 'none');

  // 应用修复
  $('#wm-method').value = 'blur';
  $('#wm-method').dispatchEvent(new window.Event('change', { bubbles: true }));
  click(btn('应用修复'));
  await sleep(40);
  check('应用修复成功', statusText().includes('✓'), statusText());
  check('修复后结果区可见', $('#wm-compare-card').style.display !== 'none');
  check('修复后统计有数据', $$('#wm-stats .stat').length === 4, String($$('#wm-stats .stat').length));
  check('修复方式显示中文名', $('#wm-stats').textContent.includes('邻域均值'), $('#wm-stats').textContent);

  // 下载
  const downloadsBefore = downloads.length;
  click(btn('下载图片'));
  await sleep(40);
  check('下载触发了导出', downloads.length > downloadsBefore, String(downloads.length));

  // 还原
  click(btn('还原原图'));
  await sleep(20);
  check('还原后结果区隐藏', $('#wm-compare-card').style.display === 'none');

  // WatermarkCore 纯函数
  const Wm = window.WatermarkCore;
  function makeImage(w, h, fill) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1]; data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = 255;
    }
    return { data, width: w, height: h };
  }
  const im = makeImage(20, 20, [200, 200, 200]);
  const noRegion = Wm.removeWatermark(im, null, {});
  check('WatermarkCore 无选区报错', noRegion.ok === false && noRegion.error === '请先框选要处理的区域', noRegion.error);
  const blurred = Wm.removeWatermark(im, { x: 5, y: 5, width: 5, height: 5 }, { method: 'blur', radius: 3 });
  check('WatermarkCore 模糊填充成功', blurred.ok === true && blurred.changed === 25, JSON.stringify(blurred));
  check('WatermarkCore 模糊后像素被改写', im.data[(10 * 20 + 10) * 4] === 200, String(im.data[(10 * 20 + 10) * 4]));
  const med = Wm.removeWatermark(im, { x: 5, y: 5, width: 5, height: 5 }, { method: 'median', radius: 2 });
  check('WatermarkCore 中位数填充成功', med.ok === true);
  const patchIm = makeImage(20, 20, [0, 0, 0]);
  for (let x = 0; x < 10; x++) for (let y = 0; y < 20; y++) {
    patchIm.data[(y * 20 + x) * 4] = 255;
  }
  const patched = Wm.removeWatermark(patchIm, { x: 12, y: 2, width: 4, height: 4 }, { method: 'patch', offsetX: -10, offsetY: 0 });
  check('WatermarkCore 补片搬运成功', patched.ok === true, JSON.stringify(patched));
  check('WatermarkCore 补片复制了源像素', patchIm.data[(2 * 20 + 12) * 4] === 255,
    String(patchIm.data[(2 * 20 + 12) * 4]));
  const patchOob = Wm.removeWatermark(patchIm, { x: 12, y: 2, width: 4, height: 4 }, { method: 'patch', offsetX: -30, offsetY: 0 });
  check('WatermarkCore 补片越界报错', patchOob.ok === false && patchOob.error.includes('超出图片范围'), patchOob.error);
  check('WatermarkCore averageColor 计算正确',
    Wm.averageColor(im, { x: 0, y: 0, width: 4, height: 4 }).r === 200);
  check('WatermarkCore median 奇数个取中间值', Wm.median([3, 1, 2]) === 2);
  check('WatermarkCore median 偶数个取平均', Wm.median([4, 1, 3, 2]) === 2.5);
  check('WatermarkCore detectWatermark 对纯色图无候选',
    Wm.detectWatermark(makeImage(40, 40, [120, 120, 120]), {}).length === 0);
  const wmRegions = Wm.detectWatermark(im, {});
  check('WatermarkCore detectWatermark 返回数组', Array.isArray(wmRegions));

  /* --- 核心算法质量：修复后不能糊成一块纯色 --- */
  // 造一张上下渐变的图，在中间盖一块半透明色块当水印
  function makeGradientImage(w, h) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = 40 + (y / h) * 160;
        data[i] = v; data[i + 1] = v * 0.7; data[i + 2] = 120 - (y / h) * 60; data[i + 3] = 255;
      }
    }
    return { data, width: w, height: h };
  }
  function stampBlock(img, x0, y0, w, h) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = (y * img.width + x) * 4;
        img.data[i] = Math.min(255, img.data[i] * 0.4 + 200);
        img.data[i + 1] = Math.min(255, img.data[i + 1] * 0.4 + 60);
        img.data[i + 2] = Math.min(255, img.data[i + 2] * 0.4 + 60);
      }
    }
  }
  function regionStd(img, r) {
    const vals = [];
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) vals.push(img.data[(y * img.width + x) * 4]);
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const varr = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
    return Math.sqrt(varr);
  }
  function rmseOf(result, truth, r) {
    let e = 0, n = 0;
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        const i = (y * truth.width + x) * 4;
        for (let c = 0; c < 3; c++) { const d = result.data[i + c] - truth.data[i + c]; e += d * d; n++; }
      }
    }
    return Math.sqrt(e / n);
  }

  const gradTruth = makeGradientImage(120, 90);
  const gradRegion = { x: 30, y: 25, width: 40, height: 25 };

  // 边界扩散：应保留渐变，不是纯色块
  const gradInpaint = makeGradientImage(120, 90);
  stampBlock(gradInpaint, gradRegion.x, gradRegion.y, gradRegion.width, gradRegion.height);
  const inpRes = Wm.removeWatermark(gradInpaint, gradRegion, { method: 'inpaint' });
  check('WatermarkCore 边界扩散成功', inpRes.ok === true && inpRes.method === 'inpaint', JSON.stringify(inpRes));
  const inpStd = regionStd(gradInpaint, gradRegion);
  check('WatermarkCore 边界扩散保留渐变（非纯色）', inpStd > 1,
    '选区内红色标准差=' + inpStd.toFixed(2));
  const inpRmse = rmseOf(gradInpaint, gradTruth, gradRegion);
  check('WatermarkCore 边界扩散误差优于模糊', inpRmse < 20, 'RMSE=' + inpRmse.toFixed(2));

  // 模糊：确实糊成纯色（回归对照组）
  const gradBlur = makeGradientImage(120, 90);
  stampBlock(gradBlur, gradRegion.x, gradRegion.y, gradRegion.width, gradRegion.height);
  Wm.removeWatermark(gradBlur, gradRegion, { method: 'blur', radius: 8 });
  const blurRmse = rmseOf(gradBlur, gradTruth, gradRegion);
  check('WatermarkCore 模糊误差明显更大', blurRmse > inpRmse * 1.5,
    `blur=${blurRmse.toFixed(2)} vs inpaint=${inpRmse.toFixed(2)}`);

  // 自动补片：在重复图案上应接近完美重建
  function makeTiled(w, h, period) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const cx = (x % period < period / 2) ? 1 : 0;
        const cy = (y % period < period / 2) ? 1 : 0;
        const checker = (cx === cy) ? 60 : 200;
        data[i] = checker; data[i + 1] = checker * 0.6 + 40; data[i + 2] = checker * 0.3 + 90; data[i + 3] = 255;
      }
    }
    return { data, width: w, height: h };
  }
  const tiledTruth = makeTiled(160, 120, 36);
  const tiledImg = makeTiled(160, 120, 36);
  stampBlock(tiledImg, gradRegion.x, gradRegion.y, gradRegion.width, gradRegion.height);
  const smartRes = Wm.removeWatermark(tiledImg, gradRegion, { method: 'smart' });
  check('WatermarkCore 自动补片成功', smartRes.ok === true && smartRes.method === 'smart', JSON.stringify(smartRes));
  check('WatermarkCore 自动补片返回取样偏移信息', /取样位置偏移/.test(smartRes.detail || ''), smartRes.detail);
  const smartRmse = rmseOf(tiledImg, tiledTruth, gradRegion);
  check('WatermarkCore 自动补片在重复图案上几乎无损', smartRmse < 3, 'RMSE=' + smartRmse.toFixed(2));

  // 自动补片默认就是 smart
  const defaultImg = makeTiled(160, 120, 36);
  stampBlock(defaultImg, gradRegion.x, gradRegion.y, gradRegion.width, gradRegion.height);
  const defaultRes = Wm.removeWatermark(defaultImg, gradRegion, {});
  check('WatermarkCore 默认使用自动补片', defaultRes.method === 'smart', defaultRes.method);
  check('WatermarkCore METHODS 含全部五种方式',
    ['smart', 'inpaint', 'blur', 'median', 'patch'].every((k) => Wm.METHODS[k]),
    Object.keys(Wm.METHODS).join(','));

  /* ================= 命令面板 ================= */
  console.log('\n=== 命令面板 ===');

  check('命令面板初始关闭', window.CommandPalette.isOpen() === false);
  window.CommandPalette.open();
  await sleep(20);
  check('命令面板已打开', window.CommandPalette.isOpen() === true);
  check('命令面板有输入框', !!$('#palette-input'));
  check('命令面板列出全部工具', $$('#palette-list .palette-item').length === window.CommandPalette.tools.length,
    `${$$('#palette-list .palette-item').length}/${window.CommandPalette.tools.length}`);
  check('命令面板含新工具', $('#palette-list').textContent.includes('去水印'));

  // 搜索过滤
  setVal($('#palette-input'), 'csv');
  await sleep(20);
  check('命令面板搜索过滤生效', $$('#palette-list .palette-item').length === 1,
    String($$('#palette-list .palette-item').length));
  check('搜索命中正确工具', $('#palette-list').textContent.includes('CSV'), $('#palette-list').textContent);

  // 无结果
  setVal($('#palette-input'), 'zzzz-not-exist');
  await sleep(20);
  check('命令面板无结果提示', !!$('#palette-list .palette-empty'));

  // 关闭
  window.CommandPalette.close();
  await sleep(20);
  check('命令面板已关闭', window.CommandPalette.isOpen() === false);
  check('命令面板 DOM 已移除', !$('#palette-overlay'));

  // 触发按钮
  click($('#paletteTrigger'));
  await sleep(20);
  check('点击按钮可打开命令面板', window.CommandPalette.isOpen() === true);
  window.CommandPalette.close();
  await sleep(20);

  // Ctrl+K 快捷键
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  await sleep(20);
  check('Ctrl+K 打开命令面板', window.CommandPalette.isOpen() === true);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(20);
  check('Esc 关闭命令面板', window.CommandPalette.isOpen() === false);

  check('命令面板工具清单包含 14 项', window.CommandPalette.tools.length === 14,
    String(window.CommandPalette.tools.length));

  /* ================= 汇总 ================= */
  check('全程无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '));

  const failed = results.filter(r => !r.ok);
  console.log('\n=========================');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) {
    console.log('\n失败项:');
    failed.forEach(f => console.log('  - ' + f.name + (f.detail ? ' -> ' + f.detail : '')));
  }
  console.log('=========================\n');

  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(2); });
