# GitHub Actions CI/CD Standards

## Overview

Prisma uses GitHub Actions for continuous integration and deployment. This document outlines standards for creating reliable, efficient, and secure workflows.

## Workflow Organization

### File Structure
Organize workflows in `.github/workflows/` directory.

**Recommended structure:**
```
.github/
├── workflows/
│   ├── ci.yml              # Main CI pipeline
│   ├── deploy-production.yml
│   ├── deploy-staging.yml
│   ├── security-scan.yml
│   └── release.yml
└── actions/
    └── setup-project/      # Reusable composite actions
        └── action.yml
```

### Workflow Naming
Use clear, descriptive names for workflows.

**Example:**
```yaml
# ✅ Clear workflow name
name: CI - Test and Lint

# ❌ Vague name
name: Tests
```

## CI Workflow Best Practices

### Basic CI Template
Standard CI workflow structure for Prisma projects.

**Example:**
```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

# Cancel in-progress runs for the same PR
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node-version: [18, 20]

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run type check
        run: npm run typecheck

      - name: Run tests
        run: npm test

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: true
```

### Fast CI Execution
Optimize workflows for speed.

**Guidelines:**
- Use `npm ci` instead of `npm install`
- Cache dependencies (automatic with `setup-node` cache option)
- Run jobs in parallel when possible
- Use matrix strategy for multiple versions
- Skip unnecessary steps with conditionals
- Use `concurrency` to cancel outdated runs

**Example - Parallel jobs:**
```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm test
```

### Conditional Execution
Run steps only when needed.

**Example:**
```yaml
steps:
  - name: Run integration tests
    # Only run on main branch
    if: github.ref == 'refs/heads/main'
    run: npm run test:integration

  - name: Deploy to staging
    # Only on push to develop branch
    if: github.event_name == 'push' && github.ref == 'refs/heads/develop'
    run: npm run deploy:staging

  - name: Comment on PR
    # Only on pull requests
    if: github.event_name == 'pull_request'
    uses: actions/github-script@v7
    with:
      script: |
        github.rest.issues.createComment({
          issue_number: context.issue.number,
          owner: context.repo.owner,
          repo: context.repo.repo,
          body: 'Tests passed! ✅'
        })
```

## Deployment Workflows

### Production Deployment
Deploy to production with safety checks.

**Example:**
```yaml
name: Deploy to Production

on:
  push:
    tags:
      - 'v*.*.*'  # Trigger on version tags

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://example.com

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build
        env:
          NODE_ENV: production

      - name: Deploy to Cloudflare
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy --env production

      - name: Notify deployment
        if: success()
        run: echo "Deployment successful!"

      - name: Rollback on failure
        if: failure()
        run: |
          echo "Deployment failed, consider rollback"
          # Add rollback logic here
```

### Staging Deployment
Automatic staging deployments from develop branch.

**Example:**
```yaml
name: Deploy to Staging

on:
  push:
    branches:
      - develop

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://staging.example.com

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install and build
        run: |
          npm ci
          npm run build

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: my-project
          directory: dist
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

## Security Best Practices

### Secrets Management
Handle secrets securely in workflows.

**Guidelines:**
- Store sensitive data in GitHub Secrets
- Never log secrets or expose them in outputs
- Use environment-specific secrets
- Rotate secrets regularly
- Use least privilege for tokens

**Example:**
```yaml
steps:
  - name: Deploy
    env:
      # ✅ Use secrets from GitHub
      API_TOKEN: ${{ secrets.API_TOKEN }}
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
    run: npm run deploy

  # ❌ Never do this
  - name: Debug
    run: echo "Token is ${{ secrets.API_TOKEN }}"  # Exposed in logs!
```

### Permissions
Use minimal permissions for workflows.

**Example:**
```yaml
name: CI

on: [push, pull_request]

# Minimal permissions
permissions:
  contents: read
  pull-requests: write  # Only if commenting on PRs

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # ...
```

### Dependency Pinning
Pin action versions for security and reproducibility.

**Example:**
```yaml
steps:
  # ✅ Pin to specific SHA (most secure)
  - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1

  # ✅ Pin to major version (easier to maintain)
  - uses: actions/checkout@v4

  # ❌ Don't use latest or main
  - uses: actions/checkout@main
```

### Security Scanning
Include security checks in CI.

**Example:**
```yaml
name: Security Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * 0'  # Weekly on Sunday

jobs:
  security:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Run npm audit
        run: npm audit --audit-level=moderate

      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

      - name: SAST scan with CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: typescript

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
```

## Integration with CodeRabbit

### Automatic Code Review
Configure CodeRabbit for automated reviews.

**Example `.coderabbit.yml`:**
```yaml
# CodeRabbit configuration
reviews:
  auto_review:
    enabled: true
    draft_mode: false

  profile: assertive

  request_changes_workflow: true

  high_level_summary: true

  poem: false

  review_status: true

  auto_review_conditions:
    - label: "auto-review"

  path_filters:
    - "!**/*.md"
    - "!**/package-lock.json"

  path_instructions:
    - path: "**/*.ts"
      instructions: |
        - Check for security vulnerabilities
        - Verify type safety
        - Ensure adequate test coverage
        - Check for proper error handling

    - path: "**/*.test.ts"
      instructions: |
        - Verify test describes behavior not implementation
        - Check for edge cases
        - Ensure no flaky tests
```

## Reusable Workflows

### Composite Actions
Create reusable actions for common tasks.

**Example `.github/actions/setup-project/action.yml`:**
```yaml
name: Setup Project
description: Setup Node.js and install dependencies

inputs:
  node-version:
    description: Node.js version to use
    required: false
    default: '20'

runs:
  using: composite
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
        cache: 'npm'

    - name: Install dependencies
      shell: bash
      run: npm ci

    - name: Verify installation
      shell: bash
      run: npm list --depth=0
```

**Usage:**
```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-project
        with:
          node-version: 20
      - run: npm test
```

### Reusable Workflows
Share entire workflows across repositories.

**Example `.github/workflows/reusable-ci.yml`:**
```yaml
name: Reusable CI Workflow

on:
  workflow_call:
    inputs:
      node-version:
        required: false
        type: string
        default: '20'

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ inputs.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
```

**Usage in another workflow:**
```yaml
name: CI

on: [push, pull_request]

jobs:
  ci:
    uses: ./.github/workflows/reusable-ci.yml
    with:
      node-version: '20'
```

## Monitoring and Notifications

### Status Checks
Require workflows to pass before merging.

**Repository settings:**
- Go to Settings → Branches → Branch protection rules
- Add rule for `main` branch
- Require status checks to pass:
  - CI
  - Security Scan
  - CodeRabbit

### Notifications
Notify team of workflow failures.

**Example:**
```yaml
jobs:
  notify-on-failure:
    runs-on: ubuntu-latest
    if: failure()
    needs: [test, deploy]
    steps:
      - name: Send Slack notification
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "❌ Deployment failed in ${{ github.repository }}",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "Workflow failed: ${{ github.workflow }}\nBranch: ${{ github.ref }}\n<${{ github.event.head_commit.url }}|View commit>"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

## Performance Optimization

### Caching Strategy
Cache dependencies and build outputs.

**Example:**
```yaml
steps:
  - uses: actions/checkout@v4

  # Cache node_modules
  - uses: actions/setup-node@v4
    with:
      node-version: 20
      cache: 'npm'

  # Cache build output
  - name: Cache build
    uses: actions/cache@v4
    with:
      path: |
        .next/cache
        dist
      key: ${{ runner.os }}-build-${{ hashFiles('**/package-lock.json') }}-${{ hashFiles('**/*.ts', '**/*.tsx') }}
      restore-keys: |
        ${{ runner.os }}-build-${{ hashFiles('**/package-lock.json') }}-
        ${{ runner.os }}-build-

  - run: npm ci
  - run: npm run build
```

### Self-Hosted Runners
Use self-hosted runners for heavy workloads (optional).

**When to use:**
- Large test suites
- Resource-intensive builds
- Need for specific hardware/software
- Cost optimization for high usage

**Example:**
```yaml
jobs:
  test:
    runs-on: [self-hosted, linux, x64]
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
```

## Testing Workflows

### Local Testing with act
Test workflows locally before pushing.

**Installation:**
```bash
# macOS
brew install act

# Or with npm
npm install -g act
```

**Usage:**
```bash
# Run default workflow
act

# Run specific workflow
act -W .github/workflows/ci.yml

# Run specific job
act -j test

# Dry run
act -n
```

## Common Patterns

### Matrix Builds
Test across multiple environments.

**Example:**
```yaml
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18, 20]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
```

### Dependent Jobs
Run jobs in sequence with dependencies.

**Example:**
```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm run build

  test:
    needs: build  # Wait for build
    runs-on: ubuntu-latest
    steps:
      - run: npm test

  deploy:
    needs: [build, test]  # Wait for both
    runs-on: ubuntu-latest
    steps:
      - run: npm run deploy
```

## Documentation

### Workflow Documentation
Document complex workflows in README or comments.

**Example:**
```yaml
# This workflow deploys to production when:
# 1. A new version tag is pushed (v*.*.*)
# 2. All tests pass
# 3. Manual approval is given (via GitHub Environments)
#
# Deployment steps:
# 1. Build application
# 2. Run smoke tests
# 3. Deploy to Cloudflare Workers
# 4. Run post-deployment health checks
#
# Rollback: If deployment fails, revert to previous version
# using: git revert <commit> && git push

name: Deploy to Production
# ...
```

## Resources

- **GitHub Actions Docs**: https://docs.github.com/en/actions
- **Workflow Syntax**: https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions
- **Security Hardening**: https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions
