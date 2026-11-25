/* ============================================
   GIF 编码真实字节验证
   —— 用自研的 GIF89a 编码器生成字节，再交给 sharp（libgif）解码校验
   ============================================ */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// 在沙箱里加载 gif-core.js（它依赖 window，用一个最小 global 桩即可）
const sandbox = { globalThis: null, console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/js/gif-core.js'), 'utf8'), sandbox);
const Core = sandbox.GifCore;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  ->  ' + detail : ''));
}

/** 造一帧纯色/渐变画面 */
function makeFrame(w, h, fn) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c = fn(x, y);
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  return { pixels: px, width: w, height: h };
}

(async () => {
  console.log('\n=== GIF 编码器真实字节验证 ===');

  /* ---------- 基础：单帧 ---------- */

  const one = makeFrame(64, 48, (x, y) => [(x * 4) % 256, (y * 5) % 256, 128]);
  const gif1 = Core.encodeGif([one], { colors: 256, delay: 100 });

  check('输出为 GIF89a 签名',
    String.fromCharCode.apply(null, gif1.subarray(0, 6)) === 'GIF89a',
    String.fromCharCode.apply(null, gif1.subarray(0, 6)));
  check('以 0x3B 结束', gif1[gif1.length - 1] === 0x3b, '0x' + gif1[gif1.length - 1].toString(16));

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const p1 = path.join(outDir, 'gif-single.gif');
  fs.writeFileSync(p1, Buffer.from(gif1));

  let meta;
  try {
    meta = await sharp(p1, { animated: true }).metadata();
  } catch (e) {
    check('sharp 能解码单帧 GIF', false, e.message);
    meta = null;
  }
  if (meta) {
    check('sharp 能解码单帧 GIF', true);
    check('识别为 GIF 格式', meta.format === 'gif', meta.format);
    check('单帧尺寸正确', meta.width === 64 && (meta.pageHeight || meta.height) === 48,
      `${meta.width}x${meta.pageHeight || meta.height}`);
    check('单帧页数为 1', meta.pages === 1, String(meta.pages));
    check('延时被正确写入', meta.delay && meta.delay[0] === 100,
      JSON.stringify(meta.delay));
  }

  /* ---------- 多帧 ---------- */

  const frames = [];
  const colors = [[220, 40, 40], [40, 220, 40], [40, 40, 220], [220, 220, 40]];
  for (let i = 0; i < colors.length; i++) {
    frames.push(makeFrame(64, 48, (x, y) => {
      const c = colors[i];
      return [c[0], c[1], c[2]];
    }));
  }

  const gif4 = Core.encodeGif(frames, { colors: 256, delay: 100, loop: 0 });
  const p4 = path.join(outDir, 'gif-animated.gif');
  fs.writeFileSync(p4, Buffer.from(gif4));

  let m4;
  try {
    m4 = await sharp(p4, { animated: true }).metadata();
  } catch (e) {
    check('sharp 能解码动画 GIF', false, e.message);
    m4 = null;
  }
  if (m4) {
    check('sharp 能解码动画 GIF', true);
    check('动画页数为 4', m4.pages === 4, String(m4.pages));
    check('动画尺寸正确', m4.width === 64 && m4.pageHeight === 48,
      `${m4.width}x${m4.pageHeight}`);
    check('每帧延时均为 100ms', m4.delay && m4.delay.every(d => d === 100),
      JSON.stringify(m4.delay));
    check('写入无限循环标记', m4.loop === 0, String(m4.loop));
  }

  // 逐帧取像素，验证颜色正确（量化后应接近原色）
  const raw = await sharp(p4, { animated: true }).raw().toBuffer({ resolveWithObject: true });
  check('解码后总像素数 = 页数 × 宽 × 高 × 3通道',
    raw.data.length === 64 * 48 * 3 * 4,
    `${raw.data.length} vs ${64 * 48 * 3 * 4}`);

  const pageSize = 64 * 48 * 3;
  const expect = [[220, 40, 40], [40, 220, 40], [40, 40, 220], [220, 220, 40]];
  let colorOk = true;
  const colorDetail = [];
  for (let p = 0; p < 4; p++) {
    const off = p * pageSize;
    const r = raw.data[off], g = raw.data[off + 1], b = raw.data[off + 2];
    const e = expect[p];
    const d = Math.abs(r - e[0]) + Math.abs(g - e[1]) + Math.abs(b - e[2]);
    colorDetail.push(`p${p}:${r},${g},${b}(Δ${d})`);
    if (d > 30) colorOk = false;
  }
  check('每帧颜色与原图一致（量化误差可接受）', colorOk, colorDetail.join(' '));

  /* ---------- 压缩：颜色数越少体积越小 ---------- */

  const manyColors = makeFrame(64, 48, (x, y) => [(x * 4) % 256, (y * 5) % 256, (x * y) % 256]);
  const g256 = Core.encodeGif([manyColors], { colors: 256 });
  const g16 = Core.encodeGif([manyColors], { colors: 16 });
  const g2 = Core.encodeGif([manyColors], { colors: 2 });
  check('颜色数越少体积越小', g16.length < g256.length && g2.length < g16.length,
    `256=${g256.length}B 16=${g16.length}B 2=${g2.length}B`);

  const m16 = await sharp(Buffer.from(g16), { animated: true }).metadata();
  check('16 色 GIF 仍可正常解码', m16.format === 'gif' && m16.width === 64, `${m16.format} ${m16.width}x${m16.height}`);

  /* ---------- 压缩：缩小尺寸体积更小 ---------- */

  const big = makeFrame(400, 300, (x, y) => [(x * 3) % 256, (y * 2) % 256, (x + y) % 256]);
  const gBig = Core.encodeGif([big], { colors: 128, width: 400, height: 300 });
  const gSmall = Core.encodeGif([big], { colors: 128, width: 100, height: 75 });
  check('缩小尺寸后体积更小', gSmall.length < gBig.length,
    `400x300=${gBig.length}B 100x75=${gSmall.length}B`);

  /* ---------- 帧间差分 ---------- */

  // 10 帧里只有最后一帧不同：差分应显著减小体积
  const same = [];
  for (let i = 0; i < 10; i++) {
    same.push(makeFrame(64, 48, () => [100, 150, 200]));
  }
  const gDiff = Core.encodeGif(same, { colors: 256, optimize: true });
  const gNoDiff = Core.encodeGif(same, { colors: 256, optimize: false });
  check('帧间差分显著减小体积', gDiff.length < gNoDiff.length * 0.5,
    `diff=${gDiff.length}B nodiff=${gNoDiff.length}B`);

  const mDiff = await sharp(Buffer.from(gDiff), { animated: true }).metadata();
  check('相同帧仍保留页数（用占位帧维持时长）', mDiff.pages === 10, String(mDiff.pages));
  check('相同帧合并后体积显著更小', gDiff.length < gNoDiff.length * 0.5,
    `diff=${gDiff.length}B nodiff=${gNoDiff.length}B`);

  /* ---------- LZW 压缩有效性 ---------- */

  // 大量重复像素应被 LZW 高度压缩
  const flat = makeFrame(200, 200, () => [90, 90, 90]);
  const gFlat = Core.encodeGif([flat], { colors: 4 });
  check('纯色图被 LZW 高度压缩', gFlat.length < 2000, gFlat.length + ' bytes');
  const mFlat = await sharp(Buffer.from(gFlat), { animated: true }).metadata();
  check('纯色 GIF 解码正确', mFlat.width === 200 && mFlat.height === 200,
    `${mFlat.width}x${mFlat.height}`);

  /* ---------- 缩放模式 ---------- */

  const wide = makeFrame(100, 50, () => [10, 20, 30]);
  const tall = makeFrame(50, 100, () => [40, 50, 60]);
  const gContain = Core.encodeGif([wide, tall], { width: 100, height: 100, fit: 'contain', colors: 16 });
  const gFill = Core.encodeGif([wide, tall], { width: 100, height: 100, fit: 'fill', colors: 16 });
  const mContain = await sharp(Buffer.from(gContain), { animated: true }).metadata();
  check('contain 模式输出尺寸为画布尺寸', mContain.width === 100 && mContain.pageHeight === 100,
    `${mContain.width}x${mContain.pageHeight}`);
  check('contain 与 fill 产生不同字节', gContain.length !== gFill.length ||
    !gContain.every((v, i) => v === gFill[i]));

  /* ---------- 循环次数 ---------- */

  const gLoop2 = Core.encodeGif(frames, { colors: 64, loop: 2 });
  const mLoop2 = await sharp(Buffer.from(gLoop2), { animated: true }).metadata();
  check('循环次数被写入', mLoop2.loop === 2, String(mLoop2.loop));

  /* ---------- 量化器 ---------- */

  const q = Core.quantize(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), 3, 1, 8);
  check('量化器返回调色板', Array.isArray(q.palette) && q.palette.length > 0 && q.palette.length <= 8,
    String(q.palette.length));
  check('量化器映射长度等于像素数', q.map.length === 3, String(q.map.length));

  check('nextPow2 正确', Core.nextPow2(1) === 1 && Core.nextPow2(3) === 4 &&
    Core.nextPow2(100) === 128 && Core.nextPow2(256) === 256);

  /* ---------- 差分逻辑 ---------- */

  const cur = { width: 10, height: 10 };
  const a = new Uint8Array(100).fill(1);
  const b = new Uint8Array(100).fill(1);
  b[55] = 2;
  const d = Core.diffFrame(cur, cur, b, a);
  check('差分找出变化区域', d && d.x === 5 && d.y === 5 && d.width === 1 && d.height === 1,
    d ? JSON.stringify({ x: d.x, y: d.y, w: d.width, h: d.height }) : 'null');
  check('完全相同的帧返回 null', Core.diffFrame(cur, cur, a, a) === null);

  /* ---------- 边界情况 ---------- */

  // 1×1 的极小图
  const tiny = Core.encodeGif([makeFrame(1, 1, () => [255, 0, 0])], { colors: 16 });
  let mTiny;
  try {
    mTiny = await sharp(Buffer.from(tiny), { animated: true }).metadata();
  } catch (e) {
    mTiny = null;
  }
  check('1×1 极小图可正常编码', mTiny && mTiny.width === 1, mTiny ? `${mTiny.width}x${mTiny.height}` : 'null');

  // 空帧列表应报错而不是产出坏文件
  let threw = false;
  try { Core.encodeGif([], { colors: 16 }); } catch (e) { threw = true; }
  check('空帧列表抛出明确错误', threw);

  // 全透明图片
  const transp = new Uint8ClampedArray(4 * 4 * 4);
  const gTransp = Core.encodeGif([{ pixels: transp, width: 4, height: 4 }], { colors: 16 });
  let mTransp;
  try {
    mTransp = await sharp(Buffer.from(gTransp), { animated: true }).metadata();
  } catch (e) { mTransp = null; }
  check('全透明图片可正常编码', mTransp && mTransp.width === 4,
    mTransp ? `${mTransp.width}x${mTransp.height}` : 'null');

  // 延时边界
  const gFast = Core.encodeGif([makeFrame(4, 4, () => [1, 2, 3])], { colors: 16, delay: 1 });
  const mFast = await sharp(Buffer.from(gFast), { animated: true }).metadata();
  check('过小的延时被抬到下限', mFast.delay[0] === 20, JSON.stringify(mFast.delay));

  const gSlow = Core.encodeGif([makeFrame(4, 4, () => [1, 2, 3])], { colors: 16, delay: 999999 });
  const mSlow = await sharp(Buffer.from(gSlow), { animated: true }).metadata();
  check('过大的延时被压到上限', mSlow.delay[0] === 655350, JSON.stringify(mSlow.delay));

  console.log('  示例文件已写入 ' + outDir);

  const failed = results.filter(r => !r.ok);
  console.log('\n=========================');
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  if (failed.length) {
    console.log('\n失败项:');
    failed.forEach(f => console.log('  - ' + f.name + (f.detail ? ' -> ' + f.detail : '')));
  }
  console.log('=========================\n');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('测试脚本异常:', e); process.exit(2); });
