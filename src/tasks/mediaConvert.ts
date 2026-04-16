import { readdir, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, extname, basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'
import { saveOutputContext } from '../context.js'
import { logger } from '../logger.js'

// 定位 MetafileConverter.exe：
// - SEA 运行时：exe 同级的 module/ 目录
// - dev（ESM tsx）：项目根目录的 module/.../bin/Release/net8.0/
// - dev（CJS）：同上，通过 __dirname 推导
const _dir = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url))

const exeName = 'MetafileConverter.exe'

// SEA 运行时 __filename === process.execPath，exe 在 dist/ 下，module/ 在同级
const seaModulePath = resolve(dirname(process.execPath), 'module', exeName)
// dev 时从源码目录向上找项目根
const devModulePath = resolve(
  _dir,
  '../../module/MetafileConverter/MetafileConverter/bin/Release/net8.0',
  exeName
)

const converterExe = existsSync(seaModulePath) ? seaModulePath : devModulePath

const layer = 'mediaConvert'

async function convertMetafile(srcPath: string, dstPath: string): Promise<void> {
  logger.debug(`转换矢量图: ${srcPath} -> ${dstPath}`, '渲染 EMF/WMF 为 JPG')
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(converterExe, [srcPath, dstPath])
    const stderr: string[] = []
    proc.stderr.on('data', (d: Buffer) => stderr.push(d.toString()))
    proc.on('close', (code) => {
      if (code === 0) {
        logger.debug(`矢量图转换成功: ${dstPath}`, '渲染 EMF/WMF 为 JPG')
        resolve()
      } else {
        logger.error(
          `MetafileConverter 失败，退出码 ${code}: ${stderr.join('')}`,
          '渲染 EMF/WMF 为 JPG'
        )
        reject(new Error(`MetafileConverter 退出码 ${code}: ${stderr.join('')}`))
      }
    })
    proc.on('error', (err) => {
      logger.error(`MetafileConverter 错误: ${err.message}`, '渲染 EMF/WMF 为 JPG')
      reject(err)
    })
  })
}

/** 子任务1：将 mediaPath 下的 EMF/WMF 渲染为 JPG，输出到 outdir/media，同时复制其他图片文件 */
function convertImagesTask(ctx: AppContext): ListrTask<AppContext> {
  return {
    title: '渲染 EMF/WMF 为 JPG',
    task: async (_, task): Promise<void> => {
      const srcMedia = ctx.lastContext!.mediaPath
      const outMedia = join(ctx.outputPath, layer, 'media')
      logger.info(`开始渲染矢量图，源目录: ${srcMedia}`, '渲染 EMF/WMF 为 JPG')
      await mkdir(outMedia, { recursive: true })

      const files = await readdir(srcMedia)
      logger.debug(`扫描到的文件: ${files.join(', ')}`, '渲染 EMF/WMF 为 JPG')

      const emfWmfTargets = files.filter((f) => {
        const ext = extname(f).toLowerCase()
        return ext === '.emf' || ext === '.wmf'
      })

      const otherImageFiles = files.filter((f) => {
        const ext = extname(f).toLowerCase()
        return ext !== '.emf' && ext !== '.wmf'
      })

      logger.info(
        `发现 EMF/WMF 文件，数量: ${emfWmfTargets.length}，其他图片文件: ${otherImageFiles.length}`,
        '渲染 EMF/WMF 为 JPG'
      )

      // 转换 EMF/WMF 文件
      if (emfWmfTargets.length > 0) {
        for (let i = 0; i < emfWmfTargets.length; i++) {
          const file = emfWmfTargets[i]
          const src = join(srcMedia, file)
          const dst = join(outMedia, basename(file, extname(file)) + '.jpg')
          task.output = `转换 ${file} (${i + 1}/${emfWmfTargets.length})`
          logger.info(
            `转换矢量图 (${i + 1}/${emfWmfTargets.length}): ${file}`,
            '渲染 EMF/WMF 为 JPG'
          )
          await convertMetafile(src, dst)
        }
      }

      // 复制其他图片文件（非 EMF/WMF）
      if (otherImageFiles.length > 0) {
        for (let i = 0; i < otherImageFiles.length; i++) {
          const file = otherImageFiles[i]
          const src = join(srcMedia, file)
          const dst = join(outMedia, file)
          task.output = `复制 ${file} (${i + 1}/${otherImageFiles.length})`
          logger.info(
            `复制图片文件 (${i + 1}/${otherImageFiles.length}): ${file}`,
            '渲染 EMF/WMF 为 JPG'
          )
          await copyFile(src, dst)
        }
      }

      const totalFiles = emfWmfTargets.length + otherImageFiles.length
      if (totalFiles === 0) {
        task.output = '没有找到图片文件，跳过'
        logger.info('没有需要处理的图片文件', '渲染 EMF/WMF 为 JPG')
      } else {
        task.output = `完成，共转换 ${emfWmfTargets.length} 个矢量图，复制 ${otherImageFiles.length} 个其他图片`
        logger.info(
          `矢量图渲染完成，共转换 ${emfWmfTargets.length} 个文件，复制 ${otherImageFiles.length} 个其他图片`,
          '渲染 EMF/WMF 为 JPG'
        )
      }
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

      logger.info(`开始更新 Markdown 图片路径: ${outFilename}`, '更新 Markdown 中的图片路径')
      task.output = `读取 ${outFilename}`
      let content = await readFile(srcMdPath, 'utf-8')
      logger.debug(`读取文件成功，内容长度: ${content.length} 字符`, '更新 Markdown 中的图片路径')

      // 替换 media/xxx.emf 或 media/xxx.wmf 引用为 media/xxx.jpg
      const originalContent = content
      content = content.replace(/(media\/[^)\s"]+)\.(emf|wmf)/gi, '$1.jpg')

      const replacedCount = (originalContent.match(/\.(emf|wmf)/gi) || []).length
      logger.info(`替换了 ${replacedCount} 个矢量图引用为 JPG`, '更新 Markdown 中的图片路径')

      await writeFile(dstMdPath, content, 'utf-8')
      task.output = `已写出 ${dstMdPath}`
      logger.info(`已写出更新后的文件: ${dstMdPath}`, '更新 Markdown 中的图片路径')

      ctx.lastContext = {
        outFilename,
        outputPath: dstMdPath,
        mediaPath: join(outdir, 'media'),
      }
      await saveOutputContext(ctx.outputPath, 'mediaConvert', ctx.lastContext)
    },
  }
}

export const mediaConvertTask: ListrTask<AppContext> = {
  title: '渲染矢量图并更新 Markdown 路径',
  task: (ctx, task) =>
    task.newListr([convertImagesTask(ctx), patchMarkdownTask(ctx)], { concurrent: false }),
}
