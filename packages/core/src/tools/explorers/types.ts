import type { HarnessConfig } from '../../schemas/config.schema.js';
import type { RouteInventory } from '../../schemas/route-inventory.schema.js';
import type { RunArtifactsOptions } from '../../harness/run-options.js';

export interface AppExplorer {
  explore(baseUrl: string, config: HarnessConfig, artifacts?: RunArtifactsOptions): Promise<RouteInventory>;
}
