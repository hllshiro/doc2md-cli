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
  if (result.isFormula) {
    const replacement = match.isBlock ? `$$\n${result.content}\n$$` : `$${result.content}$`
    logger.debug(`公式替换 (${imgName}): ${replacement.substring(0, 50)}...`, '识别并替换图片内容')
    return replacement
  }
  logger.debug(`描述替换 (${imgName}): ${result.content.substring(0, 50)}...`, '识别并替换图片内容')
  return result.content
}
