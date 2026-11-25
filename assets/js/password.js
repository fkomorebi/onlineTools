/* ============================================
   密码生成器 —— 页面
   ============================================ */
(function (global) {
  'use strict';

  const { el, copyText, downloadBlob } = global.U;
  const Core = global.PasswordCore;

  function render(root) {
    root.innerHTML = '';

    const head = el('div', { class: 'page-head' });
    head.appendChild(el('h1', { text: '密码生成器' }));
    head.appendChild(el('p', { text: '用浏览器密码学随机源生成高强度密码，显示熵值与估算破解时间，可批量导出。生成过程完全在本地完成。' }));
    root.appendChild(head);

    /* --- 密码展示 --- */
    const resultCard = el('div', { class: 'card' });
    resultCard.appendChild(el('div', { class: 'card-title', text: '生成结果' }));

    const pwBox = el('div', { class: 'pw-box', id: 'pw-box' });
    const pwText = el('div', { class: 'pw-text', id: 'pw-text', text: '' });
    pwBox.appendChild(pwText);
    resultCard.appendChild(pwBox);

    const bar = el('div', { class: 'pw-meter' }, [el('div', { class: 'pw-meter-fill', id: 'pw-meter-fill' })]);
    resultCard.appendChild(bar);

    const metaRow = el('div', { class: 'pw-meta', id: 'pw-meta' });
    resultCard.appendChild(metaRow);

    const status = el('div', { class: 'status', id: 'pw-status' });
    resultCard.appendChild(status);
    root.appendChild(resultCard);

    /* --- 选项 --- */
    const optCard = el('div', { class: 'card' });
    optCard.appendChild(el('div', { class: 'card-title', text: '选项' }));

    const optGrid = el('div', { class: 'grid-2' });

    /* 长度 */
    const lenBox = el('div', { class: 'field' });
    lenBox.appendChild(el('label', { class: 'field-label', text: '长度' }));
    const lenRow = el('div', { class: 'dim-row' });
    const lenInput = el('input', { type: 'number', id: 'pw-length', value: '20', min: '4', max: '256' });
    lenInput.style.flex = 'none';
    lenInput.style.width = '90px';
    lenRow.appendChild(lenInput);
    const lenRange = el('input', { type: 'range', id: 'pw-length-range', min: '4', max: '128', value: '20' });
    lenRow.appendChild(lenRange);
    lenBox.appendChild(lenRow);
    const lenHint = el('p', { class: 'hint', id: 'pw-length-hint', text: '20 位' });
    lenBox.appendChild(lenHint);

    /* 字符集 */
    const setBox = el('div', { class: 'field' });
    setBox.appendChild(el('label', { class: 'field-label', text: '字符集' }));
    const setsWrap = el('div', { class: 'pw-sets' });

    const cbLower = el('input', { type: 'checkbox', id: 'pw-lower', checked: 'checked' });
    const cbUpper = el('input', { type: 'checkbox', id: 'pw-upper', checked: 'checked' });
    const cbDigits = el('input', { type: 'checkbox', id: 'pw-digits', checked: 'checked' });
    const cbSymbols = el('input', { type: 'checkbox', id: 'pw-symbols', checked: 'checked' });
    const cbAmbiguous = el('input', { type: 'checkbox', id: 'pw-ambiguous' });
    const cbRequireEach = el('input', { type: 'checkbox', id: 'pw-require-each', checked: 'checked' });

    [
      [cbLower, '小写字母 a-z'],
      [cbUpper, '大写字母 A-Z'],
      [cbDigits, '数字 0-9'],
      [cbSymbols, '符号 !@#$'],
      [cbAmbiguous, '排除易混淆字符 (Il1O0o)'],
      [cbRequireEach, '每类字符至少一个']
    ].forEach(function (it) {
      setsWrap.appendChild(el('label', { class: 'checkbox-row' }, [it[0], it[1]]));
    });
    setBox.appendChild(setsWrap);

    /* 自定义字符 */
    const customBox = el('div', { class: 'field' });
    customBox.appendChild(el('label', { class: 'field-label', text: '自定义字符集（填写后取代内置符号）' }));
    const customInput = el('input', { type: 'text', id: 'pw-custom', placeholder: '例：!@#中文（可留空）' });
    customBox.appendChild(customInput);

    optGrid.appendChild(lenBox);
    optGrid.appendChild(setBox);
    optCard.appendChild(optGrid);
    optCard.appendChild(customBox);
    root.appendChild(optCard);

    /* --- 操作 --- */
    const toolbar = el('div', { class: 'toolbar' });
    const btnGen = el('button', { class: 'btn btn-primary', text: '生成密码', onclick: doGenerate });
    const btnCopy = el('button', { class: 'btn', text: '复制', onclick: doCopy });
    const btnBulk = el('button', { class: 'btn', text: '批量生成', onclick: doBulk });
    const btnExport = el('button', { class: 'btn btn-success', text: '导出 CSV', onclick: doExport });
    toolbar.appendChild(btnGen);
    toolbar.appendChild(btnCopy);
    toolbar.appendChild(el('span', { class: 'spacer' }));
    toolbar.appendChild(el('label', { class: 'field-label', style: 'margin:0', text: '批量数量' }));
    const bulkCount = el('input', { type: 'number', id: 'pw-bulk-count', value: '10', min: '1', max: '1000', style: 'width:80px' });
    toolbar.appendChild(bulkCount);
    toolbar.appendChild(btnBulk);
    toolbar.appendChild(btnExport);
    root.appendChild(toolbar);

    /* --- 批量结果 --- */
    const bulkCard = el('div', { class: 'card', id: 'pw-bulk-card' });
    bulkCard.style.display = 'none';
    bulkCard.appendChild(el('div', { class: 'card-title', text: '批量结果' }));
    const bulkBox = el('div', { class: 'table-wrap' });
    bulkCard.appendChild(bulkBox);
    root.appendChild(bulkCard);

    /* --- 逻辑 --- */

    function setStatus(msg, kind) {
      status.className = 'status' + (kind ? ' ' + kind : '');
      if (kind) { status.classList.add('show'); status.textContent = msg; }
      else { status.classList.remove('show'); status.textContent = ''; }
    }

    function currentOpts() {
      return {
        length: parseInt(lenInput.value, 10) || 16,
        lower: cbLower.checked,
        upper: cbUpper.checked,
        digits: cbDigits.checked,
        symbols: cbSymbols.checked,
        excludeAmbiguous: cbAmbiguous.checked,
        requireEach: cbRequireEach.checked,
        custom: customInput.value
      };
    }

    let currentPassword = '';
    let bulkList = [];

    function renderStrength(password, opts) {
      const s = Core.strength(password, opts);
      const fill = document.getElementById('pw-meter-fill');
      fill.className = 'pw-meter-fill pw-fill-' + s.color;
      // 128 bit 视为满格
      fill.style.width = Math.min(100, (s.bits / 128) * 100) + '%';

      metaRow.innerHTML = '';
      metaRow.appendChild(el('span', { class: 'pw-tag' }, [
        el('b', { text: '强度：' }), el('span', { class: 'pw-strength pw-strength-' + s.color, text: s.label })
      ]));
      metaRow.appendChild(el('span', { class: 'pw-tag' }, [
        el('b', { text: '熵：' }), el('span', { text: s.bits + ' bit' })
      ]));
      metaRow.appendChild(el('span', { class: 'pw-tag' }, [
        el('b', { text: '字符池：' }), el('span', { text: Core.buildPool(opts).length + ' 种' })
      ]));
      metaRow.appendChild(el('span', { class: 'pw-tag' }, [
        el('b', { text: '离线破解约需：' }), el('span', { text: s.crackTime })
      ]));

      const issues = Core.weakPatterns(password);
      if (issues.length) {
        metaRow.appendChild(el('span', { class: 'pw-tag' }, [
          el('b', { text: '⚠ 弱模式：' }), el('span', { text: issues.map(function (i) { return i.message; }).join('；') })
        ]));
      }
    }

    function doGenerate() {
      const opts = currentOpts();
      const r = Core.generate(opts);
      if (!r.ok) {
        currentPassword = '';
        pwText.textContent = '';
        pwText.classList.add('error');
        setStatus('✗ ' + r.error, 'err');
        return;
      }
      pwText.classList.remove('error');
      currentPassword = r.password;
      pwText.textContent = r.password;
      renderStrength(r.password, opts);
      setStatus('✓ 已生成 ' + r.password.length + ' 位密码', 'ok');
    }

    function doCopy() {
      if (!currentPassword) { setStatus('✗ 请先生成密码', 'err'); return; }
      copyText(currentPassword).then(function () {
        setStatus('✓ 已复制到剪贴板', 'ok');
      }).catch(function () {
        setStatus('✗ 复制失败，请手动选择文本复制', 'err');
      });
    }

    function doBulk() {
      const opts = currentOpts();
      const count = parseInt(bulkCount.value, 10);
      if (!count || count < 1) { setStatus('✗ 请输入有效的数量', 'err'); return; }
      const cap = Math.min(count, 1000);
      bulkList = [];
      for (let i = 0; i < cap; i++) {
        const r = Core.generate(opts);
        if (r.ok) bulkList.push(r.password);
      }
      renderBulk();
      bulkCard.style.display = '';
      setStatus('✓ 已批量生成 ' + bulkList.length + ' 个密码', 'ok');
    }

    function renderBulk() {
      bulkBox.innerHTML = '';
      const table = el('table');
      const thead = el('thead');
      thead.appendChild(el('tr', {}, [
        el('th', { text: '#' }),
        el('th', { text: '密码' }),
        el('th', { text: '熵' }),
        el('th', { text: '' })
      ]));
      table.appendChild(thead);
      const tbody = el('tbody');
      bulkList.forEach(function (pw, i) {
        const s = Core.strength(pw, currentOpts());
        const row = el('tr');
        row.appendChild(el('td', { text: String(i + 1) }));
        row.appendChild(el('td', { class: 'mono', text: pw }));
        row.appendChild(el('td', { class: 'num', text: s.bits + ' bit' }));
        const copyBtn = el('button', {
          class: 'btn btn-sm', text: '复制',
          onclick: function () {
            copyText(pw).then(function () {
              setStatus('✓ 已复制第 ' + (i + 1) + ' 个密码', 'ok');
            }).catch(function () {
              setStatus('✗ 复制失败', 'err');
            });
          }
        });
        row.appendChild(el('td', {}, [copyBtn]));
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      bulkBox.appendChild(table);
    }

    function doExport() {
      const list = bulkList.length ? bulkList : (currentPassword ? [currentPassword] : []);
      if (!list.length) { setStatus('✗ 请先生成密码', 'err'); return; }
      const csv = ['password'] .concat(list).join('\n');
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'passwords.csv');
      setStatus('✓ 已导出 ' + list.length + ' 个密码', 'ok');
    }

    /* --- 事件 --- */

    lenInput.addEventListener('input', function () {
      const v = parseInt(lenInput.value, 10);
      lenHint.textContent = v + ' 位';
      if (!isNaN(v) && v >= 4 && v <= 128) {
        lenRange.value = String(v);
      }
    });
    lenRange.addEventListener('input', function () {
      lenInput.value = lenRange.value;
      lenHint.textContent = lenRange.value + ' 位';
    });
    [cbLower, cbUpper, cbDigits, cbSymbols, cbAmbiguous, cbRequireEach].forEach(function (cb) {
      cb.addEventListener('change', doGenerate);
    });
    customInput.addEventListener('input', function () { doGenerate(); });

    // 首次生成
    doGenerate();
  }

  global.PasswordTool = { render: render };
})(window);
