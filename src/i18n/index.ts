/**
 * i18next 国际化配置
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import en from './locales/en.json';
import ru from './locales/ru.json';
import zhCNLocal from './locales/zh-CN-local.json';
import enLocal from './locales/en-local.json';
import ruLocal from './locales/ru-local.json';
import { getInitialLanguage } from '@/utils/language';

type Messages = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Messages =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// 深合并：*-local.json 里的 nav / common 等命名空间只补充键，不整体覆盖官方文案
const mergeMessages = (base: Messages, override: Messages): Messages => {
  const result: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] =
      isPlainObject(current) && isPlainObject(value) ? mergeMessages(current, value) : value;
  }
  return result;
};

// *-local.json：监控中心等本地扩展页面的文案，覆盖在官方文案之上
i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: mergeMessages(zhCN, zhCNLocal) },
    'zh-TW': { translation: mergeMessages(zhTW, zhCNLocal) },
    en: { translation: mergeMessages(en, enLocal) },
    ru: { translation: mergeMessages(ru, ruLocal) },
  },
  lng: getInitialLanguage(),
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false, // React 已经转义
  },
  react: {
    useSuspense: false,
  },
});

export default i18n;
