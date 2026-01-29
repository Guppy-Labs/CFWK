import { 
    calculateWorldTime, 
    WorldTimeState, 
    formatFullDateTime,
    Season,
    SEASON_NAMES
} from '@cfwk/shared';
import { NetworkManager } from '../network/NetworkManager';

/**
 * Client-side World Time Manager
 * 
 * Syncs with server time state and provides smooth interpolation
 * between server updates. Falls back to local calculation if offline.
 */
export class WorldTimeManager {
    private static instance: WorldTimeManager;
    
    private networkManager = NetworkManager.getInstance();
    private currentTime: WorldTimeState;
    private listeners: Set<(time: WorldTimeState) => void> = new Set();
    
    // Server-synced values (updated less frequently)
    private serverTime: WorldTimeState | null = null;

    private constructor() {
        // Initialize with local calculation
        this.currentTime = calculateWorldTime();
    }

    static getInstance(): WorldTimeManager {
        if (!WorldTimeManager.instance) {
            WorldTimeManager.instance = new WorldTimeManager();
        }
        return WorldTimeManager.instance;
    }

    /**
     * Initialize listening to server time updates
     */
    initialize() {
        const room = this.networkManager.getRoom();
        if (room?.state?.worldTime) {
            // Listen for world time changes from server
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
                    sunProgress: 0, // Can be derived if needed
                    nightProgress: 0,
                    brightness: wt.brightness
                };
                this.notifyListeners();
            });
        }
    }

    /**
     * Update the time (call each frame for smooth interpolation)
     */
    update(_delta: number) {
        // Calculate current time locally for smooth updates
        // Both client and server use the same shared WorldTime module,
        // so local calculation is authoritative and provides smoother updates
        this.currentTime = calculateWorldTime();
    }

    /**
     * Get the current world time state
     */
    getTime(): WorldTimeState {
        return this.currentTime;
    }

    /**
     * Get the current brightness (0-1)
     */
    getBrightness(): number {
        return this.currentTime.brightness;
    }

    /**
     * Check if it's currently daytime
     */
    isDaytime(): boolean {
        return this.currentTime.isDaytime;
    }

    /**
     * Get the current season
     */
    getSeason(): Season {
        return this.currentTime.season;
    }

    /**
     * Get formatted debug string
     */
    getDebugString(): string {
        return formatFullDateTime(this.currentTime);
    }

    /**
     * Add a listener for time changes
     */
    addListener(callback: (time: WorldTimeState) => void): void {
        this.listeners.add(callback);
    }

    /**
     * Remove a listener
     */
    removeListener(callback: (time: WorldTimeState) => void): void {
        this.listeners.delete(callback);
    }

    /**
     * Notify all listeners of time change
     */
    private notifyListeners() {
        this.listeners.forEach(callback => callback(this.currentTime));
    }
}
