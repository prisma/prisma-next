const NUMERIC_PATTERN = /^\d+$/;
const PR_VERSION_PATTERN = /^\d+\.\d+\.\d+-pr\.(\d+)\.(\d+)$/;

function assertNumericPrNumber(prNumber: string): void {
  if (!NUMERIC_PATTERN.test(prNumber)) {
    throw new Error('PR number must be numeric');
  }
}

export function parsePrBuildNumber(version: string, prNumber: string): number | undefined {
  assertNumericPrNumber(prNumber);
  const match = version.match(PR_VERSION_PATTERN);
  if (!match) {
    return undefined;
  }

  const versionPrNumber = match[1];
  if (versionPrNumber !== prNumber) {
    return undefined;
  }

  return Number.parseInt(match[2], 10);
}

export function findNextPrBuildNumber(versions: readonly string[], prNumber: string): number {
  assertNumericPrNumber(prNumber);

  const matchingBuildNumbers = versions
    .map((version) => parsePrBuildNumber(version, prNumber))
    .filter((buildNumber) => buildNumber !== undefined);

  const lastBuild = matchingBuildNumbers.length > 0 ? Math.max(...matchingBuildNumbers) : 0;
  return lastBuild + 1;
}
