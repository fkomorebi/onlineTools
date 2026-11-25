/* ============================================
   编码 / 解码工具 —— 页面
   ============================================ */
(function (global) {
  'use strict';

  const { el, copyText } = global.U;
  const Core = global.EncodeCore;

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: '编码 / 解码' }));
    head.appendChild(el('p', { text: 'Base64、URL 百分号编码、十六进制、HTML 实体 —— 编码与解码互转，支持中文与 Emoji。也能自动判断一段内容是什么编码。' }));
    root.appendChild(head);

    /* --- 类型选择 --- */
    const typeCard = el('div', { class: 'card' });
    typeCard.appendChild(el('div', { class: 'card-title', text: '编码类型' }));
    const typeRow = el('div', { class: 'btn-group', id: 'enc-types' });
    const typeButtons = {};
    Core.ENCODERS.forEach(function (enc, i) {
      const b = el('button', {
        class: 'btn' + (i === 0 ? ' btn-primary' : ''),
        text: enc.label,
        onclick: function () { selectType(enc.id); }
      });
      typeButtons[enc.id] = b;
      typeRow.appendChild(b);
    });
    typeCard.appendChild(typeRow);
    root.appendChild(typeCard);

    /* --- 输入 --- */
    const inCard = el('div', { class: 'card' });
    inCard.appendChild(el('div', { class: 'card-title', text: '输入' }));
    const input = el('textarea', {
      class: 'editor', id: 'enc-input', spellcheck: 'false',
      placeholder: '输入要编码或解码的内容'
    });
    input.value = '你好，世界！ Hello 🌍';
    inCard.appendChild(input);

    const inToolbar = el('div', { class: 'toolbar', style: 'margin-top:12px' });
    inToolbar.appendChild(el('button', { class: 'btn btn-primary', text: '编码', onclick: doEncode }));
    inToolbar.appendChild(el('button', { class: 'btn', text: '解码', onclick: doDecode }));
    inToolbar.appendChild(el('span', { class: 'spacer' }));
    inToolbar.appendChild(el('button', { class: 'btn btn-sm', text: '清空', onclick: function () { input.value = ''; out.value = ''; setStatus(''); } }));
    inCard.appendChild(inToolbar);

    const status = el('div', { class: 'status', id: 'enc-status' });
    inCard.appendChild(status);
    root.appendChild(inCard);

    /* --- 输出 --- */
    const outCard = el('div', { class: 'card' });
    outCard.appendChild(el('div', { class: 'card-title', text: '输出' }));
    const out = el('textarea', { class: 'editor', id: 'enc-output', readonly: 'readonly', spellcheck: 'false' });
    outCard.appendChild(out);
    const outToolbar = el('div', { class: 'toolbar' });
    outToolbar.appendChild(el('button', { class: 'btn', text: '复制', onclick: doCopy }));
    outToolbar.appendChild(el('button', { class: 'btn btn-sm', text: '交换输入输出', onclick: doSwap }));
    outCard.appendChild(outToolbar);
    root.appendChild(outCard);

    /* --- 自动检测 --- */
    const detectCard = el('div', { class: 'card' });
    detectCard.appendChild(el('div', { class: 'card-title', text: '自动检测' }));
    detectCard.appendChild(el('p', { class: 'hint', text: '粘贴一段看不懂的字符串，自动判断编码类型并解码。' }));
    const detectInput = el('textarea', { class: 'editor short', id: 'enc-detect-input', spellcheck: 'false', placeholder: '粘贴内容' });
    detectCard.appendChild(detectInput);
    const detectToolbar = el('div', { class: 'toolbar' });
    detectToolbar.appendChild(el('button', { class: 'btn', text: '检测并解码', onclick: doDetect }));
    detectToolbar.appendChild(el('button', { class: 'btn btn-sm', text: '填入上方输入框', onclick: doDetectToInput }));
    detectCard.appendChild(detectToolbar);
    const detectOut = el('textarea', { class: 'editor short', id: 'enc-detect-output', readonly: 'readonly', spellcheck: 'false' });
    detectCard.appendChild(detectOut);
    root.appendChild(detectCard);

    /* --- 逻辑 --- */
    let currentType = Core.ENCODERS[0].id;

    function setStatus(msg, kind) {
      status.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { status.classList.add('show'); status.textContent = msg; }
      else { status.classList.remove('show'); status.textContent = ''; }
    }

    function selectType(id) {
      currentType = id;
      Core.ENCODERS.forEach(function (enc) {
        typeButtons[enc.id].className = 'btn' + (enc.id === id ? ' btn-primary' : '');
      });
      // 换类型后自动跑一次编码，方便直接对比
      doEncode();
    }

    function doEncode() {
      const r = Core.encode(input.value, currentType);
      if (!r.ok) {
        out.value = '';
        setStatus('✗ ' + r.error, 'err');
        return;
      }
      out.value = r.output;
      const label = Core.ENCODERS.filter(function (e) { return e.id === currentType; })[0].label;
      setStatus('✓ 已' + label + '编码（' + r.output.length + ' 字符）', 'ok');
    }

    function doDecode() {
      const r = Core.decode(input.value, currentType);
      if (!r.ok) {
        out.value = '';
        setStatus('✗ ' + r.error, 'err');
        return;
      }
      out.value = r.output;
      const label = Core.ENCODERS.filter(function (e) { return e.id === currentType; })[0].label;
      if (r.binary) {
        setStatus('⚠ 已按 ' + label + ' 解码，但结果看起来是二进制内容', 'info');
      } else {
        setStatus('✓ 已' + label + '解码', 'ok');
      }
    }

    function doCopy() {
      if (!out.value) { setStatus('✗ 没有可复制的内容', 'err'); return; }
      copyText(out.value).then(function () {
        setStatus('✓ 已复制到剪贴板', 'ok');
      }).catch(function () {
        setStatus('✗ 复制失败，请手动选择文本复制', 'err');
      });
    }

    function doSwap() {
      const tmp = input.value;
      input.value = out.value;
      out.value = tmp;
      setStatus('✓ 已交换输入与输出', 'ok');
    }

    function doDetect() {
      const text = detectInput.value;
      if (!text.trim()) {
        detectOut.value = '';
        setStatus('✗ 请输入内容', 'err');
        return;
      }
      const r = Core.detect(text);
      detectOut.value = r.decoded;
      setStatus('✓ 识别为：' + r.label + '（置信度 ' + confidenceLabel(r.confidence) + '）', 'ok');
    }

    function doDetectToInput() {
      const text = detectInput.value;
      if (!text.trim()) { setStatus('✗ 请输入内容', 'err'); return; }
      const r = Core.detect(text);
      input.value = r.decoded;
      out.value = '';
      setStatus('✓ 已把解码结果填入上方输入框', 'ok');
    }

    function confidenceLabel(c) {
      if (c === 'high') return '高';
      if (c === 'medium') return '中';
      if (c === 'low') return '低';
      return '无';
    }

    /* --- 事件 --- */
    input.addEventListener('input', global.U.debounce(function () {
      // 输入时按当前类型做「智能」处理：能解码就解码，不能就编码
      const text = input.value;
      if (!text.trim()) { out.value = ''; setStatus(''); return; }
      const dec = Core.decode(text, currentType);
      if (dec.ok && dec.output !== text) {
        out.value = dec.output;
        setStatus('✓ 自动解码成功', 'ok');
      } else {
        const enc = Core.encode(text, currentType);
        out.value = enc.ok ? enc.output : '';
        setStatus(enc.ok ? '✓ 已编码' : '✗ ' + enc.error, enc.ok ? 'ok' : 'err');
      }
    }, 220));

    doEncode();
  }

  global.EncodeTool = { render: render };
})(window);
