# Recommendations

## Observations
- Package is still empty (`src/index.ts` exports nothing); `orm-builder.ts` remains under `@prisma-next/sql-query`.
- Without code here, downstream packages cannot adopt the new ORM lane.

## Suggested Actions
- Move `orm-builder.ts`, include helpers, relation filter builders, and ORM-specific types into this package per Slice 4.
- Once populated, add unit tests focused on include lowering and nested relation typing.

