/**
 * Vendored CipherStash EQL bundle SQL.
 *
 * The cipherstash team ships the bundle as a single `~5,750-line`
 * Postgres script that creates the `eql_v2` schema, the `eql_v2_*`
 * composite types / domains, the `eql_v2_configuration` table, plus
 * roughly 169 functions, 46 operators, 4 casts, and 9 operator
 * classes / families. CipherStash treats the bundle as one indivisible
 * artefact; the project spec NFR4 / AC7 require that this file's
 * contents are inlined into the `cipherstash:install-eql-bundle-v1`
 * migration op **byte-for-byte** with no fork or split.
 *
 * ## R1 stance — placeholder
 *
 * The actual vendored bundle is owned by the cipherstash team and is
 * not yet checked in to this monorepo (the
 * `projects/cipherstash-integration/` work that produced it is
 * reference design only — see this project's spec § "What this design
 * does not do" + plan § Shipping Strategy). R1 lands the framework
 * wiring (descriptor → contract space → migration package shape →
 * pinned-artefact emission) so that dropping the real bundle in is a
 * one-file change at this seam. The shape consumers see is unchanged
 * between the placeholder and the real bundle: a single SQL string
 * embedded as the body of the `cipherstash:install-eql-bundle-v1` op.
 *
 * Replace this file's content with the vendored bundle SQL when it
 * lands; the descriptor's `headRef.hash` will then need to be
 * regenerated (the storage hash recomputes deterministically from the
 * contract IR; the bundle is not part of the contract IR — it lives
 * inside a migration op — so swapping in the real bundle does not
 * change `headRef.hash` per se, but it does change the
 * `installEqlBundle` op's `migrationHash` aggregate, which the runner
 * verifies on read).
 */
export const EQL_BUNDLE_SQL = `-- CipherStash EQL bundle (placeholder — vendored from cipherstash@<version>).
-- Replace this file's content byte-for-byte with the real bundle when it
-- lands. See packages/3-extensions/cipherstash/src/core/eql-bundle.ts for
-- the rationale.
--
-- The real bundle creates: schema eql_v2; composite types (eql_v2_encrypted,
-- ore_block_u64_8_256, ore_cclw_u64_8, ...); domains (eql_v2.bloom_filter,
-- eql_v2.hmac_256, eql_v2.blake3); 169 functions; 46 operators; 4 casts;
-- 9 operator classes/families. The eql_v2_configuration table is created
-- separately (cipherstash:create-eql_v2_configuration-v1).
SELECT 'cipherstash:install-eql-bundle-v1 placeholder' AS placeholder;
`;
