import type { ListrTask } from 'listr2'
import type { AppContext } from '../../context.js'
import { configureAiTask } from './configureTask.js'
import { processImagesTask } from './processTask.js'

export const imageRecognitionTask: ListrTask<AppContext> = {
  title: 'AI 图片识别与替换',
  task: (ctx, task) =>
    task.newListr([configureAiTask(ctx), processImagesTask(ctx)], { concurrent: false }),
}
