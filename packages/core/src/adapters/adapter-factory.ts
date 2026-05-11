import type { AdapterType } from '../schemas/config.schema.js';
import type { TestAdapter } from './adapter.interface.js';
import { PlaywrightAdapter } from './playwright-adapter.js';
import { CypressE2EAdapter } from './cypress-e2e-adapter.js';
import { CypressComponentAdapter } from './cypress-component-adapter.js';
import { ApiAdapter } from './api-adapter.js';

export function createAdapter(type: AdapterType): TestAdapter {
  switch (type) {
    case 'playwright':
      return new PlaywrightAdapter();
    case 'cypress-e2e':
      return new CypressE2EAdapter();
    case 'cypress-component':
      return new CypressComponentAdapter();
    case 'api':
      return new ApiAdapter();
    default:
      throw new Error(`Unknown adapter type: ${type}`);
  }
}

export function createAdapters(types: AdapterType[]): TestAdapter[] {
  return types.map(createAdapter);
}
