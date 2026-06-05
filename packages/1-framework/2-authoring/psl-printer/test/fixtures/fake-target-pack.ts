/**
 * Test-only fixture extension: registers a `pslBlocks` descriptor
 * (carrying both parser + printer) and a matching `entityTypes` factory
 * for one made-up RLS-shaped keyword `fake_policy`. The keyword name
 * is deliberately not a real PSL block so downstream consumers
 * can't accidentally couple to it as a stable surface.
 *
 * A `fake_policy` block has the shape:
 *
 *   ```
 *   fake_policy <name> {
 *     target = <Identifier>
 *     using  = "<predicate>"
 *   }
 *   ```
 *
 * Future projects (RLS, roles, custom Postgres types) follow this
 * fixture's shape as the canonical example of an extension-contributed
 * top-level block. The slice's round-trip regression test
 * (`../fake-target-pack.round-trip.test.ts`) consumes this fixture.
 *
 * Ref: TML-2804.
 */

import type {
  AuthoringContributions,
  AuthoringEntityContext,
} from '@prisma-next/framework-components/authoring';
import { freezeNode, IRNodeBase } from '@prisma-next/framework-components/ir';
import type {
  PslExtensionBlock,
  PslExtensionBlockParserContext,
  PslExtensionBlockPrinterContext,
} from '@prisma-next/framework-components/psl-ast';

const FAKE_POLICY_DISCRIMINATOR = 'fake-policy';

export interface FakePolicyAst extends PslExtensionBlock {
  readonly kind: typeof FAKE_POLICY_DISCRIMINATOR;
  readonly target: string;
  readonly using: string;
}

export interface FakePolicyIrInput {
  readonly name: string;
  readonly target: string;
  readonly using: string;
}

/**
 * IR class for the fixture's `fake_policy` block. Plain readonly
 * fields only — JSON-clean by construction. Hydrate from JSON via
 * {@link hydrateFakePolicyIrFromJson}.
 */
export class FakePolicyIr extends IRNodeBase {
  override readonly kind: typeof FAKE_POLICY_DISCRIMINATOR = FAKE_POLICY_DISCRIMINATOR;
  readonly name: string;
  readonly target: string;
  readonly using: string;

  constructor(input: FakePolicyIrInput) {
    super();
    this.name = input.name;
    this.target = input.target;
    this.using = input.using;
    freezeNode(this);
  }
}

export function isFakePolicyAst(value: PslExtensionBlock): value is FakePolicyAst {
  return value.kind === FAKE_POLICY_DISCRIMINATOR;
}

export function hydrateFakePolicyIrFromJson(value: unknown): FakePolicyIr {
  if (typeof value !== 'object' || value === null) {
    throw new Error('hydrateFakePolicyIrFromJson: expected an object');
  }
  const record = value as Record<string, unknown>;
  if (record['kind'] !== FAKE_POLICY_DISCRIMINATOR) {
    throw new Error(
      `hydrateFakePolicyIrFromJson: expected kind "${FAKE_POLICY_DISCRIMINATOR}", got "${String(record['kind'])}"`,
    );
  }
  const name = record['name'];
  const target = record['target'];
  const using = record['using'];
  if (typeof name !== 'string' || typeof target !== 'string' || typeof using !== 'string') {
    throw new Error('hydrateFakePolicyIrFromJson: missing or mistyped name/target/using field');
  }
  return new FakePolicyIr({ name, target, using });
}

function parseFakePolicyBlock(ctx: PslExtensionBlockParserContext): FakePolicyAst {
  let target = '';
  let using = '';
  for (let lineIndex = ctx.bounds.startLine + 1; lineIndex < ctx.bounds.endLine; lineIndex++) {
    const stripped = ctx.stripInlineComment(ctx.lines[lineIndex] ?? '').trim();
    if (stripped.length === 0) {
      continue;
    }
    const targetMatch = stripped.match(/^target\s*=\s*([A-Za-z_]\w*)$/);
    if (targetMatch) {
      target = targetMatch[1] ?? '';
      continue;
    }
    const usingMatch = stripped.match(/^using\s*=\s*"((?:[^"\\]|\\.)*)"$/);
    if (usingMatch) {
      using = decodePslEscapes(usingMatch[1] ?? '');
      continue;
    }
    ctx.pushDiagnostic({
      code: 'PSL_INVALID_MODEL_MEMBER',
      message: `fake_policy block "${ctx.name}" does not recognise body line "${stripped}"`,
      span: ctx.trimmedLineSpan(lineIndex),
    });
  }
  return {
    kind: FAKE_POLICY_DISCRIMINATOR,
    name: ctx.name,
    span: ctx.lineRangeSpan(ctx.bounds.startLine, ctx.bounds.endLine),
    target,
    using,
  };
}

function printFakePolicyBlock(node: FakePolicyAst, ctx: PslExtensionBlockPrinterContext): string {
  const lines: string[] = [];
  lines.push(`fake_policy ${node.name} {`);
  lines.push(`${ctx.indent}target = ${node.target}`);
  lines.push(`${ctx.indent}using = "${ctx.escapeStringLiteral(node.using)}"`);
  lines.push('}');
  return lines.join('\n');
}

function decodePslEscapes(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== '\\' || i + 1 >= value.length) {
      result += ch;
      continue;
    }
    const next = value[i + 1];
    if (next === '\\' || next === '"' || next === "'") {
      result += next;
    } else if (next === 'n') {
      result += '\n';
    } else if (next === 'r') {
      result += '\r';
    } else {
      result += '\\';
      result += next;
    }
    i++;
  }
  return result;
}

export const fakeTargetPackContributions = {
  entityTypes: {
    fake_policy: {
      kind: 'entity',
      discriminator: FAKE_POLICY_DISCRIMINATOR,
      output: {
        factory: (input: FakePolicyAst, _ctx: AuthoringEntityContext): FakePolicyIr =>
          new FakePolicyIr({ name: input.name, target: input.target, using: input.using }),
      },
    },
  },
  pslBlocks: {
    fake_policy: {
      kind: 'pslBlock',
      discriminator: FAKE_POLICY_DISCRIMINATOR,
      parser: parseFakePolicyBlock,
      printer: printFakePolicyBlock,
    },
  },
} as const satisfies AuthoringContributions;
