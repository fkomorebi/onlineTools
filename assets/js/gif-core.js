/* ============================================
   GIF 编码核心
   —— 纯 JS 实现 GIF89a 编码器（无第三方依赖）

   浏览器原生只能编码静态位图，动画 GIF 必须自己写字节。
   这里实现了 GIF89a 所需的全部环节：

     1. 帧解码      —— 读取每张图片的 RGBA 像素
     2. 尺寸归一    —— 所有帧统一到同一画布尺寸（等比缩放 + 居中）
     3. 颜色量化    —— 中位切分（median cut）把 RGB 压到 N 色调色板
     4. 帧间差分    —— 逐帧与上一帧比较，裁掉未变化区域
     5. LZW 压缩    —— GIF 标准的变长码 LZW 编码
     6. 字节封装    —— 头部 / 逻辑屏 / 调色板 / 图形控制块 / 图像块 / 循环块

   纯函数 + 无 DOM 依赖，便于在 jsdom 与真实浏览器里测试。
   ============================================ */
(function (global) {
  'use strict';

  const GIF_SIGNATURE = 'GIF89a';

  /* ---------------- 字节写入器 ---------------- */

  /** 极简的字节缓冲区：按字节追加，避免大数组拼接的开销 */
  function ByteWriter(initial) {
    this.buf = new Uint8Array(initial || 1024);
    this.len = 0;
  }

  ByteWriter.prototype._ensure = function (extra) {
    if (this.len + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  };

  ByteWriter.prototype.byte = function (b) {
    this._ensure(1);
    this.buf[this.len++] = b & 0xff;
  };

  ByteWriter.prototype.bytes = function (arr) {
    this._ensure(arr.length);
    this.buf.set(arr, this.len);
    this.len += arr.length;
  };

  ByteWriter.prototype.short = function (v) {
    this._ensure(2);
    this.buf[this.len++] = v & 0xff;
    this.buf[this.len++] = (v >> 8) & 0xff;
  };

  ByteWriter.prototype.string = function (s) {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i) & 0xff);
  };

  /** 写入子块序列：每块最多 255 字节，以 0x00 结尾 */
  ByteWriter.prototype.subBlocks = function (data) {
    let off = 0;
    while (off < data.length) {
      const n = Math.min(255, data.length - off);
      this.byte(n);
      this.bytes(data.subarray(off, off + n));
      off += n;
    }
    this.byte(0);
  };

  ByteWriter.prototype.result = function () {
    return this.buf.subarray(0, this.len);
  };

  /* ---------------- 颜色量化（中位切分） ---------------- */

  /**
   * 统计一组帧的颜色直方图（量化到 5bit/通道，减少噪声与内存）。
   *
   * @param {Array<{pixels:Uint8ClampedArray,width:number,height:number}>} frames
   * @returns {Map<number, {n:number,r:number,g:number,b:number}>}
   */
  function buildHistogram(frames) {
    const hist = new Map();
    frames.forEach(function (f) {
      const px = f.pixels;
      const total = f.width * f.height;
      for (let i = 0; i < total; i++) {
        const p = i * 4;
        const a = px[p + 3];
        if (a < 8) continue; // 几乎全透明的像素不参与统计
        const r = px[p], g = px[p + 1], b = px[p + 2];
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        let e = hist.get(key);
        if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; hist.set(key, e); }
        e.n++;
        e.r += r; e.g += g; e.b += b;
      }
    });
    if (!hist.size) hist.set(0, { n: 1, r: 0, g: 0, b: 0 });
    return hist;
  }

  /**
   * 用中位切分从直方图里抽出不超过 maxColors 个代表色。
   *
   * @param {Map} hist 由 buildHistogram 统计出的直方图
   * @param {number} maxColors 目标颜色数（2..256）
   * @returns {number[][]} RGB 三元组数组
   */
  function quantizeFromHistogram(hist, maxColors) {
    maxColors = Math.max(2, Math.min(256, maxColors | 0));

    // 展开成像素列表（用平均色代表每个量化格子）
    const boxes = [];
    const items = [];
    hist.forEach(function (e, key) {
      const r = Math.round(e.r / e.n), g = Math.round(e.g / e.n), b = Math.round(e.b / e.n);
      items.push({ r: r, g: g, b: b, n: e.n, key: key });
    });
    boxes.push(makeBox(items));

    // 反复切分最"重"的盒子，直到颜色数达标
    while (boxes.length < maxColors) {
      // 找到像素数最多且还能切的盒子
      let target = -1;
      let bestCount = 0;
      for (let i = 0; i < boxes.length; i++) {
        const bx = boxes[i];
        if (bx.items.length < 2) continue;
        if (bx.items.length > bestCount) { bestCount = bx.items.length; target = i; }
      }
      if (target < 0) break; // 没有可再切的盒子了

      const bx = boxes[target];
      const split = splitBox(bx);
      boxes.splice(target, 1, split[0], split[1]);
    }

    // 每个盒子取加权平均色作为调色板条目
    return boxes.map(function (bx) {
      let r = 0, g = 0, b = 0, n = 0;
      bx.items.forEach(function (it) {
        r += it.r * it.n; g += it.g * it.n; b += it.b * it.n; n += it.n;
      });
      if (!n) return [0, 0, 0];
      return [
        Math.min(255, Math.round(r / n)),
        Math.min(255, Math.round(g / n)),
        Math.min(255, Math.round(b / n))
      ];
    });
  }

  /**
   * 在 RGB 空间里做中位切分，抽取不超过 maxColors 个代表色。
   * 相比八叉树，它对渐变图的还原度更稳定。
   *
   * @param {Uint8ClampedArray|Uint8Array} pixels  RGBA 像素，长度 = w*h*4
   * @param {number} w
   * @param {number} h
   * @param {number} maxColors 目标颜色数（2..256）
   * @returns {{palette: number[][], map: Uint8Array}} palette 为 RGB 三元组数组
   */
  function quantize(pixels, w, h, maxColors) {
    const hist = buildHistogram([{ pixels: pixels, width: w, height: h }]);
    const palette = quantizeFromHistogram(hist, maxColors);
    const lut = buildLookup(palette);
    const map = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const p = i * 4;
      const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2];
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      map[i] = lut[key];
    }

    return { palette: palette, map: map };
  }

  /** 把一个颜色集合包成可切分的盒子 */
  function makeBox(items) {
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.r < rmin) rmin = it.r;
      if (it.r > rmax) rmax = it.r;
      if (it.g < gmin) gmin = it.g;
      if (it.g > gmax) gmax = it.g;
      if (it.b < bmin) bmin = it.b;
      if (it.b > bmax) bmax = it.b;
    }
    return {
      items: items,
      rmin: rmin, rmax: rmax,
      gmin: gmin, gmax: gmax,
      bmin: bmin, bmax: bmax
    };
  }

  /** 按最长边把盒子切成两半 */
  function splitBox(box) {
    const items = box.items;
    const rRange = box.rmax - box.rmin;
    const gRange = box.gmax - box.gmin;
    const bRange = box.bmax - box.bmin;

    // 优先按"人群分布"排序：沿最长边排序后在中位处切开
    let axis = 'r';
    if (gRange > rRange && gRange >= bRange) axis = 'g';
    else if (bRange > rRange && bRange > gRange) axis = 'b';

    items.sort(function (a, b) {
      return (a[axis] - b[axis]) || (a.n - b.n);
    });

    const mid = Math.floor(items.length / 2);
    return [makeBox(items.slice(0, mid)), makeBox(items.slice(mid))];
  }

  /**
   * 预计算 15bit 颜色索引 → 调色板编号 的查找表（32768 项），
   * 这样量化后给每个像素找色就是一次数组取值，不用逐像素搜索。
   */
  function buildLookup(palette) {
    const lut = new Uint8Array(32768);
    for (let key = 0; key < 32768; key++) {
      const r = ((key >> 10) & 31) << 3;
      const g = ((key >> 5) & 31) << 3;
      const b = (key & 31) << 3;
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < palette.length; i++) {
        const c = palette[i];
        const dr = r - c[0], dg = g - c[1], db = b - c[2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) { bestDist = d; best = i; }
      }
      lut[key] = best;
    }
    return lut;
  }

  /* ---------------- LZW 压缩 ---------------- */

  /**
   * GIF 变长码 LZW 编码。
   * GIF 的字典从 258 开始（0..255 为字面量，256=清表，257=结束）。
   *
   * @param {Uint8Array} indices 像素索引（每像素一个 0..255 的值）
   * @param {number} minCodeSize LZW 最小码长（= 调色板位数，通常 2..8）
   * @returns {Uint8Array} 已按 GIF 子块格式打包的数据
   */
  function lzwEncode(indices, minCodeSize) {
    if (minCodeSize < 2) minCodeSize = 2;

    // 清表 / 结束码随最小码长变化：
    //   码长 8 → CLEAR=256, EOI=257
    //   码长 4 → CLEAR=16,  EOI=17
    const CLEAR = 1 << minCodeSize;
    const EOI = CLEAR + 1;

    // 字典：键为 "前缀码<<8 | 下一个字节"，值为该串的码
    const dict = new Map();
    let nextCode = EOI + 1;
    let codeSize = minCodeSize + 1;

    const out = new ByteWriter(indices.length * 2);
    let bitBuffer = 0;
    let bitCount = 0;

    function emit(code) {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        out.byte(bitBuffer & 0xff);
        bitBuffer >>>= 8;
        bitCount -= 8;
      }
    }

    function resetDict() {
      dict.clear();
      nextCode = EOI + 1;
      codeSize = minCodeSize + 1;
    }

    // 起始：输出清表信号
    emit(CLEAR);
    resetDict();

    let prefix = indices.length ? indices[0] : null;

    // 码宽增长规则（与 giflib 一致）：
    //   字典里每多一个条目就可能需要多一位来编码。
    //   当 nextCode 达到 1 << codeSize 时，码宽加 1（最多 12 位）。
    //   例如码宽 9 位时能表示 0..511，字典用到第 512 项时就需要 10 位了。
    function growIfNeeded() {
      if (nextCode === (1 << codeSize) && codeSize < 12) {
        codeSize++;
      }
    }

    // pending：刚刚发现、但还没写进字典的新条目。
    //
    // 解码器要等读到「下一个码」才能补上这一条，
    // 而编码器如果立刻写进去，两边的字典就会差一条，
    // 码宽增长点对不上，解出来的像素会整体错位。
    //
    // 所以这里把新条目先挂在 pending 上：
    //   · 查找时同时看字典和 pending，保证压缩率不受影响
    //   · 真正写入推迟到下一次失配，与解码器的节奏对齐
    let pending = null;
    let pendingCode = 0;

    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;

      // 查找：字典里没有的话，看是不是刚才挂起的那一条
      let found = dict.get(key);
      if (found === undefined && pending !== null && pending === key) {
        found = pendingCode;
      }

      if (found !== undefined) {
        prefix = found;
        continue;
      }

      // 失配：输出当前前缀，并把 (prefix + k) 作为新条目挂起
      emit(prefix);

      // 上一轮挂起的条目，此刻写进字典（与解码器同步）
      if (pending !== null) {
        dict.set(pending, nextCode);
        nextCode++;

        if (nextCode > 4095) {
          // 字典满了 → 清表重来
          emit(CLEAR);
          resetDict();
          pending = null;
          // 清表后 prefix 必须退回成字面量，
          // 否则会发出一个解码器字典里不存在的码
          prefix = k;
          continue;
        }

        growIfNeeded();
      }

      pending = key;
      pendingCode = nextCode;
      prefix = k;
    }

    // 输出最后一个前缀码
    if (prefix !== null) emit(prefix);
    emit(EOI);

    // 冲刷剩余位
    if (bitCount > 0) out.byte(bitBuffer & 0xff);

    // 包成 GIF 子块
    const w = new ByteWriter(out.len + out.len / 255 + 16);
    w.byte(minCodeSize);
    w.subBlocks(out.result());
    return w.result();
  }

  /* ---------------- 帧准备 ---------------- */

  /**
   * 把若干帧画到统一画布上（同尺寸、同背景色）。
   *
   * @param {Array<{pixels:Uint8ClampedArray,width:number,height:number}>} frames
   * @param {object} opts
   *   - width / height: 画布尺寸
   *   - fit: 'contain'（等比缩放并居中，默认）| 'fill'（拉伸铺满）| 'cover'
   *   - background: [r,g,b] 画布底色
   * @returns {Array<{pixels:Uint8ClampedArray,width:number,height:number}>}
   */
  function normalizeFrames(frames, opts) {
    opts = opts || {};
    const W = Math.max(1, opts.width | 0);
    const H = Math.max(1, opts.height | 0);
    const bg = opts.background || [255, 255, 255];
    const fit = opts.fit || 'contain';

    return frames.map(function (f) {
      const out = new Uint8ClampedArray(W * H * 4);

      // 先铺底色
      for (let i = 0; i < W * H; i++) {
        const p = i * 4;
        out[p] = bg[0]; out[p + 1] = bg[1]; out[p + 2] = bg[2]; out[p + 3] = 255;
      }

      let dx = 0, dy = 0, dw = W, dh = H;

      if (fit === 'fill') {
        dw = W; dh = H;
      } else {
        const scale = Math.min(W / f.width, H / f.height);
        dw = Math.max(1, Math.round(f.width * scale));
        dh = Math.max(1, Math.round(f.height * scale));
        dx = Math.round((W - dw) / 2);
        dy = Math.round((H - dh) / 2);
      }

      // 最近邻 / 双线性采样：这里用简单双线性，缩小时不会丢细节
      sampleInto(f, out, W, H, dx, dy, dw, dh);

      return { pixels: out, width: W, height: H };
    });
  }

  /** 把一帧按给定目标矩形双线性缩放绘制到 out 上 */
  function sampleInto(frame, out, W, H, dx, dy, dw, dh) {
    const src = frame.pixels;
    const sw = frame.width, sh = frame.height;

    for (let y = 0; y < dh; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= H) continue;

      // 源图上的纵向位置（映射到像素中心）
      const sy = Math.min(sh - 1, Math.max(0, ((y + 0.5) / dh) * sh - 0.5));
      const y0 = Math.floor(sy);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fy = sy - y0;

      for (let x = 0; x < dw; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= W) continue;

        const sx = Math.min(sw - 1, Math.max(0, ((x + 0.5) / dw) * sw - 0.5));
        const x0 = Math.floor(sx);
        const x1 = Math.min(sw - 1, x0 + 1);
        const fx = sx - x0;

        const i00 = (y0 * sw + x0) * 4;
        const i01 = (y0 * sw + x1) * 4;
        const i10 = (y1 * sw + x0) * 4;
        const i11 = (y1 * sw + x1) * 4;

        const w00 = (1 - fx) * (1 - fy);
        const w01 = fx * (1 - fy);
        const w10 = (1 - fx) * fy;
        const w11 = fx * fy;

        const o = (ty * W + tx) * 4;
        for (let c = 0; c < 3; c++) {
          out[o + c] = src[i00 + c] * w00 + src[i01 + c] * w01 +
                       src[i10 + c] * w10 + src[i11 + c] * w11;
        }
        const a00 = src[i00 + 3] * w00 + src[i01 + 3] * w01 +
                   src[i10 + 3] * w10 + src[i11 + 3] * w11;
        out[o + 3] = a00;
      }
    }
  }

  /**
   * 帧间差分：找出与上一帧不同的矩形区域，并只编码该区域。
   * 返回 null 表示这一帧与上一帧完全相同（可跳过）。
   *
   * @returns {{x:number,y:number,width:number,height:number,indices:Uint8Array}|null}
   */
  function diffFrame(cur, prev, curMap, prevMap) {
    const W = cur.width, H = cur.height;
    let minX = W, minY = H, maxX = -1, maxY = -1;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (curMap[i] !== prevMap[i]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0) return null; // 完全没变化

    const dw = maxX - minX + 1;
    const dh = maxY - minY + 1;
    const indices = new Uint8Array(dw * dh);
    for (let y = 0; y < dh; y++) {
      const src = (minY + y) * W + minX;
      indices.set(curMap.subarray(src, src + dw), y * dw);
    }

    return { x: minX, y: minY, width: dw, height: dh, indices: indices };
  }

  /* ---------------- GIF 组装 ---------------- */

  /**
   * 把若干帧编码成动画 GIF。
   *
   * @param {Array<{pixels:Uint8ClampedArray,width:number,height:number}>} frames
   * @param {object} opts
   *   - width / height: 输出画布尺寸（默认取第一帧尺寸）
   *   - delay: 每帧延时（毫秒）
   *   - loop: 循环次数（0 = 无限循环）
   *   - colors: 调色板颜色数（2..256）
   *   - optimize: 是否启用帧间差分
   *   - fit: 'contain' | 'fill'
   *   - background: [r,g,b]
   * @returns {Uint8Array} 完整的 GIF 文件字节
   */
  function encodeGif(frames, opts) {
    opts = opts || {};
    if (!frames || !frames.length) {
      throw new Error('没有可编码的帧');
    }

    const W = Math.max(1, opts.width || frames[0].width);
    const H = Math.max(1, opts.height || frames[0].height);
    const colors = Math.max(2, Math.min(256, opts.colors || 256));
    // 延时字段在 GIF 里以 1/100 秒为单位，最大 65535（约 10.9 分钟）。
    // 这里以毫秒为单位接收，换算后限制在 20ms ~ 655350ms。
    const delay = Math.max(20, Math.min(655350, opts.delay || 100));
    const optimize = opts.optimize !== false;

    // 1. 统一到同一画布
    const norm = normalizeFrames(frames, {
      width: W, height: H, fit: opts.fit || 'contain',
      background: opts.background || [255, 255, 255]
    });

    // 2. 量化
    //
    // 所有帧必须共用同一套调色板。原因是帧间差分比较的是「调色板索引」，
    // 如果每帧各自量化，同一种颜色在不同帧里会得到不同索引，
    // 差分就会把整幅画面都当成变化，既算不出真正的差异区域，
    // 也无法判断两帧是否完全相同。
    //
    // 做法：先把所有帧的像素汇总起来做一次量化，得到全局调色板，
    // 再用同一套调色板去映射每一帧。
    //
    // 为了省内存，这里不额外拷贝一份合并后的像素 ——
    // 统计直方图时逐帧累加即可。
    const hist = buildHistogram(norm);
    const palette = quantizeFromHistogram(hist, colors);
    const maps = norm.map(function (f) {
      return remapToPalette(f, palette);
    });

    // 调色板大小必须是 2 的幂（GIF 规范要求）
    const paletteSize = Math.max(2, Math.min(256, nextPow2(palette.length)));
    while (palette.length < paletteSize) palette.push([0, 0, 0]);

    const bitsPerPixel = Math.max(1, Math.log2(paletteSize));
    const minCodeSize = Math.max(2, bitsPerPixel);

    // 3. 组装文件
    const w = new ByteWriter(1 << 16);
    w.string(GIF_SIGNATURE);

    // 逻辑屏描述符
    w.short(W);
    w.short(H);
    // 全局调色板标志 | 颜色分辨率 | 排序标志 | 位深
    w.byte(0x80 | (7 << 4) | (bitsPerPixel - 1));
    w.byte(0); // 背景色索引
    w.byte(0); // 像素宽高比

    // 全局调色板
    for (let i = 0; i < paletteSize; i++) {
      const c = palette[i];
      w.byte(c[0]); w.byte(c[1]); w.byte(c[2]);
    }

    // Netscape 2.0 循环块
    if (norm.length > 1) {
      w.byte(0x21); w.byte(0xff); w.byte(11);
      w.string('NETSCAPE2.0');
      w.byte(3); w.byte(1);
      // 循环块里的数字是「额外重复的次数」，
      // 所以「总共播放 N 次」对应 N-1 次重复；0 表示无限循环。
      const loop = Math.max(0, opts.loop || 0);
      w.short(loop === 0 ? 0 : loop - 1);
      w.byte(0);
    }

    // 4. 逐帧写出
    let prevMap = null;

    for (let i = 0; i < norm.length; i++) {
      let rect = null;
      let identical = false;

      if (optimize && prevMap) {
        rect = diffFrame(norm[i], norm[i - 1], maps[i], prevMap);
        identical = !rect;
      } else {
        rect = {
          x: 0, y: 0, width: W, height: H,
          indices: maps[i]
        };
      }

      prevMap = maps[i];

      if (identical) {
        // 与上一帧完全相同：写一个 1×1 的透明像素块占位，
        // 这样帧数与总时长都保持正确，只是几乎不占体积。
        // 注意这里必须置上「透明色标志」，否则这个像素会被画出来。
        w.byte(0x21); w.byte(0xf9); w.byte(4);
        w.byte((1 << 2) | 1); // 处置方式 1 + 透明色标志
        w.short(Math.round(delay / 10));
        w.byte(0); // 透明色索引
        w.byte(0); // 块结束

        w.byte(0x2c);
        w.short(0); w.short(0);
        w.short(1); w.short(1);
        w.byte(0);
        w.bytes(lzwEncode(new Uint8Array([0]), minCodeSize));
        continue;
      }

      // 图形控制扩展：延时 + 处置方式
      //
      // 处置方式用 1（Do not dispose）而不是 2（Restore to background）：
      // 差分帧只画了变化的那块矩形，若用 2 会把这块矩形之外的区域清成背景色，
      // 播放时画面会「一块一块」地闪。用 1 则上一帧的画面原样保留，
      // 差分帧叠上去正好得到完整画面。
      //
      // 这里不能置「透明色标志」——普通帧的像素都是真实颜色，
      // 若把调色板第 0 号色标成透明，整帧就变成空白了。
      w.byte(0x21); w.byte(0xf9); w.byte(4);
      w.byte(1 << 2); // 处置方式 1
      w.short(Math.round(delay / 10)); // 延时单位是 1/100 秒
      w.byte(0); // 透明色索引（未启用透明，无意义）
      w.byte(0); // 块结束

      // 图像描述符
      w.byte(0x2c);
      w.short(rect.x); w.short(rect.y);
      w.short(rect.width); w.short(rect.height);
      w.byte(0); // 无局部调色板，非交错

      // LZW 压缩的索引数据
      const data = lzwEncode(rect.indices, minCodeSize);
      w.bytes(data);
    }

    // 文件结束符
    w.byte(0x3b);

    return w.result();
  }

  /** 把一帧的像素重新映射到给定调色板（共享调色板模式用） */
  function remapToPalette(frame, palette) {
    const lut = buildLookup(palette);
    const px = frame.pixels;
    const map = new Uint8Array(frame.width * frame.height);
    for (let i = 0; i < map.length; i++) {
      const p = i * 4;
      const key = ((px[p] >> 3) << 10) | ((px[p + 1] >> 3) << 5) | (px[p + 2] >> 3);
      map[i] = lut[key];
    }
    return map;
  }

  /** 下一个不小于 n 的 2 的幂 */
  function nextPow2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  /* ---------------- 浏览器端取帧 ---------------- */

  /**
   * 从图片文件读出原始 RGBA 像素。
   * 走 blob URL 而不是 data URL，可以避免大图触发 data URL 长度限制。
   *
   * @param {Blob} blob
   * @returns {Promise<{pixels:Uint8ClampedArray,width:number,height:number}>}
   */
  function readFrame(blob) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = function () {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) {
          URL.revokeObjectURL(url);
          reject(new Error('图片尺寸无效'));
          return;
        }
        try {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, w, h).data;
          URL.revokeObjectURL(url);
          resolve({ pixels: data, width: w, height: h });
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(new Error('无法读取图片像素：' + (e && e.message ? e.message : '未知错误')));
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片解码失败'));
      };
      img.src = url;
    });
  }

  /**
   * 逐个读取多个文件的帧。
   * 单帧失败不会中断整体流程，失败的会被收集在 failures 里。
   *
   * @param {Array<{file:File,name:string}>} items
   * @param {function(number,number)} onProgress 已完成数 / 总数
   * @returns {Promise<{frames:Array, failures:Array}>}
   */
  function readFrames(items, onProgress) {
    const frames = [];
    const failures = [];
    let done = 0;

    return items.reduce(function (chain, item) {
      return chain.then(function () {
        return readFrame(item.file).then(function (f) {
          frames.push({
            pixels: f.pixels,
            width: f.width,
            height: f.height,
            name: item.name,
            file: item.file
          });
        }).catch(function (e) {
          failures.push({
            name: item.name,
            message: e && e.message ? e.message : '读取失败'
          });
        }).then(function () {
          done++;
          if (onProgress) onProgress(done, items.length);
        });
      });
    }, Promise.resolve()).then(function () {
      return { frames: frames, failures: failures };
    });
  }

  /* ---------------- 对外接口 ---------------- */

  global.GifCore = {
    GIF_SIGNATURE: GIF_SIGNATURE,
    quantize: quantize,
    quantizeFromHistogram: quantizeFromHistogram,
    buildHistogram: buildHistogram,
    lzwEncode: lzwEncode,
    normalizeFrames: normalizeFrames,
    diffFrame: diffFrame,
    encodeGif: encodeGif,
    nextPow2: nextPow2,
    buildLookup: buildLookup,
    readFrame: readFrame,
    readFrames: readFrames
  };
})(typeof window !== 'undefined' ? window : globalThis);
