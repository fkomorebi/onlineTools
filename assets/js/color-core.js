/* ============================================
   颜色工具 —— 核心算法（纯 JS，无依赖）
   ============================================ */
(function (global) {
  'use strict';

  /**
   * 解析颜色
   * 支持：#rgb / #rgba / #rrggbb / #rrggbbaa / rgb() / rgba() / hsl() / hsla()
   *
   * @param {string} input
   * @returns {{r:number,g:number,b:number,a:number}|null}
   */
  function parse(input) {
    const s = String(input == null ? '' : input).trim();
    if (!s) return null;

    // #hex
    if (s[0] === '#') {
      const hex = s.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
        if ([r, g, b].some(isNaN)) return null;
        return { r: r, g: g, b: b, a: a };
      }
      if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
        if ([r, g, b, a].some(isNaN)) return null;
        return { r: r, g: g, b: b, a: a };
      }
      return null;
    }

    const fn = s.match(/^([a-z]+)\s*\(([^)]*)\)$/i);
    if (!fn) return null;
    const name = fn[1].toLowerCase();
    const parts = fn[2].split(/[,/\s]+/).filter(function (p) { return p !== ''; });

    if (name === 'rgb' || name === 'rgba') {
      if (parts.length < 3) return null;
      const r = clampByte(parseNum(parts[0]));
      const g = clampByte(parseNum(parts[1]));
      const b = clampByte(parseNum(parts[2]));
      let a = 1;
      if (parts.length >= 4) {
        const raw = parts[3];
        a = raw.indexOf('%') !== -1 ? parseFloat(raw) / 100 : parseFloat(raw);
        if (isNaN(a)) a = 1;
        a = Math.max(0, Math.min(1, a));
      }
      return { r: r, g: g, b: b, a: a };
    }

    if (name === 'hsl' || name === 'hsla') {
      if (parts.length < 3) return null;
      const h = parseFloat(parts[0]);
      // hslToRgb 内部会把 s/l 当作 0–100 的百分数处理，这里不要再除以 100
      const sat = parseFloat(parts[1]);
      const lig = parseFloat(parts[2]);
      if (isNaN(h) || isNaN(sat) || isNaN(lig)) return null;
      let a = 1;
      if (parts.length >= 4) {
        const raw = parts[3];
        a = raw.indexOf('%') !== -1 ? parseFloat(raw) / 100 : parseFloat(raw);
        if (isNaN(a)) a = 1;
        a = Math.max(0, Math.min(1, a));
      }
      const rgb = hslToRgb(((h % 360) + 360) % 360, sat, lig);
      return { r: rgb.r, g: rgb.g, b: rgb.b, a: a };
    }

    return null;
  }

  function parseNum(v) {
    const s = String(v).trim();
    return s.indexOf('%') !== -1 ? (parseFloat(s) / 100) * 255 : parseFloat(s);
  }

  function clampByte(v) {
    if (isNaN(v)) return 0;
    return Math.max(0, Math.min(255, Math.round(v)));
  }

  /**
   * 颜色格式互转
   * @param {{r:number,g:number,b:number,a:number}} c
   */
  function toFormats(c) {
    const hex = toHex(c);
    const hsl = rgbToHsl(c.r, c.g, c.b);
    const cmyk = rgbToCmyk(c.r, c.g, c.b);
    return {
      hex: hex,
      hexAlpha: toHex(c, true),
      rgb: 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')',
      rgba: 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + round(c.a, 3) + ')',
      hsl: 'hsl(' + Math.round(hsl.h) + ', ' + Math.round(hsl.s) + '%, ' + Math.round(hsl.l) + '%)',
      hsla: 'hsla(' + Math.round(hsl.h) + ', ' + Math.round(hsl.s) + '%, ' + Math.round(hsl.l) + '%, ' + round(c.a, 3) + ')',
      cmyk: 'cmyk(' + Math.round(cmyk.c * 100) + '%, ' + Math.round(cmyk.m * 100) + '%, ' +
        Math.round(cmyk.y * 100) + '%, ' + Math.round(cmyk.k * 100) + '%)',
      r: c.r, g: c.g, b: c.b, a: c.a,
      hue: hsl.h, sat: hsl.s, lig: hsl.l
    };
  }

  /** 转 HEX（可选带 alpha） */
  function toHex(c, withAlpha) {
    const h = hex2(c.r) + hex2(c.g) + hex2(c.b);
    if (!withAlpha) return '#' + h;
    return '#' + h + hex2(Math.round(c.a * 255));
  }

  function hex2(n) {
    const v = Math.max(0, Math.min(255, Math.round(n)));
    return v.toString(16).padStart(2, '0');
  }

  /** RGB → HSL */
  function rgbToHsl(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    const d = max - min;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break;
        case gn: h = ((bn - rn) / d + 2); break;
        default: h = ((rn - gn) / d + 4);
      }
      h *= 60;
    }
    return { h: h, s: s * 100, l: l * 100 };
  }

  /** HSL → RGB */
  function hslToRgb(h, s, l) {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rp = 0, gp = 0, bp = 0;
    if (h < 60) { rp = c; gp = x; }
    else if (h < 120) { rp = x; gp = c; }
    else if (h < 180) { gp = c; bp = x; }
    else if (h < 240) { gp = x; bp = c; }
    else if (h < 300) { rp = x; bp = c; }
    else { rp = c; bp = x; }
    return {
      r: Math.round((rp + m) * 255),
      g: Math.round((gp + m) * 255),
      b: Math.round((bp + m) * 255)
    };
  }

  /** RGB → CMYK */
  function rgbToCmyk(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const k = 1 - Math.max(rn, gn, bn);
    if (k === 1) return { c: 0, m: 0, y: 0, k: 1 };
    return {
      c: (1 - rn - k) / (1 - k),
      m: (1 - gn - k) / (1 - k),
      y: (1 - bn - k) / (1 - k),
      k: k
    };
  }

  /** CMYK → RGB */
  function cmykToRgb(c, m, y, k) {
    return {
      r: Math.round(255 * (1 - c) * (1 - k)),
      g: Math.round(255 * (1 - m) * (1 - k)),
      b: Math.round(255 * (1 - y) * (1 - k))
    };
  }

  /**
   * 相对亮度（WCAG 2.x 定义）
   * @param {{r:number,g:number,b:number}} c
   */
  function luminance(c) {
    const a = [c.r, c.g, c.b].map(function (v) {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  /**
   * 对比度
   * @returns {number} 1 ~ 21
   */
  function contrast(c1, c2) {
    const l1 = luminance(c1);
    const l2 = luminance(c2);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  /**
   * WCAG 对比度检查
   * @param {{r,g,b}} fg
   * @param {{r,g,b}} bg
   * @param {'normal'|'large'} textSize
   * @returns {{ratio:number, aa:boolean, aaa:boolean, aaLarge:boolean, aaaLarge:boolean, summary:string}}
   */
  function wcag(fg, bg, textSize) {
    const ratio = contrast(fg, bg);
    const large = textSize === 'large';
    const aa = large ? ratio >= 3 : ratio >= 4.5;
    const aaa = large ? ratio >= 4.5 : ratio >= 7;
    const aaLarge = ratio >= 3;
    const aaaLarge = ratio >= 4.5;
    return {
      ratio: round(ratio, 2),
      aa: aa,
      aaa: aaa,
      aaLarge: aaLarge,
      aaaLarge: aaaLarge,
      summary: aa
        ? (aaa ? 'AAA 通过' : 'AA 通过')
        : (aaLarge ? 'AA 通过（大字）' : '未通过')
    };
  }

  /** 生成调色板：色调 / 饱和度 / 明度 的明暗变体 */
  function shades(color, steps) {
    const n = steps || 9;
    const hsl = rgbToHsl(color.r, color.g, color.b);
    const out = [];
    for (let i = 0; i < n; i++) {
      const l = (i + 1) / (n + 1) * 100;
      const rgb = hslToRgb(hsl.h, hsl.s, l);
      out.push({
        level: Math.round(l),
        hex: toHex({ r: rgb.r, g: rgb.g, b: rgb.b, a: 1 }),
        rgb: rgb
      });
    }
    return out;
  }

  /** 类比色：主色 ± 30° */
  function analogous(color, spread) {
    const step = spread || 30;
    const hsl = rgbToHsl(color.r, color.g, color.b);
    const out = [];
    [-step, step].forEach(function (delta) {
      const h = ((hsl.h + delta) % 360 + 360) % 360;
      const rgb = hslToRgb(h, hsl.s, hsl.l);
      out.push({
        hue: Math.round(h),
        hex: toHex({ r: rgb.r, g: rgb.g, b: rgb.b, a: 1 }),
        rgb: rgb
      });
    });
    return out;
  }

  /** 互补色：色相 + 180° */
  function complementary(color) {
    const hsl = rgbToHsl(color.r, color.g, color.b);
    const h = (hsl.h + 180) % 360;
    const rgb = hslToRgb(h, hsl.s, hsl.l);
    return {
      hue: Math.round(h),
      hex: toHex({ r: rgb.r, g: rgb.g, b: rgb.b, a: 1 }),
      rgb: rgb
    };
  }

  /** 三角配色：+120° / +240° */
  function triadic(color) {
    const hsl = rgbToHsl(color.r, color.g, color.b);
    return [120, 240].map(function (delta) {
      const h = (hsl.h + delta) % 360;
      const rgb = hslToRgb(h, hsl.s, hsl.l);
      return {
        hue: Math.round(h),
        hex: toHex({ r: rgb.r, g: rgb.g, b: rgb.b, a: 1 }),
        rgb: rgb
      };
    });
  }

  /** 随机颜色（基于 crypto 随机源） */
  function random(rng) {
    const source = rng || function (buf) {
      const c = global.crypto || global.msCrypto;
      if (c && c.getRandomValues) c.getRandomValues(buf);
      else for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 0x100000000);
    };
    const buf = new Uint32Array(1);
    source(buf);
    return {
      r: (buf[0] & 0xff),
      g: ((buf[0] >>> 8) & 0xff),
      b: ((buf[0] >>> 16) & 0xff),
      a: 1
    };
  }

  /** 在 HSL 空间生成和谐配色 */
  function randomPalette(count, rng) {
    const n = count || 5;
    const buf = new Uint32Array(1);
    const source = rng || function (b) {
      const c = global.crypto || global.msCrypto;
      if (c && c.getRandomValues) c.getRandomValues(b);
      else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 0x100000000);
    };
    source(buf);
    const baseHue = buf[0] % 360;
    const out = [];
    for (let i = 0; i < n; i++) {
      source(buf);
      const h = (baseHue + (360 / n) * i) % 360;
      const s = 45 + (buf[0] % 35);
      source(buf);
      const l = 40 + (buf[0] % 30);
      const rgb = hslToRgb(h, s, l);
      out.push({
        hex: toHex({ r: rgb.r, g: rgb.g, b: rgb.b, a: 1 }),
        rgb: rgb,
        hsl: { h: Math.round(h), s: s, l: l }
      });
    }
    return out;
  }

  function round(v, digits) {
    const p = Math.pow(10, digits == null ? 2 : digits);
    return Math.round(v * p) / p;
  }

  global.ColorCore = {
    parse: parse,
    toFormats: toFormats,
    toHex: toHex,
    rgbToHsl: rgbToHsl,
    hslToRgb: hslToRgb,
    rgbToCmyk: rgbToCmyk,
    cmykToRgb: cmykToRgb,
    luminance: luminance,
    contrast: contrast,
    wcag: wcag,
    shades: shades,
    analogous: analogous,
    complementary: complementary,
    triadic: triadic,
    random: random,
    randomPalette: randomPalette
  };
})(window);
