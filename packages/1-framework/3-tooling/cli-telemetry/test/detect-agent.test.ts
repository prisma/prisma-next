import { describe, expect, it } from 'vitest';
import { AGENT_MARKERS, detectAgent } from '../src/detect-agent';

describe('detectAgent', () => {
  it('returns null when no marker env var is set', () => {
    expect(detectAgent({})).toBeNull();
  });

  it('returns null when only an unrelated env var is set', () => {
    expect(detectAgent({ HOME: '/home/alice', SHELL: '/bin/bash' })).toBeNull();
  });

  describe('one positive case per marker in the allowlist', () => {
    for (const marker of AGENT_MARKERS) {
      it(`returns "${marker.agent}" when ${marker.envVar} is set to a truthy value`, () => {
        expect(detectAgent({ [marker.envVar]: '1' })).toBe(marker.agent);
      });
    }
  });

  it('returns the first matching agent when multiple markers are set (deterministic by allowlist order)', () => {
    const firstTwo = AGENT_MARKERS.slice(0, 2);
    if (firstTwo.length < 2) return;
    const env: Record<string, string> = {};
    for (const marker of firstTwo) env[marker.envVar] = '1';
    const expected = firstTwo[0]?.agent;
    expect(detectAgent(env)).toBe(expected);
  });

  it('treats set-but-empty marker values as "not present" (false negatives are documented)', () => {
    const first = AGENT_MARKERS[0];
    if (first === undefined) return;
    expect(detectAgent({ [first.envVar]: '' })).toBeNull();
  });

  it('treats marker values of "0" / "false" as "not present" (set-but-falsy = unset)', () => {
    const first = AGENT_MARKERS[0];
    if (first === undefined) return;
    expect(detectAgent({ [first.envVar]: '0' })).toBeNull();
    expect(detectAgent({ [first.envVar]: 'false' })).toBeNull();
  });

  it('does not treat a marker prefix as a match (must be the literal env-var name)', () => {
    expect(detectAgent({ NOT_CLAUDECODE: '1', UNRELATED: '1' })).toBeNull();
  });
});
