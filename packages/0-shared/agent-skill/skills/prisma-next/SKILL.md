---
name: prisma-next
description: Route a vague Prisma Next prompt to a specific skill. Use for "help me with Prisma Next", "I'm new to PN", "explain Prisma Next", "where do I start", or any open-ended question that doesn't clearly match adoption, schema, migrations, queries, runtime, or debugging.
---

# Prisma Next — Router

> **Edit your data contract. Prisma handles the rest.**

This skill exists to disambiguate vague Prisma Next prompts. When the user
hasn't yet committed to a specific workflow (e.g. *"help me with Prisma
Next"*, *"explain how Prisma Next works"*, *"I'm new to PN, where do I
start?"*), this skill fires and routes them to the right specific skill.

## When to Use

- The user has not yet stated a concrete task.
- The user types a meta-question about Prisma Next (*"what is Prisma
  Next?"*, *"how does PN compare to Drizzle/Prisma 7?"*).
- The user asks for a tour, an overview, or a starting point.

## When Not to Use

- The user named a workflow — use the matching skill directly:
  - Setting up a new project or adopting an existing DB → `prisma-next-quickstart`.
  - Editing the schema, adding a model, changing a field → `prisma-next-contract`.
  - Authoring a migration, fixing a planner error → `prisma-next-migrations`.
  - Reviewing what's about to run on merge, handling concurrent migrations → `prisma-next-migration-review`.
  - Writing a query → `prisma-next-queries`.
  - Wiring `db.ts`, middleware, environment config → `prisma-next-runtime`.
  - A specific error code or symptom → `prisma-next-debug`.

## Routing rules

If the user's prompt clearly matches one of the workflow skills, route
there directly without asking.

Otherwise, ask **one** disambiguating question. Pick from:

- *"Do you want to set up a new Prisma Next project, or wire it into an existing database?"* → `prisma-next-quickstart`.
- *"Do you want to edit your data contract (add a model / field / relation), or work with the database (migrations, queries)?"* → `prisma-next-contract` vs the others.
- *"Is this about authoring a migration, or about reviewing what's going to run on deploy?"* → `prisma-next-migrations` vs `prisma-next-migration-review`.
- *"What error or symptom are you seeing?"* → `prisma-next-debug`.

If you still can't tell which skill applies, ask the user what they want
to do. Do not guess.

## The canonical model (one paragraph)

Prisma Next is a contract-first data layer. You author a **data
contract** (a `schema.psl` file, or a TypeScript builder). The framework
emits machine-readable artifacts (`contract.json`, `contract.d.ts`) and
gives you three runtime surfaces: a typed SQL query builder
(`db.sql.from(...)`), a typed ORM client (`db.orm.User.select(...)`),
and a raw SQL escape hatch (`db.sql.raw\`SELECT ...\``). Migrations are
planned from the contract diff; you review them, optionally edit the
`migration.ts` for data transforms, and apply.

Three steps the user does:

1. **Edit your data contract.** (`prisma-next-contract`)
2. **The system plans the migrations for you.** (`prisma-next-migrations`)
3. **If you need data migrations, you edit `migration.ts` and execute it.** (`prisma-next-migrations`)

Everything else — queries, runtime wiring, debugging — sits on top of
those three.

## Checklist

- [ ] If the prompt matches a specific workflow skill, route there without asking.
- [ ] If the prompt is vague, ask one disambiguating question.
- [ ] Do not attempt to answer the user's question from this skill — load the right specific skill first.
