import { createHash } from 'node:crypto';

export function hashForCostIntelligence(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex').slice(0, 32);
}
