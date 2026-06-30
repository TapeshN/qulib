/** Env flag that opts a deployment back in to verbose error details (stack traces). */
export const EXPOSE_ERROR_DETAIL_ENV = 'QULIB_EXPOSE_ERROR_DETAIL';

/**
 * Safe `detail` for a caught error. A Node stack trace discloses the server's
 * absolute filesystem paths (and sometimes dependency internals), so by default
 * we suppress it — an MCP client should never receive it in production. Set
 * QULIB_EXPOSE_ERROR_DETAIL=1 to opt back in for local debugging.
 *
 * Use this for the `detail` argument to toolError wherever the detail is an
 * Error/stack; intentional, non-sensitive details (e.g. retry hints) can still
 * be passed to toolError directly.
 */
export function safeErrorDetail(err: unknown): string | undefined {
  if (process.env[EXPOSE_ERROR_DETAIL_ENV] !== '1') return undefined;
  if (err instanceof Error) return err.stack;
  if (err === undefined || err === null) return undefined;
  return String(err);
}

export function toolError(code: string, message: string, detail?: unknown): {
  content: [{ type: 'text'; text: string }];
} {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: { code, message, detail: detail ?? null } }, null, 2),
      },
    ],
  };
}
