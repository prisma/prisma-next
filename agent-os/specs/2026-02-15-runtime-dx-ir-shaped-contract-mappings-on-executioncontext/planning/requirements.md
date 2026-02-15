# Spec Requirements: Runtime DX: IR-shaped Contract + mappings on ExecutionContext

## Initial Description
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

## Requirements Discussion

### First Round Questions

**Q1:** I assume “`Contract` matches the validated `contract.json` IR shape” means the runtime object returned by `validateContract()` is directly traversable without adapters/aliases, and the TypeScript `Contract` type mirrors that object shape 1:1. Is that correct, or do you want a “public traversal view” type that’s slightly narrower than the full validated shape?  
**Answer:** I think the question is flawed. We don't want to speak in IR terms at this stage. This is a fully-qualified, constructed contract, no longer an IR. This structure is the _purpose_ of the contract JSON (or the TS authoring DSL), to make this thing. So we might as well make the mappings real. And we don't want this object to too closely match the JSON. The JSON format will change, the Contract shoudl remain the same, shaped by user application needs instead of serialization limitations.

I could imagine this being a class, which takes contract IR as input. Wdyt?

**Q2:** For excluding `_generated`: I assume we strip `_generated` at runtime in `validateContract()` (so it’s not present on the returned object), not just omit it from the `Contract` type. Is that correct, or is it acceptable if `_generated` is still present at runtime but not part of `Contract`?  
**Answer:** Correct

**Q3:** For “move derived mappings to `ExecutionContext`”: I assume we are moving all derived/traversal conveniences (today under `contract.mappings`) to `context.mappings`, and `contract` stays “pure IR” (no derived indexes). Which mapping families are in scope (e.g. model/table/column lookups, relation edges, typeId lookups, name→id maps)?  
**Answer:** I'm actually not sure what you're talking about. Perhaps there's a note in the ticket I'm unaware of. Please explain

**Q4:** I assume `context.mappings` is computed eagerly during `createExecutionContext` construction (both emit + no-emit flows), deterministic, and does not depend on instantiated adapter/extension instances. Is that correct, or do you want lazy computation or caching behavior?  
**Answer:** --

**Q5:** Demo visualization: I assume the demo should consume the validated `Contract` directly and render from that tree, without any “`ContractIR`” alias types or transformation steps. Which part(s) of the contract are the visualization MVP (storage schema only, or also capabilities/components/extensions/policies)?  
**Answer:** correct. All application-relelevant components of the contract

**Q6:** I assume this change is allowed to be breaking internally (no back-compat shims): update lanes and any call sites from `contract.mappings` → `context.mappings`. Is that correct, or do we need a short transition period?  
**Answer:** No backwards compatibility

**Q7:** Exclusions: beyond `_generated`, are there any other runtime keys/fields you explicitly want to exclude or reshape (e.g. metadata blobs, hash fields, emitter-only structures), and any packages/areas you explicitly want out of scope for this iteration?  
**Answer:** Not sure

### Existing Code to Reference
No similar existing features identified for reference.

### Follow-up Questions

**Follow-up 1:** When you say “one consistent, predictable contract type which matches its runtime value and gives access to computed mappings”, do you want the mappings to exist on the contract value itself (e.g. `contract.mappings` is real at runtime), or do you want to keep the contract “pure IR” and make mappings available only via `ExecutionContext` (e.g. `context.mappings`), with the demo visualization updated accordingly?  
**Answer:** We might as well make the mappings real. And we don't want this object to too closely match the JSON. The JSON format will change, the Contract should remain the same, shaped by user application needs instead of serialization limitations.

**Follow-up 2:** Where should mappings be computed for the no-emit workflow vs JSON + `validateContract()` workflow? (Option A: inside `validateContract()`; Option B: inside `createExecutionContext()`; Option C: lazy)  
**Answer:** computed during Contract class construction? this isn't that important

**Follow-up 3:** Which “mappings” are must-have in the first pass?  
**Answer:** Not important either. Super easy to add more mappings to the COntract class

**Follow-up 4:** You mentioned there might be “another JSON IR” inside `validateContract()`. Is the goal to delete that intermediate representation, or is it acceptable to keep internal transforms as long as the returned value + exported type are identical?  
**Answer:** No, ignore it

**Follow-up 5:** The Linear issue links a spec at `docs/specs/...`, but in this repo the spec system lives under `agent-os/specs/`. Should we treat that linked spec as external/obsolete, or do you know where the “contract IR and projections” spec lives in this worktree?  
**Answer:** Use agent-os/specs. The Linear issue is mistaken

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Consolidate contract representations so the **TypeScript `Contract` type matches the runtime value** that applications can traverse/inspect (demo visualization).
- Ensure **precomputed mappings are not “pretend”**: mappings must be accessible on the constructed contract value (and match the type).
- Exclude `_generated` from the runtime value returned by `validateContract()` (not just from types).
- Demo visualization consumes the validated/constructed `Contract` directly (no ad-hoc `ContractIR` aliases).
- No backwards compatibility; update call sites.

### Reusability Opportunities
- None identified.

### Scope Boundaries
**In Scope:**
- Make the constructed `Contract` a stable, application-shaped object whose runtime shape matches its type.
- Provide access to useful mappings on the constructed contract object.

**Out of Scope:**
- None specified.

### Technical Considerations
- Avoid treating the constructed contract as an “IR”; JSON is a serialization format that may evolve independently.
- The constructed contract may be represented as a class that takes a lower-level contract representation as input (exact construction details not critical per discussion).
- Mappings can be computed during contract construction; exact mapping set is intentionally flexible/easy to extend.

