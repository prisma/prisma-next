// Extract a single JSON object from a model's raw text response. Accepts:
//   - a bare JSON object (`{...}`)
//   - a fenced ```json block
//   - a JSON object embedded in surrounding prose
// Returns the parsed object on success, or `undefined` if no parseable object
// is found. Returning `undefined` is the fail-to-null path every prompt-set
// module maps onto its safe-fallback verdict.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractFromFence(raw: string): string | undefined {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match !== null ? match[1].trim() : undefined;
}

function extractBracedSpan(raw: string): string | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return undefined;
  return raw.slice(start, end + 1);
}

/** Extract the first parseable JSON object from a model response. */
export function parseJsonFromModel(raw: string): Record<string, unknown> | undefined {
  const direct = tryParseObject(raw.trim());
  if (direct !== undefined) return direct;

  const fenced = extractFromFence(raw);
  if (fenced !== undefined) {
    const parsed = tryParseObject(fenced);
    if (parsed !== undefined) return parsed;
  }

  const braced = extractBracedSpan(raw);
  if (braced !== undefined) {
    const parsed = tryParseObject(braced);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}
