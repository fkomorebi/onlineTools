/* ============================================
   MCP 工具注册表 —— 声明式定义所有对外暴露的工具
   ----------------------------------------------------------
   工具的输入 schema 直接描述给 AI 看，
   实现则指向 tools-text.js / tools-image.js 里的函数。
   ============================================ */
'use strict';

const text = require('./tools-text');
const image = require('./tools-image');

/**
 * 工具清单。
 * 每个条目：
 *   name        工具名（AI 看到的）
 *   title       简短标题
 *   description 用途说明 —— 写给 AI 看，要能判断"什么时候用这个"
 *   schema      JSON Schema（object）
 *   handler     实现 (args) => result
 */
const TOOLS = [
  /* ---------------- JSON ---------------- */
  {
    name: 'json_format',
    title: 'JSON 格式化 / 校验',
    description:
      '校验 JSON 是否合法并格式化输出，同时给出体积、键数量、数组数、最大深度等统计与类型分布。' +
      'JSON 非法时返回中文错误信息与出错行列位置。用于需要确认 JSON 结构或整理 JSON 文本时。',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '待处理的 JSON 文本' },
        indent: {
          type: 'number',
          description: '缩进空格数，0 表示不缩进。默认 2',
          default: 2
        }
      },
      required: ['text']
    },
    handler: text.jsonFormat
  },
  {
    name: 'json_query',
    title: 'JSON 路径取值',
    description:
      '按 JSONPath 风格的路径从 JSON 中取值，例如 $.a.b[0].c、$.user.roles[1]。' +
      '用于定位大 JSON 里的某个具体字段而不用肉眼翻找。',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'JSON 文本' },
        path: { type: 'string', description: '路径表达式，例如 $.a.b[0].c' }
      },
      required: ['text', 'path']
    },
    handler: text.jsonQuery
  },

  /* ---------------- CSV ---------------- */
  {
    name: 'csv_to_json',
    title: 'CSV 转 JSON',
    description:
      '把 CSV / TSV 文本转成 JSON。支持带引号字段、字段内换行、"" 转义双引号；' +
      '自动识别分隔符（逗号 / 制表符 / 分号 / 竖线）；可推断数字、布尔、null 类型。',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'CSV 文本' },
        delimiter: { type: 'string', description: '分隔符，如 "," 或 "\\t"。缺省自动探测' },
        header: { type: 'boolean', description: '首行是否为表头，默认 true' },
        typed: { type: 'boolean', description: '是否把数字 / 布尔 / null 转为对应类型，默认 false' },
        indent: { type: 'number', description: 'JSON 缩进，默认 2' }
      },
      required: ['text']
    },
    handler: text.csvToJson
  },
  {
    name: 'json_to_csv',
    title: 'JSON 转 CSV',
    description:
      '把对象数组的 JSON 转成 CSV。自动取所有对象的键并集作为列，缺省值留空；' +
      '含逗号 / 引号 / 换行的字段会自动加引号转义。',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'JSON 文本，顶层必须是数组' },
        delimiter: { type: 'string', description: '分隔符，默认 ","' },
        columns: { type: 'array', items: { type: 'string' }, description: '列顺序，缺省取键并集' },
        header: { type: 'boolean', description: '是否输出表头行，默认 true' },
        newline: { type: 'string', description: '行尾，\\n 或 \\r\\n，默认 \\n' }
      },
      required: ['text']
    },
    handler: text.jsonToCsv
  },

  /* ---------------- 编码 ---------------- */
  {
    name: 'encode',
    title: '编码转换',
    description:
      '把文本编码成 Base64 / Base64URL / URL 百分号 / URL(空格转+) / 十六进制 / HTML 实体。',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '待编码的文本' },
        type: {
          type: 'string',
          enum: ['base64', 'base64url', 'url', 'urlplus', 'hex', 'html'],
          description: '目标编码类型'
        }
      },
      required: ['text', 'type']
    },
    handler: text.encode
  },
  {
    name: 'decode',
    title: '解码转换',
    description:
      '把 Base64 / Base64URL / URL 百分号 / URL(空格转+) / 十六进制 / HTML 实体解码回文本。' +
      '若内容是二进制（非可打印字符为主），会标记 binary。',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '待解码的文本' },
        type: {
          type: 'string',
          enum: ['base64', 'base64url', 'url', 'urlplus', 'hex', 'html'],
          description: '源编码类型'
        }
      },
      required: ['text', 'type']
    },
    handler: text.decode
  },
  {
    name: 'detect_encoding',
    title: '识别编码类型',
    description:
      '自动判断一段文本是 Base64 / URL 编码 / HTML 实体 / 十六进制中的哪一种，并给出解码结果与置信度。',
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '待识别的文本' }
      },
      required: ['text']
    },
    handler: text.detectEncoding
  },

  /* ---------------- URL ---------------- */
  {
    name: 'url_parse',
    title: 'URL 解析',
    description:
      '把 URL 拆成协议、主机、端口、路径、查询串、锚点、认证信息，并列出每个查询参数的' +
      '原文与解码值。用于看懂一个陌生链接的结构。',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '待解析的 URL' }
      },
      required: ['url']
    },
    handler: text.urlParse
  },
  {
    name: 'url_build',
    title: 'URL 拼装',
    description: '按协议 / 主机 / 端口 / 路径 / 查询参数 / 锚点拼装出一个 URL。',
    schema: {
      type: 'object',
      properties: {
        scheme: { type: 'string', description: '协议，默认 https' },
        hostname: { type: 'string', description: '主机名' },
        port: { type: 'string', description: '端口' },
        path: { type: 'string', description: '路径' },
        hash: { type: 'string', description: '锚点（不含 #）' },
        params: {
          type: 'array',
          description: '查询参数，元素形如 {"key":"a","value":"1"}',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'string' }
            },
            required: ['key']
          }
        },
        encode: { type: 'boolean', description: '是否对参数做百分号编码，默认 true' }
      },
      required: ['hostname']
    },
    handler: text.urlBuild
  },

  /* ---------------- 时间 ---------------- */
  {
    name: 'datetime_convert',
    title: '时间格式化 / 时区换算',
    description:
      '把任意时间（ISO 字符串、"2026-11-24 15:45:04"、Unix 秒 / 毫秒时间戳）转换成' +
      'ISO 8601、RFC 7231、RFC 2822、Unix 时间戳等多种格式，并可指定目标 IANA 时区、' +
      '自定义格式串、以及多个时区的对照表。',
    schema: {
      type: 'object',
      properties: {
        time: { type: 'string', description: '待转换的时间' },
        timezone: { type: 'string', description: 'IANA 时区，如 Asia/Shanghai、UTC。默认 UTC' },
        pattern: {
          type: 'string',
          description: '自定义格式串，如 yyyy-MM-dd HH:mm:ss、EEE, dd MMM yyyy HH:mm:ss'
        },
        zones: {
          type: 'array',
          items: { type: 'string' },
          description: '需要对照的额外时区列表'
        }
      },
      required: ['time']
    },
    handler: text.datetimeConvert
  },
  {
    name: 'datetime_diff',
    title: '时间差计算',
    description: '计算两个时间之间相差多少年 / 天 / 小时 / 分钟 / 秒。',
    schema: {
      type: 'object',
      properties: {
        a: { type: 'string', description: '第一个时间' },
        b: { type: 'string', description: '第二个时间' }
      },
      required: ['a', 'b']
    },
    handler: text.datetimeDiff
  },

  /* ---------------- 差异对比 ---------------- */
  {
    name: 'diff_text',
    title: '文本差异对比',
    description:
      '逐行比较两段文本，输出新增 / 删除 / 修改的行与统计，可选忽略首尾空白，' +
      '并生成标准 Unified Diff（@@ -a,b +c,d @@ 格式）。',
    schema: {
      type: 'object',
      properties: {
        oldText: { type: 'string', description: '原文' },
        newText: { type: 'string', description: '新文' },
        ignoreWhitespace: { type: 'boolean', description: '是否忽略行首尾空白与空行，默认 false' },
        context: { type: 'number', description: 'Unified Diff 的上下文行数，默认 3' },
        unified: { type: 'boolean', description: '是否附带 Unified Diff，默认 true' }
      },
      required: ['oldText', 'newText']
    },
    handler: text.diffText
  },

  /* ---------------- 正则 ---------------- */
  {
    name: 'regex_test',
    title: '正则匹配测试',
    description:
      '用正则表达式匹配一段文本，列出所有匹配位置、匹配文本与捕获组，' +
      '同时给出表达式逐段拆解的说明。用于调试正则。',
    schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式，如 /\\d+/g' },
        flags: { type: 'string', description: '标志位，如 g、i、m、s' },
        text: { type: 'string', description: '待匹配的文本' },
        limit: { type: 'number', description: '最多返回多少个匹配，默认 100' }
      },
      required: ['pattern', 'text']
    },
    handler: text.regexTest
  },
  {
    name: 'regex_explain',
    title: '正则表达式解释',
    description: '把正则表达式拆成带中文说明的片段，帮助理解别人写的复杂正则。',
    schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式' },
        flags: { type: 'string', description: '标志位' }
      },
      required: ['pattern']
    },
    handler: text.regexExplain
  },

  /* ---------------- 颜色 ---------------- */
  {
    name: 'color_convert',
    title: '颜色格式互转',
    description:
      '在 HEX / RGB / HSL / CMYK 之间互转，支持 #rgb、#rrggbb、#rrggbbaa、rgb()、rgba()、hsl()、hsla() 输入。',
    schema: {
      type: 'object',
      properties: {
        color: { type: 'string', description: '颜色值，如 #ff8800 或 rgb(255,136,0)' }
      },
      required: ['color']
    },
    handler: text.colorConvert
  },
  {
    name: 'color_contrast',
    title: 'WCAG 对比度检查',
    description:
      '计算前景色与背景色的 WCAG 2.x 对比度，判断是否通过 AA / AAA（区分普通文字与大字）。' +
      '用于检查配色是否可读。',
    schema: {
      type: 'object',
      properties: {
        foreground: { type: 'string', description: '前景色（文字颜色）' },
        background: { type: 'string', description: '背景色' },
        textSize: { type: 'string', enum: ['normal', 'large'], description: '文字大小，默认 normal' }
      },
      required: ['foreground', 'background']
    },
    handler: text.colorContrast
  },
  {
    name: 'color_palette',
    title: '配色方案生成',
    description:
      '基于一个主色生成明度阶梯、类似色、互补色与三角配色，用于快速搭一套配色。',
    schema: {
      type: 'object',
      properties: {
        color: { type: 'string', description: '主色' },
        steps: { type: 'number', description: '明度阶梯的级数，默认 9' },
        spread: { type: 'number', description: '类似色的色相偏移角度，默认 30' }
      },
      required: ['color']
    },
    handler: text.colorPalette
  },

  /* ---------------- 密码 ---------------- */
  {
    name: 'password_generate',
    title: '密码生成',
    description:
      '用密码学随机源生成高强度密码，可控制长度、字符集、是否排除易混淆字符、是否每类必含，' +
      '并返回熵值、强度等级、估算破解时间与弱口令检测结果。可批量生成。',
    schema: {
      type: 'object',
      properties: {
        length: { type: 'number', description: '密码长度，默认 16' },
        count: { type: 'number', description: '生成数量，默认 1' },
        lower: { type: 'boolean', description: '是否包含小写字母，默认 true' },
        upper: { type: 'boolean', description: '是否包含大写字母，默认 true' },
        digits: { type: 'boolean', description: '是否包含数字，默认 true' },
        symbols: { type: 'boolean', description: '是否包含符号，默认 true' },
        excludeAmbiguous: { type: 'boolean', description: '是否排除易混淆字符（Il1O0 等），默认 false' },
        custom: { type: 'string', description: '自定义字符集；填写后取代内置符号集' },
        requireEach: { type: 'boolean', description: '是否保证每类字符至少各一个，默认 true' }
      }
    },
    handler: text.passwordGenerate
  },
  {
    name: 'password_check',
    title: '密码强度检查',
    description:
      '评估一个密码的熵值、强度等级、估算破解时间，并检测重复、连续序列、键盘序、常见弱口令等弱模式。',
    schema: {
      type: 'object',
      properties: {
        password: { type: 'string', description: '待检查的密码' }
      },
      required: ['password']
    },
    handler: text.passwordCheck
  },

  /* ---------------- 图片 ---------------- */
  {
    name: 'image_compress',
    title: '图片压缩',
    description:
      '压缩图片并输出 WebP / JPEG / PNG，可指定目标体积上限（自动二分调质）与最大宽高。' +
      '返回压缩前后体积与节省比例。输入为本地图片文件路径。',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '图片文件路径' },
        format: { type: 'string', enum: ['webp', 'jpeg', 'png'], description: '输出格式，默认 webp' },
        quality: { type: 'number', description: '画质 1-100，默认 80' },
        maxWidth: { type: 'number', description: '最大宽度，等比缩放' },
        maxHeight: { type: 'number', description: '最大高度，等比缩放' },
        targetBytes: { type: 'number', description: '目标体积上限（字节），超出则自动降质' },
        outputPath: { type: 'string', description: '输出文件路径，缺省写到临时目录' }
      },
      required: ['path']
    },
    handler: image.imageCompress
  },
  {
    name: 'image_convert',
    title: '图片格式转换',
    description:
      '转换图片格式（PNG / WebP / JPEG / AVIF），保留透明通道，返回体积对比。' +
      '输入为本地图片文件路径。',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '图片文件路径' },
        format: { type: 'string', enum: ['png', 'webp', 'jpeg', 'avif'], description: '目标格式' },
        quality: { type: 'number', description: '有损格式的画质 1-100，默认 90' },
        outputPath: { type: 'string', description: '输出文件路径' }
      },
      required: ['path', 'format']
    },
    handler: image.imageConvert
  },
  {
    name: 'image_gif',
    title: '多图合成 GIF',
    description:
      '把多张图片合成动画 GIF，可调帧延时、颜色数、输出尺寸、帧间差分与循环次数。' +
      '使用网站自研的 GIF89a 编码器，输出为纯字节流，无第三方依赖。' +
      '输入为本地图片文件路径列表（按播放顺序）。',
    schema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '图片文件路径列表（按播放顺序）' },
        delay: { type: 'number', description: '每帧延时（毫秒），默认 100' },
        colors: { type: 'number', description: '调色板颜色数 2-256，默认 256' },
        width: { type: 'number', description: '输出宽度，默认原始宽度' },
        height: { type: 'number', description: '输出高度，默认原始高度' },
        loop: { type: 'number', description: '循环次数，0 表示无限，默认 0' },
        diffFrames: { type: 'boolean', description: '是否启用帧间差分压缩，默认 true' },
        outputPath: { type: 'string', description: '输出的 GIF 文件路径' }
      },
      required: ['paths']
    },
    handler: image.imageGif
  },
  {
    name: 'image_watermark',
    title: '图片去水印',
    description:
      '用周围像素重建指定的矩形区域，抹掉水印。支持 smart（自动补片，多分辨率 patch match）、' +
      'inpaint（边界扩散）、blur（邻域均值）、median（中位数）、patch（手动补片搬运）五种方式。' +
      '输入为文件路径与区域坐标，返回被改写的像素数与处理方式。',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '图片文件路径' },
        x: { type: 'number', description: '水印区域左上角 x' },
        y: { type: 'number', description: '水印区域左上角 y' },
        width: { type: 'number', description: '水印区域宽度' },
        height: { type: 'number', description: '水印区域高度' },
        method: {
          type: 'string',
          enum: ['smart', 'inpaint', 'blur', 'median', 'patch'],
          description: '修补方式，默认 smart（自动补片）'
        },
        radius: { type: 'number', description: '采样半径，blur / median / inpaint 模式使用' },
        offsetX: { type: 'number', description: '手动补片的水平取样偏移，patch 模式使用' },
        offsetY: { type: 'number', description: '手动补片的垂直取样偏移，patch 模式使用' },
        patchX: { type: 'number', description: '取样区域的左上角 x，patch 模式使用' },
        patchY: { type: 'number', description: '取样区域的左上角 y，patch 模式使用' },
        outputPath: { type: 'string', description: '输出文件路径' }
      },
      required: ['path', 'x', 'y', 'width', 'height']
    },
    handler: image.imageWatermark
  }
];

module.exports = { TOOLS };
