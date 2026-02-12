# Code Review Process (Spec-Driven)

You are performing a thorough code review of the work associated with a feature spec and writing your evaluation to a file on disk.

This command uses a dedicated **code-reviewer** subagent whose specialty is evaluating code quality, architecture, conventions, and test hygiene.

NOTE: YOU DO NOT MAKE CHANGES TO THE IMPLEMENTATION, YOU WRITE YOUR REVIEW. IF THE USER OPENS DISCUSSION WITH YOU, YOU MAY UPDATE YOUR REVIEW.

## PHASE 1: Get the spec to review against

You need the spec folder (preferred) OR at minimum a `spec.md` file.

If you do not have a spec folder path or `spec.md` path in the conversation context, ask the user and WAIT:

```
Please point me to the spec you want code-reviewed.

Preferred: `agent-os/specs/<spec>/` (the folder)
Also acceptable: `agent-os/specs/<spec>/spec.md`
```

Once you have it, read:
- `agent-os/specs/[this-spec]/spec.md`
- `agent-os/specs/[this-spec]/planning/requirements.md` (if present)
- `agent-os/specs/[this-spec]/tasks.md` (if present)

## PHASE 2: Determine the “work” to review (git scope)

You must establish a concrete diff/commit scope for the review.

### Step 2.1: If you are on a topic branch, compare it to the default branch

1. Determine the current branch name.
2. Fetch latest refs from origin (so comparisons are accurate).
3. Determine the default branch (`origin/HEAD`), typically `main` (or sometimes `master`).
4. Establish the history of the topic branch. Be aware that main may have _newer_ commits than the topic branch, don't review those - they're not part of the topic branch.

If the current branch is NOT the default branch:
- Treat it as a topic branch
- Review the range `origin/[default]...HEAD`

Capture review inputs:
- Commit list in the range
- File list changed in the range
- The actual diff for the range

### Step 2.2: Otherwise, infer review scope from git history

If the current branch IS the default branch:
- Infer which commits/files constitute “the work for this spec” using git history.
- Use the spec folder name, spec title, and key terms to search commit messages.
- Use file paths mentioned in the spec (and/or tasks) to find related commits.
- Assemble a best-effort set of commits and file diffs that represent this work.

Be explicit in the review about any uncertainty in scope.

## PHASE 3: Delegate to the code-reviewer subagent

Delegate to the **code-reviewer** subagent.

Provide the subagent:
- The spec folder path: `agent-os/specs/[this-spec]/`
- The spec/planning/tasks docs (paths above)
- The review scope you determined:
  - If on a topic branch: base branch name and the full range `origin/[default]...HEAD`
  - Otherwise: the inferred list of commits (hashes) and/or files, plus their diffs/patches

Instruct the subagent to:
- Perform a thorough code review focused on:
  - Architectural alignment with the existing codebase
  - Correctness, maintainability, and clarity
  - Conventions of the Swift/macOS ecosystem and this repo
  - SRP/SOLID principles, pragmatic TDD/test hygiene, and CI readiness
  - Spec adherence (requirements traceability)
- Create the report directory if needed: `agent-os/specs/[this-spec]/reviews/`
- Write the review report to: `agent-os/specs/[this-spec]/reviews/code-review.md`

## PHASE 4: Inform the user

After the subagent writes the report, output:

```
Code review complete!

✅ Report: `agent-os/specs/[this-spec]/reviews/code-review.md`
```

