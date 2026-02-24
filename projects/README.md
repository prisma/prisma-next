## Projects

This repo keeps **project-specific** specs, plans, ADR drafts, reference notes, and assets under `projects/`.

Anything in `projects/` is **transient**: once the project is complete, migrate long-lived docs to `docs/` and delete the project folder.

### Directory layout

- **Project root**: `projects/<project>/`
- **Project spec** (shaping output): `projects/<project>/spec.md`
- **Project plan**: `projects/<project>/plans/plan.md`
- **Task/feature specs**: `projects/<project>/specs/<task>.spec.md`
- **Task/feature plans**: `projects/<project>/plans/<task>.plan.md`
- **Reference material / assets**: `projects/<project>/**`

### Workflow

- Shape new work as **spec → plan → implement** (see `.agents/rules/drive-project-workflow.mdc`).
- Open an initial PR containing the project spec. Later task PRs should reference the project spec.
- Finalize ADRs / long-lived docs into `docs/`, verify acceptance criteria, then delete `projects/<project>/`.

