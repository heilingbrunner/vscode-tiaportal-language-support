/** `del`: only in (or changed from) the old version, shown red. `add`: only in (or changed to) the new version, shown green. */
export type DiffMark = 'add' | 'del';

/** One mark per source line (index = line - 1); `undefined` = unchanged. */
export type LineMarks = ReadonlyArray<DiffMark | undefined>;

/** Diff state of an interface row; without `fields` the whole row is added/removed, else only those cells changed. */
export interface MemberDiff {
  mark: DiffMark;
  fields?: string[];
}
