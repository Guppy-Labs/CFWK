/**
 * CharacterService - Fetches and caches character appearance data
 * 
 * This service handles communication with the server to get/update
 * character customization data for the Main Character.
 */

import { ICharacterAppearance, DEFAULT_CHARACTER_APPEARANCE } from '@cfwk/shared';
import { Config } from '../../config';

export class CharacterService {
    private static instance: CharacterService;
    private cachedAppearance: ICharacterAppearance | null = null;

    private constructor() {}

    public static getInstance(): CharacterService {
        if (!CharacterService.instance) {
            CharacterService.instance = new CharacterService();
        }
        return CharacterService.instance;
    }

    /**
     * Fetch the current user's character appearance from the server
     * @returns Character appearance data or default if not available
     */
    async fetchAppearance(): Promise<ICharacterAppearance> {
        try {
            const response = await fetch(Config.getApiUrl('/account/character'), {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                console.warn('[CharacterService] Failed to fetch appearance, using default');
                return DEFAULT_CHARACTER_APPEARANCE;
            }

            const data = await response.json();
            this.cachedAppearance = data.appearance;
            return data.appearance;
        } catch (error) {
            console.error('[CharacterService] Error fetching appearance:', error);
            return DEFAULT_CHARACTER_APPEARANCE;
        }
    }

    /**
     * Update the current user's character appearance on the server
     * @param appearance New character appearance data
     * @returns True if update was successful
     */
    async updateAppearance(appearance: ICharacterAppearance): Promise<boolean> {
        try {
            const response = await fetch(Config.getApiUrl('/account/character'), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ appearance })
            });

            if (!response.ok) {
                const data = await response.json();
                console.error('[CharacterService] Failed to update appearance:', data.message);
                return false;
            }

            const data = await response.json();
            this.cachedAppearance = data.appearance;
            return true;
        } catch (error) {
            console.error('[CharacterService] Error updating appearance:', error);
            return false;
        }
    }

    /**
     * Get the cached appearance (if available)
     */
    getCachedAppearance(): ICharacterAppearance | null {
        return this.cachedAppearance;
    }

    /**
     * Clear the cached appearance
     */
    clearCache(): void {
        this.cachedAppearance = null;
    }
}
