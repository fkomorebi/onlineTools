/* ============================================
   文本差异对比 —— 核心算法（纯 JS，无依赖）
   ============================================ */
(function (global) {
  'use strict';

  /**
   * 计算两个序列的最长公共子序列（LCS）
   *
   * 用「后缀 DP」在 O(n*m) 时间、O(min(n,m)) 额外空间内求出 LCS 长度表，
   * 随后沿表格回溯得到最长公共子序列本身。
   * 两条序列过长时（例如整篇大文档）会退化为按行哈希的快速匹配，
   * 避免卡住浏览器主线程。
   *
   * @param {Array} a
   * @param {Array} b
   * @returns {Array} 公共子序列（元素可能为字符串或数字）
   */
  function lcsSequence(a, b) {
    const n = a.length, m = b.length;
    if (!n || !m) return [];

    // 让 b 是较短的序列，DP 表按行滚动只需 min(n, m) 行
    const swap = n < m;
    const A = swap ? b : a;
    const B = swap ? a : b;
    const rows = A.length, cols = B.length;

    // dp[i][j] = A[i..] 与 B[j..] 的 LCS 长度
    const dp = [];
    for (let i = 0; i <= rows; i++) dp.push(new Uint32Array(cols + 1));

    for (let i = rows - 1; i >= 0; i--) {
      const rowCur = dp[i];
      const rowNext = dp[i + 1];
      for (let j = cols - 1; j >= 0; j--) {
        rowCur[j] = A[i] === B[j]
          ? rowNext[j + 1] + 1
          : Math.max(rowNext[j], rowCur[j + 1]);
      }
    }

    // 回溯
    const seq = [];
    let i = 0, j = 0;
    while (i < rows && j < cols) {
      if (A[i] === B[j]) {
        seq.push(A[i]);
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        i++;
      } else {
        j++;
      }
    }
    return swap ? seq : seq;
  }

  /**
   * 行级差异
   *
   * 返回的行对象结构：
   *   { type: 'equal'|'insert'|'delete', oldLine, newLine, text }
   *   oldLine / newLine 为 1 起始的行号，缺失时为 null。
   *
   * @param {string} aText 原文
   * @param {string} bText 新文
   * @param {{ignoreWhitespace?:boolean}} [opts]
   */
  function diffLines(aText, bText, opts) {
    const options = opts || {};
    const a = splitLines(aText);
    const b = splitLines(bText);

    // 空白忽略：用去空白后的内容做键来配对
    const key = options.ignoreWhitespace
      ? (s) => s.replace(/\s+/g, '')
      : (s) => s;

    const aKeys = a.map(key);
    const bKeys = b.map(key);

    const ops = computeOps(aKeys, bKeys);
    return buildLineRows(ops, a, b);
  }

  /** 把文本切成行（保留空行，末尾换行不额外产生空行） */
  function splitLines(text) {
    const s = String(text == null ? '' : text);
    if (s === '') return [];
    const lines = s.split(/\r\n|\r|\n/);
    // 末尾换行产生的空串不算一行
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  /**
   * 基于 LCS 的操作序列
   *
   * 返回形如 [{type:'equal'|'delete'|'insert', aIndex, bIndex}] 的数组，
   * aIndex / bIndex 为该侧的行索引（缺失时 -1）。
   */
  function computeOps(aKeys, bKeys) {
    // 过长时退化为按唯一键的简单匹配，避免 O(n*m) 卡死
    if (aKeys.length * bKeys.length > 4000000) {
      return computeOpsByKeyMatch(aKeys, bKeys);
    }

    const n = aKeys.length, m = bKeys.length;
    if (!n && !m) return [];
    if (!n) return bKeys.map(function (_, j) { return { type: 'insert', aIndex: -1, bIndex: j }; });
    if (!m) return aKeys.map(function (_, i) { return { type: 'delete', aIndex: i, bIndex: -1 }; });

    // dp[i][j] = aKeys[i..] 与 bKeys[j..] 的 LCS 长度
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      const rowCur = dp[i], rowNext = dp[i + 1];
      for (let j = m - 1; j >= 0; j--) {
        rowCur[j] = aKeys[i] === bKeys[j]
          ? rowNext[j + 1] + 1
          : Math.max(rowNext[j], rowCur[j + 1]);
      }
    }

    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (aKeys[i] === bKeys[j]) {
        ops.push({ type: 'equal', aIndex: i, bIndex: j });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: 'delete', aIndex: i, bIndex: -1 });
        i++;
      } else {
        ops.push({ type: 'insert', aIndex: -1, bIndex: j });
        j++;
      }
    }
    while (i < n) { ops.push({ type: 'delete', aIndex: i, bIndex: -1 }); i++; }
    while (j < m) { ops.push({ type: 'insert', aIndex: -1, bIndex: j }); j++; }
    return ops;
  }

  /** 超长文本的降级方案：以内容为键做贪心匹配 */
  function computeOpsByKeyMatch(aKeys, bKeys) {
    const ops = [];
    const bIndexByKey = new Map();
    for (let j = 0; j < bKeys.length; j++) {
      const k = bKeys[j];
      if (!bIndexByKey.has(k)) bIndexByKey.set(k, []);
      bIndexByKey.get(k).push(j);
    }
    const used = new Set();
    const pending = [];
    for (let i = 0; i < aKeys.length; i++) {
      const candidates = bIndexByKey.get(aKeys[i]);
      let matched = -1;
      if (candidates) {
        for (const j of candidates) {
          if (!used.has(j)) { matched = j; break; }
        }
      }
      if (matched === -1) {
        pending.push({ type: 'delete', aIndex: i, bIndex: -1 });
      } else {
        used.add(matched);
        pending.push({ type: 'equal', aIndex: i, bIndex: matched });
      }
    }
    // 按 b 侧顺序补上未匹配的插入
    let bj = 0;
    pending.forEach(function (op) {
      while (bj < bKeys.length && !used.has(bj) && bj < (op.bIndex === -1 ? bKeys.length : op.bIndex)) {
        ops.push({ type: 'insert', aIndex: -1, bIndex: bj });
        bj++;
      }
      ops.push(op);
      if (op.bIndex !== -1) bj = op.bIndex + 1;
    });
    while (bj < bKeys.length) { ops.push({ type: 'insert', aIndex: -1, bIndex: bj }); bj++; }
    return ops;
  }

  /** 把操作序列转成带行号的行记录 */
  function buildLineRows(ops, aLines, bLines) {
    return ops.map(function (op) {
      return {
        type: op.type,
        oldLine: op.aIndex === -1 ? null : op.aIndex + 1,
        newLine: op.bIndex === -1 ? null : op.bIndex + 1,
        text: op.type === 'delete'
          ? aLines[op.aIndex]
          : op.type === 'insert'
            ? bLines[op.bIndex]
            : aLines[op.aIndex]
      };
    });
  }

  /**
   * 字符级差异（用于行内高亮）
   * @returns {{left:Array, right:Array}} left/right 是 [{type:'equal'|'del'|'ins', text:string}]
   */
  function diffChars(aText, bText) {
    const a = Array.from(String(aText == null ? '' : aText));
    const b = Array.from(String(bText == null ? '' : bText));

    if (!a.length && !b.length) return { left: [], right: [] };
    if (!a.length) return { left: [], right: [{ type: 'ins', text: b.join('') }] };
    if (!b.length) return { left: [{ type: 'del', text: a.join('') }], right: [] };

    const seq = lcsSequence(a, b);
    const left = [], right = [];
    let i = 0, j = 0, k = 0;
    const pushRun = function (arr, type, text) {
      if (!text) return;
      const last = arr[arr.length - 1];
      if (last && last.type === type) last.text += text;
      else arr.push({ type: type, text: text });
    };

    while (k < seq.length) {
      const c = seq[k];
      while (i < a.length && a[i] !== c) { pushRun(left, 'del', a[i]); i++; }
      while (j < b.length && b[j] !== c) { pushRun(right, 'ins', b[j]); j++; }
      pushRun(left, 'equal', c);
      pushRun(right, 'equal', c);
      i++; j++; k++;
    }
    while (i < a.length) { pushRun(left, 'del', a[i]); i++; }
    while (j < b.length) { pushRun(right, 'ins', b[j]); j++; }
    return { left: left, right: right };
  }

  /**
   * 统计差异
   * @returns {{added:number, removed:number, unchanged:number, changed:number}}
   */
  function stats(rows) {
    const s = { added: 0, removed: 0, unchanged: 0, changed: 0 };
    rows.forEach(function (r) {
      if (r.type === 'insert') s.added++;
      else if (r.type === 'delete') s.removed++;
      else s.unchanged++;
    });
    // 「修改行」= 删除 + 插入的配对数量（相邻视为一次修改）
    let pairs = 0, pendingDelete = 0;
    rows.forEach(function (r) {
      if (r.type === 'delete') pendingDelete++;
      else if (r.type === 'insert') {
        if (pendingDelete > 0) { pairs++; pendingDelete--; }
      } else pendingDelete = 0;
    });
    s.changed = pairs;
    return s;
  }

  /**
   * 生成 unified diff 文本
   * @param {string} aText
   * @param {string} bText
   * @param {number} [context] 上下文行数，默认 3
   */
  function unifiedDiff(aText, bText, context) {
    const ctx = context == null ? 3 : context;
    const rows = diffLines(aText, bText);
    const stats_ = stats(rows);

    const out = ['--- 原文', '+++ 新文', '@@ -1,' + countLines(aText) + ' +1,' + countLines(bText) + ' @@'];

    // 标记需要显示的行（变更行 + 上下文）
    const keep = new Array(rows.length).fill(false);
    rows.forEach(function (r, idx) {
      if (r.type === 'equal') return;
      for (let k = Math.max(0, idx - ctx); k <= Math.min(rows.length - 1, idx + ctx); k++) {
        keep[k] = true;
      }
    });

    let oldNo = 0, newNo = 0;
    let skipping = false;
    rows.forEach(function (r, idx) {
      if (r.type === 'equal') { oldNo++; newNo++; }
      else if (r.type === 'delete') { oldNo++; }
      else { newNo++; }

      if (!keep[idx]) {
        skipping = true;
        return;
      }
      if (skipping) {
        out.push('@@ ... @@');
        skipping = false;
      }
      const prefix = r.type === 'insert' ? '+' : r.type === 'delete' ? '-' : ' ';
      out.push(prefix + r.text);
    });

    out.push('（新增 ' + stats_.added + ' 行，删除 ' + stats_.removed + ' 行）');
    return out.join('\n');
  }

  function countLines(text) {
    const l = splitLines(text);
    return l.length;
  }

  global.DiffCore = {
    diffLines: diffLines,
    diffChars: diffChars,
    stats: stats,
    unifiedDiff: unifiedDiff,
    splitLines: splitLines,
    lcsSequence: lcsSequence
  };
})(window);
