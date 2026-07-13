# Brief: D3 R2 (resumed) — address F1

Findings from R1 (all must resolve before SATISFIED):

- **F1 (should-fix):** extend the handle↔contract.json consistency loop in `test/contract-handles.test.ts` to compare per-column codec ids, not just column-name sets — the drift tripwire must catch a handle whose column codec disagrees with the shipped contract (the supabase precedent's demonstrated blind spot).

Decisions standing: parity-minus-gold-plating stance otherwise unchanged; no other surface changes.

Gates (restated): package test + typecheck (incl. test project) + lint; nothing else should move.
