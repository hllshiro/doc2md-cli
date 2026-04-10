import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'
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

      try {
        task.output = '创建输出目录'
        await mkdir(outdir, { recursive: true })
      } catch (err) {
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

      task.output = '调用 pandoc，开始转换文档格式'
      const proc = spawn(ctx.pandocExec, args, { cwd: outdir })

      let stderr = ''
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      proc.on('error', (err) => reject(err))

      proc.on('close', (code) => {
        if (code === 0) {
          ctx.docxConvertContext = {
            outFilename,
            outputPath,
            mediaPath,
          }
          resolve()
        } else {
          reject(new Error(stderr))
        }
      })
    }),
}
