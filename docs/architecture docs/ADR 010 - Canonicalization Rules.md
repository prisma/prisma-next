ADR 010 — Canonicalization rules for contract.json

Status: Accepted
Date: 2025-10-18
Owners: Prisma Next team
Related: ADR 004 core vs profile hash, ADR 005 thin core fat targets, ADR 006 dual authoring modes, ADR 008 dev auto-emit vs CI explicit, ADR 009 deterministic naming, Contract Emitter & Types

Context
	•	contract.json is the canonical artifact consumed by the runtime, planner, preflight, and PPg
	•	Hashing, caching, and CI diffs require byte-identical output across platforms and authoring modes
	•	Non-determinism from key order, whitespace, default materialization, and adapter metadata has previously caused noisy diffs and false cache misses
	•	We need explicit, testable rules for canonicalization

Decision
	•	Define a strict canonical JSON format for contract.json
	•	Apply canonicalization in the emitter after validation and normalization and before hashing
	•	Compute coreHash and profileHash over the canonical bytes
	•	Treat any divergence from these rules as an emitter bug

Canonical JSON profile

This project adopts a pragmatic subset inspired by RFC 8785 with additional domain rules

Encoding
	•	UTF-8 without BOM
	•	Newlines are \n
	•	No trailing newline at EOF
	•	Objects serialized with deterministic key order
	•	Numbers encoded with minimal decimal form, no +, no leading zeros, no trailing .0 unless required, and no scientific notation unless necessary to preserve value
	•	Booleans as true or false and null as null
	•	Strings escaped per JSON spec with \uXXXX for control chars

Whitespace
	•	No insignificant whitespace other than that required by JSON separators
	•	Exactly one : after keys and no space
	•	Keys separated by , with no spaces

Example: {"a":1,"b":[true,"x"]}

Object key ordering
	•	Keys sorted lexicographically by UTF-16 code unit order
	•	Sort applied recursively to all objects
	•	For top-level sections we enforce an explicit order before lexicographic sort to stabilize human diffs
	1.	schemaVersion
	2.	targetFamily
	3.	target
	4.	coreHash
	5.	profileHash
	6.	models
	7.	storage
	8.	capabilities
	9.	codecs
	10.	meta

Within each of these sections, standard lexicographic sort applies, except where domain-specific ordering rules are defined below

Arrays
	•	Arrays are preserved in the order that is semantically meaningful
	•	Where order is not semantically meaningful, arrays are canonically sorted
	•	Column lists in composite keys retain declared order
	•	Lists of constraints and indexes are sorted by their canonical names per ADR 009
	•	Model and table registries are represented as objects, not arrays, to avoid order-dependence

Optional and default fields
	•	Omit fields that are equal to their canonical defaults
	•	Canonical defaults
	•	nullable: false on columns omitted unless true
	•	generated: false omitted
	•	Empty arrays and empty objects omitted unless required for schema readability (tables and models must be present, even if empty)
	•	Capability flags omitted when false and recorded only when true
	•	Derived names injected by the emitter per ADR 009 must be present with generated: true

Identifiers and names
	•	Persist identifiers as authored or deterministically generated strings
	•	Do not case-normalize author-provided names beyond validation
	•	Deterministic names for PK/UK/FK/IDX per ADR 009 must appear in canonical form
	•	Engine-specific quoting is not embedded in the contract

Target extensions
	•	Target-specific sections live under capabilities.<target> and storage.extensions.<target>
	•	Keys within extensions follow the same lexicographic ordering
	•	Fields that do not alter logical meaning are included in profileHash only per ADR 004

Meta and provenance
	•	meta contains non-semantic information useful for tooling
	•	source: psl or ts
	•	sourcePath: normalized posix path relative to repo root
	•	emitterVersion, adapterVersions, generatedAt as ISO string
	•	generatedAt is excluded from all hashes
	•	meta key ordering is lexicographic and appears after core sections as defined above

Hashing
	•	coreHash is computed over the canonical JSON with profile-only fields stripped
	•	profileHash is computed over canonical JSON including profile fields
	•	Hash algorithm: SHA-256, represented as sha256:<hex>
	•	The exact canonicalization variant and schema version are embedded in meta for future migrations

Emitter responsibilities
	•	Normalize then canonicalize, then compute hashes, then write artifacts
	•	Provide --verify mode that re-parses and re-emits to assert byte-identical output
	•	Provide a prisma-next verify contract.json command to check adherence outside of emit

Consumer responsibilities
	•	Treat contract.json as immutable content-addressed data
	•	Never reorder or pretty-print when storing or transmitting
	•	Use coreHash for applicability checks and profileHash for drift checks

Examples

Minimal canonical object

{"schemaVersion":"1","targetFamily":"sql","target":"postgres","coreHash":"sha256:...","models":{},"storage":{"tables":{}}}

With capabilities and meta

{"schemaVersion":"1","targetFamily":"sql","target":"postgres","coreHash":"sha256:...","profileHash":"sha256:...","models":{"User":{"storage":{"table":"user"},"fields":{"id":{"column":"id"},"email":{"column":"email"}}}},"storage":{"tables":{"user":{"columns":{"email":{"type":"text"},"id":{"type":"int4"}},"primaryKey":{"columns":["id"],"name":"user_pkey"}}}},"capabilities":{"postgres":{"jsonAgg":true,"lateral":true}},"codecs":{"int4":{"ts":"number"},"text":{"ts":"string"}},"meta":{"emitterVersion":"1.0.0","source":"psl","sourcePath":"prisma/schema.prisma"}}

Alternatives considered
	•	RFC 8785 strict conformance without domain rules
insufficient for our defaults and naming requirements
	•	Pretty-printed JSON for readability
increases diff noise and weakens byte-level determinism
	•	Protobuf or CBOR canonical formats
tighter encoding but worse DX and harder ecosystem interoperability

Consequences

Positive
	•	Byte-identical artifacts across OSes and authoring modes
	•	Stable coreHash and profileHash for CI and PPg
	•	Cleaner diffs and lower review noise
	•	Deterministic planner inputs and fewer spurious changes

Trade-offs
	•	Harder to eyeball without a pretty-printer
	•	Slight complexity in emitter and tests
	•	Consumers must not reformat artifacts

Testing and compliance
	•	Golden tests for representative schemas, including edge cases of names, defaults, and extensions
	•	Round-trip parse → canonicalize → hash → parse checks
	•	Cross-platform CI jobs compare emitted bytes on Linux, macOS, and Windows
	•	Contract linter rule to detect non-canonical files committed by mistake

Backwards compatibility
	•	Older contracts without canonicalization are re-emitted on first emit and pick up hashes accordingly
	•	Schema version bump if canonicalization rules change in a breaking way

Open questions
	•	Whether to expose a --pretty view for humans without altering the on-disk artifact
	•	Policy for large numeric types that exceed IEEE-754 safe integers in JS tooling
	•	Canonicalization of expression-based indexes when added to the model

Decision record
	•	Adopt strict canonicalization rules for contract.json and compute all hashes over canonical bytes
	•	Emitter enforces and verifies determinism, consumers treat artifacts as immutable data
	•	Domain-specific rules align with our hashing split and deterministic naming to keep artifacts stable and useful
