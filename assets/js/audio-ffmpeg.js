/* ============================================
   ffmpeg.wasm 封装（音频编码增强）
   —— 懒加载 @ffmpeg/core（单线程版，无需 SharedArrayBuffer）
   —— 提供 MP3 / AAC / Vorbis 等浏览器原生拿不到的压缩格式
   —— 核心文件放在 vendor/ffmpeg/，完全本地托管，不依赖 CDN
   ============================================ */
(function (global) {
  'use strict';

  /** 本地托管的 ffmpeg 核心文件路径（相对站点根目录） */
  const CORE_BASE = 'vendor/ffmpeg/';
  const CORE_JS = CORE_BASE + 'ffmpeg-core.js';
  const CORE_WASM = CORE_BASE + 'ffmpeg-core.wasm';
  const CORE_WORKER = CORE_BASE + 'ffmpeg.worker.js';
  const API_JS = CORE_BASE + 'ffmpeg.js';
  // @ffmpeg/ffmpeg 的 worker chunk（由 UMD 包里的 publicPath 规则定位），
  // 我们把它单独存成 ffmpeg.worker.js，需要保证同名，
  // 否则库会去找 vendor/ffmpeg/814.ffmpeg.js 而 404。
  const WORKER_CHUNK = CORE_BASE + '814.ffmpeg.js';

  /** ffmpeg 输出的格式表
   *  ext        —— 文件扩展名
   *  mime       —— 输出 Blob 的 MIME
   *  container  —— ffmpeg 封装格式
   *  codec      —— ffmpeg 编码器（-c:a）
   *  extra      —— 附加参数
   *  bitrate    —— 默认码率（kbps），null 表示不指定
   */
  const FFMPEG_FORMATS = {
    'audio/mpeg': {
      ext: 'mp3', label: 'MP3', mime: 'audio/mpeg',
      container: 'mp3', codec: 'libmp3lame', bitrate: 192,
      extra: []
    },
    'audio/aac': {
      ext: 'm4a', label: 'AAC（M4A）', mime: 'audio/mp4',
      container: 'ipod', codec: 'aac', bitrate: 192,
      extra: ['-f', 'ipod']
    },
    'audio/ogg': {
      ext: 'ogg', label: 'OGG（Vorbis）', mime: 'audio/ogg',
      container: 'ogg', codec: 'libvorbis', bitrate: 192,
      extra: []
    },
    'audio/flac': {
      ext: 'flac', label: 'FLAC', mime: 'audio/flac',
      container: 'flac', codec: 'flac', bitrate: null,
      extra: []
    },
    'audio/wav': {
      ext: 'wav', label: 'WAV', mime: 'audio/wav',
      container: 'wav', codec: 'pcm_s16le', bitrate: null,
      extra: []
    }
  };

  /** 状态：idle / loading / ready / failed */
  let state = 'idle';
  let loadPromise = null;
  let instance = null;
  let lastError = '';
  const logLines = [];
  /** 当前实例已执行的 exec 次数（超过阈值要重建实例以释放 wasm 内存） */
  let execCount = 0;
  /** 单个实例最多执行多少次 exec —— 实测第 4 次左右开始出现内存越界，留一点余量 */
  const MAX_EXECS_PER_INSTANCE = 2;

  /** 是否处于可用状态 */
  function isReady() {
    return state === 'ready' && !!instance;
  }

  /** 当前状态 */
  function getState() {
    return state;
  }

  /** 最近一次错误信息 */
  function getError() {
    return lastError;
  }

  /** 供 UI 展示的日志尾部 */
  function getLog() {
    return logLines.slice(-40);
  }

  /** 站点根路径（用于把相对路径解析成绝对地址） */
  function rootPath() {
    if (global.location && global.location.origin) return global.location.origin;
    return '';
  }

  function absoluteUrl(path) {
    const root = rootPath();
    if (!root) return path;
    return root + '/' + path.replace(/^\/+/, '');
  }

  /**
   * 把某个 URL 上的脚本加载到当前页面（用于拿到 UMD 的全局对象）
   * @returns {Promise<void>}
   */
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-ffmpeg-api]')) { resolve(); return; }
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.ffmpegApi = '1';
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('无法加载 ' + url)); };
      document.head.appendChild(script);
    });
  }

  /** 已加载过就直接复用 */
  function hasCoreScript() {
    return typeof global.createFFmpegCore === 'function';
  }

  /**
   * 加载 ffmpeg 核心（懒加载，只在用户真正需要压缩格式时才下载 ~31MB）
   * @returns {Promise<object>} 就绪后返回实例
   */
  function load() {
    if (isReady()) return Promise.resolve(instance);
    if (loadPromise) return loadPromise;

    state = 'loading';
    lastError = '';
    logLines.length = 0;

    loadPromise = loadScript(absoluteUrl(API_JS))
      .then(function () {
        const FFmpegClass = global.FFmpegWASM && global.FFmpegWASM.FFmpeg;
        if (!FFmpegClass) throw new Error('ffmpeg.wasm 接口脚本加载异常');
        instance = new FFmpegClass();
        instance.on('log', function (e) {
          if (e && e.message) {
            logLines.push(e.message);
            if (logLines.length > 200) logLines.splice(0, logLines.length - 200);
          }
        });
        // 注意：不要传 classWorkerURL。
        // @ffmpeg/ffmpeg 的 UMD 版在传了 classWorkerURL 时会用
        // `new Worker(new URL(classWorkerURL, "file:///..."))` 去解析路径，
        // 在浏览器里会直接抛错（file:// 基准）。省略它即可，
        // 让库按自身的 publicPath 规则去取同目录下的 814.ffmpeg.js worker chunk。
        // workerURL 则传给我们复制的 ffmpeg.worker.js（内容与 worker chunk 相同）。
        return instance.load({
          coreURL: absoluteUrl(CORE_JS),
          wasmURL: absoluteUrl(CORE_WASM),
          workerURL: absoluteUrl(CORE_WORKER)
        });
      })
      .then(function () {
        state = 'ready';
        notifyStateChange();
        return instance;
      })
      .catch(function (err) {
        state = 'failed';
        lastError = (err && err.message) || String(err);
        loadPromise = null;
        instance = null;
        notifyStateChange();
        throw new Error('ffmpeg 加载失败：' + lastError);
      });

    return loadPromise;
  }

  /**
   * 状态变化通知。
   * 引擎可能被多处触发加载（用户点按钮、页面自动加载），
   * 统一用事件广播，页面只要监听一次就能刷新状态徽标与格式提示。
   */
  const listeners = [];
  function onStateChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }
  function notifyStateChange() {
    listeners.forEach(function (fn) {
      try { fn(state); } catch (e) { /* ignore */ }
    });
  }

  /** 释放资源 */
  function terminate() {
    if (instance && typeof instance.terminate === 'function') {
      try { instance.terminate(); } catch (e) { /* ignore */ }
    }
    instance = null;
    state = 'idle';
    loadPromise = null;
    execCount = 0;
  }

  /**
   * 从 ffmpeg 日志里解析输出流的时长 / 采样率 / 声道。
   * ffmpeg 会打印形如：
   *   Stream #0:0: Audio: mp3, 44100 Hz, stereo, s16p, 192 kb/s
   * 以及
   *   size= 25kB time=00:00:01.01 bitrate= 202.0kbits/s
   * @returns {{duration:number, sampleRate:number, channels:number}}
   */
  function parseOutputInfo() {
    const out = { duration: 0, sampleRate: 0, channels: 0 };
    for (let i = logLines.length - 1; i >= 0; i--) {
      const line = logLines[i];
      if (!out.duration) {
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
        if (m) {
          out.duration = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
        }
      }
      if (!out.sampleRate) {
        const m = /Audio:\s*[^,]+,\s*(\d+)\s*Hz,\s*(mono|stereo|quad|\d+)/.exec(line);
        if (m) {
          out.sampleRate = +m[1];
          out.channels = m[2] === 'mono' ? 1 : m[2] === 'stereo' ? 2 : (+m[2] || 0);
        }
      }
      if (out.duration && out.sampleRate) break;
    }
    return out;
  }

  /** 给 ffmpeg 用的临时文件名 */
  let seq = 0;
  function tempName(ext) {
    seq += 1;
    return 'au_' + Date.now().toString(36) + '_' + seq + '.' + ext;
  }

  /**
   * 用 ffmpeg 把音频编码成目标格式
   *
   * ⚠ 关于内存：ffmpeg.wasm 单线程 core 的 wasm 线性内存不会自动回收，
   * 同一个实例连续跑几次 exec 之后会抛 "memory access out of bounds"。
   * 这里用「每次编码后重建实例」来规避 —— 重建会重新申请一块干净的
   * 线性内存（代价是重新 load 一次 core，浏览器有 HTTP 缓存所以很快）。
   * convertCount 记录当前实例已执行的次数，超过阈值就重建。
   *
   * @param {Uint8Array|ArrayBuffer} input 输入音频字节
   * @param {object} opts
   *   - format: FFMPEG_FORMATS 的键（audio/mpeg 等）
   *   - sampleRate: 目标采样率（0 表示不重采样）
   *   - channels: 目标声道数（0 表示不）
   * @returns {Promise<{blob:Blob, size:number, ext:string, mime:string}>}
   */
  function encode(input, opts) {
    opts = opts || {};
    const fmt = FFMPEG_FORMATS[opts.format];
    if (!fmt) return Promise.reject(new Error('ffmpeg 不支持的输出格式：' + opts.format));

    const bytes = input instanceof Uint8Array
      ? input
      : new Uint8Array(input instanceof ArrayBuffer ? input : input.buffer);

    const inName = tempName('bin');
    const outName = tempName(fmt.ext);

    return load().then(function (ff) {
      // 每次都传一份全新的副本：writeFile 会把 Uint8Array 的 buffer
      // 以 transferable 方式 postMessage 给 worker，之后原 buffer 就被 detach 了，
      // 复用同一个 buffer 会在第二次调用时抛
      // "ArrayBuffer at index 0 is already detached"。
      const payload = new Uint8Array(bytes.length);
      payload.set(bytes);

      return ff.writeFile(inName, payload)
        .then(function () {
          let args = ['-i', inName];
          if (opts.sampleRate) args.push('-ar', String(opts.sampleRate));
          if (opts.channels) args.push('-ac', String(opts.channels));
          args.push('-c:a', fmt.codec);
          if (fmt.bitrate) args.push('-b:a', String(fmt.bitrate) + 'k');
          args.push('-vn');
          if (fmt.extra.length) args = args.concat(fmt.extra);
          args.push(outName);
          return ff.exec(args, -1);
        })
        .then(function (code) {
          if (code !== 0) {
            throw new Error('ffmpeg 编码失败（退出码 ' + code + '）');
          }
          return ff.readFile(outName);
        })
        .then(function (data) {
          const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
          const info = parseOutputInfo();
          return {
            blob: new Blob([u8], { type: fmt.mime }),
            size: u8.byteLength,
            ext: fmt.ext,
            mime: fmt.mime,
            duration: info.duration,
            sampleRate: info.sampleRate,
            channels: info.channels
          };
        })
        .then(function (result) {
          return ff.deleteFile(inName)
            .catch(function () { /* ignore */ })
            .then(function () { return ff.deleteFile(outName).catch(function () { /* ignore */ }); })
            .then(function () { return result; });
        })
        .then(function (result) {
          execCount += 1;
          if (execCount >= MAX_EXECS_PER_INSTANCE) {
            // 到达内存安全上限：丢掉旧实例，下次 encode 会重新 load
            resetInstance();
          }
          return result;
        });
    });
  }

  /** 丢弃当前实例（下次 encode 会重新加载 core） */
  function resetInstance() {
    if (instance && typeof instance.terminate === 'function') {
      try { instance.terminate(); } catch (e) { /* ignore */ }
    }
    instance = null;
    state = 'idle';
    loadPromise = null;
    execCount = 0;
  }

  global.AudioFFmpeg = {
    FFMPEG_FORMATS: FFMPEG_FORMATS,
    CORE_BASE: CORE_BASE,
    WORKER_CHUNK: WORKER_CHUNK,
    load: load,
    isReady: isReady,
    getState: getState,
    getError: getError,
    getLog: getLog,
    onStateChange: onStateChange,
    terminate: terminate,
    encode: encode
  };
})(window);
