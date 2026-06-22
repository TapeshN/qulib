import { z } from 'zod';

/** Partial ground-truth for auth detection — only fields stated with confidence. */
export const GoldenSiteExpectedSchema = z
  .object({
    hasAuth: z.boolean().optional(),
    type: z.enum(['none', 'form-login', 'oauth', 'magic-link', 'unknown']).optional(),
    leaksPrompt: z.boolean().optional(),
  })
  .strict();

export const GoldenSiteSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'site id must be kebab-case'),
  url: z.string().url(),
  name: z.string().min(1),
  rationale: z.string().min(1).optional(),
  coverage_tags: z.array(z.string().min(1)).min(1),
  expected: GoldenSiteExpectedSchema,
});

export const GoldenManifestSchema = z.object({
  schemaVersion: z.literal(1),
  coverage_tags: z.array(z.string().min(1)).min(1),
  sites: z.array(GoldenSiteSchema),
});

export type GoldenSiteExpected = z.infer<typeof GoldenSiteExpectedSchema>;
export type GoldenSite = z.infer<typeof GoldenSiteSchema>;
export type GoldenManifest = z.infer<typeof GoldenManifestSchema>;
