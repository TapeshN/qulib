import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { DecisionLogEntrySchema } from '../schemas/decision-log.schema.js';
import type { DecisionLogEntry } from '../schemas/decision-log.schema.js';
import { resolveScanStateBaseDir } from './state-manager.js';

export type LogDecisionOptions = {
  persist?: boolean;
  memory?: DecisionLogEntry[];
  outputDir?: string;
};

function logFilePath(options?: LogDecisionOptions): string {
  return join(resolveScanStateBaseDir(options?.outputDir), 'decision-log.json');
}

export async function logDecision(entry: DecisionLogEntry, options?: LogDecisionOptions): Promise<void> {
  const persist = options?.persist !== false;
  const memory = options?.memory;
  const logFile = logFilePath(options);
  const stateDir = resolveScanStateBaseDir(options?.outputDir);

  try {
    const validation = DecisionLogEntrySchema.safeParse(entry);
    if (!validation.success) {
      console.warn(
        `Failed to log decision entry to ${logFile}: validation issues ${JSON.stringify(validation.error.issues)}`
      );
      return;
    }

    if (memory) {
      memory.push(validation.data);
    }

    if (!persist) {
      return;
    }

    await mkdir(stateDir, { recursive: true });

    let log: DecisionLogEntry[] = [];
    if (existsSync(logFile)) {
      try {
        const raw = await readFile(logFile, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
          console.warn(`Failed to log decision entry to ${logFile}: file is not a JSON array; resetting log`);
        } else {
          const validatedEntries: DecisionLogEntry[] = [];
          for (const item of parsed) {
            const itemValidation = DecisionLogEntrySchema.safeParse(item);
            if (itemValidation.success) {
              validatedEntries.push(itemValidation.data);
            } else {
              console.warn(
                `Invalid existing entry skipped in ${logFile}: ${JSON.stringify(itemValidation.error.issues)}`
              );
            }
          }
          log = validatedEntries;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to read existing decision log at ${logFile}: ${message}`);
      }
    }

    log.push(validation.data);
    await writeFile(logFile, JSON.stringify(log, null, 2), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to log decision entry to ${logFile}: ${message}`);
  }
}
