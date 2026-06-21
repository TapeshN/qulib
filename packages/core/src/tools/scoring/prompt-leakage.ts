/**
 * Prompt-leakage detector — gap category `prompt-leakage`.
 *
 * Flags when a web page inadvertently exposes AI system-prompt / agent
 * instructions in its public surface: inline scripts, HTML comments, meta
 * tags, visible text, response headers, or error bodies.
 *
 * CONSERVATIVE design: every signal requires TWO corroborating markers
 * before generating a Gap, to keep the false-positive rate low.
 * A page that merely uses the word "AI" or "assistant" will NOT trip.
 *
 * Heuristics are derived from first principles — the structural telltale
 * shapes of an exposed instruction block.  No third-party leaked-prompt
 * text or vendor identifiers were used.
 */

import { randomUUID } from 'node:crypto';
import type { Gap } from '../../schemas/gap-analysis.schema.js';
import type { Route } from '../../schemas/route-inventory.schema.js';

// ---------------------------------------------------------------------------
// Internal signal shape
// ---------------------------------------------------------------------------

interface LeakSignal {
  /** Short description of the signal. */
  description: string;
  /** Matched snippet, truncated for the Gap evidence field. */
  evidence: string;
  severity: Gap['severity'];
}

// ---------------------------------------------------------------------------
// Pattern constants — all original heuristics; no vendor identifiers
// ---------------------------------------------------------------------------

/**
 * Patterns that mark the OPENING of a system-instruction block.
 * These alone are weak — we require corroboration.
 */
const ROLE_DIRECTIVE_RE =
  /\b(?:you\s+are\s+(?:an?\s+)?(?:ai|assistant|agent|bot|helpful|language\s+model)|act\s+as\s+(?:an?\s+)?(?:ai|assistant|agent|bot)|your\s+(?:role|persona|job|task|purpose)\s+is\s+to|i\s+am\s+(?:an?\s+)?(?:ai|assistant|agent|bot)|as\s+(?:an?\s+)?(?:ai|assistant|agent|language\s+model))\b/i;

/**
 * Patterns that mark instruction-block structural keywords.
 * Typical in system prompts to delineate sections/rules.
 */
const INSTRUCTION_KEYWORD_RE =
  /\b(?:do\s+not\s+(?:reveal|disclose|share|tell|mention|discuss)\s+(?:this|these|your\s+instructions?|the\s+(?:system\s+)?prompt)|never\s+(?:reveal|disclose|share|tell)\s+(?:this|these|your|the)\b|keep\s+(?:this|these|the\s+following)\s+(?:confidential|secret|private|hidden)|do\s+not\s+(?:break|exit|leave)\s+(?:character|role|persona)|stay\s+in\s+character|maintain\s+(?:your\s+)?(?:persona|role|character))\b/i;

/**
 * Markers that signal a tool/function definition block being echoed back
 * (e.g. an OpenAI-style function spec or a Claude tool_use block).
 */
const TOOL_DEFINITION_RE =
  /(?:"function_call"\s*:|"tool_use"\s*:|"tools"\s*:\s*\[|"tool_name"\s*:|function\s+definitions?\s*:)/i;

/**
 * Structural markers of a multi-turn instruction payload being echoed:
 * system/user/assistant roles in JSON or XML-style markup.
 */
const SYSTEM_ROLE_BLOCK_RE =
  /(?:"role"\s*:\s*"system"|<\s*system\s*>[\s\S]{10,}<\s*\/\s*system\s*>|<\s*instructions?\s*>[\s\S]{10,}<\s*\/\s*instructions?\s*>|\[\s*INST\s*\][\s\S]{10,}\[\/\s*INST\s*\])/i;

/**
 * Header names that should never expose agent instructions.
 */
const LEAKY_HEADER_NAMES_RE =
  /^(?:x-system-prompt|x-agent-instructions?|x-llm-prompt|x-ai-context|x-openai-system|x-anthropic-system|x-bot-instructions?)$/i;

/**
 * Markers that suggest a debug-mode echo of the model's instructions
 * inside an error or JSON response body.
 */
const DEBUG_ECHO_RE =
  /(?:"system_prompt"\s*:|"system_message"\s*:|"instructions"\s*:\s*"[^"]{50,}"|"agent_instructions"\s*:|"prompt_template"\s*:)/i;

// ---------------------------------------------------------------------------
// Helper utilities
// ---------------------------------------------------------------------------

/** Strip HTML tags, returning visible text only. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Extract content of HTML comments. */
function extractComments(html: string): string[] {
  const results: string[] = [];
  const re = /<!--([\s\S]*?)-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const content = m[1]?.trim() ?? '';
    if (content.length > 0) results.push(content);
  }
  return results;
}

/** Extract inline <script> content (non-src scripts). */
function extractInlineScripts(html: string): string[] {
  const results: string[] = [];
  const re = /<script(?![^>]+\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const content = m[1]?.trim() ?? '';
    if (content.length > 0) results.push(content);
  }
  return results;
}

/** Extract <meta> tag content values. */
function extractMetaContents(html: string): string[] {
  const results: string[] = [];
  const re = /<meta[^>]+content\s*=\s*["']([^"']{30,})["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const content = m[1]?.trim() ?? '';
    if (content.length > 0) results.push(content);
  }
  return results;
}

/** Truncate a string for embedding in gap evidence. */
function truncate(s: string, max = 200): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

// ---------------------------------------------------------------------------
// Two-signal corroboration check
//
// A "leak" is flagged only when BOTH a role-directive AND at least one of the
// structural markers co-occur in the same text block.  This prevents a single
// casual mention of "AI" from tripping the detector.
// ---------------------------------------------------------------------------

function detectInBlock(
  text: string,
  location: string
): LeakSignal | null {
  const hasRoleDirective = ROLE_DIRECTIVE_RE.test(text);
  const hasToolDef = TOOL_DEFINITION_RE.test(text);
  const hasSystemRoleBlock = SYSTEM_ROLE_BLOCK_RE.test(text);
  const hasInstructionKeyword = INSTRUCTION_KEYWORD_RE.test(text);
  const hasDebugEcho = DEBUG_ECHO_RE.test(text);

  // Highest confidence: a role directive + an explicit secrecy/instruction keyword
  if (hasRoleDirective && hasInstructionKeyword) {
    const match = text.match(ROLE_DIRECTIVE_RE)?.[0] ?? '';
    return {
      description: `Role-framing directive with instruction confidentiality keyword in ${location}`,
      evidence: truncate(`${match} … [instruction keyword found]`),
      severity: 'critical',
    };
  }

  // High confidence: system-role JSON/XML block containing a role directive
  if (hasSystemRoleBlock && hasRoleDirective) {
    return {
      description: `System-role payload block with role directive in ${location}`,
      evidence: truncate(text.match(SYSTEM_ROLE_BLOCK_RE)?.[0] ?? text),
      severity: 'high',
    };
  }

  // High confidence: tool/function definition echoed in page surface with role directive
  if (hasToolDef && hasRoleDirective) {
    return {
      description: `Tool/function definition block with role directive in ${location}`,
      evidence: truncate(text.match(TOOL_DEFINITION_RE)?.[0] ?? text),
      severity: 'high',
    };
  }

  // Medium confidence: debug echo of system prompt field in JSON
  if (hasDebugEcho && (hasRoleDirective || hasSystemRoleBlock)) {
    return {
      description: `Debug-mode system-prompt echo in ${location}`,
      evidence: truncate(text.match(DEBUG_ECHO_RE)?.[0] ?? text),
      severity: 'high',
    };
  }

  // Lower confidence: standalone debug echo field (without corroborating role directive)
  // Still worth flagging if the field name alone is a strong indicator
  if (hasDebugEcho && text.length > 100) {
    return {
      description: `Possible debug-mode prompt field echo in ${location}`,
      evidence: truncate(text.match(DEBUG_ECHO_RE)?.[0] ?? text),
      severity: 'medium',
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public detector
// ---------------------------------------------------------------------------

/**
 * Scan a captured page surface for signals that an AI system prompt or agent
 * instructions are exposed in its public surface.
 *
 * Accepts the `Route` shape from `route-inventory.schema.ts`, which now
 * includes the optional `headers` and `bodySnippet` fields.
 *
 * Returns an array of `Gap` objects with `category: 'prompt-leakage'`.
 * Returns an empty array when no signals are found.
 */
export function detectPromptLeakage(route: Pick<Route, 'path' | 'headers' | 'bodySnippet'>): Gap[] {
  const gaps: Gap[] = [];
  const path = route.path;

  const html = route.bodySnippet ?? '';

  // 1. Check inline scripts
  for (const script of extractInlineScripts(html)) {
    const signal = detectInBlock(script, 'inline-script');
    if (signal) {
      gaps.push({
        id: randomUUID(),
        path,
        severity: signal.severity,
        reason: signal.description,
        category: 'prompt-leakage',
        description: `Prompt-leakage signal detected in inline JavaScript: ${signal.evidence}`,
        recommendation: 'Remove agent instruction content from client-facing JavaScript. Never embed system prompts in frontend bundles or inline scripts.',
      });
    }
  }

  // 2. Check HTML comments
  for (const comment of extractComments(html)) {
    const signal = detectInBlock(comment, 'HTML-comment');
    if (signal) {
      gaps.push({
        id: randomUUID(),
        path,
        severity: signal.severity,
        reason: signal.description,
        category: 'prompt-leakage',
        description: `Prompt-leakage signal detected in HTML comment: ${signal.evidence}`,
        recommendation: 'Remove agent instructions from HTML comments. Comments are visible in page source.',
      });
    }
  }

  // 3. Check meta tag content
  for (const content of extractMetaContents(html)) {
    const signal = detectInBlock(content, 'meta-tag');
    if (signal) {
      gaps.push({
        id: randomUUID(),
        path,
        severity: signal.severity,
        reason: signal.description,
        category: 'prompt-leakage',
        description: `Prompt-leakage signal detected in meta tag: ${signal.evidence}`,
        recommendation: 'Remove agent instructions from HTML meta tags. Meta content is public.',
      });
    }
  }

  // 4. Check visible body text (stripped of tags)
  if (html.length > 0) {
    const visible = stripHtml(html);
    const signal = detectInBlock(visible, 'page-body');
    if (signal) {
      gaps.push({
        id: randomUUID(),
        path,
        severity: signal.severity,
        reason: signal.description,
        category: 'prompt-leakage',
        description: `Prompt-leakage signal detected in visible page body: ${signal.evidence}`,
        recommendation: 'Ensure agent instructions are never rendered into visible page content. Check debug/error pages.',
      });
    }
  }

  // 5. Check response headers
  const headers = route.headers ?? {};
  for (const [name, value] of Object.entries(headers)) {
    if (LEAKY_HEADER_NAMES_RE.test(name)) {
      gaps.push({
        id: randomUUID(),
        path,
        severity: 'critical',
        reason: `Response header "${name}" exposes agent configuration`,
        category: 'prompt-leakage',
        description: `Header "${name}: ${truncate(value, 80)}" should not be sent to clients.`,
        recommendation: `Remove the "${name}" response header. Agent configuration must never be transmitted to the browser.`,
      });
    }
  }

  // Deduplicate by (path + severity + reason) to avoid double-counting when
  // the same signal appears in multiple extraction contexts.
  const seen = new Set<string>();
  return gaps.filter((g) => {
    const key = `${g.path}::${g.severity}::${g.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
