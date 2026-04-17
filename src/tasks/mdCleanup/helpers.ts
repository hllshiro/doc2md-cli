import { RE_IMG_SRC } from './constants.js'
import type { WarnFn } from './types.js'

/**
 * 去除行首的块引用标记
 */
export function stripBlockquote(line: string): string {
  return line.replace(/^(>\s*)+/, '')
}

/**
 * 从图片路径生成 alt 文本
 */
export function srcToAlt(src: string): string {
  const name = src.split('/').pop() ?? src
  return name.replace(/\.[^.]+$/, '')
}

/**
 * 返回 img 标签关闭符（/> 或 >）之后的尾随文本（已 trim）
 */
export function extractImgTrailing(line: string): string {
  const idx = line.indexOf('/>')
  if (idx !== -1) return line.slice(idx + 2).trim()
  const idx2 = line.indexOf('>')
  if (idx2 !== -1) return line.slice(idx2 + 1).trim()
  return ''
}

/**
 * 将行内所有完整的单行 <img .../> 或 <img ...> 替换为 Markdown 语法
 * 仅处理单行（调用方逐行传入），不跨行匹配
 */
export function replaceCompleteImgs(line: string, warn: WarnFn): string {
  return line.replace(/<img\b[^>]*\/?>/g, (match) => {
    const srcMatch = RE_IMG_SRC.exec(match)
    if (srcMatch) {
      return `![${srcToAlt(srcMatch[1])}](${srcMatch[1]})`
    }
    warn('Inline <img> has no src — kept verbatim')
    return match
  })
}

/**
 * 处理行内内容：去除块引用 → 替换完整 img 标签 → 检测未闭合 img
 * 返回处理后的行和可能的 img 状态信息
 */
export interface ProcessLineResult {
  processed: string
  hasPartialImg: boolean
  imgLinePrefix: string
  imgSrc: string
  imgRest: string
}

export function processLineContent(line: string, warn: WarnFn): ProcessLineResult {
  const processed = replaceCompleteImgs(stripBlockquote(line), warn)
  const partialIdx = processed.indexOf('<img')

  if (partialIdx !== -1) {
    const imgLinePrefix = processed.slice(0, partialIdx)
    const rest = processed.slice(partialIdx)
    const srcMatch = RE_IMG_SRC.exec(rest)
    return {
      processed,
      hasPartialImg: true,
      imgLinePrefix,
      imgSrc: srcMatch ? srcMatch[1] : '',
      imgRest: rest,
    }
  }

  return {
    processed,
    hasPartialImg: false,
    imgLinePrefix: '',
    imgSrc: '',
    imgRest: '',
  }
}
