const WORD_RUN = /[A-Za-z0-9_]+/g;

/**
 * The longest run of identifier characters in a search term. Every text that contains the term contains this run,
 * and a source file keeps such a run in one piece, which makes it a safe test for "can this file match at all".
 */
export function longestWordRun(term: string): string {
  return (term.match(WORD_RUN) ?? []).reduce((longest, run) => (run.length > longest.length ? run : longest), '');
}

/** Whether a file's raw text can contain a hit for a term whose longest word run is `run` (an empty run rules nothing out). */
export function mayContain(raw: string, run: string): boolean {
  return run === '' || raw.toLowerCase().includes(run.toLowerCase());
}
