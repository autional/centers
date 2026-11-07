import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { registerUiI18n } from '@autional/ui/i18n';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

/**
 * 区域默认语言：.com → en，其余（.cn / localhost）→ zh。
 * 与其它控制台一致：com/cn 同一份源，语言只由域名决定；用户手动切换后写 localStorage。
 */
export const DEFAULT_LOCALE: 'zh-CN' | 'en-US' =
  typeof window !== 'undefined' && window.location.hostname.endsWith('.com') ? 'en-US' : 'zh-CN';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { 'zh-CN': { translation: zhCN }, 'en-US': { translation: enUS } },
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: ['zh-CN', 'en-US'],
    // 资源是扁平点号 key（"nav.overview"），不是嵌套路径
    keySeparator: false,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
      lookupLocalStorage: 'config-console-lang',
    },
  });

registerUiI18n(i18n);

const TITLES: Record<string, string> = {
  'zh-CN': '配置中心 · Config Console',
  'en-US': 'Autional Config Console',
};

/** 同步 <html lang> 与 document.title（a11y：声明语言必须与正文一致）。 */
const syncDocument = () => {
  if (typeof document === 'undefined') return;
  const lang = i18n.language || DEFAULT_LOCALE;
  document.documentElement.lang = lang;
  document.title = TITLES[lang] ?? TITLES[DEFAULT_LOCALE];
};

i18n.on('languageChanged', syncDocument);
if (i18n.isInitialized) syncDocument();
else i18n.on('initialized', syncDocument);

export default i18n;
