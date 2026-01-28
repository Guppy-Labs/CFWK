/**
 * LEGACY MAP MAKER ENTRY
 * The custom map editor remains available for legacy content only.
 */
import Phaser from 'phaser';
import { MapMakerScene } from './scenes/MapMakerScene';
import { MapTesterScene } from './scenes/MapTesterScene';

async function init() {
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

        startMapMaker();
    } catch (e) {
        window.location.href = '/login';
    }
}

function startMapMaker() {
    const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        width: window.innerWidth,
        height: window.innerHeight,
        parent: 'app',
        physics: {
            default: 'arcade',
            arcade: {
                gravity: { x: 0, y: 0 },
                debug: false
            }
        },
        scene: [MapMakerScene, MapTesterScene],
        pixelArt: true,
        scale: {
            mode: Phaser.Scale.RESIZE,
            autoCenter: Phaser.Scale.CENTER_BOTH
        },
        dom: {
            createContainer: true
        }
    };

    new Phaser.Game(config);
}

init();

