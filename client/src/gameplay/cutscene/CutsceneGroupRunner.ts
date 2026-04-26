import Phaser from 'phaser';
import type { DialogueLine } from '../dialogue/DialogueTypes';
import { CutsceneVideoPlayer, type VideoSegment } from './CutsceneVideoPlayer';
import { CutsceneComicOverlay } from './CutsceneComicOverlay';
import { CutsceneNavOverlay } from './CutsceneNavOverlay';
import type { AudioManager } from '../audio/AudioManager';

export type CutsceneStep =
    | { kind: 'forcedDialogue'; npcId: string; npcName?: string; lines: DialogueLine[] }
    | { kind: 'freeRoam'; targetPoiName: string; arrivalRadiusPx?: number; onStart?: () => void }
    | { kind: 'videoSequence'; segments: VideoSegment[] }
    | { kind: 'comic'; images: string[]; backgroundColor?: string }
    | { kind: 'mapTransfer'; locationId: string }
    | { kind: 'callback'; fn: () => void | Promise<void> };

export interface CutsceneSceneHost {
    scene: Phaser.Scene;
    getActivePlayer(): Phaser.Physics.Matter.Sprite | undefined;
    getAudioManager(): AudioManager | undefined;
    findPoiPoint(map: Phaser.Tilemaps.Tilemap, name: string): { x: number; y: number } | null;
    getMap(): Phaser.Tilemaps.Tilemap | undefined;
    beginServerTransfer(locationId: string, forceMapSpawn?: boolean): void;
    getMcPlayerController(): { setForcedFacingTarget(angle?: number): void; getMobileControls(): { setInputBlocked(b: boolean): void } | undefined } | undefined;
}

export class CutsceneGroupRunner {
    private host: CutsceneSceneHost;
    private steps: CutsceneStep[];
    private onComplete: () => void;
    private currentStepIndex = 0;
    private destroyed = false;
    private videoPlayer?: CutsceneVideoPlayer;
    private comicOverlay?: CutsceneComicOverlay;
    private navOverlay?: CutsceneNavOverlay;
    private dialogueCompleteHandler?: EventListener;
    private freeRoamActive = false;
    private freeRoamResolveFn?: () => void;
    private freeRoamEligibleAt = 0;
    private mapAudioPaused = false;
    private readonly mapAudioFadeOutMs = 700;

    constructor(host: CutsceneSceneHost, steps: CutsceneStep[], onComplete: () => void) {
        this.host = host;
        this.steps = steps;
        this.onComplete = onComplete;

        this.preloadAssets();
        this.blockInput(true);
        void this.runSteps();
    }

    private preloadAssets(): void {
        const videoUrls: string[] = [];
        for (const step of this.steps) {
            if (step.kind === 'videoSequence') {
                for (const seg of step.segments) {
                    videoUrls.push(seg.url);
                }
            }
            if (step.kind === 'comic') {
                for (const src of step.images) {
                    const img = new Image();
                    img.src = src;
                }
            }
        }
        if (videoUrls.length > 0) {
            this.videoPlayer = new CutsceneVideoPlayer();
            this.videoPlayer.preloadVideos(videoUrls);
        }
    }

    private blockInput(blocked: boolean): void {
        this.host.scene.registry.set('inputBlocked', blocked);
        this.host.getMcPlayerController()?.getMobileControls()?.setInputBlocked(blocked);
    }

    private async pauseMapAudio(): Promise<void> {
        if (this.mapAudioPaused) return;
        this.mapAudioPaused = true;
        const audioManager = this.host.getAudioManager();
        if (!audioManager) return;
        await audioManager.fadeOutMapAudioAndPause(this.mapAudioFadeOutMs);
    }

    private resumeMapAudio(): void {
        if (!this.mapAudioPaused) return;
        this.mapAudioPaused = false;
        this.host.getAudioManager()?.resume();
    }

    private async runSteps(): Promise<void> {
        while (this.currentStepIndex < this.steps.length && !this.destroyed) {
            const step = this.steps[this.currentStepIndex];

            if (step.kind !== 'freeRoam') {
                this.blockInput(true);
            }

            await this.executeStep(step);
            this.currentStepIndex++;
        }

        if (!this.destroyed) {
            this.resumeMapAudio();
            this.onComplete();
        }
    }

    private async executeStep(step: CutsceneStep): Promise<void> {
        switch (step.kind) {
            case 'forcedDialogue':
                return this.executeForcedDialogue(step);
            case 'freeRoam':
                return this.executeFreeRoam(step);
            case 'videoSequence':
                return this.executeVideoSequence(step);
            case 'comic':
                return this.executeComic(step);
            case 'mapTransfer':
                return this.executeMapTransfer(step);
            case 'callback':
                return this.executeCallback(step);
        }
    }

    private executeForcedDialogue(step: Extract<CutsceneStep, { kind: 'forcedDialogue' }>): Promise<void> {
        return new Promise<void>((resolve) => {
            if (this.destroyed) { resolve(); return; }

            const expectedNpcId = step.npcId;
            this.dialogueCompleteHandler = ((event: Event) => {
                const detail = (event as CustomEvent<{ npcId: string }>).detail;
                if (detail?.npcId === expectedNpcId) {
                    window.removeEventListener('dialogue:complete', this.dialogueCompleteHandler!);
                    this.dialogueCompleteHandler = undefined;
                    this.blockInput(true);
                    resolve();
                }
            }) as EventListener;

            window.addEventListener('dialogue:complete', this.dialogueCompleteHandler);

            window.dispatchEvent(new CustomEvent('dialogue:forced', {
                detail: {
                    npcId: step.npcId,
                    npcName: step.npcName,
                    lines: step.lines
                }
            }));
        });
    }

    private executeFreeRoam(step: Extract<CutsceneStep, { kind: 'freeRoam' }>): Promise<void> {
        return new Promise<void>((resolve) => {
            if (this.destroyed) { resolve(); return; }

            const map = this.host.getMap();
            if (!map) {
                console.warn('[CutsceneRunner] Map not available for freeRoam step');
                resolve();
                return;
            }

            const target = this.host.findPoiPoint(map, step.targetPoiName);
            if (!target) {
                console.warn(`[CutsceneRunner] POI not found: ${step.targetPoiName}`);
                resolve();
                return;
            }

            step.onStart?.();

            this.blockInput(false);

            const arrivalRadius = step.arrivalRadiusPx ?? 48;
            this.navOverlay = new CutsceneNavOverlay(this.host.scene, arrivalRadius);
            this.navOverlay.setTarget(target.x, target.y);

            this.freeRoamActive = true;
            this.freeRoamEligibleAt = Date.now() + 1500;
            this.freeRoamResolveFn = () => {
                this.freeRoamActive = false;
                this.freeRoamResolveFn = undefined;
                this.navOverlay?.destroy();
                this.navOverlay = undefined;
                this.blockInput(true);
                resolve();
            };
        });
    }

    private async executeVideoSequence(step: Extract<CutsceneStep, { kind: 'videoSequence' }>): Promise<void> {
        if (this.destroyed) return;
        const audioManager = this.host.getAudioManager();

        await this.pauseMapAudio();

        if (!this.videoPlayer) {
            this.videoPlayer = new CutsceneVideoPlayer();
        }

        for (const segment of step.segments) {
            if (this.destroyed) return;

            if (segment.musicKey && audioManager) {
                audioManager.playCutsceneMusic(segment.musicKey, 0.5, true);
            }
            if (segment.musicStop && audioManager) {
                audioManager.stopCutsceneMusic();
            }

            await this.videoPlayer.playSegment(segment);
        }
    }

    private async executeComic(step: Extract<CutsceneStep, { kind: 'comic' }>): Promise<void> {
        if (this.destroyed) return;

        await this.pauseMapAudio();

        this.comicOverlay = new CutsceneComicOverlay();
        await this.comicOverlay.show({
            images: step.images,
            backgroundColor: step.backgroundColor
        });

        if (this.destroyed) return;
        await this.comicOverlay.fadeOut(500);

        this.comicOverlay.destroy();
        this.comicOverlay = undefined;
    }

    private executeMapTransfer(step: Extract<CutsceneStep, { kind: 'mapTransfer' }>): Promise<void> {
        if (this.destroyed) return Promise.resolve();

        this.videoPlayer?.destroy();
        this.videoPlayer = undefined;
        this.comicOverlay?.destroy();
        this.comicOverlay = undefined;

        this.resumeMapAudio();
        this.blockInput(false);

        this.host.beginServerTransfer(step.locationId, true);
        return new Promise<void>(() => {});
    }

    private async executeCallback(step: Extract<CutsceneStep, { kind: 'callback' }>): Promise<void> {
        if (this.destroyed) return;
        await step.fn();
    }

    update(time: number, _delta: number): void {
        if (!this.freeRoamActive || !this.navOverlay || !this.freeRoamResolveFn) return;

        const player = this.host.getActivePlayer();
        if (!player) return;

        this.navOverlay.update(
            player.x,
            player.y,
            player.depth ?? 500,
            time
        );

        if (Date.now() < this.freeRoamEligibleAt) return;

        const dx = this.navOverlay.getTargetX() - player.x;
        const dy = this.navOverlay.getTargetY() - player.y;
        const distance = Math.hypot(dx, dy);

        if (distance <= this.navOverlay.getArrivalRadius()) {
            this.freeRoamResolveFn();
        }
    }

    destroy(): void {
        this.destroyed = true;
        this.freeRoamActive = false;

        if (this.freeRoamResolveFn) {
            this.freeRoamResolveFn();
        }

        if (this.dialogueCompleteHandler) {
            window.removeEventListener('dialogue:complete', this.dialogueCompleteHandler);
            this.dialogueCompleteHandler = undefined;
        }

        this.resumeMapAudio();

        this.videoPlayer?.destroy();
        this.videoPlayer = undefined;

        this.comicOverlay?.destroy();
        this.comicOverlay = undefined;

        this.navOverlay?.destroy();
        this.navOverlay = undefined;
    }
}
