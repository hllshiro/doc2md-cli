import { input, confirm } from '@inquirer/prompts'
import { ListrInquirerPromptAdapter } from '@listr2/prompt-adapter-inquirer'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'
import { confirmDefaultAnswer } from '../utils.js'

import { access } from 'fs/promises'
import { dirname, isAbsolute, join } from 'path'

/**
 * Validates a .docx file path input.
 * Returns an error message string if invalid, or undefined if valid.
 */
export async function validateDocxPath(value: string): Promise<string | undefined> {
  if (value.trim() === '') {
    return '请输入有效的 .docx 文件路径'
  }
  if (
    !(await access(value)
      .then(() => true)
      .catch(() => false))
  ) {
    return '路径不存在，请确认后重新输入'
  }
  return undefined
}

export const docxInputTask: ListrTask<AppContext> = {
  title: '输入文档路径',
  task: async (ctx, task) => {
    const docxPath = await task.prompt(ListrInquirerPromptAdapter).run(input, {
      message: '请输入 .docx 文件路径：',
      validate: async (value: string) => {
        const error = await validateDocxPath(value)
        return error ?? true
      },
    })

    const confirmed = await task.prompt(ListrInquirerPromptAdapter).run(confirm, {
      message: '请确认文档中所有公式已转换为 Office Math 格式，是否继续？',
      default: true,
      theme: {
        style: {
          defaultAnswer: () => confirmDefaultAnswer(true),
        },
      },
    })

    if (!confirmed) {
      throw new Error('请先完成公式转换')
    }

    if (isAbsolute(docxPath)) {
      ctx.inputPath = docxPath
      ctx.outputPath = join(dirname(ctx.inputPath), 'out')
    } else {
      ctx.inputPath = join(process.cwd(), docxPath)
      ctx.outputPath = join(process.cwd(), 'out')
    }
  },
}
