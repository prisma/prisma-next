# Iterate on PR Review (Fetch → Triage → Implement → Repeat)

This command runs the full review loop until there are no remaining actionable review items.

## PHASE 1: Identify the spec folder + PR

You need:
- PR URL (preferred)
- Spec folder path `agent-os/specs/<spec>/`

If missing, ask and WAIT:

```
Please provide:
1) The PR URL
2) The spec folder path (agent-os/specs/<spec>/)
```

## PHASE 2: Loop until clear

Repeat:

1. Run `/agent-os/triage-review @agent-os/specs/[this-spec]/`
2. Run `/agent-os/address-review-actions @agent-os/specs/[this-spec]/`
3. Re-run `/agent-os/triage-review @agent-os/specs/[this-spec]/`

Stop when `review-actions.md` reports “Complete / No remaining actionable review items” and the fetched review state indicates no unresolved actionable threads.

## Guardrails

- Keep commits granular and intent-driven.
- Never commit broad untracked directories as a side effect of the loop.
- Resolve a thread only when it’s either:
  - implemented (reply “Done”), or
  - explicitly not addressed in this PR (reply with rationale + resolve).
