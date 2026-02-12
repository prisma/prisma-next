# Spec Initialization: Deterministic PR review framework

## Initial Description

Build a deterministic, agent-friendly PR review iteration framework around GitHub review threads and review state:

- Avoid manual one-off shell loops by encoding repeatable analysis steps as CLI scripts.
- Keep a canonical JSON representation of review state (`review-state.json`) and a canonical JSON action plan (`review-actions.json`).
- Make Markdown views deterministic transforms from JSON (e.g. render `review-actions.md` from `review-actions.json`).
- Provide pure scripts for deterministic transforms and summaries (unit-testable, no network).
- Provide explicit side-effect scripts for GitHub administration (reply/react/resolve) that are idempotent and safe to retry, with `--dry-run` defaults.
- Include a reliable workaround for Cursor sandbox TLS/cert errors when running `gh api` (re-run GitHub mutation steps outside the sandbox; never disable TLS verification).

