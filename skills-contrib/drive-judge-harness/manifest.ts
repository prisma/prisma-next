import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'pathe';
import type { TokenTotals } from './usage.ts';

// The run manifest is the transitional home for the per-run token signal.
//
// The canonical trace `tokens` field is owned by a sibling slice (it adds it to
// `drive-record-traces/schema.ts`) and does not exist yet, so the fail-closed
// emitter would reject a trace line carrying it. Until that schema field lands,
// the harness records the accumulated totals (plus run metadata) here, beside
// the trace. When the `tokens` trace field exists, this manifest's `tokens`
// migrates into the validated trace via the emitter.

export type RunStatus = 'dry-run' | 'finished' | 'error' | 'startup-failed';

export type DiffStat = {
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export type RunManifest = {
  schema_version: '1';
  case_slug: string;
  model: string;
  status: RunStatus;
  run_id: string | null;
  agent_id: string | null;
  trace_file: string;
  /** Accumulated per-run usage, or `null` when no live run produced a signal
   *  (dry-run, startup failure, or local runtime which emits no usage events). */
  tokens: TokenTotals | null;
  /** Wall-clock duration reported by the SDK (`wait()` outcome `durationMs`),
   *  or `null` for dry-run, startup-failed, and error paths. */
  wall_clock_ms: number | null;
  started_at: string;
  finished_at: string | null;
  notes: string[];
  // Pinned skill-bundle input fields — present only when produced by run-arm.
  base_ref?: string;
  base_sha?: string;
  skill_bundle_ref?: string;
  skill_bundle_sha?: string;
  run_dir?: string;
  collected_trace_paths?: string[];
  diff_stat?: DiffStat;
  materialized?: boolean;
};

/** Write the manifest as pretty-printed JSON with a trailing newline. Creates
 *  the parent directory on first write. Returns the serialized content. */
export function writeManifest(path: string, manifest: RunManifest): string {
  const content = JSON.stringify(manifest, null, 2);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${content}\n`);
  return content;
}
