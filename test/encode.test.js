/* ============================================
   真实编解码验证
   —— 用 sharp 生成真实的 PNG / WebP / JPEG，再验证工具的压缩目标
      （体积约束、等比缩放、格式正确性）逻辑在真实字节上成立。
   ============================================ */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ->  ' + detail : ''));
}

(async () => {
  console.log('\n=== 真实图片编解码 ===');

  // 造一张"设计师风格"的图：大尺寸 + 渐变 + 噪点（PNG 下体积较大）
  const W = 1600, H = 1200;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      raw[i] = Math.round(127 + 127 * Math.sin(x / 90));
      raw[i + 1] = Math.round(127 + 127 * Math.sin(y / 70));
      raw[i + 2] = Math.round((x + y) % 255);
    }
  }
  const png = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .png({ compressionLevel: 9 }).toBuffer();
  console.log(`  源 PNG: ${W}x${H}, ${(png.length / 1024).toFixed(1)} KB`);

  check('生成真实 PNG', png.length > 1000 && png.slice(1, 4).toString() === 'PNG');

  // WebP 编码（sharp 使用 libwebp，与浏览器 canvas 编码同一家族）
  const webp = await sharp(png).webp({ quality: 80 }).toBuffer();
  check('WebP 编码成功', webp.slice(8, 12).toString() === 'WEBP',
    webp.slice(8, 12).toString());
  check('WebP 显著小于 PNG', webp.length < png.length,
    `${(webp.length / 1024).toFixed(1)}KB vs ${(png.length / 1024).toFixed(1)}KB`);
  console.log(`  WebP q80: ${(webp.length / 1024).toFixed(1)} KB`);

  // 验证 WebP 尺寸正确
  const wm = await sharp(webp).metadata();
  check('WebP 尺寸正确', wm.width === W && wm.height === H, `${wm.width}x${wm.height}`);

  // 验证 WebP -> PNG 往返
  const backPng = await sharp(webp).png().toBuffer();
  check('WebP -> PNG 往返成功', backPng.slice(1, 4).toString() === 'PNG');
  const bm = await sharp(backPng).metadata();
  check('往返后尺寸不变', bm.width === W && bm.height === H, `${bm.width}x${bm.height}`);

  // 验证透明通道保留 (PNG -> PNG)
  const rgba = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 0.5 } }
  }).png().toBuffer();
  const rgbaMeta = await sharp(rgba).metadata();
  check('PNG 带 alpha 通道', rgbaMeta.hasAlpha, 'hasAlpha=' + rgbaMeta.hasAlpha);
  const { data } = await sharp(rgba).raw().toBuffer({ resolveWithObject: true });
  check('半透明像素 alpha=128', data[3] === 128, 'alpha=' + data[3]);

  // 验证 JPEG 转换（不支持透明，需铺底色）
  const jpeg = await sharp(png).jpeg({ quality: 80 }).toBuffer();
  check('JPEG 编码成功', jpeg[0] === 0xFF && jpeg[1] === 0xD8);
  check('JPEG 体积小于 PNG', jpeg.length < png.length,
    `${(jpeg.length / 1024).toFixed(1)}KB vs ${(png.length / 1024).toFixed(1)}KB`);
  const jm = await sharp(jpeg).metadata();
  check('JPEG 无 alpha 通道', !jm.hasAlpha);

  // 模拟工具的等比缩放规则
  function scaleTo(w, h, maxW, maxH) {
    let scale = 1;
    if (maxW > 0 && w > maxW) scale = Math.min(scale, maxW / w);
    if (maxH > 0 && h > maxH) scale = Math.min(scale, maxH / h);
    if (scale < 1) return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
    return { w, h };
  }
  const s1 = scaleTo(W, H, 800, 0);
  check('仅限宽时等比缩放', s1.w === 800 && s1.h === 600, JSON.stringify(s1));
  const s2 = scaleTo(W, H, 0, 400);
  check('仅限高时等比缩放', s2.w === 533 && s2.h === 400, JSON.stringify(s2));
  const s3 = scaleTo(W, H, 800, 800);
  check('双限时取更严格者', s3.w === 800 && s3.h === 600, JSON.stringify(s3));
  const s4 = scaleTo(W, H, 4000, 4000);
  check('超出限制不放大', s4.w === W && s4.h === H, JSON.stringify(s4));

  // 验证质量与体积的单调关系（二分搜索调质的前提）
  const q20 = await sharp(png).webp({ quality: 20 }).toBuffer();
  const q95 = await sharp(png).webp({ quality: 95 }).toBuffer();
  check('质量越低体积越小', q20.length < q95.length,
    `q20=${(q20.length / 1024).toFixed(1)}KB q95=${(q95.length / 1024).toFixed(1)}KB`);

  // 目标体积可行性：找出最接近目标体积的质量档
  // （浏览器 canvas 用 0..1 的浮点质量，sharp 用 0..100 的整数，此处做换算）
  const TARGET = 120 * 1024;
  let lo = 0.05, hi = 0.95, best = null;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    const buf = await sharp(png).webp({ quality: Math.round(mid * 100) }).toBuffer();
    if (buf.length <= TARGET) { best = { q: mid, size: buf.length }; lo = mid; }
    else hi = mid;
  }
  check('二分搜索能命中目标体积', best && best.size <= TARGET,
    best ? `q=${best.q.toFixed(3)} size=${(best.size / 1024).toFixed(1)}KB` : 'none');
  check('命中结果仍是有效 WebP', best
    ? (await sharp(await sharp(png).webp({ quality: Math.round(best.q * 100) }).toBuffer()).metadata()).format === 'webp'
    : false);

  // 输出目录（供人工检查）
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'source.png'), png);
  fs.writeFileSync(path.join(outDir, 'compressed.webp'), webp);
  fs.writeFileSync(path.join(outDir, 'compressed.jpeg'), jpeg);
  console.log(`  示例文件已写入 ${outDir}`);

  const failed = results.filter(r => !r.ok);
  console.log('\n=========================');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  failed.forEach(f => console.log('  - ' + f.name + (f.detail ? ' -> ' + f.detail : '')));
  console.log('=========================\n');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('异常:', e); process.exit(2); });
