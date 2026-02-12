import mongoose, { Schema, Document } from 'mongoose';

export interface IBetaCampaign extends Document {
    active: boolean;
    startedAt: Date;
    endsAt: Date;
    durationMs: number;
    accessUsers: string[];
    accessRoles: string[];
    createdBy: string;
    endedAt?: Date;
    endReason?: string;
    endProcessed?: boolean;
}

const BetaCampaignSchema: Schema = new Schema({
    active: { type: Boolean, default: true },
    startedAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    durationMs: { type: Number, required: true },
    accessUsers: { type: [String], default: [] },
    accessRoles: { type: [String], default: [] },
    createdBy: { type: String, required: true },
    endedAt: { type: Date },
    endReason: { type: String },
    endProcessed: { type: Boolean, default: false }
}, {
    timestamps: true
});

export default mongoose.model<IBetaCampaign>('BetaCampaign', BetaCampaignSchema);
