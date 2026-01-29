import { Room, Client } from "colyseus";
import { GameState, PlayerSchema } from "./schema/GameState";
import { PlayerInput, calculateWorldTime } from "@cfwk/shared/types";

export class GameRoom extends Room<GameState> {
    maxClients = 20;
    private timeUpdateInterval?: ReturnType<typeof setInterval>;

    onCreate(options: any) {
        console.log("GameRoom created!", options);
        this.setState(new GameState());

        // Initialize world time
        this.updateWorldTime();

        // Update world time every second (client can interpolate for smoother updates)
        this.timeUpdateInterval = setInterval(() => {
            this.updateWorldTime();
        }, 1000);

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

    /**
     * Calculate and update the world time state
     */
    private updateWorldTime() {
        const time = calculateWorldTime();
        this.state.worldTime.year = time.year;
        this.state.worldTime.season = time.season;
        this.state.worldTime.dayOfYear = time.dayOfYear;
        this.state.worldTime.dayOfSeason = time.dayOfSeason;
        this.state.worldTime.hour = time.hour;
        this.state.worldTime.minute = time.minute;
        this.state.worldTime.second = time.second;
        this.state.worldTime.brightness = time.brightness;
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
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
        }
    }
}
