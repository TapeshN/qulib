/**
 * Honest fallback note for the LLM-as-judge CLI commands.
 *
 * The judges fall back to deterministic scoring when the LLM call fails (out of
 * API credits, network error, model unavailable). Without a signal, a user who
 * set a key and asked for the LLM judge cannot tell that apart from the legitimate
 * "no key → deterministic" case. This surfaces a one-line note to stderr ONLY when
 * the LLM path was genuinely requested (a key is present, and where applicable the
 * user opted in) yet every result came back deterministic — i.e. the call failed.
 * It writes to stderr so `--json` stdout stays pure.
 */

/** True when ANTHROPIC_API_KEY is set to a non-empty value. */
export function anthropicKeyPresent(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * Emit the fallback note iff the LLM judge was requested-with-a-key but the result
 * is fully deterministic. No-key fallback is expected and is NOT warned about here.
 */
export function noteLlmFallback(requestedWithKey: boolean, fellBackToDeterministic: boolean): void {
  if (requestedWithKey && fellBackToDeterministic) {
    process.stderr.write(
      '[qulib] note: LLM judge requested but the call failed; used deterministic scoring ' +
        '(check API credits / connectivity).\n'
    );
  }
}
