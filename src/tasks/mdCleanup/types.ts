/**
 * 状态机状态枚举
 */
export const enum State {
  NORMAL,
  IN_ZHENGWEN,
  IN_HEADING,
  IN_FIGURE,
  IN_TABLE,
  IN_COLGROUP,
  IN_IMG,
  IN_DATA_CUSTOM_STYLE,
  IN_CUSTOM_STYLE,
}

/**
 * 清理上下文，用于在状态间传递数据
 */
export interface CleanContext {
  out: string[]
  state: State

  // Heading block accumulator
  headingLevel: string
  headingText: string

  // Figure block accumulator
  figureSrc: string
  figureCaption: string
  figureLines: string[]

  // Table block accumulator
  tableLines: string[]

  // Img block accumulator (for multi-line <img> tags)
  imgSrc: string
  imgLines: string[]
  imgLinePrefix: string
  prevState: State
}

/**
 * 警告回调函数类型
 */
export type WarnFn = (msg: string) => void

/**
 * 处理器函数类型
 */
export type StateHandler = (line: string, ctx: CleanContext, warn: WarnFn) => State
