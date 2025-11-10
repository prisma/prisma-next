# Recommendations

## Observations
- Still houses SQL contract types, operation manifests, and emitter hooks in one package despite the new `targets/sql/*` scaffolding.
- Tests couple all three concerns, so a change in operations can silently break the emitter.
- Docs/tutorials still point contributors here, causing more code to land in the monolith.

## Suggested Actions
- Carry out Slice 5: move contract types, operations, and emitter hooks into their dedicated packages.
- Add unit tests for each new package once the split is done to keep responsibilities isolated.
- Mark this package as transitional in the README to discourage new contributions.

