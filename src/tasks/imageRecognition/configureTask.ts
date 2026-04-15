import { confirm, input, select } from '@inquirer/prompts'
import { ListrInquirerPromptAdapter } from '@listr2/prompt-adapter-inquirer'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../../context.js'
import { logger } from '../../logger.js'
import { loadCache, saveCache } from '../../utils.js'
import { aiConfig } from './config.js'
import type { ModelsResponse } from './types.js'

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

export function configureAiTask(_ctx: AppContext): ListrTask<AppContext> {
  return {
    title: '配置 AI 视觉识别接口',
    task: async (_ctx, task): Promise<void> => {
      logger.info('开始配置 AI 视觉识别接口', '配置 AI 视觉识别接口')
      const cache = await loadCache()
      logger.debug('已加载缓存', '配置 AI 视觉识别接口')

      aiConfig.baseURL = await task.prompt(ListrInquirerPromptAdapter).run(input, {
        message: '请输入 AI 视觉识别接口地址：',
        default: cache.aiBaseURL ?? 'http://localhost:1234/v1',
        validate: (value: string) => {
          if (value.trim() === '') return '请输入有效的接口地址'
          return true
        },
      })
      logger.info(`AI 接口地址: ${aiConfig.baseURL}`, '配置 AI 视觉识别接口')

      aiConfig.apiKey = await task.prompt(ListrInquirerPromptAdapter).run(input, {
        message: '请输入 API Key（无需密钥可留空）：',
        default: cache.aiApiKey ?? '',
      })
      logger.debug(`API Key 已${aiConfig.apiKey ? '设置' : '留空'}`, '配置 AI 视觉识别接口')

      task.output = '正在获取模型列表...'
      logger.info('正在获取模型列表...', '配置 AI 视觉识别接口')
      let models: string[] = []
      let retryCount = 0
      while (true) {
        try {
          models = await fetchModels(aiConfig.baseURL)
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

      aiConfig.model = await task.prompt(ListrInquirerPromptAdapter).run(select<string>, {
        message: '请选择视觉识别模型：',
        choices: models.map((id) => ({ name: id, value: id })),
        default: cache.aiModel && models.includes(cache.aiModel) ? cache.aiModel : undefined,
      })

      aiConfig.enableValidation = await task.prompt(ListrInquirerPromptAdapter).run(confirm, {
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
      aiConfig.timeout = Number(timeoutInput)

      await saveCache({
        aiBaseURL: aiConfig.baseURL,
        aiApiKey: aiConfig.apiKey,
        aiModel: aiConfig.model,
        aiEnableValidation: aiConfig.enableValidation,
        aiTimeout: aiConfig.timeout,
      })
      logger.info(
        `已选择模型: ${aiConfig.model}${aiConfig.enableValidation ? '（已开启校验）' : ''}`,
        '配置 AI 视觉识别接口'
      )

      task.output =
        `已选择模型: ${aiConfig.model}` + (aiConfig.enableValidation ? '（已开启校验）' : '')
    },
  }
}
