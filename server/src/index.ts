import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { createServer } from "http";
import { monitor } from "@colyseus/monitor";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import session from "express-session";
import passport from "passport";
import cookieParser from "cookie-parser";

import { GameRoom } from "./rooms/GameRoom";
import authRoutes from "./routes/auth";
import accountRoutes from "./routes/account";
import apiRoutes from "./routes";
import initPassport from "./config/passport";

dotenv.config();

initPassport();

const port = Number(process.env.PORT || 3019);
const app = express();

app.use(cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

app.use(session({
    secret: process.env.SESSION_SECRET || "super_secret_key_cfwk",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
    }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use("/uploads", express.static(path.join(__dirname, "../uploads"))); 
app.use("/api", apiRoutes); 
app.use("/api/auth", authRoutes);
app.use("/api/account", accountRoutes);

// MongoDB connection
const mongoURI = process.env.MONGO_URI;
if (!mongoURI) {
    console.error("MONGO_URI not set in environment variables");
    process.exit(1);
}
mongoose.connect(mongoURI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.error("MongoDB Connection Error:", err));


const gameServer = new Server({
    server: createServer(app),
});

gameServer.define("game_room", GameRoom);

app.use("/colyseus", monitor());

const publicDomain = process.env.PUBLIC_DOMAIN || 'localhost';

gameServer.listen(port);
console.log(`Listening on ws://${publicDomain}:${port}`);
