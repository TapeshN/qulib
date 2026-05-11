import type { ExplorerType } from '../schemas/config.schema.js';
import type { AppExplorer } from './explorer.interface.js';
import { PlaywrightExplorer } from './playwright-explorer.js';
import { CypressExplorer } from './cypress-explorer.js';

export function createExplorer(type: ExplorerType): AppExplorer {
  switch (type) {
    case 'playwright':
      return new PlaywrightExplorer();
    case 'cypress':
      return new CypressExplorer();
    default:
      throw new Error(`Unknown explorer type: ${type}`);
  }
}
