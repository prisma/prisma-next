# Plan — Split Monolith into Modules

- Identify utilities, domain logic, facade boundaries
- Extract pure utilities first (no external deps)
- Move domain modules; expose minimal public API
- Create facade to preserve call sites
- Add tests at module seams

