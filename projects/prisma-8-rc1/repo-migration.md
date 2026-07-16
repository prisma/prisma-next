# The repository and package migration

The mechanical half of the release: moving the code into `prisma/prisma`, and taking over the `prisma` name on npm without breaking anyone.

## Target shape

```
prisma/prisma
├── main            ← becomes Prisma Next (after the final merge)
├── v8              ← staging branch until release week
└── v7              ← Prisma 7 maintenance (bug fixes, 12 months from 8.0.0 final)

tags: v7.x.y (existing) · v8.0.0-rc.1 · v8.0.0 (later)
```

On npm:

- **`prisma`** — becomes the Prisma 8 CLI package (a thin, binary-only package; importing it is deliberately an error). The RC publishes under a dist-tag other than `latest`, so `npm install prisma` keeps installing v7 until 8.0.0 final.
- **`@prisma/postgres`, `@prisma/sqlite`, `@prisma/mongo`** — the per-database packages users import, renamed from `@prisma-next/*`. These are the *only* scoped packages that get renamed: they plus the CLI are the entire supported import surface, so renaming just them keeps the frozen-name set small.
- **All other `@prisma-next/*` packages** (~60 of them) — unchanged. They're implementation detail, installed transitively. A later, non-breaking consolidation bundles them into the CLI package and stops publishing them; that's explicitly after the RC.
- **The old `prisma-next` package** — gets a deprecation notice pointing users at `prisma`.

The CLI installs two binaries: `prisma` and `prisma-next`. This is the parallel-install answer (see [parallel-install.md](parallel-install.md)): in a project that has both versions, v7 keeps owning the `prisma` command so existing scripts don't break, and users drive v8 as `prisma-next` — the command EA users already know — until they remove v7.

## Concrete steps

### Now (longest lead items, in parallel)

1. **Dry-run the history merge in a fork.** Decide how v7 history and prisma-next history combine (graft vs parallel histories), execute it in a fork, and check the result: log readability, blame, tags, repository size.
2. **Create the `v8` branch in prisma/prisma** from the dry-run recipe and get the full CI suite green on it. It stays green from now until release week — merge mechanics must never be a last-week discovery.
3. **npm publish configuration.** We already hold publish permissions on the `prisma` package, so nothing here waits on anyone outside the project. What remains is config work: extend the package's trusted-publisher (OIDC) configuration to our publish workflow once it lives in prisma/prisma, do the same for the renamed database packages (trusted publishing is per-package, and renamed packages count as new), and do one dry-run publish under a throwaway dist-tag to confirm v7's release automation is undisturbed.
4. **Check name availability.** Confirm `@prisma/postgres`, `@prisma/sqlite`, and `@prisma/mongo` don't collide with anything classic Prisma already publishes under `@prisma/*` (it owns many names there: `client`, `config`, `engines`, the `adapter-*` family, …).

### Release week (July 28–31)

5. **Version everything to `8.0.0-rc.1`.** One command — the repository versions all packages in lockstep.
6. **Execute the rename** of the CLI package and the three per-database packages, including their trusted-publisher configuration (it's per-package, and renamed packages count as new).
7. **Cut the `v7` branch** with working CI.
8. **Merge `v8` into `main`.**
9. **Triage the open v7 issues and pull requests.** Close everything except v7 bug reports; post a pinned issue explaining the change and use a saved reply linking to it. This deliberately happens at merge time, not earlier — doing it before there's an announcement to point at just generates weeks of confusion.
10. **Publish** under the non-`latest` dist-tag. Verify: `npm install prisma` still yields v7; installing the RC tag yields v8; both binaries work.
11. **Deprecation notice** on the old `prisma-next` package.
12. **Announce.**

## Explicitly parked

Renaming the repository or organization (e.g. `prisma/prisma-orm`, to decouple the company name from the ORM). GitHub redirects make this cheap at any time, so it doesn't need to share a window with everything above.
