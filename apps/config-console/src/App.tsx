import { Route, Routes } from 'react-router';
import Layout from './app/layout';
import OverviewPage from './app/page';
import DomainIndexPage from './app/domains/page';
import DomainDetailPage from './app/domain/page';
import GroupEditorPage from './app/group/page';
import ChangesPage from './app/changes/page';
import ChangesetsPage from './app/changesets/page';
import NotFoundPage from './app/not-found/page';

/**
 * 路由表（history 模式）。旧的 hash 深链由 `LegacyHashRedirect` 在启动时转成 path。
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="domains" element={<DomainIndexPage />} />
        <Route path="domains/:domain" element={<DomainDetailPage />} />
        <Route path="domains/:domain/:group" element={<GroupEditorPage />} />
        <Route path="changes" element={<ChangesPage />} />
        <Route path="changesets" element={<ChangesetsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
