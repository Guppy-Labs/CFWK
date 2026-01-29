import { Schema, MapSchema, type } from "@colyseus/schema";
import { IPlayer, PlayerAnim, Season } from "@cfwk/shared";

export class PlayerSchema extends Schema implements IPlayer {
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("string") anim: PlayerAnim = 'idle';
    @type("boolean") isFishing: boolean = false;
    @type("string") username: string = "";
}

/**
 * World time state synchronized to all clients
 */
export class WorldTimeSchema extends Schema {
    @type("number") year: number = 1;
    @type("number") season: Season = Season.Winter;
    @type("number") dayOfYear: number = 1;
    @type("number") dayOfSeason: number = 1;
    @type("number") hour: number = 0;
    @type("number") minute: number = 0;
    @type("number") second: number = 0;
    @type("number") brightness: number = 0.5;
}

export class GameState extends Schema {
    @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
    @type(WorldTimeSchema) worldTime = new WorldTimeSchema();
}
