import { getCurrentLocale, changeLocale, getAvailableLocales, getLocaleDisplayName } from './i18n.js';

class LanguageSwitcher {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.currentLocale = getCurrentLocale();
    this.init();
  }

  init() {
    if (!this.container) {
      console.error(`Language switcher container not found: ${containerId}`);
      return;
    }

    this.render();
    this.attachEvents();
  }

  render() {
    const locales = getAvailableLocales();
    const currentLocale = getCurrentLocale();
    
    this.container.innerHTML = `
      <div class="language-switcher">
        <select id="language-select" class="px-3 py-1 border rounded-md bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white">
          ${locales.map(locale => `
            <option value="${locale}" ${locale === currentLocale ? 'selected' : ''}>
              ${getLocaleDisplayName(locale)}
            </option>
          `).join('')}
        </select>
      </div>
    `;
  }

  attachEvents() {
    const select = document.getElementById('language-select');
    if (select) {
      select.addEventListener('change', async (e) => {
        const newLocale = e.target.value;
        try {
          await changeLocale(newLocale);
          // Trigger a page refresh to update all UI text
          window.location.reload();
        } catch (error) {
          console.error('Failed to change language:', error);
          // Revert selection on error
          select.value = getCurrentLocale();
        }
      });
    }
  }

  update() {
    this.render();
    this.attachEvents();
  }
}

// Export for use in other modules
export default LanguageSwitcher;

// Auto-initialize if container exists
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('language-switcher');
  if (container) {
    new LanguageSwitcher('language-switcher');
  }
});
