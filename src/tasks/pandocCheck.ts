import { execSync } from 'node:child_process'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'
import { logger } from '../logger.js'

export function testGlobalInstall(): boolean {
  try {
    execSync('pandoc --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export const pandocCheckTask: ListrTask<AppContext> = {
  title: '检测 Pandoc 环境',
  task: async (ctx) => {
    logger.info('开始检测 Pandoc 环境', '检测 Pandoc 环境')
    if (testGlobalInstall()) {
      ctx.pandocExec = 'pandoc'
      logger.info('检测到 Pandoc 全局安装，使用命令: pandoc', '检测 Pandoc 环境')
    } else {
      logger.error('未检测到 Pandoc 安装', '检测 Pandoc 环境')
      throw new Error('未检测到已安装的 pandoc，请安装后重试')
    }
  },
}
