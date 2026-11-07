import { useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Button, Menu } from 'antd';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppShell, LanguageSwitcher, PortalSwitcher, ThemeToggle } from '@autional/ui';
import type { PortalLink } from '@autional/ui';

/**
 * 应用外壳：结构（侧栏 / sticky 顶栏 / 移动端抽屉 / 内容面板）全部由设计系统的 AppShell 提供，
 * 本站只提供内容——品牌、菜单、右上角控件。顶栏高度因此来自 --layout-header-height。
 */
export default function Layout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
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

  // 二级路径（/domains/foo）仍高亮一级项
  const selected = '/' + (location.pathname.split('/')[1] ?? '');
  const selectedKey = selected === '/' ? '/' : selected;

  // 门户目录在 M2 接入（lib/portal.ts 已有实现，改为喂给 PortalSwitcher）；
  // 现在传空数组：PortalSwitcher 在 ≤1 个门户时不渲染，不会出现空按钮。
  const portals: PortalLink[] = [];

  return (
    <AppShell
      brand={
        <span className="truncate text-lg font-bold">{collapsed ? 'A' : t('app.brand')}</span>
      }
      sidebarCollapsed={collapsed}
      nav={
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
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
          <PortalSwitcher portals={portals} currentPortal="config" />
          <LanguageSwitcher />
          <ThemeToggle />
        </>
      }
      mobileOpen={mobileOpen}
      onMobileClose={() => setMobileOpen(false)}
      closeLabel={t('nav.closeMenu')}
    >
      <Outlet />
    </AppShell>
  );
}
