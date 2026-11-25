/* ============================================
   URL / Query 解析工具 —— 页面
   ============================================ */
(function (global) {
  'use strict';

  const { el, copyText } = global.U;
  const Core = global.UrlCore;

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: 'URL 与参数解析' }));
    head.appendChild(el('p', { text: '把一个链接拆成协议 / 域名 / 路径 / 参数 / 锚点，参数可以像表格一样编辑，改完立刻拼回新链接。也可以反过来：用参数拼 URL。' }));
    root.appendChild(head);

    /* --- 输入区 --- */
    const inputCard = el('div', { class: 'card' });
    inputCard.appendChild(el('div', { class: 'card-title', text: 'URL' }));

    const input = el('textarea', {
      class: 'editor short',
      id: 'url-input',
      placeholder: 'https://example.com/path?a=1&b=2#section',
      spellcheck: 'false'
    });
    input.value = 'https://example.com:8443/api/v2/users?keyword=%E5%BC%A0%E4%B8%89&page=2&page=3&sort=desc&debug=true#results';
    inputCard.appendChild(input);

    const toolbar = el('div', { class: 'toolbar', style: 'margin-top:12px' });
    toolbar.appendChild(el('button', { class: 'btn btn-primary', text: '解析', onclick: doParse }));
    toolbar.appendChild(el('button', { class: 'btn', text: '复制 URL', onclick: doCopy }));
    toolbar.appendChild(el('span', { class: 'spacer' }));
    toolbar.appendChild(el('button', { class: 'btn btn-sm', text: '载入示例', onclick: loadSample }));
    inputCard.appendChild(toolbar);

    const status = el('div', { class: 'status', id: 'url-status' });
    inputCard.appendChild(status);
    root.appendChild(inputCard);

    /* --- 解析结果 --- */
    const partsCard = el('div', { class: 'card', id: 'url-parts-card' });
    partsCard.appendChild(el('div', { class: 'card-title', text: '结构拆解' }));
    const partsBox = el('div', { class: 'url-parts', id: 'url-parts' });
    partsCard.appendChild(partsBox);
    root.appendChild(partsCard);

    /* --- 参数编辑 --- */
    const paramCard = el('div', { class: 'card', id: 'url-param-card' });
    paramCard.appendChild(el('div', { class: 'card-title', text: '查询参数' }));

    const paramToolbar = el('div', { class: 'toolbar' });
    paramToolbar.appendChild(el('button', { class: 'btn btn-sm', text: '+ 添加参数', onclick: addParam }));
    const sortChk = el('input', { type: 'checkbox', id: 'url-sort' });
    paramToolbar.appendChild(el('label', { class: 'checkbox-row' }, [sortChk, '按键名排序']));
    const encChk = el('input', { type: 'checkbox', id: 'url-encode', checked: 'checked' });
    paramToolbar.appendChild(el('label', { class: 'checkbox-row' }, [encChk, '值进行百分号编码']));
    paramToolbar.appendChild(el('span', { class: 'spacer' }));
    paramToolbar.appendChild(el('button', { class: 'btn btn-sm', text: '复制 Query', onclick: copyQuery }));
    paramCard.appendChild(paramToolbar);

    const paramBox = el('div', { class: 'table-wrap' });
    paramCard.appendChild(paramBox);
    root.appendChild(paramCard);

    /* --- 结果 --- */
    const outCard = el('div', { class: 'card' });
    outCard.appendChild(el('div', { class: 'card-title', text: '结果' }));
    const outBox = el('textarea', { class: 'editor short', id: 'url-output', readonly: 'readonly', spellcheck: 'false' });
    outCard.appendChild(outBox);
    root.appendChild(outCard);

    /* --- 反向：拼 URL --- */
    const buildCard = el('div', { class: 'card' });
    buildCard.appendChild(el('div', { class: 'card-title', text: '用参数拼 URL' }));

    const buildGrid = el('div', { class: 'grid-2' });
    const baseField = el('div', { class: 'field' });
    baseField.appendChild(el('label', { class: 'field-label', text: '基础 URL' }));
    const baseInput = el('input', { type: 'text', id: 'url-build-base', value: 'https://example.com/api', placeholder: 'https://example.com/api' });
    baseField.appendChild(baseInput);
    buildGrid.appendChild(baseField);

    const queryField = el('div', { class: 'field' });
    queryField.appendChild(el('label', { class: 'field-label', text: '查询参数（每行 key=value）' }));
    const queryInput = el('textarea', { class: 'editor short', id: 'url-build-query', spellcheck: 'false', style: 'min-height:120px' });
    queryInput.value = 'keyword=张三\npage=1\nlang=zh-CN';
    queryField.appendChild(queryInput);
    buildGrid.appendChild(queryField);
    buildCard.appendChild(buildGrid);

    const buildToolbar = el('div', { class: 'toolbar' });
    buildToolbar.appendChild(el('button', { class: 'btn btn-primary', text: '生成 URL', onclick: doBuild }));
    buildToolbar.appendChild(el('button', { class: 'btn', text: '复制', onclick: doCopyBuild }));
    buildCard.appendChild(buildToolbar);

    const buildOut = el('div', { class: 'field' });
    const buildOutInput = el('input', { type: 'text', id: 'url-build-output', readonly: 'readonly', class: 'mono' });
    buildOut.appendChild(buildOutInput);
    buildCard.appendChild(buildOut);
    root.appendChild(buildCard);

    /* --- 编码检测 --- */
    const detectCard = el('div', { class: 'card' });
    detectCard.appendChild(el('div', { class: 'card-title', text: '编码检测' }));
    detectCard.appendChild(el('p', { class: 'hint', text: '粘贴一段内容，自动判断它是什么编码并解码 —— 支持 Base64、URL 百分号编码、十六进制与 HTML 实体。' }));
    const detectInput = el('textarea', { class: 'editor short', id: 'url-detect-input', spellcheck: 'false', placeholder: '粘贴内容' });
    detectCard.appendChild(detectInput);
    const detectBtn = el('div', { class: 'toolbar' });
    detectBtn.appendChild(el('button', { class: 'btn', text: '检测并解码', onclick: doDetect }));
    detectCard.appendChild(detectBtn);
    const detectOut = el('textarea', { class: 'editor short', id: 'url-detect-output', readonly: 'readonly', spellcheck: 'false' });
    detectCard.appendChild(detectOut);
    root.appendChild(detectCard);

    /* --- 状态与逻辑 --- */
    let current = null;

    function setStatus(msg, kind) {
      status.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { status.classList.add('show'); status.textContent = msg; }
      else { status.classList.remove('show'); status.textContent = ''; }
    }

    const FIELDS = [
      ['协议', 'scheme'],
      ['主机', 'hostname'],
      ['端口', 'port'],
      ['路径', 'path'],
      ['查询串', 'query'],
      ['锚点', 'hash'],
      ['用户名', 'username'],
      ['密码', 'password']
    ];

    function renderParts(parsed) {
      partsBox.innerHTML = '';
      FIELDS.forEach(function (f) {
        const value = parsed[f[1]];
        partsBox.appendChild(el('div', { class: 'url-part' }, [
          el('span', { class: 'url-part-label', text: f[0] }),
          el('span', { class: 'url-part-value mono', text: value === '' || value == null ? '—' : String(value) })
        ]));
      });
    }

    function renderParams(params) {
      paramBox.innerHTML = '';
      const table = el('table');
      const thead = el('thead');
      thead.appendChild(el('tr', {}, [
        el('th', { text: '键' }),
        el('th', { text: '值' }),
        el('th', { text: '解码后' }),
        el('th', { text: '' })
      ]));
      table.appendChild(thead);

      const tbody = el('tbody');
      params.forEach(function (p, idx) {
        const keyInput = el('input', { type: 'text', value: p.key, class: 'url-param-input' });
        const valInput = el('input', { type: 'text', value: p.value, class: 'url-param-input' });

        keyInput.addEventListener('input', function () { p.key = keyInput.value; onParamChange(); });
        valInput.addEventListener('input', function () { p.value = valInput.value; onParamChange(); });

        const row = el('tr');
        row.appendChild(el('td', {}, [keyInput]));
        row.appendChild(el('td', {}, [valInput]));
        row.appendChild(el('td', { class: 'mono url-param-decoded', text: p.decodedValue }));
        const del = el('button', {
          class: 'file-remove', text: '×', title: '删除',
          onclick: function () {
            params.splice(idx, 1);
            renderParams(params);
            onParamChange();
          }
        });
        row.appendChild(el('td', {}, [del]));
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      paramBox.appendChild(table);
    }

    function onParamChange() {
      if (!current) return;
      const query = Core.buildQuery(current.params, { encode: encChk.checked, sort: sortChk.checked });
      current.query = query;
      const url = Core.buildUrl(current, { query: query });
      outBox.value = url;
      // 同步更新解码后的显示
      const rows = paramBox.querySelectorAll('tbody tr');
      current.params.forEach(function (p, i) {
        p.decodedValue = Core.safeDecode(p.value);
        if (rows[i]) {
          const cell = rows[i].querySelector('.url-param-decoded');
          if (cell) cell.textContent = p.decodedValue;
        }
      });
    }

    function doParse() {
      const raw = input.value;
      const parsed = Core.parseUrl(raw);
      if (!parsed.ok) {
        current = null;
        partsBox.innerHTML = '';
        paramBox.innerHTML = '';
        outBox.value = '';
        setStatus('✗ ' + parsed.error, 'err');
        return;
      }
      current = parsed;
      renderParts(parsed);
      renderParams(parsed.params);
      const url = Core.buildUrl(parsed, { query: parsed.query });
      outBox.value = url;
      setStatus('✓ 解析成功：' + parsed.params.length + ' 个查询参数', 'ok');
    }

    function doCopy() {
      const text = outBox.value;
      if (!text) { setStatus('✗ 请先解析 URL', 'err'); return; }
      copyText(text).then(function () {
        setStatus('✓ 已复制 URL', 'ok');
      }).catch(function () {
        setStatus('✗ 复制失败，请手动复制', 'err');
      });
    }

    function copyQuery() {
      if (!current) { setStatus('✗ 请先解析 URL', 'err'); return; }
      const query = Core.buildQuery(current.params, { encode: encChk.checked, sort: sortChk.checked });
      copyText(query).then(function () {
        setStatus('✓ 已复制查询串', 'ok');
      }).catch(function () {
        setStatus('✗ 复制失败，请手动复制', 'err');
      });
    }

    function addParam() {
      if (!current) { doParse(); if (!current) return; }
      current.params.push({ key: '', value: '', decodedKey: '', decodedValue: '' });
      renderParams(current.params);
      onParamChange();
    }

    function loadSample() {
      input.value = 'https://user:pass@example.com:8080/a/b/c?x=1&y=hello%20world&flag#top';
      doParse();
    }

    function doBuild() {
      const base = baseInput.value.trim();
      if (!base) { buildOutInput.value = ''; setStatus('✗ 请填写基础 URL', 'err'); return; }
      const lines = queryInput.value.split('\n');
      const params = [];
      lines.forEach(function (line) {
        const t = line.trim();
        if (!t) return;
        const eq = t.indexOf('=');
        if (eq === -1) {
          params.push({ key: t, value: '' });
        } else {
          params.push({ key: t.slice(0, eq).trim(), value: t.slice(eq + 1) });
        }
      });
      const query = Core.buildQuery(params, { encode: true });
      buildOutInput.value = base + (query ? '?' + query : '');
      setStatus('✓ 已生成 URL（' + params.length + ' 个参数）', 'ok');
    }

    function doCopyBuild() {
      if (!buildOutInput.value) { setStatus('✗ 请先生成 URL', 'err'); return; }
      copyText(buildOutInput.value).then(function () {
        setStatus('✓ 已复制 URL', 'ok');
      }).catch(function () {
        setStatus('✗ 复制失败，请手动复制', 'err');
      });
    }

    function doDetect() {
      const text = detectInput.value;
      if (!text.trim()) { detectOut.value = ''; setStatus('✗ 请输入内容', 'err'); return; }
      const r = Core.detectEncoding(text);
      detectOut.value = r.decoded;
      setStatus('✓ 识别为：' + r.label, 'ok');
    }

    /* --- 事件 --- */
    input.addEventListener('input', function () { doParse(); });
    sortChk.addEventListener('change', onParamChange);
    encChk.addEventListener('change', onParamChange);

    // 首次解析
    doParse();
  }

  global.UrlTool = { render: render };
})(window);
