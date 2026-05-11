import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { DecisionLogEntrySchema } from '../schemas/decision-log.schema.js';
import type { DecisionLogEntry } from '../schemas/decision-log.schema.js';

const LOG_FILE = join(process.cwd(), '.scan-state', 'decision-log.json');
const STATE_DIR = join(process.cwd(), '.scan-state');

export type LogDecisionOptions = {
  persist?: boolean;
  memory?: DecisionLogEntry[];
};

export async function logDecision(entry: DecisionLogEntry, options?: LogDecisionOptions): Promise<void> {
  const persist = options?.persist !== false;
  const memory = options?.memory;

  try {
    const validation = DecisionLogEntrySchema.safeParse(entry);
    if (!validation.success) {
      console.warn(
        `Failed to log decision entry to ${LOG_FILE}: validation issues ${JSON.stringify(validation.error.issues)}`
      );
      return;
    }

    if (memory) {
      memory.push(validation.data);
    }

    if (!persist) {
      return;
    }

    await mkdir(STATE_DIR, { recursive: true });

    let log: DecisionLogEntry[] = [];
    if (existsSync(LOG_FILE)) {
      try {
        const raw = await readFile(LOG_FILE, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
          console.warn(`Failed to log decision entry to ${LOG_FILE}: file is not a JSON array; resetting log`);
        } else {
          const validatedEntries: DecisionLogEntry[] = [];
          for (const item of parsed) {
            const itemValidation = DecisionLogEntrySchema.safeParse(item);
            if (itemValidation.success) {
              validatedEntries.push(itemValidation.data);
            } else {
              console.warn(
                `Invalid existing entry skipped in ${LOG_FILE}: ${JSON.stringify(itemValidation.error.issues)}`
              );
            }
          }
          log = validatedEntries;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to read existing decision log at ${LOG_FILE}: ${message}`);
      }
    }

    log.push(validation.data);
    await writeFile(LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to log decision entry to ${LOG_FILE}: ${message}`);
  }
}

/*
Manual smoke test:

await logDecision({
  timestamp: new Date().toISOString(),
  phase: 'observe',
  decision: 'Started crawl',
  reason: 'Initial discovery pass',
  metadata: { url: 'https://example.com' },
});
*/
