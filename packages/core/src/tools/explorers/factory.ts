import type { ExplorerType } from '../../schemas/config.schema.js';
import type { AppExplorer } from './types.js';
import { PlaywrightExplorer } from './playwright.js';
import { CypressExplorer } from './cypress.js';

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
