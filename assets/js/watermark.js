/* ============================================
   图片去水印 —— 页面
   ============================================ */
(function (global) {
  'use strict';

  const { el, downloadBlob, copyText } = global.U;
  const Core = global.WatermarkCore;

  // 模块级状态：跨渲染保留，destroy() 负责清理全局监听
  let keyHandler = null;
  let globalHandlers = null;

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: '图片去水印' }));
    head.appendChild(el('p', { text: '框选图片里的水印 / logo 区域，用周围像素把它重建回来；也可以一键自动检测候选水印位置。全部在本机 Canvas 上完成，图片不会上传。' }));
    root.appendChild(head);

    /* --- 上传区 --- */
    const dz = el('div', { class: 'dropzone', id: 'wm-drop' }, [
      el('div', { class: 'dropzone-icon', text: '🧽' }),
      el('div', { class: 'dropzone-title', text: '点击选择图片，或将文件拖到这里' }),
      el('div', { class: 'dropzone-hint', text: '支持 PNG / JPG / WebP / BMP / GIF / AVIF' })
    ]);
    const fileInput = el('input', {
      type: 'file', accept: 'image/*', style: 'display:none', id: 'wm-file',
      onchange: function (e) { if (e.target.files && e.target.files[0]) loadFile(e.target.files[0]); }
    });
    root.appendChild(dz);
    root.appendChild(fileInput);

    /* --- 编辑区 --- */
    const editCard = el('div', { class: 'card', id: 'wm-edit-card' });
    editCard.style.display = 'none';
    editCard.appendChild(el('div', { class: 'card-title', text: '框选水印区域' }));

    const hint = el('p', { class: 'hint', text: '在预览图上按住鼠标拖动即可框选水印区域；也可以点击「自动检测」让工具先找出候选位置。' });
    editCard.appendChild(hint);

    const stage = el('div', { class: 'wm-stage', id: 'wm-stage' });
    const canvas = el('canvas', { id: 'wm-canvas' });
    stage.appendChild(canvas);
    const selBox = el('div', { class: 'wm-sel', id: 'wm-sel' });
    stage.appendChild(selBox);
    editCard.appendChild(stage);

    /* 选区数值 */
    const selInfo = el('div', { class: 'wm-sel-info', id: 'wm-sel-info' });
    editCard.appendChild(selInfo);

    /* 设置 */
    const grid = el('div', { class: 'grid-2' });

    const methodField = el('div', { class: 'field' });
    methodField.appendChild(el('label', { class: 'field-label', text: '修复方式' }));
    const methodSel = el('select', { id: 'wm-method' });
    methodSel.appendChild(el('option', { value: 'blur', text: '模糊填充（纯色 / 渐变背景）' }));
    methodSel.appendChild(el('option', { value: 'median', text: '中位数填充（有噪点的纹理）' }));
    methodSel.appendChild(el('option', { value: 'patch', text: '补片搬运（重复图案 / 平铺背景）' }));
    methodField.appendChild(methodSel);
    methodField.appendChild(el('p', { class: 'hint', text: '纯色背景用模糊；照片纹理用中位数；壁纸、棋盘格这类重复图案用补片。' }));
    grid.appendChild(methodField);

    const radiusField = el('div', { class: 'field' });
    radiusField.appendChild(el('label', { class: 'field-label', text: '采样半径（像素）' }));
    const radiusInput = el('input', { type: 'number', id: 'wm-radius', value: '8', min: '1', max: '64', step: '1' });
    radiusField.appendChild(radiusInput);
    radiusField.appendChild(el('p', { class: 'hint', text: '半径越大取样范围越广，修复区域更平滑。' }));
    grid.appendChild(radiusField);

    // 补片偏移
    const patchField = el('div', { class: 'field wm-patch-field', id: 'wm-patch-field' });
    patchField.style.display = 'none';
    patchField.appendChild(el('label', { class: 'field-label', text: '补片偏移（X / Y，像素）' }));
    const patchRow = el('div', { class: 'dim-row' });
    const offsetX = el('input', { type: 'number', id: 'wm-offsetx', value: '0', step: '1' });
    const offsetY = el('input', { type: 'number', id: 'wm-offsety', value: '0', step: '1' });
    patchRow.appendChild(offsetX);
    patchRow.appendChild(el('span', { class: 'dim-sep', text: '+' }));
    patchRow.appendChild(offsetY);
    patchField.appendChild(patchRow);
    patchField.appendChild(el('p', { class: 'hint', text: '从选区旁边搬运像素过来。偏移量决定取样位置，可多次微调。' }));
    grid.appendChild(patchField);

    // 输出格式
    const fmtField = el('div', { class: 'field' });
    fmtField.appendChild(el('label', { class: 'field-label', text: '输出格式' }));
    const fmtSel = el('select', { id: 'wm-format' });
    fmtSel.appendChild(el('option', { value: 'image/png', text: 'PNG（无损，保留透明）' }));
    fmtSel.appendChild(el('option', { value: 'image/jpeg', text: 'JPEG（体积更小）' }));
    fmtSel.appendChild(el('option', { value: 'image/webp', text: 'WebP（推荐）' }));
    fmtField.appendChild(fmtSel);
    grid.appendChild(fmtField);

    editCard.appendChild(grid);
    root.appendChild(editCard);

    /* --- 操作栏 --- */
    const actions = el('div', { class: 'toolbar' });
    const btnDetect = el('button', { class: 'btn', text: '自动检测水印', onclick: doDetect });
    const btnApply = el('button', { class: 'btn btn-primary', text: '应用修复', onclick: applyFix });
    const btnReset = el('button', { class: 'btn', text: '还原原图', onclick: resetImage });
    const btnDownload = el('button', { class: 'btn btn-success', text: '下载图片', onclick: doDownload, disabled: 'disabled' });
    actions.appendChild(btnDetect);
    actions.appendChild(btnApply);
    actions.appendChild(btnReset);
    actions.appendChild(btnDownload);
    actions.appendChild(el('span', { class: 'spacer' }));
    const status = el('div', { class: 'status', id: 'wm-status' });
    actions.appendChild(status);
    root.appendChild(actions);

    /* --- 对比区 --- */
    const cmpCard = el('div', { class: 'card', id: 'wm-compare-card' });
    cmpCard.style.display = 'none';
    cmpCard.appendChild(el('div', { class: 'card-title', text: '处理结果' }));
    const stats = el('div', { class: 'stats', id: 'wm-stats' });
    cmpCard.appendChild(stats);
    const resultCanvas = el('canvas', { id: 'wm-result' });
    cmpCard.appendChild(el('div', { class: 'wm-result-wrap' }, [resultCanvas]));
    root.appendChild(cmpCard);

    /* --- 状态 --- */
    let sourceCanvas = null;   // 原图画布
    let sourceData = null;      // 原图像素副本
    let workingCanvas = null;   // 当前工作画布
    let selection = null;       // { x, y, width, height }（原图坐标）
    let dragging = false;
    let dragStart = null;
    let resultBlob = null;
    let fileName = 'image';

    function setStatus(msg, kind) {
      status.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { status.classList.add('show'); status.textContent = msg; }
      else { status.classList.remove('show'); status.textContent = ''; }
    }

    /* --- 上传 --- */
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
    dz.addEventListener('click', function () { fileInput.click(); });

    function loadFile(file) {
      if (!file || file.type.indexOf('image/') !== 0) {
        setStatus('✗ 请选择图片文件', 'err');
        return;
      }
      fileName = (file.name || 'image').replace(/\.[^.]+$/, '');
      global.U.loadImage(file).then(function (img) {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        sourceCanvas = c;
        workingCanvas = c;
        sourceData = ctx.getImageData(0, 0, c.width, c.height);
        selection = null;
        resultBlob = null;
        btnDownload.disabled = true;
        btnDownload.setAttribute('disabled', 'disabled');
        cmpCard.style.display = 'none';
        dz.style.display = 'none';
        editCard.style.display = '';
        drawPreview();
        updateSelInfo();
        setStatus('✓ 已载入 ' + c.width + ' × ' + c.height + ' 像素，请框选水印区域', 'ok');
      }).catch(function () {
        setStatus('✗ 图片解码失败', 'err');
      });
    }

    /* --- 预览绘制 --- */
    function drawPreview() {
      if (!workingCanvas) return;
      const c = canvas;
      c.width = workingCanvas.width;
      c.height = workingCanvas.height;
      c.style.maxWidth = '100%';
      const ctx = c.getContext('2d');
      ctx.drawImage(workingCanvas, 0, 0);
    }

    function updateSelInfo() {
      selInfo.innerHTML = '';
      if (!selection) {
        selInfo.appendChild(el('span', { class: 'wm-sel-none', text: '尚未选择区域' }));
        return;
      }
      [
        ['X', String(selection.x)], ['Y', String(selection.y)],
        ['宽', String(selection.width)], ['高', String(selection.height)]
      ].forEach(function (pair) {
        selInfo.appendChild(el('span', { class: 'wm-sel-chip' }, [
          el('b', { text: pair[0] }), el('span', { text: pair[1] })
        ]));
      });
    }

    /* --- 框选交互 ---
       用 Pointer Events 统一鼠标 / 触摸 / 手写笔，兼顾移动端 */
    function canvasPoint(evt) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / (rect.width || canvas.width);
      const scaleY = canvas.height / (rect.height || canvas.height);
      const clientX = evt.clientX;
      const clientY = evt.clientY;
      return {
        x: Math.round((clientX - rect.left) * scaleX),
        y: Math.round((clientY - rect.top) * scaleY)
      };
    }

    function showSelBox() {
      if (!selection) { selBox.style.display = 'none'; return; }
      const rect = canvas.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const sx = rect.width / (canvas.width || 1);
      const sy = rect.height / (canvas.height || 1);
      // 注意: 不能写成 ''，那会回落到样式表里的 .wm-sel { display: none }
      selBox.style.display = 'block';
      selBox.style.left = (rect.left - stageRect.left + selection.x * sx) + 'px';
      selBox.style.top = (rect.top - stageRect.top + selection.y * sy) + 'px';
      selBox.style.width = (selection.width * sx) + 'px';
      selBox.style.height = (selection.height * sy) + 'px';
    }

    function beginDrag(e) {
      if (!workingCanvas) {
        setStatus('✗ 请先上传图片，再框选水印区域', 'err');
        return;
      }
      if (e.cancelable) e.preventDefault();
      dragging = true;
      dragStart = canvasPoint(e);
      selection = { x: dragStart.x, y: dragStart.y, width: 0, height: 0 };
      showSelBox();
      updateSelInfo();
    }

    function moveDrag(e) {
      if (!dragging) return;
      if (e.cancelable) e.preventDefault();
      const p = canvasPoint(e);
      selection = {
        x: Math.min(dragStart.x, p.x),
        y: Math.min(dragStart.y, p.y),
        width: Math.abs(p.x - dragStart.x),
        height: Math.abs(p.y - dragStart.y)
      };
      showSelBox();
      updateSelInfo();
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      if (selection && (selection.width < 3 || selection.height < 3)) {
        // 选区太小：保留提示而不是静默清空，让用户知道为什么没生效
        selection = null;
        showSelBox();
        updateSelInfo();
        setStatus('选区太小，请重新拖拽一个更大的区域', 'info');
        return;
      }
      updateSelInfo();
    }

    // Pointer Events：一次注册同时覆盖鼠标与触摸
    canvas.addEventListener('pointerdown', function (e) {
      beginDrag(e);
      // 捕获指针，指针移出画布也能继续拖
      if (canvas.setPointerCapture && e.pointerId !== undefined) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
      }
    });
    canvas.addEventListener('pointermove', moveDrag);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    // 兜底：部分环境只有鼠标事件
    canvas.addEventListener('mousedown', function (e) {
      if (window.PointerEvent) return;
      beginDrag(e);
    });
    // 注册到 window 的监听统一登记，destroy() 时移除，避免反复进出页面累积
    globalHandlers = [];
    [
      ['mousemove', function (e) {
        if (window.PointerEvent) return;
        moveDrag(e);
      }],
      ['mouseup', function () {
        if (window.PointerEvent) return;
        endDrag();
      }]
    ].forEach(function (pair) {
      global.addEventListener(pair[0], pair[1]);
      globalHandlers.push({ type: pair[0], fn: pair[1] });
    });
    // 防止拖动时页面滚动 / 选中文本
    canvas.addEventListener('dragstart', function (e) { e.preventDefault(); });

    /* --- 自动检测 --- */
    function doDetect() {
      if (!sourceCanvas) {
        setStatus('✗ 请先上传图片', 'err');
        return;
      }
      const ctx = sourceCanvas.getContext('2d');
      const data = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
      const found = Core.detectWatermark(data, {});
      if (!found.length) {
        setStatus('未找到明显的水印区域，请手动框选', 'info');
        return;
      }
      // 取分数最高的一块
      const best = found[0];
      selection = { x: best.x, y: best.y, width: best.width, height: best.height };
      showSelBox();
      updateSelInfo();
      setStatus('✓ 检测到 ' + found.length + ' 处候选，已选中置信度最高的一处（' + best.score + '）', 'ok');
    }

    /* --- 应用修复 --- */
    function applyFix() {
      if (!sourceCanvas) {
        setStatus('✗ 请先上传图片', 'err');
        return;
      }
      if (!selection) {
        setStatus('✗ 请先框选要修复的区域', 'err');
        return;
      }
      // 从原图副本重新开始，避免多次修复叠加
      const c = document.createElement('canvas');
      c.width = sourceCanvas.width;
      c.height = sourceCanvas.height;
      const ctx = c.getContext('2d');
      ctx.putImageData(sourceData, 0, 0);

      const imgData = ctx.getImageData(0, 0, c.width, c.height);
      const opts = {
        method: methodSel.value,
        radius: parseInt(radiusInput.value, 10) || 8,
        offsetX: parseInt(offsetX.value, 10) || 0,
        offsetY: parseInt(offsetY.value, 10) || 0
      };
      const r = Core.removeWatermark(imgData, selection, opts);
      if (!r.ok) {
        setStatus('✗ ' + r.error, 'err');
        return;
      }
      ctx.putImageData(imgData, 0, 0);
      workingCanvas = c;
      drawPreview();
      showSelBox();
      updateSelInfo();

      // 结果画布
      const rc = resultCanvas;
      rc.width = c.width;
      rc.height = c.height;
      rc.getContext('2d').drawImage(c, 0, 0);
      cmpCard.style.display = '';

      stats.innerHTML = '';
      [
        ['图片尺寸', c.width + ' × ' + c.height],
        ['修复区域', selection.width + ' × ' + selection.height],
        ['修复方式', opts.method],
        ['处理像素', String(r.changed)]
      ].forEach(function (pair) {
        stats.appendChild(el('div', { class: 'stat' }, [
          el('span', { class: 'stat-value', text: pair[1] }),
          el('span', { class: 'stat-label', text: pair[0] })
        ]));
      });

      setStatus('✓ 修复完成，可下载或继续调整参数', 'ok');
    }

    /* --- 还原 --- */
    function resetImage() {
      if (!sourceCanvas) {
        setStatus('✗ 请先上传图片', 'err');
        return;
      }
      const c = document.createElement('canvas');
      c.width = sourceCanvas.width;
      c.height = sourceCanvas.height;
      const ctx = c.getContext('2d');
      ctx.putImageData(sourceData, 0, 0);
      workingCanvas = c;
      drawPreview();
      showSelBox();
      resultBlob = null;
      btnDownload.disabled = true;
      btnDownload.setAttribute('disabled', 'disabled');
      cmpCard.style.display = 'none';
      setStatus('已还原为原图', 'info');
    }

    /* --- 下载 --- */
    function doDownload() {
      if (!workingCanvas) {
        setStatus('✗ 请先上传图片', 'err');
        return;
      }
      const type = fmtSel.value;
      const ext = type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'webp';
      workingCanvas.toBlob(function (blob) {
        if (!blob) {
          setStatus('✗ 导出失败，请换一种格式', 'err');
          return;
        }
        resultBlob = blob;
        downloadBlob(blob, fileName + '-nowatermark.' + ext);
        setStatus('✓ 已导出 ' + global.U.formatBytes(blob.size), 'ok');
      }, type, type === 'image/png' ? undefined : 0.92);
    }

    /* --- 方法切换 --- */
    methodSel.addEventListener('change', function () {
      patchField.style.display = methodSel.value === 'patch' ? '' : 'none';
    });

    /* --- 键盘快捷：Esc 清空选区 --- */
    function onKey(e) {
      if (e.key === 'Escape' && selection) {
        selection = null;
        showSelBox();
        updateSelInfo();
      }
    }
    keyHandler = onKey;
    document.addEventListener('keydown', onKey);
  }

  /** 离开页面时清理全局监听 */
  function destroy() {
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
    if (globalHandlers) {
      globalHandlers.forEach(function (h) {
        global.removeEventListener(h.type, h.fn);
      });
      globalHandlers = null;
    }
  }

  global.WatermarkTool = { render: render, destroy: destroy };
})(window);
