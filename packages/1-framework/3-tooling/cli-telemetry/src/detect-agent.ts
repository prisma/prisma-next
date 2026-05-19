/**
 * Best-effort identification of AI coding-agent sessions from an
 * env-var allowlist. Detector property: false positives are negligible
 * (a marker present ⇒ confidently an agent); false negatives are
 * expected and documented in the user-facing telemetry docs. New
 * entries should land here, not in per-CLI hand-rolls.
 *
 * Each entry is a `(envVar, agent)` pair with uniform comparison shape:
 * the marker counts as "present" when `process.env[envVar]` is set to a
 * truthy string. Truthy = anything other than the empty string, `'0'`,
 * or `'false'` (case-insensitive); see `gating.isTruthyOptOut` for the
 * same convention applied to opt-out env vars.
 *
 * The detector runs in the **child** sender process, never the parent;
 * the parent does not probe env at command start.
 *
 * TODO: a ci-info-for-agents would be nice — this allowlist drifts the
 * moment a new agent ships its env marker, and consolidating with the
 * other ecosystems that need the same lookup (rate-limited LLM
 * gateways, agent-aware metrics, etc.) would let one library carry the
 * matrix instead of every consumer re-doing it.
 */
export interface AgentMarker {
  /** The env-var name to read. Exact-match; no prefix or fuzzy logic. */
  readonly envVar: string;
  /** The agent label written to the `agent` field of the telemetry event. */
  readonly agent: string;
}

export const AGENT_MARKERS: readonly AgentMarker[] = [
  { envVar: 'CLAUDECODE', agent: 'Claude Code' },
  { envVar: 'CURSOR_AGENT', agent: 'Cursor' },
  { envVar: 'WINDSURF', agent: 'Windsurf' },
  { envVar: 'AIDER', agent: 'Aider' },
  { envVar: 'CODY', agent: 'Cody' },
  { envVar: 'CONTINUE', agent: 'Continue' },
];

function isTruthyMarker(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const normalised = raw.trim().toLowerCase();
  if (normalised === '') return false;
  if (normalised === '0') return false;
  if (normalised === 'false') return false;
  return true;
}

/**
 * Resolve the agent label from an env snapshot, or `null` if no marker
 * is set. Returns the **first** matching marker in `AGENT_MARKERS`
 * order, so when multiple markers are set the agent label is
 * deterministic and the allowlist's first entry wins.
 *
 * Pure: takes an env record, returns a string or null. No I/O.
 */
export function detectAgent(env: Readonly<Record<string, string | undefined>>): string | null {
  for (const marker of AGENT_MARKERS) {
    if (isTruthyMarker(env[marker.envVar])) {
      return marker.agent;
    }
  }
  return null;
}
