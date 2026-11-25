/* ============================================
   文本差异对比 —— 页面
   ============================================ */
(function (global) {
  'use strict';

  const { el, copyText, downloadBlob } = global.U;
  const Core = global.DiffCore;

  const SAMPLE_A = `function greet(name) {
  console.log("Hello, " + name);
  return true;
}

const list = [1, 2, 3];
const total = list.reduce((a, b) => a + b, 0);`;

  const SAMPLE_B = `function greet(name, greeting = "Hello") {
  console.log(greeting + ", " + name);
  return true;
}

const list = [1, 2, 3, 4, 5];
const total = list.reduce((a, b) => a + b, 0);`;

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: '文本差异对比' }));
    head.appendChild(el('p', { text: '逐行比较两段文本，标记新增 / 删除 / 修改，可切换行内字符级高亮。全部在浏览器本地完成。' }));
    root.appendChild(head);

    /* --- 工具栏 --- */
    const toolbar = el('div', { class: 'toolbar' });

    const optIgnoreWs = el('input', { type: 'checkbox', id: 'diff-ignore-ws' });
    const optCharLevel = el('input', { type: 'checkbox', id: 'diff-char-level', checked: 'checked' });

    const btnCompare = el('button', { class: 'btn btn-primary', text: '对比', onclick: doCompare });
    const btnSample = el('button', { class: 'btn', text: '示例', onclick: loadSample });
    const btnSwap = el('button', { class: 'btn', text: '交换两边', onclick: doSwap });
    const btnClear = el('button', { class: 'btn btn-danger', text: '清空', onclick: doClear });
    const btnCopy = el('button', { class: 'btn', text: '复制差异', onclick: doCopy });
    const btnDownload = el('button', { class: 'btn btn-success', text: '下载 .diff', onclick: doDownload });

    toolbar.appendChild(el('label', { class: 'checkbox-row', style: 'margin:0' }, [optIgnoreWs, '忽略空白差异']));
    toolbar.appendChild(el('label', { class: 'checkbox-row', style: 'margin:0' }, [optCharLevel, '行内字符高亮']));
    toolbar.appendChild(el('span', { class: 'spacer' }));
    toolbar.appendChild(btnCompare);
    toolbar.appendChild(btnSample);
    toolbar.appendChild(btnSwap);
    toolbar.appendChild(btnClear);
    toolbar.appendChild(btnCopy);
    toolbar.appendChild(btnDownload);
    root.appendChild(toolbar);

    /* --- 输入区 --- */
    const inputCard = el('div', { class: 'card' });
    const grid = el('div', { class: 'grid-2' });

    const leftCard = el('div');
    leftCard.appendChild(el('div', { class: 'card-title', text: '原文' }));
    const taA = el('textarea', {
      class: 'editor', id: 'diff-input-a', spellcheck: 'false',
      placeholder: '粘贴原始文本…'
    });
    leftCard.appendChild(taA);

    const rightCard = el('div');
    rightCard.appendChild(el('div', { class: 'card-title', text: '新文' }));
    const taB = el('textarea', {
      class: 'editor', id: 'diff-input-b', spellcheck: 'false',
      placeholder: '粘贴对比文本…'
    });
    rightCard.appendChild(taB);

    grid.appendChild(leftCard);
    grid.appendChild(rightCard);
    inputCard.appendChild(grid);

    const status = el('div', { class: 'status', id: 'diff-status' });
    inputCard.appendChild(status);
    root.appendChild(inputCard);

    /* --- 统计 --- */
    const statsCard = el('div', { class: 'card', id: 'diff-stats-card' });
    statsCard.style.display = 'none';
    statsCard.appendChild(el('div', { class: 'card-title', text: '统计' }));
    const statsGrid = el('div', { class: 'stats' });
    statsCard.appendChild(statsGrid);
    root.appendChild(statsCard);

    /* --- 结果 --- */
    const tabs = el('div', { class: 'tabs' });
    const tabSide = el('button', { class: 'tab active', text: '并排对比' });
    const tabUnified = el('button', { class: 'tab', text: 'Unified Diff' });
    tabs.appendChild(tabSide);
    tabs.appendChild(tabUnified);

    const paneSide = el('div', { class: 'card' });
    const sideHost = el('div', { class: 'diff-view', id: 'diff-side-view' });
    paneSide.appendChild(sideHost);

    const paneUnified = el('div', { class: 'card', style: 'display:none' });
    const unifiedTa = el('textarea', { class: 'editor', id: 'diff-unified', spellcheck: 'false', readonly: 'readonly' });
    paneUnified.appendChild(unifiedTa);

    function selectTab(target) {
      [tabSide, tabUnified].forEach(function (t) { t.classList.remove('active'); });
      [paneSide, paneUnified].forEach(function (p) { p.style.display = 'none'; });
      target.tab.classList.add('active');
      target.pane.style.display = '';
    }
    tabSide.addEventListener('click', function () { selectTab({ tab: tabSide, pane: paneSide }); });
    tabUnified.addEventListener('click', function () { selectTab({ tab: tabUnified, pane: paneUnified }); });

    root.appendChild(tabs);
    root.appendChild(paneSide);
    root.appendChild(paneUnified);

    /* --- 逻辑 --- */

    function setStatus(msg, kind) {
      status.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { status.classList.add('show'); status.textContent = msg; }
      else { status.classList.remove('show'); status.textContent = ''; }
    }

    let currentRows = [];

    function showStats(s) {
      statsGrid.innerHTML = '';
      [
        ['新增行', String(s.added), 'add'],
        ['删除行', String(s.removed), 'del'],
        ['修改行', String(s.changed), 'chg'],
        ['未变行', String(s.unchanged), 'same']
      ].forEach(function (it) {
        statsGrid.appendChild(el('div', { class: 'stat' }, [
          el('span', { class: 'stat-value diff-stat-' + it[2], text: it[1] }),
          el('span', { class: 'stat-label', text: it[0] })
        ]));
      });
      statsCard.style.display = '';
    }

    /** 把行记录渲染成并排的两栏 */
    function renderSideBySide(rows) {
      const host = el('div', { class: 'diff-columns' });
      const leftCol = el('div', { class: 'diff-col' });
      const rightCol = el('div', { class: 'diff-col' });
      const leftHead = el('div', { class: 'diff-col-head', text: '原文' });
      const rightHead = el('div', { class: 'diff-col-head', text: '新文' });
      leftCol.appendChild(leftHead);
      rightCol.appendChild(rightHead);

      const leftBody = el('div', { class: 'diff-col-body' });
      const rightBody = el('div', { class: 'diff-col-body' });

      // 配对删除与插入：连续的 delete + insert 视为一次「修改」
      let i = 0;
      const charLevel = optCharLevel.checked;

      while (i < rows.length) {
        const r = rows[i];
        if (r.type === 'equal') {
          leftBody.appendChild(diffRow('equal', r.oldLine, r.newLine, r.text, null));
          rightBody.appendChild(diffRow('equal', r.oldLine, r.newLine, r.text, null));
          i++;
          continue;
        }

        // 收集连续的删除块与插入块
        const dels = [];
        const inss = [];
        while (i < rows.length && rows[i].type === 'delete') { dels.push(rows[i]); i++; }
        while (i < rows.length && rows[i].type === 'insert') { inss.push(rows[i]); i++; }

        const pairs = Math.max(dels.length, inss.length);
        for (let k = 0; k < pairs; k++) {
          const d = dels[k] || null;
          const n = inss[k] || null;

          let leftChunks = null, rightChunks = null;
          if (d && n && charLevel) {
            const cd = Core.diffChars(d.text, n.text);
            leftChunks = cd.left;
            rightChunks = cd.right;
          }

          leftBody.appendChild(diffRow(
            d ? 'delete' : 'empty', d ? d.oldLine : null, null,
            d ? d.text : '', leftChunks));
          rightBody.appendChild(diffRow(
            n ? 'insert' : 'empty', null, n ? n.newLine : null,
            n ? n.text : '', rightChunks));
        }
      }

      leftCol.appendChild(leftBody);
      rightCol.appendChild(rightBody);
      host.appendChild(leftCol);
      host.appendChild(rightCol);
      return host;
    }

    /**
     * 生成一行
     * kind: equal | delete | insert | empty
     * chunks: [{type:'equal'|'del'|'ins', text}]，仅该行所在一侧的字符级差异
     */
    function diffRow(kind, oldNo, newNo, text, chunks) {
      const row = el('div', { class: 'diff-row diff-' + kind });
      row.appendChild(el('span', { class: 'diff-ln', text: oldNo == null ? '' : String(oldNo) }));
      row.appendChild(el('span', { class: 'diff-sign', text: kind === 'delete' ? '-' : kind === 'insert' ? '+' : ' ' }));

      const cell = el('span', { class: 'diff-text' });
      if (chunks && chunks.length) {
        chunks.forEach(function (c) {
          if (c.type === 'equal') {
            cell.appendChild(document.createTextNode(c.text));
          } else {
            cell.appendChild(el('span', { class: 'diff-chunk diff-chunk-' + c.type, text: c.text }));
          }
        });
      } else {
        cell.textContent = text;
      }
      row.appendChild(cell);
      return row;
    }

    function doCompare() {
      const a = taA.value;
      const b = taB.value;
      if (!a.trim() && !b.trim()) {
        setStatus('✗ 请先输入要对比的文本', 'err');
        currentRows = [];
        sideHost.innerHTML = '';
        unifiedTa.value = '';
        statsCard.style.display = 'none';
        return;
      }

      const rows = Core.diffLines(a, b, { ignoreWhitespace: optIgnoreWs.checked });
      currentRows = rows;
      const s = Core.stats(rows);

      sideHost.innerHTML = '';
      sideHost.appendChild(renderSideBySide(rows));

      unifiedTa.value = Core.unifiedDiff(a, b, 3);
      showStats(s);

      if (s.added === 0 && s.removed === 0 && s.changed === 0) {
        setStatus('✓ 两段文本完全相同', 'ok');
      } else {
        setStatus('✓ 对比完成：新增 ' + s.added + ' 行，删除 ' + s.removed + ' 行，修改 ' + s.changed + ' 行', 'ok');
      }
    }

    function loadSample() {
      taA.value = SAMPLE_A;
      taB.value = SAMPLE_B;
      doCompare();
    }

    function doSwap() {
      const t = taA.value;
      taA.value = taB.value;
      taB.value = t;
      doCompare();
    }

    function doClear() {
      taA.value = '';
      taB.value = '';
      sideHost.innerHTML = '';
      unifiedTa.value = '';
      currentRows = [];
      statsCard.style.display = 'none';
      setStatus('', null);
      taA.focus();
    }

    function doCopy() {
      if (!currentRows.length) { setStatus('✗ 没有可复制的差异结果', 'err'); return; }
      const text = unifiedTa.value;
      copyText(text).then(function () {
        setStatus('✓ 已复制差异结果到剪贴板', 'ok');
      }).catch(function () {
        setStatus('✗ 复制失败，请手动选择文本复制', 'err');
      });
    }

    function doDownload() {
      if (!currentRows.length) { setStatus('✗ 没有可下载的差异结果', 'err'); return; }
      downloadBlob(new Blob([unifiedTa.value], { type: 'text/plain;charset=utf-8' }), 'diff.patch');
      setStatus('✓ 已下载 diff.patch', 'ok');
    }

    taA.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doCompare(); }
    });
    taB.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doCompare(); }
    });
    optIgnoreWs.addEventListener('change', doCompare);
    optCharLevel.addEventListener('change', doCompare);

    // 首次载入示例
    loadSample();
  }

  global.DiffTool = { render: render };
})(window);
