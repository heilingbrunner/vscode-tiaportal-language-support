/** A match inside a text: start (inclusive) and end (exclusive) offsets. */
export type Range = [number, number];

/** Finds every occurrence of the search term in a text. */
export type Matcher = (text: string) => Range[];

const WORD_CHARS = 'A-Za-z0-9_';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds the matcher for a search term: a case-insensitive literal. An exact match (TIA's "Find exact match") only
 * accepts whole words, so `Motor1` does not find `Motor10`. An empty term has no matcher.
 */
export function compileMatcher(term: string, exact: boolean): Matcher | undefined {
  const needle = term.trim();
  if (needle === '') {
    return undefined;
  }
  const literal = escapeRegExp(needle);
  const pattern = exact ? `(?<![${WORD_CHARS}])${literal}(?![${WORD_CHARS}])` : literal;
  const regex = new RegExp(pattern, 'giu');
  return (text) => [...text.matchAll(regex)].map((m): Range => [m.index, m.index + m[0].length]);
}
