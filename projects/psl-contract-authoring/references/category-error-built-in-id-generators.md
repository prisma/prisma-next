# Category error: “built-in” ID generators in low layers

This note explains why `@prisma-next/ids` (as currently structured) is a category error, and how we plan to fix it without undoing the mutation-default registry work.

## The principle: thin core, fat interfaces (and fat targets/packs)

We want a system where:

- **Low layers** define *strategy shapes*:
  - registry interfaces (what can be contributed)
  - deterministic assembly rules
  - diagnostics contracts
  - validation boundaries
- **High layers** define *strategy implementations*:
  - concrete behaviors that only exist when composed (targets, adapters, extension packs)

This keeps the core small, reusable, and target-agnostic, while allowing rich target-/pack-specific behavior.

## What went wrong

The current `@prisma-next/ids` package lives in a **framework authoring** layer (`packages/1-framework/2-authoring/ids`) but contains:

- a privileged “built-in vocabulary” (`builtinGeneratorIds` / `BuiltinGeneratorId`)
- concrete implementations of generator algorithms via `uniku/*`
- generator-owned metadata (applicability + generated-column typing rules)
- a runtime helper that rejects any non-built-in id (`generateId()`), effectively asserting that only this privileged vocabulary is “real”

Even if other layers “consume” these through composition, the presence of a global built-in list creates an ambient default that other code can (and did) start depending on. This is exactly the failure mode thin-core/fat-targets is meant to prevent.

## Why this is a category error (not just “a smell”)

ID generators are a **composed behavior**:

- They are not required for all applications.
- They are not required for all SQL targets.
- Their semantics and compatibility (codec applicability, storage shape) are **owned by the generator contributor**.

Putting concrete generator implementations and a privileged vocabulary into a low layer turns “composed behavior” into “core behavior”. That makes the core fatter, increases coupling, and creates conflicting sources of truth (PSL vs TS authoring vs runtime).

The mutation-default registry work explicitly pushes in the opposite direction: registries in low layers, implementations in high layers.

## The root cause (why someone likely made this compromise)

The TypeScript authoring surface exists in low layers, and it’s tempting to ship “nice helpers” (e.g. `ids.nanoid({ size })`) that are available everywhere.

But “nice helpers everywhere” is not free: if the helper package also ships concrete implementations and a privileged vocabulary, we’ve smuggled a standard library into the core.

## The fix (what we will change)

We will remove the concept of “built-in” ID generators from low layers and instead provide ID generators as **normal composed contributions**:

- **Control plane**: composed generator descriptors (applicability + generated-column resolution) and default-function lowering handlers.
- **Execution plane**: composed runtime generator implementations (`mutationDefaultGenerators()`).

Acceptable homes for these contributions:

- a reusable SQL-family extension pack under `packages/3-extensions/` (preferred for reuse across SQL targets), and/or
- a specific target/adapter (acceptable, still composition-owned).

### TS authoring helpers

We will not keep concrete implementations in low-layer TS authoring packages just to preserve ergonomic helpers.

Preferred direction:

- TS convenience helpers for ID generators live alongside the composed contributor (pack/adapter), so importing the helper is an explicit opt-in to that vocabulary.

If we keep any “helper” in low layers, it must be restricted to constructing opaque specs with string ids, and must not encode privileged id unions, applicability lists, or generator-owned storage shape tables.

## How we’ll know it’s fixed

- No low-layer package exports a privileged “builtin generator id list” or a `BuiltinGeneratorId` union.
- No low-layer package depends on `uniku/*` (or equivalent concrete generator algorithm implementations).
- ID generators exist only when a target/adapter/pack explicitly contributes them through composition.
- PSL interpretation and runtime mutation defaults both consume composed registries; there is a single source of truth for generator semantics + metadata.

## Where to track the work

Spec: `projects/psl-contract-authoring/specs/follow-up-move-id-generators-to-composition.spec.md`

