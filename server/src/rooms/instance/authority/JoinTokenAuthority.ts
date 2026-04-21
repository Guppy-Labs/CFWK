import { createHmac, randomUUID, timingSafeEqual } from "crypto";

export type JoinTokenIssueInput = {
    userId: string;
    instanceId: string;
    locationId: string;
    roomName: string;
    forceMapSpawn?: boolean;
};

export type JoinTokenPayload = {
    v: 1;
    uid: string;
    iid: string;
    lid: string;
    room: string;
    rsp?: 1;
    iat: number;
    exp: number;
    nonce: string;
};

const JOIN_TOKEN_VERSION = "v1";
const JOIN_TOKEN_TTL_MS = Math.max(
    15_000,
    Number.isFinite(Number(process.env.INSTANCE_JOIN_TOKEN_TTL_MS))
        ? Number(process.env.INSTANCE_JOIN_TOKEN_TTL_MS)
        : 90_000
);

function getJoinTokenSecret(): string {
    return (
        process.env.INSTANCE_JOIN_TOKEN_SECRET ||
        process.env.SESSION_SECRET ||
        "super_secret_key_cfwk"
    );
}

function toBase64Url(value: string): string {
    return Buffer.from(value, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
    const normalized = value
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Buffer.from(normalized, "base64").toString("utf8");
}

function signEncodedPayload(encodedPayload: string): string {
    const digest = createHmac("sha256", getJoinTokenSecret())
        .update(`${JOIN_TOKEN_VERSION}.${encodedPayload}`)
        .digest("base64");
    return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeCompare(a: string, b: string): boolean {
    const aBuffer = Buffer.from(a, "utf8");
    const bBuffer = Buffer.from(b, "utf8");
    if (aBuffer.length !== bBuffer.length) return false;
    return timingSafeEqual(aBuffer, bBuffer);
}

export function issueJoinToken(input: JoinTokenIssueInput): { token: string; expiresAt: number } {
    const now = Date.now();
    const payload: JoinTokenPayload = {
        v: 1,
        uid: input.userId,
        iid: input.instanceId,
        lid: input.locationId,
        room: input.roomName,
        ...(input.forceMapSpawn ? { rsp: 1 } : {}),
        iat: now,
        exp: now + JOIN_TOKEN_TTL_MS,
        nonce: randomUUID()
    };

    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signature = signEncodedPayload(encodedPayload);
    return {
        token: `${JOIN_TOKEN_VERSION}.${encodedPayload}.${signature}`,
        expiresAt: payload.exp
    };
}

export function verifyJoinToken(token: string): { valid: boolean; payload?: JoinTokenPayload; reason?: string } {
    if (!token || typeof token !== "string") {
        return { valid: false, reason: "missing-token" };
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
        return { valid: false, reason: "malformed-token" };
    }

    const [version, encodedPayload, signature] = parts;
    if (version !== JOIN_TOKEN_VERSION || !encodedPayload || !signature) {
        return { valid: false, reason: "invalid-token-version" };
    }

    const expectedSignature = signEncodedPayload(encodedPayload);
    if (!safeCompare(expectedSignature, signature)) {
        return { valid: false, reason: "invalid-token-signature" };
    }

    try {
        const decoded = JSON.parse(fromBase64Url(encodedPayload)) as Partial<JoinTokenPayload>;
        if (
            decoded?.v !== 1 ||
            typeof decoded.uid !== "string" ||
            typeof decoded.iid !== "string" ||
            typeof decoded.lid !== "string" ||
            typeof decoded.room !== "string" ||
            (decoded.rsp !== undefined && decoded.rsp !== 1) ||
            !Number.isFinite(decoded.iat) ||
            !Number.isFinite(decoded.exp) ||
            typeof decoded.nonce !== "string"
        ) {
            return { valid: false, reason: "invalid-token-payload" };
        }

        const payload: JoinTokenPayload = {
            v: 1,
            uid: decoded.uid,
            iid: decoded.iid,
            lid: decoded.lid,
            room: decoded.room,
            ...(decoded.rsp === 1 ? { rsp: 1 as const } : {}),
            iat: Number(decoded.iat),
            exp: Number(decoded.exp),
            nonce: decoded.nonce
        };

        if (Date.now() >= payload.exp) {
            return { valid: false, reason: "expired-token" };
        }

        return { valid: true, payload };
    } catch {
        return { valid: false, reason: "invalid-token-payload" };
    }
}
