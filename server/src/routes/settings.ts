import express from 'express';
import User from '../models/User';
import { DEFAULT_USER_SETTINGS, IAudioSettings, IUserSettings } from '@cfwk/shared';

const router = express.Router();

function isAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ message: 'Not authenticated' });
}

router.use(isAuthenticated);

const clamp01 = (value: any, fallback: number) => {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, Number(value)));
};

const normalizeAudio = (audio: any, fallback: IAudioSettings): IAudioSettings => ({
    master: clamp01(audio?.master, fallback.master),
    music: clamp01(audio?.music, fallback.music),
    ambient: clamp01(audio?.ambient, fallback.ambient),
    players: clamp01(audio?.players, fallback.players),
    overlays: clamp01(audio?.overlays, fallback.overlays),
    subtitlesEnabled: typeof audio?.subtitlesEnabled === 'boolean' ? audio.subtitlesEnabled : fallback.subtitlesEnabled,
    stereoEnabled: typeof audio?.stereoEnabled === 'boolean' ? audio.stereoEnabled : fallback.stereoEnabled
});

const normalizeSettings = (settings: any, fallback: IUserSettings): IUserSettings => ({
    audio: normalizeAudio(settings?.audio, fallback.audio)
});

router.get('/', async (req, res) => {
    try {
        const user = await User.findById((req.user as any).id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const normalized = normalizeSettings(user.settings ?? DEFAULT_USER_SETTINGS, DEFAULT_USER_SETTINGS);
        res.json({ settings: normalized });
    } catch (e) {
        console.error('[Settings] Error fetching settings:', e);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/', async (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ message: 'Invalid settings payload' });
        }

        const user = await User.findById((req.user as any).id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const current = normalizeSettings(user.settings ?? DEFAULT_USER_SETTINGS, DEFAULT_USER_SETTINGS);
        const next = normalizeSettings(settings, current);

        user.settings = next;
        await user.save();

        res.json({ settings: next });
    } catch (e) {
        console.error('[Settings] Error updating settings:', e);
        res.status(500).json({ message: 'Server error' });
    }
});

export default router;
