import path from 'node:path';
import { execSync } from 'node:child_process';
import { input } from '@inquirer/prompts';
import { ListrInquirerPromptAdapter } from '@listr2/prompt-adapter-inquirer';
import type { ListrTask } from 'listr2';
import type { AppContext } from '../context.js';

export function resolvePandocDefault(execPath: string): string {
  return path.join(path.dirname(execPath), 'pandoc.exe');
}

export const pandocCheckTask: ListrTask<AppContext> = {
  title: '检测 Pandoc 环境',
  task: async (ctx, task) => {
    try {
      execSync('pandoc --version', { stdio: 'ignore' });
      ctx.pandocPath = execSync('where pandoc').toString().trim().split('\n')[0].trim();
    } catch {
      const defaultPath = resolvePandocDefault(process.execPath);
      ctx.pandocPath = await task.prompt(ListrInquirerPromptAdapter).run(input, {
        message: '未检测到 pandoc，请输入 pandoc.exe 的完整路径：',
        default: defaultPath,
      });
    }
  },
};
