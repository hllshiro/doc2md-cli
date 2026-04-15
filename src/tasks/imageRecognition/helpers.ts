import { access } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { logger } from '../../logger.js'
import { RE_MD_IMAGE } from './constants.js'
import type { ImageMatch, RecognitionResult } from './types.js'

export function getMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'image/jpeg'
  }
}

export async function resolveImagePath(
  src: string,
  mdDir: string,
  mediaPath: string
): Promise<string | undefined> {
  // Try relative to markdown file first
  const relPath = resolve(mdDir, src)
  if (
    await access(relPath)
      .then(() => true)
      .catch(() => false)
  ) {
    return relPath
  }
  // Fallback: try in media directory
  const mediaFilePath = join(mediaPath, basename(src))
  if (
    await access(mediaFilePath)
      .then(() => true)
      .catch(() => false)
  ) {
    return mediaFilePath
  }
  return undefined
}

export function collectImageMatches(lines: string[]): ImageMatch[] {
  const matches: ImageMatch[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m: RegExpExecArray | null
    RE_MD_IMAGE.lastIndex = 0
    while ((m = RE_MD_IMAGE.exec(line)) !== null) {
      const fullMatch = m[0]
      const remainder = line.replace(fullMatch, '').trim()
      matches.push({
        fullMatch,
        alt: m[1],
        src: m[2],
        lineIndex: i,
        isBlock: remainder === '',
      })
    }
  }
  return matches
}

export function formatTimeDisplay(elapsedSeconds: number, timeoutSeconds: number): string {
  if (timeoutSeconds > 0) {
    return `(${elapsedSeconds}s/${timeoutSeconds}s)`
  }
  return `(${elapsedSeconds}s)`
}

export function buildReplacement(
  match: ImageMatch,
  result: RecognitionResult,
  imgName: string
): string {
  const { contentType, content } = result

  switch (contentType) {
    case 'ascii':
      // ASCII 字符直接替换，无需包裹
      logger.debug(`ASCII替换 (${imgName}): ${content}`, '识别并替换图片内容')
      return content

    case 'latex': {
      // LaTeX 公式：AI 识别内容，代码根据上下文（图片位置）决定包裹方式
      // match.isBlock 表示图片是否独占一行（无其他文本内容）
      if (match.isBlock) {
        // 块级：图片独占一行，使用 $$ 包裹，独立成行
        logger.debug(`LaTeX块级替换 (${imgName}): $$${content}$$`, '识别并替换图片内容')
        return `$$\n${content}\n$$`
      } else {
        // 行内：图片与其他文本同行，使用 $ 包裹
        logger.debug(`LaTeX行内替换 (${imgName}): $${content}$`, '识别并替换图片内容')
        return `$${content}$`
      }
    }

    case 'description':
      // 描述文本直接返回
      logger.debug(`描述替换 (${imgName}): ${content.substring(0, 50)}...`, '识别并替换图片内容')
      return content

    default:
      // 兜底处理，直接返回内容
      logger.warn(`未知的 contentType: ${contentType}，直接返回内容`, '识别并替换图片内容')
      return content
  }
}
