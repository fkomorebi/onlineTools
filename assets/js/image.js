/* ============================================
   图片压缩（批量）
   ============================================ */
(function (global) {
  'use strict';

  const { el, formatBytes, downloadBlob, naturalSort } = global.U;
  const Core = global.ImageCore;

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: '图片压缩' }));
    head.appendChild(el('p', { text: '批量压缩图片，支持 WebP / JPEG 输出，可限制尺寸。全部在本机处理，图片不会上传。' }));
    root.appendChild(head);

    /* --- 上传区 --- */
    const dz = el('div', { class: 'dropzone', id: 'img-drop' }, [
      el('div', { class: 'dropzone-icon', text: '🖼️' }),
      el('div', { class: 'dropzone-title', text: '点击选择图片，或将文件拖到这里' }),
      el('div', { class: 'dropzone-hint', html: '支持 PNG / JPG / WebP / GIF / BMP / AVIF · <b>可多选</b>' })
    ]);
    const fileInput = el('input', {
      type: 'file', accept: 'image/*', multiple: 'multiple',
      style: 'display:none', id: 'img-file',
      onchange: function (e) { addFiles(e.target.files); }
    });
    root.appendChild(dz);
    root.appendChild(fileInput);

    /* --- 设置 --- */
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title', text: '压缩设置' }));

    const grid = el('div', { class: 'grid-2' });

    // 输出格式
    const fmtField = el('div', { class: 'field' });
    fmtField.appendChild(el('label', { class: 'field-label', text: '输出格式' }));
    const fmtSel = el('select', { id: 'img-format' });
    fmtSel.appendChild(el('option', { value: 'image/webp', text: 'WebP（推荐，体积最小）' }));
    fmtSel.appendChild(el('option', { value: 'image/jpeg', text: 'JPEG（兼容性最好）' }));
    fmtSel.appendChild(el('option', { value: 'image/png', text: 'PNG（无损，体积较大）' }));
    fmtField.appendChild(fmtSel);
    grid.appendChild(fmtField);

    // 目标体积
    const sizeField = el('div', { class: 'field' });
    sizeField.appendChild(el('label', { class: 'field-label', text: '目标体积（每张，KB）' }));
    const sizeInput = el('input', { type: 'number', id: 'img-target', value: '200', min: '1', step: '1' });
    sizeField.appendChild(sizeInput);
    sizeField.appendChild(el('p', { class: 'hint', text: '留空或填 0 表示不做体积限制，仅按下方质量参数压缩。' }));
    grid.appendChild(sizeField);

    // 质量
    const qField = el('div', { class: 'field' });
    qField.appendChild(el('label', { class: 'field-label', text: '质量：' }));
    const qVal = el('span', { class: 'mono', text: '80%', style: 'margin-left:6px' });
    qField.appendChild(qVal);
    const qRange = el('input', {
      type: 'range', min: '10', max: '100', step: '5', value: '80',
      oninput: function () { qVal.textContent = this.value + '%'; }
    });
    qField.appendChild(qRange);
    qField.appendChild(el('p', { class: 'hint', text: '仅在未设置目标体积时生效。目标体积模式会自动调节质量。' }));
    grid.appendChild(qField);

    // 尺寸限制
    const dimField = el('div', { class: 'field' });
    dimField.appendChild(el('label', { class: 'field-label', text: '最大宽度 / 高度（像素）' }));
    const dimRow = el('div', { class: 'dim-row' });
    const wIn = el('input', { type: 'number', id: 'img-maxw', placeholder: '宽度', min: '0' });
    const hIn = el('input', { type: 'number', id: 'img-maxh', placeholder: '高度', min: '0' });
    dimRow.appendChild(wIn);
    dimRow.appendChild(el('span', { class: 'dim-sep', text: '×' }));
    dimRow.appendChild(hIn);
    dimField.appendChild(dimRow);
    dimField.appendChild(el('p', { class: 'hint', text: '填 0 表示不限制，超出时等比缩小。' }));
    grid.appendChild(dimField);

    card.appendChild(grid);
    root.appendChild(card);

    /* --- 操作按钮 --- */
    const actions = el('div', { class: 'toolbar' });
    const btnCompress = el('button', { class: 'btn btn-primary', text: '开始压缩', onclick: compressAll });
    const btnDownloadAll = el('button', { class: 'btn btn-success', text: '全部下载', onclick: downloadAll, disabled: 'disabled' });
    const btnClear = el('button', { class: 'btn btn-danger', text: '清空列表', onclick: clearAll });
    actions.appendChild(btnCompress);
    actions.appendChild(btnDownloadAll);
    actions.appendChild(btnClear);
    actions.appendChild(el('span', { class: 'spacer' }));
    const status = el('div', { class: 'status' });
    actions.appendChild(status);
    root.appendChild(actions);

    /* --- 文件列表 --- */
    const listCard = el('div', { class: 'card', id: 'img-list-card' });
    listCard.style.display = 'none';
    listCard.appendChild(el('div', { class: 'card-title', text: '文件列表' }));
    const summary = el('div', { class: 'stats', id: 'img-summary' });
    listCard.appendChild(summary);
    const list = el('div', { class: 'file-list', id: 'img-list' });
    listCard.appendChild(list);
    root.appendChild(listCard);

    /* --- 状态 --- */
    let items = [];   // { id, file, name, size, thumb, outBlob, outName, origW, origH }

    /* --- 拖放 --- */
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

    function addFiles(fileList) {
      const files = Array.prototype.slice.call(fileList || []);
      const valid = files.filter(function (f) { return f.type.indexOf('image/') === 0; });
      if (!valid.length) {
        setStatus('✗ 请选择图片文件', 'err');
        fileInput.value = '';
        return;
      }
      valid.forEach(function (f) {
        const id = 'f' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        items.push({
          id: id,
          file: f,
          name: f.name,
          size: f.size,
          outBlob: null,
          outName: null,
          origW: 0,
          origH: 0
        });
      });
      fileInput.value = '';
      renderList();
      setStatus('✓ 已添加 ' + valid.length + ' 张图片，点击「开始压缩」', 'ok');
    }

    function renderList() {
      list.innerHTML = '';
      summary.innerHTML = '';
      if (!items.length) { listCard.style.display = 'none'; return; }
      listCard.style.display = '';

      const totalOrig = items.reduce(function (s, i) { return s + i.size; }, 0);
      const done = items.filter(function (i) { return i.outBlob; });
      const totalNew = done.reduce(function (s, i) { return s + i.outBlob.size; }, 0);

      [['图片数', String(items.length)],
       ['原始体积', formatBytes(totalOrig)],
       ['压缩后', done.length ? formatBytes(totalNew) : '—'],
       ['节省', (totalNew && totalOrig) ? Math.round((1 - totalNew / totalOrig) * 100) + '%' : '—']
      ].forEach(function (it) {
        summary.appendChild(el('div', { class: 'stat' }, [
          el('span', { class: 'stat-value', text: it[1] }),
          el('span', { class: 'stat-label', text: it[0] })
        ]));
      });

      items.slice().sort(function (a, b) { return naturalSort(a.name, b.name); }).forEach(function (it) {
        const row = el('div', { class: 'file-item' });

        const thumb = el('img', { class: 'file-thumb', alt: '' });
        const url = URL.createObjectURL(it.file);
        thumb.src = url;
        thumb.addEventListener('load', function () { URL.revokeObjectURL(url); });

        const info = el('div', { class: 'file-info' });
        info.appendChild(el('div', { class: 'file-name', text: it.name, title: it.name }));
        const meta = el('div', { class: 'file-meta' });
        meta.appendChild(el('span', { text: formatBytes(it.size) }));
        if (it.origW) meta.appendChild(el('span', { text: it.origW + '×' + it.origH }));
        if (it.outBlob) {
          meta.appendChild(el('span', { text: '→ ' + formatBytes(it.outBlob.size) }));
          const pct = Math.round((1 - it.outBlob.size / Math.max(1, it.size)) * 100);
          meta.appendChild(el('span', {
            class: pct >= 0 ? 'save' : 'grow',
            text: (pct >= 0 ? '↓ ' : '↑ ') + Math.abs(pct) + '%'
          }));
        } else {
          meta.appendChild(el('span', { text: '待压缩', style: 'color:var(--text-faint)' }));
        }
        info.appendChild(meta);

        const right = el('div', { class: 'btn-group' });
        if (it.outBlob) {
          right.appendChild(el('button', {
            class: 'btn btn-sm btn-success', text: '下载',
            onclick: function () {
              downloadBlob(it.outBlob, it.outName);
            }
          }));
        }
        right.appendChild(el('button', {
          class: 'file-remove', text: '✕', title: '移除',
          onclick: function () {
            items = items.filter(function (x) { return x.id !== it.id; });
            renderList();
          }
        }));

        row.appendChild(thumb);
        row.appendChild(info);
        row.appendChild(right);
        list.appendChild(row);
      });

      btnDownloadAll.disabled = !items.some(function (i) { return i.outBlob; });
    }

    function clearAll() {
      items = [];
      renderList();
      setStatus('', null);
    }

    function compressAll() {
      if (!items.length) { setStatus('✗ 请先添加图片', 'err'); return; }

      const format = fmtSel.value;
      const quality = parseInt(qRange.value, 10) / 100;
      const targetKB = parseInt(sizeInput.value, 10) || 0;
      const maxW = parseInt(wIn.value, 10) || 0;
      const maxH = parseInt(hIn.value, 10) || 0;
      const targetBytes = targetKB * 1024;

      if (format === 'image/png' && targetBytes) {
        setStatus('注意：PNG 为无损格式，不进行目标体积自动调质。', 'info');
      }

      btnCompress.disabled = true;
      setStatus('正在压缩 0 / ' + items.length + ' …', 'info');

      let done = 0;
      const chain = items.reduce(function (p, it) {
        return p.then(function () {
          return Core.inspect(it.file).then(function (dim) {
            it.origW = dim.width; it.origH = dim.height;
          }).catch(function () {}).then(function () {
            return Core.compressToTarget(it.file, {
              format: format,
              quality: quality,
              targetBytes: targetBytes,
              maxWidth: maxW,
              maxHeight: maxH,
              background: '#ffffff'
            });
          }).then(function (res) {
            it.outBlob = res.blob;
            it.origW = res.width || it.origW;
            it.origH = res.height || it.origH;
            it.outName = Core.buildFilename(it.name, Core.OUTPUT_FORMATS[format].ext);
            done++;
            setStatus('正在压缩 ' + done + ' / ' + items.length + ' …', 'info');
            renderList();
          }).catch(function (e) {
            done++;
            setStatus('✗ ' + it.name + '：' + (e && e.message ? e.message : '处理失败'), 'err');
          });
        });
      }, Promise.resolve());

      chain.then(function () {
        btnCompress.disabled = false;
        const totalOrig = items.reduce(function (s, i) { return s + i.size; }, 0);
        const totalNew = items.reduce(function (s, i) { return s + (i.outBlob ? i.outBlob.size : i.size); }, 0);
        const saved = Math.round((1 - totalNew / Math.max(1, totalOrig)) * 100);
        setStatus('✓ 完成：' + formatBytes(totalOrig) + ' → ' + formatBytes(totalNew) +
          '，节省 ' + saved + '%', 'ok');
        renderList();
      });
    }

    function downloadAll() {
      const ready = items.filter(function (i) { return i.outBlob; });
      if (!ready.length) return;
      ready.forEach(function (it, idx) {
        setTimeout(function () { downloadBlob(it.outBlob, it.outName); }, idx * 220);
      });
    }
  }

  global.ImageTool = { render: render };
})(window);
