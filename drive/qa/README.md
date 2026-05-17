# Drive · QA — Prisma Next

> **Orchestrator-authored scaffold.** This file was created during an unattended run of `drive-orchestrate-plan` to satisfy the hard-error contract in `drive-qa-plan` / `drive-qa-run`. The `drive-bootstrap-context` skill is not installed here yet; refine this scaffold once a human is back in the loop.

Project-context bootstrap used by the `drive-qa-plan` and `drive-qa-run` skills when authoring manual-QA scripts and running them against this repo.

## Consumer audiences

Manual-QA scripts in this repo are written for two audiences:

- **CLI users** — humans driving `prisma-next` from a shell against a real project tree. Scenarios should call out copy-paste shell commands, observable diagnostic output, and the legibility of `--help`/error text.
- **Agent users** — AI agents invoking `prisma-next` programmatically with structured (`--json`) output. Scenarios that touch error envelopes, exit codes, or `--json` shapes should verify both human and agent variants where applicable.

## Substrate locations

Code substrates that QA scenarios typically exercise:

- `packages/1-framework/3-tooling/cli/` — CLI entry point, command registration, help/error formatters.
- `packages/1-framework/3-tooling/migration/` — migration planner, runner, reference resolver, marker / ledger machinery.
- `packages/1-framework/3-tooling/contract/` — contract emission, signing.
- `examples/prisma-next-demo/` — the example app that QA scenarios usually drive against (rather than a synthetic fixture). If the spec references a CLI surface, locate a matching journey here.
- `test/integration/test/cli-journeys/` — automated journey suite that mirrors the user-facing CLI surface. The journey tests are the closest CI analogue to QA scenarios; QA scenarios target the gaps they cannot meaningfully assert (diagnostic clarity, end-to-end command sequences, judgement-class observations).

## Standard validation gate set (inherited from `AGENTS.md`)

Default DoD gates for a QA-relevant PR:

```bash
pnpm typecheck          # always
pnpm test:packages      # always (when source / test code changed)
pnpm lint:deps          # when imports / exports / architectural structure changed
pnpm test:integration   # when changes touch PGlite / PG / mongo paths
pnpm test:e2e           # when changes touch emit / migrate / run cycle
pnpm fixtures:check     # when IR / emitter / serialiser changed
```

A clean pre-QA tree means `pnpm typecheck && pnpm test:packages && pnpm fixtures:check` all green. QA against an unverified tree wastes the runner's time discovering broken assertions that a 1-minute `pnpm test:packages` would have surfaced (see `agile-agent-orchestration/calibration/prisma-next.md § 3.7`).

## Known coverage-gate gaps

QA's comparative advantage over CI in this repo is **judgement-class observation**: `pnpm test:packages` and `pnpm test:e2e` exercise structural shape and exit codes; they do not verify

- `--help` text legibility, freshness, or cross-reference correctness
- Error envelope copy quality (`fix:` lines, suggested verbs)
- Multi-command developer-journey breaks (running command A then B then C as a real user would)
- Output legibility (table formatting, JSON envelope shape against `--json` consumers' expectations)
- Negative-control gate behaviour (whether a lint / strict throw actually fires on a planted violation; CI only checks today's clean tree)

Manual-QA scripts should preferentially target these gaps. Re-running the automated suite is **not** a QA scenario.

## Fixture catalogue

QA scripts that need a non-trivial fixture should refer to existing demos and journey fixtures rather than constructing one inline:

- `examples/prisma-next-demo/` — full canonical demo (schema, contract, migrations, runtime example).
- `test/integration/test/cli-journeys/` — per-journey fixtures and helpers (`journey-test-helpers.ts`).

If a script needs a fixture that does not exist in the catalogue, surface that gap to `drive-qa-plan` and append the new fixture to this section on completion.

## Where QA artefacts live

- **Script:** `projects/<project>/manual-qa.md` (or `projects/<project>/manual-qa/<milestone>.md` if split).
- **Report:** `projects/<project>/manual-qa-reports/<YYYY-MM-DD>-<runner>.md`.
- **Artefacts referenced by findings:** `projects/<project>/manual-qa-reports/artefacts/F-<N>/`.

Per-project. Both `drive-qa-plan` and `drive-qa-run` enforce these locations.

## When this file should change

Append (rather than overwrite) when any of the following surface during a QA round:

- A new consumer audience the existing two categories don't cover.
- A new substrate location that QA scripts repeatedly touch.
- A coverage-gate gap previously not enumerated.
- A reusable fixture worth adding to the catalogue.

Reduce or remove (with explanation) when an entry is no longer relevant.
