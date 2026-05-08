/**
 * Canonical control-plane identifiers for contract spaces.
 *
 * A contract space is the disjoint `(contract.json, migration-graph)` unit
 * the per-space planner / runner / verifier (project: extension contract
 * spaces, TML-2397) operates on. The application owns one well-known
 * space — the value below — and each loaded extension that contributes
 * schema owns a uniquely-named space.
 *
 * Lives in `framework-components/control` so every layer that has to
 * reason about space identity (the migration tooling, the SQL runtime's
 * marker reader, target-side statement builders, target-side adapters)
 * can import a single value rather than duplicating the literal. Raw
 * `'app'` string literals in framework / target / runtime / adapter
 * source code are forbidden and policed by
 * `scripts/lint-app-space-id.mjs` (wired into `pnpm lint:deps`).
 *
 * @see specs/framework-mechanism.spec.md § 3 — Layout convention (γ).
 */
export const APP_SPACE_ID = 'app' as const;
