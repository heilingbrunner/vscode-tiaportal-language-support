/** A programming language of a block or network: the drawing language plus whether it is the fail-safe (F) variant. */
export interface LanguageInfo {
  /** `LAD`, `FBD`, `SCL`, ... — what decides how a network is drawn or highlighted. */
  base: string;
  /** F-LAD / F-FBD: the safety-certified variant used in F-blocks. */
  safety: boolean;
}

/** Languages that have a fail-safe variant in TIA Portal. */
const SAFETY_LANGUAGES = new Set(['LAD', 'FBD']);
/** Openness writes `F_LAD` / `F_FBD`; the SD format writes the plain language and flags the block with `S7_Safety`. */
const FAIL_SAFE = /^F[_-]([A-Z]+)$/;

/** Reads the language name of an export (`LAD`, `F_FBD`, `F-LAD`, ...), case-insensitively. */
export function parseLanguage(raw: string, blockIsSafe = false): LanguageInfo {
  const name = raw.trim().toUpperCase();
  const failSafe = FAIL_SAFE.exec(name);
  if (failSafe) {
    return { base: failSafe[1] as string, safety: true };
  }
  return { base: name, safety: blockIsSafe && SAFETY_LANGUAGES.has(name) };
}

/** The name shown to the user: `F-LAD` / `F-FBD` for the fail-safe variants, the plain name otherwise. */
export function displayLanguage({ base, safety }: LanguageInfo): string {
  return safety ? `F-${base}` : base;
}
