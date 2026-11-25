/* 首页导航截图：分类视图 / 搜索视图 / 移动端 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.CDP_PORT || 9350;
const SITE = process.env.SITE || 'http://127.0.0.1:8080';
const OUT = path.join(__dirname, 'shots');

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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

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
  await S('Runtime.enable'); await S('Page.enable'); await S('Network.enable'); await S('DOM.enable');
  await S('Network.setCacheDisabled', { cacheDisabled: true });

  async function evaluate(expr) {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }

  async function shot(name, opts = {}) {
    await S('Emulation.setDeviceMetricsOverride', {
      width: opts.w || 1400, height: opts.h || 1000,
      deviceScaleFactor: 1, mobile: !!opts.mobile
    });
    await S('Page.navigate', { url: SITE + '/' + (opts.hash || '') });
    await sleep(1500);
    if (opts.script) {
      await evaluate(opts.script);
      await sleep(opts.wait || 700);
    }
    const { data } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    console.log('saved', name);
  }

  // 首页全貌（分类分组）
  await shot('01-home');

  // 搜索「图片」
  await shot('01b-home-search', {
    script: `(() => {
      const i = document.getElementById('homeSearch');
      i.value = '图片';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
    wait: 600
  });

  // 分类筛选「开发调试」
  await shot('01c-home-category', {
    script: `(() => {
      [...document.querySelectorAll('#catBar .cat-btn')].find(b => b.getAttribute('data-cat') === 'dev').click();
      return true;
    })()`
  });

  // 移动端
  await shot('10-mobile-home', { w: 390, h: 844, mobile: true });

  console.log('\nJS 异常:', errors.length ? errors.join(' | ') : '无');
  ws.close();
  process.exit(0);
})().catch(e => { console.error('异常:', e); process.exit(1); });
