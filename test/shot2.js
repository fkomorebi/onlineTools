/* 最终截图：带真实数据 */
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

  async function shot(name, hash, opts = {}) {
    await S('Emulation.setDeviceMetricsOverride', {
      width: opts.w || 1400, height: opts.h || 1100,
      deviceScaleFactor: 1, mobile: !!opts.mobile
    });
    await S('Page.navigate', { url: SITE + '/' + hash });
    await sleep(1700);
    if (opts.files) {
      const doc = await S('DOM.getDocument');
      const node = await S('DOM.querySelector', {
        nodeId: doc.root.nodeId, selector: opts.files.selector || 'input[type=file]'
      });
      await S('DOM.setFileInputFiles', { files: opts.files.paths, nodeId: node.nodeId });
      await sleep(700);
    }
    if (opts.script) {
      await evaluate(opts.script);
      await sleep(opts.wait || 1500);
    }
    const { data } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(data, 'base64'));
    console.log('saved', name);
  }

  const O = path.join(__dirname, 'output');

  await shot('01-home', '');
  await shot('02-json-tree', '#/json', {
    script: `(() => {
      const ta = document.getElementById('json-input');
      ta.value = JSON.stringify({
        "orderId": "A-2024-8871",
        "customer": { "name": "张三", "tier": "gold", "tags": ["vip", "上海"] },
        "items": [
          { "sku": "TS-001", "name": "设计稿-首页", "qty": 2, "price": 129.5 },
          { "sku": "TS-014", "name": "设计稿-详情页", "qty": 1, "price": 89.0 }
        ],
        "paid": true, "note": null,
        "meta": { "width": 1920, "height": 1080, "format": "png", "sizeMB": 24.8 }
      }, null, 2);
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      [...document.querySelectorAll('button')].find(b=>b.textContent==='格式化').click();
      [...document.querySelectorAll('.tab')].find(t=>t.textContent==='树形视图').click();
      return true;
    })()`
  });
  await shot('03-json-error', '#/json', {
    script: `(() => {
      const ta = document.getElementById('json-input');
      ta.value = '{"name":"test",, "age":30}';
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      [...document.querySelectorAll('button')].find(b=>b.textContent==='格式化').click();
      return true;
    })()`
  });
  await shot('04-json-path', '#/json', {
    script: `(() => {
      const ta = document.getElementById('json-input');
      ta.value = '{"user":{"id":42,"name":"Alice","roles":["admin","dev"]},"active":true}';
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      [...document.querySelectorAll('button')].find(b=>b.textContent==='格式化').click();
      [...document.querySelectorAll('.tab')].find(t=>t.textContent==='路径查询').click();
      const p = document.getElementById('json-path');
      p.value = '$.user.roles[1]';
      p.dispatchEvent(new Event('input',{bubbles:true}));
      [...document.querySelectorAll('button')].find(b=>b.textContent==='查询').click();
      return true;
    })()`
  });
  await shot('05-image-result', '#/image', {
    files: { selector: '#img-file', paths: [path.join(O, 'browser-input.png')] },
    script: `(() => {
      [...document.querySelectorAll('button')].find(b=>b.textContent==='开始压缩').click();
      return true;
    })()`,
    wait: 4000
  });
  await shot('06-convert-result', '#/convert', {
    files: { selector: 'input[type=file]', paths: [path.join(O, 'browser-input.png')] },
    script: `(() => {
      document.querySelectorAll('select')[0].value='image/webp';
      [...document.querySelectorAll('button')].find(b=>b.textContent==='开始转换').click();
      return true;
    })()`,
    wait: 4000
  });
  await shot('07-about', '#/about');
  await shot('08-mobile-home', '', { w: 390, h: 844, mobile: true });
  await shot('09-mobile-image', '#/image', { w: 390, h: 844, mobile: true });

  console.log('\nJS 异常:', errors.length ? errors.join(' | ') : '无');
  ws.close();
  process.exit(0);
})().catch(e => { console.error('异常:', e); process.exit(1); });
