# Recommendations

## Observations
- This package is a scaffold (`src/index.ts` only exports nothing) and there is no code, tests, or documentation even describing the planned PSL parser pipeline.
- Because it is still published, contributors might mistakenly start dropping PSL-specific code here without a roadmap or guidance.
- There are no TODOs, ADR references, or slice pointers guiding what needs to be implemented when the PSL work resumes.

## Suggested Actions
- Either remove the placeholder package until the PSL work starts or extend the README with a TODO list (links to relevant slices/ADRs) so contributors know what is expected.
- If the package must remain, add a failing test or lint guard that prevents accidental code from landing here before the PSL parser exists.
