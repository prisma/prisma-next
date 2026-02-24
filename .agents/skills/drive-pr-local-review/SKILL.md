---
name: drive-pr-local-review
description: Performs comprehensive code review by analyzing git diffs between the current branch and the default branch (or a specified target). Use when the user requests a code review, diff analysis, PR review, or wants feedback on their changes before submitting. Evaluates code for idiomaticity, best practices, clarity, performance, security, edge cases, and documentation.
metadata:
  version: "2026.2.23"
---

# Code Review Agent

Analyzes git diffs to provide thorough, actionable code review feedback. Reviews changes against the default branch (typically `origin/main`) unless a specific target is specified.

## Workflow

1. **Identify target branch**: Use `git remote show origin | grep 'HEAD branch'` to find the default branch, or use the user-specified target
2. **Get the diff**: `git diff origin/<target-branch>...HEAD` for changes, `git diff --stat origin/<target-branch>...HEAD` for overview (use remote ref to avoid stale local copies)
3. **Read changed files in full** when context is needed beyond the diff
4. **Analyze against review criteria** (see below)
5. **Generate structured review** with findings organized by severity and category

## Review Criteria

Evaluate each change against these criteria:

### 1. Idiomaticity

- Does the code follow language conventions and idioms?
- Are language-specific features used appropriately?
- Does naming follow community standards (e.g., `snake_case` vs `camelCase`)?

### 2. Best Practices & Patterns

- Are established patterns for the language/framework followed?
- Is error handling appropriate and consistent?
- Are dependencies used correctly?
- Does the code follow project-specific conventions (check for CODING_GUIDELINES.md, AGENTS.md, or similar)?

### 3. Clarity & Conciseness

- Is the code easy to read and understand?
- Are variable/function names descriptive and accurate?
- Is there unnecessary complexity or over-engineering?
- Could any logic be simplified?

### 4. Comments & Intent

- Do comments explain _why_, not _what_?
- Are complex algorithms or non-obvious decisions documented?
- Are there misleading or outdated comments?
- Is the code self-documenting where possible?

### 5. Performance

- Are there obvious performance issues (N+1 queries, unnecessary allocations, blocking calls)?
- Is the approach appropriate for the expected scale?
- Are there opportunities for caching or batching?

### 6. Security

- Is user input validated and sanitized?
- Are secrets handled securely (not logged, not hardcoded)?
- Are there injection vulnerabilities (SQL, command, etc.)?
- Is authentication/authorization properly enforced?
- Are cryptographic operations done correctly?

### 7. Edge Cases

- Are boundary conditions handled (empty, null, max values)?
- Is error handling comprehensive?
- Are concurrent access scenarios considered?
- Are failure modes documented or handled gracefully?

### 8. Documentation

- Are public APIs documented?
- Is README or other documentation updated if behavior changes?
- Are breaking changes noted?
- Do new features have usage examples if appropriate?

## Output Structure

```markdown
# Code Review: [brief description of changes]

## Summary

[1-2 sentence overview of the changes and overall assessment]

## Critical Issues

[Issues that must be fixed before merging - security vulnerabilities, bugs, data loss risks]

## Recommendations

[Suggested improvements that would significantly improve the code]

## Minor Suggestions

[Style, naming, or small improvements - nice to have but not blocking]

## Positive Notes

[What was done well - reinforces good patterns]
```

### Finding Format

For each finding, provide:

- **Location**: File and line range (repo-relative paths only)
- **Issue**: Clear description of the problem
- **Suggestion**: Concrete fix or improvement
- **Code example** (when helpful): Show the suggested change

Example:

```markdown
### [Category]: [Brief title]

**Location**: `src/handler.go:45-52`

The error from `db.Query()` is logged but not returned, causing silent failures.

**Suggestion**: Return the error to the caller or handle it explicitly:
` ``go
if err != nil {
    return nil, fmt.Errorf("query failed: %w", err)
} ` ``
```

## What Not to Review

**Do NOT review:**

- **Formatting**: Indentation, line breaks, spacing, alignment - these should be handled by the language formatter (e.g., `gofmt`, `prettier`, `black`)

## Guidelines

**Do:**

- Read project conventions (CODING_GUIDELINES.md, AGENTS.md, etc.) before reviewing
- Prioritize findings by impact (security > correctness > performance > style)
- Provide actionable suggestions with concrete examples
- Acknowledge good patterns and improvements
- Consider the context and constraints of the change
- Use repo-relative paths only

**Don't:**

- Nitpick style issues that don't affect readability
- Suggest rewrites when the current approach is acceptable
- Flag issues in unchanged code (unless directly affected by the change)
- Be pedantic about personal preferences
- Use absolute filesystem paths

## Severity Levels

- **Critical**: Must fix - security vulnerabilities, bugs, data corruption risks
- **Recommendation**: Should fix - significant improvements to maintainability, performance, or correctness
- **Minor**: Nice to have - style improvements, minor optimizations, suggestions

## Context Gathering

Before reviewing, check for project-specific guidelines:

```bash
# Find project conventions
find . -maxdepth 2 -name "*.md" -print0 | xargs -0 grep -l -i "guideline\|convention\|style\|coding" 2>/dev/null | head -5
```

Read any relevant guidelines to ensure review aligns with project standards.
