import { z } from 'zod';

export const A11yViolationSchema = z.object({
  id: z.string(),
  impact: z.string(),
  helpUrl: z.string(),
  nodeCount: z.number().int(),
});

export const BrokenLinkSchema = z.object({
  url: z.string(),
  status: z.number().nullable(),
  reason: z.string().optional(),
});

export const RouteSchema = z.object({
  path: z.string(),
  pageTitle: z.string(),
  links: z.array(z.string()),
  formCount: z.number().int(),
  buttonLabels: z.array(z.string()),
  consoleErrors: z.array(z.string()),
  brokenLinks: z.array(BrokenLinkSchema),
  a11yViolations: z.array(A11yViolationSchema),
  statusCode: z.number().int().optional(),
  /** Optional: response headers from the page fetch (populated by explorers that capture them). */
  headers: z.record(z.string(), z.string()).optional(),
  /** Optional: first ~4000 chars of the raw HTML body (populated by explorers that capture it). */
  bodySnippet: z.string().max(8000).optional(),
});

export const RouteInventorySchema = z.object({
  scannedAt: z.string().datetime(),
  baseUrl: z.string().url(),
  routes: z.array(RouteSchema),
  pagesSkipped: z.number().int(),
  budgetExceeded: z.boolean(),
});

export type RouteInventory = z.infer<typeof RouteInventorySchema>;
export type Route = z.infer<typeof RouteSchema>;
