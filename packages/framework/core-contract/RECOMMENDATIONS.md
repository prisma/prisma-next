# Recommendations

## Observations
- `src/types.ts` mixes contract schemas, plan metadata, and document-family types but provides no runtime validation helpers.
- Consumers repeatedly re-implement schema validation because this package exports only interfaces.
- Documentation does not explain which fields are included in `coreHash` vs `profileHash`, even though other packages depend on that contract.

## Suggested Actions
- Publish runtime validators (arktype/zod) alongside the TS types so packages can import canonical validation logic.
- Document the hashing rules and link to ADRs so future contributors don’t guess which fields affect the hashes.
- Add type tests to ensure future edits don’t widen critical types like `PlanMeta` or `ContractBase`.

