/* ============================================
   音频转换核心测试
   —— 纯 Node 环境跑 audio-core.js 的纯函数部分：
      重采样、声道下混、WAV 字节流、FLAC 字节流、文件名与时长格式化。
   —— 不依赖浏览器的部分全部在这里验证；依赖 Web Audio API 的解码
      路径由 test/dom.test.js 的桩环境覆盖。
   ============================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ->  ' + detail : ''));
}

// ---- 载入 audio-core.js（它挂在 window 上，这里造一个最小 window） ----
const sandbox = {};
sandbox.window = sandbox;
sandbox.Blob = class Blob {
  constructor(parts, opts) {
    this.parts = parts;
    this.type = (opts && opts.type) || '';
    let size = 0;
    for (const p of parts) size += p.byteLength !== undefined ? p.byteLength : p.length;
    this.size = size;
    this._buf = Buffer.concat(parts.map(p => Buffer.from(p.buffer ? p.buffer : p,
      p.byteOffset || 0, p.byteLength !== undefined ? p.byteLength : undefined)));
  }
  async arrayBuffer() {
    return this._buf.buffer.slice(this._buf.byteOffset, this._buf.byteOffset + this._buf.byteLength);
  }
};
global.Blob = sandbox.Blob;

const code = fs.readFileSync(path.join(ROOT, 'assets/js/audio-core.js'), 'utf8');
new Function('window', 'Blob', code)(sandbox, sandbox.Blob);
const Core = sandbox.AudioCore;

(async () => {
  console.log('\n=== 音频转换核心 ===');

  check('AudioCore 已导出', !!Core);
  check('输出格式含 WAV / FLAC / OGG / MP3 / WebM',
    ['audio/wav', 'audio/flac', 'audio/ogg', 'audio/mpeg', 'audio/webm']
      .every(f => !!Core.OUTPUT_FORMATS[f]),
    Object.keys(Core.OUTPUT_FORMATS).join(', '));
  check('采样率选项含 44100 / 48000',
    Core.SAMPLE_RATES.includes(44100) && Core.SAMPLE_RATES.includes(48000));
  check('声道选项含 1 / 2', Core.CHANNEL_COUNTS.includes(1) && Core.CHANNEL_COUNTS.includes(2));

  /* ---------- 文件名 ---------- */
  check('buildFilename 替换扩展名',
    Core.buildFilename('song.mp3', 'wav') === 'song.wav',
    Core.buildFilename('song.mp3', 'wav'));
  check('buildFilename 清理非法字符',
    Core.buildFilename('a/b:c?.mp3', 'wav') === 'a_b_c_.wav',
    Core.buildFilename('a/b:c?.mp3', 'wav'));
  check('buildFilename 无扩展名时原样',
    Core.buildFilename('clip', 'ogg') === 'clip.ogg',
    Core.buildFilename('clip', 'ogg'));

  /* ---------- 扩展名判断 ---------- */
  check('hasExt 识别 .WAV', Core.hasExt('A.WAV', 'wav'));
  check('hasExt 不误判 .wave', !Core.hasExt('A.wav', 'mp3'));
  check('guessExt 取小写扩展名', Core.guessExt('Clip.FLAC') === 'flac', Core.guessExt('Clip.FLAC'));
  check('guessExt 无扩展名返回空串', Core.guessExt('noext') === '');

  /* ---------- 时长 / 采样率格式化 ---------- */
  check('formatDuration 0 秒', Core.formatDuration(0) === '0:00.00', Core.formatDuration(0));
  check('formatDuration 超过 1 分钟',
    Core.formatDuration(65.5) === '1:05.50', Core.formatDuration(65.5));
  check('formatSampleRate 44100 → 44.1 kHz',
    Core.formatSampleRate(44100) === '44.1 kHz', Core.formatSampleRate(44100));

  /* ---------- 声道下混 ---------- */
  const mono = Core.toMono([
    new Float32Array([1, 0, -1]),
    new Float32Array([0, 0, 0])
  ]);
  check('toMono 取平均', mono.length === 1 && mono[0][0] === 0.5 && mono[0][2] === -0.5,
    JSON.stringify(Array.from(mono[0])));
  check('toMono 单声道原样返回', Core.toMono([new Float32Array([0.25])]).length === 1);

  /* ---------- 重采样 ---------- */
  const fakeBuffer = {
    sampleRate: 100,
    length: 5,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array([0, 0.25, 0.5, 0.75, 1])
  };
  const same = Core.resample(fakeBuffer, 100);
  check('同采样率时原样返回',
    same.sampleRate === 100 && same.length === 5 && same.channels[0][3] === 0.75);
  const half = Core.resample(fakeBuffer, 50);
  check('降采样长度减半', half.sampleRate === 50 && half.length === 2, String(half.length));
  check('降采样保留数值', Math.abs(half.channels[0][0] - 0) < 1e-6 &&
    Math.abs(half.channels[0][1] - 0.5) < 1e-6, JSON.stringify(Array.from(half.channels[0])));

  const up = Core.resample(fakeBuffer, 200);
  check('升采样长度加倍', up.length === 10, String(up.length));

  /* ---------- WAV 编码 ---------- */
  const wavAudio = {
    channels: [new Float32Array([0, 1, -1])],
    sampleRate: 8000,
    length: 3
  };
  const wavBlob = Core.encodeWav(wavAudio);
  check('WAV Blob 类型正确', wavBlob.type === 'audio/wav', wavBlob.type);
  check('WAV 长度 = 44 字节头 + 采样数据',
    wavBlob.size === 44 + 3 * 2, String(wavBlob.size));

  const wavBuf = wavBlob._buf;
  check('WAV 头为 RIFF', wavBuf.slice(0, 4).toString() === 'RIFF', wavBuf.slice(0, 4).toString());
  check('WAV 格式为 WAVE', wavBuf.slice(8, 12).toString() === 'WAVE', wavBuf.slice(8, 12).toString());
  check('WAV 含 fmt 块', wavBuf.slice(12, 16).toString() === 'fmt ');
  check('WAV 含 data 块', wavBuf.slice(36, 40).toString() === 'data');
  check('WAV 采样率为 8000', wavBuf.readUInt32LE(24) === 8000, String(wavBuf.readUInt32LE(24)));
  check('WAV 声道数为 1', wavBuf.readUInt16LE(22) === 1, String(wavBuf.readUInt16LE(22)));
  check('WAV 位深为 16', wavBuf.readUInt16LE(34) === 16, String(wavBuf.readUInt16LE(34)));
  check('WAV RIFF 长度字段正确',
    wavBuf.readUInt32LE(4) === wavBlob.size - 8, String(wavBuf.readUInt32LE(4)));
  check('WAV 采样值 0 / +max / -max',
    wavBuf.readInt16LE(44) === 0 && wavBuf.readInt16LE(46) === 32767 &&
    wavBuf.readInt16LE(48) === -32768,
    `${wavBuf.readInt16LE(44)},${wavBuf.readInt16LE(46)},${wavBuf.readInt16LE(48)}`);

  /* ---------- FLAC 编码 ---------- */
  const flacBlob = Core.encodeFlac(wavAudio);
  check('FLAC Blob 类型正确', flacBlob.type === 'audio/flac', flacBlob.type);
  const flacBuf = flacBlob._buf;
  check('FLAC 魔数为 fLaC', flacBuf.slice(0, 4).toString() === 'fLaC', flacBuf.slice(0, 4).toString());
  check('FLAC 首个元数据块为 STREAMINFO',
    (flacBuf[4] & 0x7f) === 0 && flacBuf[5] === 0 && flacBuf[6] === 0 && flacBuf[7] === 0x22,
    `${flacBuf[4]},${flacBuf[5]},${flacBuf[6]},${flacBuf[7]}`);
  check('FLAC STREAMINFO 末块标志为 1', (flacBuf[4] & 0x80) === 0x80);
  // STREAMINFO 从 flacBuf[8] 开始（4 字节魔数 + 4 字节元数据块头）
  const si = flacBuf.slice(8, 42);
  check('FLAC STREAMINFO 块大小为 4096',
    si[0] === 0x10 && si[1] === 0x00 && si[2] === 0x10 && si[3] === 0x00,
    `${si[0]},${si[1]},${si[2]},${si[3]}`);
  // 采样率 20 bit（si 字节 10..12）、声道 3 bit、位深 5 bit、采样点总数 36 bit
  const flacRate = (si[10] << 12) | (si[11] << 4) | (si[12] >> 4);
  const flacCh = ((si[12] >> 1) & 0x07) + 1;
  const flacBps = (((si[12] & 0x01) << 4) | (si[13] >> 4)) + 1;
  const flacSamples = ((si[13] & 0x0f) * 2 ** 32) +
    (si[14] * 2 ** 24) + (si[15] * 2 ** 16) + (si[16] * 2 ** 8) + si[17];
  check('FLAC STREAMINFO 采样率正确', flacRate === 8000, String(flacRate));
  check('FLAC STREAMINFO 声道数正确', flacCh === 1, String(flacCh));
  check('FLAC STREAMINFO 位深为 16', flacBps === 16, String(flacBps));
  check('FLAC STREAMINFO 采样点数正确', flacSamples === 3, String(flacSamples));
  check('FLAC 数据段含帧同步字节', flacBuf[42] === 0xff && flacBuf[43] === 0xf8,
    `${flacBuf[42]},${flacBuf[43]}`);
  // 帧头第 3 字节：高 4 位 = 块长码，低 4 位 = 采样率码
  //   块长码 0b1011 = 字面块长 4096（0b0111 表示「块长存在帧头末尾」，会导致解码器错位）
  //   采样率码 0b0100 = 8 kHz
  check('FLAC 帧头块长码为 0b1011（4096）', (flacBuf[44] >> 4) === 0x0b,
    '0x' + flacBuf[44].toString(16));
  check('FLAC 帧头采样率码为 8kHz', (flacBuf[44] & 0x0f) === 0x04,
    '0x' + flacBuf[44].toString(16));
  check('FLAC 帧头声道/位深字节正确（单声道 + 16bit）',
    flacBuf[45] === 0x08, '0x' + flacBuf[45].toString(16));
  // 帧头 CRC8 必须覆盖帧头到 CRC8 之前的所有字节
  const CRC8_TABLE = (function () {
    const t = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      let crc = i;
      for (let j = 0; j < 8; j++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
      t[i] = crc;
    }
    return t;
  })();
  let crc8 = 0;
  for (let i = 42; i < 47; i++) crc8 = CRC8_TABLE[crc8 ^ flacBuf[i]];
  check('FLAC 帧头 CRC8 校验通过', crc8 === flacBuf[47],
    `calc=${crc8} stored=${flacBuf[47]}`);

  /* ---------- 支持检测 ---------- */
  check('无 MediaRecorder 时 supportsFormat 返回 false',
    Core.supportsFormat('audio/mpeg') === false);
  check('无 AudioContext 时 hasAudioContext 返回 false',
    Core.hasAudioContext() === false);

  /* ---------- 汇总 ---------- */
  const failed = results.filter(r => !r.ok);
  console.log('\n=========================');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) {
    console.log('\n失败项：');
    failed.forEach(f => console.log('  - ' + f.name + (f.detail ? '  ->  ' + f.detail : '')));
  }
  console.log('=========================\n');
  process.exit(failed.length ? 1 : 0);
})();
