/**
 * End-to-end type narrowing for an extension-contributed PSL block.
 * The test pins the load-bearing property: a contribution literal
 * declared with `as const satisfies` produces a `parser` whose return
 * type is the same AST node shape its own `printer` consumes and its
 * matching `entityTypes` factory accepts. The parser's return is also
 * constrained to extend `PslExtensionBlock` so the framework AST slot can
 * hold it.
 */

import { expectTypeOf, test } from 'vitest';
import type {
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockDescriptor,
  AuthoringPslBlockNamespace,
} from '../src/shared/framework-authoring';
import type {
  PslExtensionBlock,
  PslExtensionBlockParserContext,
  PslExtensionBlockPrinterContext,
} from '../src/shared/psl-extension-block';

interface FixtureAst extends PslExtensionBlock {
  readonly kind: 'fixture-block';
  readonly predicate: string;
}

type FixtureInput = {
  readonly name: string;
  readonly predicate: string;
};

const fixturePslBlocks = {
  fixture: {
    kind: 'pslBlock',
    discriminator: 'fixture-block',
    parser(ctx: PslExtensionBlockParserContext): FixtureAst {
      return {
        kind: 'fixture-block',
        name: ctx.name,
        span: ctx.lineRangeSpan(ctx.bounds.startLine, ctx.bounds.endLine),
        predicate: '',
      };
    },
    printer(input: FixtureAst, ctx: PslExtensionBlockPrinterContext): string {
      return `fixture ${input.name} {\n${ctx.indent}predicate = "${ctx.escapeStringLiteral(input.predicate)}"\n}`;
    },
  },
} as const satisfies AuthoringPslBlockNamespace;

const fixtureEntityTypes = {
  fixture: {
    kind: 'entity',
    discriminator: 'fixture-block',
    output: {
      factory: (_input: FixtureInput): FixtureAst => ({
        kind: 'fixture-block',
        name: '',
        span: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 0, line: 1, column: 1 },
        },
        predicate: '',
      }),
    },
  },
} as const satisfies AuthoringEntityTypeNamespace;

test('parser return narrows to the AST shape its own printer consumes', () => {
  type ParserOutput = ReturnType<typeof fixturePslBlocks.fixture.parser>;
  type PrinterInput = Parameters<typeof fixturePslBlocks.fixture.printer>[0];

  expectTypeOf<ParserOutput>().toEqualTypeOf<FixtureAst>();
  expectTypeOf<PrinterInput>().toEqualTypeOf<FixtureAst>();
  expectTypeOf<ParserOutput>().toExtend<PrinterInput>();
});

test('parser return narrows to AST shape produced by entityTypes factory', () => {
  type ParserOutput = ReturnType<typeof fixturePslBlocks.fixture.parser>;
  type FactoryOutput = ReturnType<typeof fixtureEntityTypes.fixture.output.factory>;

  expectTypeOf<ParserOutput>().toEqualTypeOf<FactoryOutput>();
});

test('parser return extends PslExtensionBlock so it fits the AST extensionBlocks slot', () => {
  type ParserOutput = ReturnType<typeof fixturePslBlocks.fixture.parser>;
  expectTypeOf<ParserOutput>().toExtend<PslExtensionBlock>();
});

test('printer consumes a PslExtensionBlock-extending node via PslExtensionBlockPrinterContext', () => {
  type PrinterFn = typeof fixturePslBlocks.fixture.printer;
  type PrinterInput = Parameters<PrinterFn>[0];
  type PrinterContextArg = Parameters<PrinterFn>[1];
  type PrinterReturn = ReturnType<PrinterFn>;

  expectTypeOf<PrinterInput>().toExtend<PslExtensionBlock>();
  expectTypeOf<PrinterContextArg>().toEqualTypeOf<PslExtensionBlockPrinterContext>();
  expectTypeOf<PrinterReturn>().toEqualTypeOf<string>();
});

test('discriminator strings carry as literal types', () => {
  expectTypeOf<typeof fixturePslBlocks.fixture.discriminator>().toEqualTypeOf<'fixture-block'>();
  expectTypeOf<typeof fixtureEntityTypes.fixture.discriminator>().toEqualTypeOf<'fixture-block'>();
});

// ── Bivariance pin: method declaration is required ─────────────────────────────
//
// `AuthoringPslBlockDescriptor` declares `parser` and `printer` as methods
// (not arrow properties). This matters: TypeScript treats method declarations
// bivariantly, so a concrete descriptor whose `parser`/`printer` are typed
// to a narrower node type (e.g. `FixtureAst` instead of `PslExtensionBlock`)
// can satisfy the base `AuthoringPslBlockDescriptor<PslExtensionBlock>`.
//
// The two tests below pin this:
//  - Positive: a narrow descriptor (method form) assigns to the base — bivariance.
//  - Negative: the same narrow object fails a parallel type that uses arrow
//    properties instead of methods. Under `strictFunctionTypes`, arrow properties
//    are strictly contravariant, so `(node: FixtureAst) => string` cannot satisfy
//    `(node: PslExtensionBlock) => string`. The `@ts-expect-error` below proves
//    the method form on the interface is what grants the assignment.

// A hypothetical version of the descriptor type using arrow properties instead
// of method declarations. Under `strictFunctionTypes`, these are contravariant.
type StrictArrowDescriptor<Node extends PslExtensionBlock = PslExtensionBlock> = {
  readonly kind: 'pslBlock';
  readonly discriminator: string;
  readonly parser: (context: PslExtensionBlockParserContext) => Node;
  readonly printer: (node: Node, context: PslExtensionBlockPrinterContext) => string;
};

// A minimal descriptor with narrower-node methods — structurally the same as
// what `fixturePslBlocks.fixture` provides, but written out explicitly so both
// tests below share a clear, concrete source object.
const narrowMethodDescriptor = {
  kind: 'pslBlock' as const,
  discriminator: 'fixture-block' as const,
  parser(_ctx: PslExtensionBlockParserContext): FixtureAst {
    return {
      kind: 'fixture-block',
      name: '',
      span: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } },
      predicate: '',
    };
  },
  printer(_node: FixtureAst, _ctx: PslExtensionBlockPrinterContext): string {
    return '';
  },
};

test('method-declared printer with narrower node assigns to the base descriptor (bivariance)', () => {
  // A descriptor whose `printer` is a method typed to `FixtureAst` (a subtype of
  // `PslExtensionBlock`) must assign to the base `AuthoringPslBlockDescriptor`.
  // This works because TypeScript treats method declarations bivariantly.
  const _: AuthoringPslBlockDescriptor = narrowMethodDescriptor;
  void _;
});

test('arrow-property printer with narrower node is rejected by a strict arrow-typed descriptor', () => {
  // A value whose printer is an arrow property typed to `FixtureAst` CANNOT
  // satisfy a type that declares `printer` as an arrow property typed to
  // `PslExtensionBlock`. Under `strictFunctionTypes`, arrow properties are
  // strictly contravariant: `(node: FixtureAst) => string` does not cover
  // all `PslExtensionBlock` inputs, so the assignment is a type error.
  //
  // This confirms that the bivariance in the positive test above comes from
  // the method declaration on `AuthoringPslBlockDescriptor`, not from some
  // accidental structural overlap.
  const arrowPrinterObject = {
    kind: 'pslBlock' as const,
    discriminator: 'fixture-block' as const,
    parser: (_ctx: PslExtensionBlockParserContext): FixtureAst => ({
      kind: 'fixture-block',
      name: '',
      span: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 0, line: 1, column: 1 } },
      predicate: '',
    }),
    // Arrow property — strictly contravariant under strictFunctionTypes.
    printer: (_node: FixtureAst, _ctx: PslExtensionBlockPrinterContext): string => '',
  };

  // @ts-expect-error — arrow property `(node: FixtureAst) => string` fails
  // strict contravariance: it cannot handle all `PslExtensionBlock` inputs.
  const _: StrictArrowDescriptor = arrowPrinterObject;
  void _;
});
