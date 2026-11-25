/* 在真实浏览器中验证图片去水印：上传真实 PNG → 框选 → 自动补片 → 校验像素确实被重建 */
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
  console.log('\n=== 真实浏览器图片去水印验证 ===');
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
  await S('DOM.enable');

  async function evaluate(expr) {
    const r = await S('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }

  // 造一张有纹理渐变的 PNG
  const sharp = require('sharp');
  const W = 800, H = 600;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      raw[i] = Math.round(40 + (y / H) * 160 + 25 * Math.sin(x / 30));
      raw[i + 1] = Math.round(60 + (y / H) * 120 + 20 * Math.cos(x / 22));
      raw[i + 2] = Math.round(140 - (y / H) * 80 + 18 * Math.sin((x + y) / 17));
    }
  }
  // 盖一块半透明水印（测试要验证"修复后接近无水印原图"）
  const rx = 300, ry = 220, rw = 160, rh = 90;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const i = (y * W + x) * 3;
      raw[i] = Math.min(255, Math.round(raw[i] * 0.4 + 200));
      raw[i + 1] = Math.min(255, Math.round(raw[i + 1] * 0.4 + 60));
      raw[i + 2] = Math.min(255, Math.round(raw[i + 2] * 0.4 + 60));
    }
  }
  const png = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 9 }).toBuffer();
  fs.mkdirSync(OUT, { recursive: true });
  const pngPath = path.join(OUT, 'wm-input.png');
  fs.writeFileSync(pngPath, png);
  // 无水印的真值图，用于比对修复质量
  const truthRawBuf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const v = 40 + (y / H) * 160 + 25 * Math.sin(x / 30);
      truthRawBuf[i] = Math.round(v);
      truthRawBuf[i + 1] = Math.round(60 + (y / H) * 120 + 20 * Math.cos(x / 22));
      truthRawBuf[i + 2] = Math.round(140 - (y / H) * 80 + 18 * Math.sin((x + y) / 17));
    }
  }
  console.log(`  输入 PNG: ${W}x${H}, ${(png.length / 1024).toFixed(1)} KB（含水印块 ${rw}x${rh}）`);

  await S('Page.navigate', { url: SITE + '/#/watermark' });
  await sleep(1800);

  check('去水印页加载', await evaluate(`!!document.getElementById('wm-drop')`));
  check('默认修复方式是自动补片',
    await evaluate(`document.getElementById('wm-method').value`) === 'smart',
    await evaluate(`document.getElementById('wm-method').value`));

  // 真实选中文件
  const doc = await S('DOM.getDocument');
  const node = await S('DOM.querySelector', {
    nodeId: doc.root.nodeId, selector: '#wm-file'
  });
  await S('DOM.setFileInputFiles', { files: [pngPath], nodeId: node.nodeId });
  await sleep(1200);

  check('图片已载入', await evaluate(`document.getElementById('wm-canvas').width === ${W}`),
    await evaluate(`document.getElementById('wm-canvas').width + 'x' + document.getElementById('wm-canvas').height`));
  check('上传后编辑区可见',
    await evaluate(`document.getElementById('wm-edit-card').style.display !== 'none'`));

  // 在画布上模拟框选（Pointer Events）
  const box = await evaluate(`(() => {
    const r = document.getElementById('wm-canvas').getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  const sx = box.width / W, sy = box.height / H;

  const pointerJs = (type, x, y) => `(() => {
    const c = document.getElementById('wm-canvas');
    const r = c.getBoundingClientRect();
    const ev = new PointerEvent(${JSON.stringify(type)}, {
      bubbles: true, cancelable: true, pointerId: 1,
      clientX: r.left + ${x}, clientY: r.top + ${y}
    });
    c.dispatchEvent(ev);
  })()`;

  await evaluate(pointerJs('pointerdown', rx * sx, ry * sy));
  await evaluate(pointerJs('pointermove', (rx + rw) * sx, (ry + rh) * sy));
  await evaluate(pointerJs('pointerup', (rx + rw) * sx, (ry + rh) * sy));
  await sleep(200);

  check('选区已建立', await evaluate(`document.querySelectorAll('#wm-sel-info .wm-sel-chip').length === 4`),
    await evaluate(`document.getElementById('wm-sel-info').textContent`));
  check('选区框可见',
    await evaluate(`document.getElementById('wm-sel').style.display`) === 'block',
    await evaluate(`document.getElementById('wm-sel').style.display`));

  // 应用修复
  const t0 = Date.now();
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='应用修复').click()`);
  await sleep(1500);
  const elapsed = Date.now() - t0;

  const status = await evaluate(`document.querySelector('#app .status').textContent`);
  check('修复成功', status.includes('✓'), status);
  check('状态里带取样偏移信息', /取样位置偏移/.test(status), status);
  check('修复耗时可接受 (<3s)', elapsed < 3000, elapsed + 'ms');
  check('结果区可见',
    await evaluate(`document.getElementById('wm-compare-card').style.display !== 'none'`));
  const statsText = await evaluate(`document.getElementById('wm-stats').textContent.replace(/\\s+/g,' ')`);
  check('统计显示中文修复方式', statsText.includes('自动补片'), statsText);

  // 校验像素确实被重建：读结果画布对应区域，和"无水印真值"比对
  const compare = await evaluate(`(() => {
    const c = document.getElementById('wm-result');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(${rx}, ${ry}, ${rw}, ${rh}).data;
    let out = [];
    for (let i = 0; i < d.length; i += 4) out.push(d[i], d[i+1], d[i+2]);
    return { pixels: out, w: ${rw}, h: ${rh} };
  })()`);

  let e = 0, n = 0;
  for (let y = 0; y < compare.h; y++) {
    for (let x = 0; x < compare.w; x++) {
      const ti = ((y + ry) * W + (x + rx)) * 3;
      const pi = (y * compare.w + x) * 3;
      for (let c = 0; c < 3; c++) {
        const d = compare.pixels[pi + c] - truthRawBuf[ti + c];
        e += d * d; n++;
      }
    }
  }
  const rmse = Math.sqrt(e / n);
  check('修复后接近无水印原图 (RMSE < 25)', rmse < 25, 'RMSE=' + rmse.toFixed(2));

  // 对照：如果不修复，误差应该明显更大
  let e2 = 0, n2 = 0;
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const ti = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        const d = raw[ti + c] - truthRawBuf[ti + c];
        e2 += d * d; n2++;
      }
    }
  }
  const beforeRmse = Math.sqrt(e2 / n2);
  check('修复显著优于不修复', rmse < beforeRmse * 0.5,
    `修复后=${rmse.toFixed(2)} 不修复=${beforeRmse.toFixed(2)}`);

  check('全程无 JS 异常', errors.length === 0, errors.join(' | '));

  const failed = results.filter(r => !r.ok);
  console.log('\n=========================');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  failed.forEach(f => console.log('  - ' + f.name + (f.detail ? ' -> ' + f.detail : '')));
  console.log('=========================\n');
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('异常:', e); process.exit(1); });
