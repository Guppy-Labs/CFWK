export interface ChatMessage {
    username: string;
    odcid: string;
    message: string;
    timestamp: number;
    isSystem?: boolean;
    isPremium?: boolean;
}

export type CommandArgType = 'player' | 'item' | 'duration' | 'count' | 'text';

export type CommandSpec = {
    name: string;
    args: CommandArgType[];
};

export type SuggestionContext = {
    tokens: string[];
    tokenIndex: number;
    commandSpec?: CommandSpec;
    argIndex?: number;
};

export type SuggestionResult = {
    suggestion: string;
    remainder: string;
    context: SuggestionContext;
};
