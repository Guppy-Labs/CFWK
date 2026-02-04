import Phaser from 'phaser';

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
    
    // Music
    private currentMusic?: Phaser.Sound.BaseSound;
    private musicVolume = AUDIO_CONFIG.music.volume;
    
    // Ambient loops
    private ambientSounds: Map<string, Phaser.Sound.BaseSound> = new Map();
    private ambientVolume = AUDIO_CONFIG.ambient.defaultVolume;
    
    // Footstep timing
    private lastFootstepTime = 0;
    
    // Web Audio filter for water muffle effect
    private lowPassFilter?: BiquadFilterNode;
    
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
        
        this.currentMusic = this.scene.sound.add(key, {
            volume: volume,
            loop: true
        });
        
        this.currentMusic.play();
        this.musicVolume = volume;
        
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
        
        const sound = this.scene.sound.add(key, {
            volume: volume,
            loop: true
        });
        
        sound.play();
        this.ambientSounds.set(key, sound);
        
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
        const volume = cfg.maxVolume - t * (cfg.maxVolume - cfg.minVolume);
        
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
        const volume = cfg.baseVolume + (Math.random() - 0.5) * 2 * cfg.volumeVariation;
        
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
            // At depth 0: 20000Hz (no filter), at max depth: waterDepthFilterMin Hz
            const cfg = AUDIO_CONFIG.footsteps;
            const filterFreq = 20000 - depthRatio * (20000 - cfg.waterDepthFilterMin);
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
    
    /**
     * Set master music volume
     */
    setMusicVolume(volume: number) {
        this.musicVolume = Phaser.Math.Clamp(volume, 0, 1);
        if (this.currentMusic && 'setVolume' in this.currentMusic) {
            (this.currentMusic as Phaser.Sound.WebAudioSound).setVolume(this.musicVolume);
        }
    }
    
    /**
     * Set master ambient volume
     */
    setAmbientVolume(volume: number) {
        this.ambientVolume = Phaser.Math.Clamp(volume, 0, 1);
        this.ambientSounds.forEach(sound => {
            if ('setVolume' in sound) {
                (sound as Phaser.Sound.WebAudioSound).setVolume(this.ambientVolume);
            }
        });
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
        this.ambientSounds.forEach(sound => sound.resume());
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
