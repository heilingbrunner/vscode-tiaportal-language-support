import * as oniguruma from 'vscode-oniguruma';
import * as textmate from 'vscode-textmate';
import type { BlockModel, CodeToken } from '../model/types';

const SCOPE_NAME = 'source.tia.scl';
const MAX_LINES = 50_000;
/** Per-line tokenizing budget in milliseconds; a line that exceeds it is shown unhighlighted. */
const LINE_TIME_LIMIT_MS = 100;

export interface HighlighterLoaders {
  readGrammar(): Promise<string>;
  readWasm(): Promise<ArrayBuffer>;
}

export interface SclHighlighter {
  /** One token list per input line; the tokens of a line always concatenate to the line. */
  tokenize(lines: readonly string[]): CodeToken[][];
}

/** First matching rule wins; scopes are checked from the most specific (last) one. */
const CLASS_RULES: Array<[prefix: string, cls: string]> = [
  ['comment', 'c-comment'],
  ['string', 'c-string'],
  ['keyword.control.region', 'c-region'],
  ['keyword.control', 'c-keyword'],
  ['keyword.other.pragma', 'c-pragma'],
  ['meta.pragma', 'c-pragma'],
  ['keyword.operator.word', 'c-keyword'],
  ['keyword.operator', 'c-operator'],
  ['keyword.other', 'c-keyword'],
  ['storage', 'c-type'],
  ['entity.name.type', 'c-type'],
  ['constant.numeric', 'c-number'],
  ['constant.language', 'c-constant'],
  ['variable.other.local', 'c-local'],
  ['variable.other.global', 'c-global'],
  ['variable.parameter', 'c-param'],
  ['variable.other.member', 'c-member'],
  ['support.function', 'c-function'],
  ['entity.name.function', 'c-function'],
];

export function classify(scopes: readonly string[]): string {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i] as string;
    const rule = CLASS_RULES.find(([prefix]) => scope.startsWith(prefix));
    if (rule) {
      return rule[1];
    }
  }
  return '';
}

const plain = (line: string): CodeToken[] => (line === '' ? [] : [{ text: line, cls: '' }]);

function tokenizeLine(grammar: textmate.IGrammar, line: string, stack: textmate.StateStack): { tokens: CodeToken[]; stack: textmate.StateStack } {
  const result = grammar.tokenizeLine(line, stack, LINE_TIME_LIMIT_MS);
  if (result.stoppedEarly) {
    return { tokens: plain(line), stack: result.ruleStack };
  }
  const tokens: CodeToken[] = [];
  for (const token of result.tokens) {
    const text = line.slice(token.startIndex, Math.min(token.endIndex, line.length));
    if (text === '') {
      continue;
    }
    const cls = classify(token.scopes);
    const last = tokens[tokens.length - 1];
    if (last && last.cls === cls) {
      last.text += text;
    } else {
      tokens.push({ text, cls });
    }
  }
  // the invariant the renderer relies on: no text may be lost or invented
  return { tokens: tokens.map((t) => t.text).join('') === line ? tokens : plain(line), stack: result.ruleStack };
}

let wasmReady: Promise<void> | undefined;

/** Creates a highlighter from the repo's SCL grammar; loaders are injected so it runs in tests and in the extension. */
export async function createSclHighlighter(loaders: HighlighterLoaders): Promise<SclHighlighter> {
  wasmReady ??= loaders.readWasm().then((data) => oniguruma.loadWASM(data));
  try {
    await wasmReady;
  } catch (error: unknown) {
    wasmReady = undefined;
    throw error;
  }
  const grammarText = await loaders.readGrammar();
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text: string) => new oniguruma.OnigString(text),
    }),
    loadGrammar: async (scopeName: string) =>
      scopeName === SCOPE_NAME ? textmate.parseRawGrammar(grammarText, 'scl.tmLanguage.json') : null,
  });
  const grammar = await registry.loadGrammar(SCOPE_NAME);
  if (!grammar) {
    throw new Error('The SCL grammar could not be loaded');
  }
  return {
    tokenize(lines) {
      let stack: textmate.StateStack = textmate.INITIAL;
      return lines.map((line, i) => {
        if (i >= MAX_LINES) {
          return plain(line);
        }
        const result = tokenizeLine(grammar, line, stack);
        stack = result.stack;
        return result.tokens;
      });
    },
  };
}

/** Returns a copy of the model whose code carries highlight tokens. */
export function withHighlighting(model: BlockModel, highlighter: SclHighlighter): BlockModel {
  return model.code ? { ...model, code: { ...model.code, tokens: highlighter.tokenize(model.code.lines) } } : model;
}
