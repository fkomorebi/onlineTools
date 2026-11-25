/* ============================================
   图片去水印 —— 核心算法（纯 JS，无依赖）
   —— 在浏览器里用 Canvas 重建被水印遮住的区域
   ============================================ */
(function (global) {
  'use strict';

  /**
   * 修复方式：
   *   smart  —— 自动补片（首选）：把选区当成一块"待修复的洞"，在整张图里
   *             搜索与选区四周最匹配的相似区域，把那块像素搬过来。
   *             搬来的是真实画面，所以纹理、边缘、渐变全都接得上，
   *             不会糊成一块纯色。采用多分辨率搜索，大图也不卡。
   *   inpaint—— 边界扩散填充（兜底）：找不到足够相似的区域时用。
   *             从选区边缘的真实像素逐层向内扩散，保留渐变走向。
   *   blur   —— 邻域均值：只适合完全纯色的背景。
   *   median —— 邻域中位数：适合噪点较多的画面。
   *   patch  —— 手动补片：自己指定取样偏移。
   */

  const METHODS = {
    smart: '自动补片（推荐，照片首选）',
    inpaint: '边界扩散填充（保留渐变）',
    blur: '邻域均值（仅纯色背景）',
    median: '邻域中位数（噪点画面）',
    patch: '手动补片（自选取样位置）'
  };

  /**
   * 区域去水印
   *
   * @param {ImageData} imageData 原始像素（会被就地修改）
   * @param {{x:number,y:number,width:number,height:number}} region 目标区域
   * @param {object} opts
   *   - method: 'smart' | 'inpaint' | 'blur' | 'median' | 'patch'
   *   - radius: 采样半径（blur / median）
   *   - offsetX / offsetY: patch 模式的取样偏移
   *   - patchX / patchY: patch 模式的取样起点（留空则用区域自身）
   * @returns {{ok:boolean, error:string, changed:number, method:string, detail:string}}
   */
  function removeWatermark(imageData, region, opts) {
    opts = opts || {};
    const data = imageData && imageData.data;
    const width = imageData && imageData.width;
    const height = imageData && imageData.height;

    if (!imageData || !data || !width || !height) {
      return { ok: false, error: '没有图像数据', changed: 0, method: '', detail: '' };
    }
    if (!region || !region.width || !region.height) {
      return { ok: false, error: '请先框选要处理的区域', changed: 0, method: '', detail: '' };
    }

    const rx = Math.max(0, Math.round(region.x));
    const ry = Math.max(0, Math.round(region.y));
    const rw = Math.min(Math.round(region.width), width - rx);
    const rh = Math.min(Math.round(region.height), height - ry);
    if (rw <= 0 || rh <= 0) {
      return { ok: false, error: '选区超出图片范围', changed: 0, method: '', detail: '' };
    }

    const method = opts.method || 'smart';

    if (method === 'patch') return applyPatch(data, width, height, rx, ry, rw, rh, opts);
    if (method === 'blur') return applyBlur(data, width, height, rx, ry, rw, rh, opts);
    if (method === 'median') return applyMedian(data, width, height, rx, ry, rw, rh, opts);
    if (method === 'inpaint') return applyInpaint(data, width, height, rx, ry, rw, rh, opts);
    return applySmart(data, width, height, rx, ry, rw, rh, opts);
  }

  /* ============================================================
     边界扩散填充
     ------------------------------------------------------------
     分两步：
       1. 先把紧贴选区边缘的那一圈像素，用它们**洞外**的邻居填好
          （这样边缘的颜色不会被水印本身污染）；
       2. 然后一圈一圈往里扩散，每圈都从上一圈取样。
     边缘的明暗过渡会被一路带进洞里，不会一刀切成纯色。
     ============================================================ */
  function applyInpaint(data, width, height, rx, ry, rw, rh, opts) {
    const inside = function (x, y) {
      return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
    };

    const known = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) known[y * width + x] = inside(x, y) ? 0 : 1;
    }

    // --- 第 1 步：边界像素用洞外的邻居初始化 ---
    const boundary = [];
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        let isEdge = false;
        for (let dy = -1; dy <= 1 && !isEdge; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (!inside(nx, ny)) { isEdge = true; break; }
          }
        }
        if (isEdge) boundary.push(y * width + x);
      }
    }

    for (let k = 0; k < boundary.length; k++) {
      const p = boundary[k];
      const px = p % width, py = (p / width) | 0;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const sx = px + dx, sy = py + dy;
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
          if (inside(sx, sy)) continue;   // 绝不取洞内（水印）像素
          const i = (sy * width + sx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2];
          n++;
        }
      }
      if (n) {
        const i = p * 4;
        data[i] = r / n; data[i + 1] = g / n; data[i + 2] = b / n;
      }
      known[p] = 1;
    }

    // --- 第 2 步：逐圈向内扩散 ---
    let remaining = [];
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        const p = y * width + x;
        if (!known[p]) remaining.push(p);
      }
    }

    while (remaining.length) {
      const next = [];
      for (let k = 0; k < remaining.length; k++) {
        const p = remaining[k];
        const px = p % width, py = (p / width) | 0;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const sx = px + dx, sy = py + dy;
            if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
            if (!known[sy * width + sx]) continue;
            const i = (sy * width + sx) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2];
            n++;
          }
        }
        if (!n) { next.push(p); continue; }
        const i = p * 4;
        data[i] = r / n; data[i + 1] = g / n; data[i + 2] = b / n;
        known[p] = 1;
      }
      remaining = next;
    }

    return {
      ok: true,
      error: '',
      changed: rw * rh,
      method: 'inpaint',
      detail: '边界扩散填充'
    };
  }

  /* ============================================================
     自动补片（多分辨率 patch match）
     ------------------------------------------------------------
     1) 取选区四周紧邻的一圈像素作为"上下文"；
     2) 在整张图里找一个位置，它周围那一圈与上下文最像；
     3) 把那块像素搬进选区。
     评分用的是真实的边缘像素，所以搬来的内容能接上原来的边缘；
     搬来的是源区域的真实像素，所以纹理完整保留。
     为保证大图也不卡，采用多分辨率：先在缩略图上粗找，再逐层放大精修。
     ============================================================ */
  function applySmart(data, width, height, rx, ry, rw, rh, opts) {
    // 上下文环：紧贴选区外沿的一圈
    const ring = buildRing(data, width, height, rx, ry, rw, rh);
    if (!ring.length) {
      const r = applyInpaint(data, width, height, rx, ry, rw, rh, opts);
      r.method = 'inpaint';
      r.detail = '选区贴着图片边缘，改用边界扩散填充';
      return r;
    }

    // 建金字塔
    const levels = buildPyramid(data, width, height);
    let guess = null;
    let cost = Infinity;

    for (let li = 0; li < levels.length; li++) {
      const lv = levels[li];
      const f = lv.factor;
      const lrx = Math.round(rx / f);
      const lry = Math.round(ry / f);
      const lrw = Math.max(2, Math.round(rw / f));
      const lrh = Math.max(2, Math.round(rh / f));
      const lw = lv.width, lh = lv.height;
      const init = guess ? { x: Math.round(guess.x / f), y: Math.round(guess.y / f) } : null;

      // 最粗的一层扫全图，越细的层只在上一层结果附近精修
      const scanStep = Math.max(1, Math.round(Math.min(lw, lh) / 100));
      const m = searchLayer(lv, lrx, lry, lrw, lrh, scanStep, init, li > 0);
      if (m) {
        guess = { x: m.x * f, y: m.y * f };
        cost = m.cost;
      }
    }

    // 原图上再精修一次
    if (guess) {
      const m = searchLayer({ data: data, width: width, height: height },
        rx, ry, rw, rh, 2, guess, true);
      if (m) { guess = { x: m.x, y: m.y }; cost = m.cost; }
    }

    if (!guess) {
      const r = applyInpaint(data, width, height, rx, ry, rw, rh, opts);
      r.method = 'inpaint';
      r.detail = '没找到合适的取样位置，改用边界扩散填充';
      return r;
    }

    // 搬运像素
    const src = new Uint8ClampedArray(rw * rh * 4);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const si = ((guess.y + y) * width + (guess.x + x)) * 4;
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

    const offX = guess.x - rx;
    const offY = guess.y - ry;
    return {
      ok: true,
      error: '',
      changed: rw * rh,
      method: 'smart',
      detail: '自动补片（取样位置偏移 ' + offX + ', ' + offY + '，匹配误差 ' +
        (isFinite(cost) ? Math.round(cost) : '?') + '）'
    };
  }

  /** 收集紧贴选区外沿的一圈上下文像素 */
  function buildRing(data, width, height, rx, ry, rw, rh) {
    const ring = [];
    const push = function (x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 4;
      ring.push({ dx: x - rx, dy: y - ry, r: data[i], g: data[i + 1], b: data[i + 2] });
    };
    for (let x = rx - 1; x <= rx + rw; x++) { push(x, ry - 1); push(x, ry + rh); }
    for (let y = ry; y < ry + rh; y++) { push(rx - 1, y); push(rx + rw, y); }
    return ring;
  }

  /**
   * 在一层图上搜索最佳取样位置
   * @param {{data,width,height}} img
   * @param {number} rx @param {number} ry @param {number} rw @param {number} rh
   * @param {number} scanStep 扫描步长
   * @param {{x,y}|null} initial 上一层的猜测位置
   * @param {boolean} localOnly true = 只在 initial 附近精修
   */
  function searchLayer(img, rx, ry, rw, rh, scanStep, initial, localOnly) {
    const data = img.data, width = img.width, height = img.height;
    const ring = buildRing(data, width, height, rx, ry, rw, rh);
    if (!ring.length) return null;

    function costAt(sx, sy) {
      let e = 0;
      for (let k = 0; k < ring.length; k++) {
        const p = ring[k];
        const px = sx + p.dx, py = sy + p.dy;
        if (px < 0 || py < 0 || px >= width || py >= height) return Infinity;
        const i = (py * width + px) * 4;
        const dr = p.r - data[i], dg = p.g - data[i + 1], db = p.b - data[i + 2];
        e += dr * dr + dg * dg + db * db;
      }
      return e / ring.length;
    }

    function overlapsHole(sx, sy) {
      return sx < rx + rw && sx + rw > rx && sy < ry + rh && sy + rh > ry;
    }

    let best = null;
    let bestCost = Infinity;

    if (initial) {
      const c = costAt(initial.x, initial.y);
      if (isFinite(c)) { best = { x: initial.x, y: initial.y }; bestCost = c; }
    }

    if (localOnly && best) {
      // 局部精修：半径逐级收缩
      let radius = Math.max(2, scanStep);
      while (radius >= 1) {
        const stride = Math.max(1, Math.round(radius / 3));
        for (let dy = -radius; dy <= radius; dy += stride) {
          for (let dx = -radius; dx <= radius; dx += stride) {
            if (!dx && !dy) continue;
            const sx = best.x + dx, sy = best.y + dy;
            if (sx < 0 || sy < 0 || sx + rw > width || sy + rh > height) continue;
            if (overlapsHole(sx, sy)) continue;
            const c = costAt(sx, sy);
            if (c < bestCost) { bestCost = c; best = { x: sx, y: sy }; }
          }
        }
        radius = Math.floor(radius / 2);
      }
      return { x: best.x, y: best.y, cost: bestCost };
    }

    // 全图扫描
    for (let sy = 0; sy <= height - rh; sy += scanStep) {
      for (let sx = 0; sx <= width - rw; sx += scanStep) {
        if (overlapsHole(sx, sy)) continue;
        const c = costAt(sx, sy);
        if (c < bestCost) { bestCost = c; best = { x: sx, y: sy }; }
      }
    }

    if (!best) return null;

    // 扫描后再局部收缩一轮，补上步长漏掉的细节
    let radius = Math.max(1, scanStep);
    while (radius >= 1) {
      const stride = Math.max(1, Math.round(radius / 3));
      for (let dy = -radius; dy <= radius; dy += stride) {
        for (let dx = -radius; dx <= radius; dx += stride) {
          if (!dx && !dy) continue;
          const sx = best.x + dx, sy = best.y + dy;
          if (sx < 0 || sy < 0 || sx + rw > width || sy + rh > height) continue;
          if (overlapsHole(sx, sy)) continue;
          const c = costAt(sx, sy);
          if (c < bestCost) { bestCost = c; best = { x: sx, y: sy }; }
        }
      }
      radius = Math.floor(radius / 2);
    }

    return { x: best.x, y: best.y, cost: bestCost };
  }

  /**
   * 建多分辨率金字塔（从粗到细）
   */
  function buildPyramid(data, width, height) {
    const levels = [];
    let cur = { data: data, width: width, height: height, factor: 1 };
    levels.unshift(cur);
    for (let lv = 1; lv <= 6; lv++) {
      const prev = levels[0];
      const w = Math.floor(prev.width / 2);
      const h = Math.floor(prev.height / 2);
      if (w < 96 || h < 96) break;
      const nd = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          let r = 0, g = 0, b = 0, n = 0;
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
              const sx = x * 2 + dx, sy = y * 2 + dy;
              if (sx >= prev.width || sy >= prev.height) continue;
              const si = (sy * prev.width + sx) * 4;
              r += prev.data[si]; g += prev.data[si + 1]; b += prev.data[si + 2];
              n++;
            }
          }
          nd[i] = r / n; nd[i + 1] = g / n; nd[i + 2] = b / n; nd[i + 3] = 255;
        }
      }
      levels.unshift({ data: nd, width: w, height: h, factor: prev.factor * 2 });
    }
    return levels;
  }

  /* ============================================================
     兜底算法
     ============================================================ */
  function applyBlur(data, width, height, rx, ry, rw, rh, opts) {
    const radius = Math.max(1, Math.min(64, opts.radius || 8));

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
    return { ok: true, error: '', changed: rw * rh, method: 'blur', detail: '邻域均值填充' };
  }

  function applyMedian(data, width, height, rx, ry, rw, rh, opts) {
    const radius = Math.max(1, Math.min(16, opts.radius || 3));

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
        const d = ((ry + y) * width + (rx + x)) * 4;
        if (bufR.length) {
          src[o] = median(bufR);
          src[o + 1] = median(bufG);
          src[o + 2] = median(bufB);
          src[o + 3] = data[d + 3];
        } else {
          src[o] = data[d]; src[o + 1] = data[d + 1]; src[o + 2] = data[d + 2]; src[o + 3] = data[d + 3];
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
    return { ok: true, error: '', changed: rw * rh, method: 'median', detail: '邻域中位数填充' };
  }

  function applyPatch(data, width, height, rx, ry, rw, rh, opts) {
    const px = opts.patchX === undefined || opts.patchX === null ? rx : Math.round(opts.patchX);
    const py = opts.patchY === undefined || opts.patchY === null ? ry : Math.round(opts.patchY);
    const dx = Math.round(opts.offsetX || 0);
    const dy = Math.round(opts.offsetY || 0);

    const srcX = px + dx;
    const srcY = py + dy;

    if (srcX < 0 || srcY < 0 || srcX + rw > width || srcY + rh > height) {
      return { ok: false, error: '取样区域超出图片范围，请调整偏移量', changed: 0, method: 'patch', detail: '' };
    }

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
    return { ok: true, error: '', changed: rw * rh, method: 'patch', detail: '手动补片（偏移 ' + dx + ', ' + dy + '）' };
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

    // 2. 连通域聚类（8 邻域，迭代式泛洪）
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

      // 3. 颜色统一性
      const avgR = sumR / count, avgG = sumG / count, avgB = sumB / count;
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
      const variance = n ? v / n : 0;

      const uniformity = 1 / (1 + Math.sqrt(variance) / 12);
      const density = count / (bw * bh);
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
    median: median,
    METHODS: METHODS
  };
})(window);
