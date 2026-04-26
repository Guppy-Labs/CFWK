export interface VideoSegment {
    url: string;
    backgroundColor?: string;
    fadeIn?: { from: string; durationMs: number };
    fadeOut?: { to: string; durationMs: number };
    musicKey?: string;
    musicStop?: boolean;
    playbackRate?: number;
}

export class CutsceneVideoPlayer {
    private overlay: HTMLDivElement;
    private preloadedBlobUrls = new Map<string, string>();
    private preloadPromises = new Map<string, Promise<string | null>>();
    private destroyed = false;

    constructor() {
        this.overlay = document.createElement('div');
        Object.assign(this.overlay.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '1000',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#000',
            transition: 'none'
        });
        document.body.appendChild(this.overlay);
    }

    preloadVideos(urls: string[]): void {
        for (const url of urls) {
            if (this.preloadPromises.has(url)) continue;
            const promise = fetch(url)
                .then((response) => {
                    if (!response.ok) return null;
                    return response.blob();
                })
                .then((blob) => {
                    if (!blob || this.destroyed) return null;
                    const blobUrl = URL.createObjectURL(blob);
                    this.preloadedBlobUrls.set(url, blobUrl);
                    return blobUrl;
                })
                .catch(() => null);
            this.preloadPromises.set(url, promise);
        }
    }

    private async resolveVideoUrl(originalUrl: string): Promise<string> {
        const cached = this.preloadedBlobUrls.get(originalUrl);
        if (cached) return cached;

        const pending = this.preloadPromises.get(originalUrl);
        if (pending) {
            const blobUrl = await pending;
            if (blobUrl) return blobUrl;
        }

        return originalUrl;
    }

    async playSegment(segment: VideoSegment): Promise<void> {
        if (this.destroyed) return;

        const bgColor = segment.backgroundColor ?? '#000';

        if (segment.fadeIn) {
            this.overlay.style.backgroundColor = segment.fadeIn.from;
            this.overlay.style.display = 'flex';
            this.overlay.style.opacity = '1';
            await this.fadeOverlayColor(segment.fadeIn.from, bgColor, segment.fadeIn.durationMs);
        } else {
            this.overlay.style.backgroundColor = bgColor;
            this.overlay.style.display = 'flex';
            this.overlay.style.opacity = '1';
        }

        if (this.destroyed) return;

        const videoSrc = await this.resolveVideoUrl(segment.url);
        if (this.destroyed) return;

        const video = document.createElement('video');
        video.playsInline = true;
        video.src = videoSrc;

        Object.assign(video.style, {
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            backgroundColor: 'transparent'
        });

        this.overlay.appendChild(video);
        video.currentTime = 0;
        if (typeof segment.playbackRate === 'number' && segment.playbackRate > 0) {
            video.playbackRate = segment.playbackRate;
        }

        await new Promise<void>((resolve) => {
            if (this.destroyed) { resolve(); return; }
            const onEnded = () => {
                video.removeEventListener('ended', onEnded);
                video.removeEventListener('error', onEnded);
                resolve();
            };
            video.addEventListener('ended', onEnded);
            video.addEventListener('error', onEnded);
            video.play().catch(() => resolve());
        });

        if (this.destroyed) return;

        video.pause();
        video.removeAttribute('src');
        video.load();
        if (video.parentElement === this.overlay) {
            this.overlay.removeChild(video);
        }

        if (segment.fadeOut) {
            await this.fadeOverlayColor(bgColor, segment.fadeOut.to, segment.fadeOut.durationMs);
            this.overlay.style.backgroundColor = segment.fadeOut.to;
        }
    }

    setBackgroundColor(color: string): void {
        this.overlay.style.backgroundColor = color;
    }

    show(bgColor: string = '#000'): void {
        this.overlay.style.backgroundColor = bgColor;
        this.overlay.style.display = 'flex';
        this.overlay.style.opacity = '1';
    }

    async fadeOverlay(fromAlpha: number, toAlpha: number, durationMs: number): Promise<void> {
        if (this.destroyed) return;
        this.overlay.style.opacity = String(fromAlpha);
        this.overlay.style.transition = `opacity ${durationMs}ms ease`;
        await new Promise<void>((resolve) => requestAnimationFrame(() => {
            this.overlay.style.opacity = String(toAlpha);
            setTimeout(resolve, durationMs);
        }));
        this.overlay.style.transition = 'none';
    }

    hide(): void {
        this.overlay.style.display = 'none';
    }

    private fadeOverlayColor(from: string, to: string, durationMs: number): Promise<void> {
        if (this.destroyed) return Promise.resolve();
        this.overlay.style.backgroundColor = from;
        this.overlay.style.transition = `background-color ${durationMs}ms ease`;
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                this.overlay.style.backgroundColor = to;
                setTimeout(() => {
                    this.overlay.style.transition = 'none';
                    resolve();
                }, durationMs);
            });
        });
    }

    destroy(): void {
        this.destroyed = true;
        this.preloadedBlobUrls.forEach((blobUrl) => {
            URL.revokeObjectURL(blobUrl);
        });
        this.preloadedBlobUrls.clear();
        this.preloadPromises.clear();
        this.overlay.remove();
    }
}
