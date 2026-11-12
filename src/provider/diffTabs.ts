/**
 * VS Code reports the uris of a diff tab only when both sides are plain text editors. With this viewer (a custom editor) on
 * both sides, the tab has no uris: only its label, `<left file name> ↔ <right file name>`, identifies the comparison.
 */
const DIFF_LABEL = /^(.+) ↔ (.+)$/;

/** The file names on the left and right side of a diff tab label, or undefined if the label is not a diff. */
export function parseDiffLabel(label: string): { left: string; right: string } | undefined {
  const match = DIFF_LABEL.exec(label);
  return match ? { left: match[1], right: match[2] } : undefined;
}

export interface DiffSides<T> {
  readonly original: T;
  readonly modified: T;
}

/**
 * Picks the two compared files out of the candidates (open viewers that are not compared yet, in the order they opened).
 * Differing names identify the sides exactly. Equal names (the same file in two folders) leave only the opening order:
 * the side that opened first is the left one. The most recently opened files win, as they belong to the newest diff.
 */
export function pairByLabel<T>(label: string, candidates: readonly T[], nameOf: (candidate: T) => string): DiffSides<T> | undefined {
  const names = parseDiffLabel(label);
  if (!names) {
    return undefined;
  }
  const named = (name: string): T[] => candidates.filter((c) => nameOf(c).toLowerCase() === name.toLowerCase());
  if (names.left.toLowerCase() === names.right.toLowerCase()) {
    const [original, modified] = named(names.left).slice(-2);
    return original !== undefined && modified !== undefined ? { original, modified } : undefined;
  }
  const original = named(names.left).at(-1);
  const modified = named(names.right).at(-1);
  return original !== undefined && modified !== undefined ? { original, modified } : undefined;
}
