# Recommendations

## Observations
- `OrmModelBuilder.skip()` is still a stub: it sets `offsetValue` but the SQL lane lacks offset support, and a TODO in the code warns that Select AST doesn’t yet handle OFFSET.
- Relation filter tests explicitly note (`TODO`) that EXISTS subqueries are not implemented, so the builder records filters without lowering them into SQL.
- Tests only assert that relation/filter APIs return builder instances; they don’t verify the AST or plan emitted for those filters, leaving the actual behavior unvalidated.

## Suggested Actions
- Implement offset handling in the SQL lane (and the Select AST) so `skip()` produces real SQL instead of being a no-op placeholder.
- Compile `where.related.{some,none,every}` filters into EXISTS/NOT EXISTS clauses so plans reflect the expected semantics and runtime filters behave correctly.
- Extend the tests to assert the AST emitted for relation filters includes EXISTS subqueries and that `skip`/`offset` values propagate through the generated plan.
