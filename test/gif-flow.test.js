/* 用 Node 模拟浏览器环境跑通 GIF 页面完整流程（无头浏览器不可用时的替代验证） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, VirtualConsole } = require('jsdom');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ->  ' + detail : ''));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\n=== GIF 页面端到端流程（jsdom + 真实字节校验） ===');

  const virtualConsole = new VirtualConsole();
  const pageErrors = [];
  virtualConsole.on('jsdomError', e => pageErrors.push(e.message));

  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
    url: 'http://localhost/#/gif',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;

  // canvas 桩：drawImage 按图片的"主色"填满画布，模拟真实解码结果
  window.HTMLCanvasElement.prototype.getContext = function () {
    const ctx = {
      canvas: this,
      fillStyle: '#000', imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
      fillRect() {}, clearRect() {},
      drawImage(img) {
        // 把图片的主色记下来，getImageData 时按此填充
        this._lastImage = img;
      },
      getImageData(x, y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4);
        const c = this._lastImage && this._lastImage.__color;
        for (let i = 0; i < w * h; i++) {
          data[i * 4] = c ? c[0] : 0;
          data[i * 4 + 1] = c ? c[1] : 0;
          data[i * 4 + 2] = c ? c[2] : 0;
          data[i * 4 + 3] = 255;
        }
        return { data };
      },
      putImageData() {}, save() {}, restore() {},
      translate() {}, scale() {}, rotate() {}
    };
    return ctx;
  };
  window.scrollTo = function () {};

  // Image 桩：记录图片的主色（由测试注入）
  window.Image = class {
    constructor() {
      Object.defineProperty(this, 'naturalWidth', { get: () => 400, configurable: true });
      Object.defineProperty(this, 'naturalHeight', { get: () => 300, configurable: true });
      this.width = 0; this.height = 0;
    }
    set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
    get src() { return this._src; }
  };

  const blobs = [];
  window.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:' + blobs.length; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { };

  for (const s of ['assets/js/util.js', 'assets/js/gif-core.js', 'assets/js/gif.js', 'assets/js/app.js']) {
    window.eval(fs.readFileSync(path.join(ROOT, s), 'utf8'));
  }

  const doc = window.document;
  const $ = (sel) => doc.querySelector(sel);
  const $$ = (sel) => [...doc.querySelectorAll(sel)];
  const btn = (label) => $$('button').find(b => b.textContent.trim() === label);
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  await sleep(120);
  check('GIF 页已渲染', !!$('#gif-drop'));

  // 造 4 张真实 PNG，并用 sharp 读回主色注入到 Image 桩
  const shades = [[220, 40, 40], [40, 200, 60], [50, 80, 220], [230, 210, 50]];
  const files = [];
  for (let i = 0; i < 4; i++) {
    const png = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: shades[i][0], g: shades[i][1], b: shades[i][2] } }
    }).png().toBuffer();
    const f = path.join(__dirname, 'output', `e2e-src-${i}.png`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, png);
    files.push(new window.File([png], `src-${i}.png`, { type: 'image/png' }));
  }

  // 让 Image 桩按文件名返回对应主色
  const origSrc = Object.getOwnPropertyDescriptor(window.Image.prototype, 'src');
  window.Image = class extends window.Image {
    set src(v) {
      // 通过 blob URL 找回文件
      let idx = blobs.length - 1;
      const blob = blobs[idx];
      const name = blob && blob.__name;
      const i = names.indexOf(name);
      this.__color = shades[i >= 0 ? i : 0];
      origSrc.set.call(this, v);
    }
  };
  const names = files.map(f => f.name);
  // 给 blob 打上名字标记
  const origCreate = window.URL.createObjectURL;
  window.URL.createObjectURL = (b) => { b.__name = b.__name || names[blobs.length]; return origCreate(b); };

  // 注入文件
  const arr = files.slice();
  arr.item = (i) => arr[i] || null;
  Object.defineProperty($('#gif-file'), 'files', { value: arr, configurable: true, writable: true });
  $('#gif-file').dispatchEvent(new window.Event('change'));
  await sleep(150);

  check('批量添加 4 张图片', $$('.file-item').length === 4,
    String($$('.file-item').length));

  // 合成
  click(btn('合成 GIF'));
  await sleep(1200);

  const status = $('#app .status').textContent;
  check('合成完成', status.includes('合成完成'), status);

  // 从结果 blob 取出字节，用 sharp 校验
  const gifBlob = blobs[blobs.length - 1];
  check('产出 image/gif Blob', gifBlob && gifBlob.type === 'image/gif',
    gifBlob ? gifBlob.type : 'null');

  if (gifBlob) {
    const buf = Buffer.from(await gifBlob.arrayBuffer());
    const p = path.join(__dirname, 'output', 'e2e-result.gif');
    fs.writeFileSync(p, buf);

    check('文件头为 GIF89a', buf.slice(0, 6).toString() === 'GIF89a', buf.slice(0, 6).toString());

    const m = await sharp(p, { animated: true }).metadata();
    check('sharp 可解码', m.format === 'gif', m.format);
    check('尺寸为 400×300', m.width === 400 && m.pageHeight === 300, `${m.width}x${m.pageHeight}`);
    check('含 4 帧', m.pages === 4, String(m.pages));
    check('每帧延时 100ms', m.delay && m.delay.every(d => d === 100), JSON.stringify(m.delay));
    check('无限循环', m.loop === 0, String(m.loop));

    const raw = await sharp(p, { animated: true }).raw().toBuffer({ resolveWithObject: true });
    const ps = 400 * 300 * 3;
    let ok = true;
    const detail = [];
    for (let i = 0; i < 4; i++) {
      const o = i * ps;
      const got = [raw.data[o], raw.data[o + 1], raw.data[o + 2]];
      const d = Math.abs(got[0] - shades[i][0]) + Math.abs(got[1] - shades[i][1]) + Math.abs(got[2] - shades[i][2]);
      detail.push(`p${i}:${got.join(',')}(Δ${d})`);
      if (d > 40) ok = false;
    }
    check('各帧颜色与源图一致', ok, detail.join(' '));
  }

  check('全程无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '));

  const failed = results.filter(r => !r.ok);
  console.log('\n=========================');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  failed.forEach(f => console.log('  - ' + f.name + (f.detail ? ' -> ' + f.detail : '')));
  console.log('=========================\n');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(2); });
