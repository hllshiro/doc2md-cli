import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText } from 'ai'
import { logger } from '../../logger.js'
import { aiConfig } from './config.js'
import { MAX_RECOGNITION_ATTEMPTS, VALIDATION_PROMPT, VISION_PROMPT } from './constants.js'
import type { RecognitionResult, ValidationResult } from './types.js'

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

export function parseRecognitionResponse(text: string): RecognitionResult {
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
