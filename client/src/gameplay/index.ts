import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
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

    return { width, height };
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
export let currentUser: { _id: string; username: string } | null = null;

export function startGame(userData: { _id: string; username: string }) {
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
        scene: [BootScene, GameScene, UIScene],
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
