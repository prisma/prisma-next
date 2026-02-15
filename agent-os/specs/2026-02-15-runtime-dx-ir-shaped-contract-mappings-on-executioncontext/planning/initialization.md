# Initialization — Runtime DX: IR-shaped Contract + mappings on ExecutionContext (TML-1831)

Source: `https://linear.app/prisma-company/issue/TML-1831/runtime-dx-ir-shaped-contract-mappings-on-executioncontext`

## Raw idea (verbatim)

## Summary

Make `Contract` match the validated `contract.json` IR shape so it is traversable/inspectable (demo visualization), and move derived mappings to `ExecutionContext`.

This removes "pretend" runtime keys/types and keeps derived data on the context.

## Links

* Spec: (linked from Linear, but this repo uses `agent-os/specs/`; link may be stale) `docs/specs/2026-01-19-contract-ir-and-projections/spec.md`

## Acceptance criteria

* `Contract` matches runtime object returned by `validateContract()` (exclude `_generated`).
* Demo visualization consumes validated `Contract` directly (no ad-hoc `ContractIR` aliases).
* Lanes read mappings from `context.mappings` (not `contract.mappings`).
* No-emit flow computes mappings during context construction.

