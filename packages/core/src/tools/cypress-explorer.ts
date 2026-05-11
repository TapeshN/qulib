import type { AppExplorer } from './explorer.interface.js';
import type { HarnessConfig } from '../schemas/config.schema.js';
import type { RouteInventory } from '../schemas/route-inventory.schema.js';

export class CypressExplorer implements AppExplorer {
  async explore(baseUrl: string, config: HarnessConfig): Promise<RouteInventory> {
    throw new Error('Not implemented');
  }
}
