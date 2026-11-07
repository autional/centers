import { useMemo, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { Button, Menu, Result, Spin, Tag, Tooltip } from 'antd';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShell, LanguageSwitcher, ThemeToggle, UserMenu } from '@autional/ui';
import type { UserMenuItemSpec } from '@autional/ui';
import { DATA_MODE, ENV_LABEL } from '@/lib/config';
import { store } from '@/lib/data';
import { useSession } from '@/hooks/use-session';
import { ConfigDataProvider, useConfigData } from './config-data';
import { PortalMenu } from '@/components/portal-menu';
import { LoginPage } from './login/page';

export default function Layout() {
  const { ready, session, error, needsLogin, login, logout } = useSession();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }
  // 兜底：任何模式下停在 /oauth/callback（例如 mock 模式手动访问）都回首页
  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/oauth/callback') {
    return <Navigate to="/" replace />;
  }
  if (needsLogin) return <LoginPage error={error} onLogin={() => void login()} />;

  return (
    <ConfigDataProvider enabled>
      <Shell session={session} onLogout={logout} />
    </ConfigDataProvider>
  );
}

function Shell({ session, onLogout }: { session: ReturnType<typeof useSession>['session']; onLogout: () => Promise<void> }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { status, error, reload } = useConfigData();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = useMemo(
    () => [
      { key: '/', label: t('nav.overview') },
      { key: '/domains', label: t('nav.domains') },
      { key: '/changes', label: t('nav.changes') },
      { key: '/changesets', label: t('nav.changesets') },
    ],
    [t],
  );

  const selected = '/' + (location.pathname.split('/')[1] ?? '');

  // 面包屑：只到「域 / 组」两级，够定位且不占地方
  const crumbs = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length === 0) return [];
    if (parts[0] === 'domains') {
      const list = [{ label: t('nav.domains'), to: '/domains' }];
      if (parts[1]) list.push({ label: parts[1], to: `/domains/${encodeURIComponent(parts[1])}` });
      if (parts[2]) list.push({ label: parts[2], to: location.pathname });
      return list;
    }
    if (parts[0] === 'changes') return [{ label: t('nav.changes'), to: '/changes' }];
    if (parts[0] === 'changesets') return [{ label: t('nav.changesets'), to: '/changesets' }];
    return [];
  }, [location.pathname, t]);
  // 跨站入口交给顶栏的门户切换（PortalSwitcher），UserMenu 只保留退出登录，避免同一跳转出现两次
  const userItems: UserMenuItemSpec[] = [{ key: 'logout', type: 'logout', onClick: () => void onLogout() }];

  return (
    <AppShell
      brand={
        <span className="flex min-w-0 items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-6 w-6 shrink-0 rounded" />
          {collapsed ? null : <span className="truncate text-lg font-bold">{t('app.brand')}</span>}
        </span>
      }
      sidebarCollapsed={collapsed}
      nav={
        <Menu
          mode="inline"
          selectedKeys={[selected === '/' ? '/' : selected]}
          items={navItems}
          className="border-r-0"
          onClick={({ key }) => {
            navigate(key);
            setMobileOpen(false);
          }}
        />
      }
      headerLeft={
        <>
          <Button
            type="text"
            className="lg:hidden"
            icon={<PanelLeftOpen size="1em" />}
            onClick={() => setMobileOpen(true)}
            aria-label={t('nav.openMenu')}
          />
          <Button
            type="text"
            className="hidden lg:inline-flex"
            icon={collapsed ? <PanelLeftOpen size="1em" /> : <PanelLeftClose size="1em" />}
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? t('header.expand') : t('header.collapse')}
            aria-expanded={!collapsed}
          />
          <Breadcrumb crumbs={crumbs} />
        </>
      }
      headerRight={
        <>
          <Tooltip title={t('header.envHint')}>
            <Tag color="green">{ENV_LABEL}</Tag>
          </Tooltip>
          <Tag color={store.localWrites ? 'default' : 'blue'}>
            {store.localWrites ? t('header.demoMode') : t('header.apiMode')}
          </Tag>
          <PortalMenu session={session} />
          <LanguageSwitcher />
          <ThemeToggle />
          <UserMenu
            user={
              session
                ? { displayName: session.user.name, email: session.user.email, username: session.user.email }
                : null
            }
            items={userItems}
          />
        </>
      }
      mobileOpen={mobileOpen}
      onMobileClose={() => setMobileOpen(false)}
      closeLabel={t('nav.closeMenu')}
    >
      {status === 'loading' || status === 'idle' ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spin size="large" />
        </div>
      ) : status !== 'ready' ? (
        <Result
          status={status === 'error' ? 'error' : status === 'forbidden' ? '403' : 'warning'}
          title={
            status === 'forbidden'
              ? t('console.forbiddenTitle')
              : status === 'unauthorized'
                ? t('console.unauthorizedTitle')
                : t('console.errorTitle')
          }
          subTitle={error || (status === 'forbidden' ? t('console.forbiddenHint') : '')}
          extra={
            <Button type="primary" onClick={() => void reload()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : (
        <Outlet />
      )}
    </AppShell>
  );
}


function Breadcrumb({ crumbs }: { crumbs: Array<{ label: string; to: string }> }) {
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-sm text-[var(--color-text-secondary)] md:flex">
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.to}-${index}`} className="flex min-w-0 items-center gap-1">
          {index > 0 ? <span className="text-[var(--color-text-muted)]">/</span> : null}
          {index === crumbs.length - 1 ? (
            <span className="truncate text-[var(--color-text-primary)]">{crumb.label}</span>
          ) : (
            <Link to={crumb.to} className="truncate hover:text-[var(--color-text-primary)]">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
