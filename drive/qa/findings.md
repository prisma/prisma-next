# Drive trial — findings

> **Trial window:** 2026-05-19 → 2026-06-02. See [`drive/trial.md`](../trial.md) for the quality bar, tags, and format. Record only what meets the bar — `friction`, `gap`, `win`, `surprise`, `boundary`. One stanza per finding.

## 2026-05-20 · drive-qa-plan · gap

Manual-QA dry-run sampled preamble *placement* (right line, right format, cross-link resolves) across 19 atomic skills — found nothing wrong. Reviewer (CodeRabbit) then surfaced three "critical" findings on stop-condition *coherence*: the uniform delegated-execution preamble's "STOP. Dispatch on Read/Grep/Glob" rule contradicted multiple skill bodies whose Step 2 required Read/Grep investigation. Placement-sample missed it; coherence-sample would have caught it.

**Suggested action:** added a "sample coherence, not just placement" section to `drive/qa/README.md` (project-context). When manual-QA covers a preamble/boilerplate insertion across many files, sample both placement *and* coherence-with-each-file's-body via a 2-3 file deep-read pass.

**Upstream candidate?** Yes — the coherence-vs-placement distinction generalises to any manual-QA dispatch covering uniform insertions across many files.
