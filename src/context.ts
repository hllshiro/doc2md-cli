import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export interface OutputContext {
  outFilename: string
  outputPath: string
  mediaPath: string
}

export interface AppContext {
  /** 用户输入的 .docx 文件绝对路径 */
  inputPath: string
  /** 总输出目录，与输入在同一级目录下的out目录 */
  outputPath: string
  /** 解析后的 pandoc 可执行文件路径 */
  pandocExec: string
  /** lastContext 上下文 */
  lastContext?: OutputContext
  /** 恢复起始任务索引，undefined 表示从头开始 */
  startFrom?: number
}

export function createContext(): AppContext {
  return { inputPath: '', outputPath: '', pandocExec: 'pandoc' }
}

/** 恢复点映射：value=任务索引, previousLayer=需要加载上下文的前置 layer */
export const RESUME_POINTS = [
  { value: 3, name: '从「渲染矢量图并更新 Markdown 路径」开始', previousLayer: 'docxConvert' },
  { value: 4, name: '从「清理 Markdown HTML 标记」开始', previousLayer: 'mediaConvert' },
  { value: 5, name: '从「AI 图片识别与替换」开始', previousLayer: 'mdCleanup' },
] as const

/** 将 OutputContext 持久化到 {outputPath}/{layer}/context.json */
export async function saveOutputContext(
  outputPath: string,
  layer: string,
  context: OutputContext
): Promise<void> {
  try {
    await writeFile(
      join(outputPath, layer, 'context.json'),
      JSON.stringify(context, null, 2),
      'utf-8'
    )
  } catch {
    // 写入失败不阻塞主流程
  }
}

/** 从 {outputPath}/{layer}/context.json 加载 OutputContext */
export async function loadOutputContext(
  outputPath: string,
  layer: string
): Promise<OutputContext | null> {
  try {
    const raw = await readFile(join(outputPath, layer, 'context.json'), 'utf-8')
    return JSON.parse(raw) as OutputContext
  } catch {
    return null
  }
}

/** 当 context.json 不存在时，从目录结构推导 OutputContext */
export function rebuildOutputContext(
  outputPath: string,
  layer: string,
  inputPath: string
): OutputContext {
  const outFilename = basename(inputPath).replace(/\.docx$/i, '.md')
  return {
    outFilename,
    outputPath: join(outputPath, layer, outFilename),
    // mdCleanup 的 mediaPath 继承自 mediaConvert
    mediaPath:
      layer === 'mdCleanup'
        ? join(outputPath, 'mediaConvert', 'media')
        : join(outputPath, layer, 'media'),
  }
}
