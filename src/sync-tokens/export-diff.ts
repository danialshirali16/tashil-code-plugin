import type { TokenExportDiff } from './types';

export function diffTokenSnapshots(
  previous: Readonly<Record<string, string>> = {},
  current: Readonly<Record<string, string>> = {},
): TokenExportDiff {
  let added = 0;
  let changed = 0;
  let unchanged = 0;
  for (const [id, value] of Object.entries(current)) {
    if (!(id in previous)) added += 1;
    else if (previous[id] === value) unchanged += 1;
    else changed += 1;
  }
  const removed = Object.keys(previous).filter((id) => !(id in current)).length;
  return { added, changed, removed, unchanged };
}
