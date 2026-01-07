import mongoose, { Schema, Document } from 'mongoose';
import { ITileGroup } from '@cfwk/shared';

export interface ITileGroupDocument extends Omit<ITileGroup, 'id'>, Document {
    groupId: string;
}

const TileGroupSchema: Schema = new Schema({
    groupId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    tiles: [{
        x: { type: Number, required: true },
        y: { type: Number, required: true },
        tileId: { type: String, required: true }
    }],
    previewUrl: { type: String }
}, {
    timestamps: true,
    toJSON: {
        transform: (doc, ret) => {
            ret.id = ret.groupId;
            delete ret.groupId;
            delete ret._id;
            delete ret.__v;
        }
    }
});

export const TileGroup = mongoose.model<ITileGroupDocument>('TileGroup', TileGroupSchema);

