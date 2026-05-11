import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { ZodError } from 'zod';
import type { ZodSchema } from 'zod';

const STATE_DIR = join(process.cwd(), '.scan-state');

export class StateManager {
  async readState<T>(filename: string, schema: ZodSchema<T>): Promise<T> {
    await mkdir(STATE_DIR, { recursive: true });
    const filepath = join(STATE_DIR, filename);
    if (!existsSync(filepath)) {
      throw new Error(`State file missing: ${filename} (${filepath})`);
    }

    let parsedJson: unknown;
    try {
      const raw = await readFile(filepath, 'utf8');
      parsedJson = JSON.parse(raw);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in state file ${filename}: ${error.message}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read state file ${filename}: ${message}`);
    }

    try {
      return schema.parse(parsedJson);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(`Schema validation failed for state file ${filename}: ${JSON.stringify(error.issues)}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to validate state file ${filename}: ${message}`);
    }
  }

  async writeState<T>(filename: string, data: T, schema: ZodSchema<T>): Promise<void> {
    const filepath = join(STATE_DIR, filename);

    let validatedData: T;
    try {
      validatedData = schema.parse(data);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new Error(`Schema validation failed for state file ${filename}: ${JSON.stringify(error.issues)}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to validate state data for ${filename}: ${message}`);
    }

    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(filepath, JSON.stringify(validatedData, null, 2), 'utf8');
  }
}

/*
Manual smoke test:

import { z } from 'zod';

const manager = new StateManager();
const DemoSchema = z.object({ count: z.number().int() });

await manager.writeState('demo.json', { count: 1 }, DemoSchema);
const loaded = await manager.readState('demo.json', DemoSchema);
console.log(loaded.count); // 1
*/
