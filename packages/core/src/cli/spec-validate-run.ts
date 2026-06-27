/**
 * `qulib validate` — spec-grounded validation.
 *
 * Grades whether a deployed app's OBSERVED behavior conforms to a SUPPLIED spec
 * (PRD / requirements document). Not "does it crash" — "does it match intent."
 *
 * Usage:
 *   qulib validate --spec <spec.md> --url <url> [--enable-llm-judge] [--fail-on-violation] [--json]
 *   qulib validate --spec <spec.md> --report <analyze-report.json> [--enable-llm-judge] [--fail-on-violation] [--json]
 *
 * --spec <file>          Required. A text or markdown file; each non-empty, non-heading
 *                        line becomes a requirement (strips leading "- ", "* ", "N. ").
 * --url <url>            Run analyzeApp against this URL and use its output as the
 *                        observed summary.
 * --report <file>        Read a qulib analyze report.json and use a trimmed subset as
 *                        the observed summary. Mutually exclusive with --url.
 * --json                 Emit the full SpecConformanceResult as JSON on stdout.
 * --enable-llm-judge     Enable the LLM judge (requires ANTHROPIC_API_KEY). Without
 *                        this flag, all requirements return 'unknown'.
 * --fail-on-violation    Exit code 1 when verdict is 'violates' or 'partial'.
 *                        'insufficient-evidence' does NOT trigger this gate.
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { validateSpecConformance } from '../tools/scoring/spec-conformance.js';
import { anthropicKeyPresent, noteLlmFallback } from './llm-fallback-note.js';
import type {
  SpecRequirement,
  SpecConformanceResult,
} from '../schemas/spec-conformance.schema.js';

const MAX_SPEC_FILE_BYTES = 512 * 1024; // 512 KB
const MAX_REPORT_FILE_BYTES = 4 * 1024 * 1024; // 4 MB — generous for any real analyze report
const MAX_REQUIREMENTS = 100;

/** Parse a spec file (text or markdown) into a list of requirements. */
function parseSpecFileContent(content: string): SpecRequirement[] {
  const lines = content
    .split(/\n/)
    .map((l) => {
      // Strip markdown headings (lines that start with one or more #)
      if (/^#{1,6}\s/.test(l.trim())) return '';
      // Strip leading list markers: "- ", "* ", "1. ", "12. ", etc.
      return l.replace(/^[\s]*[-*]\s+/, '').replace(/^[\s]*\d+[.)]\s+/, '').trim();
    })
    .filter((l) => l.length > 0);

  const requirements: SpecRequirement[] = [];
  for (let i = 0; i < Math.min(lines.length, MAX_REQUIREMENTS); i++) {
    requirements.push({ id: `req-${i + 1}`, text: lines[i] });
  }
  return requirements;
}

/** Validate that the spec path is a regular file of sane size. */
async function validateSpecPath(specPath: string): Promise<string> {
  const abs = resolve(specPath.trim());
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(abs);
  } catch {
    throw new Error(`--spec file does not exist or is not accessible: ${abs}`);
  }
  if (!s.isFile()) {
    throw new Error(`--spec must be a regular file: ${abs}`);
  }
  if (s.size > MAX_SPEC_FILE_BYTES) {
    throw new Error(`--spec file exceeds maximum size (${MAX_SPEC_FILE_BYTES} bytes): ${abs}`);
  }
  return abs;
}

/** Build a concise text summary from a qulib analyze report.json. */
async function summarizeReportFile(reportPath: string): Promise<string> {
  const abs = resolve(reportPath.trim());
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(abs);
  } catch {
    throw new Error(`--report file does not exist or is not accessible: ${abs}`);
  }
  if (!s.isFile()) {
    throw new Error(`--report must be a regular file: ${abs}`);
  }
  // Size cap BEFORE the read — a Zod cap on observed.summary fires too late
  // (after an unbounded readFile + JSON.parse). Matches the --spec guard.
  if (s.size > MAX_REPORT_FILE_BYTES) {
    throw new Error(`--report file exceeds maximum size (${MAX_REPORT_FILE_BYTES} bytes): ${abs}`);
  }

  const raw = await readFile(abs, 'utf8');
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`--report file is not valid JSON: ${abs}`);
  }

  // Extract a meaningful trimmed subset from the analyze report.
  const trimmed: Record<string, unknown> = {
    status: report.status,
    coverageScore: report.coverageScore,
    releaseConfidence: report.releaseConfidence,
  };

  // Include up to 20 gaps for conciseness.
  if (Array.isArray(report.gaps)) {
    trimmed.gaps = (report.gaps as unknown[]).slice(0, 20);
  }

  // Include honesty notes if present.
  if (Array.isArray(report.honestyNotes)) {
    trimmed.honestyNotes = report.honestyNotes;
  }

  return JSON.stringify(trimmed);
}

/** Build an observed summary by running analyzeApp against a URL. */
async function summarizeUrl(url: string): Promise<string> {
  const { analyzeApp } = await import('../analyze.js');
  const { HarnessConfigSchema } = await import('../schemas/config.schema.js');

  const harnessConfig = HarnessConfigSchema.parse({
    maxPagesToScan: 10,
    maxDepth: 3,
    minPagesForConfidence: 3,
    timeoutMs: 30000,
    retryCount: 0,
    llmTokenBudget: 4096,
    testGenerationLimit: 5,
    enableLlmScenarios: false,
    readOnlyMode: true,
    requireHumanReview: false,
    failOnConsoleError: false,
    explorer: 'playwright',
    defaultAdapter: 'playwright',
    adapters: ['playwright'],
  });

  const result = await analyzeApp({ url, writeArtifacts: false, config: harnessConfig });

  const trimmed: Record<string, unknown> = {
    status: result.status,
    coverageScore: result.coverageScore,
    releaseConfidence: result.releaseConfidence,
    gaps: (result.gaps ?? []).slice(0, 20),
  };

  return JSON.stringify(trimmed);
}

/** Render a human-readable report from a SpecConformanceResult. */
function formatValidateReport(result: SpecConformanceResult, specRef: string): string {
  const lines: string[] = [];
  lines.push(`[qulib validate] Spec conformance for: ${specRef}`);
  lines.push(`  verdict: ${result.verdict}  —  conformance rate: ${(result.conformanceRate * 100).toFixed(1)}%`);
  lines.push('');
  lines.push('  Requirements:');
  for (const req of result.requirements) {
    const icon = req.conforms === 'yes' ? 'PASS' : req.conforms === 'no' ? 'FAIL' : 'SKIP';
    const conf = `(confidence: ${(req.confidence * 100).toFixed(0)}%, path: ${req.scoringPath})`;
    lines.push(`    [${icon}] ${req.id}: ${req.text.slice(0, 120)}`);
    lines.push(`         ${req.rationale} ${conf}`);
  }
  if (result.unmet.length > 0) {
    lines.push('');
    lines.push(`  Unmet: ${result.unmet.join(', ')}`);
  }
  return lines.join('\n');
}

export function registerSpecValidateCommand(program: Command): void {
  program
    .command('validate')
    .description(
      'Grade whether a deployed app\'s observed behavior conforms to a supplied spec (PRD / requirements). ' +
      'Pass --spec to supply requirements and --url or --report for observed behavior. ' +
      'Without --enable-llm-judge or ANTHROPIC_API_KEY, all requirements return unknown (insufficient-evidence). ' +
      'Use --fail-on-violation to gate CI on violating or partial verdicts.'
    )
    .requiredOption('--spec <file>', 'Path to a text or markdown requirements file')
    .option('--url <url>', 'URL of the deployed app to analyze (runs analyzeApp internally)')
    .option('--report <file>', 'Path to an existing qulib analyze report.json to use as observed summary')
    .option('--json', 'Emit the full SpecConformanceResult as JSON to stdout', false)
    .option('--enable-llm-judge', 'Enable the LLM judge (requires ANTHROPIC_API_KEY)', false)
    .option(
      '--fail-on-violation',
      'Exit code 1 when verdict is "violates" or "partial". ' +
      '"insufficient-evidence" does not trigger this gate.',
      false
    )
    .action(
      async (options: {
        spec: string;
        url?: string;
        report?: string;
        json: boolean;
        enableLlmJudge: boolean;
        failOnViolation: boolean;
      }) => {
        if (!options.url && !options.report) {
          throw new Error('qulib validate requires --report or --url to provide the observed app summary.');
        }
        if (options.url && options.report) {
          throw new Error('qulib validate requires exactly one of --url or --report, not both.');
        }

        // Validate + read spec file.
        const specAbs = await validateSpecPath(options.spec);
        const specContent = await readFile(specAbs, 'utf8');
        const requirements = parseSpecFileContent(specContent);

        if (requirements.length === 0) {
          throw new Error('--spec file produced zero requirements; check that it contains non-heading, non-empty lines.');
        }

        // Build the observed summary.
        let observedSummary: string;
        if (options.report) {
          observedSummary = await summarizeReportFile(options.report);
        } else {
          observedSummary = await summarizeUrl(options.url!);
        }

        const specRef = options.url ?? options.report ?? options.spec;

        const result = await validateSpecConformance(
          {
            requirements,
            observed: { url: options.url, summary: observedSummary },
            enableLlmJudge: options.enableLlmJudge,
          },
          {}
        );

        // Honest fallback note: warn (stderr → JSON-safe) iff the LLM judge was
        // requested with a key present but every requirement came back deterministic.
        const llmFellBack =
          result.requirements.length > 0 &&
          result.requirements.every((r) => r.scoringPath === 'deterministic-fallback');
        noteLlmFallback(Boolean(options.enableLlmJudge) && anthropicKeyPresent(), llmFellBack);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(formatValidateReport(result, specRef));
        }

        // Gate: only 'violates' and 'partial' trigger --fail-on-violation.
        // 'insufficient-evidence' is NOT a violation — it means we couldn't grade.
        if (options.failOnViolation && (result.verdict === 'violates' || result.verdict === 'partial')) {
          const reason = `verdict '${result.verdict}' — ${result.unmet.length} unmet requirement(s): ${result.unmet.join(', ')}`;
          const gateLine = `GATE: FAIL — ${reason}`;
          if (options.json) {
            process.stderr.write(gateLine + '\n');
          } else {
            console.log(gateLine);
          }
          process.exitCode = 1;
        } else if (options.failOnViolation) {
          const gateLine = `GATE: PASS — verdict '${result.verdict}'`;
          if (options.json) {
            process.stderr.write(gateLine + '\n');
          } else {
            console.log(gateLine);
          }
        }
      }
    );
}
