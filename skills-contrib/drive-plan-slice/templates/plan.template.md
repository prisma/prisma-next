## Dispatch plan

_(In-slice-spec section, OR `projects/<project>/slices/<slice>/plan.md`.)_

### Dispatch 1: <name>

- **Outcome:** _What this dispatch makes true. Binary + observable._
- **Builds on:** _None / external dependency / "the spec's chosen design"._
- **Hands to:** _The state this dispatch leaves for the next. A named stable state, not "passes to dispatch 2"._
- **Focus:** _In-scope here; adjacent surfaces handled by other dispatches in this slice (or out-of-scope per spec)._

### Dispatch 2: <name>

- **Outcome:** _..._
- **Builds on:** _Dispatch 1's `<hand-off>`._
- **Hands to:** _..._
- **Focus:** _..._

_(Repeat per dispatch; total ≤ ~10. If you find yourself listing more, the slice itself is probably mis-shaped — re-triage as project.)_
