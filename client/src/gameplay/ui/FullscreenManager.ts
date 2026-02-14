export class FullscreenManager {
    private static isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    private static canUseNativeFullscreen() {
        const el = document.documentElement as any;
        return !!(el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen)
            && !FullscreenManager.isIOS();
    }

    static isPseudoFullscreen() {
        return document.body.classList.contains('pseudo-fullscreen');
    }

    static isEnabled() {
        const doc = document as any;
        return Boolean(
            doc.fullscreenElement
            || doc.webkitFullscreenElement
            || doc.mozFullScreenElement
            || doc.msFullscreenElement
            || FullscreenManager.isPseudoFullscreen()
        );
    }

    static setEnabled(enabled: boolean) {
        const current = FullscreenManager.isEnabled();
        if (current === enabled) {
            return Promise.resolve(current);
        }

        if (!enabled) {
            return FullscreenManager.exit().then(() => false);
        }

        return FullscreenManager.enter().then(() => true);
    }

    static toggle() {
        return FullscreenManager.setEnabled(!FullscreenManager.isEnabled());
    }

    static onChange(callback: () => void) {
        const wrapped = () => callback();
        document.addEventListener('fullscreenchange', wrapped);
        document.addEventListener('webkitfullscreenchange', wrapped as EventListener);
        document.addEventListener('mozfullscreenchange', wrapped as EventListener);
        document.addEventListener('MSFullscreenChange', wrapped as EventListener);
        return () => {
            document.removeEventListener('fullscreenchange', wrapped);
            document.removeEventListener('webkitfullscreenchange', wrapped as EventListener);
            document.removeEventListener('mozfullscreenchange', wrapped as EventListener);
            document.removeEventListener('MSFullscreenChange', wrapped as EventListener);
        };
    }

    private static async enter() {
        const gameEl = document.getElementById('app') as any;
        if (!gameEl) return;

        if (FullscreenManager.canUseNativeFullscreen()) {
            try {
                await FullscreenManager.requestFullscreen(gameEl);
                return;
            } catch {
                document.body.classList.add('pseudo-fullscreen');
                window.dispatchEvent(new Event('resize'));
                return;
            }
        }

        document.body.classList.add('pseudo-fullscreen');
        window.dispatchEvent(new Event('resize'));
    }

    private static async exit() {
        const doc = document as any;

        if (FullscreenManager.isPseudoFullscreen()) {
            document.body.classList.remove('pseudo-fullscreen');
            window.dispatchEvent(new Event('resize'));
            return;
        }

        if (doc.exitFullscreen) {
            await doc.exitFullscreen();
            return;
        }

        if (doc.webkitExitFullscreen) {
            await doc.webkitExitFullscreen();
            return;
        }

        if (doc.mozCancelFullScreen) {
            await doc.mozCancelFullScreen();
            return;
        }

        if (doc.msExitFullscreen) {
            await doc.msExitFullscreen();
        }
    }

    private static requestFullscreen(el: any): Promise<void> {
        if (el.requestFullscreen) return el.requestFullscreen();
        if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
        if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
        if (el.msRequestFullscreen) return el.msRequestFullscreen();
        return Promise.reject(new Error('Fullscreen is not supported'));
    }
}
