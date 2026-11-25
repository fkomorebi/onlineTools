/* 在真实浏览器中验证 GIF 制作：多张真实图片 → 动画 GIF → 下载结果并校验字节 */
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
  console.log('\n=== 真实浏览器 GIF 制作验证 ===');
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
  await S('Runtime.enable');
  await S('Page.enable');
  await S('Network.enable');
  await S('Network.setCacheDisabled', { cacheDisabled: true });

  async function evaluate(expr) {
    const r = await S('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }

  // 造 4 张颜色各异的真实 PNG
  fs.mkdirSync(OUT, { recursive: true });
  const files = [];
  const shades = [
    { r: 220, g: 40, b: 40 }, { r: 40, g: 200, b: 60 },
    { r: 50, g: 80, b: 220 }, { r: 230, g: 210, b: 50 }
  ];
  for (let i = 0; i < shades.length; i++) {
    const s = shades[i];
    const png = await sharp({
      create: { width: 320, height: 240, channels: 3, background: s }
    }).png().toBuffer();
    const f = path.join(OUT, `gif-src-${i}.png`);
    fs.writeFileSync(f, png);
    files.push(f);
  }

  await S('Page.navigate', { url: SITE + '/#/gif' });
  await sleep(1800);

  check('GIF 页加载', await evaluate(`!!document.getElementById('gif-drop')`));
  check('GIF 核心已加载', await evaluate(`typeof GifCore === 'object'`));

  // 真实选中 4 个文件
  const doc = await S('DOM.getDocument');
  const node = await S('DOM.querySelector', {
    nodeId: doc.root.nodeId, selector: '#gif-file'
  });
  await S('DOM.setFileInputFiles', { files, nodeId: node.nodeId });
  await sleep(900);

  check('批量选中 4 个文件', await evaluate(`document.querySelectorAll('.file-item').length === 4`),
    await evaluate(`document.querySelectorAll('.file-item').length`));
  check('帧序号显示', await evaluate(`document.querySelectorAll('.gif-index').length === 4`));

  // 合成
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='合成 GIF').click()`);
  await sleep(6000);

  const status = await evaluate(`document.querySelector('#app .status').textContent`);
  check('合成完成', status.includes('合成完成'), status);
  check('结果卡片可见', await evaluate(`document.getElementById('gif-result-card').style.display !== 'none'`));
  check('预览图已渲染', await evaluate(`document.querySelectorAll('#gif-result-card img').length === 1`));

  // 取出真实生成的 GIF 字节
  const out = await evaluate(`
    (async () => {
      let captured = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = function(b){ captured = b; return orig.call(URL, b); };
      [...document.querySelectorAll('button')].find(b=>b.textContent==='下载 GIF').click();
      URL.createObjectURL = orig;
      if (!captured) return null;
      const buf = new Uint8Array(await captured.arrayBuffer());
      let bin=''; for(let i=0;i<buf.length;i++) bin += String.fromCharCode(buf[i]);
      return { size: buf.length, type: captured.type, b64: btoa(bin) };
    })()
  `);
  check('产出 GIF blob', out && out.type === 'image/gif', out ? out.type : 'null');

  if (out) {
    const gpath = path.join(OUT, 'browser-result.gif');
    fs.writeFileSync(gpath, Buffer.from(out.b64, 'base64'));
    check('文件头为 GIF89a', Buffer.from(out.b64, 'base64').slice(0, 6).toString() === 'GIF89a');

    const m = await sharp(gpath, { animated: true }).metadata();
    check('输出为合法 GIF', m.format === 'gif', m.format);
    check('输出尺寸正确', m.width === 320 && m.pageHeight === 240, `${m.width}x${m.pageHeight}`);
    check('输出含 4 帧', m.pages === 4, String(m.pages));
    check('每帧延时 100ms', m.delay && m.delay.every(d => d === 100), JSON.stringify(m.delay));
    check('无限循环', m.loop === 0, String(m.loop));

    // 逐帧取像素，验证颜色与源图一致
    const raw = await sharp(gpath, { animated: true }).raw().toBuffer({ resolveWithObject: true });
    const ps = 320 * 240 * 3;
    let allOk = true;
    const detail = [];
    for (let p = 0; p < 4; p++) {
      const o = p * ps;
      const got = [raw.data[o], raw.data[o + 1], raw.data[o + 2]];
      const want = [shades[p].r, shades[p].g, shades[p].b];
      const d = Math.abs(got[0] - want[0]) + Math.abs(got[1] - want[1]) + Math.abs(got[2] - want[2]);
      detail.push(`p${p}:${got.join(',')}(Δ${d})`);
      if (d > 40) allOk = false;
    }
    check('各帧颜色与源图一致', allOk, detail.join(' '));
  }

  /* ---------- 压缩：降低颜色数应显著减小体积 ---------- */

  const sizeOf = async () => {
    const t = await evaluate(`document.getElementById('gif-result-stats').textContent`);
    const m = t.match(/([\d.]+)\s*(B|KB|MB)/);
    if (!m) return -1;
    return parseFloat(m[1]) * (m[2] === 'MB' ? 1048576 : m[2] === 'KB' ? 1024 : 1);
  };

  const size256 = await sizeOf();
  await evaluate(`document.getElementById('gif-colors').value = '16'`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='合成 GIF').click()`);
  await sleep(6000);
  const size16 = await sizeOf();
  check('降低颜色数后体积更小', size256 > 0 && size16 > 0 && size16 < size256,
    `256色=${size256}B 16色=${size16}B`);

  /* ---------- 缩小输出尺寸应减小体积 ---------- */

  await evaluate(`document.getElementById('gif-colors').value = '256'`);
  await evaluate(`document.getElementById('gif-width').value = '160'`);
  await evaluate(`document.getElementById('gif-height').value = '120'`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='合成 GIF').click()`);
  await sleep(6000);
  const sizeSmall = await sizeOf();
  check('缩小尺寸后体积更小', sizeSmall > 0 && sizeSmall < size256,
    `320x240=${size256}B 160x120=${sizeSmall}B`);

  const out2 = await evaluate(`
    (async () => {
      let captured = null;
      const orig = URL.createObjectURL;
      URL.createObjectURL = function(b){ captured = b; return orig.call(URL, b); };
      [...document.querySelectorAll('button')].find(b=>b.textContent==='下载 GIF').click();
      URL.createObjectURL = orig;
      if (!captured) return null;
      const buf = new Uint8Array(await captured.arrayBuffer());
      let bin=''; for(let i=0;i<buf.length;i++) bin += String.fromCharCode(buf[i]);
      return { size: buf.length, b64: btoa(bin) };
    })()
  `);
  if (out2) {
    const p2 = path.join(OUT, 'browser-result-small.gif');
    fs.writeFileSync(p2, Buffer.from(out2.b64, 'base64'));
    const m2 = await sharp(p2, { animated: true }).metadata();
    check('缩小后的尺寸正确', m2.width === 160 && m2.pageHeight === 120, `${m2.width}x${m2.pageHeight}`);
    check('缩小后仍是 4 帧', m2.pages === 4, String(m2.pages));
  }

  check('全程无 JS 异常', errors.length === 0, errors.join(' | '));

  const failed = results.filter(r => !r.ok);
  console.log('\n=========================');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  failed.forEach(f => console.log('  - ' + f.name + (f.detail ? ' -> ' + f.detail : '')));
  console.log('=========================\n');
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('异常:', e); process.exit(1); });
