# Drive `health` context

> Read by `drive-check-health` before it starts. Capture project-specific facts the generic skill can't know. Update when a health check surfaces something the next check should inherit.

**Skills served:** `drive-check-health`

## Rollup cadence

<!-- When this team runs health checks: slice-merge, day-end, week-end, on-demand. Default per drive-check-health is slice-merge + drift-alarm; override here. -->

## Drift thresholds

<!-- Thresholds that trigger an alarm: dispatches stuck > N days, PR size > LOC, slice age > N days, dispatch failures per slice > N. -->

## Dashboard locations

<!-- Where the team's health view lives — Linear project view, custom board, drive/health/dashboard.md, Notion page, etc. -->

## Status-update conventions

<!-- How findings get communicated — Linear project status, Slack channel, async post, sync standup. -->

## Known false positives

<!-- Things that look like drift but aren't, given this project's particular shape. Populated by retros. -->
