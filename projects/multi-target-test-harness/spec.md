# Summary

_Drafted via drive-create-spec. Replace this placeholder._

Confidence in correctness across Postgres, SQLite, and MongoDB via a shared, parameterized test suite that exercises the same scenarios on every target.

# Description

_Problem, users, scope. Replace this placeholder._

Today's tests are per-target and ad hoc. A shared test suite exercising the same scenarios across all three targets catches family-specific bugs, ensures behavioural consistency, and prevents regressions. Early pairing with @serhii on adapting prisma/prisma's functional client suite is the groundwork.

# Requirements

## Functional Requirements

## Non-Functional Requirements

## Non-goals

# Acceptance Criteria

- [ ] _Replace this placeholder_

# References

- Linear project: https://linear.app/prisma-company/project/pn-may-ws4-multi-target-test-harness-ee1b4ec0a6ba
- Pairing partner: @serhii (prisma/prisma functional client suite)

# Open Questions

- WS4 Workers test dimension: add a Workers (Miniflare) target, or treat the MAP port as the sole Workers validation?
