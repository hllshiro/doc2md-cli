export interface AppContext {
  /** 用户输入的 .docx 文件绝对路径 */
  docxPath: string;
  /** 解析后的 pandoc 可执行文件路径 */
  pandocPath: string;
  /** 传递给 pandoc 的额外参数（可选） */
  pandocArgs?: string[];
  /** 转换输出的 Markdown 文件路径（可选，由 Convert_Task 写入） */
  outputPath?: string;
}

export function createContext(): AppContext {
  return { docxPath: '', pandocPath: '' };
}
