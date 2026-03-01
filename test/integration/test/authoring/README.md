# Authoring parity integration tests

This directory contains the fixture-driven TS↔PSL authoring parity harness for integration tests.

## What this suite verifies

The runner in `cli.emit-parity-fixtures.test.ts` validates parity between:

- TS contract authoring (`contract.ts`)
- PSL contract authoring (`schema.prisma`)

For each parity case it asserts:

- normalized IR parity (`validateContractIR`)
- emitted canonical `contract.json` parity
- hash parity (`storageHash`, `profileHash`, and `executionHash` when present)
- determinism (repeated emits are byte-equivalent for `contractJson`)
- provenance invariants (no canonical `sources` metadata in emitted contract)

It also includes diagnostics coverage from invalid PSL fixture inputs.

## Directory layout

`parity/<case>/` contains one parity case:

- `schema.prisma` — PSL input
- `contract.ts` — TS authoring equivalent
- `packs.ts` — shared pack composition used by both providers
- `expected.contract.json` — expected canonical artifact snapshot

`diagnostics/<case>/` contains invalid PSL inputs used to assert diagnostics behavior.

## How tests are executed

The test runner uses helpers in `authoring-parity-test-helpers.ts` to:

1. discover parity cases from `parity/*`
2. validate required files exist
3. create a temporary integration fixture app test directory
4. copy case runtime inputs (`schema.prisma`, `contract.ts`, `packs.ts`) into the temp directory
5. generate TS + PSL config files used by the emit flow

This keeps fixture data colocated with the runner while still using the existing integration fixture app runtime resolution model.

`expected.contract.json` remains source-of-truth in the fixture directory and is read/written directly there (it is not copied into temp dirs).

## Commands

Run only this suite:

```bash
pnpm --filter @prisma-next/integration-tests exec vitest run test/authoring/cli.emit-parity-fixtures.test.ts
```

Run parity suite and existing emit regression:

```bash
pnpm --filter @prisma-next/integration-tests exec vitest run test/authoring/cli.emit-parity-fixtures.test.ts
pnpm --filter @prisma-next/integration-tests exec vitest run test/cli.emit-command.test.ts
```

Update expected snapshots for parity cases:

```bash
UPDATE_AUTHORING_PARITY_EXPECTED=1 pnpm --filter @prisma-next/integration-tests exec vitest run test/authoring/cli.emit-parity-fixtures.test.ts
```
