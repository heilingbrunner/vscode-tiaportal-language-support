import * as oniguruma from 'vscode-oniguruma';
import * as textmate from 'vscode-textmate';
import type { BlockModel, CodeToken } from '../model/types';

export type HighlightLanguage = 'scl' | 'awl';

const SCOPE_NAMES: Record<HighlightLanguage, string> = {
  scl: 'source.tia.scl',
  awl: 'source.tia.awl',
};
/**
 * Lines fed to the grammar before the code: the AWL grammar only recognises instructions after it has
 * seen `BEGIN`, and a network's lines are tokenized without the block header.
 */
const PREAMBLES: Record<HighlightLanguage, readonly string[]> = {
  scl: [],
  awl: ['BEGIN'],
};
const MAX_LINES = 50_000;
/** Per-line tokenizing budget in milliseconds; a line that exceeds it is shown unhighlighted. */
const LINE_TIME_LIMIT_MS = 100;

export interface HighlighterLoaders {
  /** Grammar source for a language; the AWL grammar includes the SCL grammar (comments, strings, symbols). */
  readGrammar(language: HighlightLanguage): Promise<string>;
  readWasm(): Promise<ArrayBuffer>;
}

export interface SclHighlighter {
  /** One token list per input line; the tokens of a line always concatenate to the line. */
  tokenize(lines: readonly string[]): CodeToken[][];
}

/** The highlighters available to a view: `scl` for SCL code, `awl` for STL networks. */
export interface HighlighterSet {
  scl?: SclHighlighter;
  awl?: SclHighlighter;
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
  ['keyword.operator.logical', 'c-instruction'],
  ['keyword.operator', 'c-operator'],
  ['keyword.other', 'c-keyword'],
  ['support.function.instruction', 'c-instruction'],
  ['storage', 'c-type'],
  ['entity.name.type', 'c-type'],
  ['entity.name.label', 'c-label'],
  ['constant.numeric', 'c-number'],
  ['constant.language', 'c-constant'],
  ['variable.other.absolute', 'c-absolute'],
  ['variable.language.register', 'c-absolute'],
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

/** Creates a highlighter from one of the repo's grammars; loaders are injected so it runs in tests and in the extension. */
export async function createHighlighter(language: HighlightLanguage, loaders: HighlighterLoaders): Promise<SclHighlighter> {
  wasmReady ??= loaders.readWasm().then((data) => oniguruma.loadWASM(data));
  try {
    await wasmReady;
  } catch (error: unknown) {
    wasmReady = undefined;
    throw error;
  }
  const scopeName = SCOPE_NAMES[language];
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text: string) => new oniguruma.OnigString(text),
    }),
    loadGrammar: async (name: string) => {
      const requested = (Object.keys(SCOPE_NAMES) as HighlightLanguage[]).find((l) => SCOPE_NAMES[l] === name);
      return requested
        ? textmate.parseRawGrammar(await loaders.readGrammar(requested), `${requested}.tmLanguage.json`)
        : null;
    },
  });
  const grammar = await registry.loadGrammar(scopeName);
  if (!grammar) {
    throw new Error(`The ${language.toUpperCase()} grammar could not be loaded`);
  }
  return {
    tokenize(lines) {
      let stack: textmate.StateStack = textmate.INITIAL;
      for (const line of PREAMBLES[language]) {
        stack = grammar.tokenizeLine(line, stack).ruleStack;
      }
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

export const createSclHighlighter = (loaders: HighlighterLoaders): Promise<SclHighlighter> => createHighlighter('scl', loaders);
export const createAwlHighlighter = (loaders: HighlighterLoaders): Promise<SclHighlighter> => createHighlighter('awl', loaders);

/** Returns a copy of the model whose code and code networks carry highlight tokens (SCL or STL as appropriate). */
export function withHighlighting(model: BlockModel, highlighters: HighlighterSet): BlockModel {
  const code =
    model.code && highlighters.scl ? { ...model.code, tokens: highlighters.scl.tokenize(model.code.lines) } : model.code;
  const networks = model.networks.map((network) => {
    const { body } = network;
    if (body.kind !== 'code') {
      return network;
    }
    const highlighter = body.language === 'STL' ? highlighters.awl : highlighters.scl;
    return highlighter ? { ...network, body: { ...body, tokens: highlighter.tokenize(body.lines) } } : network;
  });
  return { ...model, code, networks };
}
