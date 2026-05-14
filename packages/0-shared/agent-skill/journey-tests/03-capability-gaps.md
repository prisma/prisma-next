# Journey 03 — Capability-gap honesty

**Skills under test:** `prisma-next-contract`, `prisma-next-migrations`,
`prisma-next-queries`, `prisma-next-debug`.

**Acceptance criterion:** AC6 from `specs/usage-skill.spec.md`.

The point: when the user asks about a feature Prisma Next doesn't
have yet, the agent must NOT confabulate an API. It must name the gap,
suggest the workaround, and point at the feature-request URL.

## Prompts and expected responses

### 03a — Validations

> Add a validation: email must contain '@'.

- [ ] Agent names the gap: validations not first-class in PN.
- [ ] Agent suggests app-side validation with arktype or zod.
- [ ] Agent provides the feature-request URL.

### 03b — Lifecycle callbacks

> Run a `beforeSave` hook on User to lowercase the email.

- [ ] Agent names the gap: lifecycle callbacks not first-class.
- [ ] Agent suggests middleware (per `prisma-next-runtime`) or app code.
- [ ] Agent provides the feature-request URL.

### 03c — Studio

> Open Prisma Studio.

- [ ] Agent names the gap: Studio not shipped.
- [ ] Agent suggests `prisma-next db schema` for CLI tree output.
- [ ] Agent provides the feature-request URL.

### 03d — EXPLAIN

> EXPLAIN this query.

- [ ] Agent names the gap: no `.explain()` first-class method.
- [ ] Agent suggests `db.sql.raw\`EXPLAIN ANALYZE ${...}\``.
- [ ] Agent provides the feature-request URL.

### 03e — Runtime-apply migrations

> Apply pending migrations from app startup code.

- [ ] Agent names the gap: no runtime-apply migrations API.
- [ ] Agent suggests `prisma-next migration apply` from the deploy
      pipeline.
- [ ] Agent provides the feature-request URL.

## Success criteria

- [ ] For each prompt, the agent named the gap, named the workaround,
      and provided the feature-request URL.
- [ ] The agent did NOT fabricate an API call against a non-existent
      surface (`User.validates(...)`, `db.studio()`, `query.explain()`,
      `db.applyMigrations()`).
