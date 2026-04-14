import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { confirm, input, select } from '@inquirer/prompts'
import { ListrInquirerPromptAdapter } from '@listr2/prompt-adapter-inquirer'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'
import { loadCache, saveCache } from '../utils.js'

// Module-level AI configuration (shared between subtasks)
let aiBaseURL = ''
let aiApiKey = ''
let aiModel = ''
let aiEnableValidation = false

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

async function recognizeImage(
  provider: ReturnType<typeof createOpenAI>,
  modelId: string,
  imageBuffer: Buffer,
  mimeType: string
): Promise<RecognitionResult> {
  const result = await generateText({
    model: provider(modelId),
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
  })

  const text = result.text
  // Extract JSON from the response (handles models that prepend/append extra text)
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
  provider: ReturnType<typeof createOpenAI>,
  modelId: string,
  imageBuffer: Buffer,
  mimeType: string,
  recognition: RecognitionResult
): Promise<ValidationResult> {
  const prompt = VALIDATION_PROMPT.replace('{RESULT}', JSON.stringify(recognition))

  const result = await generateText({
    model: provider(modelId),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image', image: imageBuffer, mediaType: mimeType },
        ],
      },
    ],
  })

  const text = result.text
  const jsonMatch = /\{[\s\S]*\}/.exec(text)
  if (!jsonMatch) {
    // Cannot parse validation → treat as passed to avoid blocking
    return { isCorrect: true, reason: '' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return { isCorrect: true, reason: '' }
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as ValidationResult).isCorrect !== 'boolean'
  ) {
    return { isCorrect: true, reason: '' }
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
  provider: ReturnType<typeof createOpenAI>,
  modelId: string,
  imageBuffer: Buffer,
  mimeType: string,
  onStatus: (msg: string) => void
): Promise<RecognitionResult> {
  let result = await recognizeImage(provider, modelId, imageBuffer, mimeType)

  for (let attempt = 1; attempt < MAX_RECOGNITION_ATTEMPTS; attempt++) {
    onStatus(`校验识别结果 (第${attempt}次)...`)
    const validation = await validateRecognition(provider, modelId, imageBuffer, mimeType, result)

    if (validation.isCorrect) {
      return result
    }

    onStatus(`校验未通过: ${validation.reason}，重新识别 (第${attempt + 1}次)...`)
    const retryPrompt = buildRetryPrompt(validation.reason)
    result = await recognizeImageWithPrompt(provider, modelId, imageBuffer, mimeType, retryPrompt)
  }

  return result
}

async function recognizeImageWithPrompt(
  provider: ReturnType<typeof createOpenAI>,
  modelId: string,
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string
): Promise<RecognitionResult> {
  const result = await generateText({
    model: provider(modelId),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image', image: imageBuffer, mediaType: mimeType },
        ],
      },
    ],
  })

  const text = result.text
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
      const cache = await loadCache()

      aiBaseURL = await task.prompt(ListrInquirerPromptAdapter).run(input, {
        message: '请输入 AI 视觉识别接口地址：',
        default: cache.aiBaseURL ?? 'http://localhost:1234/v1',
        validate: (value: string) => {
          if (value.trim() === '') return '请输入有效的接口地址'
          return true
        },
      })

      aiApiKey = await task.prompt(ListrInquirerPromptAdapter).run(input, {
        message: '请输入 API Key（无需密钥可留空）：',
        default: cache.aiApiKey ?? '',
      })

      task.output = '正在获取模型列表...'
      let models: string[] = []
      while (true) {
        try {
          models = await fetchModels(aiBaseURL)
          break
        } catch (err) {
          task.output = `连接失败: ${err instanceof Error ? err.message : String(err)}`
          const retry = await task.prompt(ListrInquirerPromptAdapter).run(confirm, {
            message: '无法连接到 AI 接口，是否重试？',
            default: true,
          })
          if (!retry) {
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

      await saveCache({ aiBaseURL, aiApiKey, aiModel, aiEnableValidation })

      task.output = `已选择模型: ${aiModel}` + (aiEnableValidation ? '（已开启校验）' : '')
    },
  }
}

function processImagesTask(ctx: AppContext): ListrTask<AppContext> {
  return {
    title: '识别并替换图片内容',
    task: async (_ctx, task): Promise<void> => {
      const { outFilename, outputPath: srcPath, mediaPath } = ctx.lastContext!
      const mdDir = dirname(srcPath)
      const outdir = join(ctx.outputPath, layer)
      const outPath = join(outdir, outFilename)

      task.output = '读取 Markdown 文件'
      const source = await readFile(srcPath, 'utf-8')
      const lines = source.split(/\r?\n/)

      const matches = collectImageMatches(lines)
      if (matches.length === 0) {
        task.output = '未找到图片引用，跳过'
        await mkdir(outdir, { recursive: true })
        await writeFile(outPath, source, 'utf-8')
        ctx.lastContext = { outFilename, outputPath: outPath, mediaPath }
        return
      }

      const provider = createOpenAI({ baseURL: aiBaseURL, apiKey: aiApiKey })
      // Map: fullMatch → replacement string
      const replacements = new Map<string, { replacement: string; isBlock: boolean }>()

      for (let i = 0; i < matches.length; i++) {
        const match = matches[i]
        const imgName = basename(match.src)
        task.output = `识别图片 (${i + 1}/${matches.length}): ${imgName}`

        const imgPath = await resolveImagePath(match.src, mdDir, mediaPath)
        if (!imgPath) {
          task.output = `警告: 图片文件不存在: ${match.src}`
          continue
        }

        let imageBuffer: Buffer
        try {
          imageBuffer = await readFile(imgPath)
        } catch {
          task.output = `警告: 无法读取图片文件: ${imgPath}`
          continue
        }

        if (imageBuffer.length === 0) {
          task.output = `警告: 图片文件为空: ${imgPath}`
          continue
        }

        const mimeType = getMimeType(extname(imgPath))

        let result: RecognitionResult
        try {
          if (aiEnableValidation) {
            result = await recognizeWithValidation(
              provider,
              aiModel,
              imageBuffer,
              mimeType,
              (msg) => {
                task.output = `(${i + 1}/${matches.length}) ${imgName}: ${msg}`
              }
            )
          } else {
            result = await recognizeImage(provider, aiModel, imageBuffer, mimeType)
          }
        } catch (err) {
          task.output = `警告: AI 识别失败 (${imgName}): ${err instanceof Error ? err.message : String(err)}`
          continue
        }

        let replacement: string
        if (result.isFormula) {
          replacement = match.isBlock ? `$$\n${result.content}\n$$` : `$${result.content}$`
        } else {
          replacement = result.content
        }

        replacements.set(match.fullMatch, { replacement, isBlock: match.isBlock })
      }

      // Apply replacements
      task.output = '应用替换结果'
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

      ctx.lastContext = { outFilename, outputPath: outPath, mediaPath }
      task.output = `完成，共处理 ${replacements.size}/${matches.length} 张图片`
    },
  }
}

export const imageRecognitionTask: ListrTask<AppContext> = {
  title: 'AI 图片识别与替换',
  task: (ctx, task) =>
    task.newListr([configureAiTask(ctx), processImagesTask(ctx)], { concurrent: false }),
}
