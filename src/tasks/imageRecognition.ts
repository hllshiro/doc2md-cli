import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { confirm, input, select } from '@inquirer/prompts'
import { ListrInquirerPromptAdapter } from '@listr2/prompt-adapter-inquirer'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'
import { loadCache, saveCache } from '../utils.js'
import { logger } from '../logger.js'

// Module-level AI configuration (shared between subtasks)
let aiBaseURL = ''
let aiApiKey = ''
let aiModel = ''
let aiEnableValidation = false
let aiTimeout = 0

const layer = 'imageRecognition'

// Regex to match Markdown image syntax: ![alt](src)
const RE_MD_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/g

const VISION_PROMPT = `Analyze this image and determine its content type.

Rules:
1. If the image contains a mathematical formula, equation, or mathematical expression:
   - Set "isFormula" to true
   - Provide the LaTeX representation in "content" (without dollar sign delimiters)
   - Use standard LaTeX math notation
2. If the image is NOT a mathematical formula:
   - Set "isFormula" to false
   - Provide a concise text description in "content" that captures the key information,
     data, and relationships shown in the image
   - Use Chinese for the description

Respond ONLY with a JSON object in this exact format, no other text:
{"isFormula": true/false, "content": "..."}`

const VALIDATION_PROMPT = `You are a strict validator. I will provide an image and a previous recognition result. Your job is to verify whether the recognition is correct.

Previous recognition result:
{RESULT}

Rules:
1. If the previous result correctly identified whether the image is a formula or not, AND
   the content (LaTeX or description) accurately represents the image, set "isCorrect" to true.
2. If the recognition is wrong (e.g. misidentified formula vs non-formula, or the LaTeX/description
   is inaccurate), set "isCorrect" to false and explain the error in "reason".

Respond ONLY with a JSON object in this exact format, no other text:
{"isCorrect": true/false, "reason": "..."}`

const MAX_RECOGNITION_ATTEMPTS = 3

function getMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.bmp':
      return 'image/bmp'
    case '.svg':
      return 'image/svg+xml'
    default:
      return 'image/jpeg'
  }
}

interface ModelsResponse {
  data: { id: string }[]
}

async function fetchModels(baseURL: string): Promise<string[]> {
  const url = baseURL.replace(/\/+$/, '') + '/models'
  let resp: Response
  try {
    resp = await fetch(url)
  } catch (err) {
    throw new Error(
      `无法连接到 AI 接口: ${url} — ${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (!resp.ok) {
    throw new Error(`获取模型列表失败: HTTP ${resp.status} ${resp.statusText}`)
  }
  let body: ModelsResponse
  try {
    body = (await resp.json()) as ModelsResponse
  } catch {
    throw new Error('模型列表格式异常，无法解析 JSON')
  }
  if (!Array.isArray(body.data) || body.data.length === 0) {
    throw new Error('模型列表为空，请检查 AI 服务是否正确加载了模型')
  }
  return body.data.map((m) => m.id)
}

interface RecognitionResult {
  isFormula: boolean
  content: string
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * 执行带超时控制的任务，超时后通过 AbortController 取消底层请求
 */
async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  if (timeoutMs <= 0) {
    return fn(new AbortController().signal)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => {
    controller.abort(new TimeoutError(`${operation} 超时（${timeoutMs}ms）`))
  }, timeoutMs)

  try {
    return await fn(controller.signal)
  } finally {
    clearTimeout(timeoutId)
  }
}

function parseRecognitionResponse(text: string): RecognitionResult {
  const jsonMatch = /\{[\s\S]*\}/.exec(text)
  if (!jsonMatch) {
    throw new Error(`AI 返回格式异常，无法提取 JSON: ${text.slice(0, 200)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    throw new Error(`AI 返回的 JSON 无法解析: ${jsonMatch[0].slice(0, 200)}`)
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as RecognitionResult).isFormula !== 'boolean' ||
    typeof (parsed as RecognitionResult).content !== 'string'
  ) {
    throw new Error(`AI 返回的 JSON 缺少 isFormula 或 content 字段`)
  }

  return parsed as RecognitionResult
}

async function recognizeImage(
  provider: ReturnType<typeof createOpenAICompatible>,
  modelId: string,
  imageBuffer: Buffer,
  mimeType: string
): Promise<RecognitionResult> {
  const result = await withTimeout(
    (signal) =>
      generateText({
        model: provider(modelId),
        temperature: 0.5,
        topP: 0.95,
        abortSignal: signal,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: VISION_PROMPT },
              {
                type: 'image',
                image: imageBuffer,
                mediaType: mimeType,
              },
            ],
          },
        ],
      }),
    aiTimeout * 1000,
    '图片识别'
  )

  return parseRecognitionResponse(result.text)
}

function buildRetryPrompt(feedback: string): string {
  return `Analyze this image and determine its content type.

A previous attempt was made but was found incorrect. Here is the feedback:
"${feedback}"

Please try again carefully, taking the feedback into account.

Rules:
1. If the image contains a mathematical formula, equation, or mathematical expression:
   - Set "isFormula" to true
   - Provide the LaTeX representation in "content" (without dollar sign delimiters)
   - Use standard LaTeX math notation
2. If the image is NOT a mathematical formula:
   - Set "isFormula" to false
   - Provide a concise text description in "content" that captures the key information,
     data, and relationships shown in the image
   - Use Chinese for the description

Respond ONLY with a JSON object in this exact format, no other text:
{"isFormula": true/false, "content": "..."}`
}

interface ValidationResult {
  isCorrect: boolean
  reason: string
}

async function validateRecognition(
  provider: ReturnType<typeof createOpenAICompatible>,
  modelId: string,
  imageBuffer: Buffer,
  mimeType: string,
  recognition: RecognitionResult
): Promise<ValidationResult> {
  const prompt = VALIDATION_PROMPT.replace('{RESULT}', JSON.stringify(recognition))

  const result = await withTimeout(
    (signal) =>
      generateText({
        model: provider(modelId),
        temperature: 0.5,
        topP: 0.95,
        abortSignal: signal,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', image: imageBuffer, mediaType: mimeType },
            ],
          },
        ],
      }),
    aiTimeout * 1000,
    '识别结果校验'
  )

  const text = result.text
  const jsonMatch = /\{[\s\S]*\}/.exec(text)
  if (!jsonMatch) {
    logger.warn('校验响应无法提取 JSON，视为校验失败触发重试', 'validateRecognition')
    return { isCorrect: false, reason: '校验响应格式异常，无法提取 JSON' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    logger.warn('校验响应 JSON 解析失败，视为校验失败触发重试', 'validateRecognition')
    return { isCorrect: false, reason: '校验响应 JSON 解析失败' }
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as ValidationResult).isCorrect !== 'boolean'
  ) {
    logger.warn('校验响应缺少 isCorrect 字段，视为校验失败触发重试', 'validateRecognition')
    return { isCorrect: false, reason: '校验响应缺少 isCorrect 字段' }
  }

  return {
    isCorrect: (parsed as ValidationResult).isCorrect,
    reason:
      typeof (parsed as ValidationResult).reason === 'string'
        ? (parsed as ValidationResult).reason
        : '',
  }
}

async function recognizeWithValidation(
  provider: ReturnType<typeof createOpenAICompatible>,
  modelId: string,
  imageBuffer: Buffer,
  mimeType: string,
  onStatus: (msg: string) => void
): Promise<RecognitionResult> {
  let result = await recognizeImage(provider, modelId, imageBuffer, mimeType)

  for (let attempt = 1; attempt < MAX_RECOGNITION_ATTEMPTS; attempt++) {
    onStatus(`校验识别结果 (第${attempt}次)...`)
    try {
      const validation = await validateRecognition(provider, modelId, imageBuffer, mimeType, result)

      if (validation.isCorrect) {
        return result
      }

      onStatus(`校验未通过: ${validation.reason}，重新识别 (第${attempt + 1}次)...`)
      const retryPrompt = buildRetryPrompt(validation.reason)
      result = await recognizeImageWithPrompt(provider, modelId, imageBuffer, mimeType, retryPrompt)
    } catch (err) {
      // 如果是超时错误，停止重试，直接返回当前结果
      if (err instanceof TimeoutError) {
        onStatus(`校验超时，停止重试`)
        logger.warn('识别校验超时，停止重试', 'recognizeWithValidation')
        return result
      }
      throw err
    }
  }

  return result
}

async function recognizeImageWithPrompt(
  provider: ReturnType<typeof createOpenAICompatible>,
  modelId: string,
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string
): Promise<RecognitionResult> {
  const result = await withTimeout(
    (signal) =>
      generateText({
        model: provider(modelId),
        temperature: 0.5,
        topP: 0.95,
        abortSignal: signal,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', image: imageBuffer, mediaType: mimeType },
            ],
          },
        ],
      }),
    aiTimeout * 1000,
    '图片识别重试'
  )

  return parseRecognitionResponse(result.text)
}

async function resolveImagePath(
  src: string,
  mdDir: string,
  mediaPath: string
): Promise<string | undefined> {
  // Try relative to markdown file first
  const relPath = resolve(mdDir, src)
  if (
    await access(relPath)
      .then(() => true)
      .catch(() => false)
  ) {
    return relPath
  }
  // Fallback: try in media directory
  const mediaFilePath = join(mediaPath, basename(src))
  if (
    await access(mediaFilePath)
      .then(() => true)
      .catch(() => false)
  ) {
    return mediaFilePath
  }
  return undefined
}

interface ImageMatch {
  fullMatch: string
  alt: string
  src: string
  lineIndex: number
  isBlock: boolean
}

function collectImageMatches(lines: string[]): ImageMatch[] {
  const matches: ImageMatch[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m: RegExpExecArray | null
    RE_MD_IMAGE.lastIndex = 0
    while ((m = RE_MD_IMAGE.exec(line)) !== null) {
      const fullMatch = m[0]
      const remainder = line.replace(fullMatch, '').trim()
      matches.push({
        fullMatch,
        alt: m[1],
        src: m[2],
        lineIndex: i,
        isBlock: remainder === '',
      })
    }
  }
  return matches
}

function configureAiTask(_ctx: AppContext): ListrTask<AppContext> {
  return {
    title: '配置 AI 视觉识别接口',
    task: async (_ctx, task): Promise<void> => {
      logger.info('开始配置 AI 视觉识别接口', '配置 AI 视觉识别接口')
      const cache = await loadCache()
      logger.debug('已加载缓存', '配置 AI 视觉识别接口')

      aiBaseURL = await task.prompt(ListrInquirerPromptAdapter).run(input, {
        message: '请输入 AI 视觉识别接口地址：',
        default: cache.aiBaseURL ?? 'http://localhost:1234/v1',
        validate: (value: string) => {
          if (value.trim() === '') return '请输入有效的接口地址'
          return true
        },
      })
      logger.info(`AI 接口地址: ${aiBaseURL}`, '配置 AI 视觉识别接口')

      aiApiKey = await task.prompt(ListrInquirerPromptAdapter).run(input, {
        message: '请输入 API Key（无需密钥可留空）：',
        default: cache.aiApiKey ?? '',
      })
      logger.debug(`API Key 已${aiApiKey ? '设置' : '留空'}`, '配置 AI 视觉识别接口')

      task.output = '正在获取模型列表...'
      logger.info('正在获取模型列表...', '配置 AI 视觉识别接口')
      let models: string[] = []
      let retryCount = 0
      while (true) {
        try {
          models = await fetchModels(aiBaseURL)
          logger.info(`成功获取 ${models.length} 个模型`, '配置 AI 视觉识别接口')
          break
        } catch (err) {
          retryCount++
          const errMsg = err instanceof Error ? err.message : String(err)
          task.output = `连接失败: ${errMsg}`
          logger.warn(`第 ${retryCount} 次连接失败: ${errMsg}`, '配置 AI 视觉识别接口')
          const retry = await task.prompt(ListrInquirerPromptAdapter).run(confirm, {
            message: '无法连接到 AI 接口，是否重试？',
            default: true,
          })
          if (!retry) {
            logger.error('用户取消连接 AI 接口', '配置 AI 视觉识别接口')
            throw new Error('用户取消连接 AI 接口')
          }
          task.output = '正在重试获取模型列表...'
        }
      }

      aiModel = await task.prompt(ListrInquirerPromptAdapter).run(select<string>, {
        message: '请选择视觉识别模型：',
        choices: models.map((id) => ({ name: id, value: id })),
        default: cache.aiModel && models.includes(cache.aiModel) ? cache.aiModel : undefined,
      })

      aiEnableValidation = await task.prompt(ListrInquirerPromptAdapter).run(confirm, {
        message: '是否开启识别结果校验？（开启后会对每张图片的识别结果进行二次验证）',
        default: cache.aiEnableValidation ?? false,
      })

      const timeoutInput = await task.prompt(ListrInquirerPromptAdapter).run(input, {
        message: '请输入模型识别超时时间（秒，0表示无限制）：',
        default: String(cache.aiTimeout ?? 0),
        validate: (value: string) => {
          const num = Number(value)
          if (isNaN(num) || num < 0 || !Number.isInteger(num)) {
            return '请输入有效的非负整数'
          }
          return true
        },
      })
      aiTimeout = Number(timeoutInput)

      await saveCache({ aiBaseURL, aiApiKey, aiModel, aiEnableValidation, aiTimeout })
      logger.info(
        `已选择模型: ${aiModel}${aiEnableValidation ? '（已开启校验）' : ''}`,
        '配置 AI 视觉识别接口'
      )

      task.output = `已选择模型: ${aiModel}` + (aiEnableValidation ? '（已开启校验）' : '')
    },
  }
}

function formatTimeDisplay(elapsedSeconds: number, timeoutSeconds: number): string {
  if (timeoutSeconds > 0) {
    return `(${elapsedSeconds}s/${timeoutSeconds}s)`
  }
  return `(${elapsedSeconds}s)`
}

interface FailedImage {
  match: ImageMatch
  imgPath: string
  imageBuffer: Buffer
  mimeType: string
}

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
      if (aiEnableValidation) {
        logger.info(
          `开始识别并校验 (${imgName})${attempt > 1 ? ` [第${attempt}次尝试]` : ''}`,
          '识别并替换图片内容'
        )
        return await recognizeWithValidation(provider, aiModel, imageBuffer, mimeType, onStatus)
      } else {
        logger.info(
          `开始识别 (${imgName})${attempt > 1 ? ` [第${attempt}次尝试]` : ''}`,
          '识别并替换图片内容'
        )
        return await recognizeImage(provider, aiModel, imageBuffer, mimeType)
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

function buildReplacement(match: ImageMatch, result: RecognitionResult, imgName: string): string {
  if (result.isFormula) {
    const replacement = match.isBlock ? `$$\n${result.content}\n$$` : `$${result.content}$`
    logger.debug(`公式替换 (${imgName}): ${replacement.substring(0, 50)}...`, '识别并替换图片内容')
    return replacement
  }
  logger.debug(`描述替换 (${imgName}): ${result.content.substring(0, 50)}...`, '识别并替换图片内容')
  return result.content
}

function processImagesTask(ctx: AppContext): ListrTask<AppContext> {
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
        return
      }

      const provider = createOpenAICompatible({
        name: 'ai-vision-provider',
        baseURL: aiBaseURL,
        apiKey: aiApiKey,
      })
      logger.debug(`AI 提供者已创建，接口: ${aiBaseURL}`, '识别并替换图片内容')

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
          task.output = `识别图片 (${i + 1}/${matches.length}): ${imgName} ${formatTimeDisplay(elapsedSeconds, aiTimeout)} - ${currentStatus}`
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
          task.output = `识别图片 (${i + 1}/${matches.length}): ${imgName} ${formatTimeDisplay(elapsedSeconds, aiTimeout)} - 完成`
          logger.info(`识别成功 (${imgName}): isFormula=${result.isFormula}`, '识别并替换图片内容')
          successCount++

          const replacement = buildReplacement(match, result, imgName)
          replacements.set(match.fullMatch, { replacement, isBlock: match.isBlock })
        } catch (err) {
          clearInterval(timerInterval)
          const errMsg = err instanceof Error ? err.message : String(err)
          const elapsedSeconds = Math.floor((Date.now() - currentImgStartTime) / 1000)
          task.output = `警告: AI 识别失败 (${imgName}) ${formatTimeDisplay(elapsedSeconds, aiTimeout)}: ${errMsg}`
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
            task.output = `重试图片 (${i + 1}/${retryList.length}): ${imgName} ${formatTimeDisplay(elapsedSeconds, aiTimeout)} - ${retryStatus}`
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
            task.output = `重试图片 (${i + 1}/${retryList.length}): ${imgName} ${formatTimeDisplay(elapsedSeconds, aiTimeout)} - 完成`
            logger.info(
              `重试成功 (${imgName}): isFormula=${result.isFormula}`,
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

export const imageRecognitionTask: ListrTask<AppContext> = {
  title: 'AI 图片识别与替换',
  task: (ctx, task) =>
    task.newListr([configureAiTask(ctx), processImagesTask(ctx)], { concurrent: false }),
}
