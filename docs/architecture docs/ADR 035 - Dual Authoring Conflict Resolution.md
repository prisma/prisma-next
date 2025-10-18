ADR 035 — Dual authoring conflict resolution

Status: Proposed
Date: 2025-10-18
Owners: Prisma Next team
Related: ADR 006 dual authoring modes, ADR 010 canonicalization rules, ADR 032 dev auto-emit integration

Context
	•	Prisma Next supports both PSL-first and TS-first authoring modes
	•	Teams may have both PSL and TS contract files in the same repository
	•	We need clear precedence rules and conflict detection to prevent silent divergence
	•	Agents and CI must be able to detect when both modes exist and produce different results

Decision
	•	Define precedence: when both PSL and TS exist, the canonical JSON is the single source of truth
	•	If emit(psl) and canonicalize(ts) yield different coreHashes, fail CI with a diagnostic diff
	•	Permit one-time "adopt" flow to switch canonical authoring mode

Precedence rules

Single source of truth
	•	When both PSL and TS contract files exist, the canonical JSON emitted from the configured authoring mode is authoritative
	•	The other mode's files are treated as reference only and may be regenerated for documentation purposes
	•	Configuration determines which mode is canonical: authoring: 'psl' | 'ts' in prisma-next.config.ts

Conflict detection
	•	CI must run both emit(psl) and canonicalize(ts) and compare coreHashes
	•	If coreHashes differ, fail with structured diagnostic showing:
		•	Differences in models, fields, relations, storage layout
		•	Suggested reconciliation steps
		•	One-time migration commands to adopt a single mode
	•	Profile hash differences are warnings, not errors, unless configured otherwise

Adopt flow
	•	prisma-next adopt --from psl --to ts: converts PSL to TS contract and updates config
	•	prisma-next adopt --from ts --to psl: converts TS to PSL and updates config
	•	Adopt commands:
		•	Validate that both modes produce identical coreHash
		•	Update prisma-next.config.ts authoring field
		•	Optionally archive or remove the non-canonical files
		•	Regenerate artifacts using the new canonical mode

Configuration enforcement
	•	prisma-next.config.ts must declare authoring: 'psl' | 'ts'
	•	Dev plugins respect the configured authoring mode
	•	CI tools validate that artifacts match the configured mode
	•	Runtime accepts contracts from either mode but canonicalizes TS contracts to compute coreHash

Error taxonomy
	•	CONFLICT.DUAL_AUTHORING: both PSL and TS exist with different coreHashes
	•	CONFLICT.MODE_MISMATCH: configured authoring mode doesn't match available files
	•	CONFLICT.CANONICALIZATION_FAILED: TS contract cannot be canonicalized to valid JSON

CI integration
	•	prisma-next verify --strict: fails on any dual authoring conflicts
	•	prisma-next verify --check: warns on conflicts but allows CI to pass
	•	GitHub/GitLab apps can surface conflict diagnostics in PR comments
	•	Preflight jobs must use the canonical mode specified in config

Agent support
	•	Agents can detect dual authoring conflicts and suggest resolution
	•	Structured diagnostics enable automatic conflict resolution in some cases
	•	Adopt commands provide clear migration path between modes

Backwards compatibility
	•	Existing PSL-only projects continue to work unchanged
	•	New TS-first projects are supported without PSL files
	•	Mixed-mode projects require explicit configuration to resolve conflicts
	•	No breaking changes to existing workflows

Testing
	•	Conflict detection tests with intentionally divergent PSL and TS contracts
	•	Adopt flow tests for both directions
	•	CI integration tests with GitHub/GitLab apps
	•	Agent workflow tests for conflict resolution

Open questions
	•	Whether to support gradual migration with temporary dual-mode periods
	•	Policy for teams that want to maintain both PSL and TS for different purposes
	•	Integration with version control to track authoring mode changes

Decision record
	•	Adopt strict precedence rules with conflict detection to prevent silent divergence
	•	Provide clear migration path between authoring modes
	•	Ensure CI and agents can detect and resolve dual authoring conflicts
