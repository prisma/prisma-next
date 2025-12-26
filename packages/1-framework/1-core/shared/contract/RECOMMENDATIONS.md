# Recommendations

## Observations
- The package only exports TypeScript types and JSON schemas; there are no runtime validators, meaning every consumer re-implements contract validation (e.g., `validateContract` in the SQL package).
- The README mentions `coreHash` and `profileHash` but doesn’t explain which fields feed into each hash or point to the ADRs that define canonicalization rules.
- There are no tests validating the exported guards (`isDocumentContract`) or the schemas, so inadvertent changes to `PlanMeta` or `ContractBase` could widen the definition unnoticed.

## Suggested Actions
- Publish shared runtime validators (arktype/zod) alongside the type definitions so downstream packages can import canonical validation logic instead of re-implementing it.
- Expand the README with a concise explanation of `coreHash` vs `profileHash`, linking to the relevant ADRs and explaining which fields contribute to each hash.
- Add unit tests that exercise the type guards and the schema exports to ensure future edits do not widen `PlanMeta`, `ContractBase`, or other critical interfaces by accident.
