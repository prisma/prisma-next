import { beforeEach, describe, expect, it } from 'vitest';
import {
  disposeEmitOutputQueue,
  issueContractArtifactGeneration,
} from '../../src/utils/publish-contract-artifact-pair-serialized';

describe('publishContractArtifactPairSerialized — queue lifecycle', () => {
  // Use a unique path per test so module-global state from other tests cannot interfere.
  let path: string;
  beforeEach(() => {
    path = `/tmp/disposeEmitOutputQueue-${Math.random().toString(36).slice(2)}/contract.json`;
  });

  it('issues monotonically increasing generations for a given output path', () => {
    expect(issueContractArtifactGeneration(path)).toBe(1);
    expect(issueContractArtifactGeneration(path)).toBe(2);
    expect(issueContractArtifactGeneration(path)).toBe(3);
  });

  it('resets the generation counter after dispose', () => {
    expect(issueContractArtifactGeneration(path)).toBe(1);
    expect(issueContractArtifactGeneration(path)).toBe(2);

    disposeEmitOutputQueue(path);

    // A fresh queue starts at 0; the first issue increments to 1.
    expect(issueContractArtifactGeneration(path)).toBe(1);
  });

  it('disposes only the requested path', () => {
    const otherPath = `${path}.other`;
    issueContractArtifactGeneration(path);
    issueContractArtifactGeneration(otherPath);

    disposeEmitOutputQueue(path);

    // path was reset; otherPath was untouched.
    expect(issueContractArtifactGeneration(path)).toBe(1);
    expect(issueContractArtifactGeneration(otherPath)).toBe(2);
  });

  it('is a no-op for a path with no queue', () => {
    expect(() => disposeEmitOutputQueue(path)).not.toThrow();
    expect(issueContractArtifactGeneration(path)).toBe(1);
  });
});
