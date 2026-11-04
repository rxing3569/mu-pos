export function normalizedPath(path) {
  return path.replace(/\/+$/, '') || '/'
}
