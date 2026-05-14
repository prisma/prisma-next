# `@prisma-next/agent-skill`

Agent skills for [Prisma Next](https://github.com/prisma/prisma-next) — a small
set of `SKILL.md` files that teach an LLM agent how to operate Prisma Next
end-to-end without re-deriving the API from documentation each time.

> **Edit your data contract. Prisma handles the rest.**

## What's in the box

One package, ten skills. Each skill is a `SKILL.md` with its own
`description` field that an agent runtime matches against the user's prompt:

| Skill | Scope |
|---|---|
| `prisma-next` | Router — catches vague prompts and routes to a specific skill. |
| `prisma-next-quickstart` | Adoption: greenfield projects and brownfield databases. |
| `prisma-next-contract` | Contract authoring — PSL, TS builder, no-emit. |
| `prisma-next-migrations` | Migration authoring — `db update`, `migration plan`, data transforms. |
| `prisma-next-migration-review` | Deployment + concurrency — "what runs on merge?", diamond convergence. |
| `prisma-next-queries` | Queries — SQL DSL, Raw SQL, ORM client, TypedSQL. |
| `prisma-next-runtime` | Wiring `db.ts` — middleware, connection, environment. |
| `prisma-next-build` | Build-system / dev-server integration — Vite plugin today, Next.js / Webpack / esbuild / Rollup are gaps named instead of fabricated. |
| `prisma-next-debug` | Debugging — error envelopes, signal-routing to error-code references. |
| `prisma-next-feedback` | File a bug report or feature request against Prisma Next — the canonical destination of every other skill's *What PN doesn't do yet* routing. |

Every skill follows the same shape (Convex-style): preamble + canonical
mental-model headline, *When to Use* / *When Not to Use*, *Key Concepts*,
*Workflow*, *Common Pitfalls*, **What Prisma Next doesn't do yet**,
*Reference Files*, and *Checklist*.

## Install

The skill is normally installed for you by `prisma-next init`:

```bash
pnpm dlx prisma-next init my-app
```

To install standalone (existing project, new agent runtime, or user-level):

```bash
# Project-level
npx skills add @prisma-next/agent-skill

# User-level (every project on this host)
npx skills add @prisma-next/agent-skill --user
```

## Capability-gap honesty

Prisma Next is in early access (`0.x`). Each skill carries a *What Prisma
Next doesn't do yet* section that names features the framework doesn't
implement (model validations, lifecycle callbacks, Studio, runtime-apply
migrations, `EXPLAIN`, prepared statements, `db.batch()`, multi-database
routing, Next.js plugin, …) along with the workaround and a route to the
`prisma-next-feedback` skill so the request becomes a tracked issue
instead of a one-line URL.

The pattern is deliberate: it gives the agent something concrete to say
when a user asks about an unbuilt feature, instead of confabulating a
plausible-looking API call against something that doesn't exist.

## Versioning

The package ships at the same version as the rest of Prisma Next. If your
project's `package.json` says `"@prisma-next/postgres": "0.7.0"`, install
`@prisma-next/agent-skill@0.7.0`. Mismatches surface in skill content
that references API surfaces from the wrong era.

## Authoring

Skill sources live at `packages/0-shared/agent-skill/skills/` in the
`prisma-next` monorepo. See
[`projects/prisma-next-agent-skill/`](../../../projects/prisma-next-agent-skill)
for the design specs.

## Journey tests

`journey-tests/` contains Markdown checklists corresponding to each
acceptance criterion in
[`projects/prisma-next-agent-skill/specs/usage-skill.spec.md`](../../../projects/prisma-next-agent-skill/specs/usage-skill.spec.md).
Each checklist names the prompt, the example app, and the expected
end-state. Tests are run by hand against an example app and a configured
agent runtime; cross-runtime automation is deferred.

## License

Apache-2.0.
