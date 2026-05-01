/**
 * `bulkEncryptMiddleware(sdk: CipherstashSdk): SqlMiddleware` lands in
 * M2.c (the next implementation round); see
 * `projects/cipherstash-integration/project-1/specs/envelope-codec-extension.spec.md`
 * § Bulk-encrypt middleware.
 *
 * This subpath ships in M2.a so the package's surface area matches the
 * spec's § Subpath exports table — the implementation is intentionally
 * deferred to M2.c when the param-mutator-driven middleware seam from
 * M1 gets exercised end-to-end against a live EQL bundle.
 */
export {};
