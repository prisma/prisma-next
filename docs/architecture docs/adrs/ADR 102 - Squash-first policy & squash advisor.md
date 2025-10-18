ADR 102 — Squash-first policy & squash advisor

Status: Proposed
Date: 2025-10-18
Owners: Data Layer Working Group

Context

Migration histories tend to accumulate branches and long chains, increasing pathfinding complexity and review burden. Our model supports baselines that collapse a set of edges into a single ∅ → H_latest edge embedding the destination contract. We want a default squash-first posture that nudges teams toward a small active chain while keeping history auditable

Problem
	•	Long chains hurt determinism, performance, and comprehension
	•	Parallel edges and orphans appear more often in large DAGs
	•	Teams need a gentle, configurable way to keep DAGs small without mandating a committed graph index

Goals
	•	Encourage short active chains via regular baselines
	•	Provide clear, actionable suggestions and one-command automation
	•	Keep policy flexible across teams and environments
	•	Preserve safety and auditability

Non-goals
	•	Automatic graph surgery on feature branches
	•	Removing historical edges from the repo
	•	Replacing code review of migration operations

Decision

Adopt a squash-first default posture with a Squash Advisor implemented on the Advisors framework (ADR 101)

Policy defaults
	•	Suggest squashing when the newest edge since the last baseline is older than 14 days
	•	Suggest squashing when >20 edges exist since the last baseline
	•	Do not suggest until there are at least 5 edges since the last baseline
	•	Require green preflight on a shadow DB and shadow proof that applying the current chain yields the same destination contract as the proposed baseline before suggesting automation

Teams can tune or disable these defaults

Advisor rules
	•	squash.age-window evaluates newest edge age since last baseline and emits a warn advisory with evidence { lastBaselineAt, newestEdgeAt, days }
	•	squash.edges-since-baseline evaluates edge count since last baseline and emits a warn advisory with evidence { count }
	•	squash.baseline-missing warns when the repo has no baseline and more than minEdgesBeforeSuggest edges exist

Suggested actions
	•	migrate baseline create generates a baseline edge ∅ → H_latest, embedding the destination contract.json, and marks prior edges as archived: true
	•	In PPg, a “Generate baseline PR” action opens a PR with the baseline edge and a summary of collapsed edges

Safety rules
	•	Baselines are for new environments only
	•	The runner treats a baseline edge as a no-op on databases that already have a contract marker
	•	CI in enforce mode can block merges when thresholds are exceeded without an accompanying baseline PR

Configuration

{
  "advisors": {
    "mode": "suggest",
    "rules": {
      "squash.age-window": { "level": "warn", "windowDays": 14, "minEdgesBeforeSuggest": 5 },
      "squash.edges-since-baseline": { "level": "warn", "maxEdgesSinceBaseline": 20 },
      "squash.baseline-missing": { "level": "warn" }
    }
  },
  "squashPolicy": {
    "exemptLabels": ["long-lived", "regulatory"],
    "requireGreenPreflight": true,
    "requireShadowProof": true
  }
}

	•	Teams that prefer long histories can set advisors.mode: "off" and optionally adopt a committed graph index
	•	Exempt labels may suppress suggestions for specific branches or edges

Consequences

Positive
	•	Keeps DAGs small and pathfinding simple without enforcing a graph index
	•	Makes baseline creation predictable and auditable
	•	Reduces CI noise and increases determinism

Negative
	•	Another decision point for teams with unique compliance requirements
	•	Additional CLI surface and PR automation to maintain

Mitigations
	•	Advisor defaults are gentle and configurable
	•	Baseline creation is opt-in and requires green preflight and shadow proof by default
	•	Archived edges remain available for audit and visualization

Alternatives considered
	•	Mandatory graph index
	•	Aggressive automatic squashing
	•	Relying solely on documentation for migration hygiene

Implementation notes
	•	Implement migrate graph status to compute edgesSinceBaseline and lastBaselineAt
	•	Implement migrate baseline create to produce ∅ → H_latest with embedded destination contract
	•	Mark previous edges as archived: true and exclude from pathfinding
	•	PPg adds a PR annotation with a button to generate a baseline PR

Testing
	•	Fixtures with and without baselines, varying edge counts and ages
	•	Preflight gating tests to ensure we only suggest when safe
	•	PPg PR flow tests creating a baseline PR from advisories

References
	•	ADR 101 — Advisors framework
	•	ADR 028 — Migration ledger & squash semantics
	•	ADR 039 — DAG path resolution & integrity
	•	ADR 051 — PPg preflight-as-a-service contract
