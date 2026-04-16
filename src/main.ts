import { createContext } from './context.js'
import { createRunner } from './runner.js'
import { logger } from './logger.js'
import { docxInputTask } from './tasks/docxInput.js'
import { pandocCheckTask } from './tasks/pandocCheck.js'
import { docxConvertTask } from './tasks/docxConvert.js'
import { mediaConvertTask } from './tasks/mediaConvert.js'
import { mdCleanupTask } from './tasks/mdCleanup.js'
import { imageRecognitionTask } from './tasks/imageRecognition/index.js'
import type { ListrTask } from 'listr2'
import type { AppContext } from './context.js'

function withSkipOnResume(task: ListrTask<AppContext>, index: number): ListrTask<AppContext> {
  return {
    ...task,
    skip: (ctx: AppContext) =>
      ctx.startFrom !== undefined && index < ctx.startFrom
        ? `\x1b[9m${task.title as string}\x1b[29m`
        : false,
  }
}

const ctx = createContext()
const runner = createRunner(ctx)

runner.add(docxInputTask)
runner.add(withSkipOnResume(pandocCheckTask, 1))
runner.add(withSkipOnResume(docxConvertTask, 2))
runner.add(withSkipOnResume(mediaConvertTask, 3))
runner.add(withSkipOnResume(mdCleanupTask, 4))
runner.add(withSkipOnResume(imageRecognitionTask, 5))

async function pause(): Promise<void> {
  process.stdout.write('\n按任意键退出...')
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolve) =>
    process.stdin.once('data', () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      resolve()
    })
  )
}

function printLogPath(): void {
  const logPath = logger.getLogPath()
  console.log(`\n详细日志已保存至: ${logPath}`)
}

runner
  .run()
  .then(async () => {
    console.log('\n✓ 执行完成')
    printLogPath()
    await pause()
    process.exit(0)
  })
  .catch(async (err) => {
    const msg = err instanceof Error ? err.message : String(err)
    // 用户 CTRL+C 时 inquirer 抛出 ExitPromptError，直接退出不等待
    if (err instanceof Error && err.name === 'ExitPromptError') {
      printLogPath()
      process.exit(130)
    }
    // 记录错误
    logger.error(`执行失败: ${msg}`)
    console.error(msg)
    printLogPath()
    await pause()
    process.exit(1)
  })
