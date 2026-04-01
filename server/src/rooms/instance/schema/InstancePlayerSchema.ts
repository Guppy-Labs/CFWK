import { Schema, type } from "@colyseus/schema";
import { IPlayer, PlayerAnim } from "@cfwk/shared";

export class InstancePlayerSchema extends Schema implements IPlayer {
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("number") vx: number = 0;
    @type("number") vy: number = 0;
    @type("number") moveTs: number = 0;
    @type("string") anim: PlayerAnim = "idle";
    @type("boolean") isFishing: boolean = false;
    @type("string") username: string = "";
    @type("boolean") isPremium: boolean = false;
    @type("string") odcid: string = "";
    @type("number") direction: number = 0;
    @type("boolean") isAfk: boolean = false;
    @type("number") afkSince: number = 0;
    @type("boolean") isGuiOpen: boolean = false;
    @type("boolean") isChatOpen: boolean = false;
    @type("string") appearance: string = "";
}
