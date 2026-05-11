# Contributing to qulib

Thanks for your interest in contributing. qulib is a small project focused on honest quality reporting for deployed web apps.

## Before opening a PR

1. Open an issue first if the change is non-trivial — saves wasted effort if the direction needs discussion.
2. Read `CLAUDE.md` — it documents the project's rules, branch conventions, and design principles.
3. Run `npm run build` and confirm it passes before submitting.

## Branch and commit conventions

- Branch from `main`
- Branch naming: `feature/short-description`, `fix/short-description`, `chore/short-description`
- Commit messages: `type: short description` (types: `feat`, `fix`, `chore`, `refactor`, `docs`)

## Design principle

The output must be honest. If qulib has not collected enough data to assess a deployment, it must say so — not report false confidence. PRs that hide failure modes will not be merged.

## Local development

```bash
git clone https://github.com/TapeshN/qulib.git
cd qulib
npm install
npm run build
```

## License

By contributing, you agree your contributions are licensed under the MIT License.
