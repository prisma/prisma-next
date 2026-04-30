# Migration CLI: replace hand-rolled arg parser

Project workspace for [TML-2318](https://linear.app/prisma-company/issue/TML-2318/migration-cli-replace-handrolled-arg-parser-with-shared-cli-library).

## Artifacts

- [`spec.md`](./spec.md) — what we're changing and why; acceptance criteria.
- [`plan.md`](./plan.md) — commit-by-commit implementation sequence.
- [`research/commander-friction-points.md`](./research/commander-friction-points.md) — durable catalogue of the pain points the existing `@prisma-next/cli` Commander integration works around. Survives this project; expected to seed the broader Commander-replacement work later.

## Status

**Shaping → in-progress.** The Style Guide correction and main-CLI `--help`-routing fix have already landed (commit `d6ae32e59` on this branch); the spec and plan are ready for execution.

## Lifecycle reminder

This directory is transient. After the work merges, the close-out step deletes `projects/migration-cli-arg-parser/`. The friction-points research artifact relocates to whichever project workspace owns the broader Commander-replacement work, or to `docs/` if it predates that work.
