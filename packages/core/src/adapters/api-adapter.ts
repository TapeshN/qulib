import type { TestAdapter } from './adapter.interface.js';
import type { NeutralScenario, GeneratedTest } from '../schemas/gap-analysis.schema.js';

export class ApiAdapter implements TestAdapter {
  readonly adapterType = 'api';

  render(scenario: NeutralScenario): GeneratedTest {
    throw new Error('Not implemented');
  }

  renderAll(scenarios: NeutralScenario[]): GeneratedTest[] {
    throw new Error('Not implemented');
  }
}
