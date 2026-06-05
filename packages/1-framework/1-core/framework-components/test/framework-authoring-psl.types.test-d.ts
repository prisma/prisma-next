/**
 * End-to-end type narrowing for an extension-contributed PSL block.
 * The test pins the load-bearing property: a contribution literal
 * declared with `as const satisfies` produces a `parser` whose return
 * type is the same AST node shape its own `printer` consumes and its
 * matching `entityTypes` factory accepts. The parser's return is also
 * constrained to extend `PslPackBlock` so the framework AST slot can
 * hold it.
 *
 * Ref: TML-2804.
 */

import { expectTypeOf, test } from 'vitest';
import type {
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockNamespace,
} from '../src/shared/framework-authoring';
import type {
  PslPackBlock,
  PslPackBlockParserContext,
  PslPackBlockPrinterContext,
} from '../src/shared/psl-substrate';

interface FixtureAst extends PslPackBlock {
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
    parser: (ctx: PslPackBlockParserContext): FixtureAst => ({
      kind: 'fixture-block',
      name: ctx.name,
      span: ctx.lineRangeSpan(ctx.bounds.startLine, ctx.bounds.endLine),
      predicate: '',
    }),
    printer: (input: FixtureAst, ctx: PslPackBlockPrinterContext): string =>
      `fixture ${input.name} {\n${ctx.indent}predicate = "${ctx.escapeStringLiteral(input.predicate)}"\n}`,
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

test('parser return extends PslPackBlock so it fits the AST packBlocks slot', () => {
  type ParserOutput = ReturnType<typeof fixturePslBlocks.fixture.parser>;
  expectTypeOf<ParserOutput>().toExtend<PslPackBlock>();
});

test('printer consumes a PslPackBlock-extending node via PslPackBlockPrinterContext', () => {
  type PrinterFn = typeof fixturePslBlocks.fixture.printer;
  type PrinterInput = Parameters<PrinterFn>[0];
  type PrinterContextArg = Parameters<PrinterFn>[1];
  type PrinterReturn = ReturnType<PrinterFn>;

  expectTypeOf<PrinterInput>().toExtend<PslPackBlock>();
  expectTypeOf<PrinterContextArg>().toEqualTypeOf<PslPackBlockPrinterContext>();
  expectTypeOf<PrinterReturn>().toEqualTypeOf<string>();
});

test('discriminator strings carry as literal types', () => {
  expectTypeOf<typeof fixturePslBlocks.fixture.discriminator>().toEqualTypeOf<'fixture-block'>();
  expectTypeOf<typeof fixtureEntityTypes.fixture.discriminator>().toEqualTypeOf<'fixture-block'>();
});
