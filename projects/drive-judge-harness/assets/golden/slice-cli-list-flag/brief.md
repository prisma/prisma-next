# Brief — add a `--json` flag to the migration-list command

The CLI's migration-list command prints a human-readable rendering of the migration graph (a styled table / graph view). Tooling and CI scripts want to consume the same data programmatically, but today they'd have to scrape the formatted text.

Add a `--json` flag to the migration-list command that emits the underlying migration-list data as structured JSON to stdout instead of the styled rendering. Requirements:

- `--json` produces machine-readable JSON of the same migration-list data the human view is built from (one stable shape; document the fields).
- Without `--json`, behaviour is unchanged (the styled rendering is still the default).
- The two paths share the same data source — the JSON is not a second, divergent computation of the migration list.
- Errors (e.g. no migrations directory) are reported consistently in both modes.

This is a single, self-contained addition to one command. Treat it as one slice (spec + plan + build), one PR.
