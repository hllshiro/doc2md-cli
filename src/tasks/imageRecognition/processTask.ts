import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { confirm } from '@inquirer/prompts'
import { ListrInquirerPromptAdapter } from '@listr2/prompt-adapter-inquirer'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../../context.js'
import { saveOutputContext } from '../../context.js'
import { logger } from '../../logger.js'
import { aiConfig } from './config.js'
import { layer, MAX_RECOGNITION_ATTEMPTS } from './constants.js'
import {
  buildReplacement,
  collectImageMatches,
  formatTimeDisplay,
  getMimeType,
  resolveImagePath,
} from './helpers.js'
import { TimeoutError, recognizeImage, recognizeWithValidation } from './recognition.js'
import type { FailedImage, RecognitionResult } from './types.js'

async function attemptImageRecognition(
  provider: ReturnType<typeof createOpenAICompatible>,
  imageBuffer: Buffer,
  mimeType: string,
  imgName: string,
  onStatus: (msg: string) => void,
  onTimerReset: () => void
): Promise<RecognitionResult> {
  for (let attempt = 1; attempt <= MAX_RECOGNITION_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      onTimerReset()
    }
    try {
      onStatus(attempt > 1 ? `识别中 (第${attempt}次尝试)...` : '识别中...')
      if (aiConfig.enableValidation) {
        logger.info(
          `开始识别并校验 (${imgName})${attempt > 1 ? ` [第${attempt}次尝试]` : ''}`,
          '识别并替换图片内容'
        )
        return await recognizeWithValidation(
          provider,
          aiConfig.model,
          imageBuffer,
          mimeType,
          onStatus
        )
      } else {
        logger.info(
          `开始识别 (${imgName})${attempt > 1 ? ` [第${attempt}次尝试]` : ''}`,
          '识别并替换图片内容'
        )
        return await recognizeImage(provider, aiConfig.model, imageBuffer, mimeType)
      }
    } catch (err) {
      if (err instanceof TimeoutError && attempt < MAX_RECOGNITION_ATTEMPTS) {
        onStatus(`识别超时，重试 (${attempt + 1}/${MAX_RECOGNITION_ATTEMPTS})...`)
        logger.warn(`${imgName} 识别超时，准备第 ${attempt + 1} 次重试`, '识别并替换图片内容')
        continue
      }
      throw err
    }
  }
  throw new Error('所有识别尝试均失败')
}

export function processImagesTask(ctx: AppContext): ListrTask<AppContext> {
  return {
    title: '识别并替换图片内容',
    task: async (_ctx, task): Promise<void> => {
      const { outFilename, outputPath: srcPath, mediaPath } = ctx.lastContext!
      const mdDir = dirname(srcPath)
      const outdir = join(ctx.outputPath, layer)
      const outPath = join(outdir, outFilename)

      logger.info(`开始处理图片识别: ${outFilename}`, '识别并替换图片内容')
      task.output = '读取 Markdown 文件'
      const source = await readFile(srcPath, 'utf-8')
      const lines = source.split(/\r?\n/)
      logger.debug(`读取 Markdown 文件，共 ${lines.length} 行`, '识别并替换图片内容')

      const matches = collectImageMatches(lines)
      logger.info(`发现 ${matches.length} 个图片引用`, '识别并替换图片内容')

      if (matches.length === 0) {
        task.output = '未找到图片引用，跳过'
        logger.info('没有图片需要处理，直接复制文件', '识别并替换图片内容')
        await mkdir(outdir, { recursive: true })
        await writeFile(outPath, source, 'utf-8')
        ctx.lastContext = { outFilename, outputPath: outPath, mediaPath }
        await saveOutputContext(ctx.outputPath, layer, ctx.lastContext)
        return
      }

      const provider = createOpenAICompatible({
        name: 'ai-vision-provider',
        baseURL: aiConfig.baseURL,
        apiKey: aiConfig.apiKey,
      })
      logger.debug(`AI 提供者已创建，接口: ${aiConfig.baseURL}`, '识别并替换图片内容')

      // Map: fullMatch → replacement string
      const replacements = new Map<string, { replacement: string; isBlock: boolean }>()
      let successCount = 0
      let skipCount = 0
      const failedImages: FailedImage[] = []

      for (let i = 0; i < matches.length; i++) {
        const match = matches[i]
        const imgName = basename(match.src)
        let currentImgStartTime = Date.now()

        // 启动实时计时器
        let currentStatus = '识别中...'
        const timerInterval = setInterval(() => {
          const elapsedSeconds = Math.floor((Date.now() - currentImgStartTime) / 1000)
          task.output = `识别图片 (${i + 1}/${matches.length}): ${imgName} ${formatTimeDisplay(elapsedSeconds, aiConfig.timeout)} - ${currentStatus}`
        }, 100)

        logger.info(`处理图片 (${i + 1}/${matches.length}): ${imgName}`, '识别并替换图片内容')

        const imgPath = await resolveImagePath(match.src, mdDir, mediaPath)
        if (!imgPath) {
          clearInterval(timerInterval)
          task.output = `警告: 图片文件不存在: ${match.src}`
          logger.warn(`图片文件不存在: ${match.src}`, '识别并替换图片内容')
          skipCount++
          continue
        }
        logger.debug(`图片路径解析: ${imgPath}`, '识别并替换图片内容')

        let imageBuffer: Buffer
        try {
          imageBuffer = await readFile(imgPath)
          logger.debug(`读取图片成功，大小: ${imageBuffer.length} bytes`, '识别并替换图片内容')
        } catch {
          clearInterval(timerInterval)
          task.output = `警告: 无法读取图片文件: ${imgPath}`
          logger.warn(`无法读取图片文件: ${imgPath}`, '识别并替换图片内容')
          skipCount++
          continue
        }

        if (imageBuffer.length === 0) {
          clearInterval(timerInterval)
          task.output = `警告: 图片文件为空: ${imgPath}`
          logger.warn(`图片文件为空: ${imgPath}`, '识别并替换图片内容')
          skipCount++
          continue
        }

        const mimeType = getMimeType(extname(imgPath))
        logger.debug(`图片 MIME 类型: ${mimeType}`, '识别并替换图片内容')

        try {
          const result = await attemptImageRecognition(
            provider,
            imageBuffer,
            mimeType,
            imgName,
            (msg) => {
              currentStatus = msg
            },
            () => {
              currentImgStartTime = Date.now()
            }
          )
          clearInterval(timerInterval)
          const elapsedSeconds = Math.floor((Date.now() - currentImgStartTime) / 1000)
          task.output = `识别图片 (${i + 1}/${matches.length}): ${imgName} ${formatTimeDisplay(elapsedSeconds, aiConfig.timeout)} - 完成`
          logger.info(
            `识别成功 (${imgName}): contentType=${result.contentType}`,
            '识别并替换图片内容'
          )
          successCount++

          const replacement = buildReplacement(match, result, imgName)
          replacements.set(match.fullMatch, { replacement, isBlock: match.isBlock })
        } catch (err) {
          clearInterval(timerInterval)
          const errMsg = err instanceof Error ? err.message : String(err)
          const elapsedSeconds = Math.floor((Date.now() - currentImgStartTime) / 1000)
          task.output = `警告: AI 识别失败 (${imgName}) ${formatTimeDisplay(elapsedSeconds, aiConfig.timeout)}: ${errMsg}`
          logger.error(`AI 识别失败 (${imgName}): ${errMsg}`, '识别并替换图片内容')
          failedImages.push({ match, imgPath, imageBuffer, mimeType })
          continue
        }
      }

      // 失败任务重试
      while (failedImages.length > 0) {
        task.output = `${failedImages.length} 张图片识别失败，等待确认...`
        const retryConfirmed = await task.prompt(ListrInquirerPromptAdapter).run(confirm, {
          message: `${failedImages.length} 张图片识别失败，是否重试这些图片？`,
          default: true,
        })
        if (!retryConfirmed) {
          logger.info(`用户放弃重试 ${failedImages.length} 张失败图片`, '识别并替换图片内容')
          break
        }

        const retryList = [...failedImages]
        failedImages.length = 0
        logger.info(`开始重试 ${retryList.length} 张失败图片`, '识别并替换图片内容')

        for (let i = 0; i < retryList.length; i++) {
          const { match, imgPath, imageBuffer, mimeType } = retryList[i]
          const imgName = basename(match.src)
          let retryStartTime = Date.now()
          let retryStatus = '重试识别中...'
          const timerInterval = setInterval(() => {
            const elapsedSeconds = Math.floor((Date.now() - retryStartTime) / 1000)
            task.output = `重试图片 (${i + 1}/${retryList.length}): ${imgName} ${formatTimeDisplay(elapsedSeconds, aiConfig.timeout)} - ${retryStatus}`
          }, 100)

          logger.info(`重试图片 (${i + 1}/${retryList.length}): ${imgName}`, '识别并替换图片内容')

          try {
            const result = await attemptImageRecognition(
              provider,
              imageBuffer,
              mimeType,
              imgName,
              (msg) => {
                retryStatus = msg
              },
              () => {
                retryStartTime = Date.now()
              }
            )
            clearInterval(timerInterval)
            const elapsedSeconds = Math.floor((Date.now() - retryStartTime) / 1000)
            task.output = `重试图片 (${i + 1}/${retryList.length}): ${imgName} ${formatTimeDisplay(elapsedSeconds, aiConfig.timeout)} - 完成`
            logger.info(
              `重试成功 (${imgName}): contentType=${result.contentType}`,
              '识别并替换图片内容'
            )
            successCount++

            const replacement = buildReplacement(match, result, imgName)
            replacements.set(match.fullMatch, { replacement, isBlock: match.isBlock })
          } catch (err) {
            clearInterval(timerInterval)
            const errMsg = err instanceof Error ? err.message : String(err)
            task.output = `重试失败 (${imgName}): ${errMsg}`
            logger.error(`重试失败 (${imgName}): ${errMsg}`, '识别并替换图片内容')
            failedImages.push({ match, imgPath, imageBuffer, mimeType })
          }
        }
      }

      // Apply replacements
      task.output = '应用替换结果'
      const totalFailed = failedImages.length + skipCount
      logger.info(`应用替换结果，成功: ${successCount}, 失败: ${totalFailed}`, '识别并替换图片内容')
      const outLines: string[] = []
      for (const line of lines) {
        let processed = line
        let hasBlockReplacement = false
        let blockContent = ''

        // Check if this line has a block replacement
        for (const [fullMatch, { replacement, isBlock }] of replacements) {
          if (processed.includes(fullMatch) && isBlock) {
            hasBlockReplacement = true
            blockContent = replacement
            break
          }
        }

        if (hasBlockReplacement) {
          outLines.push(blockContent)
        } else {
          // Apply inline replacements
          for (const [fullMatch, { replacement }] of replacements) {
            if (processed.includes(fullMatch)) {
              processed = processed.split(fullMatch).join(replacement)
            }
          }
          outLines.push(processed)
        }
      }

      task.output = '写出结果文件'
      await mkdir(outdir, { recursive: true })
      await writeFile(outPath, outLines.join('\n'), 'utf-8')
      logger.info(`结果文件已写出: ${outPath}`, '识别并替换图片内容')

      ctx.lastContext = { outFilename, outputPath: outPath, mediaPath }
      await saveOutputContext(ctx.outputPath, layer, ctx.lastContext)
      task.output =
        `完成，成功: ${successCount}/${matches.length}` +
        (totalFailed > 0 ? `，失败: ${totalFailed}` : '')
      logger.info(
        `图片处理完成，成功: ${successCount}/${matches.length}，失败: ${totalFailed}`,
        '识别并替换图片内容'
      )
    },
  }
}
