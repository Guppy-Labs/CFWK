import mongoose, { Schema, Document } from 'mongoose';

export interface IBannedIP extends Document {
    ip: string;
    bannedUntil: Date;
    reason?: string;
    originalUserId?: string;  // The user who triggered this IP ban
    originalUsername?: string;
    createdAt: Date;
}

const BannedIPSchema: Schema = new Schema({
    ip: { type: String, required: true, unique: true, index: true },
    bannedUntil: { type: Date, required: true },
    reason: { type: String },
    originalUserId: { type: String },
    originalUsername: { type: String }
}, {
    timestamps: true
});

export default mongoose.model<IBannedIP>('BannedIP', BannedIPSchema);
