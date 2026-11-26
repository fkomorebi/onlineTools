/* ============================================
   音频格式转换（页面）
   —— 拖入/选择音频 → 解码 → 重采样/声道处理 → 编码为目标格式
   —— 全程本地完成，音频文件不会上传
   ============================================ */
(function (global) {
  'use strict';

  const { el, formatBytes, downloadBlob, readFileAsArrayBuffer } = global.U;
  const Core = global.AudioCore;

  const FORMAT_OPTIONS = [
    { mime: 'audio/wav', label: 'WAV（未压缩，体积大）' },
    { mime: 'audio/flac', label: 'FLAC（无损压缩）' },
    { mime: 'audio/ogg', label: 'OGG（Opus，有损）' },
    { mime: 'audio/mpeg', label: 'MP3（有损）' },
    { mime: 'audio/webm', label: 'WebM 音频（Opus，有损）' }
  ];

  const RATE_OPTIONS = [
    { value: 0, label: '保持原样' },
    { value: 8000, label: '8 kHz（电话音质）' },
    { value: 16000, label: '16 kHz（语音）' },
    { value: 22050, label: '22.05 kHz' },
    { value: 32000, label: '32 kHz' },
    { value: 44100, label: '44.1 kHz（CD）' },
    { value: 48000, label: '48 kHz' }
  ];

  const CHANNEL_OPTIONS = [
    { value: 0, label: '保持原样' },
    { value: 1, label: '单声道' },
    { value: 2, label: '立体声' }
  ];

  let items = [];
  let seq = 0;

  function state() {
    return {
      format: $('#au-format').value,
      sampleRate: Number($('#au-rate').value) || 0,
      channels: Number($('#au-channels').value) || 0
    };
  }

  function $(sel) { return document.querySelector(sel); }

  function setStatus(msg, kind) {
    const elStatus = $('.status');
    if (!elStatus) return;
    elStatus.className = 'status' + (kind ? ' ' + kind : '');
    if (kind) {
      elStatus.classList.add('show');
      elStatus.textContent = msg;
    } else {
      elStatus.classList.remove('show');
      elStatus.textContent = '';
    }
  }

  function render(root) {
    items = [];
    seq = 0;
    root.innerHTML = '';

    // ---------- 标题 ----------
    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: '🎵 音频格式转换' }));
    head.appendChild(el('p', {
      text: '把 MP3 / WAV / OGG / FLAC 等音频转换成其他格式，可顺便重采样、转换单双声道 —— 全部在浏览器里完成，音频不会上传。'
    }));
    root.appendChild(head);

    // ---------- 拖放区 ----------
    const dz = el('div', { class: 'dropzone' });
    dz.appendChild(el('div', { class: 'dropzone-icon', text: '🎧' }));
    dz.appendChild(el('div', { class: 'dropzone-title', text: '把音频文件拖到这里' }));
    dz.appendChild(el('div', {
      class: 'dropzone-hint',
      html: '或 <span class="kbd">点击选择</span> 文件 · 支持 WAV / MP3 / OGG / FLAC / M4A / WebM · 可多选'
    }));
    root.appendChild(dz);

    const fileInput = el('input', {
      type: 'file',
      accept: 'audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.weba',
      multiple: 'multiple',
      style: 'display:none',
      onchange: function (e) {
        addFiles(e.target.files);
        fileInput.value = '';
      }
    });
    root.appendChild(fileInput);

    // ---------- 设置 ----------
    const card = el('div', { class: 'card' });
    card.appendChild(el('div', { class: 'card-title', text: '转换设置' }));

    const grid = el('div', { class: 'grid-2' });

    const fFormat = el('div', { class: 'field' });
    fFormat.appendChild(el('label', { class: 'field-label', for: 'au-format', text: '输出格式' }));
    const selFormat = el('select', { id: 'au-format', onchange: refreshFormatHint });
    // 按浏览器能力标注：可用的正常显示，不可用的加「（当前浏览器不支持）」后缀
    FORMAT_OPTIONS.forEach(function (o) {
      const available = Core.LOSSLESS_FORMATS[o.mime] || Core.supportsFormat(o.mime);
      const label = available ? o.label : o.label + '（当前浏览器不支持）';
      selFormat.appendChild(el('option', {
        value: o.mime,
        text: label,
        disabled: available ? null : 'disabled'
      }));
    });
    fFormat.appendChild(selFormat);
    fFormat.appendChild(el('p', { class: 'hint', id: 'au-format-hint', text: '' }));
    grid.appendChild(fFormat);

    // 默认选中「当前浏览器真正可用」的格式：
    // 优先选可用的压缩格式（体积小），没有则退回 WAV
    const preferred = FORMAT_OPTIONS.find(function (o) {
      return !Core.LOSSLESS_FORMATS[o.mime] && Core.supportsFormat(o.mime);
    });
    const fallback = FORMAT_OPTIONS.find(function (o) { return Core.LOSSLESS_FORMATS[o.mime]; });
    const defaultOpt = preferred || fallback || FORMAT_OPTIONS[0];
    selFormat.value = defaultOpt.mime;

    const fRate = el('div', { class: 'field' });
    fRate.appendChild(el('label', { class: 'field-label', for: 'au-rate', text: '采样率' }));
    const selRate = el('select', { id: 'au-rate' });
    RATE_OPTIONS.forEach(function (o) {
      selRate.appendChild(el('option', { value: String(o.value), text: o.label }));
    });
    fRate.appendChild(selRate);
    fRate.appendChild(el('p', { class: 'hint', text: '降低采样率可显著减小体积（会损失高频细节）。' }));
    grid.appendChild(fRate);

    const fCh = el('div', { class: 'field' });
    fCh.appendChild(el('label', { class: 'field-label', for: 'au-channels', text: '声道' }));
    const selCh = el('select', { id: 'au-channels' });
    CHANNEL_OPTIONS.forEach(function (o) {
      selCh.appendChild(el('option', { value: String(o.value), text: o.label }));
    });
    fCh.appendChild(selCh);
    fCh.appendChild(el('p', { class: 'hint', text: '单声道可让语音更省空间。' }));
    grid.appendChild(fCh);

    card.appendChild(grid);
    root.appendChild(card);

    // ---------- 工具栏 ----------
    const toolbar = el('div', { class: 'toolbar' });
    toolbar.appendChild(el('button', {
      class: 'btn btn-primary',
      text: '开始转换',
      onclick: convertAll
    }));
    const btnAll = el('button', {
      class: 'btn btn-success',
      text: '全部下载',
      disabled: 'disabled',
      onclick: downloadAll
    });
    toolbar.appendChild(btnAll);
    toolbar.appendChild(el('button', {
      class: 'btn btn-danger',
      text: '清空列表',
      onclick: clearAll
    }));
    toolbar.appendChild(el('span', { class: 'spacer' }));
    toolbar.appendChild(el('div', { class: 'status' }));
    root.appendChild(toolbar);

    // ---------- 结果列表 ----------
    const listCard = el('div', { class: 'card', id: 'au-list-card', style: 'display:none' });
    listCard.appendChild(el('div', { class: 'card-title', text: '转换结果' }));
    const stats = el('div', { class: 'stats', id: 'au-summary' });
    listCard.appendChild(stats);
    const list = el('div', { class: 'file-list', id: 'au-list' });
    listCard.appendChild(list);
    root.appendChild(listCard);

    refreshFormatHint();

    // ---------- 事件 ----------
    dz.addEventListener('click', function () { fileInput.click(); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        dz.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        dz.classList.remove('dragover');
      });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });

    // 供内部使用
    root.__auRefresh = function () { renderList(); };
  }

  function refreshFormatHint() {
    const hint = document.getElementById('au-format-hint');
    if (!hint) return;
    const mime = state().format;
    const fmt = Core.OUTPUT_FORMATS[mime];
    if (!fmt) { hint.textContent = ''; return; }
    if (Core.LOSSLESS_FORMATS[mime]) {
      hint.textContent = '无损编码，转换后音质与原文件一致（FLAC 由本工具内置编码器生成，无需浏览器支持）。';
    } else if (!Core.supportsFormat(fmt.mime)) {
      hint.textContent = '⚠ 当前浏览器不支持输出 ' + fmt.label + '（缺少 ' + fmt.mime + ' 编码器），请改用其他格式。';
    } else {
      hint.textContent = '有损编码，体积更小；质量由浏览器内置编码器决定。';
    }
  }

  function isAudioFile(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf('audio/') === 0) return true;
    const ext = Core.guessExt(file.name);
    return ['wav', 'mp3', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'weba', 'webm', 'opus'].indexOf(ext) >= 0;
  }

  function addFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    const valid = files.filter(isAudioFile);
    if (!valid.length) {
      setStatus('✗ 请选择音频文件（wav / mp3 / ogg / flac / m4a 等）', 'err');
      return;
    }
    const rejected = files.length - valid.length;
    valid.forEach(function (f) {
      items.push({
        id: ++seq,
        file: f,
        name: f.name || ('audio-' + seq),
        size: f.size || 0,
        outBlob: null,
        outName: '',
        outSize: 0,
        info: null,
        error: ''
      });
    });
    renderList();
    setStatus(
      '✓ 已添加 ' + valid.length + ' 个文件' + (rejected ? '（' + rejected + ' 个非音频文件已忽略）' : ''),
      'ok'
    );
  }

  function renderList() {
    const list = document.getElementById('au-list');
    const card = document.getElementById('au-list-card');
    const summary = document.getElementById('au-summary');
    if (!list || !card) return;
    list.innerHTML = '';

    if (!items.length) {
      card.style.display = 'none';
      if (summary) summary.innerHTML = '';
      return;
    }
    card.style.display = '';

    const done = items.filter(function (it) { return it.outBlob; });
    const totalIn = items.reduce(function (s, it) { return s + (it.size || 0); }, 0);
    const totalOut = done.reduce(function (s, it) { return s + (it.outSize || 0); }, 0);

    if (summary) {
      summary.innerHTML =
        '<div class="stat"><div class="stat-value">' + items.length + '</div><div class="stat-label">文件数</div></div>' +
        '<div class="stat"><div class="stat-value">' + done.length + '</div><div class="stat-label">已转换</div></div>' +
        '<div class="stat"><div class="stat-value">' + formatBytes(totalIn) + '</div><div class="stat-label">原始体积</div></div>' +
        '<div class="stat"><div class="stat-value">' + formatBytes(totalOut) + '</div><div class="stat-label">输出体积</div></div>';
    }

    items.forEach(function (it) {
      const row = el('div', { class: 'file-item' });
      const info = el('div', { class: 'file-info' });
      info.appendChild(el('div', { class: 'file-name', text: it.name }));

      const meta = el('div', { class: 'file-meta' });
      const parts = [formatBytes(it.size)];
      if (it.info) {
        parts.push(Core.formatDuration(it.info.duration));
        parts.push(Core.formatSampleRate(it.info.sampleRate) + ' · ' + it.info.channels + ' ch');
      }
      if (it.outBlob) {
        parts.push('→ ' + it.outName + ' · ' + formatBytes(it.outSize));
        const ratio = it.size ? Math.round((1 - it.outSize / it.size) * 100) : 0;
        meta.appendChild(el('span', { class: 'grow' }));
        meta.appendChild(el('span', {
          class: 'save',
          text: (ratio >= 0 ? '↓ ' : '↑ ') + Math.abs(ratio) + '%'
        }));
      } else if (it.error) {
        parts.push('✗ ' + it.error);
        meta.appendChild(el('span', { class: 'grow' }));
        meta.appendChild(el('span', { class: 'save', text: '失败' }));
      }
      meta.insertBefore(el('span', { text: parts.join(' · ') }), meta.firstChild);
      info.appendChild(meta);
      row.appendChild(info);

      const group = el('div', { class: 'btn-group' });
      if (it.outBlob) {
        group.appendChild(el('button', {
          class: 'btn btn-sm btn-success',
          text: '下载',
          onclick: function () { downloadBlob(it.outBlob, it.outName); }
        }));
      }
      group.appendChild(el('button', {
        class: 'btn btn-sm file-remove',
        text: '✕',
        onclick: function () {
          items = items.filter(function (x) { return x.id !== it.id; });
          renderList();
        }
      }));
      row.appendChild(group);
      list.appendChild(row);
    });

    const btnAll = document.querySelector('.toolbar .btn-success');
    if (btnAll) {
      if (done.length) btnAll.removeAttribute('disabled');
      else btnAll.setAttribute('disabled', 'disabled');
    }
  }

  function convertAll() {
    if (!items.length) {
      setStatus('✗ 请先添加音频文件', 'err');
      return;
    }
    if (!Core.hasAudioContext()) {
      setStatus('✗ 当前浏览器不支持 Web Audio API，无法解码音频', 'err');
      return;
    }
    const opts = state();
    if (!Core.supportsFormat(opts.format) && !Core.LOSSLESS_FORMATS[opts.format]) {
      const fmt = Core.OUTPUT_FORMATS[opts.format];
      setStatus('✗ 当前浏览器不支持输出 ' + (fmt ? fmt.label : opts.format) + '，请改用 WAV 或 FLAC', 'err');
      return;
    }

    const btn = document.querySelector('.toolbar .btn-primary');
    if (btn) btn.setAttribute('disabled', 'disabled');

    items.forEach(function (it) { it.outBlob = null; it.error = ''; it.info = null; });
    renderList();

    let done = 0;
    const chain = items.reduce(function (p, it) {
      return p.then(function () {
        setStatus('正在转换 ' + (done + 1) + ' / ' + items.length + '：' + it.name, 'info');
        return readFileAsArrayBuffer(it.file)
          .then(function (buf) {
            return Core.convert(buf, opts).then(function (result) {
              it.info = {
                duration: result.duration,
                sampleRate: result.sampleRate,
                channels: result.channels
              };
              const fmt = Core.OUTPUT_FORMATS[opts.format];
              it.outBlob = result.blob;
              it.outName = Core.buildFilename(it.name, fmt.ext);
              it.outSize = result.blob.size;
              done++;
              renderList();
            });
          })
          .catch(function (err) {
            it.error = err && err.message ? err.message : String(err);
            done++;
            renderList();
          });
      });
    }, Promise.resolve());

    chain.then(function () {
      if (btn) btn.removeAttribute('disabled');
      const okCount = items.filter(function (x) { return x.outBlob; }).length;
      const failCount = items.length - okCount;
      if (okCount && failCount) {
        setStatus('✓ 完成 ' + okCount + ' 个，' + failCount + ' 个失败', 'err');
      } else if (okCount) {
        setStatus('✓ 完成 ' + okCount + ' 个文件', 'ok');
      } else {
        setStatus('✗ 全部转换失败，请检查文件是否有效', 'err');
      }
    });
  }

  function downloadAll() {
    const ready = items.filter(function (it) { return it.outBlob; });
    if (!ready.length) return;
    ready.forEach(function (it, idx) {
      setTimeout(function () { downloadBlob(it.outBlob, it.outName); }, idx * 220);
    });
  }

  function clearAll() {
    items = [];
    renderList();
    setStatus('已清空', 'info');
  }

  global.AudioTool = { render: render };
})(window);
