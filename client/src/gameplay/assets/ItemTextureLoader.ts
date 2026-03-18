import Phaser from 'phaser';
import { getItemImagePath } from '@cfwk/shared';

export class ItemTextureLoader {
    private static instance: ItemTextureLoader;
    private inFlightBase = new Map<string, Promise<boolean>>();
    private inFlightIcons = new Map<string, Promise<boolean>>();

    static getInstance(): ItemTextureLoader {
        if (!ItemTextureLoader.instance) {
            ItemTextureLoader.instance = new ItemTextureLoader();
        }
        return ItemTextureLoader.instance;
    }

    getBaseKey(itemId: string): string {
        return `item-${itemId}`;
    }

    getIconKey(itemId: string, size = 18): string {
        return `item-${itemId}-${size}`;
    }

    getBestTextureKey(scene: Phaser.Scene, itemId: string, size = 18): string {
        const iconKey = this.getIconKey(itemId, size);
        if (scene.textures.exists(iconKey)) return iconKey;
        const baseKey = this.getBaseKey(itemId);
        if (scene.textures.exists(baseKey)) return baseKey;
        return '__MISSING';
    }

    async ensureItemTexture(scene: Phaser.Scene, itemId: string): Promise<string | undefined> {
        const textureKey = this.getBaseKey(itemId);
        if (scene.textures.exists(textureKey)) return textureKey;

        const imagePath = getItemImagePath(itemId);
        if (!imagePath) return undefined;

        const loaded = await this.loadImageTexture(scene, textureKey, `/${imagePath}`);
        return loaded ? textureKey : undefined;
    }

    async ensureItemIconTexture(scene: Phaser.Scene, itemId: string, size = 18): Promise<string | undefined> {
        const iconKey = this.getIconKey(itemId, size);
        if (scene.textures.exists(iconKey)) return iconKey;

        const inFlightIcon = this.inFlightIcons.get(iconKey);
        if (inFlightIcon) {
            const ok = await inFlightIcon;
            return ok ? iconKey : undefined;
        }

        const iconPromise = (async () => {
            const baseKey = await this.ensureItemTexture(scene, itemId);
            if (!baseKey || !scene.textures.exists(baseKey)) return false;

            if (scene.textures.exists(iconKey)) return true;
            const texture = scene.textures.get(baseKey);
            const source = texture.getSourceImage() as HTMLImageElement | undefined;
            if (!source) return false;

            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return false;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(source, 0, 0, size, size);

            scene.textures.addCanvas(iconKey, canvas);
            return true;
        })().finally(() => {
            this.inFlightIcons.delete(iconKey);
        });

        this.inFlightIcons.set(iconKey, iconPromise);
        const ok = await iconPromise;
        return ok ? iconKey : undefined;
    }

    private async loadImageTexture(scene: Phaser.Scene, key: string, url: string): Promise<boolean> {
        if (scene.textures.exists(key)) return true;

        const inFlight = this.inFlightBase.get(key);
        if (inFlight) return inFlight;

        const promise = new Promise<boolean>((resolve) => {
            const loader = scene.load;
            const completeEvent = `filecomplete-image-${key}`;

            const cleanup = () => {
                loader.off(completeEvent, onCompleteFile);
                loader.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onLoadError);
                loader.off(Phaser.Loader.Events.COMPLETE, onLoaderComplete);
            };

            const finish = (ok: boolean) => {
                cleanup();
                resolve(ok);
            };

            const onCompleteFile = () => finish(scene.textures.exists(key));
            const onLoadError = (file: Phaser.Loader.File) => {
                if (file?.key !== key) return;
                finish(false);
            };
            const onLoaderComplete = () => finish(scene.textures.exists(key));

            loader.on(completeEvent, onCompleteFile);
            loader.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onLoadError);
            loader.on(Phaser.Loader.Events.COMPLETE, onLoaderComplete);
            loader.image(key, url);
            if (!loader.isLoading()) {
                loader.start();
            }
        }).finally(() => {
            this.inFlightBase.delete(key);
        });

        this.inFlightBase.set(key, promise);
        return promise;
    }
}
