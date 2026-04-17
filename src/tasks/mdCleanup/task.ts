import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../../context.js'
import { saveOutputContext } from '../../context.js'
import { logger } from '../../logger.js'
import { cleanMarkdown } from './stateMachine.js'

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
