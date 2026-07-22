# Batch 4 faithfulness audit (READ-ONLY)

Source SHA `a6d0155` (`prisma/prisma`). Upstream at `/tmp/prisma/packages/client/tests/functional/…`.
Ports at `test/integration/test/ports/prisma/functional/<name>.test.ts`, fixtures at `test/integration/test/ports/_fixtures/<name>/contract.prisma`.

Legend for dispositions: PASS = faithful. FLAG categories per the brief.

---

## 1. `legacy-aggregations` — src `0-legacy-ports/aggregations/tests.ts`

Schema (fixture `contract.prisma`) matches upstream `_schema.ts` User/Post 1:1. Matrix = allProviders → postgres entry in scope. Seed [20,45,60,63] matches upstream `beforeAll` (copycat emails; port inlines literal emails — irrelevant to assertions). 13 upstream tests; 8 runtime + 5 type-only.

| Upstream test (tests.ts) | Upstream assertion | Port (legacy-aggregations.test.ts) | Verdict |
| --- | --- | --- | --- |
| `min` L37-49 | `{_min:{age:20}}` | L41-49 `{_min:20}` | PASS (shape flattened `_min:{age}` → `_min` scalar; prisma-next agg shape; value identical) |
| `max` L51-63 | `{_max:{age:63}}` | L51-59 `{_max:63}` | PASS |
| `sum` L65-77 | `{_sum:{age:188}}` | L61-69 `{_sum:188}` | PASS |
| `count inline boolean` L79-88 | `{_count:4}` | L71-79 `{_count:4}` | PASS |
| `count with _all` L90-104 | `{_count:{_all:4}}` | L81-89 `{_count:4}` | PASS (flattened; value 4 identical) |
| `avg` L106-118 | `{_avg:{age:47}}` | L91-99 `{_avg:47}` | PASS |
| `multiple aggregations` L120-152 | `_avg 47,_count 4,_max 63,_min 20,_sum 188` | L101-115 identical | PASS |
| `multiple aggregations with where` L154-196 | `where age>20`; `_avg 56,_count:{email:3},_max 63,_min 45,_sum 168` | L117-131 `_count:agg.count()` → `_count:3` | PASS-with-note (see below) |
| `invalid min/max/sum/count/avg` L198-… | `@ts-expect-error` + Prisma runtime error snapshot | not in .test.ts; recorded as type-only non-port | See finding A |

**Note (count semantics):** upstream `multiple aggregations with where` uses `_count:{ email:true }` = COUNT of non-null `email`. Port maps to `agg.count()` = COUNT(*). All 3 rows with age>20 have non-null email, so both yield 3 → assertion holds. This is a benign INPUT-SUBSTITUTION: result identical, but `count()` counts all rows, not the `email` field specifically. Faithful because the asserted value is preserved; would diverge only if a row had null email. Header comment (L22-24) discloses this accurately. Acceptable.

**Finding A (minor, DROPPED-TYPE-ASSERTION):** The 5 `invalid *` cases carry upstream `@ts-expect-error` on wrong-field selection (`posts`/`email` in the wrong aggregate). The spec ("Type-level assertions are ported, not dropped") says these have a faithful home as `@ts-expect-error` on the equivalent invalid prisma-next agg call (e.g. `agg.min('posts')`, `agg.sum('email')`) in a sibling `.test-d.ts`. No `legacy-aggregations.test-d.ts` exists; the cases are narrated as non-ported in the header comment (L15-20) rather than ported as negative type tests. These are portable (prisma-next agg builder is typed over scalar fields), so dropping them weakens the port. **FLAG: DROPPED-TYPE-ASSERTION ×5** (invalid min/max/sum/count/avg).

---

## 2. `legacy-json` — src `0-legacy-ports/json/tests.ts`

Schema (fixture) Resource{id String @id, requiredJson Json, optionalJson Json?} matches upstream `_schema.ts` 1:1. Matrix includes postgres. 6 upstream tests.

| Upstream test | Upstream assertion | Port (legacy-json.test.ts) | Verdict |
| --- | --- | --- | --- |
| `create required json` L24-64 | full object snapshot incl. `optionalJson:null` | L40-61 `toEqual` same object | PASS (copycat.uuid(1) → literal `02d2…846`; same value) |
| `select required json` L66-74 | `toHaveLength(1)` + `toHaveProperty('requiredJson')` | L63-75 identical | PASS |
| `select required json with where path` L76-116 (`testIf` mysql/pg/cockroach/sqlite → **postgres in scope**) | `where:{requiredJson:{path:['bar','baz'],equals:'qux'}}` → len 1 | non-ported | PASS-non-port (see finding B) |
| `select required json with where equals` L118-127 | `where:{requiredJson:{equals:…}}` → len 1 | L77-88 `where({requiredJson:REQUIRED_JSON})` → len 1 | PASS (shorthand equality) |
| `select required json with where not equals` L129-138 | `where:{requiredJson:{not:…}}` → len 0 | L90-103 `r.requiredJson.neq(…)` → len 0 | PASS |
| `update required json with where equals` L140-165 | update to `{}`, snapshot `{id,optionalJson:null,requiredJson:{}}` | L105-122 `toEqual` same | PASS |

**Finding B (correct non-port):** `where path` is genuinely non-portable — `non-ported.md` L53 records it precisely (jsonb ORM exposes whole-value equality only, no `path` operator). The postgres branch (array path) is the in-scope one; correctly cited. PASS.

No violations.

---

## 3. `legacy-optional-relation-filters` — src `0-legacy-ports/optional-relation-filters/tests.ts`

Schema (fixture) User{id,email @unique,bio Bio?} / Bio{id,text?,user User?,userId? @unique} matches upstream 1:1. Seed (3 users) matches upstream copycat ids, inlined as literals. `bio` is a to-one optional; port expresses the optional-relation filter via `.some()`/`.none()` — acceptable API-shape translation (isNot-null ≡ some-exists, is-null ≡ none). All upstream cases are `testIf(provider !== MONGODB)` → postgres in scope.

**Upstream has SIX tests** (create.ts equivalent list):
1. `filter existing optional relation with isNot: null` (`bio:{isNot:null}`)
2. `filter empty optional relation with ` (`bio:{is:null}`)
3. `filter empty optional relation with null` (`bio:null`)
4. `filter empty optional relation` (`bio:null`) — **duplicate of #3**
5. `filter existing optional relation with empty field` (`bio:{text:null}`)
6. `filter existing optional relation with existing field` (`bio:{text:{not:null}}`)

| Upstream | Upstream assertion | Port | Verdict |
| --- | --- | --- | --- |
| #1 isNot:null | len 2, users a7fe…/a85d… | L54-70 `bio.some()` sorted → same 2 | PASS |
| #2 is:null | len 1, user 02d2…846 | L72-86 `bio.none()` → same | PASS |
| #3 bio:null | len 1, user 02d2…846 | L88-102 `bio.none()` → same | PASS |
| #4 bio:null (dup) | len 1, user 02d2…846 | **NO corresponding `it(...)` in port** | See finding C |
| #5 text:null | len 1, user a85d… | L104-118 `bio.some(b=>b.text.isNull())` → same | PASS |
| #6 text:{not:null} | len 1, user a7fe… | L120-134 `bio.some(b=>b.text.isNotNull())` → same | PASS |

**Finding C (DROPPED/WEAKENED-RUNTIME-ASSERTION + accounting error):** The port contains 5 `it(...)` blocks, but upstream has 6 tests. The 4th test (`filter empty optional relation`, `bio:null`, duplicate of #3) has **no ported test** — yet checklist `prisma-functional-0-l.md` L73 checks it `[x]` and points it at `legacy-optional-relation-filters.test.ts`. It is a byte-for-byte duplicate of #3 in behaviour, but the accounting invariant is "one line per source test," and this line is marked ported-passing without a test existing. **FLAG: WRONG-DISPOSITION** — checklist L73 should either map to a distinct `it` (trivial: add a 4th identical case) or the duplicate must be justified in prose in the ledger; today it claims a port that isn't there. Low severity (semantically covered by #3), but violates the accounting invariant.

---

## 4. `optimistic-concurrency-control` — src `optimistic-concurrency-control/tests.ts`

Schema (fixture) Resource{id,occStamp Int @default(0) @unique,child Child?} / Child{id,parent Resource @relation onDelete:Cascade,parentId @unique} matches upstream 1:1. Matrix allProviders. 5 upstream tests.

| Upstream test | Provider guard | Subject | Port disposition | Verdict |
| --- | --- | --- | --- | --- |
| `updateMany` L28-51 | skip relationMode=prisma | atomic `{occStamp:{increment:1}}` under 5-way race | non-ported (non-ported.md L62) | PASS-non-port |
| `update` L54-70 | skip relationMode=prisma | same atomic increment | non-ported L63 | PASS-non-port |
| `deleteMany` L72-88 | `testIf(!mongo/cockroach/sqlite)` → **postgres in scope** | 5 concurrent `deleteMany where occStamp=0`, total count 1 | PORTED L29-46 | PASS |
| `upsert` L91-111 | `testIf(!mysql)` → postgres in scope | atomic increment in `update` branch | non-ported L64 | PASS-non-port |
| `update with upsert relation` L113-… | (no guard) | atomic increment + nested `child.upsert` | non-ported L65 | PASS-non-port |

**deleteMany port fidelity:** upstream returns `result.count`, port uses `deleteAll()` array `.length`; both summed to `toBe(1)` (port L43 vs upstream L86). `where({occStamp:0})` ≡ `where:{occStamp:0}`. `Resource.create({})` seeded per-run (upstream `beforeEach`). Faithful.

**Non-port verification:** the 4 non-ports all require `{ occStamp: { increment: 1 } }` atomic field update, which prisma-next ORM's `updateAll`/`update`/`upsert` do not express (plain-value data only). Genuinely inexpressible — confirmed against STATUS/API surface. `non-ported.md` L62-65 reasons are precise. PASS.

No violations.

---

## 5. `composites-object-create` — src `composites/object/create.ts` (MongoDB)

Matrix = mongodb-only × {contentProperty: required | optional}. Fixture models `CommentRequired`(content CommentContent) + `CommentOptional`(content CommentContent?) with shared `type CommentContent`/`CommentContentUpvotes` — faithful two-root translation of the upstream single-model×2-variant matrix. Schema types match upstream `_schema.ts` 1:1.

Upstream = 5 tests × 2 variants = 10 logical cases.

| Upstream test | Variant | Upstream assertion | Port | Verdict |
| --- | --- | --- | --- | --- |
| `set` L8-42 (`content:{set:{…}}`) | required | snapshot content+country, id Any<String> | required L40-62 (`content:{…}` plain) `toMatchObject` + `_id` ObjectId | PASS-with-note (mechanism, below) |
| `set` | optional | same | optional L118-140 | PASS |
| `set shorthand` L44-78 (`content:{…}` no set) | required | same snapshot | required L64-85 | PASS (see mechanism note — identical to `set` port) |
| `set shorthand` | optional | same | optional L142-163 | PASS |
| `set null` L80-124 | required | `rejects.toThrow('Argument \`set\` must not be null')` | **not ported** (narrated compile-time) | See finding D |
| `set null` | optional | snapshot `content:null` | optional L165-180 `content:null` → `content:null` | PASS |
| `set null shorthand` L126-… | required | `rejects.toThrow('Argument \`content\` must not be null')` | **not ported** (narrated compile-time) | See finding D |
| `set null shorthand` | optional | snapshot `content:null` | optional L182-194 (content omitted) → null/undefined | PASS (asserts `content===null||undefined`; upstream asserts strict null — mild weakening, see finding E) |
| `set nested list` L…-end | required | snapshot 2 upvotes | required L87-114 | PASS |
| `set nested list` | optional | same | optional L196-223 | PASS |

**Mechanism note (`set` wrapper):** upstream `set` uses `content:{ set:{…} }`; upstream `set shorthand` uses `content:{…}`. Both forms are the SUBJECT of the pair (Prisma accepts wrapped and unwrapped composite writes). prisma-next has no `set` wrapper, so the port renders both as identical plain assignment (port L44-62 ≡ L64-85). This is acceptable API-shape translation (the `set` operator is Prisma-specific syntax; the composite-create behaviour is preserved), but the two ported tests are now literally identical. Not a hard violation — the composite-write behaviour is genuinely exercised in both.

**Finding D (DROPPED-TYPE-ASSERTION ×2):** The required-variant `set null` and `set null shorthand` cases assert a **runtime rejection** upstream. In prisma-next, passing `content: null` to the non-nullable `CommentRequired.content` is a compile-time type error — the claim in the port header (L25-28) and checklist L288-289 that this is "enforced at compile time" is plausible and correct in spirit. BUT per spec ("Type-level assertions are ported, not dropped"; the faithful home for a compile-time constraint is `@ts-expect-error` in a sibling `.test-d.ts`), these two cases are **portable** as `@ts-expect-error` on `db.comments_required.create({ country:'France', content:null })` and `create({ country:'France' })` — instead they are only narrated in prose. No `composites-object-create.test-d.ts` exists. **FLAG: DROPPED-TYPE-ASSERTION ×2** — the negative-type constraint (required content rejects null) is dropped rather than expressed as a negative type test. (The upstream disposition is a runtime throw, not a type error, but the spec explicitly maps compile-time-enforced constraints to `@ts-expect-error` ports.)

**Finding E (mild WEAKENED-ASSERTION):** optional `set null shorthand` (port L182-194): upstream asserts the result `content` is strictly `null`. Port asserts `content === null || content === undefined` (L191), loosening to accept `undefined`. Upstream inline snapshot is exactly `"content": null`. Minor weakening; if prisma-next returns `undefined` for an omitted optional composite this is a real shape divergence that should be asserted precisely (pick one), not disjoined. Low severity.

---

## Summary table

| Test | Schema faithful | Query faithful | Assertions faithful | Non-ports justified | Net verdict |
| --- | --- | --- | --- | --- | --- |
| legacy-aggregations | Yes | Yes (count()≈count(email), values match) | Runtime PASS | — | **FLAG: 5 dropped type-assertions** (invalid min/max/sum/count/avg not ported to `.test-d.ts`) |
| legacy-json | Yes | Yes | PASS | `where path` non-port precise (L53) | **PASS** |
| legacy-optional-relation-filters | Yes | Yes (`.some/.none` ≡ isNot/is-null) | PASS | — | **FLAG: 6th upstream test (dup `bio:null`) checked `[x]` but has no ported `it` — WRONG-DISPOSITION/accounting** |
| optimistic-concurrency-control | Yes | Yes | PASS | 4 atomic-increment non-ports genuinely inexpressible (L62-65) | **PASS** |
| composites-object-create | Yes | API-shape (no `set` wrapper) | Mostly PASS | — | **FLAG: 2 dropped type-assertions (required set-null), 1 mild weakening (null-vs-undefined)** |

**Totals:** 3 tests carry findings (aggregations, optional-relation-filters, composites), 2 clean (json, occ). No SCHEMA-SIMPLIFICATION or FEATURE-SUBSTITUTION-to-pass detected. Findings are: 7 dropped type-level assertions across 2 suites (all portable as `@ts-expect-error`/negative-agg-typing, currently only narrated), 1 accounting/disposition error (optional-relation-filters dup test), 1 mild runtime-assertion weakening (composites null-vs-undefined). All flagged non-ports (json path, OCC increments) are genuinely inexpressible and precisely recorded.
