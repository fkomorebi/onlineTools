/* ============================================
   图片去水印 —— 核心算法（纯 JS，无依赖）
   —— 在浏览器里用 Canvas 重建被水印遮住的区域
   ============================================ */
(function (global) {
  'use strict';

  /**
   * 区域去水印
   *
   * 原理：把选中的水印矩形当作「损坏区域」，用周围可见像素把它填回来。
   * 几种填充策略：
   *   - blur   ：用邻域像素做加权模糊填充（适合纯色 / 渐变背景）
   *   - median：用邻域中位数填充（适合噪点或细纹理）
   *   - patch  ：从图像中偏移一段距离的区域直接搬运像素
   *              （适合重复图案，比如视频角标压在固定位置的画面上）
   *
   * @param {ImageData} imageData 原始像素
   * @param {{x:number,y:number,width:number,height:number}} region 目标区域
   * @param {object} opts
   *   - method: 'blur' | 'median' | 'patch'
   *   - radius: 采样半径（blur / median）
   *   - offsetX / offsetY: patch 模式的取样偏移
   *   - patchX / patchY: patch 模式的取样起点（留空则用区域自身）
   * @returns {{ok:boolean, error:string, changed:number}}
   */
  function removeWatermark(imageData, region, opts) {
    opts = opts || {};
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    if (!imageData || !data || !width || !height) {
      return { ok: false, error: '没有图像数据', changed: 0 };
    }
    if (!region || !region.width || !region.height) {
      return { ok: false, error: '请先框选要处理的区域', changed: 0 };
    }

    const rx = Math.max(0, Math.round(region.x));
    const ry = Math.max(0, Math.round(region.y));
    const rw = Math.min(Math.round(region.width), width - rx);
    const rh = Math.min(Math.round(region.height), height - ry);
    if (rw <= 0 || rh <= 0) {
      return { ok: false, error: '选区超出图片范围', changed: 0 };
    }

    const method = opts.method || 'blur';

    if (method === 'patch') {
      return applyPatch(data, width, height, rx, ry, rw, rh, opts);
    }
    if (method === 'median') {
      return applyMedian(data, width, height, rx, ry, rw, rh, opts);
    }
    return applyBlur(data, width, height, rx, ry, rw, rh, opts);
  }

  /**
   * 模糊填充：每个待修复像素取邻域（排除自身所在矩形）像素的平均值
   */
  function applyBlur(data, width, height, rx, ry, rw, rh, opts) {
    const radius = Math.max(1, Math.min(64, opts.radius || 8));
    const changed = copyRegion(data, width, height, rx, ry, rw, rh);

    // 先算一遍采样源（避免边改边读造成污染）
    const src = new Uint8ClampedArray(rw * rh * 4);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        const x0 = Math.max(0, rx + x - radius);
        const x1 = Math.min(width - 1, rx + x + radius);
        const y0 = Math.max(0, ry + y - radius);
        const y1 = Math.min(height - 1, ry + y + radius);
        for (let sy = y0; sy <= y1; sy++) {
          for (let sx = x0; sx <= x1; sx++) {
            // 跳过完全落在待修复矩形内的像素
            if (sx >= rx && sx < rx + rw && sy >= ry && sy < ry + rh) continue;
            const i = (sy * width + sx) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
            n++;
          }
        }
        if (n === 0) n = 1;
        const o = (y * rw + x) * 4;
        src[o] = r / n; src[o + 1] = g / n; src[o + 2] = b / n; src[o + 3] = a / n;
      }
    }

    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const o = (y * rw + x) * 4;
        const d = ((ry + y) * width + (rx + x)) * 4;
        data[d] = src[o]; data[d + 1] = src[o + 1]; data[d + 2] = src[o + 2]; data[d + 3] = src[o + 3];
      }
    }
    return { ok: true, error: '', changed: changed };
  }

  /**
   * 中位数填充：对每个通道取邻域中位数，能去掉水印但保留结构
   */
  function applyMedian(data, width, height, rx, ry, rw, rh, opts) {
    const radius = Math.max(1, Math.min(16, opts.radius || 3));
    const changed = copyRegion(data, width, height, rx, ry, rw, rh);

    const src = new Uint8ClampedArray(rw * rh * 4);
    const bufR = [], bufG = [], bufB = [];

    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        bufR.length = 0; bufG.length = 0; bufB.length = 0;
        const x0 = Math.max(0, rx + x - radius);
        const x1 = Math.min(width - 1, rx + x + radius);
        const y0 = Math.max(0, ry + y - radius);
        const y1 = Math.min(height - 1, ry + y + radius);
        for (let sy = y0; sy <= y1; sy++) {
          for (let sx = x0; sx <= x1; sx++) {
            if (sx >= rx && sx < rx + rw && sy >= ry && sy < ry + rh) continue;
            const i = (sy * width + sx) * 4;
            bufR.push(data[i]); bufG.push(data[i + 1]); bufB.push(data[i + 2]);
          }
        }
        const o = (y * rw + x) * 4;
        if (bufR.length) {
          src[o] = median(bufR);
          src[o + 1] = median(bufG);
          src[o + 2] = median(bufB);
          src[o + 3] = data[((ry + y) * width + (rx + x)) * 4 + 3];
        } else {
          src[o] = data[((ry + y) * width + (rx + x)) * 4];
          src[o + 1] = data[((ry + y) * width + (rx + x)) * 4 + 1];
          src[o + 2] = data[((ry + y) * width + (rx + x)) * 4 + 2];
          src[o + 3] = data[((ry + y) * width + (rx + x)) * 4 + 3];
        }
      }
    }

    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const o = (y * rw + x) * 4;
        const d = ((ry + y) * width + (rx + x)) * 4;
        data[d] = src[o]; data[d + 1] = src[o + 1]; data[d + 2] = src[o + 2]; data[d + 3] = src[o + 3];
      }
    }
    return { ok: true, error: '', changed: changed };
  }

  /**
   * 补片：从图像的另一块区域直接搬运像素覆盖水印
   * 适合水印压在重复图案（棋盘、条纹、风景）上的情况
   */
  function applyPatch(data, width, height, rx, ry, rw, rh, opts) {
    const changed = copyRegion(data, width, height, rx, ry, rw, rh);

    const px = opts.patchX === undefined || opts.patchX === null ? rx : Math.round(opts.patchX);
    const py = opts.patchY === undefined || opts.patchY === null ? ry : Math.round(opts.patchY);
    const dx = Math.round(opts.offsetX || 0);
    const dy = Math.round(opts.offsetY || 0);

    const srcX = px + dx;
    const srcY = py + dy;

    if (srcX < 0 || srcY < 0 || srcX + rw > width || srcY + rh > height) {
      return { ok: false, error: '取样区域超出图片范围，请调整偏移量', changed: 0 };
    }

    // 复制源区域，避免覆盖时互相影响
    const src = new Uint8ClampedArray(rw * rh * 4);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const si = ((srcY + y) * width + (srcX + x)) * 4;
        const o = (y * rw + x) * 4;
        src[o] = data[si]; src[o + 1] = data[si + 1]; src[o + 2] = data[si + 2]; src[o + 3] = data[si + 3];
      }
    }

    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const o = (y * rw + x) * 4;
        const d = ((ry + y) * width + (rx + x)) * 4;
        data[d] = src[o]; data[d + 1] = src[o + 1]; data[d + 2] = src[o + 2]; data[d + 3] = src[o + 3];
      }
    }
    return { ok: true, error: '', changed: changed };
  }

  /** 备份区域像素，返回区域内的像素数 */
  function copyRegion(data, width, height, rx, ry, rw, rh) {
    return rw * rh;
  }

  /** 求中位数 */
  function median(arr) {
    if (!arr.length) return 0;
    const copy = arr.slice().sort(function (a, b) { return a - b; });
    const mid = copy.length >> 1;
    if (copy.length % 2) return copy[mid];
    return (copy[mid - 1] + copy[mid]) / 2;
  }

  /**
   * 自动检测水印候选区域
   *
   * 思路：找出「与周围亮度差异很大、但自身颜色高度统一」的矩形块 ——
   * 典型水印就是半透明的纯色文字 / logo。
   *
   * @param {ImageData} imageData
   * @param {{threshold?:number, minSize?:number}} opts
   * @returns {Array<{x:number,y:number,width:number,height:number,score:number}>}
   */
  function detectWatermark(imageData, opts) {
    opts = opts || {};
    const threshold = opts.threshold == null ? 28 : opts.threshold;
    const minSize = opts.minSize || 12;

    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    if (!data || !width || !height) return [];

    // 1. 找出与局部背景差异明显的像素
    const flagged = new Uint8Array(width * height);
    let flaggedCount = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = (y * width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        // 局部背景亮度：四邻域平均
        let bg = 0;
        bg += 0.299 * data[((y - 1) * width + x) * 4] + 0.587 * data[((y - 1) * width + x) * 4 + 1] + 0.114 * data[((y - 1) * width + x) * 4 + 2];
        bg += 0.299 * data[((y + 1) * width + x) * 4] + 0.587 * data[((y + 1) * width + x) * 4 + 1] + 0.114 * data[((y + 1) * width + x) * 4 + 2];
        bg += 0.299 * data[(y * width + x - 1) * 4] + 0.587 * data[(y * width + x - 1) * 4 + 1] + 0.114 * data[(y * width + x - 1) * 4 + 2];
        bg += 0.299 * data[(y * width + x + 1) * 4] + 0.587 * data[(y * width + x + 1) * 4 + 1] + 0.114 * data[(y * width + x + 1) * 4 + 2];
        bg /= 4;

        if (Math.abs(lum - bg) > threshold) {
          flagged[y * width + x] = 1;
          flaggedCount++;
        }
      }
    }

    if (flaggedCount < 10) return [];

    // 2. 把标记像素做简单连通域聚类（8 邻域，迭代式泛洪）
    const visited = new Uint8Array(width * height);
    const regions = [];
    const stack = [];

    for (let start = 0; start < flagged.length; start++) {
      if (!flagged[start] || visited[start]) continue;
      stack.length = 0;
      stack.push(start);
      visited[start] = 1;

      let minX = width, minY = height, maxX = -1, maxY = -1;
      let count = 0;
      let sumR = 0, sumG = 0, sumB = 0;

      while (stack.length) {
        const p = stack.pop();
        const py = (p / width) | 0;
        const px = p - py * width;
        count++;
        const i = p * 4;
        sumR += data[i]; sumG += data[i + 1]; sumB += data[i + 2];
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;

        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = px + dx, ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const np = ny * width + nx;
            if (flagged[np] && !visited[np]) {
              visited[np] = 1;
              stack.push(np);
            }
          }
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw < minSize || bh < minSize) continue;

      // 3. 判断这一块颜色是否统一（水印的关键特征）
      const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count;
      let variance = 0;
      for (let p = 0; p < count; p++) { /* 占位，避免空循环告警 */ }
      // 用包围盒内的标记像素重新统计方差
      let n = 0, v = 0;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const p = y * width + x;
          if (!visited[p]) continue;
          const i = p * 4;
          const d = (data[i] - avgR) * (data[i] - avgR) +
                    (data[i + 1] - avgG) * (data[i + 1] - avgG) +
                    (data[i + 2] - avgB) * (data[i + 2] - avgB);
          v += d; n++;
        }
      }
      variance = n ? v / n : 0;

      const uniformity = 1 / (1 + Math.sqrt(variance) / 12);
      const density = count / (bw * bh);
      // 颜色越统一、密度越像文字块，分数越高
      const score = uniformity * Math.min(1, density * 3.2);

      if (score < 0.28) continue;

      regions.push({
        x: minX, y: minY, width: bw, height: bh,
        score: Math.round(score * 100) / 100,
        pixels: count
      });
    }

    // 按分数排序，去掉被包含的小块
    regions.sort(function (a, b) { return b.score - a.score; });
    const kept = [];
    regions.forEach(function (r) {
      const contained = kept.some(function (k) {
        return r.x >= k.x && r.y >= k.y && r.x + r.width <= k.x + k.width && r.y + r.height <= k.y + k.height;
      });
      if (!contained) kept.push(r);
    });

    return kept.slice(0, 12);
  }

  /**
   * 计算一段区域的平均颜色
   */
  function averageColor(imageData, region) {
    const data = imageData.data;
    const x0 = Math.max(0, Math.round(region.x));
    const y0 = Math.max(0, Math.round(region.y));
    const x1 = Math.min(imageData.width, x0 + Math.round(region.width));
    const y1 = Math.min(imageData.height, y0 + Math.round(region.height));
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * imageData.width + x) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    }
    if (!n) return { r: 0, g: 0, b: 0 };
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  }

  global.WatermarkCore = {
    removeWatermark: removeWatermark,
    detectWatermark: detectWatermark,
    averageColor: averageColor,
    median: median
  };
})(window);
