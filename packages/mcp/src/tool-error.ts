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
