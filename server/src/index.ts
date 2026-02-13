import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { createServer } from "http";
import { monitor } from "@colyseus/monitor";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import session from "express-session";
import MongoStore from "connect-mongo";
import passport from "passport";
import cookieParser from "cookie-parser";

import { GameRoom } from "./rooms/GameRoom";
import { InstanceRoom } from "./rooms/InstanceRoom";
import authRoutes from "./routes/auth";
import accountRoutes from "./routes/account";
import inventoryRoutes from "./routes/inventory";
import betaRoutes from "./routes/beta";
import settingsRoutes from "./routes/settings";
import apiRoutes from "./routes";
import stripeRoutes, { stripeWebhookHandler } from "./routes/stripe";
import initPassport from "./config/passport";
import { InstanceManager } from "./managers/InstanceManager";
import { InventoryCache } from "./managers/InventoryCache";
import { startBetaCampaignMonitor } from "./utils/betaCampaignMonitor";

// Load environment variables from common locations
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

initPassport();

const port = Number(process.env.PORT || 3019);
const app = express();

const clientUrlEnv = process.env.CLIENT_URL || "http://localhost:5173";
const envOrigins = (process.env.CLIENT_URLS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
const defaultOrigins = [
    clientUrlEnv,
    "https://cutefishwithknives.com",
    "https://dev.cutefishwithknives.com"
];
const allowedOrigins = Array.from(new Set([...(envOrigins.length ? envOrigins : [clientUrlEnv]), ...defaultOrigins]));

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error("Not allowed by CORS"));
    },
    credentials: true
}));
// Stripe webhook needs raw body
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookHandler);

app.use(express.json());
app.use(cookieParser());

const mongoURI = process.env.MONGO_URI;
if (!mongoURI) {
    console.error("MONGO_URI not set in environment variables");
    process.exit(1);
}

app.use(session({
    secret: process.env.SESSION_SECRET || "super_secret_key_cfwk",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: mongoURI,
        collectionName: "sessions",
        ttl: 60 * 60 * 24 * 7 // 1 week
    }),
    cookie: {
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
    }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use("/uploads", express.static(path.join(__dirname, "../uploads"))); 
app.use("/api", apiRoutes); 
app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/beta", betaRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/stripe", stripeRoutes);

// MongoDB connection
mongoose.connect(mongoURI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.error("MongoDB Connection Error:", err));

// Inventory cache: periodic flush every 5 minutes
const inventoryCache = InventoryCache.getInstance();
inventoryCache.startAutoFlush(5 * 60 * 1000);


const gameServer = new Server({
    server: createServer(app),
});

gameServer.define("game_room", GameRoom);

// Initialize the instance manager with the game server
const instanceManager = InstanceManager.getInstance();
instanceManager.setGameServer(gameServer);

startBetaCampaignMonitor(instanceManager);

// Register InstanceRoom type for dynamic instance creation
gameServer.define("instance", InstanceRoom);

// API endpoint to join an instance
app.post("/api/instance/join", async (req, res) => {
    try {
        const locationId = req.body.locationId || "lobby";
        const instance = await instanceManager.getOrCreateInstance(locationId);
        
        if (!instance) {
            return res.status(500).json({ 
                success: false, 
                error: "Failed to create or find instance" 
            });
        }
        
        res.json({
            success: true,
            instance: {
                instanceId: instance.instanceId,
                locationId: instance.locationId,
                mapFile: instance.mapFile,
                roomName: instance.roomName,
                currentPlayers: instance.currentPlayers,
                maxPlayers: instance.maxPlayers
            }
        });
    } catch (error) {
        console.error("[Instance] Error joining instance:", error);
        res.status(500).json({ 
            success: false, 
            error: "Internal server error" 
        });
    }
});

app.use("/colyseus", monitor());

const publicDomain = process.env.PUBLIC_DOMAIN || 'localhost';

gameServer.listen(port);
console.log(`Listening on ws://${publicDomain}:${port}`);

let isShuttingDown = false;
const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Server] Shutdown initiated (${signal}). Flushing inventories...`);
    inventoryCache.stopAutoFlush();
    try {
        await inventoryCache.flushDirty();
    } catch (err) {
        console.error('[Server] Error flushing inventories on shutdown:', err);
    } finally {
        process.exit(0);
    }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('beforeExit', () => shutdown('beforeExit'));
