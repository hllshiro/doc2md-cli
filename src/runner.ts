import { Listr } from 'listr2';
import type { AppContext } from './context.js';

export function createRunner(ctx: AppContext): Listr<AppContext> {
  return new Listr<AppContext>([], {
    ctx,
    rendererOptions: { collapseSubtasks: false },
  });
}
