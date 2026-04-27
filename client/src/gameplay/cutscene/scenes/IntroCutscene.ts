import type { CutsceneStep, CutsceneSceneHost } from '../CutsceneGroupRunner';
import type { ComicPanelCover } from '../CutsceneComicOverlay';

/**
 * Panel regions for the intro comic page (percentage of image dimensions).
 * The first entry starts visible; the rest are covered with white and
 * revealed one-by-one as the player clicks.
 *
 * Layout (3 rows, mixed columns):
 *   Row 1: [clouds]          [cat from behind]
 *   Row 2: [cat face]        [                ]
 *   Row 3: [island / cabin]  [ wide scenic    ]
 *
 * The right column in rows 2-3 is a single tall panel.
 */
const INTRO_COMIC_PANELS: ComicPanelCover[] = [
    { x: 0,    y: 0,    width: 30.5, height: 31   },   // 1 - clouds (visible)
    { x: 30,   y: 0,    width: 70, height: 31   },   // 2 - cat from behind
    { x: 0,    y: 31,   width: 30,   height: 26.5 },   // 3 - cat face close-up
    { x: 0,    y: 57.5, width: 30,   height: 45.5 },   // 4 - island with cabin
    { x: 30,   y: 31,   width: 70,   height: 72   },   // 5 - wide scenic shot
];

export function buildIntroCutsceneSteps(host: CutsceneSceneHost): CutsceneStep[] {
    return [
        // 1. Position player at IntroPlayerLocation, facing up
        {
            kind: 'callback',
            fn: () => {
                const map = host.getMap();
                if (!map) return;
                const poi = host.findPoiPoint(map, 'IntroPlayerLocation');
                if (!poi) return;
                const player = host.getActivePlayer();
                if (player) {
                    player.setPosition(poi.x, poi.y);
                    player.setVelocity(0, 0);
                }
                host.getMcPlayerController()?.setForcedFacingTarget(-Math.PI / 2);
            }
        },

        // 2. Forced dialogue with Papa Cat
        {
            kind: 'forcedDialogue',
            npcId: 'dad',
            npcName: 'Papa Cat',
            lines: [
                { speaker: 'npc', textKey: 'dialogue.npc.dad.intro.0', nameKey: 'npc.dad.name', emotion: 'neutral' },
                { speaker: 'player', textKey: 'dialogue.npc.dad.intro.1' },
                { speaker: 'npc', textKey: 'dialogue.npc.dad.intro.2', nameKey: 'npc.dad.name', emotion: 'shock' },
                { speaker: 'npc', textKey: 'dialogue.npc.dad.intro.3', nameKey: 'npc.dad.name', emotion: 'neutral' },
                { speaker: 'player', textKey: 'dialogue.npc.dad.intro.4' },
                { speaker: 'npc', textKey: 'dialogue.npc.dad.intro.5', nameKey: 'npc.dad.name', emotion: 'surprise' },
                { speaker: 'npc', textKey: 'dialogue.npc.dad.intro.6', nameKey: 'npc.dad.name', emotion: 'surprise' },
                { speaker: 'npc', textKey: 'dialogue.npc.dad.intro.7', nameKey: 'npc.dad.name', emotion: 'sleep' },
                { speaker: 'player', textKey: 'dialogue.npc.dad.intro.8' },
                { speaker: 'npc', textKey: 'dialogue.npc.dad.intro.9', nameKey: 'npc.dad.name', emotion: 'sleep', shake: 'snore', hideSpeakerVisuals: false },
                { speaker: 'player', textKey: 'dialogue.npc.dad.intro.10' },
                { speaker: 'player', textKey: 'dialogue.npc.dad.intro.11' }
            ]
        },

        // 3. Clear forced facing, restore normal camera
        {
            kind: 'callback',
            fn: () => {
                host.getMcPlayerController()?.setForcedFacingTarget(undefined);
            }
        },

        // 4. Free roam - navigate to DockTarget
        {
            kind: 'freeRoam',
            targetPoiName: 'DockTarget',
            arrivalRadiusPx: 20
        },

        // 5. Fade to white via DOM overlay (bypasses post-processing).
        //    The div persists beneath the comic/video overlays (z-index 999 < 1000)
        //    and is cleaned up when the cutscene ends or the page transitions.
        {
            kind: 'callback',
            fn: () => {
                return new Promise<void>((resolve) => {
                    const fade = document.createElement('div');
                    fade.id = 'cutscene-white-fade';
                    Object.assign(fade.style, {
                        position: 'fixed',
                        inset: '0',
                        zIndex: '999',
                        backgroundColor: '#fff',
                        opacity: '0',
                        transition: 'opacity 1200ms ease',
                        pointerEvents: 'none',
                    });
                    document.body.appendChild(fade);
                    requestAnimationFrame(() => {
                        fade.style.opacity = '1';
                        setTimeout(resolve, 1220);
                    });
                });
            }
        },

        // 6. Start cutscene music
        {
            kind: 'callback',
            fn: () => {
                host.getAudioManager()?.playCutsceneMusic('music-intro-sequence', 0.5, true);
            }
        },

        // 7. Comic panels (white background, panels revealed by click)
        {
            kind: 'comic',
            image: '/assets/scene/intro/comic.png',
            panels: INTRO_COMIC_PANELS,
        },

        // 8. Video sequence — splashes then departure
        {
            kind: 'videoSequence',
            segments: [
                {
                    url: '/assets/scene/intro/guppylabs_splash.mp4',
                    backgroundColor: '#fff',
                    objectFit: 'cover',
                    playbackRate: 0.8,
                    skippable: true,
                },
                {
                    url: '/assets/scene/intro/cfwk_splash.mp4',
                    backgroundColor: '#fff',
                    fadeOut: { to: '#000', durationMs: 1400 },
                    skippable: true,
                },
                {
                    url: '/assets/scene/intro/depart.mp4',
                    backgroundColor: '#000',
                    blurredBackground: true,
                }
            ]
        },

        // 9. Clean up white fade, fade out music, and place a persistent
        //    black cover that stays until the new map finishes loading.
        {
            kind: 'callback',
            fn: async () => {
                document.getElementById('cutscene-white-fade')?.remove();
                host.getAudioManager()?.fadeOutCutsceneMusicAndStop(1400);

                const cover = document.createElement('div');
                cover.id = 'cutscene-black-cover';
                Object.assign(cover.style, {
                    position: 'fixed',
                    inset: '0',
                    zIndex: '999',
                    backgroundColor: '#000',
                    pointerEvents: 'none',
                });
                document.body.appendChild(cover);

                await new Promise<void>(r => setTimeout(r, 1500));
            }
        },

        // 10. Map transfer to anchor-hollow
        {
            kind: 'mapTransfer',
            locationId: 'anchor-hollow'
        }
    ];
}
