import Phaser from 'phaser';
import type { IAudioSettings } from '@cfwk/shared';
import { LocaleManager } from '../i18n/LocaleManager';

// ============================================================
// AUDIO VOLUME CONFIGURATION - Tune these values as needed
// ============================================================
export const AUDIO_CONFIG = {
    // Background Music
    music: {
        volume: 0.15,              // Base music volume (0-1)
    },
    
    // Ambient Sound Loops
    ambient: {
        ocean: 0.35,              // Ocean waves volume
        fire: {
            maxVolume: 0.6,       // Volume when right next to fire
            minVolume: 0.06,      // Minimum volume when far away
            maxDistance: 200,     // Distance (px) at which volume is minimum
        },
        defaultVolume: 0.4,       // Default for unspecified ambient sounds
    },
    
    // Footstep Sounds
    footsteps: {
        baseVolume: 0.4,          // Base footstep volume
        volumeVariation: 0.1,     // Random variation (+/- this amount)
        walkInterval: 350,        // ms between footsteps when walking
        sprintInterval: 280,      // ms between footsteps when sprinting
        pitchMin: 0.85,           // Minimum pitch multiplier
        pitchMax: 1.15,           // Maximum pitch multiplier
        sprintPitchBoost: 1.1,    // Additional pitch boost when sprinting
        wetPitchMultiplier: 0.75, // Pitch multiplier when feet are wet (damp sound)
        // Water depth effects
        waterDepthRateMin: 0.6,   // Playback rate at max depth (slower)
        waterDepthDetuneMax: -400, // Detune in cents at max depth (deeper pitch)
        waterDepthFilterMin: 800, // Low-pass filter frequency at max depth (muffled)
    },
    
    // Player Sounds
    player: {
        meow: {
            volume: 0.5,          // Meow sound volume (0-1)
            cooldown: 1300,       // Cooldown between meows (ms)
        },
    },

    // UI and action SFX
    sfx: {
        rodCast: {
            volume: 0.55,
            rateMin: 0.75,
            rateMax: 1.0,
            detuneMax: 300,
        },
        rodReel: {
            volume: 0.45,
            burstDelayMs: 70,
        },
        waterSplash: {
            volume: 0.55,
        },
        biteAlert: {
            volume: 0.4,
            rateNormal: 1,
            rateFast: 2,
            rateUltra: 4,
            fastThreshold: 0.25,
            ultraThreshold: 0.1,
        },
        reelClick: {
            volume: 2,
            scale: [0, 2, 3, 5, 7, 8, 10, 12],
        },
        itemCollected: {
            volume: 2.5,
        },
        itemDrop: {
            volume: 2.5,
        },
        itemSkip: {
            volume: 1.5,
        },
        dialogueClick: {
            volume: 2,
        },
        dialogueNext: {
            volume: 0.6,
        },
        dialogueEndBurst: {
            count: 2,
            delayMs: 160,
        },
    },
};
// ============================================================

/**
 * Audio Configuration for different map types
 */
export interface MapAudioConfig {
    /** Background music track */
    music?: string;
    /** Ambient sound loops */
    ambientLoops?: string[];
}

/**
 * Predefined audio configurations for maps
 */
export const MAP_AUDIO_CONFIGS: Record<string, MapAudioConfig> = {
    'lobby': {
        music: 'music-beach',
        ambientLoops: ['ambient-ocean', 'ambient-fire'],
    },
    'beach': {
        music: 'music-beach',
        ambientLoops: ['ambient-ocean', 'ambient-fire'],
    }
};

const SUBTITLE_KEYS: Record<string, string> = {
    'ambient-ocean': 'subtitles.ambientOcean',
    'ambient-fire': 'subtitles.ambientFire',
    'footstep-sand': 'subtitles.footstepSand',
    'footstep-water': 'subtitles.footstepWater',
    meow1: 'subtitles.meow',
    meow2: 'subtitles.meow',
    meow3: 'subtitles.meow',
    meow4: 'subtitles.meow',
    'rod-cast': 'subtitles.rodCast',
    'rod-reel': 'subtitles.rodReel',
    'water-splash': 'subtitles.waterSplash',
    'bite-alert': 'subtitles.biteAlert',
    'reel-click': 'subtitles.reelClick',
    'item-collected': 'subtitles.itemCollected',
    'item-drop': 'subtitles.itemDropped',
    'item-skip': 'subtitles.itemSkipped',
    'dialogue-click': 'subtitles.dialogueText',
    'dialogue-next': 'subtitles.dialogueAdvance'
};

/**
 * AudioManager - Handles all game audio including music, ambient sounds, and SFX
 * 
 * Features:
 * - Background music with crossfade between maps
 * - Ambient sound loops (fire, ocean, etc.)
 * - Footstep sounds with pitch/rate variation
 * - Volume controls per category
 */
export class AudioManager {
    private scene: Phaser.Scene;
    private localeManager = LocaleManager.getInstance();
    
    // Music
    private currentMusic?: Phaser.Sound.BaseSound;
    private musicBaseVolume = AUDIO_CONFIG.music.volume;
    
    // Ambient loops
    private ambientSounds: Map<string, Phaser.Sound.BaseSound> = new Map();
    private ambientUserVolume = 1;
    
    // Footstep timing
    private lastFootstepTime = 0;
    
    // Meow timing
    private lastMeowTime = 0;
    
    // Web Audio filter for water muffle effect
    private lowPassFilter?: BiquadFilterNode;
    private dialogueFilter?: BiquadFilterNode;
    private dialogueMuffleActive = false;
    private musicVolumeMultiplier = 1;
    private ambientVolumeMultiplier = 1;
    private sfxVolumeMultiplier = 1;
    private masterVolumeMultiplier = 1;
    private musicUserVolume = 1;
    private playersUserVolume = 1;
    private overlaysUserVolume = 1;
    private subtitlesEnabled = false;
    private stereoEnabled = true;
    private dialogueFilteredSounds = new Set<Phaser.Sound.WebAudioSound>();
    
    // Fire POI positions for distance-based volume
    private firePositions: { x: number; y: number }[] = [];
    
    // State tracking
    private isInitialized = false;
    private currentMapKey?: string;
    
    constructor(scene: Phaser.Scene) {
        this.scene = scene;
    }
    
    /**
     * Preload audio assets
     */
    preload() {
        // Music tracks
        this.scene.load.audio('music-beach', '/audio/tracks/beach.m4a');
        
        // Ambient loops
        this.scene.load.audio('ambient-fire', '/audio/ambient/scene/fire.mp3');
        this.scene.load.audio('ambient-ocean', '/audio/ambient/scene/ocean.mp3');
        
        // Player sounds
        this.scene.load.audio('footstep-sand', '/audio/ambient/player/walk_sand.mp3');
        this.scene.load.audio('footstep-water', '/audio/ambient/player/walk_shallow_water.mp3');
        
        // Meow sounds
        this.scene.load.audio('meow1', '/audio/ambient/player/meows/meow1.mp3');
        this.scene.load.audio('meow2', '/audio/ambient/player/meows/meow2.mp3');
        this.scene.load.audio('meow3', '/audio/ambient/player/meows/meow3.mp3');
        this.scene.load.audio('meow4', '/audio/ambient/player/meows/meow4.mp3');

        // Fishing + UI SFX
        this.scene.load.audio('rod-cast', '/audio/ambient/action/rod-cast.mp3');
        this.scene.load.audio('rod-reel', '/audio/ambient/action/rod-reel.mp3');
        this.scene.load.audio('water-splash', '/audio/ambient/action/water-splash.mp3');
        this.scene.load.audio('bite-alert', '/audio/ambient/ui/alert-1.mp3');
        this.scene.load.audio('reel-click', '/audio/ambient/ui/click-note.mp3');
        this.scene.load.audio('item-collected', '/audio/ambient/ui/item-collected.mp3');
        this.scene.load.audio('item-drop', '/audio/ambient/ui/item-drop.mp3');
        this.scene.load.audio('item-skip', '/audio/ambient/ui/item-skip.mp3');
        this.scene.load.audio('dialogue-click', '/audio/ambient/dialogue/click.mp3');
        this.scene.load.audio('dialogue-next', '/audio/ambient/dialogue/next.mp3');
    }
    
    /**
     * Initialize audio for a specific map
     */
    initialize(mapKey: string) {
        // Extract map name from key (e.g., 'map-lobby' -> 'lobby')
        const mapName = mapKey.replace('map-', '');
        
        if (this.currentMapKey === mapName && this.isInitialized) {
            return; // Already initialized for this map
        }
        
        this.currentMapKey = mapName;
        const config = MAP_AUDIO_CONFIGS[mapName];
        
        if (!config) {
            console.log(`[AudioManager] No audio config for map: ${mapName}`);
            this.isInitialized = true;
            return;
        }
        
        // Start music
        if (config.music) {
            this.playMusic(config.music, AUDIO_CONFIG.music.volume);
        }
        
        // Start ambient loops with per-sound volume from config
        if (config.ambientLoops) {
            config.ambientLoops.forEach(loopKey => {
                const volume = this.getAmbientVolume(loopKey);
                this.playAmbientLoop(loopKey, volume);
            });
        }
        
        this.isInitialized = true;
        console.log(`[AudioManager] Initialized audio for map: ${mapName}`);
    }
    
    /**
     * Register fire positions for distance-based volume
     * Call this after fire effects are set up
     */
    setFirePositions(positions: { x: number; y: number }[]) {
        this.firePositions = positions;
        console.log(`[AudioManager] Registered ${positions.length} fire position(s)`);
    }
    
    /**
     * Get the configured volume for an ambient sound
     */
    private getAmbientVolume(key: string): number {
        if (key === 'ambient-ocean') return AUDIO_CONFIG.ambient.ocean;
        if (key === 'ambient-fire') return AUDIO_CONFIG.ambient.fire.maxVolume;
        return AUDIO_CONFIG.ambient.defaultVolume;
    }

    private getEffectiveMusicVolume(baseVolume: number): number {
        return baseVolume * this.masterVolumeMultiplier * this.musicUserVolume * this.musicVolumeMultiplier;
    }

    private getEffectiveAmbientVolume(baseVolume: number): number {
        return baseVolume * this.masterVolumeMultiplier * this.ambientUserVolume * this.ambientVolumeMultiplier;
    }

    private getEffectivePlayersVolume(baseVolume: number): number {
        return baseVolume * this.masterVolumeMultiplier * this.playersUserVolume * this.sfxVolumeMultiplier;
    }

    private getEffectiveOverlaysVolume(baseVolume: number): number {
        return baseVolume * this.masterVolumeMultiplier * this.overlaysUserVolume * this.sfxVolumeMultiplier;
    }

    private emitSubtitle(soundKey: string) {
        if (!this.subtitlesEnabled) return;
        const key = SUBTITLE_KEYS[soundKey];
        if (!key) return;
        const label = this.localeManager.t(key, undefined, soundKey);

        window.dispatchEvent(new CustomEvent('audio:subtitle', {
            detail: {
                soundKey,
                label
            }
        }));
    }

    private isSoundActivelyPlaying(sound?: Phaser.Sound.BaseSound): boolean {
        if (!sound) return false;
        return sound.isPlaying === true && sound.isPaused !== true;
    }

    private emitAmbientSubtitleIfPlaying(soundKey: string) {
        const sound = this.ambientSounds.get(soundKey);
        if (!this.isSoundActivelyPlaying(sound)) return;
        this.emitSubtitle(soundKey);
    }

    private setStereoEnabled(enabled: boolean) {
        if (this.stereoEnabled === enabled) {
            return;
        }
        this.stereoEnabled = enabled;

        const soundManager = this.scene.sound as Phaser.Sound.WebAudioSoundManager;
        const context = soundManager.context;
        const destination = context?.destination;
        if (!destination) return;

        try {
            destination.channelCountMode = 'explicit';
            destination.channelInterpretation = 'speakers';
            destination.channelCount = enabled ? 2 : 1;
        } catch {
        }
    }
    
    /**
     * Play background music with optional crossfade
     */
    private playMusic(key: string, volume: number = 0.3) {
        // Stop current music if playing
        if (this.currentMusic) {
            this.currentMusic.stop();
            this.currentMusic.destroy();
        }
        
        // Check if audio exists
        if (!this.scene.cache.audio.exists(key)) {
            console.warn(`[AudioManager] Music not found: ${key}`);
            return;
        }
        
        const effectiveVolume = this.getEffectiveMusicVolume(volume);
        this.currentMusic = this.scene.sound.add(key, {
            volume: effectiveVolume,
            loop: true
        });
        
        this.currentMusic.play();
        this.musicBaseVolume = volume;
        if (this.dialogueMuffleActive) {
            this.applyDialogueFilter(this.currentMusic as Phaser.Sound.WebAudioSound);
        }
        
        console.log(`[AudioManager] Playing music: ${key}`);
    }
    
    /**
     * Play an ambient sound loop
     */
    private playAmbientLoop(key: string, volume: number = 0.4) {
        // Check if already playing
        if (this.ambientSounds.has(key)) {
            return;
        }
        
        // Check if audio exists
        if (!this.scene.cache.audio.exists(key)) {
            console.warn(`[AudioManager] Ambient sound not found: ${key}`);
            return;
        }
        
        const effectiveVolume = this.getEffectiveAmbientVolume(volume);
        const sound = this.scene.sound.add(key, {
            volume: effectiveVolume,
            loop: true
        });
        
        sound.play();
        this.ambientSounds.set(key, sound);
        this.emitAmbientSubtitleIfPlaying(key);
        if (this.dialogueMuffleActive) {
            this.applyDialogueFilter(sound as Phaser.Sound.WebAudioSound);
        }
        
        console.log(`[AudioManager] Playing ambient loop: ${key}`);
    }
    
    /**
     * Stop an ambient sound loop
     */
    stopAmbientLoop(key: string) {
        const sound = this.ambientSounds.get(key);
        if (sound) {
            sound.stop();
            sound.destroy();
            this.ambientSounds.delete(key);
        }
    }
    
    /**
     * Update fire volume based on player distance to nearest fire
     * Call this from the game update loop
     */
    updateFireVolume(playerX: number, playerY: number) {
        const fireSound = this.ambientSounds.get('ambient-fire');
        if (!fireSound || this.firePositions.length === 0) return;
        
        // Find distance to nearest fire
        let minDistance = Infinity;
        for (const fire of this.firePositions) {
            const dx = playerX - fire.x;
            const dy = playerY - fire.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < minDistance) {
                minDistance = distance;
            }
        }
        
        // Calculate volume based on distance
        const cfg = AUDIO_CONFIG.ambient.fire;
        const t = Math.min(minDistance / cfg.maxDistance, 1); // 0 = at fire, 1 = far away
        const baseVolume = cfg.maxVolume - t * (cfg.maxVolume - cfg.minVolume);
        const volume = this.getEffectiveAmbientVolume(baseVolume);
        
        // Apply volume (cast to WebAudioSound to access volume setter)
        (fireSound as Phaser.Sound.WebAudioSound).setVolume(volume);
    }
    
    /**
     * Update footstep sounds based on player movement
     * Call this from the game update loop
     * @param isMoving - Is the player moving
     * @param isSprinting - Is the player sprinting
     * @param inWater - Is the player currently in water
     * @param isWet - Does the player have wet feet (recently left water)
     * @param waterDepth - How deep in water (0-3 tiles)
     */
    updateFootsteps(isMoving: boolean, isSprinting: boolean, inWater: boolean = false, isWet: boolean = false, waterDepth: number = 0) {
        if (!isMoving) {
            return;
        }
        
        const now = Date.now();
        const interval = isSprinting 
            ? AUDIO_CONFIG.footsteps.sprintInterval 
            : AUDIO_CONFIG.footsteps.walkInterval;
        
        if (now - this.lastFootstepTime < interval) {
            return;
        }
        
        this.lastFootstepTime = now;
        this.playFootstep(isSprinting, inWater, isWet, waterDepth);
    }
    
    /**
     * Play a single footstep sound with randomized pitch and rate
     * @param isSprinting - Is the player sprinting
     * @param inWater - Is the player in water (plays water sound)
     * @param isWet - Are the player's feet wet (plays damper sand sound)
     * @param waterDepth - How deep in water (0-3 tiles)
     */
    private playFootstep(isSprinting: boolean, inWater: boolean, isWet: boolean, waterDepth: number = 0) {
        // Determine which sound to play
        const soundKey = inWater ? 'footstep-water' : 'footstep-sand';
        
        // Check if audio exists
        if (!this.scene.cache.audio.exists(soundKey)) {
            return;
        }
        
        const cfg = AUDIO_CONFIG.footsteps;
        
        // Random pitch variation
        const pitchRange = cfg.pitchMax - cfg.pitchMin;
        const pitchVariation = cfg.pitchMin + Math.random() * pitchRange;
        
        // Slightly faster playback when sprinting
        const baseRate = isSprinting ? cfg.sprintPitchBoost : 1.0;
        
        // Apply wet pitch reduction if feet are wet but not in water
        const wetMultiplier = (isWet && !inWater) ? cfg.wetPitchMultiplier : 1.0;
        
        // Calculate water depth effect (0 = surface, 1 = max depth effect at ~3 tiles)
        const depthRatio = inWater ? Math.min(1, waterDepth / 3) : 0;
        
        // Apply depth-based rate slowdown
        const depthRateMultiplier = inWater ? (1 - depthRatio * (1 - cfg.waterDepthRateMin)) : 1;
        
        const rate = baseRate * pitchVariation * wetMultiplier * depthRateMultiplier;
        
        // Random volume variation
        const baseVolume = cfg.baseVolume + (Math.random() - 0.5) * 2 * cfg.volumeVariation;
        const volume = this.getEffectivePlayersVolume(baseVolume);
        
        // Calculate detune with depth effect (deeper = lower pitch)
        const baseDetune = (pitchVariation * wetMultiplier - 1) * 200;
        const depthDetune = inWater ? depthRatio * cfg.waterDepthDetuneMax : 0;
        const detune = baseDetune + depthDetune;
        
        // Create and play the sound with variations
        const footstep = this.scene.sound.add(soundKey, {
            volume: volume,
            rate: rate,
            detune: detune
        }) as Phaser.Sound.WebAudioSound;
        
        // Apply low-pass filter for muffle effect when in deep water
        if (inWater && depthRatio > 0 && footstep.source) {
            this.applyWaterFilter(footstep, depthRatio);
        }
        
        footstep.play();
        this.emitSubtitle(soundKey);
        
        // Clean up after playing
        footstep.once('complete', () => {
            footstep.destroy();
        });
    }
    
    /**
     * Apply low-pass filter to muffle sound based on water depth
     */
    private applyWaterFilter(sound: Phaser.Sound.WebAudioSound, depthRatio: number) {
        try {
            const webAudio = this.scene.sound as Phaser.Sound.WebAudioSoundManager;
            const context = webAudio.context;
            
            if (!context || !sound.source) return;
            
            // Create filter if not exists
            if (!this.lowPassFilter) {
                this.lowPassFilter = context.createBiquadFilter();
                this.lowPassFilter.type = 'lowpass';
            }
            
            // Calculate filter frequency (higher = less muffled)
            // At depth 0: 10000Hz (no filter), at max depth: waterDepthFilterMin Hz
            const cfg = AUDIO_CONFIG.footsteps;
            const filterFreq = 10000 - depthRatio * (10000 - cfg.waterDepthFilterMin);
            this.lowPassFilter.frequency.value = filterFreq;
            this.lowPassFilter.Q.value = 1; // Gentle rolloff
            
            // Route audio through filter
            // Note: Phaser's WebAudioSound connects source -> gain -> destination
            // We need to insert filter between gain and destination
            const gainNode = (sound as any).volumeNode as GainNode;
            if (gainNode && webAudio.destination) {
                gainNode.disconnect();
                gainNode.connect(this.lowPassFilter);
                this.lowPassFilter.connect(webAudio.destination);
            }
        } catch (e) {
            // Silently fail if Web Audio API not available
        }
    }

    setDialogueMuffle(active: boolean) {
        if (this.dialogueMuffleActive === active) return;
        this.dialogueMuffleActive = active;

        this.musicVolumeMultiplier = active ? 0.6 : 1;
        this.ambientVolumeMultiplier = active ? 0.5 : 1;
        this.sfxVolumeMultiplier = active ? 0.35 : 1;

        if (this.currentMusic && 'setVolume' in this.currentMusic) {
            this.updateMusicVolume();
            if (active) {
                this.applyDialogueFilter(this.currentMusic as Phaser.Sound.WebAudioSound);
            } else {
                this.removeDialogueFilter(this.currentMusic as Phaser.Sound.WebAudioSound);
            }
        }

        this.ambientSounds.forEach((sound, key) => {
            if ('setVolume' in sound) {
                const baseVolume = this.getAmbientVolume(key);
                (sound as Phaser.Sound.WebAudioSound).setVolume(this.getEffectiveAmbientVolume(baseVolume));
            }
            if (active) {
                this.applyDialogueFilter(sound as Phaser.Sound.WebAudioSound);
            } else {
                this.removeDialogueFilter(sound as Phaser.Sound.WebAudioSound);
            }
        });
    }

    private updateMusicVolume() {
        if (this.currentMusic && 'setVolume' in this.currentMusic) {
            (this.currentMusic as Phaser.Sound.WebAudioSound).setVolume(this.getEffectiveMusicVolume(this.musicBaseVolume));
        }
    }

    private updateAmbientVolumes() {
        this.ambientSounds.forEach((sound, key) => {
            if ('setVolume' in sound) {
                const baseVolume = this.getAmbientVolume(key);
                (sound as Phaser.Sound.WebAudioSound).setVolume(this.getEffectiveAmbientVolume(baseVolume));
            }
        });
    }

    private applyDialogueFilter(sound: Phaser.Sound.WebAudioSound) {
        try {
            if (this.dialogueFilteredSounds.has(sound)) return;
            const webAudio = this.scene.sound as Phaser.Sound.WebAudioSoundManager;
            const context = webAudio.context;
            if (!context || !sound.source) return;

            if (!this.dialogueFilter) {
                this.dialogueFilter = context.createBiquadFilter();
                this.dialogueFilter.type = 'lowpass';
                this.dialogueFilter.frequency.value = 1200;
                this.dialogueFilter.Q.value = 0.9;
            }

            const gainNode = (sound as any).volumeNode as GainNode;
            if (gainNode && webAudio.destination) {
                const shouldConnectFilter = this.dialogueFilteredSounds.size === 0;
                gainNode.disconnect();
                gainNode.connect(this.dialogueFilter);
                if (shouldConnectFilter) {
                    this.dialogueFilter.connect(webAudio.destination);
                }
                this.dialogueFilteredSounds.add(sound);
            }
        } catch (e) {
            // Silently fail if Web Audio API not available
        }
    }

    private removeDialogueFilter(sound: Phaser.Sound.WebAudioSound) {
        try {
            if (!this.dialogueFilteredSounds.has(sound)) return;
            const webAudio = this.scene.sound as Phaser.Sound.WebAudioSoundManager;
            const gainNode = (sound as any).volumeNode as GainNode;
            if (gainNode && webAudio.destination) {
                gainNode.disconnect();
                gainNode.connect(webAudio.destination);
            }
            this.dialogueFilteredSounds.delete(sound);
            if (this.dialogueFilteredSounds.size === 0) {
                this.dialogueFilter?.disconnect();
            }
        } catch (e) {
            // Silently fail if Web Audio API not available
        }
    }
    
    /**
     * Set master music volume
     */
    setMusicVolume(volume: number) {
        this.musicUserVolume = Phaser.Math.Clamp(volume, 0, 1);
        this.updateMusicVolume();
    }
    
    /**
     * Set master ambient volume
     */
    setAmbientVolume(volume: number) {
        this.ambientUserVolume = Phaser.Math.Clamp(volume, 0, 1);
        this.updateAmbientVolumes();
    }

    setMasterVolume(volume: number) {
        this.masterVolumeMultiplier = Phaser.Math.Clamp(volume, 0, 1);
        this.updateMusicVolume();
        this.updateAmbientVolumes();
    }

    setPlayersVolume(volume: number) {
        this.playersUserVolume = Phaser.Math.Clamp(volume, 0, 1);
    }

    setOverlaysVolume(volume: number) {
        this.overlaysUserVolume = Phaser.Math.Clamp(volume, 0, 1);
    }

    applyUserAudioSettings(settings: IAudioSettings) {
        const wasSubtitlesEnabled = this.subtitlesEnabled;
        this.setMasterVolume(settings.master);
        this.setMusicVolume(settings.music);
        this.setAmbientVolume(settings.ambient);
        this.setPlayersVolume(settings.players);
        this.setOverlaysVolume(settings.overlays);
        this.subtitlesEnabled = Boolean(settings.subtitlesEnabled);
        this.setStereoEnabled(Boolean(settings.stereoEnabled));
        window.dispatchEvent(new CustomEvent('audio:subtitles-enabled-changed', {
            detail: {
                enabled: this.subtitlesEnabled
            }
        }));

        if (!wasSubtitlesEnabled && this.subtitlesEnabled) {
            this.ambientSounds.forEach((sound, key) => {
                if (this.isSoundActivelyPlaying(sound)) {
                    this.emitSubtitle(key);
                }
            });
        }
    }
    
    /**
     * Pause all audio (e.g., when game loses focus)
     */
    pause() {
        this.currentMusic?.pause();
        this.ambientSounds.forEach(sound => sound.pause());
    }
    
    /**
     * Resume all audio
     */
    resume() {
        this.currentMusic?.resume();
        this.ambientSounds.forEach((sound, key) => {
            sound.resume();
            this.emitAmbientSubtitleIfPlaying(key);
        });
    }
    
    /**
     * Play a random meow sound (with cooldown)
     * @returns true if meow was played, false if on cooldown
     */
    playMeow(): boolean {
        const now = Date.now();
        const cooldown = AUDIO_CONFIG.player.meow.cooldown;
        
        // Check cooldown
        if (now - this.lastMeowTime < cooldown) {
            return false;
        }
        
        this.lastMeowTime = now;
        
        // Pick a random meow (1-4)
        const meowIndex = Phaser.Math.Between(1, 4);
        const meowKey = `meow${meowIndex}`;
        
        // Play the meow
        this.scene.sound.play(meowKey, {
            volume: this.getEffectivePlayersVolume(AUDIO_CONFIG.player.meow.volume)
        });
        this.emitSubtitle(meowKey);
        
        return true;
    }

    playRodCast(distanceRatio: number) {
        if (!this.scene.cache.audio.exists('rod-cast')) return;
        const cfg = AUDIO_CONFIG.sfx.rodCast;
        const ratio = Phaser.Math.Clamp(distanceRatio, 0, 1);
        const rate = Phaser.Math.Linear(cfg.rateMax, cfg.rateMin, ratio);
        const detune = cfg.detuneMax * ratio;
        const sound = this.scene.sound.add('rod-cast', {
            volume: this.getEffectivePlayersVolume(cfg.volume),
            rate,
            detune
        }) as Phaser.Sound.WebAudioSound;
        sound.play();
        this.emitSubtitle('rod-cast');
        sound.once('complete', () => sound.destroy());
    }

    playRodReel() {
        if (!this.scene.cache.audio.exists('rod-reel')) return;
        const cfg = AUDIO_CONFIG.sfx.rodReel;
        const sound = this.scene.sound.add('rod-reel', {
            volume: this.getEffectivePlayersVolume(cfg.volume)
        }) as Phaser.Sound.WebAudioSound;
        sound.play();
        this.emitSubtitle('rod-reel');
        sound.once('complete', () => sound.destroy());
    }

    playRodReelBurst(count: number) {
        const cfg = AUDIO_CONFIG.sfx.rodReel;
        for (let i = 0; i < count; i += 1) {
            this.scene.time.delayedCall(i * cfg.burstDelayMs, () => {
                this.playRodReel();
            });
        }
    }

    playWaterSplash() {
        if (!this.scene.cache.audio.exists('water-splash')) return;
        const cfg = AUDIO_CONFIG.sfx.waterSplash;
        const sound = this.scene.sound.add('water-splash', {
            volume: this.getEffectivePlayersVolume(cfg.volume)
        }) as Phaser.Sound.WebAudioSound;
        sound.play();
        this.emitSubtitle('water-splash');
        sound.once('complete', () => sound.destroy());
    }

    startBiteAlertLoop(): Phaser.Sound.WebAudioSound | undefined {
        if (!this.scene.cache.audio.exists('bite-alert')) return undefined;
        const cfg = AUDIO_CONFIG.sfx.biteAlert;
        const sound = this.scene.sound.add('bite-alert', {
            volume: this.getEffectiveOverlaysVolume(cfg.volume),
            loop: true
        }) as Phaser.Sound.WebAudioSound;
        sound.play();
        this.emitSubtitle('bite-alert');
        return sound;
    }

    updateBiteAlertLoop(sound: Phaser.Sound.WebAudioSound, remainingRatio: number) {
        const cfg = AUDIO_CONFIG.sfx.biteAlert;
        let rate = cfg.rateNormal;
        if (remainingRatio <= cfg.ultraThreshold) {
            rate = cfg.rateUltra;
        } else if (remainingRatio <= cfg.fastThreshold) {
            rate = cfg.rateFast;
        }
        sound.setRate(rate);
    }

    stopBiteAlertLoop(sound?: Phaser.Sound.WebAudioSound) {
        if (!sound) return;
        sound.stop();
        sound.destroy();
    }

    playReelClick(noteIndex: number) {
        if (!this.scene.cache.audio.exists('reel-click')) return;
        const cfg = AUDIO_CONFIG.sfx.reelClick;
        const scale = cfg.scale;
        const normalizedIndex = Math.max(0, noteIndex);
        const scaleStep = scale[normalizedIndex % scale.length] ?? 0;
        const octaveOffset = Math.floor(normalizedIndex / scale.length) * 12;
        const detune = (scaleStep + octaveOffset) * 100;
        const sound = this.scene.sound.add('reel-click', {
            volume: this.getEffectiveOverlaysVolume(cfg.volume),
            detune
        }) as Phaser.Sound.WebAudioSound;
        sound.play();
        this.emitSubtitle('reel-click');
        sound.once('complete', () => sound.destroy());
    }

    playItemCollected() {
        if (!this.scene.cache.audio.exists('item-collected')) return;
        const cfg = AUDIO_CONFIG.sfx.itemCollected;
        this.scene.sound.play('item-collected', {
            volume: this.getEffectiveOverlaysVolume(cfg.volume)
        });
        this.emitSubtitle('item-collected');
    }

    playItemDrop() {
        if (!this.scene.cache.audio.exists('item-drop')) return;
        const cfg = AUDIO_CONFIG.sfx.itemDrop;
        this.scene.sound.play('item-drop', {
            volume: this.getEffectiveOverlaysVolume(cfg.volume)
        });
        this.emitSubtitle('item-drop');
    }

    playItemSkip() {
        if (!this.scene.cache.audio.exists('item-skip')) return;
        const cfg = AUDIO_CONFIG.sfx.itemSkip;
        this.scene.sound.play('item-skip', {
            volume: this.getEffectiveOverlaysVolume(cfg.volume)
        });
        this.emitSubtitle('item-skip');
    }

    playDialogueClick() {
        if (!this.scene.cache.audio.exists('dialogue-click')) return;
        const cfg = AUDIO_CONFIG.sfx.dialogueClick;
        this.playDialogueSfxUnfiltered('dialogue-click', this.getEffectiveOverlaysVolume(cfg.volume));
        this.emitSubtitle('dialogue-click');
    }

    playDialogueNext() {
        if (!this.scene.cache.audio.exists('dialogue-next')) return;
        const cfg = AUDIO_CONFIG.sfx.dialogueNext;
        this.playDialogueSfxUnfiltered('dialogue-next', this.getEffectiveOverlaysVolume(cfg.volume));
        this.emitSubtitle('dialogue-next');
    }

    playDialogueEndBurst() {
        if (!this.scene.cache.audio.exists('dialogue-next')) return;
        const cfg = AUDIO_CONFIG.sfx.dialogueEndBurst;
        for (let i = 0; i < cfg.count; i += 1) {
            this.scene.time.delayedCall(i * cfg.delayMs, () => {
                this.playDialogueNext();
            });
        }
    }

    private playDialogueSfxUnfiltered(key: string, volume: number) {
        const sound = this.scene.sound.add(key, {
            volume
        }) as Phaser.Sound.WebAudioSound;

        if (this.dialogueFilteredSounds.has(sound)) {
            this.removeDialogueFilter(sound);
        }

        sound.play();
        sound.once('complete', () => sound.destroy());
    }
    
    /**
     * Stop and clean up all audio
     */
    destroy() {
        // Stop music
        if (this.currentMusic) {
            this.currentMusic.stop();
            this.currentMusic.destroy();
            this.currentMusic = undefined;
        }
        
        // Stop all ambient sounds
        this.ambientSounds.forEach(sound => {
            sound.stop();
            sound.destroy();
        });
        this.ambientSounds.clear();
        
        this.isInitialized = false;
        this.currentMapKey = undefined;
        
        console.log('[AudioManager] Destroyed');
    }
}
