import mongoose, { Schema, Document } from 'mongoose';

export interface IBetaClaim extends Document {
    code: string;
    campaignId: mongoose.Types.ObjectId;
    discordUserId: string;
    issuedAt: Date;
    expiresAt: Date;
    redeemedAt?: Date;
    redeemedByUserId?: mongoose.Types.ObjectId;
}

const BetaClaimSchema: Schema = new Schema({
    code: { type: String, required: true, unique: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'BetaCampaign', required: true },
    discordUserId: { type: String, required: true },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    redeemedAt: { type: Date },
    redeemedByUserId: { type: Schema.Types.ObjectId, ref: 'User' }
}, {
    timestamps: true
});

export default mongoose.model<IBetaClaim>('BetaClaim', BetaClaimSchema);
