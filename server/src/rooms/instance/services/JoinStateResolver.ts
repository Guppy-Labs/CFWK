import { Client } from "colyseus";
import {
    DEFAULT_CHARACTER_APPEARANCE,
    DEFAULT_PLAYER_HEARTS_STATE,
    DEFAULT_PLAYER_MONEY_STATE,
    IPlayerHeartsState
} from "@cfwk/shared";
import BannedIP from "../../../models/BannedIP";
import User from "../../../models/User";
import { InstanceRoomHost } from "../context/InstanceRoomHost";

export type JoinResolvedState = {
    isPremium: boolean;
    odcid: string;
    userAppearance: string;
    initialHearts: IPlayerHeartsState;
    initialMoney: number;
    persistedJoinX: number | null;
    persistedJoinY: number | null;
};

export function getClientIP(client: Client): string | null {
    try {
        const req = (client as any).req || (client as any)._req;
        if (req) {
            const forwarded = req.headers["x-forwarded-for"];
            if (forwarded) return forwarded.split(",")[0].trim();
            const realIP = req.headers["x-real-ip"];
            if (realIP) return realIP;
            return req.socket?.remoteAddress || null;
        }
    } catch (e) {
        console.error("[InstanceRoom] Error getting client IP:", e);
    }
    return null;
}

export async function enforceIpBan(clientIP: string | null): Promise<void> {
    if (!clientIP) return;
    try {
        const ipBan = await BannedIP.findOne({ ip: clientIP });
        if (ipBan && ipBan.bannedUntil.getTime() > Date.now()) {
            console.log(`[InstanceRoom] Rejecting IP-banned connection: ${clientIP}`);
            throw new Error(`IP_BANNED|${ipBan.bannedUntil.toISOString()}`);
        }
    } catch (err: any) {
        if (err.message && err.message.startsWith("IP_BANNED|")) throw err;
        console.error("Error checking IP ban:", err);
    }
}

export async function resolveJoinState(
    room: InstanceRoomHost,
    client: Client,
    odcid: string,
    clientIP: string | null
): Promise<JoinResolvedState> {
    let isPremium = false;
    let hasGameAccess = false;
    let userAppearance: string = JSON.stringify(DEFAULT_CHARACTER_APPEARANCE);
    let initialHearts: IPlayerHeartsState = { ...DEFAULT_PLAYER_HEARTS_STATE };
    let initialMoney = DEFAULT_PLAYER_MONEY_STATE.money;
    let persistedJoinX: number | null = null;
    let persistedJoinY: number | null = null;

    if (odcid !== client.sessionId) {
        try {
            const user = await User.findById(odcid);
            if (user && user.bannedUntil && user.bannedUntil.getTime() > Date.now()) {
                console.log(`[InstanceRoom] Rejecting banned user: ${user.username}`);
                throw new Error(`ACCOUNT_BANNED|${user.bannedUntil.toISOString()}`);
            }

            if (user && Array.isArray(user.permissions)) {
                isPremium = user.permissions.includes("premium.shark");
                hasGameAccess = user.permissions.includes("access.game");
            }

            if (user && user.betaAccessUntil && user.betaAccessUntil.getTime() > Date.now()) {
                hasGameAccess = true;
            }

            const appearance = user?.characterAppearance || DEFAULT_CHARACTER_APPEARANCE;
            userAppearance = JSON.stringify(appearance);
            const storedHearts = (user as any)?.hearts;
            if (storedHearts && typeof storedHearts === "object") {
                initialHearts = room.normalizeHeartsState({
                    currentHearts: Number((storedHearts as any).currentHearts),
                    maxHearts: Number((storedHearts as any).maxHearts)
                });
            }
            if (typeof (user as any)?.lastPositionX === "number" && typeof (user as any)?.lastPositionY === "number") {
                persistedJoinX = Number((user as any).lastPositionX);
                persistedJoinY = Number((user as any).lastPositionY);
            }
            initialMoney = room.normalizeMoneyAmount((user as any)?.money);

            if (user && clientIP && user.lastKnownIP !== clientIP) {
                user.lastKnownIP = clientIP;
                await user.save();
            }
        } catch (err: any) {
            if (err.message && err.message.startsWith("ACCOUNT_BANNED|")) throw err;
            console.error("Error checking ban status:", err);
        }
    }

    if (odcid !== client.sessionId && !hasGameAccess) {
        console.log(`[InstanceRoom] Rejecting connection without access: ${odcid}`);
        throw new Error("NO_ACCESS");
    }

    if (odcid !== client.sessionId && room.instanceManager.isUserConnected(odcid)) {
        console.log(`[InstanceRoom] Rejecting duplicate connection for user: ${odcid}`);
        throw new Error("DUPLICATE_CONNECTION");
    }

    if (odcid !== client.sessionId) {
        await room.advancementsManager.initializeUser(odcid);
    }

    return {
        isPremium,
        odcid,
        userAppearance,
        initialHearts,
        initialMoney,
        persistedJoinX,
        persistedJoinY
    };
}

export function registerJoinConnection(room: InstanceRoomHost, client: Client, odcid: string) {
    console.log(`[InstanceRoom] ${client.sessionId} joined instance ${room.instanceId}`);
    if (odcid !== client.sessionId) {
        room.instanceManager.registerUserConnection(odcid, client.sessionId);
        User.updateOne(
            { _id: odcid },
            { $set: { lastLocationId: room.state.locationId } }
        ).catch((err) => {
            console.error("[InstanceRoom] Failed to persist lastLocationId:", err);
        });
    }
    (client as any).odcid = odcid;
}
