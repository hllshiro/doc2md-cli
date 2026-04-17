/**
 * Markdown 清理模块
 *
 * 将 Pandoc 生成的 Markdown 中的 HTML 标记转换为纯 Markdown 格式
 */

// 导出主要功能
export { cleanMarkdown } from './stateMachine.js'
export { mdCleanupTask } from './task.js'

// 导出常量（供外部使用）
export { HEADING_MAP } from './constants.js'

// 导出类型
export { State, type CleanContext, type WarnFn } from './types.js'
