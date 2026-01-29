import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';

function updateAppSize() {
    const container = document.getElementById('game-container');
    const app = document.getElementById('app');
    if (!container || !app) return { width: 800, height: 600 };

    const rect = container.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(200, Math.floor(rect.height));

    app.style.width = `${width}px`;
    app.style.height = `${height}px`;

    const placeholder = app.querySelector<HTMLCanvasElement>('#game-placeholder');
    if (placeholder) {
        placeholder.width = width;
        placeholder.height = height;
        placeholder.style.width = '100%';
        placeholder.style.height = '100%';
    }

    return { width, height };
}

function showLoader() {
    const app = document.getElementById('app');
    if (!app) return;

    let placeholder = app.querySelector<HTMLCanvasElement>('#game-placeholder');
    if (!placeholder) {
        placeholder = document.createElement('canvas');
        placeholder.id = 'game-placeholder';
        placeholder.style.display = 'block';
        placeholder.style.width = '100%';
        placeholder.style.height = '100%';
        app.prepend(placeholder);
    }

    const loader = document.getElementById('game-loader');
    if (loader) loader.style.display = 'flex';
}

function hideLoader() {
    const loader = document.getElementById('game-loader');
    if (loader) loader.style.display = 'none';

    const placeholder = document.getElementById('game-placeholder');
    if (placeholder) placeholder.remove();
}

let gameInstance: Phaser.Game | undefined;

export function startGame() {
    showLoader();
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
        scene: [BootScene, GameScene],
        pixelArt: true,
        roundPixels: false,
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
    game.events.once('ready', () => {
        hideLoader();
    });

    window.addEventListener('resize', () => {
        const { width: newWidth, height: newHeight } = updateAppSize();
        if (gameInstance) {
            gameInstance.scale.resize(newWidth, newHeight);
        }
    });
}
