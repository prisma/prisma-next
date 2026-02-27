---
name: drive-create-spec
description: Generate and iteratively refine engineering specs from a description, conversation summary,
  or blank template. Use when the user wants to create a spec, PRD, product requirements document,
  write up requirements, or spec out a feature. Also use when summarising a conversation into a spec.
metadata:
  version: "2026.2.23"
---

# Generate Spec

Produce a complete engineering spec by combining an engineer's input with senior-level assumptions, then iteratively refine it through targeted questions until the spec is solid enough to build from.

## File Naming

- **Project spec (shaping stage output)**: `projects/{project}/spec.md`
- **Task/feature spec (within a project)**: `projects/{project}/specs/{name}.spec.md` where `{name}` is kebab-case (e.g. `pdf-export.spec.md`, `webhook-retry.spec.md`)
- If the engineer does not specify a project, ask for a `{project}` slug (kebab-case) and create the directory structure under `projects/{project}/`.
- Note: `projects/{project}/` is **transient**. At project close-out, long-lived docs (ADRs, subsystem docs) should be migrated into `docs/` and the `projects/{project}/` folder deleted.

## Entry Points

Determine which entry point applies:

### 1. Blank template

The engineer asks for a blank or empty spec.

- Ask for the spec name (used to derive the file name), create the file using the **Spec Template** below with placeholder guidance intact.
- Then ask: *"Want me to help fill this in? Give me a rough description and I'll draft it."*

### 2. Description provided

The engineer supplies a description of what needs to be built (directly or via prompt).

- If no description was given yet, ask:
  *"Give me a short description of what needs to be built: problem, users, rough scope. I'll draft the spec from there."*
- Once received, proceed to **Drafting**.

### 3. Conversation summary

After an extended conversation, the engineer (or you) wants to capture decisions as a spec.

- Synthesise the conversation into a description: key decisions, constraints, scope, and unresolved items.
- Proceed to **Drafting** using that synthesised description.

## Drafting

Given a description, generate the full spec:

1. **Determine the file path.** If not already provided, ask:
   - The `{project}` name (kebab-case)
   - Whether this is the **project spec** (shaping output) or a **task/feature spec**
   Then derive:
   - Project spec: `projects/{project}/spec.md`
   - Task/feature spec: `projects/{project}/specs/{name}.spec.md`
2. **Fill every section** of the template below. Apply senior/staff/principal-level engineering judgment:
   - Infer reasonable functional and non-functional requirements from the problem space.
   - Propose sensible defaults for security, observability, cost, and data protection, even if the engineer didn't mention them.
   - Write user stories that reflect real usage, not boilerplate.
   - Flag scope boundaries in "Non-goals" based on what would be a natural phase 2.
3. **Derive acceptance criteria.** Extract testable acceptance criteria from the functional requirements, non-functional requirements, and any explicit success conditions. Each criterion should be:
   - Binary: met or not met
   - Verifiable: can be validated through a test, observation, or measurement
   - Traceable: maps back to a specific requirement
   If the description lacks enough detail to define meaningful criteria for an area, ask:
   *"The spec doesn't define clear success conditions for [area]. What does 'done' look like for this?"*
4. **Populate Open Questions** with anything that is ambiguous, under-specified, or where multiple valid approaches exist. Frame questions specifically: not "what about security?" but "should auth tokens be short-lived JWTs or opaque session tokens, and what's the revocation strategy?"
5. **Write the spec file.**
6. Proceed to **Refinement**.

### Making Assumptions

When drafting, prefer making a reasonable assumption over leaving a section blank. Mark assumptions clearly:

```
**Assumption:** API responses target p99 < 500ms based on typical SaaS latency expectations.
```

If an assumption is low-confidence or high-impact, add it as an open question instead.

## Refinement

After writing the initial spec, enter a refinement loop:

1. **Present open questions in the chat window.** Format them as a numbered list so the engineer can respond by number or inline. Example:

   ```
   I've drafted the spec at projects/my-proj/specs/feature-x.spec.md. A few things to resolve:

   1. Should the webhook retry strategy use exponential backoff or fixed intervals? I assumed exponential (1s, 2s, 4s, 8s, max 60s) — does that work?
   2. The description mentions "admin users" — is this the existing RBAC admin role, or does this need a new permission scope?
   3. For the data retention policy, is 90 days sufficient or do compliance requirements dictate longer?
   ```

2. **Process answers.** For each answer:
   - Update the relevant spec section.
   - If the answer reveals new ambiguity, add follow-up questions.
   - If you can make a reasonable inference from the answer, do so and note the assumption.

3. **Repeat** until:
   - No open questions remain, or
   - Remaining questions are low-priority and can be resolved during implementation.

4. When satisfied, confirm with the engineer:
   *"The spec looks solid. Remaining items in Open Questions are implementation-time decisions. Ready to finalise?"*

## Spec Template

Use this structure for every spec. Remove placeholder guidance when filling in real content.

```markdown
# Summary

_Synthesise a 1-3 sentence summary from the description. Do not ask the user for this: derive it._

# Description

_If not already provided, ask the user to describe what needs to be built: problems to solve, users affected, and technology preferences. This section is the input; everything else is derived from it._

# Requirements

## Functional Requirements

_Infer functional requirements from the description. Write them as user stories or concrete capabilities. Only ask the user to confirm or correct: don't ask them to enumerate from scratch._

## Non-Functional Requirements

_Apply sensible defaults (e.g. p99 latency < 500ms, 99.9% availability) based on the system type. Flag any assumption that depends on scale or SLA tier the user hasn't mentioned._

## Non-goals

_Infer natural phase-2 items and scope boundaries from the description. Ask the user only if the boundary between in-scope and out-of-scope is genuinely ambiguous._

# Acceptance Criteria

_Derive testable criteria from the functional and non-functional requirements. Each criterion is binary (met or not met) and verifiable. Group by area where it aids readability._

- [ ] _Criterion derived from a functional requirement_
- [ ] _Criterion derived from a non-functional requirement_
- [ ] _Criterion covering an edge case or failure mode_

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

_List specific, high-impact questions where the answer materially changes the design. Each question should explain why it matters and, where possible, state your default assumption so the user can simply confirm or override._
```

## Guidelines

**Do:**

- Fill every section, even if with a short assumption: an empty section is a missed signal.
- Write questions that are specific and actionable, not vague.
- Make assumptions where reasonable and mark them clearly.
- Update the spec file in-place after each round of answers.
- Keep the conversation efficient: batch related questions together.
- Write acceptance criteria that are concrete enough to write tests against.

**Don't:**

- Leave sections blank with "TBD": either fill with an assumption or add an open question.
- Ask questions the engineer already answered in their description.
- Over-index on formality: this is a working document, not a contract.
- Assume the engineer has no opinions: always present your assumption and ask if it holds.
