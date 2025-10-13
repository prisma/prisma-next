// Parser functionality
import { Lexer } from '../lexer';
import { Parser } from '../parser';
import { SchemaAST } from '../ast';

export function parse(input: string): SchemaAST {
  const lexer = new Lexer(input);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  return parser.parse();
}
