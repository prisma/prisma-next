// Judge-vs-human agreement tally with the ≥0.80 gate that judge calibration
// must clear before its `intent` signal is trusted. Pure logic — corpus
// curation lives in `calibration/labels.md`, and the actual calibration RUN is
// parked (corpus-gated; operator-approved real-dollar spend). Until the corpus
// exists the judge's emissions are honest but uncalibrated.

export const CALIBRATION_THRESHOLD = 0.8;

export type IntentVerdict = 'pass' | 'fail' | null;

export type LabelledVerdict = {
  /** What the judge said on this case. */
  judge: IntentVerdict;
  /** The held-out human label for the same case. */
  human: IntentVerdict;
};

export type AgreementReport = {
  rate: number;
  n: number;
  passes: boolean;
};

/** Compute exact agreement between judge and human labels (no Cohen's kappa
 *  yet — held-out exact agreement is what the gate measures). An empty corpus
 *  reports rate 0 / passes false: an uncalibrated judge does not clear the
 *  gate by default. */
export function agreementRate(labels: LabelledVerdict[]): AgreementReport {
  const n = labels.length;
  if (n === 0) return { rate: 0, n: 0, passes: false };
  let agree = 0;
  for (const { judge, human } of labels) {
    if (judge === human) agree++;
  }
  const rate = agree / n;
  return { rate, n, passes: rate >= CALIBRATION_THRESHOLD };
}
