import ts from 'typescript';
import type { GeneratedTest } from '../schemas/gap-analysis.schema.js';

/**
 * Per-spec validation outcome from the scaffold dry-run.
 *
 * `valid: false` means the TypeScript compiler reported one or more *syntactic*
 * errors when transpiling the generated spec as a standalone module — i.e. the
 * generator emitted code that will not parse, so it would fail the moment a
 * developer ran the test suite. `errors` carries the flattened compiler
 * messages so the failure is actionable, not just a boolean.
 */
export interface SpecValidation {
  scenarioId: string;
  filename: string;
  outputPath: string;
  valid: boolean;
  errors: string[];
}

/** Aggregate result of validating every generated spec in a scaffold run. */
export interface SpecValidationReport {
  ok: boolean;
  total: number;
  invalidCount: number;
  results: SpecValidation[];
}

/**
 * Dry-run a single generated spec through the TypeScript compiler.
 *
 * `transpileModule` performs single-file syntax transformation only — no type
 * checking, no module resolution — so it is the right tool to answer the one
 * question the scaffold must not get wrong: *does the string we are about to
 * write to disk actually parse as TypeScript?* A clean run (zero error-category
 * diagnostics AND non-empty output) means the spec is syntactically valid; any
 * error diagnostic means the generator produced broken code.
 *
 * We deliberately do NOT resolve `@playwright/test` / Cypress globals here:
 * those are type-level concerns that require the consumer's node_modules. The
 * gap this closes is *parse/compile-shape*, which is generator-local and cheap
 * to check at scaffold time.
 */
export function validateSpecCode(code: string): { valid: boolean; errors: string[] } {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      // isolatedModules keeps this a pure syntax pass and surfaces
      // single-file-illegal constructs, matching how a bundler would see it.
      isolatedModules: true,
    },
    reportDiagnostics: true,
  });

  const errorDiagnostics = (result.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );
  const errors = errorDiagnostics.map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, '\n')
  );

  // A clean transpile yields output text. Empty output with no diagnostics would
  // be suspicious, so treat it as invalid too rather than silently passing.
  const producedOutput = result.outputText.trim().length > 0;
  const valid = errors.length === 0 && producedOutput;
  if (!valid && errors.length === 0) {
    errors.push('transpile produced no output for a non-empty spec');
  }
  return { valid, errors };
}

/** Validate one GeneratedTest, returning a structured per-spec outcome. */
export function validateGeneratedTest(test: GeneratedTest): SpecValidation {
  const { valid, errors } = validateSpecCode(test.code);
  return {
    scenarioId: test.scenarioId,
    filename: test.filename,
    outputPath: test.outputPath,
    valid,
    errors,
  };
}

/**
 * Validate every generated spec in a scaffold run.
 *
 * `ok` is true only when *all* specs parse. This is the gate the CLI consults
 * to decide its exit code: a scaffold that writes a spec which cannot parse is a
 * silent correctness failure, and the whole point of the dry-run is to catch it
 * before the developer does.
 */
export function validateGeneratedTests(tests: GeneratedTest[]): SpecValidationReport {
  const results = tests.map(validateGeneratedTest);
  const invalidCount = results.filter((r) => !r.valid).length;
  return {
    ok: invalidCount === 0,
    total: results.length,
    invalidCount,
    results,
  };
}
