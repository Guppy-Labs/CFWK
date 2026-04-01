import { Client } from "colyseus";
import { InstanceState } from "../schema/InstanceState";

export interface InstanceRoomHost {
    state: InstanceState;
    clients: any;
    broadcast(type: string, message?: any, options?: any): void;
    onMessage(type: string, callback: (client: Client, message: any) => void): void;
    setSimulationInterval(callback: (deltaTime: number) => void, delay?: number): void;
    setState(state: InstanceState): void;
    [key: string]: any;
}
