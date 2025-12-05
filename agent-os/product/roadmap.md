# Product Roadmap

1. [ ] Enhanced Type Safety for Nested Relations — Improve type inference for deeply nested includes and relation filtering to provide full type safety when traversing complex data models with multiple join levels. `M`

2. [ ] Raw SQL with Type Preservation — Allow developers to write raw SQL queries while maintaining type safety through contract validation, ensuring raw queries reference valid tables/columns and return properly typed results. `S`

3. [ ] Query Budget Enforcement — Implement configurable query budgets that limit execution time, result set size, and memory usage with environment-specific thresholds (lenient in dev, strict in production). `M`

4. [ ] Migration Edge Validation — Add comprehensive precondition and postcondition checks for migration edges including data preservation verification, index recreation validation, and constraint enforcement testing. `L`

5. [ ] Preflight Migration Reporting — Enhance PPg preflight simulation to generate detailed migration impact reports including affected rows, estimated downtime, and rollback procedures. `M`

6. [ ] Extension Pack Developer Kit — Create tooling and documentation for third-party extension pack development including codec registration helpers, operation definition templates, and testing utilities. `L`

7. [ ] Multi-Database Transaction Support — Implement distributed transaction coordination across multiple database connections with two-phase commit and automatic rollback on failure. `XL`

8. [ ] Query Plan Caching — Add intelligent caching layer for compiled query plans with cache invalidation on contract changes, reducing compilation overhead for frequently executed queries. `M`

9. [ ] Real-Time Contract Diff Visualization — Build interactive tooling that visualizes contract changes between versions with impact analysis showing affected queries and migration complexity. `M`

10. [ ] Streaming Result Sets — Enhance adapter layer to support true database cursor streaming for large result sets with backpressure handling and memory-efficient iteration. `L`

11. [ ] Policy Pack Marketplace — Develop ecosystem for shareable policy packs with common lint rules, query budgets, and guardrails that teams can install and customize. `L`

12. [ ] MySQL and SQLite Adapter Support — Extend adapter framework to support MySQL and SQLite targets with full feature parity including capability discovery and dialect-specific optimizations. `XL`

13. [ ] Schema Inference from Existing Databases — Build introspection tooling that generates PSL schemas from existing database structures with support for reverse-engineering complex schemas including views and materialized tables. `L`

14. [ ] ORM Layer Feature Parity — Extend ORM builder to support advanced Prisma ORM features including relation filters, nested writes, composite types, and implicit many-to-many relations. `XL`

15. [ ] Contract Versioning and Migration Paths — Implement semantic versioning for contracts with automated migration path generation between versions and backward compatibility detection. `L`

16. [ ] Observable Query Telemetry — Add OpenTelemetry integration for distributed tracing with query span instrumentation including plan metadata, execution metrics, and error correlation. `M`

17. [ ] CLI Interactive Migration Wizard — Create interactive CLI experience for migration authoring with guided schema changes, automatic edge generation, and built-in validation checks. `M`

18. [ ] Vector Search Extension Pack — Complete pgvector extension pack with full support for vector similarity operations, embedding storage, and optimized index strategies. `L`

19. [ ] Database Health Monitoring — Implement continuous contract verification daemon that monitors deployed databases for drift detection, capability mismatches, and marker inconsistencies. `M`

20. [ ] GraphQL to Prisma Next Bridge — Build compatibility layer that translates GraphQL queries to Prisma Next query plans enabling GraphQL APIs to leverage contract verification and guardrails. `XL`

> Notes
> - Order items by technical dependencies and product architecture
> - Each item should represent an end-to-end (frontend + backend) functional and testable feature
