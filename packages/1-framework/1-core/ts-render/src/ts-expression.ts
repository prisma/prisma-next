/**
 * Declarative contribution to the `import` block of a rendered TypeScript
 * source file. Each node in an IR declares which symbols it needs from which
 * modules; the top-level renderer deduplicates across nodes and emits one
 * `import { a, b, c } from "…"` line per module.
 */
export interface ImportRequirement {
  readonly moduleSpecifier: string;
  readonly symbol: string;
}

/**
 * Abstract base class for any IR node that can be emitted as a TypeScript
 * expression and declare its own import requirements.
 *
 * A top-level renderer walks an array of these polymorphically, concatenates
 * `renderTypeScript()` results, and aggregates `importRequirements()` into a
 * deduplicated import block.
 */
export abstract class TsExpression {
  abstract renderTypeScript(): string;
  abstract importRequirements(): readonly ImportRequirement[];
}
