import mongoose, { Schema, Document } from 'mongoose';
import { ITile } from '@cfwk/shared';

export interface ITileDocument extends Omit<ITile, 'id' | '_id'>, Document {
    tileId: string;
}

const TileSchema: Schema = new Schema({
    tileId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    imageUrl: { type: String, required: true },
    movable: { type: Boolean, default: false },
    speedMultiplier: { type: Number, default: 1.0 },
    damagePerTick: { type: Number, default: 0 },
    behaviorId: { type: String },
    hidden: { type: Boolean, default: false }
}, {
    timestamps: true,
    toJSON: {
        transform: (doc, ret) => {
            ret.id = ret.tileId;
            delete ret.tileId;
            delete ret._id;
            delete ret.__v;
        }
    }
});

export const Tile = mongoose.model<ITileDocument>('Tile', TileSchema);

