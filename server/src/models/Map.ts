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
        background: { type: Schema.Types.Mixed, default: {} },
        ground: { type: Schema.Types.Mixed, default: {} },
        wall: { type: Schema.Types.Mixed, default: {} },
        deco: { type: Schema.Types.Mixed, default: {} },
        object: { type: Schema.Types.Mixed, default: {} }
    },
    layerProperties: { type: Schema.Types.Mixed, default: {} }
}, {
    timestamps: true
});

export const MapModel = mongoose.model<IMapDocument>('Map', MapSchema);

