# Descriptor Planner Test Scenarios

Tests for `planWithDescriptors` covering the full path: contractToSchemaIR → verifySqlSchema → planDescriptors.

Each test builds a from-contract (or null) and a to-contract, runs the planner, and asserts the descriptors produced.

## Additive — fresh database (from = null)

1. **Single table** — creates table with columns + PK
2. **Table with FK** — creates table + addForeignKey + createIndex (backing)
3. **Table with explicit indexes and uniques** — creates table + createIndex + addUnique
4. **Table with enum type column** — createEnumType before createTable
5. **Multiple tables with FK between them** — both tables created, FK at end

## Additive — existing contract

6. **New nullable column** — plain addColumn (no pattern match)
7. **New NOT NULL column with default** — plain addColumn (has default, no pattern match)
8. **New NOT NULL column without default** — pattern match: addColumn(nullable) + dataTransform + setNotNull
9. **Multiple NOT NULL columns without defaults** — multiple dataTransform ops
10. **New table alongside existing** — only new table gets ops, existing table untouched
11. **New FK column on existing table** — addColumn + addForeignKey + createIndex

## Reconciliation — drops

12. **Drop table** — dropTable
13. **Drop column** — dropColumn
14. **Drop index** — dropIndex
15. **Drop FK** — dropConstraint
16. **Drop unique constraint** — dropConstraint
17. **Drop default** — dropDefault

## Reconciliation — alters

18. **Type change** (int4 → int8) — alterColumnType
19. **Nullable → NOT NULL** — setNotNull
20. **NOT NULL → nullable** — dropNotNull
21. **Default changed** — setDefault
22. **Default added** — setDefault
23. **Default removed** — dropDefault

## Types

24. **New enum type** — createEnumType descriptor
25. **Enum values added** — conflict (not yet supported)
26. **Enum values removed** — conflict (not yet supported)
27. **Unknown codec type missing** — conflict

## Dependencies

28. **Missing database dependency** — createDependency descriptor

## Ordering

29. **Drops before creates** — drop ops precede additive ops in descriptor list
30. **Types/deps before tables** — createEnumType and createDependency before createTable
31. **Tables before columns** — createTable before addColumn
32. **Pattern ops (dataTransform) between columns and constraints** — addColumn(nullable) → dataTransform → setNotNull positioned correctly
33. **FK after table it references** — addForeignKey after both tables exist

## Combined / realistic

34. **Vertical table split** (S5) — new table with FK to existing, addForeignKey + createIndex
35. **Mixed additive + destructive** — some tables added, some dropped, some columns altered
36. **No-op** — identical contracts produce empty descriptors

## Old planner parity

37. **NOT NULL without default produces dataTransform, not temp default** — verify the old hack is gone
38. **Column with typeParams** (char(36)) — verify type expansion works in resolver
