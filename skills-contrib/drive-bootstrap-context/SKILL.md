---
name: drive-bootstrap-context
description: >
  Scaffold the drive/ project-context directory in a consumer project so drive-* skills
  have somewhere to read project-specific context from. Use when a drive-* skill has
  hard-errored on a missing drive/<category>/README.md, or when onboarding a new project
  that will use drive skills. Creates drive/<category>/README.md for each known drive
  skill family, copying templates from this skill's templates/ sibling. Idempotent --
  does not overwrite existing READMEs. Imported from ignite PR #93; canonical-source
  resolution adapted for the trial period.
metadata:
  version: "2026.5.19"
---

> **Execution mode: delegated.** This atomic skill is invoked by an Executor sub-agent under an Orchestrator's dispatch brief. The Executor's job is to execute the skill end-to-end within the dispatch scope and return a structured report.
>
> Stay within the dispatch brief's scope. If the skill's body suggests work outside the brief, surface a heartbeat, request scope clarification from the Orchestrator, and do not improvise. See [`drive/roles/README.md`](../../drive/roles/README.md) for the canonical Executor role definition and report-back conventions.

# Drive: Bootstrap Project-Context Directory

Scaffold the `drive/` directory so drive-* skills have a project-context surface to read from. Skills are portable across teams, but running them well requires project-specific knowledge the generic skill body can't know a priori (e.g., this codebase's QA needs to verify two consumer audiences; this team's PRs go through a non-standard label workflow). That knowledge lives in `drive/<category>/README.md` at the consumer repo root.

This skill scaffolds those directories. It does **not** fill them in — the operator (or a downstream drive-* run that surfaces project-specific context via the write-back contract) does that. The goal is to get the directory shape on disk so consumer skills can read it, and to give the operator a template they can fill in.

## When to use

- A drive-* skill hard-errored with a "missing `drive/<category>/README.md`" message and offered to invoke this skill inline (or pointed the user at it).
- A new consumer project is being onboarded to drive skills, and the operator wants the full directory shape scaffolded up front.
- An existing project is being brought into the context convention for the first time (likely paired with `drive-reconcile-skills` to extract any project-specific edits already living inside the skill bodies).

**Do not use this skill for:**

- A `drive/` directory that already exists and is populated. The skill is idempotent (skips existing READMEs), but running it on a fully populated tree is a no-op.
- A project that doesn't use drive-* skills. Nothing to bootstrap.

## Known categories

Each category corresponds to a family of drive-* skills that share project-specific context. Granularity is the family, not the individual skill — `drive/qa/` serves both `drive-qa-plan` and `drive-qa-run`.

| Category | Skills served | What the README typically captures |
| --- | --- | --- |
| `spec` | `drive-specify-project`, `drive-specify-slice` | Spec template variations, required sections beyond the canonical skeleton, project-specific stakeholders. |
| `project` | `drive-create-project`, `drive-close-project` | Project-tracking conventions (Linear board, project-file layout, close-out destinations, archive location). |
| `plan` | `drive-plan-project`, `drive-plan-slice` | Plan-shape conventions, test-design table variations, parallelism rules for this codebase. |
| `qa` | `drive-qa-plan`, `drive-qa-run` | Consumer audiences, substrate locations, known coverage-gate gaps, fixture catalogues. |
| `code-review` | `drive-code-review` | Project-specific anti-patterns, review focus areas, ownership map. |
| `pr` | `drive-pr-description`, `drive-pr-walkthrough` | PR template variations, label conventions, CI gate context. |
| `triage` | `drive-triage-work` | Verdict-routing overrides, project-specific work-source surfaces. |
| `retro` | `drive-run-retro` | Team-specific prompts, recurring patterns to watch for, landing-surface conventions. |
| `health` | `drive-check-health` | Rollup cadence, drift thresholds, dashboard locations. |
| `deployment` | `drive-create-deployment-plan` | Deploy targets, rollback procedures, feature-flag conventions. |
| `post-update` | `drive-post-update` | Update destinations (Linear, Slack), expected cadence and tone. |

Mode / workflow-only skills (`drive-agent-personas`, `drive-discussion`, `drive-start-workflow`, `drive-build-workflow`, `drive-deliver-workflow`) are excluded — they do not produce per-category artefacts.

## Canonical-source resolution

Templates live alongside this skill at `skills-contrib/drive-bootstrap-context/templates/<category>.md` (in the prisma-next repo) during the trial period. Post-upstream (once the drive-* skill set lands in `prisma/ignite`), the canonical templates will live at `skills/.experimental/drive-bootstrap-context/templates/` in ignite, and consumers will pull via `npx skills`.

Trial-period mechanism: read the templates directly from the running repo (this skill's sibling `templates/` directory). No network fetch needed.

## Workflow

### 1. Determine scope

- If invoked because another drive-* skill hard-errored on a specific missing category, scaffold **only that category**.
- If invoked standalone (onboarding), scaffold **all categories** in the table above.

Ask the operator if the scope is ambiguous.

### 2. Locate the templates

Resolve the templates root per § Canonical-source resolution above. Verify the template file for each in-scope category exists; if any is missing, abort and surface the missing template list (templates are part of this skill's distribution — a missing template is a bug, not an operator-fixable condition).

### 3. Scaffold each in-scope category

For each in-scope category:

1. Check if `drive/<category>/README.md` exists in the consumer project.
2. If it exists, **skip** that category. Report "already scaffolded" and move on. **Never overwrite.**
3. If it does not exist, create the directory and copy the template to `drive/<category>/README.md`.
4. Do not commit. Leave the file uncommitted so the operator can review.

### 4. Report

Print a summary listing, for each category:

- `created` — template was copied to disk.
- `skipped` — README already existed.
- `not-requested` — out of scope for this run.

If any category was created, tell the operator to fill in the placeholder content before the next relevant drive-* skill run.

## What this skill doesn't do

- **Fill in context.** Templates are skeletons. The operator (or a downstream `drive-reconcile-skills` run, or a mid-run drive-* write-back) populates them.
- **Modify the drive-* skill files themselves.** The skill bodies already contain a "read `drive/<category>/README.md`" step; this skill only writes the file that step expects to find.
- **Commit.** Scaffolded files are left uncommitted for operator review.

## Common Pitfalls

1. **Overwriting an existing README.** Symptom: operator's hand-authored README replaced with a skeleton. Fix: existence check at step 3 is non-negotiable. Idempotency is the contract.
2. **Scaffolding categories the project doesn't need.** Symptom: bare `drive/deployment/README.md` exists in a repo with no deployment skill in use. Fix: standalone mode scaffolds all known categories by default; if the operator only wants a subset, use single-category invocation.
3. **Committing the scaffolded files.** Symptom: PR shows skeleton READMEs the operator hasn't filled in yet. Fix: skill leaves files uncommitted; operator decides when each is ready to ship.

## Reference files

- `templates/<category>.md` — one skeleton per known category, siblings to this SKILL.md.
- `../drive-reconcile-skills/SKILL.md` — when a project has drifted skill bodies, `drive-reconcile-skills` extracts the project-specific deltas into the scaffolded READMEs.
- `../drive-update-skills/SKILL.md` — routine refresh of in-repo drive-* skill copies against canonical.

## Checklist

- [ ] Determined scope: single-category (skill-triggered) or all-categories (onboarding).
- [ ] For each in-scope category, checked existence before writing.
- [ ] Copied template verbatim — no inline edits during scaffolding.
- [ ] Left scaffolded files uncommitted.
- [ ] Reported a `created`/`skipped`/`not-requested` summary to the operator.
- [ ] Told the operator to fill in placeholders before the next drive-* run.
