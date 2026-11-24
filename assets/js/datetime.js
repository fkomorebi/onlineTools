/* ============================================
   时间格式化工具
   ============================================ */
(function (global) {
  'use strict';

  const { el, copyText } = global.U;
  const Core = global.DateTimeCore;

  const DEFAULT_ZONES = [
    'UTC',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Asia/Kolkata',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Australia/Sydney',
    'Pacific/Auckland'
  ];

  const PATTERNS = [
    { label: 'yyyy-MM-dd HH:mm:ss', value: 'yyyy-MM-dd HH:mm:ss' },
    { label: 'yyyy-MM-dd', value: 'yyyy-MM-dd' },
    { label: 'yyyy/MM/dd HH:mm:ss', value: 'yyyy/MM/dd HH:mm:ss' },
    { label: 'HH:mm:ss', value: 'HH:mm:ss' },
    { label: 'hh:mm:ss a（12 小时制）', value: 'hh:mm:ss a' },
    { label: 'yyyy-MM-ddTHH:mm:ssZ（ISO 8601）', value: "yyyy-MM-dd'T'HH:mm:ssZ" },
    { label: 'EEE, dd MMM yyyy HH:mm:ss（RFC）', value: 'EEE, dd MMM yyyy HH:mm:ss' },
    { label: 'yyyy年MM月dd日 E', value: 'yyyy年MM月dd日 E' },
    { label: '自定义…', value: '__custom__' }
  ];

  function render(root) {
    root.innerHTML = '';

    let state = {
      date: new Date(),
      timeZone: Core.guessTimeZone() || 'Asia/Shanghai',
      baseTz: 'Asia/Shanghai',
      pattern: 'yyyy-MM-dd HH:mm:ss',
      live: true
    };

    /* ---------------- 页头 ---------------- */
    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: '🕒 时间格式化' }));
    head.appendChild(el('p', { text: '把时间转换成 UTC、ISO 8601、RFC、Unix 时间戳等任意格式，支持多时区对照与自定义格式串。' }));
    root.appendChild(head);

    /* ---------------- 输入区 ---------------- */
    const inputCard = el('div', { class: 'card' });
    inputCard.appendChild(el('div', { class: 'card-title', text: '输入' }));

    const toolbar = el('div', { class: 'toolbar' });

    const input = el('input', {
      type: 'text',
      id: 'dt-input',
      class: 'dt-input',
      spellcheck: 'false',
      placeholder: '输入时间：2026-11-24 15:45:04 / 1763960700 / ISO 字符串',
      oninput: function () { handleInput(); }
    });
    toolbar.appendChild(input);

    const nowBtn = el('button', { class: 'btn', text: '当前时间', onclick: function () {
      input.value = '';
      state.date = new Date();
      state.live = true;
      update();
      setStatus('✓ 已重置为当前时间', 'ok');
    } });
    toolbar.appendChild(nowBtn);

    const sampleBtn = el('button', { class: 'btn', text: '示例', onclick: function () {
      input.value = '2026-11-24 15:45:04';
      state.date = new Date(2026, 10, 24, 15, 45, 4);
      state.live = false;
      update();
      setStatus('✓ 已载入示例时间', 'ok');
    } });
    toolbar.appendChild(sampleBtn);

    const tzLabel = el('label', { class: 'field-label', style: 'margin:0', text: '时区' });
    toolbar.appendChild(tzLabel);

    const tzSelect = el('select', { id: 'dt-tz', onchange: function () {
      state.timeZone = tzSelect.value;
      update();
    } });
    toolbar.appendChild(tzSelect);

    const localBtn = el('button', { class: 'btn btn-sm', text: '本地时区', onclick: function () {
      const local = Core.guessTimeZone();
      if (!local) { setStatus('✗ 无法识别本地时区', 'err'); return; }
      state.timeZone = local;
      tzSelect.value = local;
      update();
    } });
    toolbar.appendChild(localBtn);

    toolbar.appendChild(el('span', { class: 'spacer' }));

    const liveCheck = el('input', {
      type: 'checkbox', id: 'dt-live',
      onchange: function () {
        state.live = liveCheck.checked;
        if (state.live) state.date = new Date();
        update();
      }
    });
    const liveLabel = el('label', { class: 'checkbox-row' }, [liveCheck, el('span', { text: '实时更新' })]);
    toolbar.appendChild(liveLabel);

    inputCard.appendChild(toolbar);

    const status = el('div', { class: 'status', id: 'dt-status' });
    inputCard.appendChild(status);
    root.appendChild(inputCard);

    /* ---------------- 常用格式 ---------------- */
    const fmtCard = el('div', { class: 'card' });
    const fmtHead = el('div', { class: 'row-between' });
    fmtHead.appendChild(el('div', { class: 'card-title', style: 'margin:0', text: '常用格式' }));
    const copyAllBtn = el('button', { class: 'btn btn-sm', text: '复制全部', onclick: copyAllFormats });
    fmtHead.appendChild(copyAllBtn);
    fmtCard.appendChild(fmtHead);

    const fmtTable = el('div', { class: 'table-wrap', id: 'dt-formats' });
    fmtCard.appendChild(fmtTable);
    root.appendChild(fmtCard);

    /* ---------------- 自定义格式 ---------------- */
    const customCard = el('div', { class: 'card' });
    customCard.appendChild(el('div', { class: 'card-title', text: '自定义格式' }));

    const customToolbar = el('div', { class: 'toolbar' });
    const patternSel = el('select', { id: 'dt-pattern', onchange: function () {
      const v = patternSel.value;
      if (v === '__custom__') {
        customInput.focus();
        customInput.select();
        state.pattern = customInput.value || 'yyyy-MM-dd HH:mm:ss';
      } else {
        state.pattern = v;
      }
      renderCustom();
    } });
    PATTERNS.forEach(function (p) {
      patternSel.appendChild(el('option', { value: p.value, text: p.label }));
    });
    patternSel.value = PATTERNS[0].value;

    const customInput = el('input', {
      type: 'text', id: 'dt-custom', class: 'mono', style: 'max-width:260px',
      placeholder: 'yyyy-MM-dd HH:mm:ss',
      oninput: function () {
        state.pattern = customInput.value;
        renderCustom();
      }
    });

    customToolbar.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: '格式串' }));
    customToolbar.appendChild(patternSel);
    customToolbar.appendChild(customInput);
    customCard.appendChild(customToolbar);

    const customOut = el('div', { class: 'status info', id: 'dt-custom-out' });
    customCard.appendChild(customOut);

    const tokenHelp = el('div', { class: 'dt-tokens' });
    [
      ['yyyy', '年（4 位）'], ['yy', '年（2 位）'], ['MM', '月（2 位）'], ['dd', '日（2 位）'],
      ['HH', '24 小时'], ['hh', '12 小时'], ['mm', '分'], ['ss', '秒'], ['SSS', '毫秒'],
      ['a', '上午/下午'], ['E', '星期'], ['Z', '时区偏移 +08:00'], ['ZZ', '时区偏移 +0800'],
      ['X', 'Unix 秒'], ['x', 'Unix 毫秒']
    ].forEach(function (t) {
      tokenHelp.appendChild(el('span', { class: 'dt-token' }, [
        el('code', { text: t[0] }),
        el('i', { text: t[1] })
      ]));
    });
    customCard.appendChild(tokenHelp);
    root.appendChild(customCard);

    /* ---------------- 时区对照 ---------------- */
    const tzCard = el('div', { class: 'card' });
    tzCard.appendChild(el('div', { class: 'card-title', text: '时区对照' }));

    const tzToolbar = el('div', { class: 'toolbar' });
    const tzSearch = el('input', {
      type: 'text', id: 'dt-tz-search', class: 'dt-input', style: 'max-width:280px',
      placeholder: '添加时区，如 Asia/Shanghai',
      oninput: function () { renderTzTable(); }
    });
    const tzAdd = el('button', { class: 'btn', text: '添加', onclick: addTimeZone });
    tzToolbar.appendChild(tzSearch);
    tzToolbar.appendChild(tzAdd);
    tzToolbar.appendChild(el('span', { class: 'spacer' }));
    tzToolbar.appendChild(el('button', { class: 'btn btn-sm', text: '恢复默认', onclick: function () {
      state.zones = DEFAULT_ZONES.slice();
      tzSearch.value = '';
      renderTzTable();
    } }));
    tzCard.appendChild(tzToolbar);

    const tzTable = el('div', { class: 'table-wrap', id: 'dt-tz-table' });
    tzCard.appendChild(tzTable);
    root.appendChild(tzCard);

    /* ---------------- 时间差 ---------------- */
    const diffCard = el('div', { class: 'card' });
    diffCard.appendChild(el('div', { class: 'card-title', text: '时间差计算' }));

    const diffRow = el('div', { class: 'toolbar' });
    const diffInput = el('input', {
      type: 'text', id: 'dt-diff-input', class: 'dt-input',
      placeholder: '第二个时间，如 2026-12-01 00:00:00',
      oninput: function () { renderDiff(); }
    });
    diffRow.appendChild(diffInput);
    diffRow.appendChild(el('span', { class: 'diff-label', text: '与当前时间相差' }));
    diffRow.appendChild(el('span', { class: 'spacer' }));
    diffRow.appendChild(el('button', { class: 'btn btn-sm', text: '现在', onclick: function () {
      diffInput.value = Core.format(new Date(), 'yyyy-MM-dd HH:mm:ss', state.timeZone);
      renderDiff();
    } }));
    diffCard.appendChild(diffRow);

    const diffOut = el('div', { class: 'stats', id: 'dt-diff-out' });
    diffCard.appendChild(diffOut);
    root.appendChild(diffCard);

    /* ---------------- 初始化 ---------------- */

    // 填充时区下拉框
    const allZones = Core.listTimeZones();
    const zoneSet = {};
    DEFAULT_ZONES.concat(allZones).concat([state.timeZone]).forEach(function (z) {
      if (z && !zoneSet[z]) {
        zoneSet[z] = true;
        tzSelect.appendChild(el('option', { value: z, text: z }));
      }
    });
    if (!zoneSet[state.timeZone]) {
      tzSelect.appendChild(el('option', { value: state.timeZone, text: state.timeZone }));
    }
    tzSelect.value = state.timeZone;

    state.zones = DEFAULT_ZONES.slice();
    if (state.zones.indexOf(state.timeZone) === -1) state.zones.push(state.timeZone);

    renderTzTable();
    renderDiff();
    update();

    // 实时刷新
    const timer = setInterval(function () {
      if (!state.live) return;
      state.date = new Date();
      update();
    }, 1000);

    global.__datetimeTimer = timer;

    /* ---------------- 内部函数 ---------------- */

    function setStatus(msg, kind) {
      status.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { status.classList.add('show'); status.textContent = msg; }
      else { status.classList.remove('show'); status.textContent = ''; }
    }

    function handleInput() {
      const v = input.value.trim();
      if (!v) {
        state.date = new Date();
        state.live = true;
        liveCheck.checked = true;
        update();
        return;
      }
      const r = Core.parseInput(v);
      if (!r.ok) {
        setStatus('✗ ' + r.error, 'err');
        return;
      }
      state.date = r.date;
      state.live = false;
      liveCheck.checked = false;
      setStatus('✓ 已解析：' + r.kind, 'ok');
      update();
    }

    function update() {
      renderFormats();
      renderCustom();
      renderTzTable();
      renderDiff();
    }

    function renderFormats() {
      const rows = Core.commonFormats(state.date, state.timeZone);
      fmtTable.innerHTML = '';
      const table = el('table');
      const thead = el('thead');
      thead.appendChild(el('tr', {}, [
        el('th', { text: '格式' }),
        el('th', { text: '结果' }),
        el('th', { text: '' })
      ]));
      table.appendChild(thead);

      const tbody = el('tbody');
      rows.forEach(function (r) {
        const copyBtn = el('button', {
          class: 'btn btn-sm', text: '复制',
          onclick: function () {
            copyText(r.value).then(function () {
              setStatus('✓ 已复制：' + r.value, 'ok');
            }).catch(function () {
              setStatus('✗ 复制失败', 'err');
            });
          }
        });
        const cells = [el('td', { text: r.label })];
        const valCell = el('td', { class: 'mono dt-val' });
        valCell.appendChild(el('span', { text: r.value }));
        if (r.note) valCell.appendChild(el('em', { class: 'dt-note', text: r.note }));
        cells.push(valCell);
        cells.push(el('td', {}, [copyBtn]));
        tbody.appendChild(el('tr', {}, cells));
      });
      table.appendChild(tbody);
      fmtTable.appendChild(table);
    }

    function renderCustom() {
      const out = Core.format(state.date, state.pattern, state.timeZone);
      customOut.className = 'status info show';
      customOut.textContent = out;
    }

    function renderTzTable() {
      const filter = (tzSearch.value || '').trim().toLowerCase();
      const zones = state.zones.filter(function (z) {
        return !filter || z.toLowerCase().indexOf(filter) !== -1;
      });
      const rows = Core.timezoneTable(state.date, zones);

      tzTable.innerHTML = '';
      const table = el('table');
      const thead = el('thead');
      thead.appendChild(el('tr', {}, [
        el('th', { text: '时区' }),
        el('th', { text: 'UTC 偏移' }),
        el('th', { text: '当地时间' }),
        el('th', { text: '' })
      ]));
      table.appendChild(thead);

      const tbody = el('tbody');
      if (!rows.length) {
        tbody.appendChild(el('tr', {}, [
          el('td', { colspan: '4', class: 'dt-empty', text: '没有匹配的时区' })
        ]));
      }
      rows.forEach(function (r) {
        const setBtn = el('button', {
          class: 'btn btn-sm', text: '设为当前',
          onclick: function () {
            state.timeZone = r.zone;
            tzSelect.value = r.zone;
            update();
            setStatus('✓ 已切换到 ' + r.zone, 'ok');
          }
        });
        const zoneCell = el('td', { class: 'mono' });
        zoneCell.appendChild(el('span', { text: r.zone }));
        if (r.dst) zoneCell.appendChild(el('span', { class: 'badge badge-dst', text: 'DST' }));
        const cells = [
          zoneCell,
          el('td', { class: 'mono', text: r.offset }),
          el('td', { class: 'mono', text: r.text }),
          el('td', {}, [setBtn])
        ];
        tbody.appendChild(el('tr', {}, cells));
      });
      table.appendChild(tbody);
      tzTable.appendChild(table);
    }

    function addTimeZone() {
      const v = (tzSearch.value || '').trim();
      if (!v) { setStatus('✗ 请输入要添加的时区', 'err'); return; }
      const zones = Core.listTimeZones();
      const known = zones.indexOf(v) !== -1;
      if (!known && !/^[A-Za-z_]+\/[A-Za-z_+-]+/.test(v)) {
        setStatus('✗ 时区格式应为 IANA 名称，如 Asia/Shanghai', 'err');
        return;
      }
      if (state.zones.indexOf(v) !== -1) {
        setStatus('✗ 该时区已存在', 'err');
        return;
      }
      state.zones.push(v);
      tzSearch.value = '';
      renderTzTable();
      setStatus('✓ 已添加时区 ' + v, 'ok');
    }

    function renderDiff() {
      const v = (diffInput.value || '').trim();
      diffOut.innerHTML = '';
      if (!v) {
        diffOut.appendChild(el('div', { class: 'stat' }, [
          el('span', { class: 'stat-value', text: '—' }),
          el('span', { class: 'stat-label', text: '输入第二个时间后显示' })
        ]));
        return;
      }
      const r = Core.parseInput(v);
      if (!r.ok) {
        diffOut.appendChild(el('div', { class: 'stat' }, [
          el('span', { class: 'stat-value', text: '✗' }),
          el('span', { class: 'stat-label', text: r.error })
        ]));
        return;
      }
      const d = Core.diff(state.date, r.date);
      const items = [
        [d.text, '差值'],
        [String(d.days), '总天数'],
        [String(d.restHours), '余小时'],
        [String(d.restMinutes), '余分钟'],
        [String(d.restSeconds), '余秒'],
        [String(d.ms), '毫秒']
      ];
      items.forEach(function (it) {
        diffOut.appendChild(el('div', { class: 'stat' }, [
          el('span', { class: 'stat-value', text: it[0] }),
          el('span', { class: 'stat-label', text: it[1] })
        ]));
      });
    }

    function copyAllFormats() {
      const rows = Core.commonFormats(state.date, state.timeZone);
      const text = rows.map(function (r) { return r.label + ': ' + r.value; }).join('\n');
      copyText(text).then(function () {
        setStatus('✓ 已复制全部 ' + rows.length + ' 种格式', 'ok');
      }).catch(function () {
        setStatus('✗ 复制失败', 'err');
      });
    }
  }

  function destroy() {
    if (global.__datetimeTimer) {
      clearInterval(global.__datetimeTimer);
      global.__datetimeTimer = null;
    }
  }

  global.DateTimeTool = { render: render, destroy: destroy };
})(window);
