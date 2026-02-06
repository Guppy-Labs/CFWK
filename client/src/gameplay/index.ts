import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { FishingScene } from './scenes/FishingScene';
import { UIScene } from './scenes/UIScene';

function updateAppSize() {
    const container = document.getElementById('game-container');
    const app = document.getElementById('app');
    if (!container || !app) return { width: 800, height: 600 };

    const rect = container.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(200, Math.floor(rect.height));

    app.style.width = `${width}px`;
    app.style.height = `${height}px`;

    updateOrientationOverlay(width, height);
    return { width, height };
}

function getOrientationOverlay(): HTMLDivElement {
    let overlay = document.getElementById('orientation-overlay') as HTMLDivElement | null;
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'orientation-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(0, 0, 0, 0.6)';
    overlay.style.zIndex = '9999';
    overlay.style.pointerEvents = 'auto';

    const dialog = document.createElement('div');
    dialog.style.background = '#2b2522';
    dialog.style.border = '2px solid #4b3435';
    dialog.style.borderRadius = '10px';
    dialog.style.padding = '18px 22px';
    dialog.style.maxWidth = '320px';
    dialog.style.textAlign = 'center';
    dialog.style.color = '#f2e9dd';
    dialog.style.fontFamily = 'sans-serif';
    dialog.style.boxShadow = '0 10px 30px rgba(0,0,0,0.4)';

    const title = document.createElement('div');
    title.textContent = 'Rotate your device';
    title.style.fontSize = '18px';
    title.style.marginBottom = '8px';
    title.style.fontWeight = '600';

    const body = document.createElement('div');
    body.textContent = 'This game requires landscape orientation. Please rotate your device to continue.';
    body.style.fontSize = '14px';
    body.style.lineHeight = '1.4';

    dialog.appendChild(title);
    dialog.appendChild(body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    return overlay;
}

function updateOrientationOverlay(width: number, height: number) {
    const overlay = getOrientationOverlay();
    const isTooTall = height > width * 1.4;
    overlay.style.display = isTooTall ? 'flex' : 'none';
}

export function hideLoader() {
    const loader = document.getElementById('game-loader');
    if (!loader) return;
    
    // Add exiting class to trigger animations
    loader.classList.add('exiting');
    
    // Remove the loader after animations complete
    setTimeout(() => {
        loader.style.display = 'none';
        loader.classList.remove('exiting');
    }, 1100); // Wait for all animations to finish
}

export function setLoaderText(text: string) {
    const loaderText = document.getElementById('loader-text');
    if (loaderText) loaderText.textContent = text;
}

let gameInstance: Phaser.Game | undefined;

// Store user data globally for scenes to access
export let currentUser: { _id: string; username: string; isPremium?: boolean; permissions?: string[] } | null = null;

export function startGame(userData: { _id: string; username: string; isPremium?: boolean; permissions?: string[] }) {
    currentUser = userData;
    // Loader is already visible from HTML, just ensure #app is sized correctly
    const { width, height } = updateAppSize();

    const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        width,
        height,
        parent: 'app',
        physics: {
            default: 'matter',
            matter: {
                gravity: { x: 0, y: 0 },
                debug: false
            }
        },
        scene: [BootScene, GameScene, UIScene, FishingScene],
        pixelArt: true,
        roundPixels: true,
        scale: {
            mode: Phaser.Scale.RESIZE,
            autoCenter: Phaser.Scale.CENTER_BOTH
        },
        dom: {
            createContainer: true
        }
    };

    const game = new Phaser.Game(config);
    gameInstance = game;
    // Loader is hidden by GameScene after map is fully loaded

    // Use ResizeObserver for robust resize detection
    // This catches: window resize, dev tools toggle, mobile rotation, container changes
    const container = document.getElementById('game-container');
    if (container) {
        const resizeObserver = new ResizeObserver(() => {
            const { width: newWidth, height: newHeight } = updateAppSize();
            if (gameInstance && gameInstance.scale) {
                gameInstance.scale.resize(newWidth, newHeight);
            }
        });
        resizeObserver.observe(container);
    }

    // Fallback for browsers without ResizeObserver or edge cases
    window.addEventListener('resize', () => {
        const { width: newWidth, height: newHeight } = updateAppSize();
        if (gameInstance && gameInstance.scale) {
            gameInstance.scale.resize(newWidth, newHeight);
        }
    });
    
    // Handle orientation change explicitly for mobile
    window.addEventListener('orientationchange', () => {
        // Small delay to let the browser finish rotating
        setTimeout(() => {
            const { width: newWidth, height: newHeight } = updateAppSize();
            if (gameInstance && gameInstance.scale) {
                gameInstance.scale.resize(newWidth, newHeight);
            }
        }, 100);
    });
}
