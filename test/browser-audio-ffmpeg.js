/* 真实浏览器验证：ffmpeg.wasm 编码路径
   —— 加载内置 ffmpeg 引擎 → 把 1 秒 WAV 转成 MP3 / AAC(M4A) / OGG(Vorbis)
   —— 校验输出 blob 类型、文件头魔数、体积，以及产出文件能被浏览器再次解码
   —— 顺带验证「连续多次编码」不会触发 wasm 内存越界（实例重建策略）

   注意：libopus 在 ffmpeg.wasm 单线程 core 里会抛 wasm 内存越界，
   所以本工具不提供 Opus 输出（见 assets/js/audio-ffmpeg.js 的注释）。
*/
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

/* ---- 造一个 1 秒 44.1kHz 立体声 16bit WAV ---- */
function makeWav(seconds = 1, sampleRate = 44100, channels = 2) {
  const frames = Math.floor(seconds * sampleRate);
  const dataSize = frames * channels * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 20000);
    for (let c = 0; c < channels; c++) {
      buf.writeInt16LE(v, 44 + (i * channels + c) * 2);
    }
  }
  return buf;
}

(async () => {
  console.log('\n=== 真实浏览器 ffmpeg 编码验证 ===');
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
  fs.writeFileSync(path.join(OUT, 'tone.wav'), makeWav(1, 44100, 2));

  await S('Page.navigate', { url: SITE + '/?t=' + Date.now() + '#/audio' });
  await sleep(1800);
  check('音频页加载', await evaluate(`!!document.querySelector('#au-format')`));

  // --- 引擎可用性 ---
  const engine = await evaluate(`(async () => {
    const t0 = performance.now();
    try {
      await window.AudioFFmpeg.load();
      return { ok: true, ms: Math.round(performance.now() - t0),
               state: window.AudioFFmpeg.getState(),
               formats: Object.keys(window.AudioFFmpeg.FFMPEG_FORMATS) };
    } catch (e) { return { ok: false, err: (e && e.message) || String(e) }; }
  })()`);
  check('ffmpeg 引擎加载成功', engine.ok === true, engine.err || (engine.ms + 'ms'));
  check('引擎状态为 ready', engine.state === 'ready', engine.state);
  check('引擎支持 MP3 / AAC / OGG',
    ['audio/mpeg', 'audio/aac', 'audio/ogg'].every(k => (engine.formats || []).includes(k)),
    (engine.formats || []).join(','));
  check('引擎不支持 Opus（wasm 内存越界的已知问题）',
    !(engine.formats || []).includes('audio/opus'), (engine.formats || []).join(','));

  // --- formatCapability 走 ffmpeg 分支 ---
  const caps = await evaluate(`({
    mp3: AudioCore.formatCapability('audio/mpeg'),
    aac: AudioCore.formatCapability('audio/aac'),
    wav: AudioCore.formatCapability('audio/wav')
  })`);
  check('MP3 能力判定为 ffmpeg', caps.mp3.ok === true && caps.mp3.via === 'ffmpeg',
    JSON.stringify(caps.mp3));
  check('AAC 能力判定为 ffmpeg', caps.aac.ok === true && caps.aac.via === 'ffmpeg',
    JSON.stringify(caps.aac));
  check('WAV 能力判定为 native', caps.wav.ok === true && caps.wav.via === 'native',
    JSON.stringify(caps.wav));

  // --- 逐格式真实编码 ---
  const cases = [
    { label: 'MP3', mime: 'audio/mpeg', magic: 'ID3', magicLen: 3, ext: 'mp3' },
    // MP4/M4A 是「4 字节长度 + 'ftyp'」开头，所以从第 5 个字节开始比对
    { label: 'AAC/M4A', mime: 'audio/aac', magic: 'ftyp', magicLen: 4, ext: 'm4a', offset: 4 },
    { label: 'OGG(Vorbis)', mime: 'audio/ogg', magic: 'OggS', magicLen: 4, ext: 'ogg' }
  ];
  // 魔数比对：把字节数组转成 ASCII 标记再比（"49 44 33" → "ID3"）
  function magicText(head, offset, len) {
    const bytes = (head || '').split(' ').map(h => parseInt(h, 16));
    return bytes.slice(offset, offset + len)
      .map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.')
      .join('');
  }
  for (const c of cases) {
    const r = await evaluate(`(async () => {
      try {
        const resp = await fetch('/test/output/tone.wav');
        const buf = await resp.arrayBuffer();
        const res = await AudioCore.convert(buf, { format: '${c.mime}', sampleRate: 44100 });
        const ab = await res.blob.arrayBuffer();
        const bytes = new Uint8Array(ab);
        const head = Array.from(bytes.slice(0, 12)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        let decoded = null, err = '';
        try {
          const ctx = new AudioContext();
          const d = await ctx.decodeAudioData(ab.slice(0));
          decoded = { dur: d.duration, rate: d.sampleRate, ch: d.numberOfChannels };
          ctx.close();
        } catch (e) { err = e.message || String(e); }
        return { ok: true, type: res.blob.type, size: res.blob.size, head, via: res.via,
                 dur: res.duration, rate: res.sampleRate, ch: res.channels, decoded, err };
      } catch (e) { return { ok: false, err: (e && e.message) || String(e) }; }
    })()`);
    check(c.label + ' 编码成功', r.ok === true, r.err || (r.size + ' B'));
    check(c.label + ' 输出走 ffmpeg 通道', r.via === 'ffmpeg', r.via);
    check(c.label + ' 文件头正确',
      magicText(r.head, c.offset || 0, c.magicLen || 4) === c.magic,
      magicText(r.head, c.offset || 0, c.magicLen || 4) + ' (' + r.head + ')');
    if (c.offset) {
      // MP4 家族：前 4 字节是 box 长度（big-endian），后面才是 'ftyp'
      const headBytes = (r.head || '').split(' ').map(h => parseInt(h, 16));
      const boxLen = (headBytes[0] << 24) | (headBytes[1] << 16) | (headBytes[2] << 8) | headBytes[3];
      check(c.label + ' 第一个 box 长度为 ftyp 大小',
        boxLen > 16 && boxLen < 40, String(boxLen));
    }
    check(c.label + ' 体积小于原始 WAV', r.size > 0 && r.size < 176444, String(r.size));
    check(c.label + ' 输出可被浏览器解码', !!r.decoded, r.err || JSON.stringify(r.decoded));
    if (r.decoded) {
      check(c.label + ' 解码时长正确', r.decoded.dur > 0.8 && r.decoded.dur < 1.3,
        String(r.decoded.dur));
    }
    check(c.label + ' 引擎回报了采样率与声道', r.rate === 44100 && r.ch === 2,
      `${r.rate}/${r.ch}`);
  }

  // --- 连续多次编码（验证实例重建策略，避免 wasm 内存越界）---
  const many = await evaluate(`(async () => {
    try {
      const resp = await fetch('/test/output/tone.wav');
      const buf = await resp.arrayBuffer();
      const sizes = [];
      for (let i = 0; i < 5; i++) {
        const res = await AudioCore.convert(buf, { format: 'audio/mpeg', sampleRate: 44100 });
        sizes.push(res.blob.size);
      }
      return { ok: true, sizes };
    } catch (e) { return { ok: false, err: (e && e.message) || String(e) }; }
  })()`);
  check('连续 5 次编码全部成功', many.ok === true, many.err || (many.sizes || []).join(','));
  check('连续编码结果稳定', many.ok === true && new Set(many.sizes).size === 1,
    (many.sizes || []).join(','));

  // --- 页面交互：选 MP3 → 开始转换 ---
  await evaluate(`document.querySelector('#au-format').value='audio/mpeg'`);
  await evaluate(`document.querySelector('#au-format').dispatchEvent(new Event('change'))`);
  await sleep(200);
  check('MP3 提示说明需要 ffmpeg 引擎',
    await evaluate(`/ffmpeg/.test(document.querySelector('#au-format-hint').textContent)`),
    await evaluate(`document.querySelector('#au-format-hint').textContent`));
  check('ffmpeg 卡片显示已就绪',
    await evaluate(`/已就绪|已启用/.test(document.querySelector('#au-ffmpeg-state').textContent)`),
    await evaluate(`document.querySelector('#au-ffmpeg-state').textContent`));

  // 选文件 → 转换
  const doc = await S('DOM.getDocument');
  const node = await S('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  await S('DOM.setFileInputFiles', { files: [path.join(OUT, 'tone.wav')], nodeId: node.nodeId });
  await sleep(800);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始转换').click()`);
  await sleep(15000);
  check('页面转换完成', await evaluate(`document.querySelector('#app .status').textContent.includes('✓ 完成')`),
    await evaluate(`document.querySelector('#app .status').textContent`));
  check('输出文件名为 .mp3', await evaluate(`document.querySelector('#au-list .file-meta').textContent.includes('.mp3')`),
    await evaluate(`document.querySelector('#au-list .file-meta').textContent`));

  check('全程无 JS 异常', errors.length === 0, errors.join(' | '));

  const failed = results.filter(r => !r.ok);
  console.log('\n=========================');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  failed.forEach(f => console.log('  - ' + f.name + (f.detail ? ' -> ' + f.detail : '')));
  console.log('=========================\n');
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('异常:', e); process.exit(1); });
