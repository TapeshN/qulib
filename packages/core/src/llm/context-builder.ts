import type { Gap } from '../schemas/gap-analysis.schema.js';

export function buildGapPrompt(gaps: Gap[], limit: number): string {
  const topGaps = [...gaps]
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.severity] - order[b.severity];
    })
    .slice(0, limit);

  const gapList = topGaps
    .map((g, i) => `${i + 1}. [${g.severity}] ${g.category} at ${g.path}: ${g.reason}`)
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
    { "action": "navigate|click|type|assert-visible|assert-hidden|assert-text|assert-disabled|assert-count|wait|api-call", "target": "string (optional)", "value": "string (optional)", "description": "string" }
  ],
  "tags": ["string"],
  "recommendations": [
    { "adapter": "playwright|cypress-e2e|cypress-component|api|accessibility", "reason": "string", "confidence": "high|medium|low" }
  ],
  "sourceGapIds": ["string"]
}`;
}
