import { useTranslation } from 'react-i18next';
import { AppPageHeader, EmptyState, SectionCard } from '@autional/ui';

/** M0 占位页：只验证外壳 / 令牌 / 主题 / i18n 链路，M2 逐页替换为真实实现。 */
export function PlaceholderPage({ titleKey, descriptionKey }: { titleKey: string; descriptionKey: string }) {
  const { t } = useTranslation();
  return (
    <>
      <AppPageHeader title={t(titleKey)} description={t(descriptionKey)} />
      <SectionCard>
        <EmptyState
          title={t('common.underConstruction')}
          description={t('common.underConstructionDesc')}
        />
      </SectionCard>
    </>
  );
}
