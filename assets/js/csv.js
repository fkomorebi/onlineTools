/* ============================================
   CSV ⇄ JSON 转换工具 —— 页面
   ============================================ */
(function (global) {
  'use strict';

  const { el, copyText, downloadBlob } = global.U;
  const Core = global.CsvCore;

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: 'CSV ⇄ JSON 转换' }));
    head.appendChild(el('p', { text: '表格转 JSON 数组，或把 JSON 数组转回 CSV。自动识别分隔符（逗号 / 制表符 / 分号），支持带引号的字段与字段内换行。' }));
    root.appendChild(head);

    const tabs = el('div', { class: 'tabs', id: 'csv-tabs' });
    const tabCsv = el('button', { class: 'tab active', text: 'CSV → JSON', onclick: function () { switchTab('csv'); } });
    const tabJson = el('button', { class: 'tab', text: 'JSON → CSV', onclick: function () { switchTab('json'); } });
    tabs.appendChild(tabCsv);
    tabs.appendChild(tabJson);
    root.appendChild(tabs);

    /* ================= CSV → JSON ================= */
    const csvPanel = el('div', { id: 'csv-panel-csv' });

    const csvInputCard = el('div', { class: 'card' });
    csvInputCard.appendChild(el('div', { class: 'card-title', text: 'CSV 内容' }));
    const csvInput = el('textarea', {
      class: 'editor', id: 'csv-input', spellcheck: 'false',
      placeholder: 'name,age,city\n张三,28,北京'
    });
    csvInput.value = 'name,age,city,active\n张三,28,北京,true\n李四,34,上海,false\n王五,25,广州,true';
    csvInputCard.appendChild(csvInput);

    const csvToolbar = el('div', { class: 'toolbar', style: 'margin-top:12px' });
    csvToolbar.appendChild(el('button', { class: 'btn btn-primary', text: '转换', onclick: doCsvToJson }));

    const delimSel = el('select', { id: 'csv-delimiter' });
    [
      { v: 'auto', t: '自动检测' },
      { v: ',', t: '逗号 ,' },
      { v: '\t', t: '制表符 TAB' },
      { v: ';', t: '分号 ;' },
      { v: '|', t: '竖线 |' }
    ].forEach(function (o) {
      delimSel.appendChild(el('option', { value: o.v, text: o.t }));
    });
    csvToolbar.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: '分隔符' }));
    csvToolbar.appendChild(delimSel);

    const headerSel = el('select', { id: 'csv-header' });
    headerSel.appendChild(el('option', { value: 'yes', text: '首行是表头' }));
    headerSel.appendChild(el('option', { value: 'no', text: '没有表头' }));
    csvToolbar.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: '表头' }));
    csvToolbar.appendChild(headerSel);

    const typedChk = el('input', { type: 'checkbox', id: 'csv-typed' });
    csvToolbar.appendChild(el('label', { class: 'checkbox-row' }, [typedChk, '自动识别数字与布尔']));

    csvToolbar.appendChild(el('span', { class: 'spacer' }));
    csvToolbar.appendChild(el('button', { class: 'btn btn-sm', text: '载入示例', onclick: loadCsvSample }));
    csvInputCard.appendChild(csvToolbar);

    const csvStatus = el('div', { class: 'status', id: 'csv-status' });
    csvInputCard.appendChild(csvStatus);
    csvPanel.appendChild(csvInputCard);

    const csvOutCard = el('div', { class: 'card' });
    csvOutCard.appendChild(el('div', { class: 'card-title', text: 'JSON 结果' }));
    const csvStats = el('div', { class: 'stats', id: 'csv-stats' });
    csvOutCard.appendChild(csvStats);
    const csvOut = el('textarea', { class: 'editor', id: 'csv-output', readonly: 'readonly', spellcheck: 'false' });
    csvOutCard.appendChild(csvOut);
    const csvOutToolbar = el('div', { class: 'toolbar' });
    csvOutToolbar.appendChild(el('button', { class: 'btn', text: '复制', onclick: function () { copyOut(csvOut.value, 'JSON'); } }));
    csvOutToolbar.appendChild(el('button', { class: 'btn btn-success', text: '下载 .json', onclick: function () { downloadOut(csvOut.value, 'result.json', 'application/json'); } }));
    csvOutCard.appendChild(csvOutToolbar);
    csvPanel.appendChild(csvOutCard);
    root.appendChild(csvPanel);

    /* ================= JSON → CSV ================= */
    const jsonPanel = el('div', { id: 'csv-panel-json', style: 'display:none' });

    const jsonInputCard = el('div', { class: 'card' });
    jsonInputCard.appendChild(el('div', { class: 'card-title', text: 'JSON 内容' }));
    const jsonInput = el('textarea', {
      class: 'editor', id: 'csv-json-input', spellcheck: 'false',
      placeholder: '[{"name":"张三","age":28}]'
    });
    jsonInput.value = '[\n  { "name": "张三", "age": 28, "city": "北京" },\n  { "name": "李四", "age": 34, "city": "上海" }\n]';
    jsonInputCard.appendChild(jsonInput);

    const jsonToolbar = el('div', { class: 'toolbar', style: 'margin-top:12px' });
    jsonToolbar.appendChild(el('button', { class: 'btn btn-primary', text: '转换', onclick: doJsonToCsv }));
    const jsonDelim = el('select', { id: 'csv-json-delimiter' });
    [
      { v: ',', t: '逗号 ,' },
      { v: '\t', t: '制表符 TAB' },
      { v: ';', t: '分号 ;' },
      { v: '|', t: '竖线 |' }
    ].forEach(function (o) {
      jsonDelim.appendChild(el('option', { value: o.v, text: o.t }));
    });
    jsonToolbar.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: '分隔符' }));
    jsonToolbar.appendChild(jsonDelim);
    jsonToolbar.appendChild(el('span', { class: 'spacer' }));
    jsonToolbar.appendChild(el('button', { class: 'btn btn-sm', text: '载入示例', onclick: loadJsonSample }));
    jsonInputCard.appendChild(jsonToolbar);

    const jsonStatus = el('div', { class: 'status', id: 'csv-json-status' });
    jsonInputCard.appendChild(jsonStatus);
    jsonPanel.appendChild(jsonInputCard);

    const jsonOutCard = el('div', { class: 'card' });
    jsonOutCard.appendChild(el('div', { class: 'card-title', text: 'CSV 结果' }));
    const jsonStats = el('div', { class: 'stats', id: 'csv-json-stats' });
    jsonOutCard.appendChild(jsonStats);
    const jsonOut = el('textarea', { class: 'editor', id: 'csv-json-output', readonly: 'readonly', spellcheck: 'false' });
    jsonOutCard.appendChild(jsonOut);
    const jsonOutToolbar = el('div', { class: 'toolbar' });
    jsonOutToolbar.appendChild(el('button', { class: 'btn', text: '复制', onclick: function () { copyOut(jsonOut.value, 'CSV'); } }));
    jsonOutToolbar.appendChild(el('button', { class: 'btn btn-success', text: '下载 .csv', onclick: function () { downloadOut(jsonOut.value, 'result.csv', 'text/csv;charset=utf-8'); } }));
    jsonOutCard.appendChild(jsonOutToolbar);
    jsonPanel.appendChild(jsonOutCard);
    root.appendChild(jsonPanel);

    /* --- 逻辑 --- */
    function switchTab(which) {
      tabCsv.classList.toggle('active', which === 'csv');
      tabJson.classList.toggle('active', which === 'json');
      csvPanel.style.display = which === 'csv' ? '' : 'none';
      jsonPanel.style.display = which === 'json' ? '' : 'none';
    }

    function setCsvStatus(msg, kind) {
      csvStatus.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { csvStatus.classList.add('show'); csvStatus.textContent = msg; }
      else { csvStatus.classList.remove('show'); csvStatus.textContent = ''; }
    }

    function setJsonStatus(msg, kind) {
      jsonStatus.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { jsonStatus.classList.add('show'); jsonStatus.textContent = msg; }
      else { jsonStatus.classList.remove('show'); jsonStatus.textContent = ''; }
    }

    function renderStats(box, items) {
      box.innerHTML = '';
      items.forEach(function (it) {
        box.appendChild(el('div', { class: 'stat' }, [
          el('span', { class: 'stat-value', text: it[1] }),
          el('span', { class: 'stat-label', text: it[0] })
        ]));
      });
    }

    function doCsvToJson() {
      const text = csvInput.value;
      if (!text.trim()) {
        csvOut.value = '';
        renderStats(csvStats, []);
        setCsvStatus('✗ 请输入 CSV 内容', 'err');
        return;
      }
      const delimOpt = delimSel.value;
      const opts = {
        delimiter: delimOpt === 'auto' ? undefined : delimOpt,
        header: headerSel.value === 'yes',
        typed: typedChk.checked,
        indent: 2
      };
      const r = Core.csvToJson(text, opts);
      if (!r.ok) {
        csvOut.value = '';
        renderStats(csvStats, []);
        setCsvStatus('✗ ' + r.error, 'err');
        return;
      }
      csvOut.value = r.json;
      const size = new Blob([r.json]).size;
      renderStats(csvStats, [
        ['数据行', String(r.rows)],
        ['字段数', String(r.columns.length)],
        ['字段', r.columns.join(', ')],
        ['JSON 体积', global.U.formatBytes(size)]
      ]);
      setCsvStatus('✓ 转换成功：' + r.rows + ' 行 × ' + r.columns.length + ' 列', 'ok');
    }

    function doJsonToCsv() {
      const text = jsonInput.value;
      if (!text.trim()) {
        jsonOut.value = '';
        renderStats(jsonStats, []);
        setJsonStatus('✗ 请输入 JSON 内容', 'err');
        return;
      }
      const r = Core.jsonToCsv(text, { delimiter: jsonDelim.value, newline: '\n' });
      if (!r.ok) {
        jsonOut.value = '';
        renderStats(jsonStats, []);
        setJsonStatus('✗ ' + r.error, 'err');
        return;
      }
      jsonOut.value = r.csv;
      const size = new Blob([r.csv]).size;
      renderStats(jsonStats, [
        ['数据行', String(r.rows)],
        ['列数', String(r.columns.length)],
        ['列', r.columns.join(', ')],
        ['CSV 体积', global.U.formatBytes(size)]
      ]);
      setJsonStatus('✓ 转换成功：' + r.rows + ' 行 × ' + r.columns.length + ' 列', 'ok');
    }

    function copyOut(text, label) {
      if (!text) return;
      copyText(text).then(function () {
        setCsvStatus('✓ 已复制 ' + label, 'ok');
        setJsonStatus('✓ 已复制 ' + label, 'ok');
      }).catch(function () {
        setCsvStatus('✗ 复制失败', 'err');
        setJsonStatus('✗ 复制失败', 'err');
      });
    }

    function downloadOut(text, filename, mime) {
      if (!text) return;
      // 加 BOM，Excel 打开中文不乱码
      downloadBlob(new Blob(['﻿' + text], { type: mime }), filename);
      setCsvStatus('✓ 已下载 ' + filename, 'ok');
      setJsonStatus('✓ 已下载 ' + filename, 'ok');
    }

    function loadCsvSample() {
      csvInput.value = 'id,name,price,stock,active\n1,"键盘, 机械",299.9,42,true\n2,"鼠标 \"无线\"",89,120,false\n3,显示器\n4,耳机,199,0,true';
      doCsvToJson();
    }

    function loadJsonSample() {
      jsonInput.value = '[\n  { "id": 1, "product": "键盘", "price": 299.9, "stock": 42 },\n  { "id": 2, "product": "鼠标", "price": 89, "stock": 120 }\n]';
      doJsonToCsv();
    }

    /* --- 事件 --- */
    csvInput.addEventListener('input', global.U.debounce(doCsvToJson, 220));
    jsonInput.addEventListener('input', global.U.debounce(doJsonToCsv, 220));
    [delimSel, headerSel, typedChk].forEach(function (c) {
      c.addEventListener('change', doCsvToJson);
    });
    jsonDelim.addEventListener('change', doJsonToCsv);

    // 首次转换
    doCsvToJson();
    doJsonToCsv();
  }

  global.CsvTool = { render: render };
})(window);
