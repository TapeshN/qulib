import type { Gap } from '../schemas/gap-analysis.schema.js';
import { TestStepSchema } from '../schemas/gap-analysis.schema.js';

/**
 * FINDING 3: the documented action vocabulary in this prompt MUST match
 * `TestStepSchema`'s `action` union exactly — derived from it directly
 * (`.options`, zod's own enum-values accessor) rather than a hand-copied
 * literal list, so the two can never drift apart again the way they did
 * when `key-press`/`select` were added to the schema and both adapters in
 * round 3 but never to this prompt: a gap-driven scenario generator that
 * cannot even ADVERTISE an action undercuts the "exhaustive" framing just
 * as much as an adapter that cannot RENDER one.
 */
const TEST_STEP_ACTIONS: readonly string[] = TestStepSchema.shape.action.options;

export function buildGapPrompt(gaps: Gap[], limit: number): string {
  const topGaps = [...gaps]
    .sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return order[a.severity] - order[b.severity];
    })
    .slice(0, limit);

  const gapList = topGaps
    .map((g) => `- id:${g.id} [${g.severity}] ${g.category} at ${g.path}: ${g.reason}`)
    .join('\n');

  return `You are a QA engineer. Given these quality gaps found in a web application, generate test scenarios.

Gaps to address:
${gapList}

Return ONLY a JSON array. No markdown. No explanation. No code fences.

Each item must match this exact shape:
{
  "id": "string (unique)",
  "title": "string",
  "description": "string",
  "targetPath": "string (the route path)",
  "steps": [
    { "action": "${TEST_STEP_ACTIONS.join('|')}", "target": "string (optional)", "value": "string (optional)", "description": "string" }
  ],
  "tags": ["string"],
  "recommendations": [
    { "adapter": "playwright|cypress-e2e|cypress-component|api|accessibility", "reason": "string", "confidence": "high|medium|low" }
  ],
  "sourceGapIds": ["<one or more gap ids from the list, copied exactly as id:xxxx>"]
}`;
}
