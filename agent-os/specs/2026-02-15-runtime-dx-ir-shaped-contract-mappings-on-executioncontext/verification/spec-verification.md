# Specification Verification Report

## Resolution Update (Post-verification)

- ✅ Addressed terminology variance by renaming the `tasks.md` title to match spec wording: "Constructed Contract + runtime-real mappings".
- ✅ Added explicit test count guidance in `tasks.md` for each "Tests first" section: "2-8 focused tests/checks".
- ✅ Both previously reported minor issues are now resolved.

## Verification Summary

- **Overall Status:** ⚠️ Issues Found
- **Date:** 2026-02-15
- **Spec:** Runtime DX: Constructed Contract + runtime-real mappings (TML-1831)
- **Reusability Check:** ✅ Passed (none identified; documented)
- **Test Writing Limits:** ⚠️ Partial (limits not explicitly specified per archetype)

## Structural Verification (Checks 1-2)

### Check 1: Requirements Accuracy

User answers from Q&A are accurately captured in requirements.md.

**Notable supersession:** The initialization.md (from Linear) states: "Lanes read mappings from `context.mappings` (not `contract.mappings`)" and "move derived mappings to `ExecutionContext`." The user's follow-up answers explicitly changed direction:
- Follow-up 1: "We might as well make the mappings real" (on contract)
- Follow-up 2: "computed during Contract class construction"
- Follow-up 3: mappings "Super easy to add more mappings to the Contract class"

Requirements and spec correctly reflect the user's refined direction: mappings live on the constructed contract, not on ExecutionContext. This is intentional; the initialization doc represents the pre-Q&A Linear phrasing.

**Other Q&A coverage:**
- ✅ Q1: Reframe from IR to constructed contract — captured
- ✅ Q2: Strip `_generated` at runtime — correct
- ✅ Q3: User unclear on mapping families; answered in follow-ups — captured
- ✅ Q4: No specific answer — acceptable (scope flexible)
- ✅ Q5: Demo consumes validated Contract; all application-relevant components — captured
- ✅ Q6: No backwards compatibility — captured
- ✅ Q7: No additional exclusions specified — captured
- ✅ Follow-ups 1–5: All answered and captured
- ✅ Reusability: "No similar existing features identified" — documented
- ✅ Visual assets: "No visual assets provided" — documented

### Check 2: Visual Assets

**Result:** No design assets (diagrams, mockups, screenshots) in `planning/visuals/`. Only the placeholder README.md exists. Requirements correctly state "No visual assets provided." No verification of visual→spec/task alignment is required.

## Content Validation (Checks 3-7)

### Check 3: Visual Design Tracking

Not applicable — no visual design files present.

### Check 4: Requirements Coverage

**Explicit features requested:**
- Single predictable contract surface (TS authoring + JSON loading): ✅ Covered in spec
- Type/value alignment: ✅ Covered
- Runtime-real mappings on contract: ✅ Covered
- Strip `_generated` at runtime: ✅ Covered
- Demo visualization consumes Contract directly: ✅ Covered
- No backwards compatibility: ✅ Covered
- Contract as class (internal implementation): ✅ Covered in spec Design §2

**Reusability opportunities:**
- None identified by user — ✅ Documented; N/A

**Out-of-scope items:**
- Preserving exact JSON shape: ✅ Correctly in Non-goals
- Final exhaustive mapping list: ✅ Correctly in Non-goals
- Removing internal parsing steps (if output identical): ✅ Correctly excluded from scope

### Check 5: Core Specification Issues

- **Goal alignment:** ✅ Matches user need (constructed contract, runtime-real mappings, no type/value mismatch)
- **User stories:** N/A — spec uses Goals/Acceptance Criteria instead
- **Core requirements:** ✅ All from user discussion; no extra features added
- **Out of scope:** ✅ Matches requirements
- **Reusability notes:** ✅ States "None identified" where applicable

**Minor terminology variance:** Spec uses "constructed contract" consistently; tasks.md header uses "definition-only contract." The tasks use "definition-only" in 2.3 to mean "contract loading does not require execution stack." These are compatible but the header wording differs from the spec title.

### Check 6: Task List Issues

**Test writing limits:**
- ⚠️ Task groups do not explicitly state "2–8 focused tests maximum" per group
- ✅ No calls for "comprehensive," "exhaustive," or "full test suite" coverage
- ✅ Each "Tests first" subtask lists specific assertions (e.g., "runtime contract values include only runtime-real mapping keys") — scope is bounded
- ✅ Task 6 says "Run targeted package tests" and "Run integration/e2e tests," not "run entire suite" — acceptable
- ⚠️ Archetype recommends explicit test count guidance (2–8 per group); tasks are implicit

**Reusability references:**
- ✅ None required — requirements state no similar features to reuse

**Task specificity:**
- ✅ Each task references a concrete feature (e.g., SqlMappings, validateContract, lanes, builder inference)
- ✅ Tasks trace back to requirements and spec sections

**Scope:**
- ✅ No tasks for features outside requirements

**Task count:**
- Group 1: 3 tasks ✅
- Group 2: 3 tasks ✅
- Group 3: 2 tasks ✅ (slightly under 3)
- Group 4: 2 tasks ✅
- Group 5: 3 tasks ✅
- Group 6: 1 verification block (3 checklist items) — acceptable

### Check 7: Reusability and Over-Engineering

**Unnecessary new components:**
- ✅ None identified; spec refactors existing contract/validation flow

**Duplicated logic:**
- ✅ Spec centralizes construction; lanes use ExecutionContext registries instead of re-reading type-only maps

**Missing reuse opportunities:**
- ✅ None identified by user

**Justification for new code:**
- ✅ Internal class + factory pattern justified for encapsulation and invariants
- ✅ Phantom/symbol type channel justified for codec/op types that cannot be reified from JSON

### Standards Compliance

Spec and tasks align with agent-os and workspace standards:

- **arktype:** Spec mentions arktype for validation; consistent with workspace rules
- **Test writing:** agent-os `test-writing.md` ("Write Minimal Tests," "Test Only Core User Flows") aligns with focused testing; spec Testing Plan is bounded
- **omit "should" in tests:** Workspace rule; tasks do not prescribe test descriptions, so no conflict
- **No backwards compatibility:** Matches both spec and workspace rules
- **Interface-based design:** Spec uses `Contract` interface + factory; aligns with AGENTS.md

## Critical Issues

1. **None.** Spec and requirements align; no blocking discrepancies.

## Minor Issues

1. **Terminology variance:** tasks.md header uses "definition-only contract" vs spec "Constructed Contract" — consider aligning for consistency.
2. **Test count guidance:** Archetype recommends explicit "2–8 tests per task group"; tasks imply focused tests but do not state numeric limits.

## Over-Engineering Concerns

None identified. The spec:
- Keeps mappings extensible rather than defining an exhaustive set
- Uses type-only channel for codec/op types (avoids impossible reification)
- Avoids unnecessary new abstractions
- Allows internal implementation flexibility ("exact construction details not critical per discussion")

## Recommendations

1. Align tasks.md header terminology with spec ("Constructed Contract" or clarify "definition-only" in a footnote).
2. Optionally add explicit test limits (e.g., "Add 2–8 focused tests") to "Tests first" subtasks for archetype compliance; current wording is acceptable for focused testing.
3. No other changes required.

## Conclusion

The specification is **implementation-ready**. Requirements accurately reflect user Q&A. The spec addresses the core problem (type/value mismatch, runtime-real mappings) without over-engineering. The initialization doc’s original "mappings on ExecutionContext" wording was superseded by user answers; spec and requirements correctly reflect mappings on the constructed contract. Minor issues (terminology, test count wording) do not block implementation.
