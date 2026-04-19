# Migration Package Polish: Storage-Only IDs and Runnable Scaffolds

## Context

Two small issues with the current migration-package representation surfaced during review of the data-migrations work:

1. `computeMigrationId` in `packages/1-framework/3-tooling/migration/src/attestation.ts` hashes full canonicalised `fromContract` and `toContract` objects in addition to the `from` / `to` storage hashes that already live in `strippedMeta`. This makes `migrationId` sensitive to non-storage contract drift (operation renames, doc-string edits, anything in the contract that isn't part of the storage projection). The decision that migrations are storage-only artefacts has already been made; the hash needs to follow.

2. Class-flow `migration.ts` files emitted by `packages/3-mongo-target/1-mongo-target/src/core/render-typescript.ts` end with `Migration.run(import.meta.url, M)` and are designed to be invokable as standalone programs (running them prints the plan as JSON and exits). They are scaffolded without a shebang and without an executable bit, so users have to type `node ./migration.ts` instead of `./migration.ts`. The descriptor-flow scaffolder in `scaffolding.ts` produces non-runnable function-default-export files and is unaffected.

Manifest field `hints` came up during this discussion as a possibly-vestigial structure (the `used` and `applied` subfields are written as empty arrays everywhere and read by nothing). It is intentionally **out of scope** here — see [Non-goals](#non-goals).

## Decisions

- **Storage-only `migrationId`.** Drop the `canonicalFromContract` / `canonicalToContract` arms from `computeMigrationId`'s `partHashes`. Also strip `hints` from the manifest input to the hash so that re-shaping `hints` in a future change can't invalidate IDs. The `from` / `to` storage hashes remain in `strippedMeta` and continue to pin the migration to its bookends.
- **Manifest schema unchanged.** `fromContract` / `toContract` / `hints` stay on disk. Active readers (`migration plan`, `migration emit`, `migration apply`) still consume them. Removing them from the manifest is a separate, larger change coupled to writing contracts into the marker / ledger and is out of scope here.
- **Class-flow scaffolds become runnable.** Mongo's class-flow `renderTypeScript` (in `render-typescript.ts`) emits a shebang as the first line. The framework's `scaffoldMigrationTs` writes the file with mode `0o755` whenever the rendered content starts with `#!`. The descriptor-flow `mongoScaffolding.renderTypeScript` (in `scaffolding.ts`) is untouched.
- **Shebang runtime decided at scaffold time, frozen per file.** A small `detectScaffoldRuntime()` helper inspects globals (`Bun`, `Deno`) and falls back to `node`. The result is baked into the shebang of each scaffolded file. Authors regenerate or hand-edit if the project's runtime changes, which matches the "this is a Node project / a Bun project" mental model.
- **No `--experimental-strip-types` flag.** `.tool-versions` pins Node 24.13.0; native type stripping is on by default. Bun and Deno run TypeScript natively. Shebangs invoke the bare runtime binary.

## Scope

### In scope

- Edit `computeMigrationId` in `packages/1-framework/3-tooling/migration/src/attestation.ts`:
  - Add `hints: _hints` to the destructure that produces `strippedMeta`.
  - Remove `canonicalFromContract` / `canonicalToContract` and the contract-canonicalisation imports they require.
  - `partHashes` becomes `[canonicalManifest, canonicalOps].map(sha256Hex)`.
- Add `detectScaffoldRuntime()` and `shebangLineFor(runtime)` helpers in `packages/1-framework/3-tooling/migration/src/runtime-detection.ts`, exported via the existing `migration-ts` exports barrel.
- Edit `renderTypeScript` in `packages/3-mongo-target/1-mongo-target/src/core/render-typescript.ts` to prepend a shebang (selected via `detectScaffoldRuntime()`) as the first line of the returned string.
- Edit `scaffoldMigrationTs` in `packages/1-framework/3-tooling/migration/src/migration-ts.ts` to pass `{ mode: 0o755 }` to `writeFile` whenever the rendered content begins with `#!`.
- Update tests:
  - `packages/1-framework/3-tooling/migration/test/attestation.test.ts` — assert `migrationId` is unchanged when non-storage contract fields differ; assert `migrationId` changes when `from`, `to`, or `ops` change.
  - `packages/3-mongo-target/1-mongo-target/test/render-typescript.test.ts` — assert first line is `#!/usr/bin/env -S node` under default test env; assert `Migration.run(...)` line still emits.
  - `packages/1-framework/3-tooling/migration/test/migration-ts.test.ts` (or equivalent) — assert chmod side effect when content starts with `#!`, no chmod otherwise.
  - Update fixture manifests in `packages/3-mongo-target/1-mongo-target/test/`, `packages/2-mongo-family/9-family/test/`, and `examples/mongo-demo/migrations/**/migration.json` to refresh `migrationId` values that change as a result of the hash trim.

### Non-goals

- **Removing `fromContract` / `toContract` from the on-disk manifest.** Deferred until contracts live in the marker / ledger.
- **Reshaping or renaming `hints`.** The fields are unused (`used`, `applied`) or low-value-but-harmless (`plannerVersion`, `planningStrategy`). Touching them invalidates `migrationId`s in test fixtures across the repo and brings no operational benefit. Stripped from the hash so a future cleanup is free to reshape without ID churn.
- **Postgres scaffolder parity.** Postgres has no class-flow scaffolder today, no `Migration.run(...)` files, and no production migration-authoring flow. The shebang change applies to Mongo's `render-typescript.ts` only. Sequencing with Postgres is deferred along with the rest of Postgres migration-authoring.
- **Config-driven runtime override.** Scaffold-time auto-detection is sufficient for the "consistent per project" use case the user articulated. A `migrations.runtime` config knob can be added reactively if the auto-detection ever guesses wrong in practice.
- **Suppressing Node's `ExperimentalWarning` for type stripping.** Some Node 24.x releases still print this warning on first run of a `.ts` file. Acceptable noise; not suppressed at the shebang level so we don't hide the signal repo-wide.

## Design

### 1. Storage-only `migrationId`

Current implementation:

```18:43:packages/1-framework/3-tooling/migration/src/attestation.ts
export function computeMigrationId(manifest: MigrationManifest, ops: MigrationOps): string {
  const {
    migrationId: _migrationId,
    signature: _signature,
    fromContract: _fromContract,
    toContract: _toContract,
    ...strippedMeta
  } = manifest;

  const canonicalManifest = canonicalizeJson(strippedMeta);
  const canonicalOps = canonicalizeJson(ops);

  const canonicalFromContract =
    manifest.fromContract !== null ? canonicalizeContract(manifest.fromContract) : 'null';
  const canonicalToContract = canonicalizeContract(manifest.toContract);

  const partHashes = [
    canonicalManifest,
    canonicalOps,
    canonicalFromContract,
    canonicalToContract,
  ].map(sha256Hex);
  const hash = sha256Hex(canonicalizeJson(partHashes));

  return `sha256:${hash}`;
}
```

Proposed:

```ts
export function computeMigrationId(manifest: MigrationManifest, ops: MigrationOps): string {
  const {
    migrationId: _migrationId,
    signature: _signature,
    fromContract: _fromContract,
    toContract: _toContract,
    hints: _hints,
    ...strippedMeta
  } = manifest;

  const canonicalManifest = canonicalizeJson(strippedMeta);
  const canonicalOps = canonicalizeJson(ops);

  const partHashes = [canonicalManifest, canonicalOps].map(sha256Hex);
  const hash = sha256Hex(canonicalizeJson(partHashes));

  return `sha256:${hash}`;
}
```

`strippedMeta` after this change contains: `from`, `to`, `kind`, `labels`, `authorship?`, `createdAt`. Those plus `ops` are the full input to the hash. The `from` / `to` strings carry the storage-projection commitment that previously came (redundantly and over-broadly) from canonicalising the entire `Contract` objects.

The `canonicalizeContract` import becomes unused and is removed.

### 2. Runnable class-flow `migration.ts`

#### 2a. Runtime detection

New module `packages/1-framework/3-tooling/migration/src/runtime-detection.ts`:

```ts
export type ScaffoldRuntime = 'node' | 'bun' | 'deno';

export function detectScaffoldRuntime(): ScaffoldRuntime {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined') return 'bun';
  if (typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined') return 'deno';
  return 'node';
}

export function shebangLineFor(runtime: ScaffoldRuntime): string {
  switch (runtime) {
    case 'bun':
      return '#!/usr/bin/env -S bun';
    case 'deno':
      return '#!/usr/bin/env -S deno run -A';
    case 'node':
      return '#!/usr/bin/env -S node';
  }
}
```

Notes:

- `env -S` is required: without it `#!/usr/bin/env node` parses `node` as the entire interpreter argument and refuses additional tokens. With `-S`, the rest of the line is split into argv, which keeps the door open for future flags without rewriting every scaffolded file.
- Deno needs `run -A` because migration code freely imports from `node_modules` and may touch `process.env` / filesystem; `-A` keeps the shebang invocation working without ceremony, matching how teams typically run TS under Deno today. Granular permissions can be revisited if/when there's demand.
- The choice is frozen into each file at scaffold time. The user's framing — "this is a Node project / a Bun project" — is the source of truth: when the project's runtime changes, regenerate (or hand-edit) the shebangs.

Exported from `packages/1-framework/3-tooling/migration/src/exports/migration-ts.ts` so targets can import it.

#### 2b. Class-flow renderer emits a shebang

Edit `packages/3-mongo-target/1-mongo-target/src/core/render-typescript.ts` to prepend the shebang line to the array of file segments:

```ts
import { detectScaffoldRuntime, shebangLineFor } from '@prisma-next/migration-tools/migration-ts';

export function renderTypeScript(
  calls: ReadonlyArray<OpFactoryCall>,
  meta?: RenderMigrationMeta,
): string {
  const factoryNames = collectFactoryNames(calls);
  const imports = buildImports(factoryNames);
  const planBody = calls.map((c) => c.accept(renderCallVisitor)).join(',\n');
  const describeMethod = meta ? buildDescribeMethod(meta) : '';

  return [
    shebangLineFor(detectScaffoldRuntime()),
    imports,
    '',
    'class M extends Migration {',
    describeMethod,
    '  override plan() {',
    '    return [',
    indent(planBody, 6),
    '    ];',
    '  }',
    '}',
    '',
    'export default M;',
    'Migration.run(import.meta.url, M);',
    '',
  ].join('\n');
}
```

The descriptor-flow `mongoScaffolding.renderTypeScript` in `scaffolding.ts` is untouched — those files are not directly runnable and a shebang would mislead.

#### 2c. Framework writes the executable bit

Edit `packages/1-framework/3-tooling/migration/src/migration-ts.ts`:

```ts
export async function scaffoldMigrationTs(
  packageDir: string,
  options: ScaffoldOptions,
): Promise<void> {
  const context: MigrationScaffoldContext = {
    packageDir,
    ...(options.contractJsonPath !== undefined
      ? { contractJsonPath: options.contractJsonPath }
      : {}),
  };

  const content = options.scaffolding.renderTypeScript(options.plan, context);
  const isExecutable = content.startsWith('#!');
  await writeFile(
    join(packageDir, MIGRATION_TS_FILE),
    content,
    isExecutable ? { mode: 0o755 } : undefined,
  );
}
```

Detection by content prefix keeps the "target owns the file body, framework owns the I/O" split intact: the framework doesn't need to know what kind of file the target rendered, only whether the target opted into runnability via a shebang.

On Windows, `writeFile`'s `mode` is effectively a no-op. Users invoke `node migration.ts` (or `bun migration.ts`, etc.) explicitly. No Windows-specific code path required.

## Acceptance criteria

- **Hash trim is non-storage-insensitive.** Mutating a non-storage field on `manifest.toContract` (e.g. an operation's docstring) and recomputing `migrationId` returns the same value. Mutating `manifest.from`, `manifest.to`, or any element of `ops` returns a different value. Both assertions live in `attestation.test.ts`.
- **Hash trim is hints-insensitive.** Mutating `manifest.hints.plannerVersion` or `manifest.hints.planningStrategy` does not change `migrationId`. Asserted in `attestation.test.ts`.
- **Class-flow scaffolds are runnable on POSIX.** A scaffolded `migration.ts` from `render-typescript.ts` (a) has `#!/usr/bin/env -S node` (or the bun/deno equivalent under those runtimes) as its first line, (b) is mode `0o755` on disk after `scaffoldMigrationTs` runs, and (c) executes end-to-end (`./migration.ts` from the package dir) printing the plan as JSON. The end-to-end check extends an existing integration test in `packages/2-mongo-family/9-family/test/mongo-emit.test.ts` or `packages/3-mongo-target/1-mongo-target/test/migration-e2e.test.ts`.
- **Descriptor-flow scaffolds are unaffected.** A scaffolded file from `mongoScaffolding.renderTypeScript` (descriptor-flow) has no shebang and is written with default mode. Existing scaffolding tests stay green without modification.
- **Runtime detection respects the host.** Under a Bun harness, `detectScaffoldRuntime()` returns `'bun'` and the rendered shebang is `#!/usr/bin/env -S bun`. Under a Deno harness, returns `'deno'`. Otherwise `'node'`. Unit-tested by stubbing `globalThis.Bun` / `globalThis.Deno` in `runtime-detection.test.ts`.

## Risks / open questions

- **Existing test fixtures carry old `migrationId` values.** The hash trim invalidates them. Fixture refresh is part of the in-scope test work; reviewers should expect a sweep of golden-value updates rather than treat them as suspicious.
- **Node experimental warning.** Some Node 24.x releases print `ExperimentalWarning: Type Stripping is an experimental feature` on first load of a `.ts` file. If this becomes disruptive in CLI output (the inline-emit subprocess captures stderr), suppress reactively via `NODE_OPTIONS=--disable-warning=ExperimentalWarning` inside that subprocess. Not done preemptively.
- **`detectScaffoldRuntime()` false positives.** The check is type-of-globals. There is no realistic non-bun/non-deno environment that defines a `Bun` or `Deno` global, so false positives aren't a practical concern. If a future bundler injects either name as a stub, the check will need refinement (e.g. inspect `process.versions.bun`).
- **Class-flow renderer is currently exported but not yet wired through `MigrationScaffoldingCapability`.** That wiring is part of the broader data-migrations work. The shebang change here is a one-line edit to `render-typescript.ts` and remains correct regardless of how the renderer is eventually invoked. If the data-migrations work consolidates the two scaffolders into one with a flow flag, the shebang gate on the framework side (content starts with `#!`) keeps working unchanged.
