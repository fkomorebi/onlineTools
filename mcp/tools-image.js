/* ============================================
   MCP 工具层 —— 图片类
   ----------------------------------------------------------
   解码 / 编码用 sharp（libvips），GIF 合成与去水印算法
   直接复用网站的 `assets/js/gif-core.js`、`watermark-core.js`。
   ============================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { core } = require('./core-loader');

let sharp = null;
function getSharp() {
  if (!sharp) {
    try {
      sharp = require('sharp');
    } catch (e) {
      throw new Error('图片工具需要 sharp 依赖：npm install sharp');
    }
  }
  return sharp;
}

function fail(error) {
  return { ok: false, error: String(error == null ? '未知错误' : error) };
}

/** 读出文件的绝对路径 */
function resolvePath(p) {
  if (!p) throw new Error('缺少 path 参数');
  return path.resolve(String(p));
}

/** 生成一个默认的输出路径 */
function defaultOutput(inputPath, ext) {
  const dir = path.join(os.tmpdir(), 'online-tools-mcp');
  const base = path.basename(inputPath, path.extname(inputPath));
  return path.join(dir, base + '.' + ext);
}

/** 读图片 → RGBA 原始像素 */
async function readPixels(file) {
  const s = getSharp();
  const { data, info } = await s(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    pixels: new Uint8ClampedArray(data),
    width: info.width,
    height: info.height
  };
}

/** 把 RGBA 像素写成文件 */
async function writePixels(file, pixels, width, height, format, quality) {
  const s = getSharp();
  let pipeline = s(pixels, { raw: { width, height, channels: 4 } });
  switch (format) {
    case 'png':
      pipeline = pipeline.png();
      break;
    case 'jpeg':
      pipeline = pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: quality || 90 });
      break;
    case 'webp':
      pipeline = pipeline.webp({ quality: quality || 90 });
      break;
    case 'avif':
      pipeline = pipeline.avif({ quality: quality || 90 });
      break;
    default:
      pipeline = pipeline.png();
  }
  await pipeline.toFile(file);
}

/* ---------------------------------------------------------- */
/*  图片压缩                                                  */
/* ---------------------------------------------------------- */

async function imageCompress(input) {
  try {
    const s = getSharp();
    const file = resolvePath(input.path);
    if (!fs.existsSync(file)) return fail('文件不存在：' + file);

    const original = fs.statSync(file).size;
    const format = input.format || 'webp';
    const quality = Math.max(1, Math.min(100, input.quality || 80));

    let pipeline = s(file);
    if (input.maxWidth || input.maxHeight) {
      pipeline = pipeline.resize({
        width: input.maxWidth || undefined,
        height: input.maxHeight || undefined,
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    const outFile = input.outputPath ? resolvePath(input.outputPath) : defaultOutput(file, format);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });

    // 目标体积模式：二分搜索画质逼近上限（与网站逻辑一致）
    if (input.targetBytes && input.targetBytes > 0) {
      let lo = 1, hi = 100, best = null;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const tmp = outFile + '.probe';
        await buildAndWrite(pipeline, tmp, format, mid);
        const size = fs.statSync(tmp).size;
        fs.unlinkSync(tmp);
        if (size <= input.targetBytes) {
          best = { quality: mid, size };
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (!best) {
        // 最低画质仍超目标 —— 用最低画质输出并说明
        await buildAndWrite(pipeline, outFile, format, 1);
      } else {
        await buildAndWrite(pipeline, outFile, format, best.quality);
      }
    } else {
      await buildAndWrite(pipeline, outFile, format, quality);
    }

    const compressed = fs.statSync(outFile).size;
    return {
      ok: true,
      inputPath: file,
      outputPath: outFile,
      format: format,
      originalBytes: original,
      compressedBytes: compressed,
      savedBytes: original - compressed,
      savedPercent: original > 0
        ? Math.round((1 - compressed / original) * 1000) / 10
        : 0
    };
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * 按格式写出 pipeline。
 * imageConvert 支持 png / webp / jpeg / avif 四种目标格式，
 * imageCompress 只用 webp / jpeg / png —— 压缩目标不含 avif。
 */
async function buildAndWrite(pipeline, outFile, format, quality) {
  let p = pipeline;
  switch (format) {
    case 'jpeg':
      p = p.flatten({ background: '#ffffff' }).jpeg({ quality });
      break;
    case 'png':
      p = p.png({ compressionLevel: 9 });
      break;
    case 'webp':
      p = p.webp({ quality });
      break;
    case 'avif':
      p = p.avif({ quality });
      break;
    default:
      p = p.webp({ quality });
  }
  await p.toFile(outFile);
}

/* ---------------------------------------------------------- */
/*  图片格式转换                                              */
/* ---------------------------------------------------------- */

async function imageConvert(input) {
  try {
    const file = resolvePath(input.path);
    if (!fs.existsSync(file)) return fail('文件不存在：' + file);

    const original = fs.statSync(file).size;
    const format = String(input.format || 'png').toLowerCase();
    const outFile = input.outputPath
      ? resolvePath(input.outputPath)
      : defaultOutput(file, format === 'jpeg' ? 'jpg' : format);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });

    await buildAndWrite(getSharp()(file), outFile, format, input.quality);

    const converted = fs.statSync(outFile).size;
    return {
      ok: true,
      inputPath: file,
      outputPath: outFile,
      format: format,
      originalBytes: original,
      convertedBytes: converted,
      savedPercent: original > 0
        ? Math.round((1 - converted / original) * 1000) / 10
        : 0
    };
  } catch (e) {
    return fail(e.message);
  }
}

/* ---------------------------------------------------------- */
/*  多图合成 GIF                                              */
/* ---------------------------------------------------------- */

async function imageGif(input) {
  try {
    const GifCore = core('GifCore');
    if (!GifCore) return fail('GIF 核心模块不可用');

    const paths = Array.isArray(input.paths) ? input.paths : [];
    if (!paths.length) return fail('paths 不能为空');

    const frames = [];
    for (const p of paths) {
      const file = resolvePath(p);
      if (!fs.existsSync(file)) return fail('文件不存在：' + file);
      frames.push(await readPixels(file));
    }

    const first = frames[0];
    const width = input.width || first.width;
    const height = input.height || first.height;

    const bytes = GifCore.encodeGif(frames, {
      width: width,
      height: height,
      colors: input.colors || 256,
      delay: input.delay || 100,
      loop: input.loop || 0,
      optimize: input.diffFrames !== false,
      fit: 'contain',
      background: [255, 255, 255]
    });

    const outFile = input.outputPath
      ? resolvePath(input.outputPath)
      : path.join(os.tmpdir(), 'online-tools-mcp', 'output.gif');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, Buffer.from(bytes));

    return {
      ok: true,
      outputPath: outFile,
      frameCount: frames.length,
      width: width,
      height: height,
      bytes: bytes.length,
      delay: input.delay || 100,
      colors: input.colors || 256,
      loop: input.loop || 0
    };
  } catch (e) {
    return fail(e.message);
  }
}

/* ---------------------------------------------------------- */
/*  图片去水印                                                */
/* ---------------------------------------------------------- */

async function imageWatermark(input) {
  try {
    const WatermarkCore = core('WatermarkCore');
    if (!WatermarkCore) return fail('去水印核心模块不可用');

    const file = resolvePath(input.path);
    if (!fs.existsSync(file)) return fail('文件不存在：' + file);

    const frame = await readPixels(file);
    const region = {
      x: input.x || 0,
      y: input.y || 0,
      width: input.width,
      height: input.height
    };

    const imageData = {
      data: frame.pixels,
      width: frame.width,
      height: frame.height
    };

    const r = WatermarkCore.removeWatermark(imageData, region, {
      method: input.method || 'smart',
      radius: input.radius,
      offsetX: input.offsetX,
      offsetY: input.offsetY,
      patchX: input.patchX,
      patchY: input.patchY
    });

    if (!r.ok) return fail(r.error);

    const outFile = input.outputPath
      ? resolvePath(input.outputPath)
      : defaultOutput(file, 'png');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await writePixels(outFile, frame.pixels, frame.width, frame.height, 'png');

    return {
      ok: true,
      inputPath: file,
      outputPath: outFile,
      width: frame.width,
      height: frame.height,
      method: r.method,
      changedPixels: r.changed,
      detail: r.detail
    };
  } catch (e) {
    return fail(e.message);
  }
}

module.exports = {
  imageCompress,
  imageConvert,
  imageGif,
  imageWatermark
};
