/* ============================================
   工具清单（唯一数据源）
   —— 首页分组导航与命令面板共用同一份数据
   ============================================ */
(function (global) {
  'use strict';

  /** 分类定义（顺序即首页展示顺序） */
  const CATEGORIES = [
    { id: 'text', name: '文本与数据', icon: '📝' },
    { id: 'image', name: '图片处理', icon: '🖼️' },
    { id: 'media', name: '音视频', icon: '🎵' },
    { id: 'dev', name: '开发调试', icon: '🧑‍💻' },
    { id: 'design', name: '设计与安全', icon: '🎨' }
  ];

  /**
   * 工具清单
   * category  取值需与 CATEGORIES 中的 id 对应
   * keywords   用于首页搜索框的额外匹配词
   */
  const TOOLS = [
    {
      icon: '📋', route: '#/json', title: 'JSON 格式化', category: 'text',
      desc: '格式化、压缩、校验，错误定位到行列，树形视图浏览结构，路径查询取值。',
      keywords: 'json 格式化 压缩 校验 树形 jsonpath 数据'
    },
    {
      icon: '📊', route: '#/csv', title: 'CSV ⇄ JSON', category: 'text',
      desc: 'CSV 转 JSON、JSON 转 CSV，自动识别分隔符，可选表头与类型推断。',
      keywords: 'csv json 表格 转换 导出 数据'
    },
    {
      icon: '🔣', route: '#/encode', title: '编码转换', category: 'text',
      desc: 'Base64 / Base64URL / URL / Hex / HTML 实体互转，自动识别编码类型。',
      keywords: 'base64 url hex 编码 html 实体 urlencode 转义'
    },
    {
      icon: '🔍', route: '#/diff', title: '文本差异对比', category: 'text',
      desc: '逐行比较两段文本，标记新增 / 删除 / 修改，支持行内字符级高亮。',
      keywords: 'diff 对比 差异 比较 行内 字符 补丁 patch'
    },
    {
      icon: '🗜️', route: '#/image', title: '图片压缩', category: 'image',
      desc: '批量压缩，WebP / JPEG 输出，可指定目标体积与最大尺寸，自动调节画质。',
      keywords: '图片 压缩 webp jpeg 体积 画质 批量'
    },
    {
      icon: '🔄', route: '#/convert', title: '格式转换', category: 'image',
      desc: 'PNG 转 WebP、WebP 转 PNG、JPEG 互转，保留透明通道，转换前后对比。',
      keywords: '格式 转换 png webp jpeg 透明 互转'
    },
    {
      icon: '🎞️', route: '#/gif', title: 'GIF 制作', category: 'image',
      desc: '多张图片合成动画 GIF，可调帧延时、颜色数与尺寸压缩体积，支持拖拽排序。',
      keywords: 'gif 动图 合成 动画 帧 延时 排序'
    },
    {
      icon: '🧽', route: '#/watermark', title: '图片去水印', category: 'image',
      desc: '框选水印区域用周围像素重建，模糊 / 中位数 / 补片三种方式，本地处理。',
      keywords: '去水印 水印 修补 补片 修复 像素'
    },
    {
      icon: '🕒', route: '#/datetime', title: '时间格式化', category: 'dev',
      desc: '时间转 UTC、ISO 8601、RFC、Unix 时间戳，多时区对照与自定义格式串。',
      keywords: '时间 日期 时区 utc iso unix 时间戳 格式化'
    },
    {
      icon: '🎯', route: '#/regex', title: '正则测试台', category: 'dev',
      desc: '实时匹配并列出捕获组，把表达式拆成带解释的片段，生成示例文本。',
      keywords: '正则 regex 表达式 匹配 捕获组 测试'
    },
    {
      icon: '🔗', route: '#/url', title: 'URL 解析', category: 'dev',
      desc: '拆解 URL 各部分、列出查询参数并解码，也能反向拼装链接。',
      keywords: 'url 解析 参数 query 链接 域名 反向 生成'
    },
    {
      icon: '🎵', route: '#/audio', title: '音频格式转换', category: 'media',
      desc: 'MP3 / WAV / OGG / FLAC 互转，可重采样、改单双声道，本地解码重编码。',
      keywords: '音频 转换 mp3 wav ogg flac 格式 重采样 声道 采样率'
    },
    {
      icon: '🎨', route: '#/color', title: '颜色工具', category: 'design',
      desc: 'HEX / RGB / HSL / CMYK 互转，生成明度阶梯与和谐色板，WCAG 对比度检查。',
      keywords: '颜色 hex rgb hsl cmyk 色板 对比度 wcag 取色'
    },
    {
      icon: '🔐', route: '#/password', title: '密码生成器', category: 'design',
      desc: '用密码学随机源生成高强度密码，显示熵值与估算破解时间，可批量导出。',
      keywords: '密码 随机 强度 熵 暴力破解 安全 生成'
    }
  ];

  /** 分类 id → 分类信息 */
  const CATEGORY_MAP = {};
  CATEGORIES.forEach(function (c) { CATEGORY_MAP[c.id] = c; });

  /**
   * 关键词匹配（标题 / 描述 / 关键词 / 路由 / 分类名）
   * @returns {Array} 命中的工具，按匹配强度排序
   */
  function search(query) {
    const q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return TOOLS.slice();

    const scored = [];
    TOOLS.forEach(function (t) {
      const title = t.title.toLowerCase();
      const desc = t.desc.toLowerCase();
      const keywords = String(t.keywords || '').toLowerCase();
      const cat = (CATEGORY_MAP[t.category] || {}).name || '';

      let score = -1;
      if (title === q) score = 0;
      else if (title.indexOf(q) === 0) score = 1;
      else if (title.indexOf(q) !== -1) score = 2;
      else if (keywords.indexOf(q) !== -1) score = 3;
      else if (desc.indexOf(q) !== -1) score = 4;
      else if (cat.toLowerCase().indexOf(q) !== -1) score = 5;
      else if (t.route.toLowerCase().indexOf(q) !== -1) score = 6;
      if (score !== -1) scored.push({ tool: t, score: score });
    });

    scored.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return TOOLS.indexOf(a.tool) - TOOLS.indexOf(b.tool);
    });
    return scored.map(function (s) { return s.tool; });
  }

  /** 按分类分组（保持 CATEGORIES 的顺序） */
  function grouped(list) {
    const map = {};
    (list || TOOLS).forEach(function (t) {
      if (!map[t.category]) map[t.category] = [];
      map[t.category].push(t);
    });
    return CATEGORIES
      .filter(function (c) { return map[c.id] && map[c.id].length; })
      .map(function (c) { return { category: c, tools: map[c.id] }; });
  }

  global.ToolRegistry = {
    categories: CATEGORIES,
    categoryMap: CATEGORY_MAP,
    tools: TOOLS,
    search: search,
    grouped: grouped
  };
})(window);
