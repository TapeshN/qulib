import type { NeutralScenario, GeneratedTest } from '../schemas/gap-analysis.schema.js';

export interface TestAdapter {
  readonly adapterType: string;
  render(scenario: NeutralScenario): GeneratedTest;
  renderAll(scenarios: NeutralScenario[]): GeneratedTest[];
}
