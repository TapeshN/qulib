# quilib

An opinionated QA harness that analyzes deployed web apps and emits honest quality gap reports. Positioned as an AI-callable QA engineer — not just another browser automation wrapper. Built by Tapesh Nagarwal.

---

## RULES — READ BEFORE TOUCHING ANYTHING

### Git
- Never push directly to `main`. Always work on a branch.
- Branch naming: `feature/short-description`, `fix/short-description`, `chore/short-description`
- Run `git branch` to confirm which branch you are on before writing code.
- Commit messages follow `type: short description` (types: `feat`, `fix`, `chore`, `refactor`, `docs`).

### Code
- Read files before editing them.
- Do not install packages without explicitly stating what you are installing and why.
- Run `npm run build` before committing.
- The schemas in `packages/core/src/schemas/` use zod and are the source of truth. Never widen or relax them without justification.
- Do not add comments explaining what code does. Add comments only when the WHY is non-obvious.

### Design principle
The output must be honest. If quilib has not collected enough data to assess a deployment, it must say so — not report 100% confidence. False confidence is the worst possible failure mode for a QA tool.
