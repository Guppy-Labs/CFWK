import { Schema, type } from "@colyseus/schema";

export class DroppedItemSchema extends Schema {
    @type("string") id: string = "";
    @type("string") dropKind: string = "item";
    @type("string") itemId: string = "";
    @type("number") amount: number = 1;
    @type("string") coinDenomination: string = "";
    @type("number") coinAmount: number = 0;
    @type("number") x: number = 0;
    @type("number") y: number = 0;
    @type("number") createdAt: number = 0;
    @type("number") refinementProgress: number = 0;
    @type("number") refinementRequiredSteps: number = 0;
    @type("string") refinementResultItemId: string = "";
    @type("string") liquidContainerItemId: string = "";
    @type("string") liquidOutputItemId: string = "";
    @type("string") liquidConfirmText: string = "";
}
