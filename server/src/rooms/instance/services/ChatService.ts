import { CommandProcessor } from "../../../utils/CommandProcessor";
import User from "../../../models/User";
import { CommandAuditLogger } from "../../../utils/CommandAuditLogger";
import { AI_NPC_DEFINITIONS } from "../../../ai/registry";
import { InstanceRoomHost } from "../context/InstanceRoomHost";

export function registerChatHandlers(room: InstanceRoomHost) {
    room.onMessage("chat", async (client, data: { message: string }) => {
        room.markActivity(client);
        const player = room.state.players.get(client.sessionId);

        if (player && data.message) {
            const messageHelper = data.message.trim();

            if (messageHelper.startsWith("/")) {
                const parts = messageHelper.slice(1).split(" ").filter(Boolean);
                const command = (parts[0] || "").toLowerCase();
                const args = parts.slice(1);
                const auditBase = {
                    timestamp: new Date().toISOString(),
                    playerId: player.odcid,
                    playerUsername: player.username,
                    command,
                    args
                };

                if (command === "spawn_evil_tim") {
                    const aiId = room.spawnAiNpc("evil_tim", player.x + 48, player.y);
                    const message = aiId
                        ? `Spawned Evil Tim (${aiId}) chase=${AI_NPC_DEFINITIONS.evil_tim.controllerConfig.chaseRangeMeters}m.`
                        : "Failed to spawn Evil Tim.";
                    await CommandAuditLogger.log({
                        ...auditBase,
                        success: Boolean(aiId),
                        resultMessage: message
                    });
                    client.send("chat", {
                        username: "SYSTEM",
                        odcid: "SYSTEM",
                        message,
                        timestamp: Date.now(),
                        isSystem: true
                    });
                    return;
                }

                let commandResultMessage = "Command failed unexpectedly.";
                let commandSuccess = false;
                try {
                    const result = await CommandProcessor.handleCommand(
                        command,
                        args,
                        player.odcid,
                        player.username
                    );
                    commandResultMessage = result.message;
                    commandSuccess = result.success;
                } catch (error) {
                    commandResultMessage = "Command failed unexpectedly.";
                    commandSuccess = false;
                    console.error("[InstanceRoom] Command execution failed:", error);
                }

                await CommandAuditLogger.log({
                    ...auditBase,
                    success: commandSuccess,
                    resultMessage: commandResultMessage
                });

                client.send("chat", {
                    username: "SYSTEM",
                    odcid: "SYSTEM",
                    message: commandResultMessage,
                    timestamp: Date.now(),
                    isSystem: true
                });
                return;
            }

            try {
                const user = await User.findById(player.odcid);
                if (user && user.mutedUntil) {
                    if (user.mutedUntil.getTime() > Date.now()) {
                        client.send("chat", {
                            username: "SYSTEM",
                            odcid: "SYSTEM",
                            message: "You are muted.",
                            timestamp: Date.now(),
                            isSystem: true
                        });
                        return;
                    } else {
                        user.mutedUntil = undefined;
                        await user.save();
                    }
                }
            } catch (err) {
                console.error("Error checking mute status:", err);
            }

            room.broadcast("chat", {
                sessionId: client.sessionId,
                username: player.username,
                odcid: player.odcid,
                message: data.message.slice(0, 100),
                timestamp: Date.now(),
                isPremium: player.isPremium
            });

            const chatText = data.message.slice(0, 100);
            void room.advancementsManager.onChatMessage(player.odcid, player.x, player.y, chatText)
                .then((alerts: any[]) => {
                    alerts.forEach((alert) => client.send("advancement:alert", alert));
                })
                .catch((error: unknown) => {
                    console.error("[InstanceRoom] chat advancements failed:", error);
                });

            console.log(`[InstanceRoom] Chat from ${player.username}: ${data.message}`);
        }
    });
}
