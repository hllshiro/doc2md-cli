import { input } from '@inquirer/prompts'
import { ListrInquirerPromptAdapter } from '@listr2/prompt-adapter-inquirer'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'
import { loadCache, saveCache } from '../utils.js'
import { logger } from '../logger.js'

import { access } from 'fs/promises'
import { dirname, isAbsolute, join } from 'path'

/**
 * Validates a .docx file path input.
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
    logger.info('开始获取用户输入', '输入文档路径')
    const cache = await loadCache()
    logger.debug(`已加载缓存: ${JSON.stringify(cache)}`, '输入文档路径')

    const docxPath = await task.prompt(ListrInquirerPromptAdapter).run(input, {
      message:
        '\x1b[33m⚠ 提示：请确保文档中所有公式已转换为 Office Math 格式\x1b[0m\n' +
        '请输入 .docx 文件路径：\n',
      default: cache.docxInputPath,
      validate: async (value: string) => {
        const error = await validateDocxPath(value)
        return error ?? true
      },
    })

    logger.info(`用户输入路径: ${docxPath}`, '输入文档路径')
    await saveCache({ docxInputPath: docxPath })
    logger.debug('已保存缓存', '输入文档路径')

    if (isAbsolute(docxPath)) {
      ctx.inputPath = docxPath
      ctx.outputPath = join(dirname(ctx.inputPath), 'out')
    } else {
      ctx.inputPath = join(process.cwd(), docxPath)
      ctx.outputPath = join(process.cwd(), 'out')
    }

    logger.info(`路径解析完成 - 输入: ${ctx.inputPath}, 输出: ${ctx.outputPath}`, '输入文档路径')
  },
}
