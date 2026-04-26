import type { CutsceneStep, CutsceneSceneHost } from '../CutsceneGroupRunner';

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
                { speaker: 'npc', textKey: 'dialogue.npc.dad.intro.9', nameKey: 'npc.dad.name', emotion: 'sleep', hideSpeakerVisuals: false },
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

        // 5. Fade to black
        {
            kind: 'callback',
            fn: () => {
                return new Promise<void>((resolve) => {
                    host.scene.cameras.main.fadeOut(1200, 0, 0, 0);
                    host.scene.cameras.main.once('camerafadeoutcomplete', () => resolve());
                });
            }
        },

        // 6. Video sequence - 3 videos with continuous music
        {
            kind: 'videoSequence',
            segments: [
                {
                    url: '/assets/scene/intro/depart.mp4',
                    backgroundColor: '#000',
                    musicKey: 'music-intro-sequence'
                },
                {
                    url: '/assets/scene/intro/guppylabs_splash.mp4',
                    backgroundColor: '#fff',
                    fadeIn: { from: '#000', durationMs: 1400 },
                    playbackRate: 0.8
                },
                {
                    url: '/assets/scene/intro/cfwk_splash.mp4',
                    backgroundColor: '#fff',
                    fadeOut: { to: '#000', durationMs: 1400 }
                }
            ]
        },

        // 7. Comic panels
        {
            kind: 'comic',
            images: [
                '/assets/scene/intro/comic/1.png',
                '/assets/scene/intro/comic/2.png',
                '/assets/scene/intro/comic/3.png',
                '/assets/scene/intro/comic/4.png'
            ],
            backgroundColor: '#000'
        },

        // 8. Final video - sink (continue intro cutscene music)
        {
            kind: 'videoSequence',
            segments: [
                {
                    url: '/assets/scene/intro/sink.mp4',
                    backgroundColor: '#080c18'
                }
            ]
        },

        // 9. Fade out cutscene music after final video
        {
            kind: 'callback',
            fn: () => host.getAudioManager()?.fadeOutCutsceneMusicAndStop(1400)
        },

        // 10. Map transfer to anchor-hollow
        {
            kind: 'mapTransfer',
            locationId: 'anchor-hollow'
        }
    ];
}
