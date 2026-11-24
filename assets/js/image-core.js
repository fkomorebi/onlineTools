/* ============================================
   图片处理核心
   —— 全部基于 Canvas 在浏览器本地完成
   ============================================ */
(function (global) {
  'use strict';

  const { loadImage, formatBytes } = global.U;

  /** 支持的输入格式 */
  const INPUT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'];

  /** 支持的输出格式 */
  const OUTPUT_FORMATS = {
    'image/webp': { ext: 'webp', label: 'WebP' },
    'image/jpeg': { ext: 'jpg', label: 'JPEG' },
    'image/png':  { ext: 'png', label: 'PNG' }
  };

  /** 读取图片尺寸与基本信息 */
  function inspect(blob) {
    return loadImage(blob).then(function (img) {
      return {
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height
      };
    });
  }

  /**
   * 把 Blob 编码为指定格式的 Blob
   * @param {Blob} blob        原始图片
   * @param {object} opts
   *   - format: 'image/webp' | 'image/jpeg' | 'image/png'
   *   - quality: 0..1  (PNG 时忽略)
   *   - maxWidth / maxHeight: 等比缩放上限（0 表示不限制）
   *   - background: JPEG 无透明通道时的填充色
   * @returns {Promise<{blob:Blob, width:number, height:number}>}
   */
  function process(blob, opts) {
    opts = opts || {};
    const format = opts.format || 'image/webp';
    const quality = typeof opts.quality === 'number' ? opts.quality : 0.8;
    const maxW = opts.maxWidth || 0;
    const maxH = opts.maxHeight || 0;

    return loadImage(blob).then(function (img) {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;

      // 等比缩放
      if (maxW > 0 || maxH > 0) {
        let scale = 1;
        if (maxW > 0 && w > maxW) scale = Math.min(scale, maxW / w);
        if (maxH > 0 && h > maxH) scale = Math.min(scale, maxH / h);
        if (scale < 1) {
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');

      // 高质量缩放
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      if (format === 'image/jpeg') {
        // JPEG 不支持透明，先铺背景色
        ctx.fillStyle = opts.background || '#ffffff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(img, 0, 0, w, h);

      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (out) {
          if (!out) { reject(new Error('编码失败：浏览器不支持 ' + format)); return; }
          resolve({ blob: out, width: w, height: h });
        }, format, quality);
      });
    });
  }

  /**
   * WebP 质量搜索：在保证体积目标的前提下取尽可能高的质量
   * 若单次编码已达目标，直接返回。
   */
  function compressToTarget(blob, opts) {
    const targetBytes = opts.targetBytes || 0;
    if (!targetBytes || opts.format === 'image/png') {
      return process(blob, opts);
    }
    return process(blob, opts).then(function (first) {
      if (first.blob.size <= targetBytes) return first;
      // 二分搜索质量
      let lo = 0.05, hi = opts.quality || 0.8;
      let best = first;
      const steps = 5;
      return new Promise(function (resolve) {
        let i = 0;
        function step() {
          if (i >= steps) { resolve(best); return; }
          i++;
          const mid = (lo + hi) / 2;
          process(blob, Object.assign({}, opts, { quality: mid })).then(function (res) {
            if (res.blob.size <= targetBytes) {
              best = res;
              lo = mid;
            } else {
              hi = mid;
            }
            step();
          }).catch(function () { resolve(best); });
        }
        step();
      });
    });
  }

  /** 浏览器是否支持某种输出格式 */
  function supportsFormat(format) {
    try {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      return c.toDataURL(format).indexOf('data:' + format) === 0;
    } catch (e) {
      return false;
    }
  }

  /** 输出文件名 */
  function buildFilename(originalName, ext) {
    const base = (originalName || 'image').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_');
    return base + '.' + ext;
  }

  global.ImageCore = {
    INPUT_TYPES: INPUT_TYPES,
    OUTPUT_FORMATS: OUTPUT_FORMATS,
    inspect: inspect,
    process: process,
    compressToTarget: compressToTarget,
    supportsFormat: supportsFormat,
    buildFilename: buildFilename,
    formatBytes: formatBytes
  };
})(window);
