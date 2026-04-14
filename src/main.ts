import { createContext } from './context.js'
import { createRunner } from './runner.js'
import { logger } from './logger.js'
import { docxInputTask } from './tasks/docxInput.js'
import { pandocCheckTask } from './tasks/pandocCheck.js'
import { docxConvertTask } from './tasks/docxConvert.js'
import { mediaConvertTask } from './tasks/mediaConvert.js'
import { mdCleanupTask } from './tasks/mdCleanup.js'
import { imageRecognitionTask } from './tasks/imageRecognition.js'

const ctx = createContext()
const runner = createRunner(ctx)

runner.add(docxInputTask)
runner.add(pandocCheckTask)
runner.add(docxConvertTask)
runner.add(mediaConvertTask)
runner.add(mdCleanupTask)
runner.add(imageRecognitionTask)

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

runner
  .run()
  .then(async () => {
    // 输出日志文件路径
    const logPath = logger.getLogPath()
    console.log(`\n✓ 执行完成，详细日志已保存至: ${logPath}`)
    await pause()
    process.exit(0)
  })
  .catch(async (err) => {
    const msg = err instanceof Error ? err.message : String(err)
    // 用户 CTRL+C 时 inquirer 抛出 ExitPromptError，直接退出不等待
    if (err instanceof Error && err.name === 'ExitPromptError') {
      process.exit(130)
    }
    // 记录错误
    logger.error(`执行失败: ${msg}`)
    const logPath = logger.getLogPath()
    console.error(msg)
    console.error(`\n详细日志已保存至: ${logPath}`)
    await pause()
    process.exit(1)
  })
