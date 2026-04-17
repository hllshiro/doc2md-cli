import {
  HEADING_MAP,
  RE_ZHENGWEN_OPEN,
  RE_ZHENGWEN_CLOSE,
  RE_HEADING_OPEN,
  RE_HEADING_CLOSE,
  RE_DATA_CUSTOM_STYLE_OPEN,
  RE_DATA_CUSTOM_STYLE_CLOSE,
  RE_CUSTOM_STYLE_OPEN,
  RE_CUSTOM_STYLE_CLOSE,
  RE_FIGURE_OPEN,
  RE_FIGURE_CLOSE,
  RE_TABLE_OPEN,
  RE_TABLE_CLOSE,
  RE_IMG_SRC,
  RE_CAPTION_TEXT,
  RE_IMG_CLOSE,
  RE_INLINE_DATA_CUSTOM_STYLE,
  RE_INLINE_CUSTOM_STYLE,
  RE_INLINE_DIV_CLOSE,
  ATTR_CLEANUP_PATTERNS,
  RE_MULTIPLE_BLANK_LINES,
} from './constants.js'
import { srcToAlt, extractImgTrailing, processLineContent } from './helpers.js'
import { State, type CleanContext, type WarnFn } from './types.js'

/**
 * 处理内容行的通用逻辑（用于 IN_ZHENGWEN, IN_DATA_CUSTOM_STYLE, IN_CUSTOM_STYLE 等状态）
 */
function handleContentLine(
  line: string,
  ctx: CleanContext,
  warn: WarnFn,
  currentState: State
): State {
  const result = processLineContent(line, warn)

  if (result.hasPartialImg) {
    ctx.imgLinePrefix = result.imgLinePrefix
    ctx.imgSrc = result.imgSrc
    ctx.imgLines = [result.imgRest]
    ctx.prevState = currentState
    return State.IN_IMG
  }

  ctx.out.push(result.processed)
  return currentState
}

/**
 * NORMAL 状态处理器
 */
function handleNormal(line: string, ctx: CleanContext, warn: WarnFn): State {
  // Rule 1: enter 正文段落 block
  if (RE_ZHENGWEN_OPEN.test(line)) {
    return State.IN_ZHENGWEN
  }

  // Rule 2: enter heading block
  const headingMatch = RE_HEADING_OPEN.exec(line)
  if (headingMatch) {
    const styleValue = headingMatch[2]
    const ordinal = styleValue[0]
    if (HEADING_MAP[ordinal] !== undefined) {
      ctx.headingLevel = HEADING_MAP[ordinal]
    } else {
      warn(`Unrecognised heading style: ${styleValue}`)
      ctx.headingLevel = ''
    }
    ctx.headingText = ''
    return State.IN_HEADING
  }

  // Rule 3: enter figure block
  if (RE_FIGURE_OPEN.test(line)) {
    ctx.figureSrc = ''
    ctx.figureCaption = ''
    ctx.figureLines = [line]
    return State.IN_FIGURE
  }

  // Rule 5: enter table block
  if (RE_TABLE_OPEN.test(line)) {
    ctx.tableLines = [line]
    return State.IN_TABLE
  }

  // Rule: enter data-custom-style div block
  if (RE_DATA_CUSTOM_STYLE_OPEN.test(line)) {
    return State.IN_DATA_CUSTOM_STYLE
  }

  // Rule: enter custom-style div block
  if (RE_CUSTOM_STYLE_OPEN.test(line)) {
    return State.IN_CUSTOM_STYLE
  }

  // Rule 4 / Rule 7: process content line
  const result = processLineContent(line, warn)
  if (result.hasPartialImg) {
    ctx.imgLinePrefix = result.imgLinePrefix
    ctx.imgSrc = result.imgSrc
    ctx.imgLines = [result.imgRest]
    ctx.prevState = State.NORMAL
    return State.IN_IMG
  }

  ctx.out.push(result.processed)
  return State.NORMAL
}

/**
 * IN_ZHENGWEN 状态处理器
 */
function handleZhengwen(line: string, ctx: CleanContext, warn: WarnFn): State {
  if (RE_ZHENGWEN_CLOSE.test(line)) {
    return State.NORMAL
  }
  return handleContentLine(line, ctx, warn, State.IN_ZHENGWEN)
}

/**
 * IN_HEADING 状态处理器
 */
function handleHeading(line: string, ctx: CleanContext, _warn: WarnFn): State {
  if (RE_HEADING_CLOSE.test(line)) {
    if (ctx.headingLevel) {
      ctx.out.push(`${ctx.headingLevel} ${ctx.headingText.trim()}`)
    } else {
      ctx.out.push(ctx.headingText.trim())
    }
    return State.NORMAL
  }

  if (line.trim() !== '') {
    ctx.headingText += (ctx.headingText ? ' ' : '') + line.trim()
  }
  return State.IN_HEADING
}

/**
 * IN_FIGURE 状态处理器
 */
function handleFigure(line: string, ctx: CleanContext, warn: WarnFn): State {
  ctx.figureLines.push(line)

  if (!ctx.figureSrc) {
    const srcMatch = RE_IMG_SRC.exec(line)
    if (srcMatch) ctx.figureSrc = srcMatch[1]
  }

  if (!ctx.figureCaption) {
    const captionMatch = RE_CAPTION_TEXT.exec(line)
    if (captionMatch) ctx.figureCaption = captionMatch[1]
  }

  if (RE_FIGURE_CLOSE.test(line)) {
    if (!ctx.figureSrc) {
      warn('Figure block contains no <img> tag — block removed')
    } else {
      ctx.out.push(`![${srcToAlt(ctx.figureSrc)}](${ctx.figureSrc})`)
    }
    return State.NORMAL
  }

  return State.IN_FIGURE
}

/**
 * IN_TABLE 状态处理器
 */
function handleTable(line: string, ctx: CleanContext, _warn: WarnFn): State {
  // 去除行内的 div 自定义样式标签
  line = line.replace(RE_INLINE_DATA_CUSTOM_STYLE, '')
  line = line.replace(RE_INLINE_CUSTOM_STYLE, '')
  line = line.replace(RE_INLINE_DIV_CLOSE, '')

  // 跳过 colgroup 块（从 <colgroup> 开始到 </colgroup> 结束）
  if (/^<colgroup\b/.test(line)) {
    ctx.prevState = State.IN_TABLE
    return State.IN_COLGROUP
  }

  ctx.tableLines.push(line)
  if (RE_TABLE_CLOSE.test(line)) {
    for (const tl of ctx.tableLines) ctx.out.push(tl)
    ctx.tableLines = []
    return State.NORMAL
  }
  return State.IN_TABLE
}

/**
 * IN_COLGROUP 状态处理器
 */
function handleColgroup(line: string, ctx: CleanContext, _warn: WarnFn): State {
  if (/^<\/colgroup>/.test(line)) {
    return ctx.prevState
  }
  return State.IN_COLGROUP
}

/**
 * IN_DATA_CUSTOM_STYLE 状态处理器
 */
function handleDataCustomStyle(line: string, ctx: CleanContext, warn: WarnFn): State {
  if (RE_DATA_CUSTOM_STYLE_CLOSE.test(line)) {
    return State.NORMAL
  }
  return handleContentLine(line, ctx, warn, State.IN_DATA_CUSTOM_STYLE)
}

/**
 * IN_CUSTOM_STYLE 状态处理器
 */
function handleCustomStyle(line: string, ctx: CleanContext, warn: WarnFn): State {
  if (RE_CUSTOM_STYLE_CLOSE.test(line)) {
    return State.NORMAL
  }
  return handleContentLine(line, ctx, warn, State.IN_CUSTOM_STYLE)
}

/**
 * IN_IMG 状态处理器
 */
function handleImg(line: string, ctx: CleanContext, warn: WarnFn): State {
  ctx.imgLines.push(line)

  if (!ctx.imgSrc) {
    const srcMatch = RE_IMG_SRC.exec(line)
    if (srcMatch) ctx.imgSrc = srcMatch[1]
  }

  if (RE_IMG_CLOSE.test(line)) {
    if (ctx.imgSrc) {
      const rawTrailing = extractImgTrailing(line)
      const imgMd = `![${srcToAlt(ctx.imgSrc)}](${ctx.imgSrc})`
      const builtPrefix = ctx.imgLinePrefix ? `${ctx.imgLinePrefix}${imgMd}` : imgMd

      ctx.imgLinePrefix = ''
      ctx.imgLines = []

      if (rawTrailing) {
        const processedTrailing = rawTrailing.replace(/<img\b[^>]*\/?>/g, (match) => {
          const srcMatch = RE_IMG_SRC.exec(match)
          if (srcMatch) {
            return `![${srcToAlt(srcMatch[1])}](${srcMatch[1]})`
          }
          warn('Inline <img> has no src — kept verbatim')
          return match
        })
        const partialIdx = processedTrailing.indexOf('<img')
        if (partialIdx !== -1) {
          const textBefore = processedTrailing.slice(0, partialIdx).trimEnd()
          ctx.imgLinePrefix = textBefore ? `${builtPrefix} ${textBefore}` : builtPrefix
          const rest = processedTrailing.slice(partialIdx)
          const srcMatch2 = RE_IMG_SRC.exec(rest)
          ctx.imgSrc = srcMatch2 ? srcMatch2[1] : ''
          ctx.imgLines = [rest]
          return State.IN_IMG
        } else {
          ctx.out.push(`${builtPrefix} ${processedTrailing}`)
          return ctx.prevState
        }
      } else {
        ctx.out.push(builtPrefix)
        return ctx.prevState
      }
    } else {
      warn('Multi-line <img> has no src — kept verbatim')
      if (ctx.imgLinePrefix) ctx.out.push(ctx.imgLinePrefix)
      for (const il of ctx.imgLines) ctx.out.push(il)
      ctx.imgLinePrefix = ''
      ctx.imgLines = []
      return ctx.prevState
    }
  }

  return State.IN_IMG
}

/**
 * 状态处理器映射表
 */
const stateHandlers: Record<State, (line: string, ctx: CleanContext, warn: WarnFn) => State> = {
  [State.NORMAL]: handleNormal,
  [State.IN_ZHENGWEN]: handleZhengwen,
  [State.IN_HEADING]: handleHeading,
  [State.IN_FIGURE]: handleFigure,
  [State.IN_TABLE]: handleTable,
  [State.IN_COLGROUP]: handleColgroup,
  [State.IN_DATA_CUSTOM_STYLE]: handleDataCustomStyle,
  [State.IN_CUSTOM_STYLE]: handleCustomStyle,
  [State.IN_IMG]: handleImg,
}

/**
 * 创建初始清理上下文
 */
export function createCleanContext(): CleanContext {
  return {
    out: [],
    state: State.NORMAL,
    headingLevel: '',
    headingText: '',
    figureSrc: '',
    figureCaption: '',
    figureLines: [],
    tableLines: [],
    imgSrc: '',
    imgLines: [],
    imgLinePrefix: '',
    prevState: State.NORMAL,
  }
}

/**
 * 处理文件末尾未闭合的块
 */
export function handleUnclosedBlocks(ctx: CleanContext, warn: WarnFn): void {
  if (ctx.state === State.IN_TABLE && ctx.tableLines.length > 0) {
    for (const tl of ctx.tableLines) ctx.out.push(tl)
  }
  if (ctx.state === State.IN_FIGURE && ctx.figureLines.length > 0) {
    if (!ctx.figureSrc) {
      warn('Figure block contains no <img> tag — block removed')
    } else {
      ctx.out.push(`![${srcToAlt(ctx.figureSrc)}](${ctx.figureSrc})`)
    }
  }
  if (ctx.state === State.IN_IMG && ctx.imgLines.length > 0) {
    if (ctx.imgSrc) {
      const imgMd = `![${srcToAlt(ctx.imgSrc)}](${ctx.imgSrc})`
      ctx.out.push(ctx.imgLinePrefix ? `${ctx.imgLinePrefix}${imgMd}` : imgMd)
    } else {
      warn('Unclosed multi-line <img> has no src — kept verbatim')
      if (ctx.imgLinePrefix) ctx.out.push(ctx.imgLinePrefix)
      for (const il of ctx.imgLines) ctx.out.push(il)
    }
  }
}

/**
 * 清理 Markdown 主函数
 */
export function cleanMarkdown(source: string, warn: WarnFn): string {
  const lines = source.split(/\r?\n/)
  const ctx = createCleanContext()

  for (const line of lines) {
    const handler = stateHandlers[ctx.state]
    ctx.state = handler(line, ctx, warn)
  }

  handleUnclosedBlocks(ctx, warn)

  let result = ctx.out.join('\n')

  // 最终清理：删除所有标签的 id、class、style、data-*、aria-* 属性
  for (const { pattern } of ATTR_CLEANUP_PATTERNS) {
    result = result.replace(pattern, '')
  }

  // 最最后：合并连续空行（最多保留一个空行）
  result = result.replace(RE_MULTIPLE_BLANK_LINES, '\n\n')

  return result
}
