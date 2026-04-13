import { readdir, mkdir, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, extname, basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'

// 定位 MetafileConverter.exe：
// - SEA 运行时：exe 同级的 module/ 目录
// - dev（ESM tsx）：项目根目录的 module/.../bin/Release/net8.0/
// - dev（CJS）：同上，通过 __dirname 推导
const _dir = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url))

const exeName = 'MetafileConverter.exe'

// SEA 运行时 __filename === process.execPath，exe 在 dist/ 下，module/ 在同级
const seaModulePath = resolve(dirname(process.execPath), 'module', exeName)
// dev 时从源码目录向上找项目根
const devModulePath = resolve(_dir, '../../module/MetafileConverter/MetafileConverter/bin/Release/net8.0', exeName)

const converterExe = existsSync(seaModulePath) ? seaModulePath : devModulePath

const layer = 'mediaConvert'


async function convertMetafile(srcPath: string, dstPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(converterExe, [srcPath, dstPath])
    const stderr: string[] = []
    proc.stderr.on('data', (d: Buffer) => stderr.push(d.toString()))
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`MetafileConverter 退出码 ${code}: ${stderr.join('')}`))
    })
    proc.on('error', reject)
  })
}

/** 子任务1：将 mediaPath 下的 EMF/WMF 渲染为 JPG，输出到 outdir/media */
function convertImagesTask(ctx: AppContext): ListrTask<AppContext> {
  return {
    title: '渲染 EMF/WMF 为 JPG',
    task: async (_, task): Promise<void> => {
      const srcMedia = ctx.lastContext!.mediaPath
      const outMedia = join(ctx.outputPath, layer, 'media')
      await mkdir(outMedia, { recursive: true })

      const files = await readdir(srcMedia)
      const targets = files.filter(f => {
        const ext = extname(f).toLowerCase()
        return ext === '.emf' || ext === '.wmf'
      })

      if (targets.length === 0) {
        task.output = '没有找到 EMF/WMF 文件，跳过'
        return
      }

      for (const file of targets) {
        const src = join(srcMedia, file)
        const dst = join(outMedia, basename(file, extname(file)) + '.jpg')
        task.output = `转换 ${file}`
        await convertMetafile(src, dst)
      }

      task.output = `完成，共转换 ${targets.length} 个文件`
    },
  }
}

/** 子任务2：复制 MD 文件到新目录，并将其中的 EMF/WMF 引用替换为 JPG */
function patchMarkdownTask(ctx: AppContext): ListrTask<AppContext> {
  return {
    title: '更新 Markdown 中的图片路径',
    task: async (_, task): Promise<void> => {
      const { outFilename, outputPath: srcMdPath } = ctx.lastContext!
      const outdir = join(ctx.outputPath, layer)
      const dstMdPath = join(outdir, outFilename)

      task.output = `读取 ${outFilename}`
      let content = await readFile(srcMdPath, 'utf-8')

      // 替换 media/xxx.emf 或 media/xxx.wmf 引用为 media/xxx.jpg
      content = content.replace(
        /(media\/[^)\s"]+)\.(emf|wmf)/gi,
        '$1.jpg',
      )

      await writeFile(dstMdPath, content, 'utf-8')
      task.output = `已写出 ${dstMdPath}`
    },
  }
}

export const mediaConvertTask: ListrTask<AppContext> = {
  title: '渲染矢量图并更新 Markdown 路径',
  task: (ctx, task) =>
    task.newListr(
      [convertImagesTask(ctx), patchMarkdownTask(ctx)],
      { concurrent: false },
    ),
}
