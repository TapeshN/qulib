import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GapAnalysis } from '../schemas/gap-analysis.schema.js';

export async function writeJsonReport(analysis: GapAnalysis, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const filePath = join(outputDir, 'report.json');
  await writeFile(filePath, JSON.stringify(analysis, null, 2), 'utf-8');
  console.log(`[qulib] JSON report written to ${filePath}`);
}
