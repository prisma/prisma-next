---
name: drive-create-spec
description: >
  DEPRECATED — split into drive-specify-project (project-scope spec) and
  drive-specify-slice (slice-scope spec). Prefer the scope-specific variants. This body
  remains as shared reference material (template structure, anti-patterns, code-sample
  guidance) the split skills reference. New invocations should pick the right scoped
  skill; consumers using drive-create-spec via drive-reconcile-skills should migrate.
metadata:
  version: "2026.5.18"
  status: deprecated
  superseded_by:
    - drive-specify-project
    - drive-specify-slice
---

# Drive: Create Spec — DEPRECATED

**This skill is deprecated.** Use the scope-specific variants instead:

- **Project specs** → `drive-specify-project` (`projects/<project>/spec.md`).
- **Slice specs** → `drive-specify-slice` (`projects/<project>/slices/<slice>/spec.md` for in-project; inline in the PR description for orphan slices).

The split is per [`docs/drive/model.md`](/docs/drive/model.md) § Two skill tiers: project and slice specs differ in purpose, scope, and template; one skill conflated them at the cost of always asking *"what scope?"* at entry.

The body below remains as shared reference material — template structure, anti-patterns, code-sample guidance — that both scope-specific variants link back to. Treat the body as documentation, not invokable behaviour.

---

# Create Spec (reference)

Capture a settled design as an unambiguous engineering spec ready to hand to an implementer. The implementer should be able to read the spec alone and understand what the expected solution looks like, what's pinned down, and what degrees of freedom they have.

This skill is the **output** of the design phase, not part of it. If significant design questions remain, resolve them in a design discussion (using the appropriate skill) before invoking this one. Refinement here is for tightening ambiguity in the *recorded* design, not for re-opening it.

## Specs are short-lived

A spec lives for the lifetime of the project and is deleted at close-out. It is **not** an ADR or architecture doc.

That means it's appropriate (and often necessary) for a spec to talk about:

- The current state of the system at the time of writing
- Transition states the system will pass through during the project
- Migration steps, feature flags, deprecation timelines, and other temporary details
- Code paths or systems that exist today but won't after the project lands

If you find yourself writing something that should outlive the project (a durable architectural decision, a long-lived convention, a system invariant), don't worry about extracting it inline — the project close-out phase (`drive-close-project`) walks the project artifacts (specs and plans) and lifts any long-lived design decisions into ADRs or subsystem docs before deleting `projects/{project}/`. Capture the decision in the spec where it naturally lives; close-out will move it to its durable home.

## File Naming

- **Project spec (shaping stage output)**: `projects/{project}/spec.md`
- **Task/feature spec (within a project)**: `projects/{project}/specs/{name}.spec.md` where `{name}` is kebab-case (e.g. `pdf-export.spec.md`, `webhook-retry.spec.md`)
- If the engineer does not specify a project, ask for a `{project}` slug (kebab-case) and create the directory structure under `projects/{project}/`.
- Note: `projects/{project}/` is **transient**. At project close-out, use `drive-close-project` to migrate long-lived docs (ADRs, subsystem docs) into `prisma/ignite` (cross-cutting standards) or local `docs/` (repo-specific), then delete `projects/{project}/`.
- Avoid creating **durable repo docs** (e.g. `docs/**`, READMEs) that link into `projects/{project}/**`. If such links are temporarily useful during execution, the project close-out must remove/replace them with canonical `docs/` links before deleting `projects/{project}/`.

## Entry Points

Determine which entry point applies:

### 1. Blank template

The engineer asks for a blank or empty spec.

- Ask for the spec name (used to derive the file name), create the file using the **Spec Template** below with placeholder guidance intact.
- Then ask: *"Want me to help fill this in? Give me a rough description and I'll draft it."*

### 2. Design provided

The engineer supplies a settled design (directly or via prompt) that needs to be recorded.

- If no design was given yet, ask:
  *"Walk me through the design: the problem, who's affected, the approach you've settled on, and what's forcing the work now. I'll capture it as a spec."*
- If the description sounds like the design isn't settled (multiple competing approaches still under consideration, fundamental questions unresolved), say so and suggest the engineer use the `drive-discussion` skill first rather than drafting a spec prematurely.
- Once a settled design is in hand, proceed to **Drafting**.

### 3. Conversation summary

After an extended design conversation, the engineer (or you) wants to capture the resulting design as a spec.

- Synthesise the conversation into the **Context** shape: problem, users, settled approach, why now, and key constraints. Note residual implementer-facing decisions as open questions.
- If the conversation didn't actually settle the design (it was exploratory rather than concluding), surface that before drafting: a spec written over an unsettled design will mislead the implementer.
- Proceed to **Drafting** using that synthesised context.

## Consulting prisma/ignite

Before drafting, check `prisma/ignite` for existing standards, conventions, and architecture docs relevant to the feature area. This is Prisma's cross-cutting knowledge base — it may contain domain knowledge, API design principles, analytics conventions, or architectural decisions that should inform the spec.

**How to access:** Prefer reading from a local clone of `prisma/ignite` if one is available. If the engineer hasn't pointed you to one, ask where their local copy lives. Use your judgment on the best method to retrieve the information you need.

Incorporate relevant standards into the spec (e.g. analytics naming conventions, API design principles, observability patterns). Reference the ignite doc path in the spec's **References** section so the engineer knows where the conventions came from.

## Drafting

Given a description, generate the full spec:

1. **Determine the file path.** If not already provided, ask:
   - The `{project}` name (kebab-case)
   - Whether this is the **project spec** (shaping output) or a **task/feature spec**
   Then derive:
   - Project spec: `projects/{project}/spec.md`
   - Task/feature spec: `projects/{project}/specs/{name}.spec.md`
2. **Research the codebase state the spec is going to anchor on.** Before drafting, look up the DSL surfaces, IR shapes, package boundaries, and call sites the spec is going to reference. This is not optional and not a placeholder for asking the user. The agent must use Grep / Read / Glob / SemanticSearch to ground the spec's claims about what exists today, what naming conventions are in force, and which call sites would change. **Surfacing "I haven't checked yet" as an open question or a TODO in the spec is not acceptable** — either resolve the question against the codebase before drafting, or note explicitly in the spec that the question is one the codebase cannot answer (a design decision the user must make). Spec-writing asks the user for decisions the codebase cannot answer; it does not ask the user to substitute for a search tool.
3. **Write `Context` first.** `Context` is the *anchor* for the rest of the spec: a frame the reader holds in mind that lets them filter signal from noise in the requirements and AC that follow. A reader should be able to read `Context` alone and understand the problem, the settled approach, and why it fits. Downstream sections (Requirements, Acceptance Criteria) then read as confirmations of what `Context` already established, not as places to introduce new concepts. Concretely:
   - Write `At a glance` as a tight, concrete section that lets the reader answer two questions on a single skim: *what is happening in this spec* and *why should I care*. It does for `Problem` and `Approach` what `Context` does for the whole spec: an anchor at a smaller scale. After reading `At a glance` alone, the reader should be able to predict — roughly — what the rest of the spec will say, so that named functions, types, error codes, and components later in the spec land on something already in their head.

     Pick the form that makes the design tangible. Common shapes:
     - A 2-4 sentence prose paragraph (sometimes enough on its own, especially for small feature specs).
     - Prose plus a short code sample showing the new API, the new chain, the new error, or a before/after of the wire format. Often the most direct way to convey "what is happening" — the reader sees the actual thing.
     - Prose plus a small Mermaid diagram for sequence/flow/state changes.
     - A worked example: input → output, or current behaviour → new behaviour.

     Both [ADR 200](../../docs/architecture%20docs/adrs/ADR%20200%20-%20Placeholder%20utility%20for%20scaffolded%20migration%20slots.md) and [ADR 201](../../docs/architecture%20docs/adrs/ADR%20201%20-%20State-machine%20pattern%20for%20typed%20DSL%20builders.md) are good reference shapes — the same shape works for specs. Do not flatten `At a glance` into a fact sheet (status grid, bulleted metadata, labelled fields like *Owner: …*, *Risk: …*); that atomises the framing instead of anchoring it.
   - Write `Problem` as 2-4 paragraphs grounded in current state: incidents, code paths, error messages, why existing approaches fall short. Concrete references to today's system are appropriate — the spec is short-lived, so transient detail is fine here.
   - Write `Approach` as 2-4 paragraphs describing the settled solution and why it fits. Stay at the level of capabilities and shape, not implementation. Mermaid diagrams are good when they shorten prose. Code snippets are appropriate when they're the clearest way to convey the design — see **Code samples** below.
   - For small feature specs, `At a glance` plus a single `Approach` paragraph is often enough; the `Problem` subsection can be omitted when the problem is self-evident from the project spec.
4. **Fill the remaining sections** of the template below. Apply senior/staff/principal-level engineering judgment:
   - Derive functional and non-functional requirements directly from `Context`. If a requirement introduces a concept not established in `Context`, the narrative is incomplete: update `Context` first, then write the requirement.
   - Propose sensible defaults for security, observability, cost, and data protection, even if the engineer didn't mention them.
   - Write user stories that reflect real usage, not boilerplate.
   - Flag scope boundaries in "Non-goals" based on what would be a natural phase 2.
   - **Requirements describe what, not how.** State the capability or constraint, not the implementation. "Firewall hardening against DoS attacks" is a requirement. "Configure iptables with SYN-flood rules and fail2ban" is implementation detail for the plan or the implementer. Concrete performance targets (p99 latency, connection limits, throughput thresholds) belong in requirements. Mandated technology choices that reflect real organizational constraints (e.g., "metrics shipped to Clickhouse") also belong. Config variable names and system parameters do not.
5. **Derive acceptance criteria.** Acceptance criteria are verification scenarios, not restated requirements. Because `Context` carries the rationale, ACs should read tersely as a checklist: drop justification prose, focus on the observable outcome. A single AC describes an observable, testable scenario that may cover multiple related FRs/NFRs. If an AC would just be a requirement with a checkbox, it's not adding value: instead, write it as a scenario that describes how you'd actually verify the requirement (what you'd do, what you'd observe). Each criterion should be:
   - Binary: met or not met
   - Verifiable: can be validated through a test, observation, or measurement
   - Traceable: references the requirement IDs it covers (a single AC can cover multiple FRs/NFRs)
   Not every FR/NFR needs a dedicated AC. Infrastructure provisioning checks (e.g., "clock sync is configured") or requirements that can only be verified over long time periods (e.g., "logs retained for 90 days") may be verified during implementation rather than as acceptance criteria.
   If the description lacks enough detail to define meaningful criteria for an area, ask:
   *"The spec doesn't define clear success conditions for [area]. What does 'done' look like for this?"*
6. **Populate Open Questions** with the residual decisions that aren't pinned by the settled design but must be resolved before or during implementation. Frame questions specifically: not "what about security?" but "should auth tokens be short-lived JWTs or opaque session tokens, and what's the revocation strategy?" If a question can be answered by the implementer without changing the spec (VM sizing, config values, tooling choices that don't affect the design), it's not a spec-level question. If a question's answer would reshape `Context` itself (problem framing, choice of approach), the design isn't actually settled — go back to the design discussion before drafting further.
7. **Write the spec file.**
8. Proceed to **Refinement**.

### Default: every statement pins the design

Treat every explicit statement in the spec as something that pins the final design or constrains the solution space. The implementer will read it that way by default. If you don't intend to constrain the implementer on a particular point, either:

- Leave it out, or
- Mark it explicitly as illustrative or non-binding (see **Code samples** below for one common case).

This is how you communicate the implementer's degrees of freedom: by being deliberate about what the spec pins down and what it leaves open.

### Code samples

Code samples are appropriate — and often the clearest option — when:

- Describing an **interface** between systems: API contracts (request/response shapes, error envelopes), wire formats, programming interfaces, schemas.
- Describing an **algorithm** the spec mandates: when the algorithm *is* the design, prose or pseudocode often loses precision that real code preserves.
- Naming the exact **shape** of a type, payload, or return value where ambiguity in prose would mislead the implementer.

Mermaid diagrams remain a good option when they shorten prose (sequence diagrams, state machines, flowcharts).

When you include a code sample, decide whether it's **prescriptive** (the implementer must match it) or **illustrative** (it sketches the idea but the implementer has freedom in the specifics), and say so:

- For prescriptive samples, no annotation is needed — every spec statement is prescriptive by default.
- For illustrative samples, mark them clearly. Examples:
  > _Illustrative — exact field names and types are up to the implementer:_
  >
  > ```ts
  > interface RetryPolicy { ... }
  > ```

  > _Pseudocode, not a literal API:_
  >
  > ```
  > on event: enqueue → debounce 100ms → flush
  > ```

Bikeshedding is rarely a real concern when the design is settled, but ageing-out *is* a concern: when code samples become stale (renamed types, changed signatures), update the spec rather than letting it drift. The spec is short-lived enough that this rarely becomes a burden.

### Making Assumptions

When drafting, prefer making a reasonable assumption over leaving a section blank. Mark assumptions clearly:

```
**Assumption:** API responses target p99 < 500ms based on typical SaaS latency expectations.
```

If an assumption is low-confidence or high-impact, add it as an open question instead.

## Refinement

After writing the initial spec, enter a refinement loop. The goal here is to **tighten ambiguity in the recorded design** so the implementer reads a clear, unambiguous spec — not to re-open design decisions. If a question turns out to be a real design question, stop and flag that the design isn't actually settled.

1. **Present open questions in the chat window.** Format them as a numbered list so the engineer can respond by number or inline. Example:

   ```
   I've drafted the spec at projects/my-proj/specs/feature-x.spec.md. A few things to pin down:

   1. The retry strategy — you mentioned exponential backoff. I've recorded (1s, 2s, 4s, 8s, max 60s); confirm or correct?
   2. The description mentions "admin users" — is this the existing RBAC admin role, or does this need a new permission scope?
   3. For the data retention policy, is 90 days sufficient or do compliance requirements dictate longer?
   ```

2. **Process answers.** For each answer:
   - Update the relevant spec section.
   - If the answer reveals a small remaining ambiguity, add a follow-up question.
   - If you can make a reasonable inference, do so and note the assumption.
   - If the answer reveals that a fundamental design decision is still open, stop the refinement loop and surface that: the spec shouldn't be finalised over an unsettled design.

3. **Repeat** until:
   - No open questions remain, or
   - Remaining questions are intentionally left as implementer degrees of freedom.

4. When satisfied, confirm with the engineer:
   *"The spec captures the design unambiguously. Remaining items in Open Questions are implementer degrees of freedom. Ready to hand off?"*

## Spec Template

Use this structure for every spec. Remove placeholder guidance when filling in real content.

```markdown
# Summary

_Synthesise a 1-3 sentence summary from the description. Do not ask the user for this: derive it._

# Context

_The narrative spine of the spec, and the **anchor** the reader keeps in mind while reading the rest. A reviewer should be able to read `Context` alone and understand what's being built, why, and why this approach fits. Everything below `Context` (Requirements, Acceptance Criteria) confirms what's established here, not a place to introduce new concepts._

## At a glance

_A tight, concrete section that lets the reader answer two questions on a single skim: **what is happening in this spec** and **why should I care**. After reading this alone, the reader should be able to predict — roughly — what the rest of the spec will cover, so that named functions, types, error codes, and components later land on something already in their head._

_Pick whatever form makes the design tangible: prose, prose plus a short code sample of the new API/error/wire format, prose plus a small Mermaid diagram, or a before/after worked example. Don't flatten this into a fact sheet (status grid, bulleted metadata, labelled fields). See ADR 200 and ADR 201 in the architecture docs for reference shapes._

_Prose-only example (illustrative, not a template to copy verbatim):_

> _Engineers debugging production today juggle three observability backends with different schemas and dialects, which slows incident response and silos query knowledge in a handful of heads. We're building a read-only chat agent that introspects each source and emits a dialect-correct query the engineer can paste into Grafana, reusing the loggy deploy pattern already in production. Scope is deliberately weekend-shaped: single-user basic auth, no saved-query store in v1._

## Problem

_2-4 paragraphs on current state and pain points. Be concrete: link to incidents, point at code paths, quote error messages, name the systems involved. Explain why existing approaches fall short. Omit this subsection only when the problem is already obvious from the parent project spec._

## Approach

_2-4 paragraphs on the settled solution and why it fits the problem above. Stay at the level of capabilities and shape, not implementation: name the components, the data that flows between them, and the key behaviours. Mermaid diagrams are good when they shorten prose. Code snippets are fine — and often clearest — when describing an interface, schema, or algorithm; mark any sample as illustrative if you don't intend to pin its specifics. See **Code samples** in the Drafting section for guidance._

# Requirements

## Functional Requirements

_Derive functional requirements directly from `Context`. Write them as concrete capabilities, each with a unique identifier (FR1, FR2, ...). Group by area using subheadings where it aids readability. If a requirement introduces a concept not established in `Context`, update `Context` first. Only ask the user to confirm or correct: don't ask them to enumerate from scratch._

- **FR1.** _Requirement derived from the description_
- **FR2.** _Requirement derived from the description_

## Non-Functional Requirements

_Apply sensible defaults (e.g. p99 latency < 500ms, 99.9% availability) based on the system type. Each requirement gets a unique identifier (NFR1, NFR2, ...). Include concrete targets where they exist. Flag any assumption that depends on scale or SLA tier the user hasn't mentioned._

- **NFR1.** _Requirement with concrete target where applicable_
- **NFR2.** _Requirement with concrete target where applicable_

## Non-goals

_Infer natural phase-2 items and scope boundaries from the description. Ask the user only if the boundary between in-scope and out-of-scope is genuinely ambiguous._

# Acceptance Criteria

_Acceptance criteria are verification scenarios, not restated requirements. Because `Context` carries the rationale, keep ACs terse: a checklist a reviewer can scan, not a re-explanation of the design. Each AC gets a unique identifier (AC1, AC2, ...) and describes an observable outcome that can cover multiple FRs/NFRs. Each criterion is binary (met or not met) and verifiable. Prefer scenario form (what you'd do and what you'd observe), but declarative assertions are fine when a scenario would be forced (e.g., "build artifacts contain no secrets"). Group by area where it aids readability._

- [ ] **AC1.** _Verification scenario covering FR1, FR2, NFR3 — describes what you'd test and what the expected outcome is_
- [ ] **AC2.** _Verification scenario covering NFR1, NFR4 — describes a failure mode and the expected system behavior_
- [ ] **AC3.** _End-to-end scenario covering FR5, FR6 — describes an observable workflow and its expected result_

# Other Considerations

## Security

_Infer auth model, data sensitivity, and encryption needs from the description and existing system context. Only ask the user about decisions with multiple valid approaches (e.g. JWT vs session tokens, tenant isolation strategy)._

## Cost

_Estimate 30-day operating costs in orders of magnitude ($10s, $100s, $1000s) based on the architecture. Ask the user only if the expected load or infrastructure choices are unclear enough to swing the estimate by an order of magnitude._

## Observability

_Propose metrics, alerts, and logging based on the system type and failure modes. Ask the user only about business-specific SLOs or on-call expectations that can't be inferred._

## Data Protection

_Determine what personal data the system processes and which regulations likely apply. Ask the user only about jurisdiction-specific requirements or data retention policies that aren't safe to assume._

## Analytics

_Propose analytics events based on the user stories and key flows. Ask the user only about specific business metrics or reporting needs that aren't implied by the feature._

# References

_Ask the user for links to relevant documentation, architecture decisions, or existing systems that provide context you can't infer._

# Open Questions

_The residual decisions left for the implementer (or for resolution before/during implementation). These are the documented degrees of freedom: anything not pinned by the spec body is implicitly under the implementer's control, but list here the ones that need a deliberate choice. Each question should explain why it matters and, where possible, state your default assumption so the reader can simply confirm or override. Questions whose answers would change `Context` or the chosen approach do not belong here — those mean the design isn't settled, and a design discussion (not this spec) is the right next step._
```

## Guidelines

**Do:**

- Write `Context` first; let everything else fall out of it.
- Keep `Context` skimmable: `At a glance` should fit on one screen, and the full section shouldn't read like an implementation plan.
- Fill every section, even if with a short assumption: an empty section is a missed signal.
- Be deliberate about what the spec pins down vs leaves to the implementer; mark illustrative content as such.
- Use code samples when they're the clearest way to convey an interface, schema, or algorithm.
- Include transient details (current system state, transition states, migration steps) when they help the implementer; the spec is short-lived.
- Write questions that are specific and actionable, not vague.
- Make assumptions where reasonable and mark them clearly.
- Update the spec file in-place after each round of answers.
- Keep the conversation efficient: batch related questions together.
- Write acceptance criteria that are concrete enough to write tests against.

**Don't:**

- Use this skill to facilitate a design discussion. If the design isn't settled, stop and use the `drive-discussion` skill first.
- Leave sections blank with "TBD": either fill with an assumption or add an open question.
- Ask questions the engineer already answered in their description.
- Over-index on formality: this is a working document, not a contract.
- Assume the engineer has no opinions: always present your assumption and ask if it holds.
- Repeat `Context` content inside Requirements or Acceptance Criteria. If something appears in both, it belongs in `Context`, and downstream sections should reference the capability by name.
- Flatten `At a glance` into a fact sheet (status grid, bulleted metadata, labelled fields like *Owner: …*, *Risk: …*). It exists to anchor the reader in something concrete; fact sheets atomise the framing and break the anchoring effect. Code samples, diagrams, and worked examples are welcome — they are concrete.
- Include unmarked illustrative content. Anything stated explicitly is read as binding by default; if you don't intend to pin it, mark it illustrative or leave it out.
- Treat the spec as an ADR. Long-lived architectural decisions and conventions belong in ADRs or subsystem docs; the spec can reference them.
- Put implementation detail in requirements. Config parameters, specific CLI flags, kernel tuning values, and env var names belong in the implementation plan, not the spec.
- Reference private working documents (migration plans, personal notes, draft designs) as if they're authoritative. The spec must be self-contained: inline any needed context rather than pointing at external documents that may be incomplete, stale, or inaccessible to other readers. Stable references (Linear tickets, ADRs, published docs) are fine.
