/**
 * 旧 hash 路由 → 新 path 的兼容映射。
 *
 *   #/                          → /
 *   #/d/<domain>                → /domains/<domain>
 *   #/d/<domain>/edit/<group>   → /domains/<domain>/<group>
 *   #/changes                   → /changes
 *   #/changesets                → /changesets
 *
 * 只在启动时跑一次；无法识别的 hash 原样保留（不猜）。
 */
export function legacyHashToPath(hash: string): string | null {
  const raw = hash.replace(/^#\/?/, '');
  if (!raw) return null;
  const parts = raw.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'changes') return '/changes';
  if (parts[0] === 'changesets') return '/changesets';
  if (parts[0] !== 'd' || !parts[1]) return null;
  const domain = encodeURIComponent(parts[1]);
  if (parts[2] === 'edit' && parts[3]) {
    return `/domains/${domain}/${encodeURIComponent(parts[3])}`;
  }
  return `/domains/${domain}`;
}
