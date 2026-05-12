import { z } from 'zod';

export type ExplorerType = 'playwright' | 'cypress';
export type AdapterType = 'playwright' | 'cypress-e2e' | 'cypress-component' | 'api' | 'accessibility';

const FormLoginAuthSchema = z.object({
  type: z.literal('form-login'),
  loginUrl: z.string(),
  credentials: z.object({
    username: z.string(),
    password: z.string(),
  }),
  selectors: z.object({
    username: z.string(),
    password: z.string(),
    submit: z.string(),
  }),
  successIndicator: z.object({
    urlContains: z.string().optional(),
    selectorVisible: z.string().optional(),
  }),
});

const StorageStateAuthSchema = z.object({
  type: z.literal('storage-state'),
  path: z.string(),
});

export const AuthConfigSchema = z.discriminatedUnion('type', [FormLoginAuthSchema, StorageStateAuthSchema]);

export type FormLoginAuthConfig = z.infer<typeof FormLoginAuthSchema>;
export type StorageStateAuthConfig = z.infer<typeof StorageStateAuthSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export const HarnessConfigSchema = z.object({
  maxPagesToScan: z.number().int().positive(),
  maxDepth: z.number().int().positive(),
  minPagesForConfidence: z.number().int().min(1).default(3),
  timeoutMs: z.number().int().positive(),
  retryCount: z.number().int().min(0),
  llmTokenBudget: z.number().int().positive(),
  testGenerationLimit: z.number().int().positive(),
  readOnlyMode: z.boolean(),
  requireHumanReview: z.boolean(),
  failOnConsoleError: z.boolean(),
  explorer: z.enum(['playwright', 'cypress']).default('playwright'),
  defaultAdapter: z.enum(['playwright', 'cypress-e2e', 'cypress-component', 'api', 'accessibility']).default('playwright'),
  adapters: z.array(z.enum(['playwright', 'cypress-e2e', 'cypress-component', 'api', 'accessibility'])).default(['playwright']),
  auth: AuthConfigSchema.optional(),
});

export type HarnessConfig = z.infer<typeof HarnessConfigSchema>;

export const DetectedAuthSchema = z.object({
  hasAuth: z.boolean(),
  type: z.enum(['none', 'form-login', 'oauth', 'magic-link', 'unknown']),
  provider: z.string().nullable(),
  loginUrl: z.string().nullable(),
  observedSelectors: z
    .object({
      usernameSelector: z.string().nullable(),
      passwordSelector: z.string().nullable(),
      submitSelector: z.string().nullable(),
    })
    .nullable(),
  oauthButtons: z.array(
    z.object({
      provider: z.string(),
      text: z.string(),
    })
  ),
  recommendation: z.string(),
});

export type DetectedAuth = z.infer<typeof DetectedAuthSchema>;

export const AuthPathRequirementsSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('storage-state'), instruction: z.string() }),
  z.object({
    method: z.literal('credentials'),
    fields: z.array(
      z.object({
        name: z.string(),
        label: z.string(),
        type: z.enum(['text', 'password', 'email', 'select', 'checkbox']),
        observedOptions: z.array(z.string()).default([]),
      })
    ),
  }),
  z.object({ method: z.literal('unknown'), instruction: z.string() }),
]);

export const AuthPathSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['oauth', 'oauth-unknown', 'form-login', 'form-multi', 'magic-link', 'unknown']),
  provider: z.string().nullable(),
  source: z.enum(['built-in', 'user-local', 'heuristic']),
  automatable: z.boolean(),
  confidence: z.enum(['high', 'medium', 'low']),
  requirements: AuthPathRequirementsSchema,
});

export const AuthExplorationSchema = z.object({
  url: z.string(),
  authRequired: z.boolean(),
  authScope: z.enum(['site-wide', 'section-only', 'optional', 'none']),
  authPaths: z.array(AuthPathSchema),
  observedAt: z.string(),
  suggestedAgentBehavior: z.string(),
  unrecognizedButtons: z
    .array(
      z.object({
        label: z.string(),
        hint: z.string(),
      })
    )
    .default([]),
});

export type AuthPathRequirements = z.infer<typeof AuthPathRequirementsSchema>;
export type AuthPath = z.infer<typeof AuthPathSchema>;
export type AuthExploration = z.infer<typeof AuthExplorationSchema>;
