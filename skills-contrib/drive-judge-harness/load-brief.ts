import { readFileSync } from 'node:fs';
import { join } from 'pathe';

// Loads a golden case: its machine-readable `case.json` metadata and the
// `brief.md` text the harness sends to the orchestrator. No SDK involvement.

export type CaseMeta = {
  slug: string;
  title: string;
  shape: string;
  recommended_model: string;
  summary: string;
};

export type GoldenCase = {
  meta: CaseMeta;
  briefText: string;
  dir: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const META_STRING_FIELDS = ['slug', 'title', 'shape', 'recommended_model', 'summary'] as const;

function parseMeta(raw: unknown, sourceLabel: string): CaseMeta {
  if (!isRecord(raw)) {
    throw new Error(`${sourceLabel}: case.json must be a JSON object`);
  }
  const out: Record<string, string> = {};
  for (const field of META_STRING_FIELDS) {
    const value = raw[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${sourceLabel}: case.json field "${field}" must be a non-empty string`);
    }
    out[field] = value;
  }
  return {
    slug: out.slug,
    title: out.title,
    shape: out.shape,
    recommended_model: out.recommended_model,
    summary: out.summary,
  };
}

/** Load and validate a golden case from its directory. Throws a clear error if
 *  `case.json` is missing/malformed or `brief.md` is unreadable. */
export function loadCase(caseDir: string): GoldenCase {
  const metaPath = join(caseDir, 'case.json');
  const briefPath = join(caseDir, 'brief.md');

  let rawMeta: unknown;
  try {
    rawMeta = JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch (err) {
    throw new Error(
      `${metaPath}: failed to read/parse case.json (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const meta = parseMeta(rawMeta, metaPath);

  let briefText: string;
  try {
    briefText = readFileSync(briefPath, 'utf8');
  } catch (err) {
    throw new Error(
      `${briefPath}: failed to read brief.md (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  if (briefText.trim().length === 0) {
    throw new Error(`${briefPath}: brief.md is empty`);
  }

  return { meta, briefText, dir: caseDir };
}
