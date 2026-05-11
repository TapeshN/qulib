import type { HarnessConfig } from '../schemas/config.schema.js';
import type { RouteInventory } from '../schemas/route-inventory.schema.js';

export interface AppExplorer {
  explore(baseUrl: string, config: HarnessConfig): Promise<RouteInventory>;
}
