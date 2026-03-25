# Clean Up Stale `orm-` Prefixed Demo Queries That Use the SQL Lane

Delete the six misleading `orm-`prefixed query files in `examples/prisma-next-demo/src/queries/` that use the SQL lane (`db.sql.from(...)`) despite their ORM naming. Fill the two small coverage gaps (delete, backward pagination) with new modules in `src/orm-client/`, update the integration tests to use `src/orm-client/` imports, and rewire `main.ts`.

**Linear:** [TML-2117](https://linear.app/prisma-company/issue/TML-2117/clean-up-stale-orm-prefixed-demo-queries-that-use-the-sql-lane)

# Description

The `examples/prisma-next-demo/src/queries/` directory contains six files with an `orm-` prefix. Five of them (`orm-get-users.ts`, `orm-get-user-by-id.ts`, `orm-includes.ts`, `orm-pagination.ts`, `orm-relation-filters.ts`) use the SQL lane (`db.sql.from(...)`) — identical in style to the non-prefixed query files. The sixth (`orm-writes.ts`) correctly uses the ORM client (`createOrmClient`). These files are leftovers from a now-deleted ORM query lane, and the `orm-` prefix is misleading.

Meanwhile, `src/orm-client/` already has proper ORM client demos that cover nearly every scenario the stale files demonstrate:

| Stale file | `src/orm-client/` equivalent | Covered? |
|---|---|---|
| `orm-get-users.ts` | `get-users.ts` | Yes |
| `orm-get-user-by-id.ts` | `find-user-by-id.ts` | Yes |
| `orm-includes.ts` | `get-dashboard-users.ts` (filtered child include via `.include('posts', p => p.where(...))`) | Yes |
| `orm-pagination.ts` forward cursor | `get-users-by-id-cursor.ts` | Yes |
| `orm-pagination.ts` backward cursor | — | **Gap** |
| `orm-relation-filters.ts` | `get-dashboard-users.ts` (uses `user.posts.none(...)` in `where`) | Yes (different shape, same mechanism) |
| `orm-writes.ts` create | `create-user.ts` | Yes |
| `orm-writes.ts` update | `update-user-email.ts` | Yes |
| `orm-writes.ts` delete | — | **Gap** |

All existing `src/orm-client/` modules are already tested in `test/repositories.integration.test.ts`.

The approach is:
1. **Delete** all six `orm-` prefixed files — none are retained.
2. **Add** two small new modules in `src/orm-client/` to fill the gaps: backward cursor pagination and delete.
3. **Update** `test/orm.integration.test.ts` — either merge its unique test cases into `repositories.integration.test.ts` or rewrite it to import from `src/orm-client/`.
4. **Rewire** `main.ts` CLI commands (`users-paginate`, `users-paginate-back`) to use the ORM client pagination module.

# Requirements

## Functional Requirements

### FR-1: Delete All `orm-` Prefixed Files from `src/queries/`

Delete the following files with no replacements — their scenarios are already covered by `src/orm-client/`:

- `src/queries/orm-get-users.ts`
- `src/queries/orm-get-user-by-id.ts`
- `src/queries/orm-includes.ts`
- `src/queries/orm-relation-filters.ts`
- `src/queries/orm-writes.ts`
- `src/queries/orm-pagination.ts`

### FR-2: Add `delete-user.ts` to `src/orm-client/`

Add a module that demonstrates `db.User.where({ id }).delete()` using the ORM client, filling the gap left by removing `orm-writes.ts`.

### FR-3: Add Backward Cursor Pagination to `src/orm-client/`

Add a module (or extend `get-users-by-id-cursor.ts`) that demonstrates backward cursor pagination using the ORM client, filling the gap left by removing `orm-pagination.ts`. If the ORM client `cursor()` API does not support backward cursors today, use `where` + `orderBy(desc)` as the equivalent pattern.

### FR-4: Update Integration Tests

`test/orm.integration.test.ts` currently imports the stale `orm-` prefixed modules. After cleanup:

- All test cases must exercise ORM client code from `src/orm-client/`.
- Test coverage for backward cursor pagination and delete must be preserved (via the new modules from FR-2 and FR-3).
- The test cases for list users, find by id, includes, forward pagination, relation filters, create, and update are already covered by `repositories.integration.test.ts` — these can be dropped from `orm.integration.test.ts` or the file can be deleted entirely if all cases are covered.

### FR-5: Rewire CLI Commands in `main.ts`

`src/main.ts` imports `ormGetUsersByIdCursor` and `ormGetUsersBackward` from `./queries/orm-pagination` for the `users-paginate` and `users-paginate-back` CLI commands. Update these imports to use the ORM client pagination modules from `src/orm-client/`.

## Non-Functional Requirements

- **NFR-1**: All existing tests continue to pass (`pnpm test` in the demo, `pnpm test:packages` at root).
- **NFR-2**: Type checking passes (`pnpm typecheck`).
- **NFR-3**: The demo app CLI commands work correctly.
- **NFR-4**: No new dependencies or package changes — this is a pure demo cleanup.

## Non-goals

- Rewriting any of the non-prefixed SQL lane query files in `src/queries/` — those are fine as-is.
- Adding new ORM client features or APIs.
- Changing the ORM client package (`@prisma-next/sql-orm-client`) itself.
- Cleaning up the `no-emit` query variants — separate concern.
- Updating `src/orm-client/client.ts` custom collection definitions unless necessary for the new modules.

# Acceptance Criteria

- [ ] No `orm-` prefixed files exist under `examples/prisma-next-demo/src/queries/`
- [ ] `src/orm-client/` contains a delete user demo module
- [ ] `src/orm-client/` contains a backward cursor pagination demo module (or the forward module is extended)
- [ ] `test/orm.integration.test.ts` either imports only from `src/orm-client/` or is deleted (with its unique cases merged into `repositories.integration.test.ts`)
- [ ] No test coverage is lost for: backward cursor pagination, delete
- [ ] `main.ts` CLI commands `users-paginate` and `users-paginate-back` use ORM client modules
- [ ] `pnpm test` passes in the demo app
- [ ] `pnpm typecheck` passes

# Other Considerations

## Security

No security impact. This is a demo code cleanup with no changes to library code.

## Cost

No cost impact. No infrastructure changes.

## Observability

No observability changes.

## Data Protection

Not applicable.

## Analytics

Not applicable.

# References

- Parent project spec: `projects/orm-client/spec.md`
- ORM client package: `packages/3-extensions/sql-orm-client/`
- Demo app: `examples/prisma-next-demo/`
- Existing ORM client demos: `examples/prisma-next-demo/src/orm-client/`
- Stale query files: `examples/prisma-next-demo/src/queries/orm-*.ts`
- Integration tests: `examples/prisma-next-demo/test/orm.integration.test.ts`, `examples/prisma-next-demo/test/repositories.integration.test.ts`
- CLI wiring: `examples/prisma-next-demo/src/main.ts`
- Linear: [TML-2117](https://linear.app/prisma-company/issue/TML-2117/clean-up-stale-orm-prefixed-demo-queries-that-use-the-sql-lane)

# Open Questions

1. **Backward cursor pagination API**: Does the ORM client's `cursor()` API support backward cursors natively (e.g. ordering desc + cursor)? If not, the backward pagination module will use `where(id.lt(cursor)).orderBy(id.desc())` directly. **Assumption:** Use whatever the ORM client supports; fall back to `where` + `orderBy` if `cursor()` doesn't handle backward.
