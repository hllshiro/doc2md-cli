import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'
import { saveOutputContext } from '../context.js'
import { logger } from '../logger.js'

// State machine states
const enum State {
  NORMAL,
  IN_ZHENGWEN,
  IN_HEADING,
  IN_FIGURE,
  IN_TABLE,
  IN_IMG,
}

// Heading level map: Chinese ordinal → ATX prefix
export const HEADING_MAP: Record<string, string> = {
  一: '#',
  二: '##',
  三: '###',
  四: '####',
  五: '#####',
  六: '######',
}

// Helper functions
function stripBlockquote(line: string): string {
  return line.replace(/^(>\s*)+/, '')
}

function srcToAlt(src: string): string {
  const name = src.split('/').pop() ?? src
  return name.replace(/\.[^.]+$/, '')
}

/** 返回 img 标签关闭符（\/>  或  >）之后的尾随文本（已 trim）。*/
function extractImgTrailing(line: string): string {
  const idx = line.indexOf('/>')
  if (idx !== -1) return line.slice(idx + 2).trim()
  const idx2 = line.indexOf('>')
  if (idx2 !== -1) return line.slice(idx2 + 1).trim()
  return ''
}

/**
 * 将行内所有完整的单行 <img .../> 或 <img ...> 替换为 Markdown 语法。
 * 仅处理单行（调用方逐行传入），不跨行匹配。
 */
function replaceCompleteImgs(line: string, warn: (msg: string) => void): string {
  return line.replace(/<img\b[^>]*\/?>/g, (match) => {
    const srcMatch = RE_IMG_SRC.exec(match)
    if (srcMatch) {
      return `![${srcToAlt(srcMatch[1])}](${srcMatch[1]})`
    }
    warn('Inline <img> has no src — kept verbatim')
    return match
  })
}

// Regex patterns
const RE_ZHENGWEN_OPEN = /^<div custom-style="正文段落">$/
const RE_ZHENGWEN_CLOSE = /^<\/div>$/
const RE_HEADING_OPEN = /^(\s*\d+\.\s+)<div custom-style="([一二三四五六]级标题)">$/
const RE_HEADING_CLOSE = /^\s*<\/div>$/
const RE_FIGURE_OPEN = /^<figure\b/
const RE_FIGURE_CLOSE = /^<\/figure>$/
const RE_TABLE_OPEN = /^<table\b/
const RE_TABLE_CLOSE = /^<\/table>$/
const RE_IMG_SRC = /src="([^"]+)"/
const RE_CAPTION_TEXT = /<p>([^<]*)<\/p>/
const RE_IMG_CLOSE = /\/?>/ // 不锚定行尾，允许标签后有尾随文本

/**
 * Cleans pandoc-generated Markdown by removing/transforming HTML artifacts.
 * Pure function — no I/O.
 */
export function cleanMarkdown(source: string, warn: (msg: string) => void): string {
  const lines = source.split(/\r?\n/)
  const out: string[] = []

  let state: State = State.NORMAL

  // Heading block accumulator
  let headingLevel = ''
  let headingText = ''

  // Figure block accumulator
  let figureSrc = ''
  let figureCaption = ''
  let figureLines: string[] = []

  // Table block accumulator
  let tableLines: string[] = []

  // Img block accumulator (for multi-line <img> tags)
  let imgSrc = ''
  let imgLines: string[] = []
  let imgLinePrefix = '' // 开始行中 <img 之前的文本
  let prevState: State = State.NORMAL // IN_IMG 结束后恢复的状态

  for (const line of lines) {
    switch (state) {
      // ── NORMAL ──────────────────────────────────────────────────────────
      case State.NORMAL: {
        if (RE_ZHENGWEN_OPEN.test(line)) {
          // Rule 1: enter 正文段落 block — drop the opening tag
          state = State.IN_ZHENGWEN
          break
        }

        const headingMatch = RE_HEADING_OPEN.exec(line)
        if (headingMatch) {
          // Rule 2: enter heading block
          const styleValue = headingMatch[2] // e.g. "二级标题"
          const ordinal = styleValue[0] // e.g. "二"
          if (HEADING_MAP[ordinal] !== undefined) {
            headingLevel = HEADING_MAP[ordinal]
          } else {
            warn(`Unrecognised heading style: ${styleValue}`)
            headingLevel = ''
          }
          headingText = ''
          state = State.IN_HEADING
          break
        }

        if (RE_FIGURE_OPEN.test(line)) {
          // Rule 3: enter figure block
          figureSrc = ''
          figureCaption = ''
          figureLines = [line]
          state = State.IN_FIGURE
          break
        }

        if (RE_TABLE_OPEN.test(line)) {
          // Rule 5: enter table block
          tableLines = [line]
          state = State.IN_TABLE
          break
        }

        // Rule 4 / Rule 7: strip blockquote → replace complete inline <img> → detect partial multi-line <img>
        {
          const processed = replaceCompleteImgs(stripBlockquote(line), warn)
          const partialIdx = processed.indexOf('<img')
          if (partialIdx !== -1) {
            // 行内有未闭合的 <img，保存前缀并进入 IN_IMG
            imgLinePrefix = processed.slice(0, partialIdx)
            const rest = processed.slice(partialIdx)
            const srcMatch = RE_IMG_SRC.exec(rest)
            imgSrc = srcMatch ? srcMatch[1] : ''
            imgLines = [rest]
            prevState = State.NORMAL
            state = State.IN_IMG
          } else {
            out.push(processed)
          }
        }
        break
      }

      // ── IN_ZHENGWEN ─────────────────────────────────────────────────────
      case State.IN_ZHENGWEN: {
        if (RE_ZHENGWEN_CLOSE.test(line)) {
          // Drop the closing </div> tag, return to NORMAL
          state = State.NORMAL
          break
        }
        // Preserve inner content: strip blockquote → replace complete inline <img> → detect partial multi-line <img>
        {
          const processed = replaceCompleteImgs(stripBlockquote(line), warn)
          const partialIdx = processed.indexOf('<img')
          if (partialIdx !== -1) {
            imgLinePrefix = processed.slice(0, partialIdx)
            const rest = processed.slice(partialIdx)
            const srcMatch = RE_IMG_SRC.exec(rest)
            imgSrc = srcMatch ? srcMatch[1] : ''
            imgLines = [rest]
            prevState = State.IN_ZHENGWEN
            state = State.IN_IMG
          } else {
            out.push(processed)
          }
        }
        break
      }

      // ── IN_HEADING ──────────────────────────────────────────────────────
      case State.IN_HEADING: {
        if (RE_HEADING_CLOSE.test(line)) {
          // Emit the ATX heading (or original block if unknown level)
          if (headingLevel) {
            out.push(`${headingLevel} ${headingText.trim()}`)
          } else {
            // Unknown ordinal — emit warning already done; pass through as-is
            // We can't reconstruct the original opening line perfectly, so just
            // emit the text we collected
            out.push(headingText.trim())
          }
          state = State.NORMAL
          break
        }
        // Accumulate heading text (skip blank lines inside the block)
        if (line.trim() !== '') {
          headingText += (headingText ? ' ' : '') + line.trim()
        }
        break
      }

      // ── IN_FIGURE ───────────────────────────────────────────────────────
      case State.IN_FIGURE: {
        figureLines.push(line)

        // Extract src if not yet found
        if (!figureSrc) {
          const srcMatch = RE_IMG_SRC.exec(line)
          if (srcMatch) figureSrc = srcMatch[1]
        }

        // Extract caption text if not yet found
        if (!figureCaption) {
          const captionMatch = RE_CAPTION_TEXT.exec(line)
          if (captionMatch) figureCaption = captionMatch[1]
        }

        if (RE_FIGURE_CLOSE.test(line)) {
          if (!figureSrc) {
            warn('Figure block contains no <img> tag — block removed')
          } else {
            out.push(`![${srcToAlt(figureSrc)}](${figureSrc})`)
          }
          state = State.NORMAL
        }
        break
      }

      // ── IN_TABLE ────────────────────────────────────────────────────────
      case State.IN_TABLE: {
        tableLines.push(line)
        if (RE_TABLE_CLOSE.test(line)) {
          // Rule 5: emit table verbatim
          for (const tl of tableLines) out.push(tl)
          tableLines = []
          state = State.NORMAL
        }
        break
      }

      // ── IN_IMG ──────────────────────────────────────────────────────────
      case State.IN_IMG: {
        imgLines.push(line)

        // Extract src if not yet found
        if (!imgSrc) {
          const srcMatch = RE_IMG_SRC.exec(line)
          if (srcMatch) imgSrc = srcMatch[1]
        }

        if (RE_IMG_CLOSE.test(line)) {
          // Tag closed
          if (imgSrc) {
            const rawTrailing = extractImgTrailing(line)
            const imgMd = `![${srcToAlt(imgSrc)}](${imgSrc})`
            const builtPrefix = imgLinePrefix ? `${imgLinePrefix}${imgMd}` : imgMd
            // 先清空当前 img 状态
            imgLinePrefix = ''
            imgLines = []
            if (rawTrailing) {
              // trailing 内替换所有完整 img，再检测是否存在新的跨行 img
              const processedTrailing = replaceCompleteImgs(rawTrailing, warn)
              const partialIdx = processedTrailing.indexOf('<img')
              if (partialIdx !== -1) {
                // trailing 中有未闭合的 img，将已构建的输出吸收进新前缀，继续留在 IN_IMG
                const textBefore = processedTrailing.slice(0, partialIdx).trimEnd()
                imgLinePrefix = textBefore ? `${builtPrefix} ${textBefore}` : builtPrefix
                const rest = processedTrailing.slice(partialIdx)
                const srcMatch2 = RE_IMG_SRC.exec(rest)
                imgSrc = srcMatch2 ? srcMatch2[1] : ''
                imgLines = [rest]
                // 保持 IN_IMG 状态，prevState 不变
              } else {
                out.push(`${builtPrefix} ${processedTrailing}`)
                state = prevState
              }
            } else {
              out.push(builtPrefix)
              state = prevState
            }
          } else {
            warn('Multi-line <img> has no src — kept verbatim')
            if (imgLinePrefix) out.push(imgLinePrefix)
            for (const il of imgLines) out.push(il)
            imgLinePrefix = ''
            imgLines = []
            state = prevState
          }
        }
        break
      }
    }
  }

  // Handle unclosed blocks at EOF — emit verbatim to avoid data loss
  if (state === State.IN_TABLE && tableLines.length > 0) {
    for (const tl of tableLines) out.push(tl)
  }
  if (state === State.IN_FIGURE && figureLines.length > 0) {
    if (!figureSrc) {
      warn('Figure block contains no <img> tag — block removed')
    } else {
      out.push(`![${srcToAlt(figureSrc)}](${figureSrc})`)
    }
  }
  if (state === State.IN_IMG && imgLines.length > 0) {
    if (imgSrc) {
      const imgMd = `![${srcToAlt(imgSrc)}](${imgSrc})`
      out.push(imgLinePrefix ? `${imgLinePrefix}${imgMd}` : imgMd)
    } else {
      warn('Unclosed multi-line <img> has no src — kept verbatim')
      if (imgLinePrefix) out.push(imgLinePrefix)
      for (const il of imgLines) out.push(il)
    }
  }

  return out.join('\n')
}

const layer = 'mdCleanup'

export const mdCleanupTask: ListrTask<AppContext> = {
  title: '清理 Markdown HTML 标记',
  task: (ctx, task) =>
    new Promise<void>(async (resolve, reject) => {
      const { outFilename, outputPath: srcPath, mediaPath: srcMedia } = ctx.lastContext!
      const outdir = join(ctx.outputPath, layer)
      const outPath = join(outdir, outFilename)

      logger.info(`开始清理 Markdown: ${outFilename}`, '清理 Markdown HTML 标记')

      let source: string
      try {
        source = await readFile(srcPath, 'utf-8')
        logger.debug(`读取源文件成功，长度: ${source.length} 字符`, '清理 Markdown HTML 标记')
      } catch (err) {
        logger.error(
          `无法读取源文件 ${srcPath}: ${err instanceof Error ? err.message : String(err)}`,
          '清理 Markdown HTML 标记'
        )
        return reject(
          new Error(
            `无法读取源文件 ${srcPath}: ${err instanceof Error ? err.message : String(err)}`
          )
        )
      }

      try {
        task.output = '创建输出目录'
        await mkdir(outdir, { recursive: true })
        logger.debug(`输出目录已创建: ${outdir}`, '清理 Markdown HTML 标记')

        task.output = '清理 Markdown'
        let warningCount = 0
        const cleaned = cleanMarkdown(source, (msg) => {
          warningCount++
          task.output = `警告: ${msg}`
          logger.warn(`清理警告: ${msg}`, '清理 Markdown HTML 标记')
        })
        logger.info(`Markdown 清理完成，发现 ${warningCount} 个警告`, '清理 Markdown HTML 标记')
        logger.debug(`清理后内容长度: ${cleaned.length} 字符`, '清理 Markdown HTML 标记')

        task.output = `写出 ${outPath}`
        await writeFile(outPath, cleaned, 'utf-8')
        logger.info(`已写出清理后的文件: ${outPath}`, '清理 Markdown HTML 标记')

        ctx.lastContext = {
          outFilename,
          outputPath: outPath,
          mediaPath: srcMedia,
        }
        await saveOutputContext(ctx.outputPath, 'mdCleanup', ctx.lastContext)
        resolve()
      } catch (err) {
        logger.error(
          `清理过程出错: ${err instanceof Error ? err.message : String(err)}`,
          '清理 Markdown HTML 标记'
        )
        reject(err)
      }
    }),
}
