# Brief: <dispatch-name>

## Task

_One paragraph. Unambiguous. Names the surface and the change._

## Scope

**In:** _Files / changes / behaviours in this dispatch. Bounded._

**Out:** _What the implementer must NOT touch, even if adjacent and tempting._

## Completed when

_Binary, dispatch-specific conditions. NOT slice-wide gates. NOT what CI / reviewer / project-DoD already implies. Often just 1–3 items._

- [ ] _Specific condition (e.g. "the `oldX` function is removed; all call sites use `newX`")._
- [ ] _Operational gate (e.g. "package typecheck clean for `<pkg>`")._

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## References

- Slice spec: `<path>` — chosen design + coherence rationale + slice-DoD.
- Slice plan entry: `<path>` § Dispatch N — outcome / builds-on / hands-to / focus.
- Calibration entries from project context matching this dispatch's shape: `<links>` — only the ones that apply, not a generic catalogue dump.
- Prior dispatch artifacts in this slice (if any): `<links>`.

## Operational metadata

- **Model tier:** `<cheap | mid | orchestrator>` — _one-line rationale._
- **Time-box:** _wall-clock ceiling. Overrun → halt and surface, do not extend._
- **Halt conditions:** _the specific situations under which the implementer halts and surfaces (e.g. "diff exceeds 18 files"; "an out-of-scope surface needs touching to complete the task"; "an assumption named in the slice spec is observed to be false")._

---

**On resumed dispatches (R2+ in the same slice), thin the brief further.** The implementer subagent retains the prior dispatch's transcript. Drop the `References` section's slice-spec / slice-plan pointers (the subagent already knows where they are); restate only the new task, the new completed-when conditions, and any halt conditions that changed.
