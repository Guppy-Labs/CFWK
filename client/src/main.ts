import Phaser from 'phaser';

// Auth check
async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
            window.location.href = '/login';
            return;
        }
        const data = await res.json();
        if (!data.user) {
            window.location.href = '/login';
            return;
        }

        if (!data.user.username) {
            window.location.href = '/onboarding';
            return;
        }

        const perms = data.user.permissions || [];
        if (!perms.includes('access.game')) {
             window.location.href = '/account'; 
             return;
        }

        startGame();
    } catch (e) {
        window.location.href = '/login';
    }
}

import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';

function startGame() {
    const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        width: 800,
        height: 600,
        parent: 'app',
        physics: {
            default: 'arcade',
            arcade: {
                gravity: { x: 0, y: 0 },
                debug: true
            }
        },
        scene: [BootScene, GameScene],
        pixelArt: true,
        scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH
        },
        dom: {
            createContainer: true
        }
    };

    new Phaser.Game(config);
}

checkAuth();
