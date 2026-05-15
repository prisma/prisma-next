# Project references

This directory holds reference material for the agent-skill project. Two kinds of content:

- **[`workflows-catalog.md`](./workflows-catalog.md)** — the canonical list of Prisma Next user workflows the skill cluster codifies, grouped by skill. Audience: devrel writing user-facing documentation. Each skill's capability-gap block doubles as the *"known limitations"* source for the corresponding doc section.
- **Competitive survey clones (below)** — local clones of well-established `SKILL.md` repos kept on disk for pattern study, plus a written competitive survey of other ORMs' agent-facing surfaces under [`competitive-survey/`](./competitive-survey/).

---

## Reference skills — patterns to learn from

Local clones of well-established `SKILL.md` repos, kept on disk for pattern study so we don't redesign Prisma Next's agent skill from first principles. The clones themselves are gitignored (see `.gitignore`); refresh them with `git -C <repo> pull` whenever you want a newer snapshot.

To (re-)create the clones from a fresh checkout:

```bash
cd projects/prisma-next-agent-skill/references
git clone --depth 1 https://github.com/supabase/agent-skills.git supabase-agent-skills
git clone --depth 1 https://github.com/vercel-labs/agent-skills.git vercel-agent-skills
git clone --depth 1 https://github.com/vercel-labs/next-skills.git vercel-next-skills
git clone --depth 1 https://github.com/get-convex/agent-skills.git convex-agent-skills
git clone --depth 1 https://github.com/TanStack/router.git tanstack-router
```

## Supabase — `supabase/agent-skills`

The canonical partner-owned skill repo. Closest organisational analogue to what we'd ship at `prisma/agent-skills`: a Supabase-team-owned monorepo with multiple skills, distributed via both `npx skills add` and `claude plugin install`, with a `.well-known/agent-skills/` endpoint at `supabase.com` for first-party serving.

- Repo README: [`supabase-agent-skills/README.md`](supabase-agent-skills/README.md)
- Broad product skill (fires on Database, Auth, Edge Functions, Realtime, Storage, Vectors, Cron, Queues; client libraries; CLI; MCP server): [`supabase-agent-skills/skills/supabase/SKILL.md`](supabase-agent-skills/skills/supabase/SKILL.md)
- Narrow companion (Postgres performance / optimisation): [`supabase-agent-skills/skills/supabase-postgres-best-practices/SKILL.md`](supabase-agent-skills/skills/supabase-postgres-best-practices/SKILL.md)

Source: <https://github.com/supabase/agent-skills>

## Vercel — `vercel-labs/agent-skills` and `vercel-labs/next-skills`

Vercel's own skills, authored by their engineering team. The directional-authority reference for skills.sh format — Vercel runs skills.sh and these are their public examples.

### `vercel-labs/agent-skills`

- Repo README: [`vercel-agent-skills/README.md`](vercel-agent-skills/README.md)
- React performance / optimisation (heavily-priority-categorised content `CRITICAL → LOW`, prefixed rule families `async-`, `bundle-`, `server-`, `client-`): [`vercel-agent-skills/skills/react-best-practices/SKILL.md`](vercel-agent-skills/skills/react-best-practices/SKILL.md)
- Other skills present in the clone: `composition-patterns`, `deploy-to-vercel`, `react-native-skills`, `react-view-transitions`, `vercel-cli-with-tokens`, `web-design-guidelines`.

Source: <https://github.com/vercel-labs/agent-skills>

### `vercel-labs/next-skills`

- Repo README: [`vercel-next-skills/README.md`](vercel-next-skills/README.md)
- Next.js patterns. Background-skill (auto-applied, not user-invocable) covering file conventions, RSC boundaries, async API patterns, data patterns, error handling, route handlers, metadata, image / font optimisation, bundling: [`vercel-next-skills/skills/next-best-practices/SKILL.md`](vercel-next-skills/skills/next-best-practices/SKILL.md)
- Other skills present in the clone: `next-cache-components`, `next-upgrade`.

Source: <https://github.com/vercel-labs/next-skills>

## Convex — `get-convex/agent-skills`

The strongest direct analogue to Prisma Next: a backend-with-types product (database + functions + auth) maintained by the company that ships it. Multiple skills covering setup, auth, migrations, components, performance. Their skill philosophy is explicit: *"skills should be laser-focused on specific tasks and help agents take concrete action, rather than serving as generic reference material."*

- Repo README: [`convex-agent-skills/README.md`](convex-agent-skills/README.md)
- "Set up a new Convex project from scratch" — closest analogue to a Layer 1 onboarding skill: [`convex-agent-skills/skills/convex-quickstart/SKILL.md`](convex-agent-skills/skills/convex-quickstart/SKILL.md)
- "Plan and run data migrations" — closest analogue to a Layer 2 daily-workflow migration skill: [`convex-agent-skills/skills/convex-migration-helper/SKILL.md`](convex-agent-skills/skills/convex-migration-helper/SKILL.md)
- Other skills present in the clone: `convex` (broad), `convex-create-component`, `convex-performance-audit`, `convex-setup-auth`.

Source: <https://github.com/get-convex/agent-skills>

## TanStack — `TanStack/router` (`@tanstack/intent` distribution)

A *structurally different* distribution model from the other three. TanStack ships SKILL.md files *inside the npm package* (`packages/<pkg>/skills/<skill>/SKILL.md`), discovered by the `tanstack-intent` keyword and installed by `npx @tanstack/intent install`. 28 SKILL.md files across 11 packages as of [TanStack/router#6866](https://github.com/TanStack/router/pull/6866). The model is appealing because skills stay version-aligned with the package via `npm update`. Worth comparing as an alternative to the centralised `prisma/agent-skills` repo model.

- Top-level skill for `@tanstack/router-core` (note the nested sub-skill structure beneath it): [`tanstack-router/packages/router-core/skills/router-core/SKILL.md`](tanstack-router/packages/router-core/skills/router-core/SKILL.md)
- Narrow sub-skill on data loading — closest analogue to a PN query-authoring sub-skill: [`tanstack-router/packages/router-core/skills/router-core/data-loading/SKILL.md`](tanstack-router/packages/router-core/skills/router-core/data-loading/SKILL.md)
- Top-level skill for `@tanstack/start-core` (server-side bindings): [`tanstack-router/packages/start-client-core/skills/start-core/SKILL.md`](tanstack-router/packages/start-client-core/skills/start-core/SKILL.md)
- To find every shipped skill in the clone: `find tanstack-router/packages -path '*/skills/*/SKILL.md'`.

Source: <https://github.com/TanStack/router>

## What to compare across these

When reading, pay attention to:

- **The `description` field.** Trigger-firing surface. Compare Supabase's keyword-dense list against TanStack's narrower wording against Vercel's task-context phrasing.
- **Skill scope** — broad-everything-product (Supabase) vs. narrow-best-practices (Vercel React) vs. narrow-task (Convex migration helper).
- **Structure of the SKILL.md body** — core principles up top vs. table-of-contents vs. priority-categorised rules vs. step-by-step recipes.
- **Whether the skill teaches *reasoning* or just lists *facts*.** Convex's stated philosophy is concrete-action-oriented; Supabase mixes principles with reference; Vercel React is heavily rule-prefixed.
- **How agent-correcting content (rules, "never do X") is woven through.** Most of these skills have hard prescriptions; the placement and prominence varies.
- **Multi-skill repo organisation.** Supabase, Vercel-react, Vercel-next, and Convex all ship multiple skills per repo. Compare how they relate (broad + narrow vs. peer + peer), and how the READMEs surface that organisation.
