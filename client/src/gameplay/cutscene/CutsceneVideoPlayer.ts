export interface VideoSegment {
    url: string;
    backgroundColor?: string;
    fadeIn?: { from: string; durationMs: number };
    fadeOut?: { to: string; durationMs: number };
    musicKey?: string;
    musicStop?: boolean;
    playbackRate?: number;
    /** Use 'cover' to fill the viewport edge-to-edge (may crop top/bottom). */
    objectFit?: 'contain' | 'cover';
    /** Play a second copy of the video behind the main one, filling the viewport with blur. */
    blurredBackground?: boolean;
    /** Show a skip button; when clicked, this and subsequent skippable segments play at 10x. */
    skippable?: boolean;
}

export class CutsceneVideoPlayer {
    private overlay: HTMLDivElement;
    private preloadedBlobUrls = new Map<string, string>();
    private preloadPromises = new Map<string, Promise<string | null>>();
    private destroyed = false;
    private skipped = false;
    private skipButton: HTMLDivElement | null = null;
    private skipFadeTimer: ReturnType<typeof setTimeout> | null = null;
    private activeVideos: HTMLVideoElement[] = [];

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

        const fitMode = segment.objectFit ?? 'contain';

        let bgVideo: HTMLVideoElement | undefined;
        if (segment.blurredBackground) {
            bgVideo = document.createElement('video');
            bgVideo.playsInline = true;
            bgVideo.muted = true;
            bgVideo.src = videoSrc;
            Object.assign(bgVideo.style, {
                position: 'absolute',
                inset: '0',
                display: 'block',
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                backgroundColor: bgColor,
                filter: 'blur(20px)',
                transform: 'scale(1.1)',
            });
            this.overlay.appendChild(bgVideo);
        }

        const video = document.createElement('video');
        video.playsInline = true;
        video.muted = false;
        video.src = videoSrc;

        Object.assign(video.style, {
            position: segment.blurredBackground ? 'relative' : 'static',
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: fitMode,
            backgroundColor: segment.blurredBackground ? 'transparent' : bgColor,
        });

        this.overlay.appendChild(video);
        video.currentTime = 0;
        if (bgVideo) bgVideo.currentTime = 0;

        const rate = this.skipped && segment.skippable
            ? 10
            : (typeof segment.playbackRate === 'number' && segment.playbackRate > 0 ? segment.playbackRate : 1);
        video.playbackRate = rate;
        if (bgVideo) bgVideo.playbackRate = rate;

        this.activeVideos = bgVideo ? [video, bgVideo] : [video];

        if (segment.skippable && !this.skipped) {
            this.showSkipButton();
        } else if (!segment.skippable) {
            this.removeSkipButton();
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
            bgVideo?.play().catch(() => {});
            video.play().catch(() => resolve());
        });

        this.activeVideos = [];
        if (this.destroyed) return;

        const cleanupVideo = (v: HTMLVideoElement) => {
            v.pause();
            v.removeAttribute('src');
            v.load();
            if (v.parentElement === this.overlay) this.overlay.removeChild(v);
        };
        if (bgVideo) cleanupVideo(bgVideo);
        cleanupVideo(video);

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

    private showSkipButton(): void {
        if (this.skipButton) return;

        const btn = document.createElement('div');
        btn.textContent = 'SKIP \u00BB';
        Object.assign(btn.style, {
            position: 'absolute',
            top: '18px',
            right: '24px',
            padding: '6px 14px',
            color: '#999',
            fontSize: '14px',
            fontFamily: "'Minecraft', monospace",
            letterSpacing: '1px',
            cursor: 'pointer',
            zIndex: '1',
            opacity: '0',
            transition: 'opacity 400ms ease',
            userSelect: 'none',
        });
        btn.style.setProperty('-webkit-user-select', 'none');

        btn.addEventListener('click', () => {
            this.skipped = true;
            for (const v of this.activeVideos) v.playbackRate = 10;
            this.removeSkipButton();
        });

        this.overlay.appendChild(btn);
        this.skipButton = btn;

        this.skipFadeTimer = setTimeout(() => {
            if (btn.parentElement) btn.style.opacity = '1';
        }, 1000);
    }

    private removeSkipButton(): void {
        if (this.skipFadeTimer) { clearTimeout(this.skipFadeTimer); this.skipFadeTimer = null; }
        if (!this.skipButton) return;
        const btn = this.skipButton;
        this.skipButton = null;
        btn.style.opacity = '0';
        setTimeout(() => btn.remove(), 420);
    }

    destroy(): void {
        this.destroyed = true;
        this.removeSkipButton();
        this.activeVideos = [];
        this.preloadedBlobUrls.forEach((blobUrl) => {
            URL.revokeObjectURL(blobUrl);
        });
        this.preloadedBlobUrls.clear();
        this.preloadPromises.clear();
        this.overlay.remove();
    }
}
