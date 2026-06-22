/**
 * TTL Language Server.
 *
 * Implements completion, diagnostics, find references, go to definition,
 * hover and rename for TeraTerm TTL (.ttl) macro files using the
 * `vscode-languageserver` package.
 */

import {
  CompletionItem,
  CompletionItemKind,
  createConnection,
  Definition,
  Diagnostic,
  DidChangeConfigurationNotification,
  Hover,
  InitializeParams,
  InitializeResult,
  Location,
  MarkupKind,
  PrepareRenameParams,
  ProposedFeatures,
  Range,
  ReferenceParams,
  RenameParams,
  ResponseError,
  ErrorCodes,
  TextDocumentPositionParams,
  TextDocuments,
  TextDocumentSyncKind,
  TextEdit,
  WorkspaceEdit
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { analyze, Analysis, SymbolKind, wordAt } from './analyzer';
import {
  commandDocUrl,
  getCommand,
  getSystemVariable,
  KEYWORD_DOCS,
  KEYWORDS,
  OPERATOR_KEYWORD_DOCS,
  OPERATOR_KEYWORDS,
  SYSTEM_VARIABLES,
  COMMANDS
} from './ttlData';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

interface TtlSettings {
  diagnosticsEnable: boolean;
  reportUnknownCommands: boolean;
  maxNumberOfProblems: number;
}

const DEFAULT_SETTINGS: TtlSettings = {
  diagnosticsEnable: true,
  reportUnknownCommands: true,
  maxNumberOfProblems: 200
};

let globalSettings: TtlSettings = DEFAULT_SETTINGS;
const documentSettings = new Map<string, Thenable<TtlSettings>>();

// Per-document analysis cache keyed by version + settings signature.
interface CacheEntry {
  version: number;
  signature: string;
  analysis: Analysis;
}
const analysisCache = new Map<string, CacheEntry>();

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_IDENTIFIER_LENGTH = 31;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const capabilities = params.capabilities;
  hasConfigurationCapability = !!capabilities.workspace?.configuration;
  hasWorkspaceFolderCapability = !!capabilities.workspace?.workspaceFolders;

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: [' ']
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: {
        prepareProvider: true
      }
    }
  };
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(() => {
      /* nothing to do – diagnostics are per-document */
    });
  }
});

connection.onDidChangeConfiguration((change) => {
  if (hasConfigurationCapability) {
    documentSettings.clear();
  } else {
    const settings = change.settings?.ttl;
    globalSettings = readSettings(settings);
  }
  analysisCache.clear();
  documents.all().forEach(validateTextDocument);
});

function readSettings(raw: any): TtlSettings {
  return {
    diagnosticsEnable: raw?.diagnostics?.enable ?? DEFAULT_SETTINGS.diagnosticsEnable,
    reportUnknownCommands:
      raw?.diagnostics?.reportUnknownCommands ?? DEFAULT_SETTINGS.reportUnknownCommands,
    maxNumberOfProblems: raw?.maxNumberOfProblems ?? DEFAULT_SETTINGS.maxNumberOfProblems
  };
}

function getDocumentSettings(resource: string): Thenable<TtlSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace
      .getConfiguration({ scopeUri: resource, section: 'ttl' })
      .then((raw) => readSettings(raw));
    documentSettings.set(resource, result);
  }
  return result;
}

documents.onDidClose((e) => {
  documentSettings.delete(e.document.uri);
  analysisCache.delete(e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

documents.onDidChangeContent((change) => {
  validateTextDocument(change.document);
});

async function getAnalysis(document: TextDocument, settings: TtlSettings): Promise<Analysis> {
  const signature = `${settings.reportUnknownCommands}:${settings.maxNumberOfProblems}`;
  const cached = analysisCache.get(document.uri);
  if (cached && cached.version === document.version && cached.signature === signature) {
    return cached.analysis;
  }
  const analysis = analyze(document.getText(), {
    reportUnknownCommands: settings.reportUnknownCommands,
    maxProblems: settings.maxNumberOfProblems
  });
  analysisCache.set(document.uri, { version: document.version, signature, analysis });
  return analysis;
}

async function validateTextDocument(document: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(document.uri);
  const analysis = await getAnalysis(document, settings);
  const diagnostics: Diagnostic[] = settings.diagnosticsEnable ? analysis.diagnostics : [];
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

const LABEL_CONTEXT_RE = /(?:^|\s)(goto|call)\s+[A-Za-z0-9_]*$/i;

connection.onCompletion(async (params: TextDocumentPositionParams): Promise<CompletionItem[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  const settings = await getDocumentSettings(document.uri);
  const analysis = await getAnalysis(document, settings);

  const linePrefix = document.getText(
    Range.create(params.position.line, 0, params.position.line, params.position.character)
  );

  // After `goto`/`call`, only labels make sense.
  if (LABEL_CONTEXT_RE.test(linePrefix)) {
    return labelCompletions(analysis);
  }

  const items: CompletionItem[] = [];

  for (const [name, info] of COMMANDS) {
    items.push({
      label: name,
      kind: CompletionItemKind.Function,
      detail: info.category,
      documentation: {
        kind: MarkupKind.Markdown,
        value: '```ttl\n' + info.format + '\n```\n\n' + info.summary
      }
    });
  }
  for (const kw of KEYWORDS) {
    items.push({
      label: kw,
      kind: CompletionItemKind.Keyword,
      detail: 'Control keyword',
      documentation: { kind: MarkupKind.Markdown, value: KEYWORD_DOCS[kw] ?? '' }
    });
  }
  for (const op of OPERATOR_KEYWORDS) {
    items.push({
      label: op,
      kind: CompletionItemKind.Operator,
      detail: 'Operator',
      documentation: { kind: MarkupKind.Markdown, value: OPERATOR_KEYWORD_DOCS[op] ?? '' }
    });
  }
  for (const sv of SYSTEM_VARIABLES) {
    items.push({
      label: sv.name,
      kind: CompletionItemKind.Variable,
      detail: `System variable (${sv.type})`,
      documentation: { kind: MarkupKind.Markdown, value: sv.summary }
    });
  }
  for (const variable of analysis.variables.values()) {
    if (variable.isSystem) {
      continue;
    }
    items.push({
      label: variable.name,
      kind: CompletionItemKind.Variable,
      detail: 'Variable'
    });
  }
  // Labels are also offered generally (e.g. as bare identifiers).
  items.push(...labelCompletions(analysis));

  return items;
});

function labelCompletions(analysis: Analysis): CompletionItem[] {
  const items: CompletionItem[] = [];
  for (const label of analysis.labels.values()) {
    if (label.definitionCount > 0) {
      items.push({
        label: label.name,
        kind: CompletionItemKind.Reference,
        detail: 'Label'
      });
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

connection.onHover(async (params: TextDocumentPositionParams): Promise<Hover | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }
  const settings = await getDocumentSettings(document.uri);
  const analysis = await getAnalysis(document, settings);
  const word = wordAt(analysis, params.position);
  if (!word) {
    return null;
  }

  let value: string | undefined;

  switch (word.kind) {
    case SymbolKind.Command: {
      const info = getCommand(word.name);
      if (info) {
        value =
          `\`${info.name}\` — _${info.category}_\n\n` +
          '```ttl\n' + info.format + '\n```\n\n' +
          `${info.summary}\n\n` +
          `[Documentation](${commandDocUrl(info.name)})`;
      }
      break;
    }
    case SymbolKind.Keyword: {
      const doc = KEYWORD_DOCS[word.nameLower];
      value = `\`${word.nameLower}\` — _Control keyword_` + (doc ? `\n\n${doc}` : '');
      break;
    }
    case SymbolKind.OperatorKeyword: {
      const doc = OPERATOR_KEYWORD_DOCS[word.nameLower];
      value = `\`${word.nameLower}\` — _Operator_` + (doc ? `\n\n${doc}` : '');
      break;
    }
    case SymbolKind.SystemVariable: {
      const info = getSystemVariable(word.name);
      if (info) {
        value = `\`${info.name}\` — _System variable (${info.type})_\n\n${info.summary}`;
      }
      break;
    }
    case SymbolKind.Variable: {
      const sym = analysis.variables.get(word.nameLower);
      const defLine = sym?.definition ? sym.definition.range.start.line + 1 : undefined;
      value =
        `\`${word.name}\` — _Variable_` +
        (defLine ? `\n\nFirst assigned on line ${defLine}.` : '\n\nNot assigned in this file.');
      break;
    }
    case SymbolKind.Label: {
      const sym = analysis.labels.get(word.nameLower);
      const defLine = sym?.definition ? sym.definition.range.start.line + 1 : undefined;
      value =
        `\`:${word.name}\` — _Label_` +
        (defLine ? `\n\nDefined on line ${defLine}.` : '\n\nNot defined in this file.');
      break;
    }
  }

  if (!value) {
    return null;
  }
  return {
    contents: { kind: MarkupKind.Markdown, value },
    range: word.range
  };
});

// ---------------------------------------------------------------------------
// Go to definition
// ---------------------------------------------------------------------------

connection.onDefinition(async (params: TextDocumentPositionParams): Promise<Definition | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }
  const settings = await getDocumentSettings(document.uri);
  const analysis = await getAnalysis(document, settings);
  const word = wordAt(analysis, params.position);
  if (!word) {
    return null;
  }

  if (word.kind === SymbolKind.Variable) {
    const sym = analysis.variables.get(word.nameLower);
    if (sym?.definition) {
      return Location.create(document.uri, sym.definition.range);
    }
  } else if (word.kind === SymbolKind.Label) {
    const sym = analysis.labels.get(word.nameLower);
    if (sym?.definition) {
      return Location.create(document.uri, sym.definition.range);
    }
  }
  return null;
});

// ---------------------------------------------------------------------------
// Find references
// ---------------------------------------------------------------------------

connection.onReferences(async (params: ReferenceParams): Promise<Location[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  const settings = await getDocumentSettings(document.uri);
  const analysis = await getAnalysis(document, settings);
  const word = wordAt(analysis, params.position);
  if (!word) {
    return [];
  }

  const includeDeclaration = params.context?.includeDeclaration ?? true;

  if (
    word.kind === SymbolKind.Variable ||
    word.kind === SymbolKind.SystemVariable
  ) {
    const sym = analysis.variables.get(word.nameLower);
    if (!sym) {
      return [];
    }
    return sym.occurrences
      .filter((o) => includeDeclaration || !o.isDefinition)
      .map((o) => Location.create(document.uri, o.range));
  }

  if (word.kind === SymbolKind.Label) {
    const sym = analysis.labels.get(word.nameLower);
    if (!sym) {
      return [];
    }
    return sym.occurrences
      .filter((o) => includeDeclaration || !o.isDefinition)
      .map((o) => Location.create(document.uri, o.range));
  }

  return [];
});

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

connection.onPrepareRename(async (params: PrepareRenameParams): Promise<Range | ResponseError<void>> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return new ResponseError(ErrorCodes.InvalidParams, 'Document not found.');
  }
  const settings = await getDocumentSettings(document.uri);
  const analysis = await getAnalysis(document, settings);
  const word = wordAt(analysis, params.position);

  if (!word || (word.kind !== SymbolKind.Variable && word.kind !== SymbolKind.Label)) {
    return new ResponseError(
      ErrorCodes.InvalidRequest,
      'Only user-defined variables and labels can be renamed.'
    );
  }
  return word.range;
});

connection.onRenameRequest(async (params: RenameParams): Promise<WorkspaceEdit | ResponseError<void>> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return new ResponseError(ErrorCodes.InvalidParams, 'Document not found.');
  }
  const newName = params.newName.trim();
  if (!IDENTIFIER_RE.test(newName) || newName.length > MAX_IDENTIFIER_LENGTH) {
    return new ResponseError(
      ErrorCodes.InvalidParams,
      `'${params.newName}' is not a valid TTL identifier (letters, digits and '_', starting with a letter or '_', max ${MAX_IDENTIFIER_LENGTH} characters).`
    );
  }

  const settings = await getDocumentSettings(document.uri);
  const analysis = await getAnalysis(document, settings);
  const word = wordAt(analysis, params.position);
  if (!word) {
    return new ResponseError(ErrorCodes.InvalidRequest, 'Nothing to rename here.');
  }

  let ranges: Range[] = [];
  if (word.kind === SymbolKind.Variable) {
    ranges = analysis.variables.get(word.nameLower)?.occurrences.map((o) => o.range) ?? [];
  } else if (word.kind === SymbolKind.Label) {
    ranges = analysis.labels.get(word.nameLower)?.occurrences.map((o) => o.range) ?? [];
  } else {
    return new ResponseError(
      ErrorCodes.InvalidRequest,
      'Only user-defined variables and labels can be renamed.'
    );
  }

  const edits = ranges.map((range) => TextEdit.replace(range, newName));
  return { changes: { [document.uri]: edits } };
});

documents.listen(connection);
connection.listen();
