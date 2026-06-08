# Prisma Next Demo (SQLite)

A minimal runnable demo showing how to use `@prisma-next/sqlite`. Covers a
simple read + a relational read + a write through both the ORM client and
the SQL builder + an atomic check-then-act transaction (per-user post quota).

End-to-end SQLite coverage (codecs, runtime, migrations, ORM/SQL builder
semantics) lives in `test/e2e/framework/test/sqlite/` and the
`@prisma-next/sql-orm-client` / `@prisma-next/sql-builder` integration
suites — this example deliberately doesn't duplicate it.

## Setup

```bash
pnpm install
pnpm emit                              # generates src/prisma/contract.json + contract.d.ts
SQLITE_PATH=./demo.db pnpm db:init     # creates the schema
SQLITE_PATH=./demo.db pnpm seed        # inserts 2 users + 3 posts
```

## Run the CLI

```bash
SQLITE_PATH=./demo.db pnpm start -- users
SQLITE_PATH=./demo.db pnpm start -- repo-user <userId>
SQLITE_PATH=./demo.db pnpm start -- repo-user-posts <userId> 5
SQLITE_PATH=./demo.db pnpm start -- repo-create-user <newId> new@example.com 'New User'
SQLITE_PATH=./demo.db pnpm start -- insert-user new2@example.com 'New User 2'
# Transaction (under quota): read count + insert atomically; prints created posts
SQLITE_PATH=./demo.db pnpm start -- add-posts <userId> 'One More'
# Transaction (over quota): QuotaExceededError rolls back; prints unchanged count
SQLITE_PATH=./demo.db pnpm start -- add-posts <userId> 'A' 'B' 'C' 'D' 'E'
```

| Command | Lane | Operation |
|---------|------|-----------|
| `users` | SQL builder | `SELECT … FROM user LIMIT n` |
| `repo-user` | ORM | `db.User.first({ id })` |
| `repo-user-posts` | ORM | `db.User.include('posts', …).where({ id }).first()` (relational) |
| `repo-create-user` | ORM | `db.User.create({ … })` |
| `insert-user` | SQL builder | `INSERT INTO user … RETURNING id, email` |
| `add-posts` | ORM + SQL builder | `db.transaction()`: SQL builder `COUNT(*)` check → ORM `create()` per title |

The `add-posts` command demonstrates why an interactive transaction is necessary: the count (SQL
builder aggregate) and the inserts (ORM create) must be one atomic unit so that two concurrent
callers cannot each pass the quota check and jointly exceed it (TOCTOU). Exceeding the quota throws
`QuotaExceededError` which rolls the transaction back; the command re-reads the count to show it is
unchanged.

## Key files

- `prisma/contract.ts` — TypeScript contract authoring (User + Post, FK)
- `prisma-next.config.ts` — CLI config wiring SQLite target/adapter/driver
- `src/prisma/db.ts` — `sqlite()` one-liner client
- `src/orm-client/` — ORM client examples
- `src/queries/` — SQL builder examples
- `src/transactions/` — Transaction example (`db.transaction()`)
- `scripts/seed.ts` — Demo seed
