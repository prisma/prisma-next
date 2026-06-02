const EXPLICIT_COMPATIBLE_TYPE_PAIRS: ReadonlyArray<readonly [string, string]> = [];

export function postgresColumnsCompatible(declared: string, live: string): boolean {
  if (declared === live) {
    return true;
  }
  for (const [a, b] of EXPLICIT_COMPATIBLE_TYPE_PAIRS) {
    if ((declared === a && live === b) || (declared === b && live === a)) {
      return true;
    }
  }
  return false;
}
