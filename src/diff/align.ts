/** Above this many table cells the middle part of two sequences is not aligned (it is reported as fully changed). */
const MAX_CELLS = 4_000_000;

/** Index pairs `[a, b]` of equal entries along a longest common subsequence; unpaired entries are the changes. */
export function alignSequences(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const head: Array<[number, number]> = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    head.push([start, start]);
    start++;
  }
  const tail: Array<[number, number]> = [];
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    tail.push([endA, endB]);
  }
  const middle = alignMiddle(a, b, start, endA, endB);
  return [...head, ...middle, ...tail.reverse()];
}

function alignMiddle(a: readonly string[], b: readonly string[], start: number, endA: number, endB: number): Array<[number, number]> {
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0 || n * m > MAX_CELLS) {
    return [];
  }
  const width = m + 1;
  // table[i * width + j] = length of the longest common subsequence of a[start + i ..] and b[start + j ..]
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[start + i] === b[start + j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      pairs.push([start + i, start + j]);
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}
