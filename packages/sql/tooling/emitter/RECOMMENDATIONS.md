# Recommendations

## Observations
- Validation helpers (`validateTypes`, `validateStructure`) throw plain `Error`s with string messages, so callers can’t render stable symbols/hints without parsing the message text.
- Type generation builds strings manually but is covered only by equality checks; there are no snapshot tests to guard the richer `contract.d.ts` structure or the order of imports when packs change.
- README describes how to use the hook but doesn’t show a literal `emit(..., sqlTargetFamilyHook)` example or how to contribute custom operations via packs.

## Suggested Actions
- Wrap validation failures in structured diagnostics (e.g., reusing `planInvalid`) so aggregate tools can attach codes, hints, and docs instead of parsing raw messages.
- Add snapshot coverage for `generateContractTypes` and the operation assembly path so future changes to imports or manifest handling surface immediately.
- Expand the README with a concrete example showing how to register `sqlTargetFamilyHook` with `emit()` and how to supply packs/operations, including how capability lists are honored.
