/* ============================================
   颜色工具 —— 页面
   ============================================ */
(function (global) {
  'use strict';

  const { el, copyText, downloadBlob } = global.U;
  const Core = global.ColorCore;

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: '颜色工具' }));
    head.appendChild(el('p', { text: '颜色格式互转、色板生成与 WCAG 对比度检查，全部在浏览器本地完成。' }));
    root.appendChild(head);

    /* --- 取色器 --- */
    const pickerCard = el('div', { class: 'card' });
    pickerCard.appendChild(el('div', { class: 'card-title', text: '选择颜色' }));

    const pickerRow = el('div', { class: 'color-picker-row' });
    const nativePicker = el('input', { type: 'color', id: 'color-native', value: '#4c9aff' });
    nativePicker.className = 'color-native';
    const hexInput = el('input', { type: 'text', id: 'color-hex', value: '#4c9aff', placeholder: '#4c9aff' });
    hexInput.className = 'color-hex-input';
    const rgbInput = el('input', { type: 'text', id: 'color-rgb', value: 'rgb(76, 154, 255)', placeholder: 'rgb(76, 154, 255)' });
    rgbInput.className = 'color-hex-input';
    const hslInput = el('input', { type: 'text', id: 'color-hsl', value: 'hsl(213, 100%, 65%)', placeholder: 'hsl(213, 100%, 65%)' });
    hslInput.className = 'color-hex-input';
    const btnRandom = el('button', { class: 'btn', text: '随机颜色', onclick: doRandom });
    const btnRandomPalette = el('button', { class: 'btn', text: '随机色板', onclick: doRandomPalette });

    pickerRow.appendChild(nativePicker);
    pickerRow.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: 'HEX' }));
    pickerRow.appendChild(hexInput);
    pickerRow.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: 'RGB' }));
    pickerRow.appendChild(rgbInput);
    pickerRow.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: 'HSL' }));
    pickerRow.appendChild(hslInput);
    pickerRow.appendChild(btnRandom);
    pickerRow.appendChild(btnRandomPalette);
    pickerCard.appendChild(pickerRow);

    const status = el('div', { class: 'status', id: 'color-status' });
    pickerCard.appendChild(status);
    root.appendChild(pickerCard);

    /* --- 格式列表 --- */
    const fmtCard = el('div', { class: 'card' });
    fmtCard.appendChild(el('div', { class: 'card-title', text: '格式转换' }));
    const fmtTable = el('div', { class: 'table-wrap' });
    fmtCard.appendChild(fmtTable);
    root.appendChild(fmtCard);

    /* --- 对比度 --- */
    const contrastCard = el('div', { class: 'card' });
    contrastCard.appendChild(el('div', { class: 'card-title', text: '对比度检查（WCAG 2.x）' }));

    const contrastRow = el('div', { class: 'color-contrast-row' });
    const fgPicker = el('input', { type: 'color', id: 'color-fg', value: '#ffffff' });
    const bgPicker = el('input', { type: 'color', id: 'color-bg', value: '#1b2028' });
    const sizeSel = el('select', { id: 'color-size' });
    [['普通文本', 'normal'], ['大号文本 (≥18.66px 粗体 / 24px)', 'large']].forEach(function (o) {
      sizeSel.appendChild(el('option', { value: o[1], text: o[0] }));
    });
    contrastRow.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: '前景色' }));
    contrastRow.appendChild(fgPicker);
    contrastRow.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: '背景色' }));
    contrastRow.appendChild(bgPicker);
    contrastRow.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: '文字尺寸' }));
    contrastRow.appendChild(sizeSel);
    contrastCard.appendChild(contrastRow);

    const preview = el('div', { class: 'color-preview', id: 'color-preview' });
    preview.appendChild(el('div', { class: 'color-preview-text', id: 'color-preview-text', text: '示例文字 Aa 123' }));
    contrastCard.appendChild(preview);

    const contrastStats = el('div', { class: 'stats', id: 'color-contrast-stats' });
    contrastCard.appendChild(contrastStats);
    root.appendChild(contrastCard);

    /* --- 色板 --- */
    const paletteCard = el('div', { class: 'card' });
    paletteCard.appendChild(el('div', { class: 'card-title', text: '色板生成' }));
    const paletteHost = el('div', { id: 'color-palette' });
    paletteCard.appendChild(paletteHost);
    root.appendChild(paletteCard);

    /* --- 逻辑 --- */

    function setStatus(msg, kind) {
      status.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { status.classList.add('show'); status.textContent = msg; }
      else { status.classList.remove('show'); status.textContent = ''; }
    }

    let current = Core.parse('#4c9aff');
    // 上一次解析是否成功 —— 用于「非法 → 合法」时给出一次明确反馈
    let lastParseOk = true;

    function renderFormats(c) {
      const f = Core.toFormats(c);
      fmtTable.innerHTML = '';
      const table = el('table');
      const tbody = el('tbody');
      [
        ['HEX', f.hex],
        ['HEX + Alpha', f.hexAlpha],
        ['RGB', f.rgb],
        ['RGBA', f.rgba],
        ['HSL', f.hsl],
        ['HSLA', f.hsla],
        ['CMYK', f.cmyk],
        ['HSL 分量', 'H ' + Math.round(f.hue) + '° · S ' + Math.round(f.sat) + '% · L ' + Math.round(f.lig) + '%']
      ].forEach(function (row) {
        const tr = el('tr');
        tr.appendChild(el('td', { style: 'width:130px;color:var(--text-faint)', text: row[0] }));
        const td = el('td', { class: 'mono' });
        td.appendChild(el('span', { text: row[1] }));
        const copyBtn = el('button', {
          class: 'btn btn-sm', text: '复制',
          onclick: function () {
            copyText(row[1]).then(function () {
              setStatus('✓ 已复制 ' + row[0], 'ok');
            }).catch(function () {
              setStatus('✗ 复制失败', 'err');
            });
          }
        });
        td.appendChild(el('span', { style: 'margin-left:12px' }, [copyBtn]));
        tr.appendChild(td);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      fmtTable.appendChild(table);
    }

    function renderContrast() {
      const fg = Core.parse(fgPicker.value);
      const bg = Core.parse(bgPicker.value);
      const w = Core.wcag(fg, bg, sizeSel.value);

      preview.style.background = bgPicker.value;
      const textEl = preview.querySelector('#color-preview-text');
      textEl.style.color = fgPicker.value;
      textEl.textContent = w.summary + ' · 对比度 ' + w.ratio + ':1';

      contrastStats.innerHTML = '';
      [
        ['对比度', w.ratio + ' : 1', ''],
        ['AA（普通文本）', w.aa ? '通过' : '未通过', w.aa ? 'ok' : 'bad'],
        ['AAA（普通文本）', w.aaa ? '通过' : '未通过', w.aaa ? 'ok' : 'bad'],
        ['AA（大号文本）', w.aaLarge ? '通过' : '未通过', w.aaLarge ? 'ok' : 'bad'],
        ['AAA（大号文本）', w.aaaLarge ? '通过' : '未通过', w.aaaLarge ? 'ok' : 'bad']
      ].forEach(function (it) {
        contrastStats.appendChild(el('div', { class: 'stat' }, [
          el('span', { class: 'stat-value' + (it[2] ? ' diff-stat-' + it[2] : ''), text: it[1] }),
          el('span', { class: 'stat-label', text: it[0] })
        ]));
      });
    }

    function renderPalette(c) {
      paletteHost.innerHTML = '';

      // 明暗阶梯
      const shadeCard = el('div', { class: 'palette-block' });
      shadeCard.appendChild(el('h4', { class: 'palette-title', text: '明度阶梯' }));
      const shadeRow = el('div', { class: 'palette-row' });
      Core.shades(c, 9).forEach(function (s) {
        shadeRow.appendChild(swatch(s.hex, s.level + '%'));
      });
      shadeCard.appendChild(shadeRow);
      paletteHost.appendChild(shadeCard);

      // 和谐色
      const harmCard = el('div', { class: 'palette-block' });
      harmCard.appendChild(el('h4', { class: 'palette-title', text: '和谐色' }));
      const harmRow = el('div', { class: 'palette-row' });
      harmRow.appendChild(swatch(c.r ? Core.toFormats(c).hex : '#000000', '原色'));
      Core.analogous(c).forEach(function (a) { harmRow.appendChild(swatch(a.hex, a.hue + '°')); });
      Core.triadic(c).forEach(function (t) { harmRow.appendChild(swatch(t.hex, t.hue + '°')); });
      harmRow.appendChild(swatch(Core.complementary(c).hex, Core.complementary(c).hue + '°'));
      harmCard.appendChild(harmRow);
      paletteHost.appendChild(harmCard);

      // CSS 变量导出
      const cssCard = el('div', { class: 'palette-block' });
      cssCard.appendChild(el('h4', { class: 'palette-title', text: 'CSS 变量' }));
      const shades = Core.shades(c, 9);
      const cssText = ':root {\n' +
        '  --color-base: ' + Core.toFormats(c).hex + ';\n' +
        shades.map(function (s, i) {
          return '  --color-' + (i + 1) + ': ' + s.hex + ';';
        }).join('\n') +
        '\n}';
      const pre = el('pre', { class: 'palette-code' });
      pre.appendChild(el('code', { text: cssText }));
      cssCard.appendChild(pre);
      const btnCopyCss = el('button', {
        class: 'btn btn-sm', text: '复制 CSS',
        onclick: function () {
          copyText(cssText).then(function () {
            setStatus('✓ 已复制 CSS 变量', 'ok');
          }).catch(function () {
            setStatus('✗ 复制失败', 'err');
          });
        }
      });
      cssCard.appendChild(btnCopyCss);
      paletteHost.appendChild(cssCard);
    }

    function swatch(hex, label) {
      const box = el('div', { class: 'swatch' });
      box.style.background = hex;
      const cap = el('div', { class: 'swatch-cap' });
      cap.appendChild(el('span', { class: 'swatch-hex', text: hex.toUpperCase() }));
      cap.appendChild(el('span', { class: 'swatch-label', text: label }));
      box.appendChild(cap);
      box.addEventListener('click', function () {
        applyColor(hex);
        setStatus('✓ 已选择 ' + hex.toUpperCase(), 'ok');
      });
      return box;
    }

    /**
     * 把一个颜色应用到所有面板
     * opts.silent：静默成功提示（用于输入框逐字输入时避免刷屏），但解析失败始终会提示
     */
    function applyColor(input, opts) {
      const c = Core.parse(input);
      if (!c) {
        lastParseOk = false;
        setStatus('✗ 无法识别的颜色格式：' + input, 'err');
        return false;
      }
      const wasOk = lastParseOk;
      lastParseOk = true;
      current = c;
      const f = Core.toFormats(c);
      if (!opts || !opts.skipHex) hexInput.value = f.hex;
      if (!opts || !opts.skipRgb) rgbInput.value = f.rgb;
      if (!opts || !opts.skipHsl) hslInput.value = f.hsl;
      nativePicker.value = f.hex;
      renderFormats(c);
      renderPalette(c);
      // 逐字输入时不刷屏，但从「非法」恢复为「合法」时给一次明确反馈
      if (!opts || !opts.silent || !wasOk) setStatus('✓ 已更新', 'ok');
      return true;
    }

    function doRandom() {
      const c = Core.random();
      applyColor(Core.toFormats(c).hex);
    }

    function doRandomPalette() {
      const pal = Core.randomPalette(6);
      const host = el('div', { class: 'palette-block' });
      host.appendChild(el('h4', { class: 'palette-title', text: '随机色板（点击应用）' }));
      const row = el('div', { class: 'palette-row' });
      pal.forEach(function (p) { row.appendChild(swatch(p.hex, p.hsl.h + '°')); });
      host.appendChild(row);
      paletteHost.insertBefore(host, paletteHost.firstChild);
    }

    /* --- 事件 --- */

    nativePicker.addEventListener('input', function () {
      applyColor(nativePicker.value, { silent: true, skipHex: true });
    });
    hexInput.addEventListener('input', function () {
      if (applyColor(hexInput.value, { silent: true, skipHex: true })) nativePicker.value = Core.toFormats(current).hex;
    });
    rgbInput.addEventListener('input', function () {
      if (applyColor(rgbInput.value, { silent: true, skipRgb: true })) nativePicker.value = Core.toFormats(current).hex;
    });
    hslInput.addEventListener('input', function () {
      if (applyColor(hslInput.value, { silent: true, skipHsl: true })) nativePicker.value = Core.toFormats(current).hex;
    });
    fgPicker.addEventListener('input', renderContrast);
    bgPicker.addEventListener('input', renderContrast);
    sizeSel.addEventListener('change', renderContrast);

    // 初始渲染
    applyColor('#4c9aff', { silent: true });
    renderContrast();
  }

  global.ColorTool = { render: render };
})(window);
