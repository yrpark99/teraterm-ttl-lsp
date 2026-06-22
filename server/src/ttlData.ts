/**
 * Static knowledge about the TeraTerm TTL (Tera Term Language) macro language:
 * commands, control keywords, operators and system variables.
 *
 * Sources:
 *   - Syntax:   https://teratermproject.github.io/manual/5/en/macro/syntax/index.html
 *   - Commands: https://teratermproject.github.io/manual/5/en/macro/command/index.html
 */

import { COMMAND_TABLE } from './commandData';

export interface CommandInfo {
  /** Canonical (lower-case) command name. */
  name: string;
  /** Category the command belongs to. */
  category: string;
  /** Syntax / format line(s), as in the official "Format" section. */
  format: string;
  /** Human readable summary distilled from the official "Remarks" section. */
  summary: string;
}

/** Base URL of the per-command online documentation. */
export const COMMAND_DOC_BASE =
  'https://teratermproject.github.io/manual/5/en/macro/command/';

/** Returns the documentation URL for a command. */
export function commandDocUrl(name: string): string {
  return `${COMMAND_DOC_BASE}${name.toLowerCase()}.html`;
}

/**
 * Control-flow keywords. These are *not* commands; they form the structure of
 * the program and have their own grammar handling in the analyzer.
 */
export const KEYWORDS: ReadonlyArray<string> = [
  'if', 'then', 'elseif', 'else', 'endif',
  'for', 'next',
  'while', 'endwhile',
  'do', 'loop', 'until', 'enduntil',
  'break', 'continue',
  'call', 'return', 'goto',
  'include',
  'end', 'exit',
  'pause', 'mpause',
  'execcmnd'
];

/**
 * Human readable descriptions for the control keywords (used by hover).
 *
 * The text follows the "Format" and "Remarks" sections of the official Tera
 * Term command reference (https://teratermproject.github.io/manual/5/en/macro/command/).
 */
export const KEYWORD_DOCS: Readonly<Record<string, string>> = {
  if:
    '**Format 1** (single line)\n```ttl\nif <expression> <statement>\n```\n' +
    '**Format 2** (block)\n```ttl\nif <expression 1> then\n  ...\n[elseif <expression 2> then]\n  ...\n[else]\n  ...\nendif\n```\n' +
    'Format 1 executes `<statement>` if `<expression>` is true (non-zero). ' +
    'In the block form, `if` and `elseif` must end with `then`; `elseif` and `else` may be omitted, but `endif` cannot. ' +
    'The first branch whose expression is true runs; if none are true, the `else` block (if present) runs. ' +
    '_(Tera Term 4.90+: omitting `then` in the block form raises a syntax error.)_',
  then:
    'Ends an `if`/`elseif` condition and introduces its block body: `if <expression> then`. ' +
    'In the block form of `if`, both `if` and `elseif` lines must end with `then`.',
  elseif:
    '```ttl\nelseif <expression> then\n```\n' +
    'Adds another condition to an `if` block. Its body runs when no earlier `if`/`elseif` ' +
    'condition was true and this `<expression>` is true (non-zero). Optional; must end with `then`.',
  else:
    'Introduces the fall-through branch of an `if` block. Its body runs when none of the ' +
    'preceding `if`/`elseif` conditions were true. Optional.',
  endif: 'Ends an `if` block. Required for the block form (`if <expression> then ... endif`) — it cannot be omitted.',
  for:
    '```ttl\nfor <intvar> <first> <last>\n  ...\nnext\n```\n' +
    'Repeats the statements between `for` and `next` until the integer variable `<intvar>` reaches `<last>` at the `next` line. ' +
    '`<intvar>` starts at `<first>`. If `<last> > <first>` it is incremented by 1 at each `next`; ' +
    'if `<last> < <first>` it is decremented by 1.',
  next: 'Ends a `for` loop. At this line the loop variable is incremented (or decremented) by 1 and the loop condition is re-tested.',
  while:
    '```ttl\nwhile <expression>\n  ...\nendwhile\n```\n' +
    'Repeats the statements between `while` and `endwhile` while `<expression>` is non-zero (true).',
  endwhile: 'Ends a `while` loop.',
  do:
    '```ttl\ndo [ { while | until } <expression> ]\n  ...\nloop [ { while | until } <expression> ]\n```\n' +
    'Repeats the statements between `do` and `loop`. A `while <expression>` modifier repeats while the ' +
    'expression is non-zero; an `until <expression>` modifier repeats while the expression is zero. ' +
    'The condition may be placed on the `do` line (tested before the body) or the `loop` line (tested after).',
  loop:
    'Ends a `do` block. May carry a trailing `while <expression>` (repeat while non-zero) or ' +
    '`until <expression>` (repeat while zero) modifier that is evaluated after the body runs.',
  until:
    '```ttl\nuntil <expression>\n  ...\nenduntil\n```\n' +
    'Repeats the statements between `until` and `enduntil` while `<expression>` is zero (i.e. until it becomes true).',
  enduntil: 'Ends an `until` loop.',
  break: 'Quits from a `for` or `while` loop, transferring control to the statement after the loop.',
  continue: 'Transfers control from inside a `for` or `while` loop to the next iteration of that loop, skipping the rest of the current iteration.',
  call:
    '```ttl\ncall <label>\n```\n' +
    'Calls a subroutine beginning at the `<label>` line. Execution resumes at the line after `call` when the subroutine runs `return`.',
  return: 'Exits the subroutine and returns to the line following the `call` that invoked it.',
  goto:
    '```ttl\ngoto <label>\n```\n' +
    'Moves control to the line after `<label>`. Note: `goto` must **not** be used to exit a `for`/`while` loop — use `break` instead.',
  include:
    "```ttl\ninclude '<include file name>'\n```\n" +
    'Loads the specified macro file and interprets it. When that macro ends, execution resumes at the line after `include`. The include nesting level is up to 9.',
  end: 'Quits execution of the macro, and also closes the macro. This is not strictly equivalent to `exit`.',
  exit:
    'In an include file, exits that file and returns to the main file. ' +
    'In the main file it quits execution of the macro (equivalent to `end`).',
  pause:
    '```ttl\npause <time>\n```\n' +
    'Pauses execution for `<time>` seconds.',
  mpause:
    '```ttl\nmpause <time>\n```\n' +
    'Pauses execution for `<time>` milliseconds.',
  execcmnd:
    '```ttl\nexeccmnd <statement>\n```\n' +
    'Executes a TTL statement expressed by the string `<statement>` at run time.'
};

/** Keywords that are followed by a label name (for go-to-definition / completion). */
export const LABEL_REFERENCING_KEYWORDS: ReadonlyArray<string> = ['goto', 'call'];

/**
 * Operator keywords. Per the spec these are *bitwise* operators, not logical
 * ones (the logical operators are the symbols `&&` and `||`).
 */
export const OPERATOR_KEYWORDS: ReadonlyArray<string> = ['and', 'or', 'xor', 'not'];

export const OPERATOR_KEYWORD_DOCS: Readonly<Record<string, string>> = {
  and: 'Bitwise AND operator.',
  or: 'Bitwise OR operator.',
  xor: 'Bitwise exclusive-OR operator.',
  not: 'Bitwise NOT (complement) operator.'
};

export interface SystemVariableInfo {
  name: string;
  type: 'integer' | 'string';
  summary: string;
}

/** Predefined system variables. They cannot be renamed. */
export const SYSTEM_VARIABLES: ReadonlyArray<SystemVariableInfo> = [
  { name: 'inputstr', type: 'string', summary: 'String entered/received by commands such as `inputbox`, `recvln`, `waitln`, `passwordbox`.' },
  { name: 'matchstr', type: 'string', summary: 'The matched string after `wait`, `waitln`, `waitregex` etc.' },
  { name: 'result', type: 'integer', summary: 'Result code returned by many commands (file, network, dialog, `wait`).' },
  { name: 'timeout', type: 'integer', summary: 'Timeout in seconds applied to `wait*`, `connect`, file-transfer and similar commands. 0 = no timeout.' },
  { name: 'mtimeout', type: 'integer', summary: 'Timeout in milliseconds applied to `wait*` commands. 0 = no timeout.' },
  { name: 'param1', type: 'string', summary: 'Macro command-line parameter #1.' },
  { name: 'param2', type: 'string', summary: 'Macro command-line parameter #2.' },
  { name: 'param3', type: 'string', summary: 'Macro command-line parameter #3.' },
  { name: 'param4', type: 'string', summary: 'Macro command-line parameter #4.' },
  { name: 'param5', type: 'string', summary: 'Macro command-line parameter #5.' },
  { name: 'param6', type: 'string', summary: 'Macro command-line parameter #6.' },
  { name: 'param7', type: 'string', summary: 'Macro command-line parameter #7.' },
  { name: 'param8', type: 'string', summary: 'Macro command-line parameter #8.' },
  { name: 'param9', type: 'string', summary: 'Macro command-line parameter #9.' },
  { name: 'params', type: 'string', summary: 'Array of all macro command-line parameters (`params[1]` ...).' },
  { name: 'paramcnt', type: 'integer', summary: 'Number of macro command-line parameters.' },
  { name: 'groupmatchstr1', type: 'string', summary: 'Regex capture group #1 from `waitregex`/`waitln` with regular expressions.' },
  { name: 'groupmatchstr2', type: 'string', summary: 'Regex capture group #2.' },
  { name: 'groupmatchstr3', type: 'string', summary: 'Regex capture group #3.' },
  { name: 'groupmatchstr4', type: 'string', summary: 'Regex capture group #4.' },
  { name: 'groupmatchstr5', type: 'string', summary: 'Regex capture group #5.' },
  { name: 'groupmatchstr6', type: 'string', summary: 'Regex capture group #6.' },
  { name: 'groupmatchstr7', type: 'string', summary: 'Regex capture group #7.' },
  { name: 'groupmatchstr8', type: 'string', summary: 'Regex capture group #8.' },
  { name: 'groupmatchstr9', type: 'string', summary: 'Regex capture group #9.' }
];


/** Map from lower-case command name to its info. */
export const COMMANDS: ReadonlyMap<string, CommandInfo> = new Map(
  COMMAND_TABLE.map(([name, category, format, summary]) => [
    name,
    { name, category, format, summary }
  ])
);

const KEYWORD_SET = new Set(KEYWORDS);
const OPERATOR_KEYWORD_SET = new Set(OPERATOR_KEYWORDS);
const SYSTEM_VARIABLE_MAP = new Map(
  SYSTEM_VARIABLES.map((v) => [v.name, v])
);

export function isCommand(word: string): boolean {
  return COMMANDS.has(word.toLowerCase());
}

export function isKeyword(word: string): boolean {
  return KEYWORD_SET.has(word.toLowerCase());
}

export function isOperatorKeyword(word: string): boolean {
  return OPERATOR_KEYWORD_SET.has(word.toLowerCase());
}

export function isSystemVariable(word: string): boolean {
  return SYSTEM_VARIABLE_MAP.has(word.toLowerCase());
}

export function getSystemVariable(word: string): SystemVariableInfo | undefined {
  return SYSTEM_VARIABLE_MAP.get(word.toLowerCase());
}

export function getCommand(word: string): CommandInfo | undefined {
  return COMMANDS.get(word.toLowerCase());
}

/** A reserved word is anything that is not a user identifier. */
export function isReservedWord(word: string): boolean {
  const w = word.toLowerCase();
  return (
    KEYWORD_SET.has(w) ||
    OPERATOR_KEYWORD_SET.has(w) ||
    COMMANDS.has(w)
  );
}
