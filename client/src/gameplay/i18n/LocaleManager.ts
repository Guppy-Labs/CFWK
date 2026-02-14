import enUS from '../../locales/en_US.json';
import esES from '../../locales/es_ES.json';
import frFR from '../../locales/fr_FR.json';
import teST from '../../locales/te_ST.json';

type LocaleMessages = Record<string, unknown>;

export type LocaleInfo = {
    code: string;
    displayName: string;
};

export class LocaleManager {
    private static instance: LocaleManager;
    static readonly STORAGE_KEY = 'cfwk_locale';
    private readonly fallbackLocale = 'en_US';
    private readonly locales = new Map<string, LocaleMessages>();
    private currentLocale = this.fallbackLocale;

    private constructor() {
        this.locales.set('en_US', enUS as LocaleMessages);
        this.locales.set('es_ES', esES as LocaleMessages);
        this.locales.set('fr_FR', frFR as LocaleMessages);
        this.locales.set('te_ST', teST as LocaleMessages);

        this.hydrateFromStorage();
    }

    static getInstance(): LocaleManager {
        if (!LocaleManager.instance) {
            LocaleManager.instance = new LocaleManager();
        }
        return LocaleManager.instance;
    }

    getCurrentLocale() {
        return this.currentLocale;
    }

    setLocale(locale: string) {
        if (!this.locales.has(locale)) return;
        const changed = this.currentLocale !== locale;
        this.currentLocale = locale;
        this.persistLocale(locale);
        if (changed) {
            window.dispatchEvent(new CustomEvent('locale:changed', { detail: { locale } }));
        }
    }

    hydrateFromStorage() {
        try {
            const stored = window.localStorage.getItem(LocaleManager.STORAGE_KEY);
            if (!stored || !this.locales.has(stored)) return;
            this.currentLocale = stored;
        } catch {
            // Ignore storage access errors (private mode / blocked storage)
        }
    }

    getAvailableLocales(): LocaleInfo[] {
        return Array.from(this.locales.keys())
            .sort((a, b) => a.localeCompare(b))
            .map((code) => ({
                code,
                displayName: this.t(`settings.language.localeNames.${code}`, undefined, code)
            }));
    }

    t(key: string, params?: Record<string, string | number>, fallback?: string): string {
        if (this.currentLocale === 'te_ST') {
            return '-----';
        }

        const primary = this.lookup(this.currentLocale, key);
        const fromFallback = this.lookup(this.fallbackLocale, key);
        const raw = (primary ?? fromFallback ?? fallback ?? key);
        if (typeof raw !== 'string') return fallback ?? key;

        if (!params) return raw;

        return Object.entries(params).reduce((text, [paramKey, value]) => {
            return text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), String(value));
        }, raw);
    }

    private lookup(locale: string, key: string): unknown {
        const root = this.locales.get(locale);
        if (!root) return undefined;

        const segments = key.split('.');
        let cursor: unknown = root;

        for (const segment of segments) {
            if (!cursor || typeof cursor !== 'object' || !(segment in (cursor as Record<string, unknown>))) {
                return undefined;
            }
            cursor = (cursor as Record<string, unknown>)[segment];
        }

        return cursor;
    }

    private persistLocale(locale: string) {
        try {
            window.localStorage.setItem(LocaleManager.STORAGE_KEY, locale);
        } catch {
            // Ignore storage access errors (private mode / blocked storage)
        }
    }
}
