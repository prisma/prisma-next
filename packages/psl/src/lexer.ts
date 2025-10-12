export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

export enum TokenType {
  // Keywords
  MODEL = 'MODEL',

  // Types
  INT = 'INT',
  STRING = 'STRING',
  BOOLEAN = 'BOOLEAN',
  DATETIME = 'DATETIME',

  // Identifiers
  IDENTIFIER = 'IDENTIFIER',

  // Symbols
  LBRACE = 'LBRACE',
  RBRACE = 'RBRACE',
  AT = 'AT',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  EQUALS = 'EQUALS',

  // Literals
  STRING_LITERAL = 'STRING_LITERAL',
  BOOLEAN_LITERAL = 'BOOLEAN_LITERAL',

  // Special
  EOF = 'EOF',
  NEWLINE = 'NEWLINE',
  WHITESPACE = 'WHITESPACE',
}

export class Lexer {
  private input: string;
  private position: number = 0;
  private currentChar: string | null = null;

  constructor(input: string) {
    this.input = input;
    this.currentChar = input[0] || null;
  }

  private advance(): void {
    this.position++;
    this.currentChar = this.position < this.input.length ? this.input[this.position] : null;
  }

  private peek(): string | null {
    const nextPos = this.position + 1;
    return nextPos < this.input.length ? this.input[nextPos] : null;
  }

  private skipWhitespace(): void {
    while (this.currentChar && /\s/.test(this.currentChar)) {
      this.advance();
    }
  }

  private readIdentifier(): string {
    let result = '';
    while (this.currentChar && /[a-zA-Z0-9_]/.test(this.currentChar)) {
      result += this.currentChar;
      this.advance();
    }
    return result;
  }

  private readString(): string {
    let result = '';
    this.advance(); // Skip opening quote
    while (this.currentChar && this.currentChar !== '"') {
      result += this.currentChar;
      this.advance();
    }
    this.advance(); // Skip closing quote
    return result;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.currentChar !== null) {
      this.skipWhitespace();

      if (this.currentChar === null) break;

      const startPos = this.position;

      // Keywords and types
      if (/[a-zA-Z]/.test(this.currentChar)) {
        const identifier = this.readIdentifier();
        const upperIdentifier = identifier.toUpperCase();

        switch (upperIdentifier) {
          case 'MODEL':
            tokens.push({ type: TokenType.MODEL, value: identifier, position: startPos });
            break;
          case 'INT':
            tokens.push({ type: TokenType.INT, value: identifier, position: startPos });
            break;
          case 'STRING':
            tokens.push({ type: TokenType.STRING, value: identifier, position: startPos });
            break;
          case 'BOOLEAN':
            tokens.push({ type: TokenType.BOOLEAN, value: identifier, position: startPos });
            break;
          case 'DATETIME':
            tokens.push({ type: TokenType.DATETIME, value: identifier, position: startPos });
            break;
          case 'TRUE':
          case 'FALSE':
            tokens.push({ type: TokenType.BOOLEAN_LITERAL, value: identifier, position: startPos });
            break;
          default:
            tokens.push({ type: TokenType.IDENTIFIER, value: identifier, position: startPos });
        }
        continue;
      }

      // Symbols
      switch (this.currentChar) {
        case '{':
          tokens.push({ type: TokenType.LBRACE, value: this.currentChar, position: startPos });
          this.advance();
          break;
        case '}':
          tokens.push({ type: TokenType.RBRACE, value: this.currentChar, position: startPos });
          this.advance();
          break;
        case '@':
          tokens.push({ type: TokenType.AT, value: this.currentChar, position: startPos });
          this.advance();
          break;
        case '(':
          tokens.push({ type: TokenType.LPAREN, value: this.currentChar, position: startPos });
          this.advance();
          break;
        case ')':
          tokens.push({ type: TokenType.RPAREN, value: this.currentChar, position: startPos });
          this.advance();
          break;
        case '=':
          tokens.push({ type: TokenType.EQUALS, value: this.currentChar, position: startPos });
          this.advance();
          break;
        case '"':
          const stringValue = this.readString();
          tokens.push({ type: TokenType.STRING_LITERAL, value: stringValue, position: startPos });
          break;
        case '\n':
          tokens.push({ type: TokenType.NEWLINE, value: this.currentChar, position: startPos });
          this.advance();
          break;
        default:
          this.advance(); // Skip unknown characters
      }
    }

    tokens.push({ type: TokenType.EOF, value: '', position: this.position });
    return tokens;
  }
}
