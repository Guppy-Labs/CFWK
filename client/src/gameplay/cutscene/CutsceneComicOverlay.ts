export interface ComicConfig {
    images: string[];
    backgroundColor?: string;
}

export class CutsceneComicOverlay {
    private overlay: HTMLDivElement;
    private grid: HTMLDivElement;
    private banner: HTMLDivElement;
    private cells: HTMLImageElement[] = [];
    private destroyed = false;
    private clickResolve: (() => void) | null = null;
    private boundClickHandler: () => void;

    constructor() {
        this.overlay = document.createElement('div');
        Object.assign(this.overlay.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '1000',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#080c18',
            cursor: 'pointer'
        });

        this.grid = document.createElement('div');
        Object.assign(this.grid.style, {
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr',
            gap: '6px',
            width: 'calc(100vw - 12px)',
            height: 'calc(100vh - 12px)'
        });

        this.banner = document.createElement('div');
        this.banner.textContent = 'Click to continue';
        Object.assign(this.banner.style, {
            position: 'absolute',
            bottom: '16px',
            right: '16px',
            padding: '6px 14px',
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            color: 'rgba(255, 255, 255, 0.7)',
            fontSize: '13px',
            fontFamily: "'Minecraft', monospace",
            letterSpacing: '0.5px',
            borderRadius: '4px',
            pointerEvents: 'none',
            opacity: '0',
            transition: 'opacity 400ms ease'
        });

        this.overlay.appendChild(this.grid);
        this.overlay.appendChild(this.banner);

        this.boundClickHandler = () => {
            if (this.clickResolve) {
                const resolve = this.clickResolve;
                this.clickResolve = null;
                resolve();
            }
        };
        this.overlay.addEventListener('click', this.boundClickHandler);
        this.overlay.addEventListener('touchend', this.boundClickHandler);

        document.body.appendChild(this.overlay);
    }

    async show(config: ComicConfig): Promise<void> {
        if (this.destroyed) return;

        const bgColor = config.backgroundColor ?? '#080c18';
        this.overlay.style.backgroundColor = bgColor;
        this.overlay.style.display = 'flex';
        this.banner.style.opacity = '0';

        this.cells = [];
        for (const src of config.images) {
            const img = document.createElement('img');
            img.src = src;
            Object.assign(img.style, {
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                opacity: '0',
                transform: 'scale(0.7)',
                transition: 'opacity 400ms ease-out, transform 400ms ease-out',
                pointerEvents: 'none'
            });
            this.grid.appendChild(img);
            this.cells.push(img);
        }

        for (let i = 0; i < this.cells.length; i++) {
            if (this.destroyed) return;

            await this.animateIn(this.cells[i]);

            if (i < this.cells.length - 1) {
                this.showBanner();
                await this.waitForClick();
                this.hideBanner();
            }
        }

        if (this.destroyed) return;
        this.showBanner();
        await this.waitForClick();
        this.hideBanner();
    }

    async fadeOut(durationMs: number = 500): Promise<void> {
        if (this.destroyed) return;
        this.overlay.style.transition = `opacity ${durationMs}ms ease`;
        this.overlay.style.opacity = '0';
        await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
        this.overlay.style.display = 'none';
        this.overlay.style.transition = 'none';
        this.overlay.style.opacity = '1';
    }

    private showBanner(): void {
        this.banner.style.opacity = '1';
    }

    private hideBanner(): void {
        this.banner.style.opacity = '0';
    }

    private animateIn(img: HTMLImageElement): Promise<void> {
        return new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
                img.style.opacity = '1';
                img.style.transform = 'scale(1)';
                setTimeout(resolve, 420);
            });
        });
    }

    private waitForClick(): Promise<void> {
        if (this.destroyed) return Promise.resolve();
        return new Promise<void>((resolve) => {
            this.clickResolve = resolve;
        });
    }

    destroy(): void {
        this.destroyed = true;
        if (this.clickResolve) {
            this.clickResolve();
            this.clickResolve = null;
        }
        this.overlay.removeEventListener('click', this.boundClickHandler);
        this.overlay.removeEventListener('touchend', this.boundClickHandler);
        this.overlay.remove();
        this.cells = [];
    }
}
