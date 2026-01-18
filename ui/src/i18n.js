import { invoke } from '@tauri-apps/api/core';

let currentLocale = 'en';
let translations = {};

// Initialize i18n
export async function initI18n() {
  try {
    // Get the locale from the backend or use system locale
    const locale = await invoke('get_locale') || 'en';
    currentLocale = locale;
    
    // Load translations for the current locale
    await loadTranslations(currentLocale);
    
    return currentLocale;
  } catch (error) {
    console.error('Failed to initialize i18n:', error);
    currentLocale = 'en';
    await loadTranslations('en');
    return 'en';
  }
}

// Load translations for a specific locale
export async function loadTranslations(locale) {
  try {
    translations = await invoke('load_translations', { locale });
    currentLocale = locale;
  } catch (error) {
    console.error(`Failed to load translations for ${locale}:`, error);
    // Fallback to English
    if (locale !== 'en') {
      translations = await invoke('load_translations', { locale: 'en' });
      currentLocale = 'en';
    }
  }
}

// Get translation for a key
export function t(key, params = {}) {
  const keys = key.split('.');
  let value = translations;
  
  for (const k of keys) {
    value = value?.[k];
    if (value === undefined) {
      console.warn(`Translation key not found: ${key}`);
      return key; // Return the key as fallback
    }
  }
  
  // Replace parameters in the translation string
  if (typeof value === 'string' && Object.keys(params).length > 0) {
    return value.replace(/\{\{(\w+)\}\}/g, (match, param) => params[param] || match);
  }
  
  return value;
}

// Get current locale
export function getCurrentLocale() {
  return currentLocale;
}

// Change locale
export async function changeLocale(locale) {
  if (locale === currentLocale) return currentLocale;
  
  try {
    await invoke('set_locale', { locale });
    await loadTranslations(locale);
    return currentLocale;
  } catch (error) {
    console.error(`Failed to change locale to ${locale}:`, error);
    return currentLocale;
  }
}

// Get available locales
export function getAvailableLocales() {
  return ['en', 'tr'];
}

// Get locale display name
export function getLocaleDisplayName(locale) {
  const names = {
    'en': 'English',
    'tr': 'Türkçe'
  };
  return names[locale] || locale;
}
