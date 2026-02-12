import type { DialogueData } from './DialogueTypes';

export class DialogueRepository {
    private cache = new Map<string, DialogueData>();

    async getDialogue(id: string): Promise<DialogueData | null> {
        if (this.cache.has(id)) {
            return this.cache.get(id) ?? null;
        }

        try {
            const response = await fetch(`/dialogue/${id}.json`, { cache: 'no-store' });
            if (!response.ok) {
                console.warn(`[DialogueRepository] Missing dialogue: ${id}`);
                return null;
            }

            const data = (await response.json()) as DialogueData;
            const hasLines = this.hasAnyLines(data);
            if (!hasLines) {
                console.warn(`[DialogueRepository] Empty dialogue: ${id}`);
                return null;
            }

            this.cache.set(id, data);
            return data;
        } catch (error) {
            console.warn(`[DialogueRepository] Failed to load dialogue: ${id}`, error);
            return null;
        }
    }

    private hasAnyLines(data: DialogueData | null | undefined): boolean {
        if (!data) return false;
        if (data.lines && data.lines.length > 0) return true;
        if (data.forks && data.forks.some((fork) => fork.lines && fork.lines.length > 0)) return true;
        return false;
    }
}
