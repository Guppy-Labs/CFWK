import mongoose, { Schema, Document } from 'mongoose';
import { IMap, MapState, MapLayer } from '@cfwk/shared';

export interface IMapDocument extends Omit<IMap, '_id'>, Document {}

const MapSchema: Schema = new Schema({
    name: { type: String, required: true },
    state: { type: String, enum: Object.values(MapState), default: MapState.DRAFT },
    width: { type: Number, default: 20 },
    height: { type: Number, default: 20 },
    palette: { type: Schema.Types.Mixed, default: [] },
    layers: {
        background: { type: Map, of: String, default: {} },
        ground: { type: Map, of: String, default: {} },
        wall: { type: Map, of: String, default: {} },
        deco: { type: Map, of: String, default: {} },
        object: { type: Map, of: String, default: {} }
    }
}, {
    timestamps: true
});

export const MapModel = mongoose.model<IMapDocument>('Map', MapSchema);

