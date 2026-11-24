/* 真实浏览器验证：格式转换（PNG→WebP→PNG 往返、批量、透明通道） */
const http = require('http');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PORT = process.env.CDP_PORT || 9350;
const SITE = process.env.SITE || 'http://127.0.0.1:8080';
const OUT = path.join(__dirname, 'output');

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ->  ' + detail : ''));
}

(async () => {
  console.log('\n=== 真实浏览器格式转换验证 ===');
  const version = await get(`http://127.0.0.1:${PORT}/json/version`);
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let msgId = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  });
  function send(method, params = {}, sessionId) {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Runtime.enable'); await S('Page.enable'); await S('Network.enable');
  await S('Network.setCacheDisabled', { cacheDisabled: true });
  async function evaluate(expr) {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  fs.mkdirSync(OUT, { recursive: true });
  // 造三个测试文件：一个彩色 PNG、一个带透明的 PNG、一个 JPEG
  const png = await sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 80, b: 40 } }
  }).png().toBuffer();
  const alphaPng = await sharp({
    create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 180, b: 120, alpha: 0.45 } }
  }).png().toBuffer();
  const jpg = await sharp({
    create: { width: 600, height: 450, channels: 3, background: { r: 30, g: 90, b: 160 } }
  }).jpeg().toBuffer();

  const p1 = path.join(OUT, 'conv-a.png');
  const p2 = path.join(OUT, 'conv-b-alpha.png');
  const p3 = path.join(OUT, 'conv-c.jpg');
  fs.writeFileSync(p1, png); fs.writeFileSync(p2, alphaPng); fs.writeFileSync(p3, jpg);

  await S('Page.navigate', { url: SITE + '/#/convert' });
  await sleep(1800);
  check('转换页加载', await evaluate(`!!document.querySelector('.dropzone')`));

  // 批量选择 3 个文件
  const doc = await S('DOM.getDocument');
  const node = await S('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  await S('DOM.setFileInputFiles', { files: [p1, p2, p3], nodeId: node.nodeId });
  await sleep(800);
  check('批量选中 3 个文件', await evaluate(`document.querySelector('#app .status').textContent.includes('3')`),
    await evaluate(`document.querySelector('#app .status').textContent`));

  // 转为 WebP
  await evaluate(`document.querySelectorAll('select')[0].value='image/webp'`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始转换').click()`);
  await sleep(4000);
  check('转换完成', await evaluate(`document.querySelector('#app .status').textContent.includes('✓ 完成')`),
    await evaluate(`document.querySelector('#app .status').textContent`));
  check('前后预览各一张', await evaluate(`document.querySelectorAll('.compare-grid img').length === 2`));

  // 取出结果校验
  const out = await evaluate(`
    (async () => {
      let captured = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = function(b){ captured = b; return orig.call(URL, b); };
      [...document.querySelectorAll('.compare-grid img')][1].src && null;
      // 重新触发预览以捕获转换后的 blob
      [...document.querySelectorAll('button')].find(b=>b.textContent==='开始转换').click();
      await new Promise(r=>setTimeout(r,3000));
      URL.createObjectURL = orig;
      if (!captured) return null;
      const buf = new Uint8Array(await captured.arrayBuffer());
      let bin=''; for(let i=0;i<buf.length;i++) bin+=String.fromCharCode(buf[i]);
      return { size: buf.length, type: captured.type, b64: btoa(bin) };
    })()
  `);
  check('产出 WebP blob', out && out.type === 'image/webp', out ? out.type : 'null');
  if (out) {
    const o = path.join(OUT, 'conv-result.webp');
    fs.writeFileSync(o, Buffer.from(out.b64, 'base64'));
    const m = await sharp(o).metadata();
    check('输出为合法 WebP', m.format === 'webp', m.format);
  }

  // 透明通道保留：PNG → PNG
  // 预览区只显示第一张文件，这里直接对带透明的源文件做转换并检查像素
  await evaluate(`document.querySelectorAll('select')[0].value='image/png'`);
  const alphaCheck = await evaluate(`
    (async () => {
      const resp = await fetch('/test/output/conv-b-alpha.png');
      const buf = await resp.arrayBuffer();
      const f = new File([buf], 'alpha.png', {type:'image/png'});
      const res = await ImageCore.process(f, {format:'image/png'});
      const url = URL.createObjectURL(res.blob);
      const img = new Image();
      await new Promise(r=>{img.onload=r;img.onerror=r;img.src=url;});
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(200, 200, 1, 1).data;
      return { a: d[3], r: d[0], g: d[1], b: d[2], w: img.naturalWidth, h: img.naturalHeight };
    })()
  `);
  check('PNG→PNG 保留半透明 (alpha≈115)', alphaCheck.a > 100 && alphaCheck.a < 130,
    JSON.stringify(alphaCheck));
  check('PNG→PNG 保留尺寸', alphaCheck.w === 400 && alphaCheck.h === 400,
    `${alphaCheck.w}x${alphaCheck.h}`);
  check('PNG→PNG 保留颜色', alphaCheck.g > 150 && alphaCheck.b > 90 && alphaCheck.r < 60,
    JSON.stringify(alphaCheck));

  // WebP → PNG 往返
  const rt = await evaluate(`
    (async () => {
      const c = document.createElement('canvas'); c.width=200; c.height=150;
      const x = c.getContext('2d');
      const g = x.createLinearGradient(0,0,200,150);
      g.addColorStop(0,'#f00'); g.addColorStop(1,'#00f');
      x.fillStyle=g; x.fillRect(0,0,200,150);
      const wb = await new Promise(r=>c.toBlob(r,'image/webp',0.9));
      const f = new File([wb],'rt.webp',{type:'image/webp'});
      const res = await ImageCore.process(f, {format:'image/png'});
      return { inType: wb.type, outType: res.blob.type, size: res.blob.size, w: res.width, h: res.height };
    })()
  `);
  check('WebP → PNG 往返成功', rt.outType === 'image/png' && rt.w === 200 && rt.h === 150,
    JSON.stringify(rt));

  // JPEG 转换
  const jpgConv = await evaluate(`
    (async () => {
      const c = document.createElement('canvas'); c.width=300; c.height=200;
      const x = c.getContext('2d'); x.fillStyle='#08f'; x.fillRect(0,0,300,200);
      const jb = await new Promise(r=>c.toBlob(r,'image/jpeg',0.9));
      const f = new File([jb],'t.jpg',{type:'image/jpeg'});
      const res = await ImageCore.process(f, {format:'image/webp', quality:0.85});
      return { outType: res.blob.type, size: res.blob.size };
    })()
  `);
  check('JPEG → WebP 转换成功', jpgConv.outType === 'image/webp' && jpgConv.size > 0,
    JSON.stringify(jpgConv));

  check('全程无 JS 异常', errors.length === 0, errors.join(' | '));

  const failed = results.filter(r => !r.ok);
  console.log('\n=========================');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  failed.forEach(f => console.log('  - ' + f.name + (f.detail ? ' -> ' + f.detail : '')));
  console.log('=========================\n');
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('异常:', e); process.exit(1); });
