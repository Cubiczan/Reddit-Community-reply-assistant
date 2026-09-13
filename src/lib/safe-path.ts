import path from 'node:path';

/**
 * Resolve a user-supplied path against an allowed base directory and
 * reject anything that escapes that directory (relative `..` or absolute).
 */
export function resolveWithinBase(userPath: string, baseDir: string): string {
  if (typeof userPath !== 'string' || userPath.length === 0) {
    throw new Error('Invalid path');
  }
  if (userPath.includes('\0')) {
    throw new Error('Invalid path');
  }

  let candidate = userPath;
  if (candidate.startsWith('file://')) {
    candidate = candidate.slice('file://'.length);
    if (candidate.startsWith('localhost')) candidate = candidate.slice('localhost'.length);
  }

  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, candidate);
  const relative = path.relative(base, resolved);

  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Path escapes allowed directory: ${userPath}`);
  }

  return resolved;
}
