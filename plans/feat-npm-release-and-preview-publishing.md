# feat: npm Release & Preview Publishing Pipeline

## Overview

Set up automated npm publishing for all 33 `@prisma-next/*` packages:
- **Auto dev releases** on every merge to `main` (tagged `dev` on npm)
- **Manual stable releases** via `workflow_dispatch` (tagged `latest` on npm)
- **Preview releases** via `pkg.pr.new` on PRs and pushes to `main`
- **npm OIDC Trusted Publishing** (no long-lived tokens)

## Problem Statement

The `publish.yml` workflow exists but:
1. Only triggers on `workflow_dispatch` (manual) -- no automatic dev releases on merge
2. Missing `NODE_AUTH_TOKEN` / OIDC configuration -- publish step will fail
3. No `NPM_CONFIG_PROVENANCE` -- no supply-chain provenance attestations
4. No `repository` field in any `package.json` -- required for OIDC provenance validation
5. `pkg.pr.new` workflow works but uses `--comment=off`, so users have no discoverable install URLs

## Proposed Solution

### Phase 1: Fix publish.yml for OIDC Trusted Publishing

**File: `.github/workflows/publish.yml`**

Changes needed:

1. **Add `push` trigger** for auto dev releases on merge to `main`:
   ```yaml
   on:
     push:
       branches: [main]
       tags: ["!**"]
     workflow_dispatch:
       inputs:
         version: ...
         dist-tag: ...
   ```

2. **Add `NPM_CONFIG_PROVENANCE: true`** env var on the publish step

3. **Pass `GITHUB_EVENT_NAME` and `PR_NUMBER`** env vars to `determine-version.ts` for the auto-calculated path:
   ```yaml
   - name: Determine version
     id: version
     env:
       GITHUB_EVENT_NAME: ${{ github.event_name }}
       INPUT_VERSION: ${{ github.event.inputs.version }}
       INPUT_TAG: ${{ github.event.inputs.dist-tag }}
     run: |
       if [ -n "$INPUT_VERSION" ]; then
         # ... existing manual version logic ...
       else
         node scripts/determine-version.ts
       fi
   ```
   The `determine-version.ts` script already handles `push` events by generating `X.Y.Z-dev.N` versions with the `dev` dist-tag.

4. **Keep `id-token: write`** (already present) and **do NOT set `NODE_AUTH_TOKEN`** -- npm will fall through to OIDC automatically.

5. **Remove the `if: github.ref == 'refs/heads/main'` guard on the job** since the `push` trigger already constrains to `main`. (Or keep it as a safety net -- either way works.)

### Phase 2: Add `repository` field to all publishable package.json files

**Required for npm provenance attestation.** Without it, OIDC publish will fail.

Add to every non-private `package.json` under `packages/`:

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/prisma/prisma-next.git",
    "directory": "<path-to-package>"
  }
}
```

All 33 packages need this:

| npm Package Name | `directory` Value |
|---|---|
| `@prisma-next/core-control-plane` | `packages/1-framework/1-core/migration/control-plane` |
| `@prisma-next/core-execution-plane` | `packages/1-framework/1-core/runtime/execution-plane` |
| `@prisma-next/contract` | `packages/1-framework/1-core/shared/contract` |
| `@prisma-next/operations` | `packages/1-framework/1-core/shared/operations` |
| `@prisma-next/plan` | `packages/1-framework/1-core/shared/plan` |
| `@prisma-next/utils` | `packages/1-framework/1-core/shared/utils` |
| `@prisma-next/contract-authoring` | `packages/1-framework/2-authoring/contract` |
| `@prisma-next/psl-parser` | `packages/1-framework/2-authoring/psl-parser` |
| `@prisma-next/contract-ts` | `packages/1-framework/2-authoring/contract-ts` |
| `@prisma-next/ids` | `packages/1-framework/2-authoring/ids` |
| `@prisma-next/cli` | `packages/1-framework/3-tooling/cli` |
| `@prisma-next/emitter` | `packages/1-framework/3-tooling/emitter` |
| `@prisma-next/eslint-plugin` | `packages/1-framework/3-tooling/eslint-plugin` |
| `@prisma-next/vite-plugin-contract-emit` | `packages/1-framework/3-tooling/vite-plugin-contract-emit` |
| `@prisma-next/runtime-executor` | `packages/1-framework/4-runtime-executor` |
| `@prisma-next/sql-contract` | `packages/2-sql/1-core/contract` |
| `@prisma-next/sql-errors` | `packages/2-sql/1-core/errors` |
| `@prisma-next/sql-operations` | `packages/2-sql/1-core/operations` |
| `@prisma-next/sql-schema-ir` | `packages/2-sql/1-core/schema-ir` |
| `@prisma-next/sql-contract-ts` | `packages/2-sql/2-authoring/contract-ts` |
| `@prisma-next/sql-contract-emitter` | `packages/2-sql/3-tooling/emitter` |
| `@prisma-next/family-sql` | `packages/2-sql/3-tooling/family` |
| `@prisma-next/sql-orm-lane` | `packages/2-sql/4-lanes/orm-lane` |
| `@prisma-next/sql-lane-query-builder` | `packages/2-sql/4-lanes/query-builder` |
| `@prisma-next/sql-relational-core` | `packages/2-sql/4-lanes/relational-core` |
| `@prisma-next/sql-lane` | `packages/2-sql/4-lanes/sql-lane` |
| `@prisma-next/sql-runtime` | `packages/2-sql/5-runtime` |
| `@prisma-next/integration-kysely` | `packages/3-extensions/integration-kysely` |
| `@prisma-next/extension-pgvector` | `packages/3-extensions/pgvector` |
| `@prisma-next/target-postgres` | `packages/3-targets/3-targets/postgres` |
| `@prisma-next/adapter-postgres` | `packages/3-targets/6-adapters/postgres` |
| `@prisma-next/driver-postgres` | `packages/3-targets/7-drivers/postgres` |
| `@prisma-next/postgres` | `packages/3-targets/8-clients/postgres` |

### Phase 3: Configure Trusted Publishers on npmjs.com (manual step)

For **each** of the 33 packages on npmjs.com:

1. Go to `https://www.npmjs.com/package/@prisma-next/<name>/access`
2. Under "Trusted Publishers", click "Add a trusted publisher"
3. Configure:
   - **Provider**: GitHub Actions
   - **Organization**: `prisma`
   - **Repository**: `prisma-next`
   - **Workflow filename**: `publish.yml`
   - **Environment**: _(leave empty)_

> **Note**: Trusted Publishing can only be configured on packages that already exist on npmjs.com. For any package that hasn't been published yet, the first publish must be done manually or with a granular access token, then Trusted Publishing can be configured afterward.

### Phase 4: Improve pkg.pr.new Preview Workflow

**File: `.github/workflows/preview-publish.yml`**

Current state is functional. Recommended improvements:

1. **Enable PR comments** -- switch `--comment=off` to `--comment=update` so contributors see install URLs directly on the PR:
   ```yaml
   - name: Publish to pkg.pr.new
     run: pnpm dlx pkg-pr-new@0.0.62 publish --pnpm --comment=update ${{ steps.packages.outputs.list }}
   ```

2. **Consider using `--compact`** for shorter URLs (requires `repository` field in package.json -- which Phase 2 adds):
   ```yaml
   run: pnpm dlx pkg-pr-new@0.0.62 publish --pnpm --compact --comment=update ${{ steps.packages.outputs.list }}
   ```

### Phase 5 (Optional): Remove `@changesets/cli` from devDependencies

Since we're keeping the custom `determine-version.ts` / `set-version.ts` scripts, the unused `@changesets/cli` dependency should be removed to avoid confusion:

```bash
pnpm remove @changesets/cli
```

---

## pkg.pr.new: How to Install Preview Packages

Once the `pkg.pr.new` GitHub App is installed on the `prisma/prisma-next` repo and a PR or push to `main` triggers the workflow, packages are available at:

### URL Format (long form -- current default)

```
https://pkg.pr.new/prisma/prisma-next/@prisma-next/<package>@<commit-sha>
```

### URL Format (compact -- if `--compact` is added)

```
https://pkg.pr.new/@prisma-next/<package>@<commit-sha>
```

### Install Commands

```bash
# Install a specific package from a PR commit
pnpm add https://pkg.pr.new/prisma/prisma-next/@prisma-next/sql-runtime@abc1234

# Install the CLI
pnpm add https://pkg.pr.new/prisma/prisma-next/@prisma-next/cli@abc1234

# Install the full Postgres client
pnpm add https://pkg.pr.new/prisma/prisma-next/@prisma-next/postgres@abc1234

# Using npm
npm install https://pkg.pr.new/prisma/prisma-next/@prisma-next/sql-runtime@abc1234

# Force all transitive deps to use preview (pnpm overrides)
# In package.json:
{
  "pnpm": {
    "overrides": {
      "@prisma-next/sql-runtime": "https://pkg.pr.new/prisma/prisma-next/@prisma-next/sql-runtime@abc1234"
    }
  }
}
```

### Prerequisites for pkg.pr.new

The `pkg.pr.new` GitHub App must be installed on the repo:
- Install from: https://github.com/apps/pkg-pr-new
- Select the `prisma/prisma-next` repository

---

## Technical Considerations

### OIDC Gotchas

- **`NODE_AUTH_TOKEN` must NOT be set** -- even as an empty string. If set, npm uses it instead of OIDC and fails. The `setup-node` action creates an `.npmrc` referencing `${NODE_AUTH_TOKEN}`, but if the env var is unset at runtime, npm falls through to OIDC.
- **Private repos cannot generate provenance attestations** -- the OIDC publish itself works, but provenance is only attached for public repos.
- **Workflow filename must match exactly** -- the Trusted Publisher config on npmjs.com expects `publish.yml` (not `publish.yaml`, not a path).
- **Case-sensitive matching** -- the org name `prisma` must match exactly (not `Prisma`).

### Version Strategy (Existing -- No Changes)

The existing `determine-version.ts` script handles:
- **`push` to `main`**: Generates `X.Y.Z-dev.N` with dist-tag `dev`
- **`workflow_dispatch`**: Uses provided version + dist-tag (for stable releases)
- **`pull_request`**: Generates `X.Y.Z-pr.N.M` with dist-tag `pr` (not used by current publish.yml, only by determine-version.ts)

### pnpm and OIDC Compatibility

`pnpm publish` delegates to `npm publish` under the hood. As long as npm >= 11.5.1 is available (Node 24.13.0 ships with npm 11.6.2), OIDC works seamlessly.

---

## Acceptance Criteria

### Functional Requirements
- [x] Every merge to `main` auto-publishes all 33 packages to npm with `dev` dist-tag
- [x] Manual `workflow_dispatch` can publish with custom version and dist-tag
- [x] npm provenance attestations are attached to published packages
- [x] No long-lived npm tokens -- only OIDC Trusted Publishing
- [x] `pkg.pr.new` publishes preview packages on PRs and pushes to `main`
- [x] PR comments show install URLs for preview packages (if `--comment=update` is adopted)

### Non-Functional Requirements
- [x] All `package.json` files include `repository` field
- [ ] Trusted Publishers configured for all 33 packages on npmjs.com (manual step)
- [ ] `pkg.pr.new` GitHub App installed on `prisma/prisma-next` (manual step)

---

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| New packages not yet on npmjs.com can't use Trusted Publishing | First publish manually, then configure Trusted Publishing |
| OIDC token claims mismatch causes 404 on publish | Verify org name, repo name, workflow filename exactly match |
| `NODE_AUTH_TOKEN` accidentally set in future | Add comment in workflow explaining why it must be unset |
| pnpm OIDC support breaks in future | Pin pnpm version; monitor pnpm/pnpm#9812 |

---

## References

- [npm Trusted Publishing docs](https://docs.npmjs.com/trusted-publishers/)
- [npm Provenance docs](https://docs.npmjs.com/generating-provenance-statements/)
- [GitHub OIDC for npm GA announcement (July 2025)](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/)
- [Phil Nash: Things you need to do for npm trusted publishing (Jan 2026)](https://philna.sh/blog/2026/01/28/trusted-publishing-npm/)
- [pnpm OIDC support discussion](https://github.com/pnpm/pnpm/issues/9812)
- [pkg.pr.new GitHub](https://github.com/stackblitz-labs/pkg.pr.new)
- [pkg.pr.new GitHub App](https://github.com/apps/pkg-pr-new)
- Existing workflows: `.github/workflows/publish.yml`, `.github/workflows/preview-publish.yml`
- Existing scripts: `scripts/determine-version.ts`, `scripts/set-version.ts`, `scripts/list-publishable-packages.mjs`
