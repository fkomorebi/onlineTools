/* ============================================
   正则表达式测试台 —— 页面
   ============================================ */
(function (global) {
  'use strict';

  const { el, copyText } = global.U;
  const Core = global.RegexCore;

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: '正则表达式测试台' }));
    head.appendChild(el('p', { text: '实时测试正则、逐条列出匹配结果与捕获组、把表达式拆成一个个带解释的片段，还能生成示例字符串。' }));
    root.appendChild(head);

    /* --- 表达式 --- */
    const exprCard = el('div', { class: 'card' });
    exprCard.appendChild(el('div', { class: 'card-title', text: '正则表达式' }));

    const exprRow = el('div', { class: 'regex-expr-row' });
    const exprInput = el('input', { type: 'text', id: 'regex-pattern', class: 'mono', placeholder: '例：\\d{4}-\\d{2}-\\d{2}', spellcheck: 'false' });
    exprInput.value = '(\\d{4})-(\\d{2})-(\\d{2})';
    exprRow.appendChild(exprInput);
    const flagsInput = el('input', { type: 'text', id: 'regex-flags', class: 'mono', placeholder: 'gim', spellcheck: 'false' });
    flagsInput.value = 'g';
    exprRow.appendChild(flagsInput);
    exprCard.appendChild(exprRow);

    const flagRow = el('div', { class: 'btn-group', id: 'regex-flag-buttons', style: 'margin-top:10px' });
    const FLAGS = [
      ['g', '全局 g'], ['i', '忽略大小写 i'], ['m', '多行 m'], ['s', '点号匹配换行 s'],
      ['u', 'Unicode u'], ['y', '粘性 y']
    ];
    const flagButtons = {};
    FLAGS.forEach(function (f) {
      const b = el('button', { class: 'btn btn-sm', text: f[1], onclick: function () { toggleFlag(f[0]); } });
      flagButtons[f[0]] = b;
      flagRow.appendChild(b);
    });
    exprCard.appendChild(flagRow);

    const exprToolbar = el('div', { class: 'toolbar', style: 'margin-top:12px' });
    exprToolbar.appendChild(el('button', { class: 'btn btn-sm', text: '生成示例', onclick: doSample }));
    exprToolbar.appendChild(el('button', { class: 'btn btn-sm', text: '复制表达式', onclick: doCopyExpr }));
    exprToolbar.appendChild(el('span', { class: 'spacer' }));
    exprToolbar.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: '常用模板' }));
    const presetSel = el('select', { id: 'regex-preset' });
    presetSel.appendChild(el('option', { value: '', text: '选择…' }));
    Core.PRESETS.forEach(function (p, i) {
      presetSel.appendChild(el('option', { value: String(i), text: p.name }));
    });
    exprToolbar.appendChild(presetSel);
    exprCard.appendChild(exprToolbar);

    const status = el('div', { class: 'status', id: 'regex-status' });
    exprCard.appendChild(status);
    root.appendChild(exprCard);

    /* --- 测试文本 --- */
    const textCard = el('div', { class: 'card' });
    textCard.appendChild(el('div', { class: 'card-title', text: '测试文本' }));
    const textInput = el('textarea', { class: 'editor', id: 'regex-text', spellcheck: 'false' });
    textInput.value = '会议记录 2024-03-15\n发布日期 2025-11-25\n无效日期 24-12-2024';
    textCard.appendChild(textInput);
    root.appendChild(textCard);

    /* --- 匹配结果 --- */
    const matchCard = el('div', { class: 'card' });
    matchCard.appendChild(el('div', { class: 'card-title', text: '匹配结果' }));
    const matchStats = el('div', { class: 'stats', id: 'regex-stats' });
    matchCard.appendChild(matchStats);
    const matchBox = el('div', { class: 'table-wrap', id: 'regex-matches' });
    matchCard.appendChild(matchBox);
    root.appendChild(matchCard);

    /* --- 表达式说明 --- */
    const explainCard = el('div', { class: 'card' });
    explainCard.appendChild(el('div', { class: 'card-title', text: '表达式拆解' }));
    const explainBox = el('div', { class: 'regex-explain', id: 'regex-explain' });
    explainCard.appendChild(explainBox);
    root.appendChild(explainCard);

    /* --- 逻辑 --- */
    function setStatus(msg, kind) {
      status.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { status.classList.add('show'); status.textContent = msg; }
      else { status.classList.remove('show'); status.textContent = ''; }
    }

    function currentFlags() {
      return flagsInput.value.replace(/[^gimsuy]/g, '');
    }

    function toggleFlag(f) {
      const flags = currentFlags();
      if (flags.indexOf(f) !== -1) {
        flagsInput.value = flags.replace(f, '');
      } else {
        // 保持一个固定顺序，避免 g 在后面时的怪异行为
        const ORDER = 'gim suy'.replace(/\s/g, '');
        let next = '';
        ORDER.split('').forEach(function (c) {
          if (c === f) next += c;
          else if (flags.indexOf(c) !== -1) next += c;
        });
        flagsInput.value = next;
      }
      syncFlagButtons();
      run();
    }

    function syncFlagButtons() {
      const flags = currentFlags();
      Object.keys(flagButtons).forEach(function (f) {
        flagButtons[f].className = 'btn btn-sm' + (flags.indexOf(f) !== -1 ? ' btn-primary' : '');
      });
    }

    function renderStats(items) {
      matchStats.innerHTML = '';
      items.forEach(function (it) {
        matchStats.appendChild(el('div', { class: 'stat' }, [
          el('span', { class: 'stat-value', text: it[1] }),
          el('span', { class: 'stat-label', text: it[0] })
        ]));
      });
    }

    function renderMatches(matches, truncated) {
      matchBox.innerHTML = '';
      if (!matches.length) {
        matchBox.appendChild(el('p', { class: 'hint', text: '没有匹配到任何内容。' }));
        return;
      }
      const table = el('table');
      const thead = el('thead');
      thead.appendChild(el('tr', {}, [
        el('th', { text: '#' }),
        el('th', { text: '位置' }),
        el('th', { text: '匹配内容' }),
        el('th', { text: '捕获组' })
      ]));
      table.appendChild(thead);
      const tbody = el('tbody');
      matches.forEach(function (m, i) {
        const row = el('tr');
        row.appendChild(el('td', { text: String(i + 1) }));
        row.appendChild(el('td', { class: 'num', text: m.index + '–' + m.end }));
        row.appendChild(el('td', { class: 'mono', text: m.text }));

        const groups = m.groups.filter(function (g) { return !g.whole; });
        const gcell = el('td', { class: 'mono regex-groups' });
        if (!groups.length) {
          gcell.appendChild(el('span', { class: 'regex-group-none', text: '（无捕获组）' }));
        } else {
          groups.forEach(function (g) {
            gcell.appendChild(el('span', { class: 'regex-group' }, [
              el('b', { text: g.name + (g.named ? '' : '') }),
              el('span', { text: g.undefined ? '（未参与匹配）' : ' = ' + JSON.stringify(g.value) })
            ]));
          });
        }
        row.appendChild(gcell);
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      matchBox.appendChild(table);
      if (truncated) {
        matchBox.appendChild(el('p', { class: 'hint', text: '匹配过多，只显示前 1000 条。' }));
      }
    }

    function renderExplain(pattern) {
      explainBox.innerHTML = '';
      const parts = Core.explain(pattern);
      if (!parts.length) {
        explainBox.appendChild(el('p', { class: 'hint', text: '（空表达式）' }));
        return;
      }
      parts.forEach(function (p) {
        explainBox.appendChild(el('div', { class: 'regex-token regex-token-' + p.type }, [
          el('code', { class: 'regex-token-text', text: p.token }),
          el('span', { class: 'regex-token-desc', text: p.desc })
        ]));
      });
    }

    function run() {
      const pattern = exprInput.value;
      const flags = currentFlags();
      syncFlagButtons();

      const compiled = Core.compile(pattern, flags);
      if (!compiled.ok) {
        matchBox.innerHTML = '';
        renderStats([]);
        renderExplain(pattern);
        setStatus('✗ ' + compiled.error, 'err');
        return;
      }

      const r = Core.execAll(textInput.value, compiled.regex, { limit: 1000 });
      renderStats([
        ['匹配数', String(r.count)],
        ['正则长度', String(pattern.length)],
        ['修饰符', flags || '（无）'],
        ['测试文本', String(textInput.value.length) + ' 字符']
      ]);
      renderMatches(r.matches, r.truncated);
      renderExplain(compiled.source);
      setStatus('✓ 正则有效', 'ok');
    }

    function doSample() {
      const r = Core.generateSample(exprInput.value, currentFlags());
      if (!r.ok) {
        setStatus('✗ ' + r.error, 'err');
        return;
      }
      textInput.value = r.sample;
      run();
      setStatus('✓ 已生成示例文本', 'ok');
    }

    function doCopyExpr() {
      const pattern = exprInput.value;
      if (!pattern) { setStatus('✗ 请输入正则表达式', 'err'); return; }
      const literal = '/' + pattern + '/' + currentFlags();
      copyText(literal).then(function () {
        setStatus('✓ 已复制 ' + literal, 'ok');
      }).catch(function () {
        setStatus('✗ 复制失败，请手动复制', 'err');
      });
    }

    /* --- 事件 --- */
    exprInput.addEventListener('input', global.U.debounce(run, 180));
    flagsInput.addEventListener('input', global.U.debounce(run, 180));
    textInput.addEventListener('input', global.U.debounce(run, 180));
    presetSel.addEventListener('change', function () {
      const idx = presetSel.value;
      if (idx === '') return;
      const p = Core.PRESETS[parseInt(idx, 10)];
      exprInput.value = p.pattern;
      flagsInput.value = p.flags;
      run();
    });

    syncFlagButtons();
    run();
  }

  global.RegexTool = { render: render };
})(window);
