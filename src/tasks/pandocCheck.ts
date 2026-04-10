import { execSync } from 'node:child_process'
import type { ListrTask } from 'listr2'
import type { AppContext } from '../context.js'

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
    if (testGlobalInstall()) {
      ctx.pandocExec = 'pandoc'
    } else {
      throw new Error('未检测到已安装的 pandoc，请安装后重试')
    }
  },
}
