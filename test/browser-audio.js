/* 真实浏览器验证：音频格式转换
   —— 生成一段测试 WAV → 页面选择文件 → 转 WAV / FLAC / OGG / MP3 / WebM
   —— 校验输出 blob 类型、体积，以及产出文件能被浏览器再次解码（往返可用）

   注意：Chrome 只带 webm/opus 的 MediaRecorder 编码器，OGG/MP3 是否可用取决于浏览器，
   所以这里按「浏览器支持 → 必须成功」「不支持 → 必须给出明确提示」两套断言。
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

/* 在页面里跑一段代码并取回 JSON 结果 */
function runSnippet(evaluate, body) {
  return evaluate(`
    (async () => {
      try {
        const resp = await fetch('/test/output/tone.wav');
        const buf = await resp.arrayBuffer();
        ${body}
      } catch (e) {
        return { ok: false, err: (e && e.message) || String(e) };
      }
    })()
  `);
}

(async () => {
  console.log('\n=== 真实浏览器音频转换验证 ===');
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
  const wavPath = path.join(OUT, 'tone.wav');
  fs.writeFileSync(wavPath, makeWav(1, 44100, 2));

  await S('Page.navigate', { url: SITE + '/?t=' + Date.now() + '#/audio' });
  await sleep(1800);
  check('音频页加载', await evaluate(`!!document.querySelector('#au-format')`));
  check('输出格式下拉含 5 项', await evaluate(`document.querySelector('#au-format').options.length === 5`),
    await evaluate(`[...document.querySelector('#au-format').options].map(o=>o.value).join(',')`));

  // 选择文件
  const doc = await S('DOM.getDocument');
  const node = await S('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  await S('DOM.setFileInputFiles', { files: [wavPath], nodeId: node.nodeId });
  await sleep(800);
  check('已添加 1 个文件', await evaluate(`document.querySelector('#app .status').textContent.includes('1')`),
    await evaluate(`document.querySelector('#app .status').textContent`));
  check('结果列表可见', await evaluate(`document.querySelector('#au-list-card').style.display !== 'none'`));

  // --- 浏览器能力 ---
  const fmtSupport = await evaluate(`({
    ogg: AudioCore.supportsFormat('audio/ogg;codecs=opus'),
    mp3: AudioCore.supportsFormat('audio/mpeg'),
    webm: AudioCore.supportsFormat('audio/webm;codecs=opus'),
    hasCtx: AudioCore.hasAudioContext()
  })`);
  check('浏览器提供 AudioContext', fmtSupport.hasCtx === true, JSON.stringify(fmtSupport));
  check('至少有一种压缩格式可用', fmtSupport.ogg || fmtSupport.mp3 || fmtSupport.webm,
    JSON.stringify(fmtSupport));

  // --- WAV：按目标采样率输出，检查 WAV 头与采样值 ---
  const wavOut = await runSnippet(evaluate, `
    const res = await AudioCore.convert(buf, { format: 'audio/wav', sampleRate: 44100 });
    const ab = await res.blob.arrayBuffer();
    const v = new DataView(ab);
    let peak = 0;
    for (let i = 44; i + 1 < ab.byteLength; i += 2) {
      const s = Math.abs(v.getInt16(i, true));
      if (s > peak) peak = s;
    }
    // 再用浏览器解码一次，确认是合法 WAV
    const ctx = new AudioContext({ sampleRate: 44100 });
    const decoded = await ctx.decodeAudioData(ab.slice(0));
    ctx.close();
    return { ok: true, type: res.blob.type, size: res.blob.size,
             rate: v.getUint32(24, true), ch: v.getUint16(22, true),
             bits: v.getUint16(34, true), peak,
             dur: decoded.duration, durRate: decoded.sampleRate };
  `);
  check('WAV 输出类型正确', wavOut.type === 'audio/wav', wavOut.type);
  check('WAV 输出采样率为 44100', wavOut.rate === 44100, String(wavOut.rate));
  check('WAV 输出为立体声 16bit', wavOut.ch === 2 && wavOut.bits === 16,
    `${wavOut.ch}ch/${wavOut.bits}bit`);
  check('WAV 输出保留波形峰值', wavOut.peak > 15000, String(wavOut.peak));
  check('WAV 输出可被浏览器解码', wavOut.dur > 0.9 && wavOut.dur < 1.1, String(wavOut.dur));

  // --- WAV：不指定采样率时跟随浏览器默认值（Chrome 为 48kHz）---
  const wavDefault = await runSnippet(evaluate, `
    const res = await AudioCore.convert(buf, { format: 'audio/wav' });
    const ab = await res.blob.arrayBuffer();
    const v = new DataView(ab);
    return { ok: true, rate: v.getUint32(24, true), size: res.blob.size };
  `);
  check('WAV 默认输出跟随浏览器采样率',
    wavDefault.rate === (await evaluate(`new AudioContext().sampleRate`)),
    String(wavDefault.rate));

  // --- FLAC ---
  // 注意：Chrome 的 decodeAudioData 不支持 FLAC（FLAC 只走媒体栈的 <audio> 解码器），
  // 所以这里用 <audio> 元素 + blob URL 验证文件可播放。
  const flacOut = await runSnippet(evaluate, `
    const res = await AudioCore.convert(buf, { format: 'audio/flac', sampleRate: 44100 });
    const ab = await res.blob.arrayBuffer();
    const bytes = new Uint8Array(ab);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const si = bytes.subarray(8, 42);
    const streamInfo = {
      minBlock: (si[0] << 8) | si[1],
      maxBlock: (si[2] << 8) | si[3],
      rate: (si[10] << 12) | (si[11] << 4) | (si[12] >> 4),
      channels: ((si[12] >> 1) & 0x07) + 1,
      bps: (((si[12] & 0x01) << 4) | (si[13] >> 4)) + 1
    };
    // 用 <audio> 元素验证可播放
    const url = URL.createObjectURL(res.blob);
    const played = await new Promise((resolve) => {
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.onloadedmetadata = () => resolve({ ok: true, dur: a.duration });
      a.onerror = () => resolve({ ok: false, err: 'code=' + (a.error && a.error.code) });
      a.src = url;
      setTimeout(() => resolve({ ok: false, err: 'timeout' }), 4000);
    });
    URL.revokeObjectURL(url);
    return { ok: true, type: res.blob.type, size: res.blob.size, magic, streamInfo, played };
  `);
  check('FLAC 输出类型正确', flacOut.type === 'audio/flac', flacOut.type);
  check('FLAC 输出魔数为 fLaC', flacOut.magic === 'fLaC', flacOut.magic);
  check('FLAC STREAMINFO 采样率 44100', flacOut.streamInfo.rate === 44100,
    String(flacOut.streamInfo.rate));
  check('FLAC STREAMINFO 声道数 2', flacOut.streamInfo.channels === 2,
    String(flacOut.streamInfo.channels));
  check('FLAC STREAMINFO 位深 16', flacOut.streamInfo.bps === 16,
    String(flacOut.streamInfo.bps));
  check('FLAC STREAMINFO 块大小 4096',
    flacOut.streamInfo.minBlock === 4096 && flacOut.streamInfo.maxBlock === 4096,
    `${flacOut.streamInfo.minBlock}/${flacOut.streamInfo.maxBlock}`);
  check('FLAC 输出可被浏览器播放', flacOut.played.ok === true,
    flacOut.played.err || JSON.stringify(flacOut.played));

  // --- 重采样 + 单声道 ---
  const rsOut = await runSnippet(evaluate, `
    const res = await AudioCore.convert(buf, { format: 'audio/wav', sampleRate: 8000, channels: 1 });
    const ab = await res.blob.arrayBuffer();
    const v = new DataView(ab);
    return { ok: true, rate: v.getUint32(24, true), ch: v.getUint16(22, true), size: res.blob.size };
  `);
  check('重采样到 8kHz 生效', rsOut.rate === 8000, String(rsOut.rate));
  check('转单声道生效', rsOut.ch === 1, String(rsOut.ch));
  check('重采样后体积显著变小', rsOut.size < 50000, String(rsOut.size));

  // --- 压缩格式（OGG / MP3 / WebM）：浏览器支持就必须成功，不支持必须给出明确提示 ---
  for (const [label, mime, supported] of [
    ['OGG', 'audio/ogg', fmtSupport.ogg],
    ['MP3', 'audio/mpeg', fmtSupport.mp3],
    ['WebM', 'audio/webm', fmtSupport.webm]
  ]) {
    const r = await runSnippet(evaluate, `
      const res = await AudioCore.convert(buf, { format: '${mime}' });
      const ab = await res.blob.arrayBuffer();
      let decoded = null, err = '';
      try {
        const ctx = new AudioContext();
        const d = await ctx.decodeAudioData(ab.slice(0));
        decoded = { dur: d.duration, rate: d.sampleRate, ch: d.numberOfChannels };
        ctx.close();
      } catch (e) { err = e.message || String(e); }
      return { ok: true, type: res.blob.type, size: res.blob.size, decoded, err };
    `);
    if (supported) {
      check(label + ' 输出成功', r.ok === true, r.err || `${r.type} ${r.size}`);
      check(label + ' 输出非空', r.size > 0, String(r.size));
      check(label + ' 输出可被浏览器解码', !!r.decoded, r.err || JSON.stringify(r.decoded));
      if (r.decoded) {
        check(label + ' 解码时长正确', r.decoded.dur > 0.8 && r.decoded.dur < 1.3, String(r.decoded.dur));
      }
    } else {
      check(label + ' 不支持时给出明确提示', r.ok === false && /不支持/.test(r.err || ''), r.err);
    }
  }

  // --- 页面上的完整交互：选 FLAC → 开始转换 → 出现下载按钮 ---
  await evaluate(`document.querySelector('#au-format').value='audio/flac'`);
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始转换').click()`);
  await sleep(4000);
  check('页面转换完成', await evaluate(`document.querySelector('#app .status').textContent.includes('✓ 完成')`),
    await evaluate(`document.querySelector('#app .status').textContent`));
  check('结果列表出现下载按钮', await evaluate(`document.querySelectorAll('#au-list .btn-success').length === 1`));
  check('输出文件名为 .flac', await evaluate(`document.querySelector('#au-list .file-meta').textContent.includes('.flac')`),
    await evaluate(`document.querySelector('#au-list .file-meta').textContent`));

  // --- 页面按浏览器能力给出格式提示 ---
  await evaluate(`document.querySelector('#au-format').value='audio/mpeg'`);
  await evaluate(`document.querySelector('#au-format').dispatchEvent(new Event('change'))`);
  await sleep(200);
  check('不支持的压缩格式给出提示',
    await evaluate(`/不支持/.test(document.querySelector('#au-format-hint').textContent)`),
    await evaluate(`document.querySelector('#au-format-hint').textContent`));

  check('全程无 JS 异常', errors.length === 0, errors.join(' | '));

  const failed = results.filter(r => !r.ok);
  console.log('\n=========================');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  failed.forEach(f => console.log('  - ' + f.name + (f.detail ? ' -> ' + f.detail : '')));
  console.log('=========================\n');
  ws.close();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('异常:', e); process.exit(1); });
