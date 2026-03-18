import mongoose, { Connection, Model } from 'mongoose';
import { BetaCampaignSchema, IBetaCampaign } from '../models/BetaCampaign';
import { BetaClaimSchema, IBetaClaim } from '../models/BetaClaim';

const BETA_DB_NAME = 'cfwk';

let betaConnectionPromise: Promise<Connection> | null = null;

function resolveBetaMongoUri(baseUri: string): string {
    try {
        const parsed = new URL(baseUri);
        parsed.pathname = `/${BETA_DB_NAME}`;
        return parsed.toString();
    } catch {
        // Fallback for malformed URI strings; keep query/options if present.
        return baseUri.replace(/\/([^/?]+)(\?|$)/, `/${BETA_DB_NAME}$2`);
    }
}

async function getBetaConnection(): Promise<Connection> {
    if (betaConnectionPromise) return betaConnectionPromise;

    const baseUri = process.env.MONGO_URI;
    if (!baseUri) {
        throw new Error('MONGO_URI not set in environment variables');
    }

    const betaUri = resolveBetaMongoUri(baseUri);
    const connection = mongoose.createConnection(betaUri, {
        autoIndex: true
    });

    betaConnectionPromise = connection.asPromise().then(() => connection);
    return betaConnectionPromise;
}

export type BetaModels = {
    BetaCampaign: Model<IBetaCampaign>;
    BetaClaim: Model<IBetaClaim>;
};

let betaModelsPromise: Promise<BetaModels> | null = null;

export async function getBetaModels(): Promise<BetaModels> {
    if (betaModelsPromise) return betaModelsPromise;

    betaModelsPromise = (async () => {
        const connection = await getBetaConnection();
        const BetaCampaign = (connection.models.BetaCampaign as Model<IBetaCampaign> | undefined)
            ?? connection.model<IBetaCampaign>('BetaCampaign', BetaCampaignSchema);
        const BetaClaim = (connection.models.BetaClaim as Model<IBetaClaim> | undefined)
            ?? connection.model<IBetaClaim>('BetaClaim', BetaClaimSchema);
        return { BetaCampaign, BetaClaim };
    })();

    return betaModelsPromise;
}
