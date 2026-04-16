import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'
import { saveOutputContext } from '../context.js'
import { logger } from '../logger.js'
import { basename, join } from 'path'

const from = 'docx+styles'
const to = ['gfm', '-tex_math_gfm'].join('')

export const docxConvertTask: ListrTask<AppContext> = {
  title: '将文档转换为 Markdown',
  task: (ctx, task) =>
    new Promise<void>(async (resolve, reject) => {
      const layer = 'docxConvert'
      const outdir = join(ctx.outputPath, layer)

      const outFilename = basename(ctx.inputPath).replace(/\.docx$/i, '.md')
      const outputPath = join(outdir, outFilename)
      const mediaPath = join(outdir, 'media')

      logger.info(`开始 DOCX 转换，输入: ${ctx.inputPath}`, '将文档转换为 Markdown')
      logger.debug(
        `输出目录: ${outdir}, 文件名: ${outFilename}, 媒体目录: ${mediaPath}`,
        '将文档转换为 Markdown'
      )

      try {
        task.output = '创建输出目录'
        await mkdir(outdir, { recursive: true })
        logger.debug(`输出目录已创建: ${outdir}`, '将文档转换为 Markdown')
      } catch (err) {
        logger.error(
          `创建输出目录失败: ${err instanceof Error ? err.message : String(err)}`,
          '将文档转换为 Markdown'
        )
        return reject(err)
      }

      const args = [
        ctx.inputPath,
        '-o',
        outFilename,
        '-f',
        from,
        '-t',
        to,
        `--extract-media=.`,
        '--markdown-headings=atx',
      ]
      logger.debug(`Pandoc 参数: ${args.join(' ')}`, '将文档转换为 Markdown')

      task.output = '调用 pandoc，开始转换文档格式'
      logger.info('启动 Pandoc 进程', '将文档转换为 Markdown')
      const proc = spawn(ctx.pandocExec, args, { cwd: outdir })

      let stderr = ''
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.on('error', (err) => {
        logger.error(`Pandoc 进程错误: ${err.message}`, '将文档转换为 Markdown')
        reject(err)
      })

      proc.on('close', async (code) => {
        if (code === 0) {
          logger.info(`Pandoc 转换成功，输出文件: ${outputPath}`, '将文档转换为 Markdown')
          ctx.lastContext = {
            outFilename,
            outputPath,
            mediaPath,
          }
          await saveOutputContext(ctx.outputPath, 'docxConvert', ctx.lastContext)
          resolve()
        } else {
          logger.error(`Pandoc 转换失败，退出码: ${code}, 错误: ${stderr}`, '将文档转换为 Markdown')
          reject(new Error(stderr))
        }
      })
    }),
}
