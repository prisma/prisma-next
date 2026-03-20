# Prisma Next Roadmap

Prisma Next is the next generation of the Prisma ORM. This document tracks the delivery plan, current status, and what to expect in each phase.

For background, see [the announcement blog post](https://www.prisma.io/blog/the-next-evolution-of-prisma-orm).

## What's already built

The foundation is in place. The current codebase includes:

- A new query API with custom collection methods for models
- Streaming query results
- A low-level, type-safe SQL query builder for complex or custom SQL
- An extension system for installing new behaviors and data types (with `pgvector` as the first example extension)
- TypeScript Prisma schemas as an alternative to `schema.prisma`
- Middleware, validations, and query linting

The remaining work is being delivered in three phases.

---

## Phase 1 — Enable external contributions (April 2026)

**Status**: In progress

**Goal**: Establish stable, reliable APIs for extension authors and validate the core framework architecture.

Prisma Next is designed to be extended. External contributors will be able to add:

- SQL database targets
- Postgres extensions
- Middleware for telemetry, error reporting, and query checks
- New query builders
- Validator integrations (Zod, Arktype, etc.)
- Service integrations (Sentry, Datadog, etc.)
- Framework integrations (Next.js, Vue, etc.)

These are starting points — the goal is to open the platform and learn what the community wants to build.

To validate that the architecture genuinely supports this breadth, two POCs are already in progress:

- **MongoDB** — validating that non-SQL targets work within the framework
- **ParadeDB** — validating that extensions can provide their own database primitives

A public call for contributors will go out in April. During the month, the team will collaborate directly with early extension authors, implementing extensions together and refining the APIs based on real usage.

This is the best time to get involved if you want to shape the final version of Prisma Next.

---

## Phase 2 — Early access (May 2026)

**Status**: Not started

**Goal**: Get Prisma Next into users' hands and validate it against real-world applications.

By EA, the user-facing APIs are expected to be stable for:

- **Postgres** (primary target)
- **One additional SQL database** — SQLite is the top candidate

The EA release will include getting-started material and guides explaining the key differences between Prisma 7 and Prisma Next.

The release follows the standard EA process: initial release, a period of feedback and refinement, then General Availability.

This is the time to adopt Prisma Next early and provide feedback that shapes the GA release.

---

## Phase 3 — General availability (June–July 2026)

**Status**: Not started

**Goal**: Bring Prisma Next Postgres support to GA as a production-ready product.

The migration path from Prisma 7 is designed to be incremental:

- **Parallel operation**: Prisma Next and Prisma 7 can run side by side, with traffic gradually shifted from one to the other
- **Compatibility layer**: Existing Prisma 7 queries don't need to be rewritten immediately
- **Long-term support**: Prisma 7 continues to receive LTS for teams that want a fully battle-tested foundation before migrating
