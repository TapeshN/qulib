import type { TestAdapter } from './adapter.interface.js';
import type { NeutralScenario, GeneratedTest } from '../schemas/gap-analysis.schema.js';

export class CypressE2EAdapter implements TestAdapter {
  readonly adapterType = 'cypress-e2e';

  render(scenario: NeutralScenario): GeneratedTest {
    throw new Error('Not implemented');
  }

  renderAll(scenarios: NeutralScenario[]): GeneratedTest[] {
    throw new Error('Not implemented');
  }
}
