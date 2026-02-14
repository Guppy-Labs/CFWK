import { getItemDefinition } from '@cfwk/shared';
import { LocaleManager } from './LocaleManager';

const localeManager = LocaleManager.getInstance();

export function getLocalizedItemName(itemId: string, fallback?: string): string {
    const item = getItemDefinition(itemId);
    const itemFallback = fallback ?? item?.name ?? itemId;
    return localeManager.t(`items.${itemId}.name`, undefined, itemFallback);
}

export function getLocalizedItemDescription(itemId: string, fallback?: string): string {
    const item = getItemDefinition(itemId);
    const itemFallback = fallback ?? item?.description ?? '';
    return localeManager.t(`items.${itemId}.description`, undefined, itemFallback);
}
