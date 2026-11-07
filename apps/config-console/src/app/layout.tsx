import { useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Button, Menu, Result, Spin, Tag, Tooltip } from 'antd';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShell, LanguageSwitcher, ThemeToggle, UserMenu } from '@autional/ui';
import type { UserMenuItemSpec } from '@autional/ui';
import { DATA_MODE, ENV_LABEL } from '@/lib/config';
import { store } from '@/lib/data';
import { SECRET_CENTER_URL } from '@/lib/links';
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
  const userItems: UserMenuItemSpec[] = [
    { key: 'secret', type: 'custom', label: t('nav.secretCenter'), href: SECRET_CENTER_URL },
    { key: 'logout', type: 'logout', onClick: () => void onLogout() },
  ];

  return (
    <AppShell
      brand={<span className="truncate text-lg font-bold">{collapsed ? 'A' : t('app.brand')}</span>}
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
