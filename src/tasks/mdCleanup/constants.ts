/**
 * 标题级别映射：中文序号 → ATX 前缀
 */
export const HEADING_MAP: Record<string, string> = {
  一: '#',
  二: '##',
  三: '###',
  四: '####',
  五: '#####',
  六: '######',
}

// Regex patterns
export const RE_ZHENGWEN_OPEN = /^<div custom-style="正文段落">$/
export const RE_ZHENGWEN_CLOSE = /^<\/div>$/
export const RE_HEADING_OPEN = /^(\s*\d+\.\s+)<div custom-style="([一二三四五六]级标题)">$/
export const RE_HEADING_CLOSE = /^\s*<\/div>$/
// 已废弃：行级别的 div 标签匹配（无法处理跨行情况）
// 现在使用全局正则替换处理，见 RE_DIV_DATA_CUSTOM_STYLE_BLOCK 和 RE_DIV_CUSTOM_STYLE_BLOCK
export const RE_DATA_CUSTOM_STYLE_OPEN = /^<div\s+data-custom-style="[^"]*">$/
export const RE_DATA_CUSTOM_STYLE_CLOSE = /^<\/div>$/
export const RE_CUSTOM_STYLE_OPEN = /^<div\s+custom-style="[^"]*">$/
export const RE_CUSTOM_STYLE_CLOSE = /^<\/div>$/
// 行内 div 标签的正则（用于 IN_TABLE 状态）
export const RE_INLINE_DATA_CUSTOM_STYLE = /<div\s+data-custom-style="[^"]*">/g
export const RE_INLINE_CUSTOM_STYLE = /<div\s+custom-style="[^"]*">/g
export const RE_INLINE_DIV_CLOSE = /<\/div>/g

// 全局 div 自定义样式标签块匹配（支持跨行、非行首）
// 匹配 <div data-custom-style="...">...</div> 整个块
export const RE_DIV_DATA_CUSTOM_STYLE_BLOCK = /<div\s+data-custom-style="[^"]*">[\s\S]*?<\/div>/g
// 匹配 <div custom-style="...">...</div> 整个块
export const RE_DIV_CUSTOM_STYLE_BLOCK = /<div\s+custom-style="[^"]*">[\s\S]*?<\/div>/g

export const RE_FIGURE_OPEN = /^<figure\b/
export const RE_FIGURE_CLOSE = /^<\/figure>$/
export const RE_TABLE_OPEN = /^<table\b/
export const RE_TABLE_CLOSE = /^<\/table>$/
export const RE_IMG_SRC = /src="([^"]+)"/
export const RE_CAPTION_TEXT = /<p>([^<]*)<\/p>/
export const RE_IMG_CLOSE = /\/?>/ // 不锚定行尾，允许标签后有尾随文本

// 最终清理：删除所有标签的 id、class、style、data-*、aria-* 属性
export const ATTR_CLEANUP_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'id', pattern: /\s+id="[^"]*"/g },
  { name: 'class', pattern: /\s+class="[^"]*"/g },
  { name: 'style', pattern: /\s+style="[^"]*"/g },
  { name: 'data', pattern: /\s+data-[a-zA-Z0-9-]+="[^"]*"/g },
  { name: 'aria', pattern: /\s+aria-[a-zA-Z0-9-]+="[^"]*"/g },
]

// 空行合并：将连续多个空行合并为单个空行
export const RE_MULTIPLE_BLANK_LINES = /\n{3,}/g
