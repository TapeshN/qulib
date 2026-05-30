---
"@qulib/core": patch
---

Order the `types` condition first in `package.json` `exports` so TypeScript
resolves the package's types correctly under `node16`/`nodenext` module
resolution. No runtime behavior change.
