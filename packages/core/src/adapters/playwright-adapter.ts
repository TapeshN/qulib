import type { TestAdapter } from './adapter.interface.js';
import type { NeutralScenario, GeneratedTest } from '../schemas/gap-analysis.schema.js';

export class PlaywrightAdapter implements TestAdapter {
  readonly adapterType = 'playwright';

  render(scenario: NeutralScenario): GeneratedTest {
    throw new Error('Not implemented');
  }

  renderAll(scenarios: NeutralScenario[]): GeneratedTest[] {
    throw new Error('Not implemented');
  }
}
