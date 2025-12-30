// This should NOT trigger because it's not from @prisma-next packages
interface SqlBuilder<T> {
  from(table: unknown): SelectBuilder<T>;
}

interface SelectBuilder<T> {
  select(fields: unknown): SelectBuilder<T>;
  build(): SqlQueryPlan;
}

interface SqlQueryPlan {
  ast: unknown;
  params: unknown;
  meta: unknown;
}

declare const mockBuilder: SqlBuilder<unknown>;

mockBuilder.from({}).select({ id: 1 }).build(); // Should NOT trigger rule
