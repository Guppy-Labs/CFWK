/**
 * World Time System - Shared between server and client
 * 
 * Time Constants:
 * - 1 in-game day = 15 real minutes (900 seconds)
 * - 1 in-game hour = 37.5 real seconds
 * - 1 in-game minute = 0.625 real seconds
 * - 1 season = 96 in-game days = 1 real day (24 hours)
 * - 1 in-game year = 384 in-game days = 4 real days
 * 
 * Epoch: Year 1, Day 1, 00:00 (Winter) = January 29th, 2026, 12:00 PM PST
 */

// Real-time to game-time conversion
export const REAL_MINUTES_PER_GAME_DAY = 15;
export const REAL_SECONDS_PER_GAME_DAY = REAL_MINUTES_PER_GAME_DAY * 60; // 900
export const REAL_SECONDS_PER_GAME_HOUR = REAL_SECONDS_PER_GAME_DAY / 24; // 37.5
export const REAL_SECONDS_PER_GAME_MINUTE = REAL_SECONDS_PER_GAME_HOUR / 60; // 0.625
export const REAL_MS_PER_GAME_SECOND = (REAL_SECONDS_PER_GAME_MINUTE / 60) * 1000; // ~10.42ms

// Calendar constants
export const DAYS_PER_SEASON = 96;
export const SEASONS_PER_YEAR = 4;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS_PER_YEAR; // 384

// Epoch: January 29th, 2026, 12:00 PM PST (UTC-8)
// PST is UTC-8, so 12:00 PM PST = 20:00 UTC
export const EPOCH_UTC_MS = Date.UTC(2026, 0, 29, 20, 0, 0, 0); // Month is 0-indexed

export enum Season {
    Winter = 0,
    Spring = 1,
    Summer = 2,
    Autumn = 3
}

export const SEASON_NAMES: Record<Season, string> = {
    [Season.Winter]: 'Winter',
    [Season.Spring]: 'Spring',
    [Season.Summer]: 'Summer',
    [Season.Autumn]: 'Autumn'
};

// Daylight hours by season (sunrise hour, sunset hour)
// These define when the sun rises and sets for each season
export const DAYLIGHT_HOURS: Record<Season, { sunrise: number; sunset: number }> = {
    [Season.Winter]: { sunrise: 8, sunset: 17 },   // 9 hours of daylight
    [Season.Spring]: { sunrise: 6, sunset: 19 },   // 13 hours of daylight
    [Season.Summer]: { sunrise: 5, sunset: 21 },   // 16 hours of daylight
    [Season.Autumn]: { sunrise: 7, sunset: 18 }    // 11 hours of daylight
};

export interface WorldTimeState {
    year: number;           // Starting from 1
    season: Season;
    dayOfYear: number;      // 1-384
    dayOfSeason: number;    // 1-96
    hour: number;           // 0-23
    minute: number;         // 0-59
    second: number;         // 0-59
    
    // Derived values for convenience
    seasonName: string;
    isDaytime: boolean;
    sunProgress: number;    // 0-1, where 0.5 is solar noon (only valid during day)
    nightProgress: number;  // 0-1, where 0.5 is midnight (only valid during night)
    brightness: number;     // 0-1, overall ambient brightness
}

/**
 * Calculate the current world time from a real-world timestamp
 */
export function calculateWorldTime(realTimeMs: number = Date.now()): WorldTimeState {
    // Calculate milliseconds since epoch
    const msSinceEpoch = realTimeMs - EPOCH_UTC_MS;
    
    // If before epoch, return day 1
    if (msSinceEpoch < 0) {
        return createTimeState(1, Season.Winter, 1, 0, 0, 0);
    }
    
    // Convert to game seconds
    const gameSeconds = msSinceEpoch / REAL_MS_PER_GAME_SECOND;
    
    // Calculate time components
    const totalGameMinutes = Math.floor(gameSeconds / 60);
    const totalGameHours = Math.floor(totalGameMinutes / 60);
    const totalGameDays = Math.floor(totalGameHours / 24);
    
    const second = Math.floor(gameSeconds) % 60;
    const minute = totalGameMinutes % 60;
    const hour = totalGameHours % 24;
    
    // Calculate calendar (days are 0-indexed internally, 1-indexed for display)
    const dayOfYear = (totalGameDays % DAYS_PER_YEAR) + 1;
    const year = Math.floor(totalGameDays / DAYS_PER_YEAR) + 1;
    
    // Calculate season
    const seasonIndex = Math.floor((dayOfYear - 1) / DAYS_PER_SEASON);
    const season = seasonIndex as Season;
    const dayOfSeason = ((dayOfYear - 1) % DAYS_PER_SEASON) + 1;
    
    return createTimeState(year, season, dayOfSeason, hour, minute, second);
}

/**
 * Create a complete time state object with derived values
 */
function createTimeState(
    year: number,
    season: Season,
    dayOfSeason: number,
    hour: number,
    minute: number,
    second: number
): WorldTimeState {
    const dayOfYear = season * DAYS_PER_SEASON + dayOfSeason;
    const daylight = DAYLIGHT_HOURS[season];
    
    // Calculate current time as decimal hours
    const currentHour = hour + minute / 60 + second / 3600;
    
    // Determine if it's daytime
    const isDaytime = currentHour >= daylight.sunrise && currentHour < daylight.sunset;
    
    // Calculate sun/night progress and brightness
    let sunProgress = 0;
    let nightProgress = 0;
    let brightness = 0;
    
    const nightBaseBrightness = 0.35;
    const nightVariation = 0.02; // subtle variation, mostly consistent darkness
    const dayPeakBrightness = 1.4;

    if (isDaytime) {
        // Daytime: calculate sun progress (0 at sunrise, 0.5 at noon, 1 at sunset)
        const dayLength = daylight.sunset - daylight.sunrise;
        sunProgress = (currentHour - daylight.sunrise) / dayLength;
        
        // Brightness stays high most of the day, with faster changes near sunrise/sunset
        const transitionHours = 2; // ~4 hours total around sunrise+sunset
        const hoursSinceSunrise = currentHour - daylight.sunrise;
        const ramp = (t: number) => t * t * (3 - 2 * t); // smoothstep

        if (hoursSinceSunrise < transitionHours) {
            const t = Phaser.Math.Clamp(hoursSinceSunrise / transitionHours, 0, 1);
            brightness = nightBaseBrightness + (dayPeakBrightness - nightBaseBrightness) * ramp(t);
        } else if (hoursSinceSunrise > dayLength - transitionHours) {
            const t = Phaser.Math.Clamp((dayLength - hoursSinceSunrise) / transitionHours, 0, 1);
            brightness = nightBaseBrightness + (dayPeakBrightness - nightBaseBrightness) * ramp(t);
        } else {
            brightness = dayPeakBrightness;
        }
    } else {
        // Nighttime: calculate night progress
        const nightLength = 24 - (daylight.sunset - daylight.sunrise);
        
        if (currentHour >= daylight.sunset) {
            // After sunset, before midnight
            nightProgress = (currentHour - daylight.sunset) / nightLength;
        } else {
            // After midnight, before sunrise
            const hoursAfterSunset = (24 - daylight.sunset) + currentHour;
            nightProgress = hoursAfterSunset / nightLength;
        }
        
        // Night brightness is mostly constant, slightly darker at midnight
        const nightCurve = Math.cos(nightProgress * Math.PI * 2); // 1 at sunset/sunrise, -1 at midnight
        brightness = nightBaseBrightness + nightVariation * nightCurve;
    }
    
    return {
        year,
        season,
        dayOfYear,
        dayOfSeason,
        hour,
        minute,
        second,
        seasonName: SEASON_NAMES[season],
        isDaytime,
        sunProgress,
        nightProgress,
        brightness
    };
}

/**
 * Format time as HH:MM:SS
 */
export function formatTime(state: WorldTimeState): string {
    const h = state.hour.toString().padStart(2, '0');
    const m = state.minute.toString().padStart(2, '0');
    const s = state.second.toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

/**
 * Format full date and time for debug display
 */
export function formatFullDateTime(state: WorldTimeState): string {
    return `Year ${state.year}, ${state.seasonName} Day ${state.dayOfSeason}/${DAYS_PER_SEASON} (Day ${state.dayOfYear}/${DAYS_PER_YEAR}) - ${formatTime(state)}`;
}
