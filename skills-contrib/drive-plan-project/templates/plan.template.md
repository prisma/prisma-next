# <project-name> — Plan

**Spec:** `projects/<project>/spec.md`
**Linear Project:** _link_

## At a glance

_1–2 sentences: what slices make up this project, in what shape (stack-heavy / parallel-heavy / mixed)._

## Composition

### Stack (deliver in order)

1. **Slice `<name>`** — Linear: `<issue>`
   - **Outcome:** _What this slice makes true for the system._
   - **Builds on:** _None / external dependency / earlier stack item._
   - **Hands to:** _The state this slice leaves for downstream units to consume._
   - **Focus:** _What's in scope here; adjacent surfaces deliberately handled by other slices._

2. **Slice `<name>`** — Linear: `<issue>`
   - **Outcome:** _..._
   - **Builds on:** _Slice 1's `<hand-off>`._
   - **Hands to:** _..._
   - **Focus:** _..._

### Parallel group A (independent of stack and group B)

- **Slice `<name>`** — Linear: `<issue>`
  - **Outcome:** _..._
  - **Builds on:** _None._
  - **Hands to:** _..._
  - **Focus:** _..._

### Parallel group B (independent of stack and group A)

- **Slice `<name>`** — Linear: `<issue>`
  - **Outcome:** _..._
  - **Builds on:** _None._
  - **Hands to:** _..._
  - **Focus:** _..._

## Dependencies (external)

_Other projects, libraries, infra changes, or decisions this project depends on. Each with current status._

- [ ] _Dependency_ — _status / blocker note._

## Sequencing rationale

_Where the sequencing isn't obvious from the dependency graph: why is it shaped this way? (Transitional-shape constraints from the spec; deploy-without-downtime requirements; reviewer-bandwidth pacing.) Skip if the order follows directly from "builds on" entries._
