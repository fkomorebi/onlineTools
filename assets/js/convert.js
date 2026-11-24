/* ============================================
   图片格式转换（PNG ⇄ WebP ⇄ JPEG）
   ============================================ */
(function (global) {
  'use strict';

  const { el, formatBytes, downloadBlob } = global.U;
  const Core = global.ImageCore;

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: '图片格式转换' }));
    head.appendChild(el('p', { text: 'PNG 转 WebP、WebP 转 PNG、JPEG 互转，支持批量与透明背景处理。' }));
    root.appendChild(head);

    /* --- 上传区 --- */
    const dz = el('div', { class: 'dropzone' }, [
      el('div', { class: 'dropzone-icon', text: '🔄' }),
      el('div', { class: 'dropzone-title', text: '点击选择图片，或拖放到这里' }),
      el('div', { class: 'dropzone-hint', html: 'PNG / JPG / WebP / AVIF · <b>可多选</b>' })
    ]);
    const fileInput = el('input', {
      type: 'file', accept: 'image/*', multiple: 'multiple', style: 'display:none',
      onchange: function (e) { addFiles(e.target.files); }
    });
    root.appendChild(dz);
    root.appendChild(fileInput);

    /* --- 设置 --- */
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title', text: '转换设置' }));
    const grid = el('div', { class: 'grid-2' });

    const fmtField = el('div', { class: 'field' });
    fmtField.appendChild(el('label', { class: 'field-label', text: '目标格式' }));
    const fmtSel = el('select', {});
    fmtSel.appendChild(el('option', { value: 'image/webp', text: 'WebP' }));
    fmtSel.appendChild(el('option', { value: 'image/png', text: 'PNG（保留透明）' }));
    fmtSel.appendChild(el('option', { value: 'image/jpeg', text: 'JPEG' }));
    fmtField.appendChild(fmtSel);
    grid.appendChild(fmtField);

    const qField = el('div', { class: 'field' });
    qField.appendChild(el('label', { class: 'field-label', text: '质量：' }));
    const qVal = el('span', { class: 'mono', text: '90%', style: 'margin-left:6px' });
    qField.appendChild(qVal);
    const qRange = el('input', {
      type: 'range', min: '30', max: '100', step: '5', value: '90',
      oninput: function () { qVal.textContent = this.value + '%'; }
    });
    qField.appendChild(qRange);
    qField.appendChild(el('p', { class: 'hint', text: 'PNG 输出时质量参数无效（无损）。' }));
    grid.appendChild(qField);

    card.appendChild(grid);
    root.appendChild(card);

    /* --- 操作 --- */
    const actions = el('div', { class: 'toolbar' });
    const btnConvert = el('button', { class: 'btn btn-primary', text: '开始转换', onclick: convertAll });
    const btnDownloadAll = el('button', { class: 'btn btn-success', text: '全部下载', onclick: downloadAll, disabled: 'disabled' });
    const btnClear = el('button', { class: 'btn btn-danger', text: '清空', onclick: clearAll });
    actions.appendChild(btnConvert);
    actions.appendChild(btnDownloadAll);
    actions.appendChild(btnClear);
    actions.appendChild(el('span', { class: 'spacer' }));
    const status = el('div', { class: 'status' });
    actions.appendChild(status);
    root.appendChild(actions);

    /* --- 结果 --- */
    const resCard = el('div', { class: 'card' });
    resCard.style.display = 'none';
    resCard.appendChild(el('div', { class: 'card-title', text: '结果' }));
    const grid2 = el('div', { class: 'compare-grid' });
    const beforeCol = el('div');
    beforeCol.appendChild(el('div', { class: 'card-title', text: '转换前' }));
    const beforeBox = el('div', { class: 'dropzone', style: 'padding:20px' });
    beforeCol.appendChild(beforeBox);
    const afterCol = el('div');
    afterCol.appendChild(el('div', { class: 'card-title', text: '转换后' }));
    const afterBox = el('div', { class: 'dropzone', style: 'padding:20px' });
    afterCol.appendChild(afterBox);
    grid2.appendChild(beforeCol);
    grid2.appendChild(afterCol);
    resCard.appendChild(grid2);

    const dlBtn = el('div', { class: 'toolbar', style: 'margin-top:14px' });
    const btnDownloadOne = el('button', { class: 'btn btn-success', text: '下载转换结果', onclick: downloadCurrent });
    dlBtn.appendChild(btnDownloadOne);
    resCard.appendChild(dlBtn);
    root.appendChild(resCard);

    let items = [];
    let current = null;

    function setStatus(msg, kind) {
      status.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { status.classList.add('show'); status.textContent = msg; }
      else { status.classList.remove('show'); status.textContent = ''; }
    }

    function addFiles(fileList) {
      const files = Array.prototype.slice.call(fileList || []).filter(function (f) {
        return f.type.indexOf('image/') === 0;
      });
      if (!files.length) { setStatus('✗ 请选择图片文件', 'err'); fileInput.value = ''; return; }
      files.forEach(function (f) {
        items.push({
          file: f, name: f.name, size: f.size, outBlob: null, outName: null,
          w: 0, h: 0
        });
      });
      fileInput.value = '';
      setStatus('✓ 已添加 ' + files.length + ' 张图片，点击「开始转换」', 'ok');
    }

    function clearAll() {
      items = [];
      current = null;
      resCard.style.display = 'none';
      btnDownloadAll.disabled = true;
      setStatus('', null);
    }

    function convertAll() {
      if (!items.length) { setStatus('✗ 请先添加图片', 'err'); return; }
      const format = fmtSel.value;
      const quality = parseInt(qRange.value, 10) / 100;

      btnConvert.disabled = true;
      setStatus('正在转换 0 / ' + items.length + ' …', 'info');

      let done = 0;
      items.reduce(function (p, it) {
        return p.then(function () {
          return Core.process(it.file, {
            format: format, quality: quality, background: '#ffffff'
          }).then(function (res) {
            it.outBlob = res.blob;
            it.w = res.width; it.h = res.height;
            it.outName = Core.buildFilename(it.name, Core.OUTPUT_FORMATS[format].ext);
            done++;
            setStatus('正在转换 ' + done + ' / ' + items.length + ' …', 'info');
          }).catch(function (e) {
            done++;
            setStatus('✗ ' + it.name + '：' + (e && e.message ? e.message : '转换失败'), 'err');
          });
        });
      }, Promise.resolve()).then(function () {
        btnConvert.disabled = false;
        const ok = items.filter(function (i) { return i.outBlob; });
        if (ok.length) {
          current = ok[0];
          showPreview(current);
          resCard.style.display = '';
          btnDownloadAll.disabled = false;
          setStatus('✓ 完成 ' + ok.length + ' 张', 'ok');
        } else {
          setStatus('✗ 全部转换失败', 'err');
        }
      });
    }

    function showPreview(it) {
      beforeBox.innerHTML = '';
      afterBox.innerHTML = '';

      const b = el('img', { style: 'max-width:100%;max-height:300px;border-radius:6px;display:block;margin:0 auto' });
      b.src = URL.createObjectURL(it.file);
      beforeBox.appendChild(b);
      beforeBox.appendChild(el('div', {
        class: 'file-meta', style: 'justify-content:center;margin-top:10px',
        html: '<span>' + formatBytes(it.size) + '</span><span>' + it.name + '</span>'
      }));

      const a = el('img', { style: 'max-width:100%;max-height:300px;border-radius:6px;display:block;margin:0 auto' });
      a.src = URL.createObjectURL(it.outBlob);
      afterBox.appendChild(a);
      const delta = Math.round((1 - it.outBlob.size / Math.max(1, it.size)) * 100);
      afterBox.appendChild(el('div', {
        class: 'file-meta', style: 'justify-content:center;margin-top:10px',
        html: '<span>' + formatBytes(it.outBlob.size) + '</span>' +
              '<span>' + it.outName + '</span>' +
              '<span class="' + (delta >= 0 ? 'save' : 'grow') + '">' +
              (delta >= 0 ? '↓ ' : '↑ ') + Math.abs(delta) + '%</span>'
      }));
    }

    function downloadCurrent() {
      if (!current) return;
      downloadBlob(current.outBlob, current.outName);
    }

    function downloadAll() {
      const ready = items.filter(function (i) { return i.outBlob; });
      ready.forEach(function (it, idx) {
        setTimeout(function () { downloadBlob(it.outBlob, it.outName); }, idx * 220);
      });
    }

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
  }

  global.ConvertTool = { render: render };
})(window);
