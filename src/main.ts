import { createContext } from './context.js';
import { createRunner } from './runner.js';
import { docxInputTask } from './tasks/docxInput.js';
import { pandocCheckTask } from './tasks/pandocCheck.js';
import { convertTask } from './tasks/convert.js';

const ctx = createContext();
const runner = createRunner(ctx);

runner.add(docxInputTask);
runner.add(pandocCheckTask);
runner.add(convertTask);

async function pause(): Promise<void> {
  process.stdout.write('\n按任意键退出...');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve) => process.stdin.once('data', () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    resolve();
  }));
}

runner.run().catch(async (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  await pause();
  process.exit(1);
});
