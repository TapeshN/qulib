import type { AppExplorer } from './types.js';
import type { HarnessConfig } from '../../schemas/config.schema.js';
import type { RouteInventory } from '../../schemas/route-inventory.schema.js';
import type { RunArtifactsOptions } from '../../harness/run-options.js';

export class CypressExplorer implements AppExplorer {
  async explore(_baseUrl: string, _config: HarnessConfig, _artifacts?: RunArtifactsOptions): Promise<RouteInventory> {
    throw new Error('Not implemented');
  }
}
