#!/usr/bin/env node
// Tokenizes sample files with the grammars in ./syntaxes and reports coverage gaps.
//
// Usage: node scripts/tokenize.js [--dir <samples>] [--ext db] [--strict] [--top 25]
//   --dir     directory searched recursively for samples (default: ./test)
//   --ext     file extension and entry grammar: scl | awl | db | udt (default: db)
//   --strict  exit with code 1 when any token has no scope
//   --top     number of rows shown per report section (default: 25)

const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const ROOT = path.resolve(__dirname, '..');
const SYNTAXES = path.join(ROOT, 'syntaxes');
const EXAMPLE_LENGTH = 90;

function parseArgs(argv) {
  const opts = { dir: path.join(ROOT, 'test'), ext: 'db', strict: false, top: 25 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--strict') opts.strict = true;
    else if (arg === '--dir') opts.dir = path.resolve(argv[++i]);
    else if (arg === '--ext') opts.ext = argv[++i].replace(/^\./, '').toLowerCase();
    else if (arg === '--top') opts.top = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

// Grammar scope name -> file, derived from the grammar files themselves.
function loadGrammarIndex() {
  const index = new Map();
  for (const file of fs.readdirSync(SYNTAXES).filter((f) => f.endsWith('.tmLanguage.json'))) {
    const fullPath = path.join(SYNTAXES, file);
    const { scopeName } = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    index.set(scopeName, fullPath);
  }
  return index;
}

function createRegistry(grammarIndex) {
  const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm')).buffer;
  const onigLib = oniguruma.loadWASM(wasm).then(() => ({
    createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
    createOnigString: (text) => new oniguruma.OnigString(text),
  }));
  return new vsctm.Registry({
    onigLib,
    loadGrammar: async (scopeName) => {
      const file = grammarIndex.get(scopeName);
      return file ? vsctm.parseRawGrammar(fs.readFileSync(file, 'utf8'), file) : null;
    },
  });
}

function findFiles(dir, ext) {
  const suffix = `.${ext}`;
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return findFiles(fullPath, ext);
    return entry.name.toLowerCase().endsWith(suffix) ? [fullPath] : [];
  });
}

function record(map, key, sample) {
  const entry = map.get(key);
  if (entry) entry.count++;
  else map.set(key, { count: 1, sample });
}

function tokenizeFiles(grammar, files) {
  const unscoped = new Map();
  const scopes = new Map();
  let lineCount = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    let ruleStack = vsctm.INITIAL;
    text.split(/\r?\n/).forEach((line, index) => {
      lineCount++;
      const result = grammar.tokenizeLine(line, ruleStack);
      ruleStack = result.ruleStack;
      for (const token of result.tokens) {
        const value = line.slice(token.startIndex, token.endIndex);
        if (!value.trim()) continue;
        // scopes[0] is the grammar's root scope, which every token carries.
        const scope = token.scopes.slice(1).join(' ');
        const where = `${path.basename(file)}:${index + 1}  ${line.trim().slice(0, EXAMPLE_LENGTH)}`;
        if (scope) record(scopes, scope, { value, where });
        else record(unscoped, value, { value, where });
      }
    });
  }
  return { unscoped, scopes, lineCount };
}

function printReport({ unscoped, scopes, lineCount }, fileCount, top) {
  const rows = (map) => [...map].sort((a, b) => b[1].count - a[1].count).slice(0, top);

  console.log(`files: ${fileCount}, lines: ${lineCount}`);
  console.log(`\n== Unscoped tokens (${unscoped.size} distinct)`);
  for (const [value, { count, sample }] of rows(unscoped)) {
    console.log(`${count}\t${JSON.stringify(value)}\t${sample.where}`);
  }
  console.log(`\n== Scopes (${scopes.size} distinct)`);
  for (const [scope, { count, sample }] of rows(scopes)) {
    console.log(`${count}\t${scope}\te.g. ${JSON.stringify(sample.value)}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const grammarIndex = loadGrammarIndex();
  const entryScope = `source.tia.${opts.ext}`;
  if (!grammarIndex.has(entryScope)) {
    throw new Error(`No grammar with scopeName "${entryScope}" in ${SYNTAXES}`);
  }
  if (!fs.existsSync(opts.dir)) {
    throw new Error(`Sample directory not found: ${opts.dir} (use --dir)`);
  }
  const files = findFiles(opts.dir, opts.ext);
  if (files.length === 0) {
    throw new Error(`No .${opts.ext} files under ${opts.dir}`);
  }

  const grammar = await createRegistry(grammarIndex).loadGrammar(entryScope);
  const report = tokenizeFiles(grammar, files);
  printReport(report, files.length, opts.top);

  if (opts.strict && report.unscoped.size > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});
