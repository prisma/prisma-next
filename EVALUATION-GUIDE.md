# Prisma Next Prototype – Evaluation Guide

This guide helps you evaluate the Prisma Next prototype from different perspectives. Whether you're a technical evaluator, business stakeholder, or newcomer to the space, this guide provides structured steps and criteria for assessment.

## What Is This?

Prisma Next is a prototype of a **contract-first data layer** that rethinks what an ORM should be in an age of automation and agentic development.
Instead of generating a heavy runtime client that hides the database behind bespoke methods, Prisma Next turns your schema into a **verifiable, machine-readable data contract**—a single source of truth from which both humans and AI systems can safely reason about data.

At build time, Prisma Next produces:

- A **contract JSON (IR)** — an exact, deterministic representation of your schema (tables, columns, relations, constraints)
- A **TypeScript declaration file** — exposing your database shape to the language type system

From that point, everything—querying, verification, migrations, and extensions—works from these artifacts, not from a generated client. The result is **less code, more transparency, and a foundation ready for human and AI developers alike**.

---

## Why This Matters

### 1. **IR + Types Replace the ORM as the Source of Truth**

In Prisma ORM, the schema drives a code generator that produces thousands of lines of opaque runtime code (`prisma.user.findMany()` etc.).
This "client as API" model means your data layer lives *inside generated code*—hard for humans to inspect and impossible for machines to reason about without special knowledge.

Prisma Next instead emits:
- A small, **deterministic JSON IR** describing the schema's structure and semantics.
- A minimal set of **TypeScript types** that expose that structure directly to your code editor, compiler, and agents.

This separation eliminates the hidden layer: the IR is the database contract, and the DSL compiles directly from it.
There's no runtime client to keep in sync, no regeneration friction, and no opaque methods to learn.

---

### 2. **Machine-Readable by Design (Agent-Accessible)**

Because the IR is structured JSON—not handwritten or compiled JS—it's **natively consumable by AI systems** and other automation tools.
Agents can:
- Parse the contract, understand table relationships, and generate correct queries.
- Validate queries or migrations deterministically by comparing contract hashes.
- Operate safely: the IR tells them exactly what exists, with zero guesswork.

In short: Prisma Next's artifacts are **first-class machine interfaces**, not just byproducts of human workflows.

---

### 3. **Composable DSL Instead of Generated Client**

The query builder is no longer pre-generated code. It's a **generic DSL** that reads the contract and constructs validated queries at runtime.
Developers and agents alike can express intent declaratively (`sql.from(t.user)...`) and get immediate type-safe feedback—no need for a separate compile step or regeneration.

This makes the system:
- **Composable:** queries, guards, and plugins interoperate through AST transformations.
- **Transparent:** every query resolves to a visible SQL plan (no hidden optimizations).
- **Verifiable:** each plan carries its contract hash, allowing safe runtime checks.

---

### 4. **Future-Oriented Architecture**

By grounding the system in a machine-verifiable contract and a composable DSL, Prisma Next opens paths impossible with legacy ORMs:
- Automated code-generation and refactoring by AI agents.
- Multi-target extensibility (e.g., SQL and Mongo families sharing the same core contract model).
- Deterministic, reversible migrations signed by contract hashes.
- Rule-based guardrails, performance budgets, and drift detection—all verifiable without inspecting source code.

Where traditional ORMs embed the database model into compiled code, Prisma Next externalizes it as a **first-class artifact** that humans and agents can read, reason about, and verify independently.

---

## Side-by-Side Comparison

| Feature | Prisma ORM | **Prisma Next** | Why It Matters |
|----------|-------------|----------------|----------------|
| **Schema Model** | Codegen for runtime client | **Contract IR + TypeScript types** | Separation of concerns; verifiable, inspectable schema |
| **Code Generation** | Heavy, runtime-bound | **Minimal, build-time only** | No rebuilds when schema changes; faster iterations |
| **Query Interface** | Generated methods | **Composable DSL** | Transparent, flexible, agent-friendly syntax |
| **Machine Readability** | Opaque client code | **Structured IR JSON** | AI agents and tools can reason about schema safely |
| **Verification** | None | **Contract hash + runtime checks** | Detects drift, enforces consistency |
| **Extensibility** | Monolithic client | **Plugin and hook system** | Add guardrails, budgets, or custom verifiers easily |
| **Migration Logic** | Sequential scripts | **Contract-based, deterministic** | Safer, reproducible state transitions |
| **Agent Compatibility** | Poor (black box) | **Excellent (contract + DSL)** | Fits directly into agentic development workflows |

---

### The Core Shift in a Sentence

> **Prisma ORM generates a client; Prisma Next generates a contract.**
> That shift—from hidden code to open, verifiable structure—makes Prisma Next inherently more composable, agent-accessible, and future-proof.

---

## Workflow Comparison

**Prisma ORM Workflow:**
1. Write `schema.prisma`
2. Run `prisma generate` → generates heavy client code
3. Write application code using generated methods: `prisma.user.findMany()`

**Prisma Next Workflow:**
1. Write `schema.psl`
2. Run `prisma-next generate` → generates lightweight types + contract
3. Write application code using composable DSL: `sql().from(t.user).select(...)`

**Key Difference:** Prisma Next generates types and contracts, but no runtime client methods. You build queries using a composable DSL instead of calling generated functions.

## How to Evaluate This Prototype

### 🚀 Quick 5-Minute Demo

```bash
# 1. Clone and install
git clone <repo>
cd prisma-next
pnpm install && pnpm build

# 2. Start database (or however you start a local postgres DB)
docker run --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15

# 3. Run the complete demo
cd examples/todo-app
pnpm demo  # This does everything: generate, migrate, test
```

**What you'll see**: Type-safe queries, contract verification, and a working migration system in action.

### 📋 Evaluation Guide

#### For Technical Evaluators

**1. Try the Working Example**
- Run the `todo-app` example to see the full workflow
- Examine `examples/todo-app/src/` to understand the query patterns
- Check `examples/todo-app/schema.psl` to see the schema definition

**2. Test the Migration System**
```bash
cd examples/todo-app
pnpm reset-db    # Reset to empty state
pnpm migrate      # Apply migrations
pnpm migrate      # Verify idempotency (should skip)
```

**3. Examine the Architecture**
- Look at `packages/` structure to understand modularity
- Check `packages/sql/src/` for the query DSL implementation
- Review `packages/runtime/src/` for the execution engine

**4. Run the Test Suite**
```bash
pnpm test        # Unit tests
pnpm test:integration  # Full database integration tests
```

#### Key Questions to Answer

**Architecture & Design**
- ✅ Does this solve real problems with current ORMs?
- ✅ Is the contract-first approach compelling?
- ✅ Are the composable primitives well-designed?
- ✅ Is the modular package structure clean?

**Developer Experience**
- ✅ Is the query DSL intuitive and type-safe?
- ✅ Does the migration system work reliably?
- ✅ Is the setup process straightforward?
- ✅ Are error messages helpful and actionable?

**Production Readiness**
- ✅ Would this work in production environments?
- ✅ Are the safety guarantees sufficient?
- ✅ Is the performance acceptable?
- ✅ Are there any missing critical features?

**Comparison with Existing Solutions**
- ✅ How does this compare to Prisma ORM?
- ✅ How does this compare to other query builders?
- ✅ What are the trade-offs vs traditional ORMs?
- ✅ What's the migration path from existing tools?

#### What's Working Right Now

**✅ Complete Core System**
- PSL parsing and contract generation
- ❌ Type-safe query DSL with full type inference
    - ORM inferred result types are broken, sorry 🤷🏻‍♂️
- Runtime query compilation and execution
- Contract hash verification and drift detection

**✅ Migration System MVP**
- Deterministic migration planning (additive changes)
- Safe migration application with advisory locks
- Contract-based applicability checking
- Complete migration program artifacts

**✅ Plugin Architecture**
- Runtime hooks for verification, linting, budgets
- Composable plugin system
- Zero-overhead when no plugins registered

**✅ Developer Experience**
- Minimal code generation (only types + contract JSON)
- Inline TypeScript queries
- Automatic type inference
- Clear error messages

#### What's Not Yet Implemented

**🚧 Advanced Migration Features**
- Renames and drops (planned with PSL hints)
- Complex type changes and casting
- Multi-dialect support (MySQL, SQLite)
- Read more in the `migration-project-brief/` dir

**🚧 Advanced ORM Features**
- Automatic relation loading (`include()`)
- Change tracking and Unit of Work
- Advanced pagination strategies

**🚧 Production Features**
- Connection pooling and management
- Query performance monitoring
- Advanced security policies

### 🎯 Success Criteria

**For Technical Evaluation**
- [ ] Can run the demo without issues
- [ ] Understands the contract-first concept
- [ ] Sees value in the composable architecture
- [ ] Considers it viable for production use

**For Business Evaluation**
- [ ] Understands the problem being solved
- [ ] Sees potential for developer productivity gains
- [ ] Recognizes the AI/agent-friendly design
- [ ] Considers the migration path feasible

### 🔧 Troubleshooting

**Common Setup Issues**

**Build Errors**
```bash
# Clean and rebuild
rm -rf node_modules packages/*/node_modules
pnpm install
pnpm build
```

**Migration Issues**
```bash
# Reset everything and start fresh
cd examples/todo-app
pnpm reset-db
pnpm migrate
```

**Type Errors**
```bash
# Regenerate types
pnpm generate
pnpm typecheck
```

**Still Having Issues?**
- Check the [todo-app README](examples/todo-app/README.md) for detailed setup
- Look at the [migration demo](examples/todo-app/MIGRATION-DEMO.md) for step-by-step examples
- Run `pnpm test` to verify everything is working

## Evaluation Checklist

### Technical Assessment

**Core Architecture**
- [ ] Contract-first approach is clear and compelling
- [ ] Modular package structure is well-designed
- [ ] Minimal code generation reduces complexity
- [ ] Type safety is maintained throughout

**Query System**
- [ ] DSL is intuitive and type-safe
- [ ] SQL compilation works correctly
- [ ] Result types are properly inferred
- [ ] Error messages are helpful

**Migration System**
- [ ] Planning is deterministic and reliable
- [ ] Application is safe with proper locking
- [ ] Contract verification works correctly
- [ ] Idempotency is maintained

**Plugin System**
- [ ] Hooks are well-designed and composable
- [ ] Linting rules work as expected
- [ ] Performance impact is minimal
- [ ] Extensibility is clear

### Business Assessment

**Problem Solving**
- [ ] Addresses real pain points with current ORMs
- [ ] Reduces developer friction and rebuild time
- [ ] Enables better AI/agent integration
- [ ] Provides clear migration path

**Market Position**
- [ ] Differentiates from existing solutions
- [ ] Addresses modern development needs
- [ ] Has clear value proposition
- [ ] Shows potential for adoption

**Production Viability**
- [ ] Safety guarantees are sufficient
- [ ] Performance characteristics are acceptable
- [ ] Missing features are not blockers
- [ ] Documentation and examples are adequate

## Next Steps

After completing your evaluation:

1. **Document your findings** using the checklist above
2. **Identify specific concerns** or missing features
3. **Consider the migration path** from your current solution
4. **Provide feedback** on the approach and implementation
5. **Recommend next steps** based on your assessment

## Additional Resources

- [Main README](README.md) - Project overview and technical details
- [Todo App Example](examples/todo-app/README.md) - Detailed usage examples
- [Migration Demo](examples/todo-app/MIGRATION-DEMO.md) - Step-by-step migration workflow
- [Migration Project Brief](migration-project-brief/) - Detailed migration system design

---

**Questions or feedback?** Please share your evaluation findings and any suggestions for improvement!
