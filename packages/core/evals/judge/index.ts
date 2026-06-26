/**
 * Public surface of the LLM-as-judge module (Q2c — eval-judge).
 *
 * Barrel for `evals/judge/`. Re-exports the judge's intended public API so callers
 * import from `./index.js` rather than reaching into individual files. Mirrors the
 * "Public surface" section of this module's README.md and the export style of the
 * repo's other barrels (src/index.ts, src/schemas/index.ts).
 */

// High-level grading entry points + the low-level runner.
export {
  judgeScaffoldSpec,
  judgeMaturityNarrative,
  judgeConfidenceNarrative,
  judgeJudgmentDecision,
  runJudge,
  aggregate,
  DEFAULT_JUDGE_MODEL,
  type JudgeLlm,
  type RunJudgeOptions,
} from './judge.js';

// Pinned, versioned rubrics + the pure scoring/validation helpers.
export {
  getRubric,
  scoreToOutcome,
  validateRubric,
  ALL_RUBRICS,
  RUBRICS,
  SCAFFOLD_RUBRIC_V1,
  SCORE_AUTOMATION_RUBRIC_V1,
  JUDGMENT_RUBRIC_V1,
  type Rubric,
  type RubricDimension,
} from './rubrics.js';

// Subject + grounding builders and their input shapes.
export {
  buildScaffoldSubject,
  buildMaturitySubject,
  buildConfidenceSubject,
  buildJudgmentSubject,
  type ScaffoldSpecSubject,
  type MaturityNarrativeSubject,
  type JudgmentDecisionSubject,
} from './subjects.js';

// Prompt construction + reply parsing and the subject/parsed-response shapes.
export {
  buildJudgePrompt,
  parseJudgeResponse,
  type JudgeSubject,
  type ParsedJudgeResponse,
} from './prompt.js';

// Scored meta-eval runner over the judge's own golden corpus.
export {
  runJudgeEval,
  formatSummary,
  type JudgeEvalSummary,
  type JudgeEvalCaseResult,
  type RunJudgeEvalOptions,
} from './eval-judge.js';

// The judge's golden corpus (its answer key for the offline meta-eval).
export {
  JUDGE_GOLDEN_CASES,
  type JudgeGoldenCase,
} from './golden/judge-cases.js';
