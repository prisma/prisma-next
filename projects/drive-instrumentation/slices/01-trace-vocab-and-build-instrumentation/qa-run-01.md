# QA run 01 — slice 01 trace vocabulary + build instrumentation

**Date:** 2026-05-28  
**Runner:** implementer subagent (D3 R1 walkthrough)  
**Mode:** Walkthrough — synthetic scenario simulating orchestrator emit decisions at each anchor in `skills-contrib/drive-build-workflow/SKILL.md § The per-dispatch loop`. No live agent dispatch.  
**Trace evidence:** [`qa-trace-01.jsonl`](./qa-trace-01.jsonl) (committed copy; canonical in-project runtime path would be `projects/drive-instrumentation/trace.jsonl` per [`docs/drive/trace-emission.md`](../../../../docs/drive/trace-emission.md)).

## Scenario

Hypothetical 2-dispatch slice under project `drive-instrumentation`:

| Dispatch | `dispatch_id` | Rounds | Outcome |
|---|---|---|---|
| D1 (vocab + emission docs) | `d1111111-1111-4111-8111-111111111111` | 2 | R1 triage `ANOTHER ROUND NEEDED` (1 finding filed); R2 triage `SATISFIED`; `dispatch-end.result = completed` |
| D2 (instrument drive-build-workflow) | `d2222222-2222-4222-8222-222222222222` | 1 | R1 triage `SATISFIED`; `dispatch-end.result = completed` |

Load-bearing edge cases exercised:

- **Multi-round dispatch:** D1 has two `round-end` events (`rounds_per_dispatch = 2`).
- **Amended brief:** D1 R2 `brief-issued.brief_disposition = "amended"` (hash differs from R1).
- **Initial brief:** D1 R1 and D2 R1 use `"initial"`.

Walkthrough followed emit anchors in order: § 1 `dispatch-start` (round 1 only) → § 1 `round-start` → § 2 `brief-issued` → (simulated `drive-dispatch` / review / triage gap) → § 6 `round-end` → repeat for next round → § 6 `dispatch-end` on close.

## QA check results

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Trace file at resolved path | **Pass** | Evidence file `qa-trace-01.jsonl` exists in slice folder; in-project canonical path documented as `projects/drive-instrumentation/trace.jsonl`. |
| 2 | All five event types present | **Pass** | One or more of each: `dispatch-start`, `dispatch-end`, `round-start`, `round-end`, `brief-issued`. |
| 3 | Every line valid JSON | **Pass** | `jq -c . qa-trace-01.jsonl > /dev/null` exit 0. |
| 4 | Payload shape matches vocabulary | **Pass** | All 13 events: flat objects with envelope + event-specific fields only; `schema_version: "1"`; enums and integer types match `docs/drive/trace-events.md`. |
| 5 | Per-dispatch temporal ordering | **Pass** | D1: `dispatch-start → (round-start → brief-issued → round-end)×2 → dispatch-end`. D2: `dispatch-start → round-start → brief-issued → round-end → dispatch-end`. |
| 6 | `rounds_per_dispatch` computable | **Pass** | See hand-computation below. |
| 7 | Brief-churn narrow metric computable | **Pass** | See hand-computation below. |

## Hand-computation: `rounds_per_dispatch`

Count `round-end` events grouped by `dispatch_id`:

| `dispatch_id` | `round-end` count | `rounds_per_dispatch` |
|---|---|---|
| `d1111111-1111-4111-8111-111111111111` (D1) | 2 | **2** |
| `d2222222-2222-4222-8222-222222222222` (D2) | 1 | **1** |

Verification command output equivalent:

```text
      2 d1111111-1111-4111-8111-111111111111
      1 d2222222-2222-4222-8222-222222222222
```

## Hand-computation: brief-churn narrow metric

For each `dispatch_id`: `S = sum(brief_byte_length)`, `M = max(brief_byte_length)`, churn = `S / M`.

**Dispatch D1** (`d1111111-…`):

| Round | `brief_byte_length` | `brief_disposition` |
|---|---|---|
| 1 | 2048 | initial |
| 2 | 3072 | amended |

- `S = 2048 + 3072 = 5120`
- `M = 3072`
- **Brief-churn = 5120 / 3072 ≈ 1.667**

**Dispatch D2** (`d2222222-…`):

| Round | `brief_byte_length` | `brief_disposition` |
|---|---|---|
| 1 | 2560 | initial |

- `S = 2560`, `M = 2560`
- **Brief-churn = 2560 / 2560 = 1.0**

## Behaviour-preservation read-through

The five emit blockquotes in `skills-contrib/drive-build-workflow/SKILL.md` are additive insertions; surrounding workflow prose is unchanged. Adjacent to the § 1 `dispatch-start` emit-site, the DoR checklist remains verbatim:

> Before delegating, walk:
>
> - [ ] Slice-plan entry has outcome / builds-on / hands-to / focus filled.
> - [ ] **Dispatch passes dispatch-INVEST** (Independent, Negotiable, Valuable, Estimable, Small, Testable — see [`docs/drive/principles/sizing.md`](../../docs/drive/principles/sizing.md); per-altitude rubric specialised for this codebase at [`drive/calibration/sizing.md`](../../drive/calibration/sizing.md)). *Small* is the most common failure mode: a dispatch whose brief + references don't fit in one executor session, or whose outcome covers more than one sentence, fails *Small* and must be split or sharpened.

No emit-site rewrites § 3 WIP inspection, § 4 DoD, § 5 reviewer delegation, or § Stop conditions semantics.

## Design choices (walkthrough ambiguities)

| Choice | Reading |
|---|---|
| `wall_clock_ms` | Integer milliseconds per vocabulary; computed from synthetic `ts` deltas, not floats. |
| `orchestrator_agent_id` | `null` per slice-1 working position (not knowable from walkthrough). |
| Gap between `brief-issued` and `round-end` | No trace events for WIP / DoD / review (slice-1 spine only). |

## Status

**no unresolved 🛑 Blocker findings**
