import { Route, Routes } from 'react-router';
import Layout from './app/layout';
import OverviewPage from './app/page';
import DomainsPage from './app/domains/page';
import ChangesPage from './app/changes/page';
import ChangesetsPage from './app/changesets/page';
import NotFoundPage from './app/not-found/page';

/**
 * 路由表。旧的 hash 路由（#/d/:domain/edit/:group 等）由 `useLegacyHashRedirect`
 * 在启动时转成 path，见 src/lib/legacy-hash.ts。
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="domains" element={<DomainsPage />} />
        <Route path="domains/:domain" element={<DomainsPage />} />
        <Route path="changes" element={<ChangesPage />} />
        <Route path="changesets" element={<ChangesetsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
