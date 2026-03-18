import mongoose, { Schema, Document } from 'mongoose';

export type NewsClassification = 'RELEASE' | 'OTHER';

export interface INewsPost extends Document {
    title: string;
    content: string;
    classification: NewsClassification;
    imageUrl?: string;
    authorUserId?: mongoose.Types.ObjectId;
    authorUsernameSnapshot?: string;
    publishAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const NewsPostSchema: Schema = new Schema({
    title: { type: String, required: true, maxlength: 140 },
    content: { type: String, required: true, maxlength: 10000 },
    classification: {
        type: String,
        required: true,
        enum: ['RELEASE', 'OTHER']
    },
    imageUrl: { type: String },
    authorUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    authorUsernameSnapshot: { type: String, default: null, maxlength: 50 },
    publishAt: { type: Date, default: null }
}, {
    timestamps: true
});

NewsPostSchema.index({ publishAt: -1, createdAt: -1 });
NewsPostSchema.index({ createdAt: -1 });

export default mongoose.model<INewsPost>('NewsPost', NewsPostSchema);
