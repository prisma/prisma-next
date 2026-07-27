## 2026-07-27 — Validate tight CLI subprocess gates away from mounted worktree overhead

**Trigger:** Mandatory final retro at project close (invariant I10).

**What happened:** The final `pnpm test:packages` run repeatedly timed out CLI redirect and version tests at their fixed 500 ms Vitest deadline in the mounted source worktree, even after isolated reruns. The same exact commit and byte-identical CLI subtree passed those tests and the complete validation matrix from an independent ext4 checkout.

**Root cause:** The project’s final-validation protocol treated a source-worktree failure as the only available evidence. It had no failure-mode entry requiring an exact-HEAD local-filesystem confirmation when a tight subprocess deadline is sensitive to mounted-worktree startup cost.

**Landing surface(s):**

- Project-context: `drive/calibration/failure-modes.md` § F27 — defines the mounted-worktree deadline signal and the exact-HEAD local-filesystem validation protocol.
