import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import zhTranslation from './locales/zh.json';
import enTranslation from './locales/en.json';
import storage from './utils/storage';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: enTranslation },
      zh: { translation: zhTranslation }
    },
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: storage.getRawKey('i18nextLng'),
      caches: ['localStorage']
    }
  });

export default i18n;
