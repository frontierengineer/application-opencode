// A version a person installed is used when it is at least the minimum and
// in the same major version, where nothing it speaks is expected to change.
export function parseVersion(text: string | null): [number, number, number] | null {
  const found = text === null ? null : /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return found ? [Number(found[1]), Number(found[2]), Number(found[3])] : null;
}

export type VersionVerdict = { usable: true } | { usable: false; why: 'unknown' | 'older' | 'newer_major' };

export function judgeVersion(found: string | null, minimum: string): VersionVerdict {
  const have = parseVersion(found);
  const least = parseVersion(minimum);
  if (!have || !least) return { usable: false, why: 'unknown' };
  if (have[0] !== least[0]) return have[0] > least[0] ? { usable: false, why: 'newer_major' } : { usable: false, why: 'older' };
  for (let part = 1; part < 3; part += 1) {
    if (have[part]! > least[part]!) return { usable: true };
    if (have[part]! < least[part]!) return { usable: false, why: 'older' };
  }
  return { usable: true };
}
