import type { ISettingsResponse } from '@cfwk/shared';
import { LocaleManager } from './LocaleManager';
import { NetworkManager } from '../network/NetworkManager';

export type LocaleBootstrapOptions = {
    fetchFromServer?: boolean;
};

export async function bootstrapLocale(options: LocaleBootstrapOptions = {}): Promise<string> {
    const localeManager = LocaleManager.getInstance();
    const networkManager = NetworkManager.getInstance();

    localeManager.hydrateFromStorage();

    if (options.fetchFromServer) {
        try {
            const response = await fetch('/api/settings', {
                method: 'GET',
                credentials: 'include'
            });

            if (response.ok) {
                const data: ISettingsResponse = await response.json();
                const settings = data?.settings;
                if (settings && typeof settings === 'object') {
                    networkManager.primeSettingsCache(settings);
                }
                const locale = data?.settings?.language;
                if (typeof locale === 'string' && locale.trim().length > 0) {
                    localeManager.setLocale(locale.trim());
                }
            }
        } catch {
            // Keep whatever locale we already have (storage/fallback)
        }
    }

    return localeManager.getCurrentLocale();
}
