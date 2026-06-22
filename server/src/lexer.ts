/**
 * A small line-oriented tokenizer for TTL.
 *
 * TTL is a line-based, BASIC-like language. The lexer produces a flat list of
 * tokens (with LSP-style line/character ranges) that the analyzer groups back
 * into statements. Comments and strings are recognized so that identifiers
 * appearing inside them are never treated as code.
 */

import { Range } from 'vscode-languageserver';

export enum TokenKind {
  Comment,
  String,
  Number,
  Identifier,
  Operator,
  Punctuation,
  Unknown
}

export interface Token {
  kind: TokenKind;
  /** Raw text of the token. */
  value: string;
  range: Range;
  /** True if this is the first token on its line (ignoring leading spaces). */
  atLineStart: boolean;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const HEX = /[0-9A-Fa-f]/;

// Multi-character operators, longest first so they are matched greedily.
const MULTI_OPERATORS = ['>>>', '<<', '>>', '<>', '<=', '>=', '==', '!=', '&&', '||'];
const SINGLE_OPERATORS = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '&', '|', '^', '~', '!']);

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 0;
  let col = 0;
  let lineHasToken = false;
  const len = text.length;

  const push = (
    kind: TokenKind,
    value: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ): void => {
    tokens.push({
      kind,
      value,
      range: Range.create(startLine, startCol, endLine, endCol),
      atLineStart: !lineHasToken
    });
    lineHasToken = true;
  };

  const newline = (): void => {
    line++;
    col = 0;
    lineHasToken = false;
  };

  while (i < len) {
    const c = text[i];

    // Newlines.
    if (c === '\n') {
      i++;
      newline();
      continue;
    }
    if (c === '\r') {
      i++;
      // A lone '\r' or the '\r' of a '\r\n' pair both end the line.
      if (text[i] === '\n') {
        i++;
      }
      newline();
      continue;
    }

    // Whitespace.
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v') {
      i++;
      col++;
      continue;
    }

    const startLine = line;
    const startCol = col;

    // Line comment: ';' to end of line.
    if (c === ';') {
      let value = '';
      while (i < len && text[i] !== '\n' && text[i] !== '\r') {
        value += text[i];
        i++;
        col++;
      }
      push(TokenKind.Comment, value, startLine, startCol, line, col);
      continue;
    }

    // Block comment: '/* ... */', may span multiple lines.
    if (c === '/' && text[i + 1] === '*') {
      let value = '/*';
      i += 2;
      col += 2;
      while (i < len) {
        if (text[i] === '*' && text[i + 1] === '/') {
          value += '*/';
          i += 2;
          col += 2;
          break;
        }
        if (text[i] === '\n') {
          value += '\n';
          i++;
          line++;
          col = 0;
        } else if (text[i] === '\r') {
          value += text[i];
          i++;
          if (text[i] === '\n') {
            value += '\n';
            i++;
          }
          line++;
          col = 0;
        } else {
          value += text[i];
          i++;
          col++;
        }
      }
      push(TokenKind.Comment, value, startLine, startCol, line, col);
      continue;
    }

    // Strings: single or double quoted. They do not span lines.
    if (c === '"' || c === "'") {
      const quote = c;
      let value = c;
      i++;
      col++;
      while (i < len && text[i] !== '\n' && text[i] !== '\r') {
        value += text[i];
        const closed = text[i] === quote;
        i++;
        col++;
        if (closed) {
          break;
        }
      }
      push(TokenKind.String, value, startLine, startCol, line, col);
      continue;
    }

    // Numeric literals: decimal, '$hex', '#charcode' / '#$hex'.
    if (DIGIT.test(c)) {
      let value = '';
      while (i < len && DIGIT.test(text[i])) {
        value += text[i];
        i++;
        col++;
      }
      push(TokenKind.Number, value, startLine, startCol, line, col);
      continue;
    }
    if (c === '$' && HEX.test(text[i + 1] ?? '')) {
      let value = '$';
      i++;
      col++;
      while (i < len && HEX.test(text[i])) {
        value += text[i];
        i++;
        col++;
      }
      push(TokenKind.Number, value, startLine, startCol, line, col);
      continue;
    }
    if (c === '#') {
      let value = '#';
      i++;
      col++;
      if (text[i] === '$') {
        value += '$';
        i++;
        col++;
        while (i < len && HEX.test(text[i])) {
          value += text[i];
          i++;
          col++;
        }
      } else {
        while (i < len && DIGIT.test(text[i])) {
          value += text[i];
          i++;
          col++;
        }
      }
      push(TokenKind.Number, value, startLine, startCol, line, col);
      continue;
    }

    // Identifiers (variables, commands, keywords, labels names).
    if (IDENT_START.test(c)) {
      let value = '';
      while (i < len && IDENT_PART.test(text[i])) {
        value += text[i];
        i++;
        col++;
      }
      push(TokenKind.Identifier, value, startLine, startCol, line, col);
      continue;
    }

    // Multi-character operators.
    let matchedMulti = false;
    for (const op of MULTI_OPERATORS) {
      if (text.startsWith(op, i)) {
        i += op.length;
        col += op.length;
        push(TokenKind.Operator, op, startLine, startCol, line, col);
        matchedMulti = true;
        break;
      }
    }
    if (matchedMulti) {
      continue;
    }

    // Single-character operators.
    if (SINGLE_OPERATORS.has(c)) {
      i++;
      col++;
      push(TokenKind.Operator, c, startLine, startCol, line, col);
      continue;
    }

    // Everything else is punctuation: ( ) [ ] { } , : etc.
    i++;
    col++;
    push(TokenKind.Punctuation, c, startLine, startCol, line, col);
  }

  return tokens;
}

/** Groups tokens (excluding comments) by their start line. */
export function tokensByLine(tokens: Token[]): Map<number, Token[]> {
  const map = new Map<number, Token[]>();
  for (const tok of tokens) {
    if (tok.kind === TokenKind.Comment) {
      continue;
    }
    const list = map.get(tok.range.start.line);
    if (list) {
      list.push(tok);
    } else {
      map.set(tok.range.start.line, [tok]);
    }
  }
  return map;
}
