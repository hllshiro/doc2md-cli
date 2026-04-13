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
}

export function createContext(): AppContext {
  return { inputPath: '', outputPath: '', pandocExec: 'pandoc' }
}
