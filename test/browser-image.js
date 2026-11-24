/* 在真实浏览器中验证图片压缩：上传真实 PNG → WebP → 下载结果并校验字节 */
const http = require('http');
const fs = require('fs');
const path = require('path');

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
  console.log('\n=== 真实浏览器图片压缩验证 ===');
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

  // 准备真实 PNG（用 sharp 生成一张大尺寸带噪点的图）
  const sharp = require('sharp');
  const W = 1400, H = 1000;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      raw[i] = Math.round(127 + 127 * Math.sin(x / 40));
      raw[i + 1] = Math.round(127 + 127 * Math.sin(y / 35));
      raw[i + 2] = (x * 7 + y * 3) % 255;
    }
  }
  const png = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 9 }).toBuffer();
  fs.mkdirSync(OUT, { recursive: true });
  const pngPath = path.join(OUT, 'browser-input.png');
  fs.writeFileSync(pngPath, png);
  console.log(`  输入 PNG: ${W}x${H}, ${(png.length / 1024).toFixed(1)} KB`);

  await S('Page.navigate', { url: SITE + '/#/image' });
  await sleep(1800);

  check('图片页加载', await evaluate(`!!document.getElementById('img-drop')`));
  check('浏览器支持 WebP 编码', await evaluate(`ImageCore.supportsFormat('image/webp')`));

  // 通过 CDP 的 DOM.setFileInputFiles 真实选中文件
  const doc = await S('DOM.getDocument');
  const node = await S('DOM.querySelector', {
    nodeId: doc.root.nodeId, selector: '#img-file'
  });
  await S('DOM.setFileInputFiles', { files: [pngPath], nodeId: node.nodeId });
  await sleep(800);

  check('文件已加入列表', await evaluate(`document.querySelectorAll('.file-item').length === 1`));
  check('显示原文件大小', await evaluate(
    `document.querySelector('.file-meta').textContent.includes('KB') || document.querySelector('.file-meta').textContent.includes('MB')`),
    await evaluate(`document.querySelector('.file-meta').textContent`));

  // 执行压缩
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始压缩').click()`);
  await sleep(4000);

  const status = await evaluate(`document.querySelector('#app .status').textContent`);
  check('压缩完成', status.includes('✓ 完成'), status);

  const summary = await evaluate(`document.getElementById('img-summary').textContent`);
  check('统计显示节省比例', /节省\s*\d+%|\d+%/.test(summary), summary.replace(/\s+/g, ' '));
  check('压缩后体积小于原始体积', await evaluate(`
    (() => {
      const t = document.getElementById('img-summary').textContent;
      const m = t.match(/([\\d.]+)\\s*(KB|MB)\\s*原始体积[\\s\\S]*?([\\d.]+)\\s*(KB|MB)\\s*压缩后/);
      if (!m) return false;
      const toBytes = (v, u) => parseFloat(v) * (u === 'MB' ? 1048576 : 1024);
      return toBytes(m[3], m[4]) < toBytes(m[1], m[2]);
    })()
  `), summary.replace(/\s+/g, ' '));

  // 取出实际生成的 Blob 并写盘校验
  const out = await evaluate(`
    (async () => {
      // 从页面上取回压缩结果
      const btn = [...document.querySelectorAll('.file-item .btn-success')][0];
      let captured = null;
      const origCreate = URL.createObjectURL;
      URL.createObjectURL = function(blob) { captured = blob; return origCreate.call(URL, blob); };
      btn.click();
      URL.createObjectURL = origCreate;
      if (!captured) return null;
      const buf = new Uint8Array(await captured.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      return { size: buf.length, type: captured.type, b64: btoa(bin) };
    })()
  `);

  check('产出结果非空', out && out.size > 0, out ? `${out.size} bytes` : 'null');

  if (out) {
    const outPath = path.join(OUT, 'browser-output.webp');
    fs.writeFileSync(outPath, Buffer.from(out.b64, 'base64'));
    check('输出 MIME 为 WebP', out.type === 'image/webp', out.type);

    const meta = await sharp(outPath).metadata();
    check('输出尺寸与原图一致', meta.width === W && meta.height === H, `${meta.width}x${meta.height}`);
    check('输出格式确为 WebP', meta.format === 'webp', meta.format);
    check('输出体积显著小于 PNG', out.size < png.length,
      `${(out.size / 1024).toFixed(1)}KB vs ${(png.length / 1024).toFixed(1)}KB`);
    console.log(`  输出 WebP: ${(out.size / 1024).toFixed(1)} KB (节省 ${Math.round((1 - out.size / png.length) * 100)}%)`);

    // 视觉校验：转成 PNG 与原图比对平均误差
    const [a, b] = await Promise.all([
      sharp(pngPath).raw().toBuffer({ resolveWithObject: true }),
      sharp(outPath).raw().toBuffer({ resolveWithObject: true })
    ]);
    let sum = 0;
    for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i] - b.data[i]);
    const mae = sum / a.data.length;
    check('画质损失在可接受范围 (MAE < 12)', mae < 12, 'MAE=' + mae.toFixed(2));
  }

  // 目标体积模式
  await evaluate(`document.getElementById('img-target').value = '50'`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始压缩').click()`);
  await sleep(4000);
  const targetMeta = await evaluate(`document.querySelector('.file-meta').textContent`);
  check('目标体积模式生效', targetMeta.includes('→'), targetMeta.replace(/\s+/g, ' '));

  // 尺寸限制模式
  await evaluate(`document.getElementById('img-maxw').value = '700'`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始压缩').click()`);
  await sleep(4000);
  const dimMeta = await evaluate(`document.querySelector('.file-meta').textContent`);
  check('尺寸限制生效 (1400→700)', dimMeta.includes('700×500'), dimMeta.replace(/\s+/g, ' '));

  check('全程无 JS 异常', errors.length === 0, errors.join(' | '));

  const failed = results.filter(r => !r.ok);
  console.log('\n=========================');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  failed.forEach(f => console.log('  - ' + f.name + (f.detail ? ' -> ' + f.detail : '')));
  console.log('=========================\n');
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('异常:', e); process.exit(1); });
