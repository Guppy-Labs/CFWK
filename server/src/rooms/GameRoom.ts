import { Room, Client } from "colyseus";
import { GameState, PlayerSchema } from "./schema/GameState";
import { PlayerInput } from "@cfwk/shared/types";

export class GameRoom extends Room<GameState> {
    maxClients = 20;

    onCreate(options: any) {
        console.log("GameRoom created!", options);
        this.setState(new GameState());

        this.onMessage("input", (client, input: PlayerInput) => {
            const player = this.state.players.get(client.sessionId);
            if (player) {
                const speed = 2;
                if (input.left) player.x -= speed;
                if (input.right) player.x += speed;
                if (input.up) player.y -= speed;
                if (input.down) player.y += speed;

                if (input.left || input.right || input.up || input.down) {
                    player.anim = 'walk';
                } else {
                    player.anim = 'idle';
                }
                
            }
        });
    }

    onJoin(client: Client, options: any) {
        console.log(client.sessionId, "joined!");
        const player = new PlayerSchema();
        player.x = 400;
        player.y = 300;
        player.username = options.username || "Guest";
        this.state.players.set(client.sessionId, player);
    }

    onLeave(client: Client, consented: boolean) {
        console.log(client.sessionId, "left!");
        this.state.players.delete(client.sessionId);
    }

    onDispose() {
        console.log("room disposed");
    }
}
