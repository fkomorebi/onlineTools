/* ============================================
   JSON 格式化 / 校验 / 树形查看
   ============================================ */
(function (global) {
  'use strict';

  const { el, escapeHtml, copyText, downloadBlob } = global.U;

  const SAMPLE = `{
  "name": "在线工具箱",
  "version": "1.0.0",
  "private": true,
  "features": ["json", "image", "convert"],
  "stats": {
    "tools": 3,
    "ads": 0,
    "tracking": false
  },
  "nested": {
    "array": [1, 2, 3, { "deep": true }],
    "empty": {},
    "emptyArray": [],
    "nullable": null
  }
}`;

  /**
   * 解析 JSON，带详细错误位置
   * @returns {{ok:boolean, value?:any, error?:string, line?:number, column?:number}}
   */
  function parse(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) {
      return { ok: false, error: '内容为空，请输入 JSON 文本。' };
    }
    try {
      return { ok: true, value: JSON.parse(trimmed) };
    } catch (e) {
      const msg = e.message || String(e);
      // V8 格式: "Unexpected token } in JSON at position 123"
      const posMatch = msg.match(/position\s+(\d+)/i);
      let line, column, snippet = '';
      if (posMatch) {
        const pos = parseInt(posMatch[1], 10);
        const before = trimmed.slice(0, pos);
        line = before.split('\n').length;
        column = pos - before.lastIndexOf('\n');
        const lineStart = trimmed.lastIndexOf('\n', pos - 1) + 1;
        let lineEnd = trimmed.indexOf('\n', pos);
        if (lineEnd === -1) lineEnd = trimmed.length;
        const badLine = trimmed.slice(lineStart, lineEnd);
        snippet = badLine + '\n' + ' '.repeat(Math.max(0, column - 1)) + '^';
      }
      let out = translateError(msg);
      return {
        ok: false,
        error: out || 'JSON 解析失败',
        line: line,
        column: column,
        snippet: snippet
      };
    }
  }

  /** 把引擎的英文报错翻译成中文 */
  function translateError(msg) {
    let m = msg.replace(/^JSON\.parse:\s*/, '');
    // 先按完整句式翻译（带 "in JSON at position N" 的），再退回宽松匹配
    m = m.replace(/^Expected double-quoted property name in JSON at position \d+.*$/i,
      '缺少双引号包裹的属性名');
    m = m.replace(/^Expected property name or '}' in JSON at position \d+.*$/i,
      '缺少属性名或右花括号 "}"');
    m = m.replace(/^Expected ':' after property name in JSON at position \d+.*$/i,
      '属性名后缺少冒号 ":"');
    m = m.replace(/^Expected ',' or '}' after property value in JSON at position \d+.*$/i,
      '属性值后缺少逗号或右花括号 "}"');
    m = m.replace(/^Expected ',' or '\]' after array element in JSON at position \d+.*$/i,
      '数组元素后缺少逗号或右方括号 "]"');
    m = m.replace(/^Expected '"', '}' or '\]' in JSON at position \d+.*$/i,
      '缺少双引号、右花括号或右方括号');
    m = m.replace(/^Expected ':' after array element in JSON at position \d+.*$/i,
      '数组元素后缺少冒号 ":"');
    m = m.replace(/^Expected double-quoted property name in JSON at position \d+.*$/i,
      '缺少双引号包裹的属性名');
    m = m.replace(/^Unterminated string in JSON at position \d+.*$/i, '字符串没有闭合');
    m = m.replace(/^Bad escaped character in JSON at position \d+.*$/i, '非法转义字符');
    m = m.replace(/^Bad control character in string literal in JSON at position \d+.*$/i,
      '字符串中包含非法控制字符');
    m = m.replace(/^Bad Unicode escape in JSON at position \d+.*$/i, '非法 Unicode 转义');
    m = m.replace(/^No number after minus sign in JSON at position \d+.*$/i, '负号后缺少数字');
    m = m.replace(/^Exponent part is missing a number in JSON at position \d+.*$/i,
      '指数部分缺少数字');
    m = m.replace(/^Unexpected non-whitespace character after JSON at position \d+.*$/i,
      'JSON 结束后有多余内容');
    m = m.replace(/^Unexpected end of JSON input$/i, 'JSON 内容不完整（意外结束）');
    // "Unexpected token '}', "..." is not valid JSON" / "Unexpected token '}' ..."
    m = m.replace(/^Unexpected token '(.+?)',\s*.*$/, '意外的字符 "$1"');
    m = m.replace(/^Unexpected token '(.+?)'.*$/, '意外的字符 "$1"');
    m = m.replace(/^Unexpected number$/i, '不合法的数字');
    m = m.replace(/^Unexpected number in JSON at position \d+.*$/i, '不合法的数字');
    m = m.replace(/^Unexpected string$/i, '不合法的字符串');
    m = m.replace(/^Unexpected string in JSON at position \d+.*$/i, '不合法的字符串');
    m = m.replace(/^Unexpected non-whitespace character after JSON$/i, 'JSON 结束后有多余内容');
    // 去掉残留的位置后缀
    m = m.replace(/\s*in JSON at position \d+.*$/i, '');
    return m;
  }

  /** 格式化（可配置缩进） */
  function stringify(value, indent) {
    return JSON.stringify(value, null, indent);
  }

  /** 压缩 */
  function minify(text) {
    const r = parse(text);
    if (!r.ok) return null;
    return JSON.stringify(r.value);
  }

  /** 统计信息 */
  function stats(value, text) {
    const raw = text || '';
    let keys = 0, values = 0, maxDepth = 0, arrays = 0, objects = 0;
    (function walk(node, depth) {
      if (depth > maxDepth) maxDepth = depth;
      if (Array.isArray(node)) {
        arrays++;
        values++;
        node.forEach(function (n) { walk(n, depth + 1); });
      } else if (node && typeof node === 'object') {
        objects++;
        values++;
        Object.keys(node).forEach(function (k) {
          keys++;
          walk(node[k], depth + 1);
        });
      } else {
        values++;
      }
    })(value, 1);
    return {
      bytes: new Blob([raw]).size,
      bytesCompact: new Blob([JSON.stringify(value)]).size,
      chars: raw.length,
      lines: raw ? raw.split('\n').length : 0,
      keys: keys,
      values: values,
      arrays: arrays,
      objects: objects,
      maxDepth: maxDepth,
      type: Array.isArray(value) ? 'Array' : value === null ? 'null' : typeof value
    };
  }

  /** 统计字符串/数字类型出现次数 */
  function typeBreakdown(value) {
    const counts = { string: 0, number: 0, boolean: 0, null: 0, object: 0, array: 0 };
    (function walk(node) {
      if (Array.isArray(node)) { counts.array++; node.forEach(walk); }
      else if (node === null) counts.null++;
      else if (typeof node === 'object') { counts.object++; Object.keys(node).forEach(function (k) { walk(node[k]); }); }
      else counts[typeof node] = (counts[typeof node] || 0) + 1;
    })(value);
    return counts;
  }

  /** 路径查询：$.a.b[0].c */
  function getPath(obj, path) {
    const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      const m = p.match(/^([^[]*)((\[\d+\])*)$/);
      if (!m) return undefined;
      if (m[1]) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = cur[m[1]];
      }
      const idxs = m[2] ? m[2].match(/\d+/g) : [];
      for (const i of idxs) {
        if (cur == null || !Array.isArray(cur)) return undefined;
        cur = cur[Number(i)];
      }
    }
    return cur;
  }

  /* ---------------- 树形渲染 ---------------- */

  function renderTree(node) {
    const root = el('div', { class: 'tree' });

    function build(value, key, depth) {
      const isArr = Array.isArray(value);
      const isObj = value !== null && typeof value === 'object';
      const keySpan = key != null
        ? el('span', { class: 'tree-key', text: JSON.stringify(key) + ': ' })
        : null;

      if (!isArr && !isObj) {
        const row = el('div', { class: 'tree-row' });
        if (keySpan) row.appendChild(keySpan);
        row.appendChild(el('span', { class: 'tree-' + typeClass(value), text: scalarText(value) }));
        return row;
      }

      const entries = isArr
        ? value.map(function (v, i) { return [i, v]; })
        : Object.keys(value).map(function (k) { return [k, value[k]]; });

      const open = depth < 2;
      const summary = isArr
        ? `Array(${entries.length})`
        : `Object(${entries.length})`;

      const toggle = el('span', { class: 'tree-toggle', text: open ? '▾' : '▸' });
      const head = el('div', { class: 'tree-row' });
      head.appendChild(toggle);
      if (keySpan) head.appendChild(keySpan);
      head.appendChild(el('span', { class: 'tree-summary', text: summary }));

      const body = el('div', { class: 'tree-node-body' });
      entries.forEach(function (e) {
        body.appendChild(build(e[1], e[0], depth + 1));
      });

      const wrap = el('div', { class: 'tree-node' });
      wrap.appendChild(head);
      wrap.appendChild(body);
      if (!open) wrap.classList.add('tree-collapsed');

      toggle.addEventListener('click', function () {
        const collapsed = wrap.classList.toggle('tree-collapsed');
        toggle.textContent = collapsed ? '▸' : '▾';
      });

      return wrap;
    }

    root.appendChild(build(node, null, 0));
    return root;
  }

  function typeClass(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  function scalarText(v) {
    if (v === null) return 'null';
    if (typeof v === 'string') return JSON.stringify(v);
    return String(v);
  }

  /* ---------------- 页面渲染 ---------------- */

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: 'JSON 格式化' }));
    head.appendChild(el('p', { text: '格式化、压缩、校验与树形查看，全部在浏览器本地完成。' }));
    root.appendChild(head);

    /* --- 工具栏 --- */
    const toolbar = el('div', { class: 'toolbar' });
    const indentSel = el('select', { id: 'json-indent' });
    [['2 空格', 2], ['4 空格', 4], ['Tab', '\t'], ['不缩进', 0]].forEach(function (opt) {
      indentSel.appendChild(el('option', { value: String(opt[1]), text: opt[0] }));
    });
    indentSel.value = '2';

    const btnFormat = el('button', { class: 'btn btn-primary', text: '格式化', onclick: doFormat });
    const btnMinify = el('button', { class: 'btn', text: '压缩', onclick: doMinify });
    const btnValidate = el('button', { class: 'btn', text: '校验', onclick: doValidate });
    const btnSample = el('button', { class: 'btn', text: '示例', onclick: loadSample });
    const btnClear = el('button', { class: 'btn btn-danger', text: '清空', onclick: clearAll });
    const btnUpload = el('button', { class: 'btn', text: '打开文件', onclick: openFile });
    const btnCopy = el('button', { class: 'btn', text: '复制结果', onclick: doCopy });
    const btnDownload = el('button', { class: 'btn btn-success', text: '下载 .json', onclick: doDownload });

    toolbar.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: '缩进' }));
    toolbar.appendChild(indentSel);
    toolbar.appendChild(btnFormat);
    toolbar.appendChild(btnMinify);
    toolbar.appendChild(btnValidate);
    toolbar.appendChild(btnSample);
    toolbar.appendChild(btnClear);
    toolbar.appendChild(el('span', { class: 'spacer' }));
    toolbar.appendChild(btnUpload);
    toolbar.appendChild(btnCopy);
    toolbar.appendChild(btnDownload);
    root.appendChild(toolbar);

    /* --- 输入区 --- */
    const inputCard = el('div', { class: 'card' });
    inputCard.appendChild(el('div', { class: 'card-title', text: '输入' }));

    const ta = el('textarea', {
      class: 'editor',
      id: 'json-input',
      spellcheck: 'false',
      placeholder: '在此粘贴 JSON…  (Ctrl/Cmd + Enter 格式化)'
    });
    inputCard.appendChild(ta);

    const status = el('div', { class: 'status', id: 'json-status' });
    inputCard.appendChild(status);

    const fileInput = el('input', {
      type: 'file', id: 'json-file', accept: '.json,application/json,text/plain',
      style: 'display:none', onchange: function (e) { handleFile(e.target.files[0]); }
    });
    inputCard.appendChild(fileInput);

    root.appendChild(inputCard);

    /* --- 统计 --- */
    const statsBox = el('div', { class: 'card', id: 'json-stats-card' });
    statsBox.style.display = 'none';
    const statsGrid = el('div', { class: 'stats' });
    statsBox.appendChild(el('div', { class: 'card-title', text: '统计' }));
    statsBox.appendChild(statsGrid);

    const typeBox = el('div', { class: 'card', id: 'json-types-card' });
    typeBox.style.display = 'none';
    typeBox.appendChild(el('div', { class: 'card-title', text: '类型分布' }));
    const typeGrid = el('div', { class: 'stats' });
    typeBox.appendChild(typeGrid);

    root.appendChild(statsBox);
    root.appendChild(typeBox);

    /* --- 结果区 --- */
    const tabs = el('div', { class: 'tabs' });
    const tabOut = el('button', { class: 'tab active', text: '格式化输出' });
    const tabTree = el('button', { class: 'tab', text: '树形视图' });
    const tabPath = el('button', { class: 'tab', text: '路径查询' });
    tabs.appendChild(tabOut); tabs.appendChild(tabTree); tabs.appendChild(tabPath);

    const paneOut = el('div', { class: 'card' });
    const outTa = el('textarea', { class: 'editor', id: 'json-output', spellcheck: 'false', readonly: 'readonly' });
    paneOut.appendChild(outTa);

    const paneTree = el('div', { style: 'display:none' });
    paneTree.appendChild(el('div', { class: 'card-title', text: '树形视图（点击箭头展开/折叠）' }));
    const treeHost = el('div');
    paneTree.appendChild(treeHost);

    const panePath = el('div', { style: 'display:none' });
    const pathRow = el('div', { class: 'toolbar' });
    const pathInput = el('input', { type: 'text', id: 'json-path', placeholder: '例：$.nested.array[0].deep', style: 'max-width:340px' });
    const pathBtn = el('button', { class: 'btn', text: '查询', onclick: doPath });
    pathRow.appendChild(pathInput);
    pathRow.appendChild(pathBtn);
    panePath.appendChild(pathRow);
    const pathOut = el('div', { class: 'status info', id: 'json-path-out', style: 'display:none' });
    panePath.appendChild(pathOut);
    panePath.appendChild(el('p', { class: 'hint', html: '支持 <code>$.a.b</code>、<code>$.list[0]</code>、<code>$.list[0].name</code> 形式。' }));

    function selectTab(target) {
      [tabOut, tabTree, tabPath].forEach(function (t) { t.classList.remove('active'); });
      [paneOut, paneTree, panePath].forEach(function (p) { p.style.display = 'none'; });
      target.tab.classList.add('active');
      target.pane.style.display = '';
    }
    tabOut.addEventListener('click', function () { selectTab({ tab: tabOut, pane: paneOut }); });
    tabTree.addEventListener('click', function () { selectTab({ tab: tabTree, pane: paneTree }); });
    tabPath.addEventListener('click', function () { selectTab({ tab: tabPath, pane: panePath }); });

    root.appendChild(tabs);
    root.appendChild(paneOut);
    root.appendChild(paneTree);
    root.appendChild(panePath);

    /* --- 状态与当前值 --- */
    let currentValue = null;
    let currentValid = false;

    function setStatus(msg, kind) {
      status.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { status.classList.add('show'); status.textContent = msg; }
      else { status.classList.remove('show'); status.textContent = ''; }
    }

    function showStats(value, raw) {
      const s = stats(value, raw);
      statsGrid.innerHTML = '';
      const items = [
        ['大小', global.U.formatBytes(s.bytes)],
        ['压缩后', global.U.formatBytes(s.bytesCompact)],
        ['字符数', global.U.compactNumber(s.chars)],
        ['行数', String(s.lines)],
        ['键数量', String(s.keys)],
        ['数组', String(s.arrays)],
        ['对象', String(s.objects)],
        ['最大深度', String(s.maxDepth)],
        ['根类型', s.type]
      ];
      items.forEach(function (it) {
        statsGrid.appendChild(el('div', { class: 'stat' }, [
          el('span', { class: 'stat-value', text: it[1] }),
          el('span', { class: 'stat-label', text: it[0] })
        ]));
      });
      statsBox.style.display = '';

      const t = typeBreakdown(value);
      typeGrid.innerHTML = '';
      const names = { string: '字符串', number: '数字', boolean: '布尔', null: 'null', object: '对象', array: '数组' };
      Object.keys(t).forEach(function (k) {
        typeGrid.appendChild(el('div', { class: 'stat' }, [
          el('span', { class: 'stat-value', text: String(t[k]) }),
          el('span', { class: 'stat-label', text: names[k] || k })
        ]));
      });
      typeBox.style.display = '';
    }

    function clearStats() {
      statsBox.style.display = 'none';
      typeBox.style.display = 'none';
    }

    function currentIndent() {
      const v = indentSel.value;
      return v === '\\t' ? '\t' : parseInt(v, 10);
    }

    function doFormat() {
      const r = parse(ta.value);
      if (!r.ok) {
        currentValid = false;
        currentValue = null;
        ta.classList.add('error');
        clearStats();
        treeHost.innerHTML = '';
        outTa.value = '';
        setStatus(formatError(r), 'err');
        return;
      }
      ta.classList.remove('error');
      currentValue = r.value;
      currentValid = true;
      const out = stringify(r.value, currentIndent());
      outTa.value = out;
      treeHost.innerHTML = '';
      treeHost.appendChild(renderTree(r.value));
      showStats(r.value, ta.value);
      setStatus('✓ JSON 合法，已格式化（' + out.length + ' 字符）', 'ok');
    }

    function formatError(r) {
      let s = '✗ ' + r.error;
      if (r.line) s += '（第 ' + r.line + ' 行，第 ' + r.column + ' 列）';
      if (r.snippet) s += '\n' + r.snippet;
      return s;
    }

    function doMinify() {
      const out = minify(ta.value);
      if (out === null) {
        doFormat();
        return;
      }
      outTa.value = out;
      const r = parse(ta.value);
      showStats(r.value, out);
      setStatus('✓ 已压缩至 ' + out.length + ' 字符（省 ' +
        (100 - Math.round((out.length / Math.max(1, ta.value.length)) * 100)) + '%）', 'ok');
    }

    function doValidate() {
      const r = parse(ta.value);
      if (r.ok) {
        ta.classList.remove('error');
        currentValue = r.value;
        currentValid = true;
        showStats(r.value, ta.value);
        setStatus('✓ JSON 合法', 'ok');
      } else {
        ta.classList.add('error');
        currentValid = false;
        clearStats();
        setStatus(formatError(r), 'err');
      }
    }

    function loadSample() {
      ta.value = SAMPLE;
      ta.classList.remove('error');
      doFormat();
    }

    function clearAll() {
      ta.value = '';
      outTa.value = '';
      ta.classList.remove('error');
      treeHost.innerHTML = '';
      currentValue = null;
      currentValid = false;
      clearStats();
      setStatus('', null);
      ta.focus();
    }

    function openFile() { fileInput.click(); }

    function handleFile(file) {
      if (!file) return;
      const fr = new FileReader();
      fr.onload = function () {
        ta.value = fr.result;
        doFormat();
      };
      fr.onerror = function () { setStatus('✗ 文件读取失败', 'err'); };
      fr.readAsText(file);
      fileInput.value = '';
    }

    function doCopy() {
      const text = outTa.value || ta.value;
      if (!text) { setStatus('✗ 没有可复制的内容', 'err'); return; }
      copyText(text).then(function () {
        setStatus('✓ 已复制到剪贴板', 'ok');
      }).catch(function () {
        setStatus('✗ 复制失败，请手动选择文本复制', 'err');
      });
    }

    function doDownload() {
      const text = outTa.value || ta.value;
      if (!text) { setStatus('✗ 没有可下载的内容', 'err'); return; }
      downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), 'formatted.json');
      setStatus('✓ 已下载 formatted.json', 'ok');
    }

    function doPath() {
      if (!currentValid) { setStatus('✗ 请先输入合法的 JSON', 'err'); return; }
      const p = pathInput.value.trim();
      if (!p) { setStatus('✗ 请输入路径表达式', 'err'); return; }
      const v = getPath(currentValue, p);
      pathOut.style.display = 'block';
      if (v === undefined) {
        pathOut.className = 'status err show';
        pathOut.textContent = '✗ 未找到路径：' + p;
      } else {
        pathOut.className = 'status ok show';
        pathOut.textContent = '✓ ' + p + ' =\n' +
          (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v, null, 2));
      }
    }

    pathInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doPath();
    });

    ta.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        doFormat();
      }
    });

    ta.addEventListener('input', function () {
      ta.classList.remove('error');
    });

    // 首次载入示例
    ta.value = SAMPLE;
    doFormat();
  }

  global.JSONTool = { render: render, parse: parse, stringify: stringify };
})(window);
