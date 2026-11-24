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
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
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

  /* ================= 首页 / 关于 / 路由 ================= */
  console.log('\n=== 路由与其它页面 ===');

  window.location.hash = '#/';
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  await sleep(50);
  check('首页 3 个工具卡片', $$('.tool-card').length === 3);
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
  check('未知路由回退首页', $$('.tool-card').length === 3);

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
