#!/usr/bin/env node
/*
 * Generates server/src/commandData.ts from the per-category JSON source files
 * in scripts/command-data/.
 *
 * The JSON files map each TTL command name to {"format": "...", "summary": "..."},
 * where "format" and "summary" are distilled from the "Format" and "Remarks"
 * sections of the official Tera Term command reference:
 *   https://teratermproject.github.io/manual/5/en/macro/command/
 *
 * To change a command's documentation, edit the JSON source and re-run:
 *   npm run gen:commands
 *
 * Usage: node scripts/gen-commands.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'command-data');
const OUT_FILE = path.join(__dirname, '..', 'server', 'src', 'commandData.ts');

const load = (file) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));

const data = Object.assign(
  {},
  load('communication.json'),
  load('string-password.json'),
  load('file.json'),
  load('misc.json')
);

// Command names per category, in display order. This is the source of truth for
// which commands exist and how they are grouped.
const COMMUNICATION = [
  'bplusrecv', 'bplussend', 'callmenu', 'changedir', 'clearscreen', 'closett', 'connect',
  'cygconnect', 'disconnect', 'dispstr', 'enablekeyb', 'flushrecv', 'gethostname',
  'getmodemstatus', 'gettitle', 'getttpos', 'kmtfinish', 'kmtget', 'kmtrecv', 'kmtsend',
  'loadkeymap', 'logautoclosemode', 'logclose', 'loginfo', 'logopen', 'logpause',
  'logrotate', 'logstart', 'logwrite', 'quickvanrecv', 'quickvansend', 'recvln', 'recvfile',
  'restoresetup', 'scprecv', 'scpsend', 'send', 'sendbinary', 'sendbreak', 'sendbroadcast',
  'sendfile', 'sendkcode', 'sendln', 'sendlnbroadcast', 'sendlnmulticast', 'sendmulticast',
  'sendtext', 'setbaud', 'setdebug', 'setdtr', 'setecho', 'setflowctrl', 'setmulticastname',
  'setrts', 'setserialdelaychar', 'setserialdelayline', 'setspeed', 'setsync', 'settitle',
  'showtt', 'testlink', 'unlink', 'wait', 'wait4all', 'waitevent', 'waitln', 'waitn',
  'waitrecv', 'waitregex', 'xmodemrecv', 'xmodemsend', 'ymodemrecv', 'ymodemsend',
  'zmodemrecv', 'zmodemsend'
];
const STRING = [
  'code2str', 'expandenv', 'int2str', 'regexoption', 'sprintf', 'sprintf2', 'str2code',
  'str2int', 'strcompare', 'strconcat', 'strcopy', 'strinsert', 'strjoin', 'strlen',
  'strmatch', 'strremove', 'strreplace', 'strscan', 'strspecial', 'strsplit', 'strtrim',
  'tolower', 'toupper'
];
const FILE = [
  'basename', 'dirname', 'fileclose', 'fileconcat', 'filecopy', 'filecreate', 'filedelete',
  'filelock', 'filemarkptr', 'fileopen', 'fileread', 'filereadln', 'filerename', 'filesearch',
  'fileseek', 'fileseekback', 'filestat', 'filestrseek', 'filestrseek2', 'filetruncate',
  'fileunlock', 'filewrite', 'filewriteln', 'findfirst', 'findnext', 'findclose',
  'foldercreate', 'folderdelete', 'foldersearch', 'getdir', 'getfileattr', 'makepath',
  'setdir', 'setfileattr'
];
const PASSWORD = [
  'delpassword', 'delpassword2', 'getpassword', 'getpassword2', 'ispassword', 'ispassword2',
  'passwordbox', 'setpassword', 'setpassword2'
];
const MISC = [
  'beep', 'bringupbox', 'checksum8', 'checksum8file', 'checksum16', 'checksum16file',
  'checksum32', 'checksum32file', 'clipb2var', 'closesbox', 'crc16', 'crc16file', 'crc32',
  'crc32file', 'dirnamebox', 'exec', 'filenamebox', 'getdate', 'getenv', 'getipv4addr',
  'getipv6addr', 'getspecialfolder', 'gettime', 'getttdir', 'getver', 'ifdefined', 'inputbox',
  'intdim', 'listbox', 'messagebox', 'random', 'rotateleft', 'rotateright', 'setdate',
  'setdlgpos', 'setenv', 'setexitcode', 'settime', 'show', 'statusbox', 'strdim', 'uptime',
  'var2clipb', 'yesnobox'
];

const groups = [
  ['Communication command', COMMUNICATION],
  ['String operation command', STRING],
  ['File operation command', FILE],
  ['Password command', PASSWORD],
  ['Miscellaneous command', MISC]
];

const missing = [];
const rows = [];
for (const [category, names] of groups) {
  for (const name of names) {
    const info = data[name];
    if (!info) {
      missing.push(name);
      continue;
    }
    rows.push([name, category, info.format || name, info.summary || '']);
  }
}

if (missing.length) {
  console.error('ERROR: no source data for: ' + missing.join(', '));
  process.exit(1);
}

// Report any source entries that are not listed in a category (typos / extras).
const known = new Set(rows.map((r) => r[0]));
const extra = Object.keys(data).filter((name) => !known.has(name));
if (extra.length) {
  console.error('ERROR: source data has unlisted commands: ' + extra.join(', '));
  process.exit(1);
}

let out = '';
out += '/**\n';
out += ' * Auto-generated TTL command metadata (name, category, format, summary).\n';
out += ' *\n';
out += ' * The "format" and "summary" text is distilled from the "Format" and "Remarks"\n';
out += ' * sections of the official Tera Term command reference:\n';
out += ' *   https://teratermproject.github.io/manual/5/en/macro/command/\n';
out += ' *\n';
out += ' * DO NOT EDIT BY HAND. Edit scripts/command-data/*.json and run:\n';
out += ' *   npm run gen:commands\n';
out += ' */\n\n';
out += '/** [name, category, format, summary] */\n';
out += 'export type CommandTableEntry = [string, string, string, string];\n\n';
out += 'export const COMMAND_TABLE: ReadonlyArray<CommandTableEntry> = [\n';
for (const [name, category, format, summary] of rows) {
  out +=
    '  [' +
    JSON.stringify(name) + ', ' +
    JSON.stringify(category) + ', ' +
    JSON.stringify(format) + ', ' +
    JSON.stringify(summary) +
    '],\n';
}
out += '];\n';

fs.writeFileSync(OUT_FILE, out);
console.log('Generated ' + rows.length + ' commands -> ' + path.relative(path.join(__dirname, '..'), OUT_FILE));
