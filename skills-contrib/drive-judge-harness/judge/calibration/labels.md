# Judge calibration — held-out human-label store

This file is the seeded, currently-empty corpus of human-labelled judgements
the judge's `intent` verdicts must agree with at **≥0.80** before the judge's
output is trusted as the Tier-1 `intent` correctness signal.

## Status

**Uncalibrated.** The corpus is intentionally empty until the live-experiment
harness has produced ~10–20 instrumented Drive runs across the golden cases.
That run-production is operator-gated on real-dollar model spend, so the actual
calibration is **parked**. The judge currently emits `intent` for every graded
run, but the run is flagged uncalibrated and the project-DoD calibration item
remains unchecked. The verdict is emitted honestly, not silently trusted.

## Format

When the corpus is being grown, append one entry per labelled run. The schema
mirrors `LabelledVerdict` in `calibration.ts`:

```jsonc
// each entry pins a run id, the judge's verdict, the human label, and a note
{
  "run_id": "<project-run-id>",
  "case_slug": "<golden-case-slug>",
  "judge": "pass" | "fail" | null,
  "human": "pass" | "fail" | null,
  "note": "short rationale for the human label"
}
```

Hold-out discipline: a run that has been used to **tune** the judge's prompts
is not eligible to be held out for calibration. Held-out runs are graded by
the locked judge before being labelled by the human — never the other way.

## Running the calibration

The runner is not built this slice (parked). When it lands it loads the
labelled corpus, calls `agreementRate` from `calibration.ts`, and reports
`{rate, n, passes}`. The judge is "calibrated" the first time it clears
`passes: true` on a hold-out subset; drift monitoring then re-runs the same
gate periodically.

## References

- `calibration.ts` — the agreement tally + 0.80 gate.
- Slice spec: `projects/drive-judge-harness/slices/llm-judge/spec.md` §
  Calibration harness — built, run deferred.
