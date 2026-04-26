import {
    calculateWorldTime,
    WorldTimeState,
    formatFullDateTime,
    Season,
    SEASON_NAMES,
    REAL_MS_PER_GAME_SECOND
} from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';

export type WorldTimeSkipPhase = 'idle' | 'skipToNight' | 'resync';

// One full game day = 24 * 60 * 60 game-seconds of real time
const REAL_MS_PER_GAME_DAY = 24 * 60 * 60 * REAL_MS_PER_GAME_SECOND;

const MAX_TIME_MULTIPLIER = 10;
// Length of the multiplier ramp (accel or decel) in real ms.
const RAMP_DURATION_MS = 800;
// Offset growth during a full decel ramp (multiplier 10 -> 1, linear).
const DECEL_OFFSET_MS = 0.5 * (MAX_TIME_MULTIPLIER - 1) * RAMP_DURATION_MS;
// Perceived game-time growth during a full decel ramp (includes the 1x baseline).
const DECEL_PERCEIVED_MS = 0.5 * (MAX_TIME_MULTIPLIER + 1) * RAMP_DURATION_MS;

// Game hour window that counts as "night" for the bowl quest.
const NIGHT_START_HOUR = 23;
const NIGHT_END_HOUR_EXCLUSIVE = 4;

/**
 * Client-side World Time Manager
 *
 * Syncs with server time state and provides smooth interpolation
 * between server updates. Also owns the per-client time offset used by
 * the Skip to Night quest feature so every consumer pulls a consistent
 * adjusted clock from getTime().
 */
export class WorldTimeManager {
    private static instance: WorldTimeManager;

    private networkManager = NetworkManager.getInstance();
    private currentTime: WorldTimeState;
    private listeners: Set<(time: WorldTimeState) => void> = new Set();

    private serverTime: WorldTimeState | null = null;

    private clientOffsetMs = 0;
    private timeMultiplier = 1;
    private skipPhase: WorldTimeSkipPhase = 'idle';
    private lastSentOffsetMs: number | null = null;

    private constructor() {
        this.currentTime = calculateWorldTime();
    }

    static getInstance(): WorldTimeManager {
        if (!WorldTimeManager.instance) {
            WorldTimeManager.instance = new WorldTimeManager();
        }
        return WorldTimeManager.instance;
    }

    initialize() {
        const room = this.networkManager.getRoom();
        if (room?.state?.worldTime) {
            room.state.worldTime.onChange(() => {
                const wt = room.state.worldTime;
                this.serverTime = {
                    year: wt.year,
                    season: wt.season as Season,
                    dayOfYear: wt.dayOfYear,
                    dayOfSeason: wt.dayOfSeason,
                    hour: wt.hour,
                    minute: wt.minute,
                    second: wt.second,
                    seasonName: SEASON_NAMES[wt.season as Season],
                    isDaytime: wt.brightness > 0.25,
                    sunProgress: 0,
                    nightProgress: 0,
                    brightness: wt.brightness
                };
                this.notifyListeners();
            });
        }
    }

    update(delta: number) {
        if (this.skipPhase !== 'idle') {
            this.advanceSkipPhase(delta);
        }
        // Both client and server use the same shared WorldTime module, so
        // calculating locally provides smoother updates than relying on the
        // 1Hz Colyseus schema sync. The offset lets the client desync for
        // the Skip to Night quest without affecting the rest of the world.
        this.currentTime = calculateWorldTime(Date.now() + this.clientOffsetMs);
    }

    getTime(): WorldTimeState {
        return this.currentTime;
    }

    getBrightness(): number {
        return this.currentTime.brightness;
    }

    isDaytime(): boolean {
        return this.currentTime.isDaytime;
    }

    getSeason(): Season {
        return this.currentTime.season;
    }

    getDebugString(): string {
        return formatFullDateTime(this.currentTime);
    }

    getClientOffsetMs(): number {
        return this.clientOffsetMs;
    }

    getSkipPhase(): WorldTimeSkipPhase {
        return this.skipPhase;
    }

    hasActiveOffset(): boolean {
        return this.clientOffsetMs > 0 || this.skipPhase !== 'idle';
    }

    /**
     * Returns true when the current perceived hour is inside the night
     * window used by the bowl quest (23:00-04:00).
     */
    isInBowlNightWindow(): boolean {
        const hour = this.currentTime.hour;
        return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR_EXCLUSIVE;
    }

    /**
     * Begin accelerating client time until the perceived hour enters the
     * 23:00-04:00 night window. Silently ignored if already active or
     * already night.
     */
    beginSkipToNight(): boolean {
        if (this.skipPhase !== 'idle') return false;
        if (this.isInBowlNightWindow()) return false;
        this.skipPhase = 'skipToNight';
        return true;
    }

    /**
     * Begin the post-quest resync that advances the offset by one full
     * game day (wrapping the clock back onto the server's clock), then
     * snaps the offset to zero so the displayed day silently drops by 1.
     */
    beginResync(): boolean {
        if (this.skipPhase !== 'idle') return false;
        if (this.clientOffsetMs <= 0) return false;
        this.skipPhase = 'resync';
        return true;
    }

    addListener(callback: (time: WorldTimeState) => void): void {
        this.listeners.add(callback);
    }

    removeListener(callback: (time: WorldTimeState) => void): void {
        this.listeners.delete(callback);
    }

    private advanceSkipPhase(delta: number) {
        const shouldDecelerate = this.shouldDecelerate();
        const targetMultiplier = shouldDecelerate ? 1 : MAX_TIME_MULTIPLIER;
        const stepPerMs = (MAX_TIME_MULTIPLIER - 1) / RAMP_DURATION_MS;
        const maxStep = stepPerMs * delta;
        const diff = targetMultiplier - this.timeMultiplier;
        if (Math.abs(diff) <= maxStep) {
            this.timeMultiplier = targetMultiplier;
        } else {
            this.timeMultiplier += Math.sign(diff) * maxStep;
        }

        const offsetGrowth = Math.max(0, (this.timeMultiplier - 1) * delta);
        this.clientOffsetMs += offsetGrowth;

        if (this.timeMultiplier <= 1.0001 && this.hasReachedTarget()) {
            this.finishCurrentPhase();
        }
    }

    private shouldDecelerate(): boolean {
        if (this.skipPhase === 'skipToNight') {
            const remaining = this.getRemainingPerceivedMsToNight();
            return remaining <= DECEL_PERCEIVED_MS;
        }
        if (this.skipPhase === 'resync') {
            const remaining = Math.max(0, REAL_MS_PER_GAME_DAY - this.clientOffsetMs);
            return remaining <= DECEL_OFFSET_MS;
        }
        return true;
    }

    private hasReachedTarget(): boolean {
        if (this.skipPhase === 'skipToNight') {
            return this.isInBowlNightWindow();
        }
        if (this.skipPhase === 'resync') {
            return this.clientOffsetMs >= REAL_MS_PER_GAME_DAY;
        }
        return true;
    }

    private getRemainingPerceivedMsToNight(): number {
        const time = calculateWorldTime(Date.now() + this.clientOffsetMs);
        const currentHour = time.hour + time.minute / 60 + time.second / 3600;
        if (currentHour >= NIGHT_START_HOUR || currentHour < NIGHT_END_HOUR_EXCLUSIVE) {
            return 0;
        }
        const hoursUntilNight = NIGHT_START_HOUR - currentHour;
        return hoursUntilNight * 3600 * REAL_MS_PER_GAME_SECOND;
    }

    private finishCurrentPhase() {
        const phase = this.skipPhase;
        this.timeMultiplier = 1;
        this.skipPhase = 'idle';

        if (phase === 'skipToNight') {
            this.sendOffsetToServer();
            window.dispatchEvent(new CustomEvent('worldTime:skip-complete', {
                detail: { offsetMs: this.clientOffsetMs }
            }));
        } else if (phase === 'resync') {
            this.clientOffsetMs = 0;
            this.sendClearOffsetToServer();
            window.dispatchEvent(new CustomEvent('worldTime:resync-complete'));
        }
    }

    private sendOffsetToServer() {
        const room = this.networkManager.getRoom();
        if (!room) return;
        const offsetMs = Math.max(0, Math.floor(this.clientOffsetMs));
        if (this.lastSentOffsetMs === offsetMs) return;
        this.lastSentOffsetMs = offsetMs;
        try {
            room.send('quest:time-skip', { offsetMs });
        } catch (err) {
            console.warn('[WorldTimeManager] Failed to send quest:time-skip', err);
        }
    }

    private sendClearOffsetToServer() {
        const room = this.networkManager.getRoom();
        this.lastSentOffsetMs = null;
        if (!room) return;
        try {
            room.send('quest:time-skip-clear', {});
        } catch (err) {
            console.warn('[WorldTimeManager] Failed to send quest:time-skip-clear', err);
        }
    }

    private notifyListeners() {
        this.listeners.forEach(callback => callback(this.currentTime));
    }
}
