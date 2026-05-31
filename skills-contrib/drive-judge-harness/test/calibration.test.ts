import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agreementRate, type LabelledVerdict } from '../judge/calibration.ts';

describe('agreementRate', () => {
  it('returns rate 1.0 and passes when every verdict matches the human label', () => {
    const labels: LabelledVerdict[] = [
      { judge: 'pass', human: 'pass' },
      { judge: 'fail', human: 'fail' },
      { judge: 'pass', human: 'pass' },
    ];
    const result = agreementRate(labels);
    assert.equal(result.rate, 1);
    assert.equal(result.n, 3);
    assert.equal(result.passes, true);
  });

  it('returns rate 0 and fails when nothing matches', () => {
    const labels: LabelledVerdict[] = [
      { judge: 'pass', human: 'fail' },
      { judge: 'fail', human: 'pass' },
    ];
    const result = agreementRate(labels);
    assert.equal(result.rate, 0);
    assert.equal(result.n, 2);
    assert.equal(result.passes, false);
  });

  it('passes at exactly the 0.80 boundary', () => {
    const labels: LabelledVerdict[] = [
      { judge: 'pass', human: 'pass' },
      { judge: 'pass', human: 'pass' },
      { judge: 'pass', human: 'pass' },
      { judge: 'pass', human: 'pass' },
      { judge: 'fail', human: 'pass' },
    ];
    const result = agreementRate(labels);
    assert.equal(result.rate, 0.8);
    assert.equal(result.n, 5);
    assert.equal(result.passes, true);
  });

  it('fails just below the 0.80 boundary', () => {
    const labels: LabelledVerdict[] = [
      { judge: 'pass', human: 'pass' },
      { judge: 'pass', human: 'pass' },
      { judge: 'pass', human: 'pass' },
      { judge: 'fail', human: 'pass' },
    ];
    const result = agreementRate(labels);
    assert.equal(result.rate, 0.75);
    assert.equal(result.passes, false);
  });

  it('counts null == null as agreement', () => {
    const labels: LabelledVerdict[] = [
      { judge: null, human: null },
      { judge: 'pass', human: 'pass' },
    ];
    const result = agreementRate(labels);
    assert.equal(result.rate, 1);
    assert.equal(result.passes, true);
  });

  it('counts a null judge verdict against a non-null human label as disagreement', () => {
    const labels: LabelledVerdict[] = [
      { judge: null, human: 'pass' },
      { judge: 'pass', human: 'pass' },
    ];
    const result = agreementRate(labels);
    assert.equal(result.rate, 0.5);
    assert.equal(result.passes, false);
  });

  it('reports rate 0 and fails on an empty corpus (uncalibrated baseline)', () => {
    const result = agreementRate([]);
    assert.equal(result.rate, 0);
    assert.equal(result.n, 0);
    assert.equal(result.passes, false);
  });
});
