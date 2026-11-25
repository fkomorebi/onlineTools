/* ============================================
   GIF 制作 —— 多张图片合成动画 GIF，并可压缩
   ============================================ */
(function (global) {
  'use strict';

  const { el, formatBytes, downloadBlob, naturalSort } = global.U;
  const Core = global.GifCore;

  /** 默认参数 */
  const DEFAULTS = {
    delay: 100,       // 每帧延时（毫秒）
    colors: 256,      // 调色板颜色数
    width: 0,         // 输出宽度（0 = 跟随第一帧）
    height: 0,        // 输出高度（0 = 跟随第一帧）
    loop: 0,          // 循环次数（0 = 无限）
    optimize: true,   // 帧间差分
    fit: 'contain',   // 缩放方式
    background: '#ffffff'
  };

  /** 每帧延时的可选值（毫秒） */
  const DELAY_PRESETS = [
    { value: 50, label: '50 ms · 很快' },
    { value: 100, label: '100 ms · 常规' },
    { value: 200, label: '200 ms · 稍慢' },
    { value: 500, label: '500 ms · 慢' },
    { value: 1000, label: '1000 ms · 很慢' }
  ];

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: 'GIF 制作' }));
    head.appendChild(el('p', { text: '多张图片合成动画 GIF，可调帧延时、调色板颜色数与输出尺寸来压缩体积。全部在本机处理，图片不会上传。' }));
    root.appendChild(head);

    /* --- 上传区 --- */
    const dz = el('div', { class: 'dropzone', id: 'gif-drop' }, [
      el('div', { class: 'dropzone-icon', text: '🎞️' }),
      el('div', { class: 'dropzone-title', text: '点击选择图片，或将文件拖到这里' }),
      el('div', { class: 'dropzone-hint', html: 'PNG / JPG / WebP / GIF / BMP / AVIF · <b>可多选</b>' })
    ]);
    const fileInput = el('input', {
      type: 'file', accept: 'image/*', multiple: 'multiple',
      style: 'display:none', id: 'gif-file',
      onchange: function (e) { addFiles(e.target.files); }
    });
    root.appendChild(dz);
    root.appendChild(fileInput);

    /* --- 帧列表 --- */
    const listCard = el('div', { class: 'card', id: 'gif-list-card' });
    listCard.style.display = 'none';
    listCard.appendChild(el('div', { class: 'card-title', text: '帧列表' }));

    const listToolbar = el('div', { class: 'row-between', style: 'margin-bottom:12px' });
    const listHint = el('div', { class: 'hint', text: '拖动可调整顺序，顺序即播放顺序。' });
    listToolbar.appendChild(listHint);
    const listBtns = el('div', { class: 'btn-group' });
    listBtns.appendChild(el('button', { class: 'btn btn-sm', text: '按名称排序', onclick: sortByName }));
    listBtns.appendChild(el('button', { class: 'btn btn-sm', text: '反向排序', onclick: reverseOrder }));
    listToolbar.appendChild(listBtns);
    listCard.appendChild(listToolbar);

    const summary = el('div', { class: 'stats', id: 'gif-summary' });
    listCard.appendChild(summary);
    const list = el('div', { class: 'file-list', id: 'gif-list' });
    listCard.appendChild(list);
    root.appendChild(listCard);

    /* --- 合成设置 --- */
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title', text: '合成设置' }));

    const grid = el('div', { class: 'grid-2' });

    // 帧延时
    const delayField = el('div', { class: 'field' });
    delayField.appendChild(el('label', { class: 'field-label', text: '帧延时' }));
    const delaySel = el('select', { id: 'gif-delay' });
    DELAY_PRESETS.forEach(function (p) {
      delaySel.appendChild(el('option', { value: String(p.value), text: p.label }));
    });
    delaySel.appendChild(el('option', { value: 'custom', text: '自定义…' }));
    delaySel.value = String(DEFAULTS.delay);
    delayField.appendChild(delaySel);
    const customDelay = el('input', {
      type: 'number', id: 'gif-delay-custom', value: '100', min: '20', max: '655350',
      style: 'display:none;margin-top:8px'
    });
    delayField.appendChild(customDelay);
    delayField.appendChild(el('p', { class: 'hint', text: '每张图片停留多久，单位毫秒，越短文件越小。' }));
    grid.appendChild(delayField);

    // 颜色数（压缩的关键旋钮）
    const colorField = el('div', { class: 'field' });
    colorField.appendChild(el('label', { class: 'field-label', text: '颜色数（压缩强度）' }));
    const colorSel = el('select', { id: 'gif-colors' });
    [[256, '256 色 · 画质最佳'], [128, '128 色 · 均衡'], [64, '64 色 · 体积更小'],
     [32, '32 色 · 体积很小'], [16, '16 色 · 极小']].forEach(function (c) {
      colorSel.appendChild(el('option', { value: String(c[0]), text: c[1] }));
    });
    colorSel.value = String(DEFAULTS.colors);
    colorField.appendChild(colorSel);
    colorField.appendChild(el('p', { class: 'hint', text: '颜色数越少，GIF 体积越小；渐变丰富的图会看出色带。' }));
    grid.appendChild(colorField);

    // 输出尺寸
    const dimField = el('div', { class: 'field' });
    dimField.appendChild(el('label', { class: 'field-label', text: '输出尺寸（像素）' }));
    const dimRow = el('div', { class: 'dim-row' });
    const wIn = el('input', { type: 'number', id: 'gif-width', placeholder: '宽度', min: '0' });
    const hIn = el('input', { type: 'number', id: 'gif-height', placeholder: '高度', min: '0' });
    dimRow.appendChild(wIn);
    dimRow.appendChild(el('span', { class: 'dim-sep', text: '×' }));
    dimRow.appendChild(hIn);
    dimField.appendChild(dimRow);
    dimField.appendChild(el('p', { class: 'hint', text: '填 0 表示跟随第一张图片的尺寸；缩小尺寸是最有效的压缩手段。' }));
    grid.appendChild(dimField);

    // 缩放方式
    const fitField = el('div', { class: 'field' });
    fitField.appendChild(el('label', { class: 'field-label', text: '图片尺寸不一致时' }));
    const fitSel = el('select', { id: 'gif-fit' });
    fitSel.appendChild(el('option', { value: 'contain', text: '等比缩放并留白（推荐）' }));
    fitSel.appendChild(el('option', { value: 'fill', text: '拉伸铺满整个画布' }));
    fitField.appendChild(fitSel);
    grid.appendChild(fitField);

    // 循环
    const loopField = el('div', { class: 'field' });
    loopField.appendChild(el('label', { class: 'field-label', text: '循环次数' }));
    const loopSel = el('select', { id: 'gif-loop' });
    loopSel.appendChild(el('option', { value: '0', text: '无限循环' }));
    loopSel.appendChild(el('option', { value: '1', text: '播放 1 次' }));
    loopSel.appendChild(el('option', { value: '2', text: '播放 2 次' }));
    loopSel.appendChild(el('option', { value: '3', text: '播放 3 次' }));
    loopSel.appendChild(el('option', { value: '5', text: '播放 5 次' }));
    loopField.appendChild(loopSel);
    grid.appendChild(loopField);

    // 背景色
    const bgField = el('div', { class: 'field' });
    bgField.appendChild(el('label', { class: 'field-label', text: '背景色（留白处填充）' }));
    const bgInput = el('input', { type: 'color', id: 'gif-bg', value: DEFAULTS.background });
    bgInput.style.width = '100%';
    bgInput.style.height = '38px';
    bgInput.style.padding = '2px';
    bgInput.style.background = 'var(--bg-soft)';
    bgInput.style.border = '1px solid var(--border)';
    bgInput.style.borderRadius = 'var(--radius-sm)';
    bgField.appendChild(bgInput);
    grid.appendChild(bgField);

    // 优化选项
    const optField = el('div', { class: 'field' });
    optField.appendChild(el('label', { class: 'field-label', text: '压缩优化' }));
    const optBox = el('div', { class: 'checkbox-row' });
    const optChk = el('input', { type: 'checkbox', id: 'gif-optimize' });
    optChk.checked = DEFAULTS.optimize;
    optBox.appendChild(optChk);
    optBox.appendChild(el('span', { text: '帧间差分（只编码变化区域）' }));
    optField.appendChild(optBox);
    optField.appendChild(el('p', { class: 'hint', text: '差分只重写与上一帧不同的区域，可显著减小体积。' }));
    grid.appendChild(optField);

    card.appendChild(grid);
    root.appendChild(card);

    /* --- 操作 --- */
    const actions = el('div', { class: 'toolbar' });
    const btnMake = el('button', { class: 'btn btn-primary', text: '合成 GIF', onclick: makeGif });
    const btnDownload = el('button', { class: 'btn btn-success', text: '下载 GIF', onclick: downloadGif, disabled: 'disabled' });
    const btnClear = el('button', { class: 'btn btn-danger', text: '清空', onclick: clearAll });
    actions.appendChild(btnMake);
    actions.appendChild(btnDownload);
    actions.appendChild(btnClear);
    actions.appendChild(el('span', { class: 'spacer' }));
    const status = el('div', { class: 'status' });
    actions.appendChild(status);
    root.appendChild(actions);

    /* --- 结果预览 --- */
    const resCard = el('div', { class: 'card', id: 'gif-result-card' });
    resCard.style.display = 'none';
    resCard.appendChild(el('div', { class: 'card-title', text: '结果预览' }));
    const previewBox = el('div', {
      class: 'dropzone',
      style: 'padding:20px;display:flex;justify-content:center;align-items:center;min-height:120px'
    });
    resCard.appendChild(previewBox);
    const resStats = el('div', { class: 'stats', id: 'gif-result-stats', style: 'margin-top:14px' });
    resCard.appendChild(resStats);
    root.appendChild(resCard);

    /* --- 状态 --- */
    let items = [];      // { id, file, name, size, w, h }
    let result = null;   // { blob, name, bytes }
    let dragId = null;

    /* --- 事件绑定 --- */

    delaySel.addEventListener('change', function () {
      const custom = delaySel.value === 'custom';
      customDelay.style.display = custom ? '' : 'none';
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
    dz.addEventListener('click', function () { fileInput.click(); });

    function setStatus(msg, kind) {
      status.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { status.classList.add('show'); status.textContent = msg; }
      else { status.classList.remove('show'); status.textContent = ''; }
    }

    /* --- 添加文件 --- */

    function addFiles(fileList) {
      const files = Array.prototype.slice.call(fileList || []).filter(function (f) {
        return f.type.indexOf('image/') === 0;
      });
      if (!files.length) { setStatus('✗ 请选择图片文件', 'err'); fileInput.value = ''; return; }

      files.forEach(function (f) {
        const id = 'g' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        items.push({
          id: id, file: f, name: f.name, size: f.size, w: 0, h: 0
        });
      });
      fileInput.value = '';
      resetResult();
      renderList();
      setStatus('✓ 已添加 ' + files.length + ' 张图片，点击「合成 GIF」', 'ok');
    }

    /* --- 排序 --- */

    function sortByName() {
      items.sort(function (a, b) { return naturalSort(a.name, b.name); });
      renderList();
      setStatus('✓ 已按名称排序', 'ok');
    }

    function reverseOrder() {
      items.reverse();
      renderList();
      setStatus('✓ 已反向排序', 'ok');
    }

    /* --- 列表渲染 --- */

    function renderList() {
      list.innerHTML = '';
      summary.innerHTML = '';
      if (!items.length) {
        listCard.style.display = 'none';
        return;
      }
      listCard.style.display = '';

      const totalOrig = items.reduce(function (s, i) { return s + i.size; }, 0);
      [['帧数', String(items.length)],
       ['原始体积', formatBytes(totalOrig)],
       ['总时长', (items.length * currentDelay() / 1000).toFixed(1) + ' s']
      ].forEach(function (it) {
        summary.appendChild(el('div', { class: 'stat' }, [
          el('span', { class: 'stat-value', text: it[1] }),
          el('span', { class: 'stat-label', text: it[0] })
        ]));
      });

      items.forEach(function (it, idx) {
        const row = el('div', {
          class: 'file-item gif-frame-item',
          draggable: 'true',
          'data-id': it.id
        });

        // 序号
        row.appendChild(el('div', { class: 'gif-index', text: String(idx + 1) }));

        const thumb = el('img', { class: 'file-thumb', alt: '' });
        const url = URL.createObjectURL(it.file);
        thumb.src = url;
        thumb.addEventListener('load', function () { URL.revokeObjectURL(url); });

        const info = el('div', { class: 'file-info' });
        info.appendChild(el('div', { class: 'file-name', text: it.name, title: it.name }));
        const meta = el('div', { class: 'file-meta' });
        meta.appendChild(el('span', { text: formatBytes(it.size) }));
        if (it.w) meta.appendChild(el('span', { text: it.w + '×' + it.h }));
        info.appendChild(meta);

        const right = el('div', { class: 'btn-group' });
        right.appendChild(el('button', {
          class: 'file-remove', text: '↑', title: '上移',
          onclick: function () { move(idx, -1); }
        }));
        right.appendChild(el('button', {
          class: 'file-remove', text: '↓', title: '下移',
          onclick: function () { move(idx, 1); }
        }));
        right.appendChild(el('button', {
          class: 'file-remove', text: '✕', title: '移除',
          onclick: function () {
            items = items.filter(function (x) { return x.id !== it.id; });
            resetResult();
            renderList();
          }
        }));

        row.appendChild(thumb);
        row.appendChild(info);
        row.appendChild(right);
        list.appendChild(row);
      });

      // 拖拽排序
      Array.prototype.forEach.call(list.querySelectorAll('.gif-frame-item'), function (row) {
        row.addEventListener('dragstart', function (e) {
          dragId = row.getAttribute('data-id');
          row.classList.add('dragging');
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', function () {
          dragId = null;
          row.classList.remove('dragging');
          Array.prototype.forEach.call(list.querySelectorAll('.gif-frame-item'), function (r) {
            r.classList.remove('drop-target');
          });
        });
        row.addEventListener('dragover', function (e) {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          if (dragId && dragId !== row.getAttribute('data-id')) row.classList.add('drop-target');
        });
        row.addEventListener('dragleave', function () { row.classList.remove('drop-target'); });
        row.addEventListener('drop', function (e) {
          e.preventDefault();
          e.stopPropagation();
          row.classList.remove('drop-target');
          const targetId = row.getAttribute('data-id');
          if (!dragId || dragId === targetId) return;
          const from = items.findIndex(function (x) { return x.id === dragId; });
          const to = items.findIndex(function (x) { return x.id === targetId; });
          if (from < 0 || to < 0) return;
          const moved = items.splice(from, 1)[0];
          items.splice(to, 0, moved);
          resetResult();
          renderList();
        });
      });
    }

    function move(idx, dir) {
      const to = idx + dir;
      if (to < 0 || to >= items.length) return;
      const moved = items.splice(idx, 1)[0];
      items.splice(to, 0, moved);
      resetResult();
      renderList();
    }

    function clearAll() {
      items = [];
      resetResult();
      renderList();
      setStatus('', null);
    }

    /* --- 参数读取 --- */

    function currentDelay() {
      if (delaySel.value === 'custom') {
        return Math.max(20, Math.min(655350, parseInt(customDelay.value, 10) || DEFAULTS.delay));
      }
      return parseInt(delaySel.value, 10) || DEFAULTS.delay;
    }

    function hexToRgb(hex) {
      const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
      if (!m) return [255, 255, 255];
      return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    }

    function currentOptions() {
      return {
        delay: currentDelay(),
        colors: parseInt(colorSel.value, 10) || DEFAULTS.colors,
        width: parseInt(wIn.value, 10) || 0,
        height: parseInt(hIn.value, 10) || 0,
        loop: parseInt(loopSel.value, 10) || 0,
        fit: fitSel.value,
        optimize: optChk.checked,
        background: hexToRgb(bgInput.value)
      };
    }

    /* --- 结果 --- */

    function resetResult() {
      result = null;
      btnDownload.disabled = true;
      resCard.style.display = 'none';
      previewBox.innerHTML = '';
      resStats.innerHTML = '';
    }

    /* --- 合成 --- */

    function makeGif() {
      if (!items.length) { setStatus('✗ 请先添加图片', 'err'); return; }

      const opts = currentOptions();
      btnMake.disabled = true;
      btnDownload.disabled = true;
      setStatus('正在读取图片 0 / ' + items.length + ' …', 'info');

      Core.readFrames(items, function (done, total) {
        setStatus('正在读取图片 ' + done + ' / ' + total + ' …', 'info');
      }).then(function (read) {
        // 记录每帧尺寸，供列表展示
        read.frames.forEach(function (f) {
          const it = items.find(function (x) { return x.name === f.name; });
          if (it) { it.w = f.width; it.h = f.height; }
        });
        renderList();

        if (!read.frames.length) {
          throw new Error('所有图片都无法读取：' +
            (read.failures[0] ? read.failures[0].message : '未知错误'));
        }

        const outW = opts.width || read.frames[0].width;
        const outH = opts.height || read.frames[0].height;

        setStatus('正在编码 GIF …', 'info');

        // 让出一帧，保证状态提示能先渲染出来
        return new Promise(function (r) { setTimeout(r, 16); }).then(function () {
          const bytes = Core.encodeGif(read.frames, {
            width: outW,
            height: outH,
            delay: opts.delay,
            colors: opts.colors,
            loop: opts.loop,
            fit: opts.fit,
            optimize: opts.optimize,
            background: opts.background
          });
          return {
            bytes: bytes,
            outW: outW,
            outH: outH,
            frames: read.frames.length,
            failed: read.failures.length
          };
        });
      }).then(function (out) {
        const blob = new Blob([out.bytes], { type: 'image/gif' });
        result = {
          blob: blob,
          name: 'animation.gif',
          bytes: out.bytes.length,
          width: out.outW,
          height: out.outH,
          frames: out.frames
        };

        // 预览
        previewBox.innerHTML = '';
        // 统计也要先清空，否则重新合成时会在旧数据后面追加一份
        resStats.innerHTML = '';
        const img = el('img', {
          src: URL.createObjectURL(blob),
          alt: 'GIF 预览',
          style: 'max-width:100%;max-height:420px;border-radius:6px;display:block;margin:0 auto'
        });
        previewBox.appendChild(img);

        const totalOrig = items.reduce(function (s, i) { return s + i.size; }, 0);
        const saved = Math.round((1 - blob.size / Math.max(1, totalOrig)) * 100);
        [['输出体积', formatBytes(blob.size)],
         ['帧数', String(out.frames)],
         ['尺寸', out.outW + '×' + out.outH],
         ['时长', (out.frames * currentDelay() / 1000).toFixed(1) + ' s'],
         ['对比原始', (saved >= 0 ? '↓ ' : '↑ ') + Math.abs(saved) + '%']
        ].forEach(function (it) {
          resStats.appendChild(el('div', { class: 'stat' }, [
            el('span', { class: 'stat-value', text: it[1] }),
            el('span', { class: 'stat-label', text: it[0] })
          ]));
        });

        resCard.style.display = '';
        btnDownload.disabled = false;

        const warn = out.failed
          ? '（' + out.failed + ' 张读取失败已跳过）' : '';
        setStatus('✓ 合成完成：' + formatBytes(blob.size) + warn, 'ok');
      }).catch(function (e) {
        setStatus('✗ ' + (e && e.message ? e.message : '合成失败'), 'err');
      }).then(function () {
        btnMake.disabled = false;
      });
    }

    function downloadGif() {
      if (!result) return;
      downloadBlob(result.blob, result.name);
    }
  }

  global.GifTool = { render: render };
})(window);
