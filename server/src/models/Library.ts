import mongoose, { Schema, Document } from 'mongoose';

export interface ILibraryDocument extends Document {
    structure: any[];
}

const LibrarySchema: Schema = new Schema({
    structure: { type: Schema.Types.Mixed, default: [] } 
}, {
    timestamps: true
});

export const Library = mongoose.model<ILibraryDocument>('Library', LibrarySchema);
