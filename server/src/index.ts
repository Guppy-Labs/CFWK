import express from "express";
import cors from "cors";
import { Server } from "colyseus";
import { createServer } from "http";
import { monitor } from "@colyseus/monitor";
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { GameRoom } from "./rooms/GameRoom";
import apiRoutes from "./routes";

dotenv.config();

const port = Number(process.env.PORT || 3019);
const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "../uploads"))); 
app.use("/api", apiRoutes);

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
