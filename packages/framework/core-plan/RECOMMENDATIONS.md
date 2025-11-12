# Recommendations

## Observations
- The README mentions `planInvalid`/`planUnsupported` but doesn’t explain when other packages should import from `@prisma-next/plan` versus defining their own diagnostics.
- The package currently only exports the error helpers; there are no other plan-related utilities (e.g., `createParamDescriptor`, `planRefs`) centralized here, so other packages continue to scatter plan metadata handling.
- Tests cover the error helpers but do not include type-level or metadata tests that would guard against expanding `PlanMeta` or `ParamDescriptor` incorrectly.

## Suggested Actions
- Expand the README with guidance on when to use these helpers, referencing the target lifecycle (builders, DSL, runtime) and the stable codes they emit.
- Consider relocating additional plan utilities (like metadata builders or descriptor factories) that currently live elsewhere into this package so it becomes the canonical place for plan semantics.
- Add tests (including `*.test-d.ts` if necessary) that assert the exported metadata types stay stable when fields are added, preventing silent API widening.
