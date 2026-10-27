/** Start values TIA shows (greyed) for variables without an explicit start value. */
const DEFAULTS: Record<string, string> = {
  bool: 'false',
  byte: '16#00',
  word: '16#0000',
  dword: '16#0000_0000',
  lword: '16#0000_0000_0000_0000',
  sint: '0',
  int: '0',
  dint: '0',
  lint: '0',
  usint: '0',
  uint: '0',
  udint: '0',
  ulint: '0',
  real: '0.0',
  lreal: '0.0',
  time: 'T#0ms',
  ltime: 'LT#0ns',
  s5time: 'S5T#0ms',
  date: 'D#1990-01-01',
  time_of_day: 'TOD#00:00:00',
  tod: 'TOD#00:00:00',
  ltime_of_day: 'LTOD#00:00:00.000000000',
  ltod: 'LTOD#00:00:00.000000000',
  date_and_time: 'DT#1990-01-01-00:00:00',
  dt: 'DT#1990-01-01-00:00:00',
  ldt: 'LDT#1970-01-01-00:00:00',
  dtl: 'DTL#1970-01-01-00:00:00',
  char: "''",
  string: "''",
  wstring: "''",
};

/** Default start value for a type as written (`String[40]`, `Int`, ...), or undefined if unknown. */
export function defaultStart(typeText: string): string | undefined {
  const base = typeText.trim().toLowerCase().replace(/[[(].*$/, '');
  return Object.hasOwn(DEFAULTS, base) ? DEFAULTS[base] : undefined;
}
