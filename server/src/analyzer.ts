/**
 * Semantic analysis of a TTL document.
 *
 * Walks the token stream produced by the lexer and builds:
 *   - a table of user variables (with their first assignment as "definition"),
 *   - a table of labels (definitions and goto/call references),
 *   - a flat list of classified word occurrences for hover / go-to-definition /
 *     find-references / rename,
 *   - diagnostics (unbalanced control blocks, undefined / duplicate labels and
 *     optionally unknown commands).
 */

import {
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range
} from 'vscode-languageserver';
import { Token, TokenKind, tokenize, tokensByLine } from './lexer';
import {
  isCommand,
  isKeyword,
  isOperatorKeyword,
  isSystemVariable,
  LABEL_REFERENCING_KEYWORDS
} from './ttlData';

export enum SymbolKind {
  Variable,
  SystemVariable,
  Label,
  Command,
  Keyword,
  OperatorKeyword
}

export interface Occurrence {
  name: string;
  nameLower: string;
  range: Range;
  /** For variables: an assignment. For labels: a `:label` definition. */
  isDefinition: boolean;
}

export interface VariableSymbol {
  name: string;
  nameLower: string;
  /** First assignment, used as the definition target. */
  definition?: Occurrence;
  occurrences: Occurrence[];
  isSystem: boolean;
}

export interface LabelSymbol {
  name: string;
  nameLower: string;
  definition?: Occurrence;
  occurrences: Occurrence[];
  definitionCount: number;
}

/** A classified token that the cursor can land on. */
export interface WordRef {
  range: Range;
  name: string;
  nameLower: string;
  kind: SymbolKind;
  isDefinition: boolean;
}

export interface AnalyzeOptions {
  reportUnknownCommands: boolean;
  maxProblems: number;
}

export interface Analysis {
  tokens: Token[];
  variables: Map<string, VariableSymbol>;
  labels: Map<string, LabelSymbol>;
  words: WordRef[];
  diagnostics: Diagnostic[];
}

const LABEL_REF_KEYWORDS = new Set(LABEL_REFERENCING_KEYWORDS);

interface StructuralEvent {
  word: string;
  range: Range;
}

export function analyze(text: string, options: AnalyzeOptions): Analysis {
  const tokens = tokenize(text);
  const byLine = tokensByLine(tokens);

  const variables = new Map<string, VariableSymbol>();
  const labels = new Map<string, LabelSymbol>();
  const words: WordRef[] = [];
  const diagnostics: Diagnostic[] = [];
  const structural: StructuralEvent[] = [];

  const addDiagnostic = (range: Range, message: string, severity: DiagnosticSeverity): void => {
    if (diagnostics.length >= options.maxProblems) {
      return;
    }
    diagnostics.push({ range, message, severity, source: 'ttl' });
  };

  const addVariable = (tok: Token, isDefinition: boolean): void => {
    const nameLower = tok.value.toLowerCase();
    const system = isSystemVariable(tok.value);
    const occ: Occurrence = {
      name: tok.value,
      nameLower,
      range: tok.range,
      isDefinition: isDefinition && !system
    };
    let sym = variables.get(nameLower);
    if (!sym) {
      sym = { name: tok.value, nameLower, occurrences: [], isSystem: system };
      variables.set(nameLower, sym);
    }
    sym.occurrences.push(occ);
    if (occ.isDefinition && !sym.definition) {
      sym.definition = occ;
    }
    words.push({
      range: tok.range,
      name: tok.value,
      nameLower,
      kind: system ? SymbolKind.SystemVariable : SymbolKind.Variable,
      isDefinition: occ.isDefinition
    });
  };

  const addLabel = (tok: Token, isDefinition: boolean): void => {
    const nameLower = tok.value.toLowerCase();
    const occ: Occurrence = {
      name: tok.value,
      nameLower,
      range: tok.range,
      isDefinition
    };
    let sym = labels.get(nameLower);
    if (!sym) {
      sym = { name: tok.value, nameLower, occurrences: [], definitionCount: 0 };
      labels.set(nameLower, sym);
    }
    sym.occurrences.push(occ);
    if (isDefinition) {
      sym.definitionCount++;
      if (!sym.definition) {
        sym.definition = occ;
      }
    }
    words.push({
      range: tok.range,
      name: tok.value,
      nameLower,
      kind: SymbolKind.Label,
      isDefinition
    });
  };

  const addKeywordWord = (tok: Token, kind: SymbolKind): void => {
    words.push({
      range: tok.range,
      name: tok.value,
      nameLower: tok.value.toLowerCase(),
      kind,
      isDefinition: false
    });
  };

  // Treat each remaining token of a statement as an expression: identifiers
  // become variable / system-variable references (keywords and commands are
  // recognized so they are not mistaken for variables).
  const classifyExpression = (toks: Token[]): void => {
    for (const tok of toks) {
      if (tok.kind !== TokenKind.Identifier) {
        continue;
      }
      if (isOperatorKeyword(tok.value)) {
        addKeywordWord(tok, SymbolKind.OperatorKeyword);
      } else if (isKeyword(tok.value)) {
        addKeywordWord(tok, SymbolKind.Keyword);
      } else if (isCommand(tok.value)) {
        addKeywordWord(tok, SymbolKind.Command);
      } else {
        addVariable(tok, false);
      }
    }
  };

  for (const [, lineTokens] of byLine) {
    let stmt = lineTokens;

    // Label definition: a ':' that is the first token on the line, followed by
    // an identifier.
    if (
      stmt.length >= 1 &&
      stmt[0].kind === TokenKind.Punctuation &&
      stmt[0].value === ':' &&
      stmt[0].atLineStart
    ) {
      if (stmt.length >= 2 && stmt[1].kind === TokenKind.Identifier) {
        addLabel(stmt[1], true);
        stmt = stmt.slice(2);
      } else {
        stmt = stmt.slice(1);
      }
    }

    if (stmt.length === 0) {
      continue;
    }

    const first = stmt[0];
    if (first.kind !== TokenKind.Identifier) {
      // Lines that do not start with an identifier (rare) – just scan for refs.
      classifyExpression(stmt);
      continue;
    }

    const firstLower = first.value.toLowerCase();
    const second = stmt[1];

    // Assignment: `<var> = <expr>` (a single '=' but not '==').
    if (second && second.kind === TokenKind.Operator && second.value === '=') {
      addVariable(first, true);
      classifyExpression(stmt.slice(2));
      continue;
    }

    // goto / call <label>
    if (LABEL_REF_KEYWORDS.has(firstLower)) {
      addKeywordWord(first, SymbolKind.Keyword);
      if (second && second.kind === TokenKind.Identifier) {
        addLabel(second, false);
        classifyExpression(stmt.slice(2));
      } else {
        classifyExpression(stmt.slice(1));
      }
      continue;
    }

    if (isKeyword(first.value)) {
      addKeywordWord(first, SymbolKind.Keyword);
      recordStructural(stmt, structural);

      if (firstLower === 'for' && second && second.kind === TokenKind.Identifier) {
        // The loop variable is assigned by the `for` statement.
        addVariable(second, true);
        classifyExpression(stmt.slice(2));
      } else {
        classifyExpression(stmt.slice(1));
      }
      continue;
    }

    if (isCommand(first.value)) {
      addKeywordWord(first, SymbolKind.Command);
      classifyExpression(stmt.slice(1));
      continue;
    }

    // Unknown leading identifier: not an assignment, keyword or command.
    if (options.reportUnknownCommands) {
      addDiagnostic(
        first.range,
        `Unknown command or invalid statement: '${first.value}'.`,
        DiagnosticSeverity.Warning
      );
    }
    classifyExpression(stmt.slice(1));
  }

  checkControlFlow(structural, diagnostics, addDiagnostic);
  checkLabels(labels, addDiagnostic);

  return { tokens, variables, labels, words, diagnostics };
}

/** Records a control-flow opener/closer keyword for balance checking. */
function recordStructural(stmt: Token[], structural: StructuralEvent[]): void {
  const first = stmt[0];
  const word = first.value.toLowerCase();
  const STRUCTURAL = new Set([
    'if', 'elseif', 'else', 'endif',
    'while', 'endwhile',
    'for', 'next',
    'do', 'loop',
    'until', 'enduntil'
  ]);
  if (!STRUCTURAL.has(word)) {
    return;
  }
  // A one-line `if <expr> <statement>` (no `then`) opens no block.
  if (word === 'if') {
    const hasThen = stmt.some(
      (t) => t.kind === TokenKind.Identifier && t.value.toLowerCase() === 'then'
    );
    if (!hasThen) {
      return;
    }
  }
  structural.push({ word, range: first.range });
}

type AddDiag = (range: Range, message: string, severity: DiagnosticSeverity) => void;

const CLOSER_OF: Readonly<Record<string, string>> = {
  endif: 'if',
  endwhile: 'while',
  next: 'for',
  loop: 'do',
  enduntil: 'until'
};

function checkControlFlow(
  events: StructuralEvent[],
  _diagnostics: Diagnostic[],
  addDiagnostic: AddDiag
): void {
  const stack: StructuralEvent[] = [];

  for (const ev of events) {
    const w = ev.word;
    if (w === 'if' || w === 'while' || w === 'for' || w === 'do' || w === 'until') {
      stack.push(ev);
    } else if (w === 'elseif' || w === 'else') {
      if (stack.length === 0 || stack[stack.length - 1].word !== 'if') {
        addDiagnostic(ev.range, `'${w}' without matching 'if'.`, DiagnosticSeverity.Error);
      }
    } else {
      const expected = CLOSER_OF[w];
      const top = stack[stack.length - 1];
      if (!top) {
        addDiagnostic(ev.range, `'${w}' without matching '${expected}'.`, DiagnosticSeverity.Error);
      } else if (top.word !== expected) {
        addDiagnostic(
          ev.range,
          `'${w}' does not match the currently open '${top.word}' block.`,
          DiagnosticSeverity.Error
        );
      } else {
        stack.pop();
      }
    }
  }

  for (const open of stack) {
    addDiagnostic(open.range, `'${open.word}' block is never closed.`, DiagnosticSeverity.Error);
  }
}

function checkLabels(labels: Map<string, LabelSymbol>, addDiagnostic: AddDiag): void {
  for (const sym of labels.values()) {
    if (sym.definitionCount === 0) {
      for (const occ of sym.occurrences) {
        addDiagnostic(occ.range, `Undefined label: '${occ.name}'.`, DiagnosticSeverity.Error);
      }
    } else if (sym.definitionCount > 1) {
      for (const occ of sym.occurrences) {
        if (occ.isDefinition) {
          addDiagnostic(occ.range, `Duplicate label definition: '${occ.name}'.`, DiagnosticSeverity.Error);
        }
      }
    }
  }
}

/** Returns the classified word at the given position, if any. */
export function wordAt(analysis: Analysis, position: Position): WordRef | undefined {
  for (const w of analysis.words) {
    if (positionInRange(position, w.range)) {
      return w;
    }
  }
  return undefined;
}

export function positionInRange(pos: Position, range: Range): boolean {
  if (pos.line < range.start.line || pos.line > range.end.line) {
    return false;
  }
  if (pos.line === range.start.line && pos.character < range.start.character) {
    return false;
  }
  if (pos.line === range.end.line && pos.character > range.end.character) {
    return false;
  }
  return true;
}
