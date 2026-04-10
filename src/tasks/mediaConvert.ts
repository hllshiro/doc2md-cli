import { readdir, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import { createRequire } from 'node:module'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'

const require = createRequire(import.meta.url)

const layer = 'mediaConvert'

// C# 代码：用 System.Drawing 将 EMF/WMF 渲染为 JPG（白色背景）
const csharpSource = `
#r "System.Drawing.dll"

using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Linq;
using System.Threading.Tasks;

async (dynamic input) => {
    string srcPath = (string)input.srcPath;
    string dstPath = (string)input.dstPath;

    using (var metafile = new Metafile(srcPath)) {
        var header = metafile.GetMetafileHeader();
        
        // 这里的 Bounds 物理尺寸通常比像素更准
        // 如果 Bounds 拿不到，就用 Size
        int width = (int)header.Bounds.Width;
        int height = (int)header.Bounds.Height;

        if (width <= 0 || height <= 0) {
            width = (int)metafile.Size.Width;
            height = (int)metafile.Size.Height;
        }

        // 依然为 0 则兜底
        if (width <= 0) width = 800;
        if (height <= 0) height = 600;

        using (var bmp = new Bitmap(width, height)) {
            using (var g = Graphics.FromImage(bmp)) {
                g.Clear(Color.White);
                
                // 提高矢量图渲染质量
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
                g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                
                g.DrawImage(metafile, 0, 0, width, height);
            }

            // 获取 JPEG 编码器
            var encoder = ImageCodecInfo.GetImageEncoders()
                            .FirstOrDefault(c => c.FormatID == ImageFormat.Jpeg.Guid);
            
            var encoderParams = new EncoderParameters(1);
            encoderParams.Param[0] = new EncoderParameter(Encoder.Quality, 90L);

            bmp.Save(dstPath, encoder, encoderParams);
        }
    }
    return true;
}
`

async function convertMetafile(srcPath: string, dstPath: string): Promise<void> {
  const edge = require('edge-js')
  const convert = edge.func(csharpSource)
  await new Promise<void>((resolve, reject) => {
    convert({ srcPath, dstPath }, (err: Error | null) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

/** 子任务1：将 mediaPath 下的 EMF/WMF 渲染为 JPG，输出到 outdir/media */
function convertImagesTask(ctx: AppContext): ListrTask<AppContext> {
  return {
    title: '渲染 EMF/WMF 为 JPG',
    task: async (_, task): Promise<void> => {
      const srcMedia = ctx.docxConvertContext!.mediaPath
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
      const { outFilename, outputPath: srcMdPath } = ctx.docxConvertContext!
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
