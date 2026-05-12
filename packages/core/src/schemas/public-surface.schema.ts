import { z } from 'zod';
import { GapSchema } from './gap-analysis.schema.js';
import { A11yViolationSchema, BrokenLinkSchema, RouteSchema } from './route-inventory.schema.js';

export const PublicSurfaceViolationSchema = A11yViolationSchema.extend({
  path: z.string(),
});

export const PublicSurfaceBrokenLinkSchema = BrokenLinkSchema.extend({
  path: z.string(),
});

export const PublicSurfaceSchema = z.object({
  pages: z.array(RouteSchema),
  gaps: z.array(GapSchema),
  accessibilityViolations: z.array(PublicSurfaceViolationSchema),
  brokenLinks: z.array(PublicSurfaceBrokenLinkSchema),
});

export type PublicSurface = z.infer<typeof PublicSurfaceSchema>;
export type PublicSurfaceViolation = z.infer<typeof PublicSurfaceViolationSchema>;
export type PublicSurfaceBrokenLink = z.infer<typeof PublicSurfaceBrokenLinkSchema>;
