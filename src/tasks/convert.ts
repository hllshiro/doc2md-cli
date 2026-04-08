import { spawn } from 'node:child_process';
import type { ListrTask } from 'listr2';
import type { AppContext } from '../context.js';

export function buildPandocArgs(ctx: AppContext): string[] {
  const outputPath = ctx.docxPath.replace(/\.docx$/i, '.md');
  const base = [ctx.docxPath, '--from=docx', '--to=markdown', '-o', outputPath];
  return ctx.pandocArgs ? [...base, ...ctx.pandocArgs] : base;
}

export const convertTask: ListrTask<AppContext> = {
  title: '转换文档',
  task: (ctx) =>
    new Promise<void>((resolve, reject) => {
      const outputPath = ctx.docxPath.replace(/\.docx$/i, '.md');
      const args = buildPandocArgs(ctx);
      const proc = spawn(ctx.pandocPath, args);

      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => reject(err));

      proc.on('close', (code) => {
        if (code === 0) {
          ctx.outputPath = outputPath;
          resolve();
        } else {
          reject(new Error(stderr));
        }
      });
    }),
};
