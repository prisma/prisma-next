import { Token, TokenType } from './lexer';
import {
  SchemaAST,
  ModelDeclaration,
  FieldDeclaration,
  AttributeDeclaration,
  AttributeArgument,
  RelationFieldType,
} from './ast';

export class Parser {
  private tokens: Token[];
  private position: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private current(): Token | null {
    return this.position < this.tokens.length ? this.tokens[this.position] : null;
  }

  private peek(): Token | null {
    return this.position + 1 < this.tokens.length ? this.tokens[this.position + 1] : null;
  }

  private advance(): Token | null {
    if (this.position < this.tokens.length) {
      this.position++;
    }
    return this.current();
  }

  private expect(type: TokenType): Token {
    const token = this.current();
    if (!token || token.type !== type) {
      throw new Error(
        `Expected ${type}, got ${token?.type || 'EOF'} at position ${token?.position || 'end'}`,
      );
    }
    this.advance();
    return token;
  }

  private match(type: TokenType): boolean {
    const token = this.current();
    if (token && token.type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  parse(): SchemaAST {
    const models: ModelDeclaration[] = [];

    while (this.current() && this.current()!.type !== TokenType.EOF) {
      if (this.current()!.type === TokenType.MODEL) {
        models.push(this.parseModel());
      } else {
        this.advance(); // Skip unknown tokens
      }
    }

    return {
      type: 'Schema',
      models,
    };
  }

  private parseModel(): ModelDeclaration {
    this.expect(TokenType.MODEL);

    const nameToken = this.expect(TokenType.IDENTIFIER);
    const name = nameToken.value;

    this.expect(TokenType.LBRACE);

    const fields: FieldDeclaration[] = [];
    while (this.current() && this.current()!.type !== TokenType.RBRACE) {
      fields.push(this.parseField());
    }

    this.expect(TokenType.RBRACE);

    return {
      type: 'ModelDeclaration',
      name,
      fields,
    };
  }

  private parseField(): FieldDeclaration {
    const nameToken = this.expect(TokenType.IDENTIFIER);
    const name = nameToken.value;

    // Parse field type - can be INT, STRING, BOOLEAN, DATETIME, or relation type
    const fieldType = this.parseFieldType();

    const attributes: AttributeDeclaration[] = [];

    // Parse attributes
    while (this.current() && this.current()!.type === TokenType.AT) {
      attributes.push(this.parseAttribute());
    }

    return {
      type: 'FieldDeclaration',
      name,
      fieldType,
      attributes,
    };
  }

  private parseFieldType(): string | RelationFieldType {
    const currentToken = this.current();
    if (!currentToken) {
      throw new Error('Unexpected end of input while parsing field type');
    }

    // Check if it's a basic type
    if (this.isFieldType(currentToken.type)) {
      this.advance();
      return currentToken.value;
    }

    // Check if it's a relation type (identifier)
    if (currentToken.type === TokenType.IDENTIFIER) {
      const targetModel = currentToken.value;
      this.advance();

      // Check if it's an array type (User[])
      if (this.current() && this.current()!.type === TokenType.LBRACKET) {
        this.advance(); // Skip [
        this.expect(TokenType.RBRACKET); // Expect ]

        return {
          type: 'RelationFieldType',
          targetModel,
          isArray: true,
        };
      }

      // Single relation type (User)
      return {
        type: 'RelationFieldType',
        targetModel,
        isArray: false,
      };
    }

    throw new Error(
      `Expected field type (Int, String, Boolean, DateTime, or relation), got ${currentToken.type}`,
    );
  }

  private isFieldType(tokenType: TokenType): boolean {
    return (
      tokenType === TokenType.INT ||
      tokenType === TokenType.STRING ||
      tokenType === TokenType.BOOLEAN ||
      tokenType === TokenType.DATETIME
    );
  }

  private parseAttribute(): AttributeDeclaration {
    this.expect(TokenType.AT);

    const nameToken = this.expect(TokenType.IDENTIFIER);
    const name = nameToken.value;

    let args: AttributeArgument[] | undefined;

    if (this.match(TokenType.LPAREN)) {
      args = [];

      while (this.current() && this.current()!.type !== TokenType.RPAREN) {
        args.push(this.parseAttributeArgument());

        if (this.current() && this.current()!.type === TokenType.RPAREN) {
          break;
        }
      }

      this.expect(TokenType.RPAREN);
    }

    return {
      type: 'AttributeDeclaration',
      name,
      args,
    };
  }

  private parseAttributeArgument(): AttributeArgument {
    const token = this.current();
    if (!token) {
      throw new Error('Unexpected end of input while parsing attribute argument');
    }

    let value: string | boolean;

    switch (token.type) {
      case TokenType.STRING_LITERAL:
        value = token.value;
        this.advance();
        break;
      case TokenType.BOOLEAN_LITERAL:
        value = token.value === 'true';
        this.advance();
        break;
      case TokenType.IDENTIFIER:
        // Handle special identifiers like 'autoincrement', 'now'
        value = token.value;
        this.advance();

        // Check if this is a function call like autoincrement()
        if (this.current() && this.current()!.type === TokenType.LPAREN) {
          this.advance(); // Skip the opening parenthesis
          // For now, we'll just skip the closing parenthesis
          // In a more complete parser, we'd parse the arguments
          if (this.current() && this.current()!.type === TokenType.RPAREN) {
            this.advance(); // Skip the closing parenthesis
          }
        }
        break;
      default:
        throw new Error(`Unexpected token type ${token.type} in attribute argument`);
    }

    return {
      type: 'AttributeArgument',
      value,
    };
  }
}
