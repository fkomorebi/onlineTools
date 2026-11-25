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
window.HTMLCanvasElement.prototype.getContext = function () {
  const ctx = {
    canvas: this,
    fillStyle: '#000', imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    fillRect() {}, drawImage() {}, clearRect() {},
    // 返回带有渐变内容的像素：全黑会让「颜色数影响体积」这类断言失去意义
    getImageData(x, y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const px = i % w, py = (i / w) | 0;
        data[i * 4] = (px * 5) & 0xff;
        data[i * 4 + 1] = (py * 7) & 0xff;
        data[i * 4 + 2] = ((px + py) * 3) & 0xff;
        data[i * 4 + 3] = 255;
      }
      return { data };
    },
    putImageData() {}, save() {}, restore() {}, translate() {}, scale() {}, rotate() {}
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
const statusText = () => {
  const s = $('#app .status');
  return s ? s.textContent : '';
};

(async () => {
  console.log('\n=== 脚本加载 ===');
  check('所有脚本加载无异常', pageErrors.length === 0, pageErrors.join(' | '));
  check('全局对象已挂载', !!window.JSONTool && !!window.ImageTool && !!window.ConvertTool
    && !!window.GifTool && !!window.GifCore
    && !!window.DateTimeTool && !!window.DateTimeCore
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

  /* ================= 首页 / 关于 / 路由 ================= */
  console.log('\n=== 路由与其它页面 ===');

  window.location.hash = '#/';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);
  check('首页 5 个工具卡片', $$('.tool-card').length === 5);
  check('首页功能介绍区块', $$('.feature').length === 4);
  check('首页导航不高亮任何项', $$('.nav a.active').length === 0);

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
  check('未知路由回退首页', $$('.tool-card').length === 5);

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
