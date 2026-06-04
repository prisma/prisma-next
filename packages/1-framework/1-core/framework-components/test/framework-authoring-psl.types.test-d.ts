/**
 * End-to-end type narrowing for a triple-bundle pack contribution
 * (`pslBlocks` + `pslPrinters` + `entityTypes`). The test pins the
 * load-bearing property: a pack literal that declares the matching
 * descriptors with `as const satisfies` produces a parser whose
 * `Output` type is the same AST node shape its printer's `Input`
 * consumes and its factory's `Input` accepts.
 *
 * Ref: TML-2804.
 */

import { expectTypeOf, test } from 'vitest';
import type {
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockNamespace,
  AuthoringPslPrinterNamespace,
} from '../src/shared/framework-authoring';

type FixtureAst = {
  readonly kind: 'fixture-block';
  readonly name: string;
  readonly span: { readonly start: number; readonly end: number };
  readonly predicate: string;
};

type FixtureInput = {
  readonly name: string;
  readonly predicate: string;
};

const fixturePslBlocks = {
  fixture: {
    kind: 'pslBlock',
    discriminator: 'fixture-block',
    parser: (_context: unknown, _bounds: unknown): FixtureAst => ({
      kind: 'fixture-block',
      name: '',
      span: { start: 0, end: 0 },
      predicate: '',
    }),
  },
} as const satisfies AuthoringPslBlockNamespace;

const fixturePslPrinters = {
  fixture: {
    kind: 'pslPrinter',
    discriminator: 'fixture-block',
    printer: (_input: FixtureAst, _context: unknown): void => undefined,
  },
} as const satisfies AuthoringPslPrinterNamespace;

const fixtureEntityTypes = {
  fixture: {
    kind: 'entity',
    discriminator: 'fixture-block',
    output: {
      factory: (_input: FixtureInput): FixtureAst => ({
        kind: 'fixture-block',
        name: '',
        span: { start: 0, end: 0 },
        predicate: '',
      }),
    },
  },
} as const satisfies AuthoringEntityTypeNamespace;

test('parser Output narrows to AST shape consumed by printer Input', () => {
  type ParserOutput = ReturnType<typeof fixturePslBlocks.fixture.parser>;
  type PrinterInput = Parameters<typeof fixturePslPrinters.fixture.printer>[0];

  expectTypeOf<ParserOutput>().toEqualTypeOf<FixtureAst>();
  expectTypeOf<PrinterInput>().toEqualTypeOf<FixtureAst>();
  expectTypeOf<ParserOutput>().toMatchTypeOf<PrinterInput>();
});

test('parser Output narrows to AST shape produced by entityTypes factory', () => {
  type ParserOutput = ReturnType<typeof fixturePslBlocks.fixture.parser>;
  type FactoryOutput = ReturnType<typeof fixtureEntityTypes.fixture.output.factory>;

  expectTypeOf<ParserOutput>().toEqualTypeOf<FactoryOutput>();
});

test('discriminator strings carry as literal types', () => {
  expectTypeOf<typeof fixturePslBlocks.fixture.discriminator>().toEqualTypeOf<'fixture-block'>();
  expectTypeOf<typeof fixturePslPrinters.fixture.discriminator>().toEqualTypeOf<'fixture-block'>();
  expectTypeOf<typeof fixtureEntityTypes.fixture.discriminator>().toEqualTypeOf<'fixture-block'>();
});
