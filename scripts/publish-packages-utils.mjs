/**
 * Pure helpers for `publish-packages.mjs`, factored out so the
 * exit-code / output classification can be unit-tested without spawning
 * `pnpm publish` subprocesses.
 */

/**
 * npm's error wording when republishing a version number that already
 * exists on the registry. Surfaces both for "version is currently
 * published" *and* for "version was published-then-unpublished" — npm
 * permanently blocks the version number once it has ever been on the
 * registry under that name.
 *
 * We pattern-match on the human-readable message because the npm CLI
 * does not consistently surface a stable error code for this case in
 * the captured output of `pnpm publish` (no `npm error code
 * EPUBLISHCONFLICT` line is emitted on every npm version).
 */
const REPUBLISH_BLOCKED_MESSAGE = /You cannot publish over the previously published versions/;

/**
 * Decide whether a `pnpm publish` invocation should count as a success.
 *
 * A non-zero exit with npm's "cannot publish over previously published
 * versions" message is treated as a no-op success: the version is
 * already on the registry under the expected name, so the *outcome* the
 * caller wanted (this version exists on npm) holds. This makes the
 * batch publish idempotent and lets a re-run after a partial failure
 * complete cleanly — the workflow's documented recovery path.
 *
 * If the dist-tag for the package needs adjusting after a republish
 * (npm does not touch dist-tags when it rejects a publish), that is a
 * separate concern handled out-of-band by the operator. This helper
 * intentionally does not infer it.
 */
export function classifyPublishResult({ code, output }) {
  if (code === 0) {
    return { ok: true, alreadyPublished: false };
  }
  if (REPUBLISH_BLOCKED_MESSAGE.test(output)) {
    return { ok: true, alreadyPublished: true };
  }
  return { ok: false, alreadyPublished: false };
}
