import mongoose, { Schema, Document } from 'mongoose';
import { IMap, MapState } from '@cfwk/shared';

export interface IMapDocument extends Omit<IMap, '_id'>, Document {}

const LayerSchema = new Schema({
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, default: 'tile' },
    visible: { type: Boolean, default: true },
    locked: { type: Boolean, default: false },
    data: { type: Schema.Types.Mixed, default: {} },
    properties: { type: Schema.Types.Mixed, default: {} }
}, { _id: false });

const MapSchema: Schema = new Schema({
    name: { type: String, required: true },
    state: { type: String, enum: Object.values(MapState), default: MapState.DRAFT },
    width: { type: Number, default: 20 },
    height: { type: Number, default: 20 },
    palette: { type: Schema.Types.Mixed, default: [] },
    // Mixed to support legacy Object-based layers until migration is complete
    layers: { type: Schema.Types.Mixed, default: [] }
}, {
    timestamps: true
});

export const MapModel = mongoose.model<IMapDocument>('Map', MapSchema);

