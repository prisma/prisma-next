# Sub-agent registry: mongo-driver-version-support

> Working record of which spawned sub-agent ID belongs to which role/variant for this project. See [`drive/roles/README.md` § Sub-agent registry pattern](../../drive/roles/README.md#sub-agent-registry-pattern) for the canonical schema.

## Sub-agent registry

| Role / variant | Sub-agent ID | Tier | Status | Last used |
|---|---|---|---|---|
| recon-specialist | 85336a16-aaa7-478d-ac30-2fe732a57f9f | high (`claude-opus-4-7-thinking-high`) | released (open-question research delivered; verdicts folded into spec / design-notes / plan) | 2026-05-26 |
| setup-specialist | 1bc3f499-187b-4c4a-94c4-32306efdca79 | high (`claude-opus-4-7-thinking-high`) | released (project-setup phase complete; `spec.md` + `plan.md` landed) | 2026-05-26 |

## Dispatch log

### 2026-05-22 — recon-specialist initial spawn

- **Brief:** mongo-driver surface-area reconnaissance — enumerate `mongodb` dependency declarations and imports across the repo, classify by usage shape, summarise v6→v7→v8 breaking-change surface, synthesise a "what changes if we want to support driver Y" matrix.
- **Output target:** [`./research/mongo-surface-area.md`](./research/mongo-surface-area.md)
- **Tier rationale:** Section 3 (changelog synthesis) and Section 4 (cross-reference matrix) require non-trivial synthesis; the floor for substantive synthesis in this environment is `claude-opus-4-7-thinking-high` per the `subagent-explicit-model` skill. Operator authorised the tier explicitly ("opus") on 2026-05-22.

### 2026-05-26 — recon-specialist resumed for open-question research

- **Brief:** Research and answer the four open questions in `spec.md` (BSON v7 class shapes, `collection.drop()` callers, cursor `batchSize` blast radius, `connect()` fail-fast / lazy-error tests). Each gets a verdict (confirm / update / escalate the working position).
- **Output target:** [`./research/open-questions.md`](./research/open-questions.md) (new artifact, separate from `mongo-surface-area.md`).
- **Tier rationale:** Resume preserves prior codebase context (the surface-area recon they wrote covers the symbols + call sites the audit needs). Resume forces opus-high (prior tier); justified by the synthesis the four questions need (web research on BSON release notes + codebase audit + recommendation per question).

### 2026-05-26 — setup-specialist initial spawn

- **Brief:** Author `projects/mongo-driver-version-support/spec.md` from the settled design-notes via `drive-specify-project`. Single-slice project, single-major peer range `^7.0.0`, no re-opening of design decisions.
- **Output target:** [`./spec.md`](./spec.md)
- **Resumption intent:** persistent across the project-setup phase. Same agent will be resumed for `drive-plan-project` once the spec settles, then released. Per the registry pattern in [`drive/roles/README.md`](../../drive/roles/README.md#sub-agent-registry-pattern), this avoids re-pasting the design-notes + recon artifact on the plan-step dispatch.
- **Tier rationale:** spec authoring is substantive synthesis — pulling settled-design context into spec language, walking project-DoR, and grounding claims against codebase state. Floor for substantive synthesis is `claude-opus-4-7-thinking-high`. Operator authorised the dispatch on 2026-05-26.
