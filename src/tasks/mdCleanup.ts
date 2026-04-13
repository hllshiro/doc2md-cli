import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'

// State machine states
const enum State {
  NORMAL,
  IN_ZHENGWEN,
  IN_HEADING,
  IN_FIGURE,
  IN_TABLE,
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

        // Rule 4 / Rule 7: pass through verbatim
        out.push(line)
        break
      }

      // ── IN_ZHENGWEN ─────────────────────────────────────────────────────
      case State.IN_ZHENGWEN: {
        if (RE_ZHENGWEN_CLOSE.test(line)) {
          // Drop the closing </div> tag, return to NORMAL
          state = State.NORMAL
          break
        }
        // Preserve inner content verbatim
        out.push(line)
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
            out.push(`![${figureCaption}](${figureSrc})`)
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
      out.push(`![${figureCaption}](${figureSrc})`)
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

      let source: string
      try {
        source = await readFile(srcPath, 'utf-8')
      } catch (err) {
        return reject(new Error(`无法读取源文件 ${srcPath}: ${err instanceof Error ? err.message : String(err)}`))
      }

      try {
        task.output = '创建输出目录'
        await mkdir(outdir, { recursive: true })

        task.output = '清理 Markdown'
        const cleaned = cleanMarkdown(source, (msg) => { task.output = `警告: ${msg}` })

        task.output = `写出 ${outPath}`
        await writeFile(outPath, cleaned, 'utf-8')

        ctx.lastContext = {
          outFilename,
          outputPath: outPath,
          mediaPath: srcMedia,
        }
        resolve()
      } catch (err) {
        reject(err)
      }
    }),
}
