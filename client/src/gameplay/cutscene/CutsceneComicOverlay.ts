/** Percentage-based rectangle defining a panel region within the comic image. */
export interface ComicPanelCover {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ComicConfig {
    image: string;
    panels: ComicPanelCover[];
}

/**
 * Full-screen overlay that displays a single comic image and reveals panels
 * sequentially by lifting white covers on each click/tap.
 *
 * panels[0] starts visible; panels[1..n] are covered with white rectangles
 * that are removed one-by-one as the user clicks.
 */
export class CutsceneComicOverlay {
    private overlay: HTMLDivElement;
    private wrapper: HTMLDivElement;
    private img: HTMLImageElement | null = null;
    private coverLayer: HTMLDivElement;
    private banner: HTMLDivElement;
    private covers: HTMLDivElement[] = [];
    private destroyed = false;
    private clickResolve: (() => void) | null = null;
    private boundClickHandler: () => void;
    private boundResizeHandler: () => void;
    private naturalWidth = 0;
    private naturalHeight = 0;

    constructor() {
        this.overlay = document.createElement('div');
        Object.assign(this.overlay.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '1000',
            display: 'none',
            backgroundColor: '#ffffff',
            cursor: 'pointer',
            userSelect: 'none',
        });
        this.overlay.style.setProperty('-webkit-user-select', 'none');

        this.wrapper = document.createElement('div');
        Object.assign(this.wrapper.style, {
            position: 'absolute',
            overflow: 'hidden',
        });

        this.coverLayer = document.createElement('div');
        Object.assign(this.coverLayer.style, {
            position: 'absolute',
            inset: '0',
            pointerEvents: 'none',
        });

        this.banner = document.createElement('div');
        this.banner.textContent = 'Click to continue';
        Object.assign(this.banner.style, {
            position: 'absolute',
            bottom: '16px',
            right: '16px',
            padding: '6px 14px',
            backgroundColor: 'rgba(0, 0, 0, 0.45)',
            color: 'rgba(255, 255, 255, 0.8)',
            fontSize: '13px',
            fontFamily: "'Minecraft', monospace",
            letterSpacing: '0.5px',
            borderRadius: '4px',
            pointerEvents: 'none',
            opacity: '0',
            transition: 'opacity 400ms ease',
            userSelect: 'none',
            zIndex: '1',
        });
        this.banner.style.setProperty('-webkit-user-select', 'none');

        this.wrapper.appendChild(this.coverLayer);
        this.overlay.appendChild(this.wrapper);
        this.overlay.appendChild(this.banner);

        this.boundClickHandler = () => {
            if (this.clickResolve) {
                const resolve = this.clickResolve;
                this.clickResolve = null;
                resolve();
            }
        };

        this.boundResizeHandler = () => this.layoutImage();

        this.overlay.addEventListener('click', this.boundClickHandler);
        this.overlay.addEventListener('touchend', this.boundClickHandler);
        window.addEventListener('resize', this.boundResizeHandler);

        document.body.appendChild(this.overlay);
    }

    async show(config: ComicConfig): Promise<void> {
        if (this.destroyed) return;

        this.overlay.style.display = 'block';
        this.banner.style.opacity = '0';

        const img = await this.preloadImage(config.image);
        if (this.destroyed) return;

        this.naturalWidth = img.naturalWidth;
        this.naturalHeight = img.naturalHeight;

        Object.assign(img.style, {
            display: 'block',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            userSelect: 'none',
        });
        img.style.setProperty('-webkit-user-select', 'none');
        img.draggable = false;
        this.img = img;
        this.wrapper.insertBefore(img, this.coverLayer);

        this.layoutImage();
        this.buildCovers(config.panels);

        await this.fadeImageIn();
        if (this.destroyed) return;

        for (let i = 0; i < this.covers.length; i++) {
            if (this.destroyed) return;
            this.showBanner();
            await this.waitForClick();
            this.hideBanner();
            await this.liftCover(this.covers[i]);
        }

        if (this.destroyed) return;
        this.showBanner();
        await this.waitForClick();
        this.hideBanner();
    }

    async fadeOut(durationMs = 500): Promise<void> {
        if (this.destroyed) return;

        if (this.img) {
            this.img.style.transition = `opacity ${durationMs}ms ease`;
            this.img.style.opacity = '0';
        }
        this.coverLayer.style.transition = `opacity ${durationMs}ms ease`;
        this.coverLayer.style.opacity = '0';

        await new Promise<void>((r) => setTimeout(r, durationMs));

        this.overlay.style.display = 'none';
    }

    destroy(): void {
        this.destroyed = true;
        if (this.clickResolve) {
            this.clickResolve();
            this.clickResolve = null;
        }
        this.overlay.removeEventListener('click', this.boundClickHandler);
        this.overlay.removeEventListener('touchend', this.boundClickHandler);
        window.removeEventListener('resize', this.boundResizeHandler);
        this.overlay.remove();
        this.covers = [];
        this.img = null;
    }

    // -- private ----------------------------------------------------------

    private layoutImage(): void {
        if (!this.naturalWidth || !this.naturalHeight) return;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const imgAspect = this.naturalWidth / this.naturalHeight;
        const vpAspect = vw / vh;

        let w: number, h: number;
        if (imgAspect > vpAspect) {
            w = vw;
            h = vw / imgAspect;
        } else {
            h = vh;
            w = vh * imgAspect;
        }

        const left = (vw - w) / 2;
        const top = (vh - h) / 2;

        Object.assign(this.wrapper.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${w}px`,
            height: `${h}px`,
        });
    }

    private buildCovers(panels: ComicPanelCover[]): void {
        this.covers = [];
        for (let i = 1; i < panels.length; i++) {
            const p = panels[i];
            const cover = document.createElement('div');
            Object.assign(cover.style, {
                position: 'absolute',
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: `${p.width}%`,
                height: `${p.height}%`,
                backgroundColor: '#ffffff',
                transition: 'opacity 400ms ease-out',
                pointerEvents: 'none',
                userSelect: 'none',
            });
            cover.style.setProperty('-webkit-user-select', 'none');
            this.coverLayer.appendChild(cover);
            this.covers.push(cover);
        }
    }

    private fadeImageIn(): Promise<void> {
        if (!this.img) return Promise.resolve();
        this.img.style.opacity = '0';
        this.img.style.transition = 'opacity 500ms ease';
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                if (this.img) this.img.style.opacity = '1';
                setTimeout(resolve, 520);
            });
        });
    }

    private liftCover(cover: HTMLDivElement): Promise<void> {
        return new Promise<void>((resolve) => {
            cover.style.opacity = '0';
            setTimeout(resolve, 420);
        });
    }

    private showBanner(): void {
        this.banner.style.opacity = '1';
    }

    private hideBanner(): void {
        this.banner.style.opacity = '0';
    }

    private waitForClick(): Promise<void> {
        if (this.destroyed) return Promise.resolve();
        return new Promise<void>((resolve) => {
            this.clickResolve = resolve;
        });
    }

    private preloadImage(src: string): Promise<HTMLImageElement> {
        return new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }
}
