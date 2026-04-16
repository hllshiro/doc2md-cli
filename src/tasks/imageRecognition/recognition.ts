import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import { logger } from '../../logger.js'
import { aiConfig } from './config.js'
import { MAX_RECOGNITION_ATTEMPTS, VALIDATION_PROMPT, VISION_PROMPT } from './constants.js'
import type { ContentType, RecognitionResult, ValidationResult } from './types.js'

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * 执行带超时控制的任务，超时后通过 AbortController 取消底层请求
 */
export async function withTimeout<T>(
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

const VALID_CONTENT_TYPES: ContentType[] = ['ascii', 'latex', 'description']

export function parseRecognitionResponse(text: string): RecognitionResult {
  const jsonMatch = /\{[\s\S]*\}/.exec(text)
  if (!jsonMatch) {
    throw new Error(`AI 返回格式异常，无法提取 JSON: ${text.slice(0, 200)}`)
  }

  const jsonStr = jsonMatch[0]

  // 使用正则提取字段，避免 JSON.parse 对 LaTeX 反斜杠转义的限制
  const contentTypeMatch = /"contentType"\s*:\s*"([^"]*)"/.exec(jsonStr)
  const contentMatch = /"content"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/.exec(jsonStr)

  if (!contentTypeMatch || !contentMatch) {
    throw new Error(`AI 返回的 JSON 缺少必要字段: ${jsonStr.slice(0, 200)}`)
  }

  const contentType = contentTypeMatch[1] as ContentType
  if (!VALID_CONTENT_TYPES.includes(contentType)) {
    throw new Error(
      `AI 返回的 contentType 无效: ${contentType}，期望: ${VALID_CONTENT_TYPES.join(', ')}`
    )
  }

  const content = contentMatch[1]
    // 处理 JSON 标准转义（将 \\ 还原为 \）
    .replace(/\\\\/g, '\\')
    // 处理转义的引号
    .replace(/\\"/g, '"')
    // 仅在 \n、\r、\t 后面不跟字母时才视为控制字符转义
    // 避免破坏 LaTeX 命令（如 \text, \theta, \neq, \nabla, \right, \rho 等）
    .replace(/\\n(?![a-zA-Z])/g, '\n')
    .replace(/\\r(?![a-zA-Z])/g, '\r')
    .replace(/\\t(?![a-zA-Z])/g, '\t')

  return { contentType, content }
}

export async function recognizeImage(
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
    aiConfig.timeout * 1000,
    '图片识别'
  )

  return parseRecognitionResponse(result.text)
}

export function buildRetryPrompt(feedback: string): string {
  return `Analyze this image and determine its content type.

A previous attempt was made but was found incorrect. Here is the feedback:
"${feedback}"

Please try again carefully, taking the feedback into account.

Follow these steps in order:

STEP 1: Check if the image contains simple content that can be directly represented as plain text characters
- Examples: single letters (A, B, C, ω, λ, α, β, π), digits (0-9), simple symbols (+, -, =, <, >), basic operators
- These are characters that can be directly typed or copied as text without LaTeX formatting
- If YES: Set "contentType" to "ascii" and provide the character(s) in "content"

STEP 2: If not ASCII, check if the image contains a mathematical formula, equation, or mathematical expression
- If YES: Set "contentType" to "latex" and provide the LaTeX representation in "content" (without dollar sign delimiters)
- Use standard LaTeX math notation

STEP 3: If neither ASCII nor LaTeX formula
- The image is a complex diagram, flowchart, illustration, or other visual content
- Set "contentType" to "description"
- Provide a concise text description in "content" that captures the key information, data, and relationships shown in the image
- Use Chinese for the description

Respond ONLY with a JSON object in this exact format, no other text:
{"contentType": "ascii|latex|description", "content": "..."}`
}

export async function validateRecognition(
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
    aiConfig.timeout * 1000,
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

export async function recognizeImageWithPrompt(
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
    aiConfig.timeout * 1000,
    '图片识别重试'
  )

  return parseRecognitionResponse(result.text)
}

export async function recognizeWithValidation(
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
