# Security policy

## Reporting a vulnerability

**Please report security issues privately. Do not open a public GitHub issue.**

Use GitHub's **[Private vulnerability reporting](https://github.com/prisma/prisma-next/security/advisories/new)** form on this repository to send a confidential report. The form is the preferred channel: it routes the report directly to the maintainers, captures structured detail (affected package, version, reproduction), and allows us to coordinate a fix and disclosure with you in a private thread.

If you cannot use GitHub's form for any reason, you may instead email `security@prisma.io`. Reports filed there will be triaged into the same workflow.

When reporting, please include:

- The affected `@prisma-next/*` package and version (or `prisma-next`).
- A reproduction or proof-of-concept, where possible.
- Your assessment of severity and impact.
- Any disclosure timeline you are working under.

## What to expect from us

- **Acknowledgement within 5 business days.** We commit to replying to your report within five business days from receipt. The acknowledgement may not contain a fix or a full assessment yet — it confirms we have received the report and assigned an owner.
- **Coordinated disclosure.** Once we agree on the impact, we will coordinate a fix, a release plan, and a disclosure timeline with you. We aim to resolve high-severity issues quickly; lower-severity issues may be batched into a regular release.
- **Credit.** With your permission, we will credit you in the release notes / advisory for the fix.

We are still establishing public response-time and patch-time SLOs; the 5-business-day acknowledgement is the only commitment in writing today.

## Scope

In scope — we accept reports against any of the following published packages:

- The umbrella package `prisma-next`.
- All `@prisma-next/*` packages published to npm (currently 58 packages, including all `target-*`, `adapter-*`, `driver-*`, `extension-*`, `mongo-*`, `sql-*`, and the framework / authoring / tooling packages).

Out of scope (please do not file vulnerability reports for these):

- Pre-release / experimental code under `examples/**` and `test/**` workspaces. These are not published and are not intended for production use.
- Bugs in transitive dependencies that do not impact our published surface — please report those upstream.
- Vulnerabilities that require an attacker to already have shell access on the developer's or operator's machine.
- Issues only affecting the documentation or marketing site.

## Supported versions

Prisma Next is **pre-1.0**. While we are pre-1.0:

- **Only the latest minor version receives security fixes.** Older minor versions (e.g. `0.3.x` once `0.4.0` is released) are not supported and will not receive backports. If you are on an older minor and report an issue, the fix will land on the latest minor and you will need to upgrade to receive it.
- We reserve the right to introduce breaking changes between minor versions while addressing a security issue, if the simpler fix requires it.

When Prisma Next reaches 1.0 this section will be revised; the supported-versions story will be more conservative.

## What this document does *not* commit to

- A fixed time-to-patch SLO. We have not committed to one publicly because we cannot guarantee one yet. The 5-business-day acknowledgement is the only firm commitment.
- A pre-issued PGP key. If you need encrypted communication beyond GitHub's transport, request a key in your initial report and we will reply with one.
- Compensation, bug bounty, or hall-of-fame programs. None are offered at this time.

## Public advisories

When a fix lands, the corresponding advisory will be published via [GitHub Security Advisories](https://github.com/prisma/prisma-next/security/advisories) and may be assigned a CVE.
