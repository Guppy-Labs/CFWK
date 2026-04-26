import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User';
import { InstanceManager } from '../managers/InstanceManager';
import { CommandProcessor } from '../utils/CommandProcessor';
import { CommandAuditLogger } from '../utils/CommandAuditLogger';
import { getUsernameValidationError, normalizeUsername } from '../utils/username';
import { isAuthenticated, requireGameAdmin } from './_adminAuth';

type SortDir = 'asc' | 'desc';
type SortBy =
    | 'createdAt'
    | 'updatedAt'
    | 'username'
    | 'money'
    | 'bannedUntil'
    | 'mutedUntil'
    | 'distanceWalked'
    | 'distanceRan'
    | 'timeOnlineMs'
    | 'catches'
    | 'npcInteractions';

type ModerationAction = 'ban' | 'tempban' | 'mute' | 'tempmute' | 'unban' | 'unmute' | 'send' | 'wipe';

const router = express.Router();

const SORT_FIELD_MAP: Record<SortBy, string> = {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    username: 'username',
    money: 'money',
    bannedUntil: 'bannedUntil',
    mutedUntil: 'mutedUntil',
    distanceWalked: 'playerStats.distanceWalked',
    distanceRan: 'playerStats.distanceRan',
    timeOnlineMs: 'playerStats.timeOnlineMs',
    catches: 'playerStats.catches',
    npcInteractions: 'playerStats.npcInteractions'
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) return false;
    if (Array.isArray(value)) return false;
    return Object.getPrototypeOf(value) === Object.prototype;
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getQueryString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed;
}

function parsePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'string') return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

function parseBooleanFilter(value: unknown): boolean | undefined {
    if (typeof value !== 'string') return undefined;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
}

function parseSortBy(value: unknown): SortBy {
    if (typeof value !== 'string') return 'updatedAt';
    if (Object.prototype.hasOwnProperty.call(SORT_FIELD_MAP, value)) {
        return value as SortBy;
    }
    return 'updatedAt';
}

function parseSortDir(value: unknown): SortDir {
    if (value === 'asc') return 'asc';
    return 'desc';
}

function parseDateFilter(value: unknown): Date | undefined {
    if (typeof value !== 'string') return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
}

function parseStringArrayFilter(value: unknown): string[] {
    if (typeof value !== 'string') return [];
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}

function sanitizeNullableString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function parseNullableDate(value: unknown): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string') return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return undefined;
    return parsed;
}

function parseNullableNumber(value: unknown): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return value;
}

function parseNullableInteger(value: unknown): number | null | undefined {
    const parsed = parseNullableNumber(value);
    if (parsed === undefined || parsed === null) return parsed;
    return Math.trunc(parsed);
}

function parseBooleanValue(value: unknown): boolean | undefined {
    if (typeof value !== 'boolean') return undefined;
    return value;
}

function parseStringArrayValue(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const normalized: string[] = [];
    for (const entry of value) {
        if (typeof entry !== 'string') return undefined;
        const trimmed = entry.trim();
        if (!trimmed) return undefined;
        normalized.push(trimmed);
    }
    return normalized;
}

function parseEquippedUsableIds(value: unknown): Array<string | null> | undefined {
    if (!Array.isArray(value)) return undefined;
    const normalized: Array<string | null> = [];
    for (const entry of value) {
        if (entry === null) {
            normalized.push(null);
            continue;
        }
        if (typeof entry !== 'string') return undefined;
        const trimmed = entry.trim();
        normalized.push(trimmed.length > 0 ? trimmed : null);
    }
    return normalized;
}

function parseEquippedUsableCounts(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const normalized: number[] = [];
    for (const entry of value) {
        if (typeof entry !== 'number' || !Number.isFinite(entry)) return undefined;
        const nextValue = Math.max(0, Math.trunc(entry));
        normalized.push(nextValue);
    }
    return normalized;
}

function parseInventory(value: unknown): Array<{ index: number; itemId: string | null; count: number }> | undefined {
    if (!Array.isArray(value)) return undefined;
    const normalized: Array<{ index: number; itemId: string | null; count: number }> = [];
    for (const entry of value) {
        if (!isPlainObject(entry)) return undefined;
        const rawIndex = entry.index;
        const rawItemId = entry.itemId;
        const rawCount = entry.count;
        if (typeof rawIndex !== 'number' || !Number.isFinite(rawIndex)) return undefined;
        if (typeof rawCount !== 'number' || !Number.isFinite(rawCount)) return undefined;
        if (rawItemId !== null && typeof rawItemId !== 'string') return undefined;
        normalized.push({
            index: Math.max(0, Math.trunc(rawIndex)),
            itemId: typeof rawItemId === 'string' ? rawItemId.trim() : null,
            count: Math.max(0, Math.trunc(rawCount))
        });
    }
    return normalized;
}

function parseGlimmerbowl(value: unknown): unknown[] | undefined {
    if (!Array.isArray(value)) return undefined;
    for (const entry of value) {
        if (!isPlainObject(entry)) return undefined;
    }
    return value;
}

function toCardUserPayload(user: any, connectedUserIds: Set<string>) {
    const userId = String(user._id);
    const now = Date.now();
    const bannedUntil = user.bannedUntil ? new Date(user.bannedUntil) : null;
    const mutedUntil = user.mutedUntil ? new Date(user.mutedUntil) : null;

    return {
        id: userId,
        username: user.username || null,
        email: user.email || null,
        permissions: Array.isArray(user.permissions) ? user.permissions : [],
        isVerified: Boolean(user.isVerified),
        isDemo: Boolean(user.isDemo),
        premiumStatus: user.premiumStatus || null,
        premiumTier: user.premiumTier || null,
        money: Number.isFinite(user.money) ? Number(user.money) : 0,
        lastLocationId: user.lastLocationId || null,
        bannedUntil: bannedUntil ? bannedUntil.toISOString() : null,
        mutedUntil: mutedUntil ? mutedUntil.toISOString() : null,
        isBanned: Boolean(bannedUntil && bannedUntil.getTime() > now),
        isMuted: Boolean(mutedUntil && mutedUntil.getTime() > now),
        isOnline: connectedUserIds.has(userId),
        createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
        updatedAt: user.updatedAt ? new Date(user.updatedAt).toISOString() : null,
        playerStats: user.playerStats || null
    };
}

function toDetailUserPayload(user: any, connectedUserIds: Set<string>) {
    const cardPayload = toCardUserPayload(user, connectedUserIds);
    return {
        ...cardPayload,
        googleId: user.googleId || null,
        discordId: user.discordId || null,
        profilePic: user.profilePic || null,
        status: user.status || null,
        lastUsernameChange: user.lastUsernameChange ? new Date(user.lastUsernameChange).toISOString() : null,
        lastKnownIP: user.lastKnownIP || null,
        inventory: Array.isArray(user.inventory) ? user.inventory : [],
        equippedRodId: user.equippedRodId || null,
        equippedUsableIds: Array.isArray(user.equippedUsableIds) ? user.equippedUsableIds : [],
        equippedUsableCounts: Array.isArray(user.equippedUsableCounts) ? user.equippedUsableCounts : [],
        glimmerbowl: Array.isArray(user.glimmerbowl) ? user.glimmerbowl : [],
        glimmerbowlUnlocked: Boolean(user.glimmerbowlUnlocked),
        hasOwnedScar: Boolean(user.hasOwnedScar),
        characterAppearance: user.characterAppearance || null,
        stripeCustomerId: user.stripeCustomerId || null,
        stripeSubscriptionId: user.stripeSubscriptionId || null,
        premiumCurrentPeriodEnd: user.premiumCurrentPeriodEnd ? new Date(user.premiumCurrentPeriodEnd).toISOString() : null,
        betaAccessUntil: user.betaAccessUntil ? new Date(user.betaAccessUntil).toISOString() : null,
        lastPositionX: typeof user.lastPositionX === 'number' ? user.lastPositionX : null,
        lastPositionY: typeof user.lastPositionY === 'number' ? user.lastPositionY : null,
        settings: user.settings || null,
        hearts: user.hearts || null,
        advancements: user.advancements || null,
        shopWares: user.shopWares || {}
    };
}

function parseAction(value: unknown): ModerationAction | null {
    if (
        value === 'ban' ||
        value === 'tempban' ||
        value === 'mute' ||
        value === 'tempmute' ||
        value === 'unban' ||
        value === 'unmute' ||
        value === 'send' ||
        value === 'wipe'
    ) {
        return value;
    }
    return null;
}

function parseUserIdFromParams(userId: string): mongoose.Types.ObjectId | null {
    if (!mongoose.Types.ObjectId.isValid(userId)) return null;
    return new mongoose.Types.ObjectId(userId);
}

function parseUpdatePayload(input: unknown): { updates: Record<string, unknown>; errors: string[] } {
    if (!isPlainObject(input)) {
        return {
            updates: {},
            errors: ['Invalid update payload.']
        };
    }

    const updates: Record<string, unknown> = {};
    const errors: string[] = [];

    for (const [key, value] of Object.entries(input)) {
        switch (key) {
            case 'username':
            case 'email':
            case 'googleId':
            case 'discordId':
            case 'profilePic':
            case 'status':
            case 'lastKnownIP':
            case 'stripeCustomerId':
            case 'stripeSubscriptionId':
            case 'premiumStatus':
            case 'premiumTier':
            case 'lastLocationId': {
                const parsed = sanitizeNullableString(value);
                updates[key] = parsed;
                break;
            }
            case 'lastUsernameChange':
            case 'bannedUntil':
            case 'mutedUntil':
            case 'premiumCurrentPeriodEnd':
            case 'betaAccessUntil': {
                const parsed = parseNullableDate(value);
                if (parsed === undefined) {
                    errors.push(`Invalid value for ${key}.`);
                    break;
                }
                updates[key] = parsed;
                break;
            }
            case 'isVerified':
            case 'glimmerbowlUnlocked':
            case 'hasOwnedScar':
            case 'isDemo': {
                const parsed = parseBooleanValue(value);
                if (parsed === undefined) {
                    errors.push(`Invalid value for ${key}.`);
                    break;
                }
                updates[key] = parsed;
                break;
            }
            case 'permissions': {
                const parsed = parseStringArrayValue(value);
                if (!parsed) {
                    errors.push('Invalid permissions array.');
                    break;
                }
                updates.permissions = Array.from(new Set(parsed));
                break;
            }
            case 'equippedUsableIds': {
                const parsed = parseEquippedUsableIds(value);
                if (!parsed) {
                    errors.push('Invalid equippedUsableIds array.');
                    break;
                }
                updates.equippedUsableIds = parsed;
                break;
            }
            case 'equippedUsableCounts': {
                const parsed = parseEquippedUsableCounts(value);
                if (!parsed) {
                    errors.push('Invalid equippedUsableCounts array.');
                    break;
                }
                updates.equippedUsableCounts = parsed;
                break;
            }
            case 'lastPositionX':
            case 'lastPositionY': {
                const parsed = parseNullableNumber(value);
                if (parsed === undefined) {
                    errors.push(`Invalid value for ${key}.`);
                    break;
                }
                updates[key] = parsed;
                break;
            }
            case 'money': {
                const parsed = parseNullableInteger(value);
                if (parsed === undefined) {
                    errors.push('Invalid money value.');
                    break;
                }
                updates.money = parsed === null ? 0 : Math.max(0, parsed);
                break;
            }
            case 'inventory': {
                const parsed = parseInventory(value);
                if (!parsed) {
                    errors.push('Invalid inventory payload.');
                    break;
                }
                updates.inventory = parsed;
                break;
            }
            case 'glimmerbowl': {
                const parsed = parseGlimmerbowl(value);
                if (!parsed) {
                    errors.push('Invalid glimmerbowl payload.');
                    break;
                }
                updates.glimmerbowl = parsed;
                break;
            }
            case 'equippedRodId': {
                const parsed = sanitizeNullableString(value);
                updates.equippedRodId = parsed;
                break;
            }
            case 'characterAppearance':
            case 'settings':
            case 'playerStats':
            case 'hearts':
            case 'advancements':
            case 'shopWares': {
                if (!isPlainObject(value)) {
                    errors.push(`Invalid object payload for ${key}.`);
                    break;
                }
                updates[key] = value;
                break;
            }
            default:
                errors.push(`Field '${key}' is not editable.`);
                break;
        }
    }

    return { updates, errors };
}

router.use(isAuthenticated);
router.use(requireGameAdmin);

router.get('/meta/locations', async (_req, res) => {
    try {
        const instanceManager = InstanceManager.getInstance();
        const locations = instanceManager.getRegisteredLocations().map((location) => ({
            id: location.id,
            name: location.name,
            maxPlayers: location.maxPlayers,
            isPublic: location.isPublic
        }));
        return res.json({ locations });
    } catch (error) {
        console.error('[AdminUsers] Failed to load locations:', error);
        return res.status(500).json({ message: 'Failed to load locations' });
    }
});

router.get('/', async (req, res) => {
    try {
        const page = parsePositiveInt(req.query.page, 1, 1, 100000);
        const pageSize = parsePositiveInt(req.query.pageSize, 25, 1, 100);
        const sortBy = parseSortBy(req.query.sortBy);
        const sortDir = parseSortDir(req.query.sortDir);
        const q = getQueryString(req.query.q);

        const activeBan = req.query.activeBan;
        const activeMute = req.query.activeMute;
        const isVerified = parseBooleanFilter(req.query.isVerified);
        const isDemo = parseBooleanFilter(req.query.isDemo);
        const online = req.query.online === 'online' || req.query.online === 'offline' ? req.query.online : undefined;
        const premiumStatus = getQueryString(req.query.premiumStatus);
        const premiumTier = getQueryString(req.query.premiumTier);
        const lastLocationId = getQueryString(req.query.lastLocationId);
        const permissionsFilter = parseStringArrayFilter(req.query.permissions);
        const createdFrom = parseDateFilter(req.query.createdFrom);
        const createdTo = parseDateFilter(req.query.createdTo);
        const updatedFrom = parseDateFilter(req.query.updatedFrom);
        const updatedTo = parseDateFilter(req.query.updatedTo);

        const filter: Record<string, unknown> = {};
        const andFilters: Array<Record<string, unknown>> = [];
        const now = new Date();

        if (q) {
            const orFilters: Array<Record<string, unknown>> = [];
            const escaped = escapeRegex(q);
            const regex = new RegExp(escaped, 'i');
            orFilters.push({ username: regex });
            orFilters.push({ email: regex });
            orFilters.push({ discordId: regex });
            orFilters.push({ googleId: regex });
            orFilters.push({ lastKnownIP: regex });

            if (mongoose.Types.ObjectId.isValid(q)) {
                orFilters.push({ _id: new mongoose.Types.ObjectId(q) });
            }

            andFilters.push({ $or: orFilters });
        }

        if (activeBan === 'true') {
            andFilters.push({ bannedUntil: { $gt: now } });
        } else if (activeBan === 'false') {
            andFilters.push({
                $or: [
                    { bannedUntil: null },
                    { bannedUntil: { $exists: false } },
                    { bannedUntil: { $lte: now } }
                ]
            });
        }

        if (activeMute === 'true') {
            andFilters.push({ mutedUntil: { $gt: now } });
        } else if (activeMute === 'false') {
            andFilters.push({
                $or: [
                    { mutedUntil: null },
                    { mutedUntil: { $exists: false } },
                    { mutedUntil: { $lte: now } }
                ]
            });
        }

        if (isVerified !== undefined) andFilters.push({ isVerified });
        if (isDemo !== undefined) andFilters.push({ isDemo });
        if (premiumStatus) andFilters.push({ premiumStatus });
        if (premiumTier) andFilters.push({ premiumTier });
        if (lastLocationId) andFilters.push({ lastLocationId });
        if (permissionsFilter.length > 0) andFilters.push({ permissions: { $all: permissionsFilter } });

        if (createdFrom || createdTo) {
            const createdAtFilter: Record<string, Date> = {};
            if (createdFrom) createdAtFilter.$gte = createdFrom;
            if (createdTo) createdAtFilter.$lte = createdTo;
            andFilters.push({ createdAt: createdAtFilter });
        }
        if (updatedFrom || updatedTo) {
            const updatedAtFilter: Record<string, Date> = {};
            if (updatedFrom) updatedAtFilter.$gte = updatedFrom;
            if (updatedTo) updatedAtFilter.$lte = updatedTo;
            andFilters.push({ updatedAt: updatedAtFilter });
        }

        const connectedUserIdStrings = InstanceManager.getInstance().getConnectedUserIds();
        const connectedUserIds = connectedUserIdStrings
            .filter((userId) => mongoose.Types.ObjectId.isValid(userId))
            .map((userId) => new mongoose.Types.ObjectId(userId));

        if (online === 'online') {
            andFilters.push({ _id: { $in: connectedUserIds } });
        } else if (online === 'offline' && connectedUserIds.length > 0) {
            andFilters.push({ _id: { $nin: connectedUserIds } });
        }

        if (andFilters.length > 0) {
            filter.$and = andFilters;
        }

        const sortField = SORT_FIELD_MAP[sortBy];
        const sortDirection = sortDir === 'asc' ? 1 : -1;
        const sort: Record<string, 1 | -1> = {
            [sortField]: sortDirection,
            _id: -1
        };

        const projection = [
            'username',
            'email',
            'permissions',
            'isVerified',
            'isDemo',
            'premiumStatus',
            'premiumTier',
            'money',
            'lastLocationId',
            'bannedUntil',
            'mutedUntil',
            'playerStats',
            'createdAt',
            'updatedAt'
        ].join(' ');

        const [total, users] = await Promise.all([
            User.countDocuments(filter),
            User.find(filter)
                .select(projection)
                .sort(sort)
                .skip((page - 1) * pageSize)
                .limit(pageSize)
                .lean()
        ]);

        const connectedSet = new Set(connectedUserIdStrings);
        const items = users.map((user) => toCardUserPayload(user, connectedSet));

        return res.json({
            items,
            page,
            pageSize,
            total
        });
    } catch (error) {
        console.error('[AdminUsers] Failed to list users:', error);
        return res.status(500).json({ message: 'Failed to list users' });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const userId = parseUserIdFromParams(req.params.id);
        if (!userId) return res.status(400).json({ message: 'Invalid user id.' });

        const user = await User.findById(userId).lean();
        if (!user) return res.status(404).json({ message: 'User not found.' });

        const connectedSet = new Set(InstanceManager.getInstance().getConnectedUserIds());
        return res.json({
            user: toDetailUserPayload(user, connectedSet)
        });
    } catch (error) {
        console.error('[AdminUsers] Failed to load user details:', error);
        return res.status(500).json({ message: 'Failed to load user details' });
    }
});

router.patch('/:id', async (req, res) => {
    try {
        const userId = parseUserIdFromParams(req.params.id);
        if (!userId) return res.status(400).json({ message: 'Invalid user id.' });
        if (!isPlainObject(req.body)) return res.status(400).json({ message: 'Invalid payload.' });

        const payload = req.body as Record<string, unknown>;
        const updateRaw = payload.updates;
        const { updates, errors } = parseUpdatePayload(updateRaw);
        if (errors.length > 0) {
            return res.status(400).json({ message: errors[0], errors });
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ message: 'No updates provided.' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found.' });

        if (Object.prototype.hasOwnProperty.call(updates, 'username')) {
            const rawUsername = updates.username;
            if (rawUsername === null) {
                return res.status(400).json({ message: 'Username cannot be cleared.' });
            }
            if (typeof rawUsername !== 'string') {
                return res.status(400).json({ message: 'Invalid username.' });
            }
            const usernameError = getUsernameValidationError(rawUsername);
            if (usernameError) {
                return res.status(400).json({ message: usernameError });
            }
            const normalizedUsername = normalizeUsername(rawUsername);
            if (normalizedUsername.toLowerCase() === 'system') {
                return res.status(400).json({ message: 'Username taken' });
            }
            const duplicate = await User.findOne({ username: normalizedUsername }).select('_id');
            if (duplicate && String(duplicate._id) !== String(user._id)) {
                return res.status(400).json({ message: 'Username taken' });
            }
            updates.username = normalizedUsername;
        }

        if (Object.prototype.hasOwnProperty.call(updates, 'email')) {
            const rawEmail = updates.email;
            if (rawEmail === null || typeof rawEmail !== 'string') {
                return res.status(400).json({ message: 'Email is required.' });
            }
            const normalizedEmail = rawEmail.trim().toLowerCase();
            if (!normalizedEmail.includes('@')) {
                return res.status(400).json({ message: 'Email must be valid.' });
            }
            const duplicate = await User.findOne({ email: normalizedEmail }).select('_id');
            if (duplicate && String(duplicate._id) !== String(user._id)) {
                return res.status(400).json({ message: 'Email already in use.' });
            }
            updates.email = normalizedEmail;
        }

        for (const [key, value] of Object.entries(updates)) {
            user.set(key, value as any);
        }

        await user.save();

        const connectedSet = new Set(InstanceManager.getInstance().getConnectedUserIds());
        return res.json({
            message: 'User updated.',
            user: toDetailUserPayload(user.toObject(), connectedSet)
        });
    } catch (error) {
        console.error('[AdminUsers] Failed to update user:', error);
        return res.status(500).json({ message: 'Failed to update user' });
    }
});

router.post('/:id/actions', async (req, res) => {
    try {
        const targetUserId = parseUserIdFromParams(req.params.id);
        if (!targetUserId) return res.status(400).json({ message: 'Invalid user id.' });
        if (!isPlainObject(req.body)) return res.status(400).json({ message: 'Invalid payload.' });

        const payload = req.body as Record<string, unknown>;
        const action = parseAction(payload.action);
        if (!action) return res.status(400).json({ message: 'Invalid action.' });

        const targetUser = await User.findById(targetUserId).select('_id username');
        if (!targetUser || !targetUser.username) {
            return res.status(404).json({ message: 'Target user not found or has no username.' });
        }

        const issuerId = (req.user as any)?.id || (req.user as any)?._id;
        if (!issuerId) return res.status(401).json({ message: 'Not authenticated' });

        const issuerUser = await User.findById(issuerId).select('_id username email');
        if (!issuerUser) return res.status(401).json({ message: 'Issuer not found.' });

        const args: string[] = [targetUser.username];
        if (action === 'tempban' || action === 'tempmute') {
            const duration = sanitizeNullableString(payload.duration);
            if (!duration) {
                return res.status(400).json({ message: 'Duration is required for temporary actions.' });
            }
            const durationMs = CommandProcessor.parseDuration(duration);
            if (!durationMs) {
                return res.status(400).json({ message: 'Invalid duration format. Use 1d, 2h, 30m, or 10s.' });
            }
            args.push(duration);
        }

        if (action === 'send') {
            const locationIdRaw = sanitizeNullableString(payload.locationId);
            if (!locationIdRaw) {
                return res.status(400).json({ message: 'locationId is required for send.' });
            }
            const locationId = locationIdRaw.toLowerCase();
            const location = InstanceManager.getInstance().getLocationConfig(locationId);
            if (!location) {
                return res.status(400).json({ message: `Unknown server '${locationId}'.` });
            }
            args.push(locationId);
        }

        if (action === 'wipe') {
            const confirmWipe = sanitizeNullableString(payload.confirmWipe);
            if (
                confirmWipe &&
                confirmWipe.toLowerCase() !== targetUser.username.toLowerCase() &&
                confirmWipe !== String(targetUser._id)
            ) {
                return res.status(400).json({ message: 'confirmWipe must match target username (case-insensitive) or user id.' });
            }
        }

        const issuerName = issuerUser.username || issuerUser.email || 'admin';
        const result = await CommandProcessor.handleCommand(
            action,
            args,
            String(issuerUser._id),
            issuerName
        );

        await CommandAuditLogger.log({
            timestamp: new Date().toISOString(),
            playerId: String(issuerUser._id),
            playerUsername: issuerName,
            command: action,
            args,
            success: result.success,
            resultMessage: result.message
        });

        return res.json({
            success: result.success,
            message: result.message,
            command: action,
            args
        });
    } catch (error) {
        console.error('[AdminUsers] Failed to execute action:', error);
        return res.status(500).json({ message: 'Failed to execute action' });
    }
});

export default router;
