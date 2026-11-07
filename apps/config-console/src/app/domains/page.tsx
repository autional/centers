import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AppPageHeader } from '@autional/ui';
import { PageSection } from '@/components/page-section';
import { useConfigData } from '../config-data';

/** 配置域索引：域只用于导航与统计，编辑入口在组。 */
export default function DomainIndexPage() {
  const { t } = useTranslation();
  const { meta } = useConfigData();

  return (
    <>
      <AppPageHeader title={t('domains.title')} description={t('domains.description')} />
      <PageSection >
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {meta.domains.map((domain) => (
            <li key={domain.name}>
              <Link
                to={`/domains/${encodeURIComponent(domain.name)}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--color-bg-muted)]"
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
                  style={{ background: domain.color }}
                >
                  {domain.mono}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-[var(--color-text-primary)]">{domain.name}</div>
                  <div className="truncate text-xs text-[var(--color-text-secondary)]">{domain.desc}</div>
                </div>
                <div className="hidden gap-4 text-xs text-[var(--color-text-secondary)] sm:flex">
                  <span>{t('overview.itemsUnit')} {domain.count}</span>
                  <span>{t('overview.groupCount', { count: domain.groups.length })}</span>
                  <span>{t('overview.svcCount', { count: domain.svc })}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </PageSection>
    </>
  );
}
