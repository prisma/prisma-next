# Journey 07 — Post-bootstrap orientation

**Skills under test:** `prisma-next-quickstart` (Post-bootstrap orientation path), with hand-offs to `prisma-next-queries` and optionally `prisma-next-contract`.

**Example app:** A freshly-scaffolded project from `npx createprisma` (or, for local testing without that tool, `examples/prisma-next-demo` with no migration applied yet — simulate "just got handed a project, haven't run anything against the DB yet").

**Acceptance criterion:** This journey complements AC4 from `specs/usage-skill.spec.md` by covering the orientation entry point that the `createprisma` tool produces (its final instruction directs the user to ask their agent *"what can I do next with Prisma?"*).

## Prompt

> What can I do next with Prisma?

Variants the test should also pass on:

- *"What can I do with Prisma next?"*
- *"Where do I start?"*
- *"I just ran createprisma — what now?"*

## Expected agent behavior

- [ ] Recognises this as orientation, not a request to lecture about Prisma Next.
- [ ] Reads `prisma-next.config.ts` to confirm target, authoring mode, contract source path, and `db.ts` location.
- [ ] Reads the contract source to see what starter models exist.
- [ ] Reads `.env` / `.env.example` to confirm `DATABASE_URL` is set (or proposes setting it).
- [ ] Proposes the **smallest** first arc consistent with project state — typically: `db init` (if not already initialised), then write a row, then read it back.
- [ ] Writes the write + read snippet using the ORM lane (`db.orm.<Model>.create({...})` for the write, `db.orm.<Model>.select(...).all()` for the read) against an existing scaffold model. The SQL builder and raw lanes are alternatives, not the default first-query lane.
- [ ] Runs the snippet and confirms it round-trips data.
- [ ] After the first query lands, surfaces the *Commands you'll use day-to-day* toolbelt as a brief orientation — not as a tutorial.
- [ ] Asks the user what they want to build next and routes:
  - More queries → `prisma-next-queries`.
  - Schema changes → `prisma-next-contract`.
  - Runtime config / middleware → `prisma-next-runtime`.
  - Dev-server integration → `prisma-next-build`.

## Success criteria

- [ ] The user has one row written to the DB and one row read back, against a real database connection, within a single short interaction.
- [ ] `contract.json` and `contract.d.ts` were not regenerated unnecessarily (the agent didn't re-emit if no contract changes happened).
- [ ] The agent did NOT walk the user through `prisma-next.config.ts` keys or PSL syntax before the first query landed.
- [ ] The agent did NOT propose adding multiple models, planning a migration, or wiring middleware as the first move.
- [ ] The agent did NOT paste a Prisma 7 tour, a "what is an ORM" explanation, or a feature inventory.

## Failure modes

- Agent treats the prompt as a request to explain Prisma Next and produces a tour instead of a first query.
- Agent skips reading project state and proposes greenfield-path commands (`prisma-next init`) against a directory that is already scaffolded.
- Agent dives into schema editing as the first move ("let me show you how to add a model") instead of using the scaffold's starter model.
- Agent proposes a migration before the user has run one query against the existing scaffold.
- Agent hand-edits `contract.json` or `contract.d.ts` to "speed things up".
