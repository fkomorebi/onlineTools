/* ============================================
   音频转换核心
   —— 解码：Web Audio API（decodeAudioData）
   —— 编码：自研 WAV 写入器 + MediaRecorder 兜底
   —— 全部在浏览器本地完成，文件不离开本机
   ============================================ */
(function (global) {
  'use strict';

  /* ---------------- 常量 ---------------- */

  /** 支持读取的输入类型 */
  const INPUT_TYPES = [
    'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave',
    'audio/mpeg', 'audio/mp3', 'audio/mpeg3',
    'audio/ogg', 'audio/oga', 'audio/opus',
    'audio/flac', 'audio/x-flac',
    'audio/aac', 'audio/mp4', 'audio/x-m4a',
    'audio/webm'
  ];

  /** 固定压缩比格式（无需 MediaRecorder） */
  const LOSSLESS_FORMATS = {
    'audio/wav': { ext: 'wav', label: 'WAV', mime: 'audio/wav' },
    'audio/flac': { ext: 'flac', label: 'FLAC', mime: 'audio/flac' }
  };

  /** 依赖 MediaRecorder 的压缩格式 */
  const COMPRESSED_FORMATS = {
    'audio/ogg': { ext: 'ogg', label: 'OGG', mime: 'audio/ogg;codecs=opus' },
    'audio/mpeg': { ext: 'mp3', label: 'MP3', mime: 'audio/mpeg' },
    'audio/webm': { ext: 'webm', label: 'WebM 音频', mime: 'audio/webm;codecs=opus' }
  };

  /** 全部可选输出格式 */
  const OUTPUT_FORMATS = Object.assign({}, LOSSLESS_FORMATS, COMPRESSED_FORMATS);

  /** 音频 MIME → 文件扩展名（读取时用于推断） */
  const EXT_BY_TYPE = {
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wave': 'wav',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/ogg': 'ogg', 'audio/oga': 'ogg',
    'audio/flac': 'flac', 'audio/x-flac': 'flac',
    'audio/aac': 'aac', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
    'audio/webm': 'weba'
  };

  /** 采样率选项 */
  const SAMPLE_RATES = [8000, 16000, 22050, 32000, 44100, 48000];

  /** 声道数选项 */
  const CHANNEL_COUNTS = [1, 2];

  /* ---------------- 小工具 ---------------- */

  function toArrayBuffer(buf) {
    if (buf instanceof ArrayBuffer) return buf;
    if (buf && buf.buffer instanceof ArrayBuffer) {
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    return buf;
  }

  /** 判断文件名是否以某个扩展名结尾（不区分大小写） */
  function hasExt(name, ext) {
    return new RegExp('\\.' + ext + '$', 'i').test(String(name || ''));
  }

  /** 从文件名推断扩展名 */
  function guessExt(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  /** 输出文件名 */
  function buildFilename(originalName, ext) {
    const base = String(originalName || 'audio').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
    return base + '.' + ext;
  }

  /** 毫秒 → mm:ss.mmm */
  function formatDuration(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
  }

  /** 人性化采样率 */
  function formatSampleRate(hz) {
    const k = (Number(hz) || 0) / 1000;
    return (Math.round(k * 10) / 10) + ' kHz';
  }

  /* ---------------- 解码 ---------------- */

  /** 是否存在可用的 AudioContext */
  function hasAudioContext() {
    return typeof global.AudioContext !== 'undefined' ||
           typeof global.webkitAudioContext !== 'undefined';
  }

  function createContext() {
    const Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) throw new Error('当前浏览器不支持 Web Audio API');
    return new Ctor();
  }

  /**
   * 创建一个 AudioContext，并按目标采样率配置。
   * 浏览器会把 AudioContext 的采样率重采样到硬件/系统默认（常见 48 kHz），
   * 所以解码后必须显式做一次重采样，否则输出采样率会与原文件不一致。
   * @param {number} sampleRate 期望的采样率（0 表示用浏览器默认）
   * @returns {AudioContext}
   */
  function createContextWithRate(sampleRate) {
    const Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) throw new Error('当前浏览器不支持 Web Audio API');
    if (!sampleRate) return new Ctor();
    try {
      return new Ctor({ sampleRate: sampleRate });
    } catch (e) {
      // 老浏览器不支持 sampleRate 选项
      return new Ctor();
    }
  }

  /**
   * 用 Web Audio API 解码音频文件
   * @param {ArrayBuffer} buffer 文件内容
   * @returns {Promise<AudioBuffer>}
   */
  function decode(buffer, sampleRate) {
    const ab = toArrayBuffer(buffer);
    return new Promise(function (resolve, reject) {
      let ctx = null;
      try {
        ctx = createContextWithRate(sampleRate);
      } catch (e) {
        reject(new Error(e.message || '当前浏览器不支持 Web Audio API'));
        return;
      }
      // decodeAudioData 会消耗 ArrayBuffer，复制一份避免影响调用方
      const copy = ab.slice(0);
      const done = function (result) {
        if (ctx && typeof ctx.close === 'function') {
          ctx.close().catch(function () { /* ignore */ });
        }
      };
      const legacy = ctx.decodeAudioData(copy, resolve, function (err) {
        done();
        reject(new Error('解码失败：文件可能已损坏或格式不受支持'));
      });
      if (legacy && typeof legacy.then === 'function') {
        legacy.then(function (result) {
          done();
          resolve(result);
        }, function () {
          done();
          reject(new Error('解码失败：文件可能已损坏或格式不受支持'));
        });
      }
    });
  }

  /**
   * 读取音频基本信息（时长 / 采样率 / 声道）
   * @param {ArrayBuffer} buffer
   * @returns {Promise<{duration:number, sampleRate:number, channels:number}>}
   */
  function inspect(buffer) {
    return decode(buffer).then(function (ab) {
      return {
        duration: ab.duration,
        sampleRate: ab.sampleRate,
        channels: ab.numberOfChannels
      };
    });
  }

  /* ---------------- 重采样 / 声道处理 ---------------- */

  /**
   * 把 AudioBuffer 的采样数据重采样到目标采样率（线性插值）
   * @returns {{channels:Float32Array[], sampleRate:number, length:number}}
   */
  function resample(audioBuffer, targetRate) {
    const srcRate = audioBuffer.sampleRate;
    const srcLen = audioBuffer.length;
    const srcCh = Math.min(audioBuffer.numberOfChannels, 2);
    const src = [];
    for (let c = 0; c < srcCh; c++) src.push(audioBuffer.getChannelData(c));

    if (!targetRate || targetRate === srcRate || srcLen === 0) {
      return { channels: src, sampleRate: srcRate, length: srcLen };
    }

    const ratio = srcRate / targetRate;
    const outLen = Math.max(1, Math.floor(srcLen / ratio));
    const out = [];
    for (let c = 0; c < srcCh; c++) {
      const data = src[c];
      const buf = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const pos = i * ratio;
        const i0 = Math.floor(pos);
        const i1 = Math.min(srcLen - 1, i0 + 1);
        const t = pos - i0;        buf[i] = data[i0] * (1 - t) + data[i1] * t;
      }
      out.push(buf);
    }
    return { channels: out, sampleRate: targetRate, length: outLen };
  }

  /** 多声道 → 单声道（取平均） */
  function toMono(channels) {
    if (channels.length === 1) return channels;
    const len = channels[0].length;
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let sum = 0;
      for (let c = 0; c < channels.length; c++) sum += channels[c][i];
      out[i] = sum / channels.length;
    }
    return [out];
  }

  /* ---------------- WAV 编码 ---------------- */

  function writeAscii(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i) & 0xff);
    return offset + str.length;
  }

  /**
   * 编码 WAV（16-bit PCM）
   * @param {{channels:Float32Array[], sampleRate:number, length:number}} audio
   * @returns {Blob}
   */
  function encodeWav(audio) {
    const chans = audio.channels;
    const numCh = chans.length;
    const sampleRate = audio.sampleRate;
    const frames = audio.length;
    const bytesPerSample = 2;
    const blockAlign = numCh * bytesPerSample;
    const dataSize = frames * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    let off = 0;
    off = writeAscii(view, off, 'RIFF');
    view.setUint32(off, 36 + dataSize, true); off += 4;
    off = writeAscii(view, off, 'WAVE');
    off = writeAscii(view, off, 'fmt ');
    view.setUint32(off, 16, true); off += 4;
    view.setUint16(off, 1, true); off += 2;          // PCM
    view.setUint16(off, numCh, true); off += 2;
    view.setUint32(off, sampleRate, true); off += 4;
    view.setUint32(off, sampleRate * blockAlign, true); off += 4;
    view.setUint16(off, blockAlign, true); off += 2;
    view.setUint16(off, bytesPerSample * 8, true); off += 2;
    off = writeAscii(view, off, 'data');
    view.setUint32(off, dataSize, true); off += 4;

    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = chans[c][i];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  /* ---------------- FLAC 编码（无损子集） ---------------- */

  function writeUint24LE(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    return offset + 3;
  }

  /**
   * 编码 FLAC（无压缩子集：VERBATIM 帧）
   * 采用 STREAMINFO + 每个采样点独立 VERBATIM 帧，体积较大但完全无损且格式合法。
   * @param {{channels:Float32Array[], sampleRate:number, length:number}} audio
   * @returns {Blob}
   */
  function encodeFlac(audio) {
    const chans = audio.channels;
    const numCh = chans.length;
    const sampleRate = audio.sampleRate;
    const frames = audio.length;
    const bitsPerSample = 16;

    // ---- STREAMINFO（34 字节）----
    // 布局：min block(16) max block(16) min frame(24) max frame(24)
    //       sampleRate(20) channels-1(3) bps-1(5) totalSamples(36) md5(128)
    const si = new Uint8Array(34);
    si[0] = 0x10; si[1] = 0x00;   // 最小块大小 4096（0x1000，大端）
    si[2] = 0x10; si[3] = 0x00;   // 最大块大小 4096（0x1000，大端）
    // min/max frame size 留 0（未知）
    si[4] = 0x00; si[5] = 0x00; si[6] = 0x00;
    si[7] = 0x00; si[8] = 0x00; si[9] = 0x00;
    // 采样率 20 bit（跨 3 字节）→ 字节 10/11/12
    si[10] = (sampleRate >>> 12) & 0xff;
    si[11] = (sampleRate >>> 4) & 0xff;
    // 字节 12：高 4 位 = 采样率低 4 位，中 3 位 = channels-1，低 1 位 = bps-1 的最高位
    si[12] = ((sampleRate & 0x0f) << 4) | (((numCh - 1) & 0x07) << 1) | (((bitsPerSample - 1) >> 4) & 0x01);
    // 字节 13：bps-1 的低 4 位（高 4 位）+ totalSamples 的高 4 位（低 4 位）
    si[13] = (((bitsPerSample - 1) & 0x0f) << 4) | (Number((frames / 2 ** 32) | 0) & 0x0f);
    // totalSamples 36 bit → 字节 13 低 4 位 + 字节 14..17
    si[14] = (frames >>> 24) & 0xff;
    si[15] = (frames >>> 16) & 0xff;
    si[16] = (frames >>> 8) & 0xff;
    si[17] = frames & 0xff;
    // MD5 置空（未计算）→ 字节 18..33
    si[18] = 0x00; si[19] = 0x00; si[20] = 0x00; si[21] = 0x00;
    si[22] = 0x00; si[23] = 0x00; si[24] = 0x00; si[25] = 0x00;
    si[26] = 0x00; si[27] = 0x00; si[28] = 0x00; si[29] = 0x00;
    si[30] = 0x00; si[31] = 0x00; si[32] = 0x00; si[33] = 0x00;

    const parts = [];
    parts.push(new Uint8Array([0x66, 0x4C, 0x61, 0x43])); // fLaC
    // METADATA_BLOCK_HEADER：末块 + STREAMINFO（长度 34）
    parts.push(new Uint8Array([0x80, 0x00, 0x00, 0x22]));
    parts.push(si);

    // ---- VERBATIM 帧 ----
    // 每帧 4096 个采样点；子帧全部为 VERBATIM（16 bit）
    // 帧头：sync(14bit) + reserved(1) + blocking strategy(1) + blockSize(4) + samplerate(4)
    //       + channelAssignment(4) + sampleSize(3) + reserved(1) + [UTF-8 帧号] + CRC8
    const BLOCK = 4096;
    const bytesPerSample = 2;
    // 头部长度：2 字节 sync/flags + 1 字节 blockSize/sampleRate + 1 字节 chAssign/sampleSize
    //          + UTF-8 帧号(1~6) + 1 字节 CRC8 + 2 字节 CRC16(结尾)
    const frameHeaderBase = 4;
    let blockCount = 0;

    // 块长码（FLAC 规范 Table 14）：
    //   0b0111 = 「块长-1 存在帧头末尾的 16 位数中」（非常规块长）
    //   0b1000~0b1111 = 字面块长 2^v，即 256 / 512 / 1024 / 2048 / 4096 / 8192 / 16384 / 32768
    // 固定块长 4096 必须用 0b1011(11)，否则解码器会按「帧头末尾读块长」去解析而错位。
    const BLOCK_SIZE_CODE = 11; // 0b1011 → 4096
    // 采样率码（FLAC 规范 Table 15）：0 表示「取自 STREAMINFO」，
    // 为了兼容只认可流式子集的解码器，优先用查表值，查不到再退回 0。
    const SAMPLE_RATE_CODES = {
      88200: 1, 176400: 2, 192000: 3, 8000: 4, 16000: 5, 22050: 6,
      24000: 7, 32000: 8, 44100: 9, 48000: 10, 96000: 11
    };
    const sampleRateCode = SAMPLE_RATE_CODES[sampleRate] !== undefined
      ? SAMPLE_RATE_CODES[sampleRate]
      : 0;

    for (let start = 0; start < frames; start += BLOCK) {
      const count = Math.min(BLOCK, frames - start);
      // 先算出帧号占用的字节数，确定整帧长度
      const frameNo = blockCount++;
      const frameNoLen = utf8NumberLength(frameNo);
      const frameSize = frameHeaderBase + frameNoLen + 1 /*CRC8*/ +
                        count * numCh * bytesPerSample + 2 /*CRC16*/;
      const buf = new Uint8Array(frameSize);
      let p = 0;

      // ---- 帧头 ----
      // 字节 0-1：sync(14) + reserved(1) + blocking strategy(1)
      buf[p++] = 0xFF;                          // sync 11111111 111111
      buf[p++] = 0xF8;                          // 11111 + reserved 0 + blocking strategy 0(固定块)
      // 字节 2：blockSize(4bit) + sampleRate(4bit)
      //   blockSize 0b1011 = 4096（字面块长）
      //   sampleRate 用查表码（查不到则 0 = 取自 STREAMINFO）
      buf[p++] = (BLOCK_SIZE_CODE << 4) | sampleRateCode;
      // 字节 3：channelAssignment(4bit) + sampleSize(3bit) + reserved(1bit)
      //   channelAssignment: 单声道 = 0，独立声道 = 1
      //   sampleSize: 16bit = 0b100
      const chAssign = numCh === 1 ? 0 : 1;
      buf[p++] = (chAssign << 4) | (0x04 << 1);
      // UTF-8 编码的帧号（固定块长策略）
      p = writeUtf8Number(buf, p, frameNo);
      // CRC8（覆盖帧头到 CRC8 之前的所有字节）
      buf[p] = crc8(buf.subarray(0, p));
      p++;

      // ---- 子帧：VERBATIM ----
      for (let c = 0; c < numCh; c++) {
        buf[p++] = 0x00;                        // 零比特标志 + subtype 000001 (VERBATIM)
        const data = chans[c];
        for (let i = 0; i < count; i++) {
          let s = data[start + i];
          if (s > 1) s = 1; else if (s < -1) s = -1;
          const v = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
          buf[p++] = v & 0xff;
          buf[p++] = (v >> 8) & 0xff;
        }
      }
      // CRC16（覆盖整个帧，末尾追加）
      const crc = crc16(buf.subarray(0, frameSize - 2));
      buf[p++] = (crc >> 8) & 0xff;
      buf[p++] = crc & 0xff;
      parts.push(buf);
    }

    return new Blob(parts, { type: 'audio/flac' });
  }

  /** UTF-8 变长编码的字节数 */
  function utf8NumberLength(value) {
    if (value < 0x80) return 1;
    if (value < 0x800) return 2;
    if (value < 0x10000) return 3;
    if (value < 0x200000) return 4;
    if (value < 0x4000000) return 5;
    return 6;
  }

  /** 写 UTF-8 编码的帧号（FLAC 变长编码） */
  function writeUtf8Number(bytes, offset, value) {
    if (value < 0x80) {
      bytes[offset++] = value;
    } else if (value < 0x800) {
      bytes[offset++] = 0xC0 | (value >> 6);
      bytes[offset++] = 0x80 | (value & 0x3f);
    } else if (value < 0x10000) {
      bytes[offset++] = 0xE0 | (value >> 12);
      bytes[offset++] = 0x80 | ((value >> 6) & 0x3f);
      bytes[offset++] = 0x80 | (value & 0x3f);
    } else if (value < 0x200000) {
      bytes[offset++] = 0xF0 | (value >> 18);
      bytes[offset++] = 0x80 | ((value >> 12) & 0x3f);
      bytes[offset++] = 0x80 | ((value >> 6) & 0x3f);
      bytes[offset++] = 0x80 | (value & 0x3f);
    } else if (value < 0x4000000) {
      bytes[offset++] = 0xF8 | (value >> 24);
      bytes[offset++] = 0x80 | ((value >> 18) & 0x3f);
      bytes[offset++] = 0x80 | ((value >> 12) & 0x3f);
      bytes[offset++] = 0x80 | ((value >> 6) & 0x3f);
      bytes[offset++] = 0x80 | (value & 0x3f);
    } else {
      bytes[offset++] = 0xFC | (value >>> 30);
      bytes[offset++] = 0x80 | ((value >>> 24) & 0x3f);
      bytes[offset++] = 0x80 | ((value >>> 18) & 0x3f);
      bytes[offset++] = 0x80 | ((value >>> 12) & 0x3f);
      bytes[offset++] = 0x80 | ((value >>> 6) & 0x3f);
      bytes[offset++] = 0x80 | (value & 0x3f);
    }
    return offset;
  }

  const CRC8_TABLE = (function () {
    const t = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      let crc = i;
      for (let j = 0; j < 8; j++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
      t[i] = crc;
    }
    return t;
  })();

  function crc8(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i++) crc = CRC8_TABLE[crc ^ bytes[i]];
    return crc;
  }

  const CRC16_TABLE = (function () {
    const t = new Uint16Array(256);
    for (let i = 0; i < 256; i++) {
      let crc = i << 8;
      for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
      t[i] = crc;
    }
    return t;
  })();

  function crc16(bytes) {
    let crc = 0;
    for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ CRC16_TABLE[((crc >> 8) ^ bytes[i]) & 0xff]) & 0xffff;
    return crc;
  }

  /* ---------------- MediaRecorder 编码（压缩格式） ---------------- */

  /** 浏览器是否支持某种 MediaRecorder 编码 */
  function supportsFormat(mime) {
    if (typeof global.MediaRecorder === 'undefined') return false;
    try {
      return typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mime);
    } catch (e) {
      return false;
    }
  }

  /**
   * 用 AudioContext + MediaRecorder 录制 AudioBuffer 为压缩格式
   * @param {{channels:Float32Array[], sampleRate:number, length:number}} audio 采样数据
   * @param {string} mime MediaRecorder 的 mime 类型
   * @returns {Promise<Blob>}
   */
  function encodeWithRecorder(audio, mime) {
    return new Promise(function (resolve, reject) {
      let ctx = null;
      let stream = null;
      let recorder = null;
      try {
        ctx = createContext();
        // AudioBuffer 必须与 MediaStreamDestination 属于同一个 AudioContext
        const source = ctx.createBufferSource();
        source.buffer = buildAudioBuffer(ctx, audio);
        const dest = ctx.createMediaStreamDestination();
        source.connect(dest);
        stream = dest.stream;

        const chunks = [];
        recorder = new global.MediaRecorder(stream, { mimeType: mime });
        recorder.ondataavailable = function (e) {
          if (e.data && e.data.size) chunks.push(e.data);
        };
        recorder.onerror = function () {
          cleanup();
          reject(new Error('录制失败：浏览器无法生成 ' + mime));
        };
        recorder.onstop = function () {
          cleanup();
          if (!chunks.length) { reject(new Error('录制失败：没有产生数据')); return; }
          resolve(new Blob(chunks, { type: mime }));
        };
        function cleanup() {
          try { if (ctx && ctx.state !== 'closed' && typeof ctx.close === 'function') ctx.close(); } catch (e) { /* ignore */ }
          try { if (stream && stream.getTracks) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* ignore */ }
        }
        source.start(0);
        recorder.start();
        // 按音频时长停止
        var stopTimer = setTimeout(function () {
          try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (e) { /* ignore */ }
        }, Math.max(200, (audio.length / audio.sampleRate || 0) * 1000 + 120));
        var origStop = recorder.stop.bind(recorder);
        recorder.stop = function () {
          clearTimeout(stopTimer);
          origStop();
        };
      } catch (e) {
        reject(new Error(e.message || '编码失败'));
      }
    });
  }

  /* ---------------- 对外主流程 ---------------- */

  /**
   * 把音频文件转换成指定格式
   * @param {ArrayBuffer} buffer 原始音频数据
   * @param {object} opts
   *   - format: 输出 MIME（audio/wav | audio/flac | audio/ogg | audio/mpeg | audio/webm）
   *   - sampleRate: 目标采样率（0 表示保持原样）
   *   - channels: 目标声道数（0 表示保持原样；1 表示转单声道）
   *   - bitDepth: 采样位深（仅 WAV 可选 8/16/24/32，核心实现 16-bit）
   * @returns {Promise<{blob:Blob, format:string, duration:number, sampleRate:number, channels:number}>}
   */
  function convert(buffer, opts) {
    opts = opts || {};
    const format = opts.format || 'audio/wav';
    const targetRate = opts.sampleRate || 0;
    const targetCh = opts.channels || 0;

    // 先按目标采样率解码，这样输出采样率就是目标值（而不是硬件默认值）
    return decode(buffer, targetRate).then(function (audioBuffer) {
      const resampled = resample(audioBuffer, targetRate);
      let chans = resampled.channels;
      if (targetCh === 1) chans = toMono(chans);
      else if (targetCh === 2 && chans.length === 1) chans = [chans[0], chans[0]];

      const audio = {
        channels: chans,
        sampleRate: resampled.sampleRate,
        length: resampled.length
      };

      const meta = {
        format: format,
        duration: audioBuffer.duration,
        sampleRate: audio.sampleRate,
        channels: chans.length
      };

      if (format === 'audio/wav') {
        meta.blob = encodeWav(audio);
        return meta;
      }
      if (format === 'audio/flac') {
        meta.blob = encodeFlac(audio);
        return meta;
      }

      const fmt = COMPRESSED_FORMATS[format];
      if (!fmt) throw new Error('不支持的输出格式：' + format);

      if (!supportsFormat(fmt.mime)) {
        throw new Error('当前浏览器不支持输出 ' + fmt.label + '（' + fmt.mime + '）');
      }
      return encodeWithRecorder(audio, fmt.mime).then(function (blob) {
        meta.blob = blob;
        return meta;
      });
    });
  }

  /** 用处理后的采样数据构造一个新的 AudioBuffer */
  function buildAudioBuffer(ctx, audio) {
    const len = Math.max(1, audio.length);
    const buf = ctx.createBuffer(audio.channels.length, len, audio.sampleRate);
    for (let c = 0; c < audio.channels.length; c++) {
      const data = audio.channels[c];
      if (typeof buf.copyToChannel === 'function') {
        buf.copyToChannel(data, c);
      } else {
        // 老 Safari / 旧 Chrome 只有 getChannelData
        buf.getChannelData(c).set(data);
      }
    }
    return buf;
  }

  /* ---------------- 导出 ---------------- */

  global.AudioCore = {
    INPUT_TYPES: INPUT_TYPES,
    OUTPUT_FORMATS: OUTPUT_FORMATS,
    LOSSLESS_FORMATS: LOSSLESS_FORMATS,
    COMPRESSED_FORMATS: COMPRESSED_FORMATS,
    SAMPLE_RATES: SAMPLE_RATES,
    CHANNEL_COUNTS: CHANNEL_COUNTS,
    EXT_BY_TYPE: EXT_BY_TYPE,
    decode: decode,
    inspect: inspect,
    convert: convert,
    resample: resample,
    toMono: toMono,
    encodeWav: encodeWav,
    encodeFlac: encodeFlac,
    supportsFormat: supportsFormat,
    hasAudioContext: hasAudioContext,
    buildFilename: buildFilename,
    formatDuration: formatDuration,
    formatSampleRate: formatSampleRate,
    guessExt: guessExt,
    hasExt: hasExt
  };
})(window);
