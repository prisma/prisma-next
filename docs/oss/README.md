# OSS posture

This directory documents the **policies and posture** that govern Prisma Next as an open-source project — how decisions are made, how dependencies are managed, how releases are produced, and how external contributions are handled.

These pages are written for maintainers and curious contributors who want to understand the *reasoning* behind a policy, not just the rule itself. Audience-facing documents that GitHub surfaces by convention — [`CONTRIBUTING.md`](../../CONTRIBUTING.md), [`SECURITY.md`](../../SECURITY.md), [`CODE_OF_CONDUCT.md`](../../CODE_OF_CONDUCT.md), [`LICENSE`](../../LICENSE) — remain the primary entry points for their respective audiences. The pages here cross-reference those files; they don't duplicate them.

## Audience map

| If you are… | Read… |
| --- | --- |
| A would-be contributor | [`CONTRIBUTING.md`](../../CONTRIBUTING.md) |
| Reporting a vulnerability | [`SECURITY.md`](../../SECURITY.md) |
| A current or prospective maintainer | [Governance](./governance.md) |
| Curious about supply-chain hygiene | [Supply chain](./supply-chain.md) |
| Looking for release cadence / support windows | *(see "Deferred" below)* |
| Looking for the fork-PR / review policy | *(see "Deferred" below)* |

## Pages in this directory

- [`governance.md`](./governance.md) — Maintainer team, decision-making model, DCO basis, ADR pointer.
- [`supply-chain.md`](./supply-chain.md) — License declarations, NOTICE audit, npm provenance, Dependabot soak window.

## Deferred

Two policy areas are deliberately not yet written down here, because the underlying decisions are still being settled:

- **Release policy** (cadence, dist-tags, support windows). The pre-1.0 stance is captured in [`CONTRIBUTING.md`](../../CONTRIBUTING.md#status--please-read-first) and [`SECURITY.md`](../../SECURITY.md). The post-1.0 stance follows [Prisma's established practice in `prisma/prisma`](https://github.com/prisma/prisma) — regular release cadence, majors supported for 12 months — and will be written down in detail closer to 1.0.
- **Review and fork-PR policy** (CODEOWNERS routing rules, mandatory-review gates, fork-PR workflow approval level). The merge-time half (CODEOWNERS + required reviews) is in place; the run-time fork-PR posture is still being tuned.

When those decisions settle, they will land as `release-policy.md` and `reviews.md` in this directory.
