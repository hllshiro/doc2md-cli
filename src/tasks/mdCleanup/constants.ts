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
export const RE_DATA_CUSTOM_STYLE_OPEN = /^<div\s+data-custom-style="[^"]*">$/
export const RE_DATA_CUSTOM_STYLE_CLOSE = /^<\/div>$/
export const RE_CUSTOM_STYLE_OPEN = /^<div\s+custom-style="[^"]*">$/
export const RE_CUSTOM_STYLE_CLOSE = /^<\/div>$/
// 行内 div 标签的正则（用于 IN_TABLE 状态）
export const RE_INLINE_DATA_CUSTOM_STYLE = /<div\s+data-custom-style="[^"]*">/g
export const RE_INLINE_CUSTOM_STYLE = /<div\s+custom-style="[^"]*">/g
export const RE_INLINE_DIV_CLOSE = /<\/div>/g

export const RE_FIGURE_OPEN = /^<figure\b/
export const RE_FIGURE_CLOSE = /^<\/figure>$/
export const RE_TABLE_OPEN = /^<table\b/
export const RE_TABLE_CLOSE = /^<\/table>$/
export const RE_IMG_SRC = /src="([^"]+)"/
export const RE_CAPTION_TEXT = /<p>([^<]*)<\/p>/
export const RE_IMG_CLOSE = /\/?>/ // 不锚定行尾，允许标签后有尾随文本
