export type DialogueSpeaker = 'npc' | 'player';

export type DialogueEmotion =
    | 'angry'
    | 'disgust'
    | 'fear'
    | 'happy'
    | 'neutral'
    | 'sad'
    | 'shock'
    | 'sleep'
    | 'surprise';

export type DialogueLine = {
    speaker: DialogueSpeaker;
    textKey?: string;
    text?: string;
    emotion?: DialogueEmotion;
    shake?: 'mild' | 'snore';
    name?: string;
    nameKey?: string;
    options?: DialogueOption[];
    hideSpeakerVisuals?: boolean;
};

export type DialogueCheck =
    | {
        type: 'hasItem';
        itemId: string;
        negate?: boolean;
    }
    | {
        type: 'questObjective';
        questId: string;
        status?: 'active' | 'completed';
        objectiveIndex?: number;
        negate?: boolean;
    };

export type DialogueAction =
    | {
        type: 'giveItem';
        itemId: string;
        amount?: number;
        ifMissing?: boolean;
    }
    | {
        type: 'openShop';
        shopId: string;
    };

export type DialogueFork = {
    checks?: DialogueCheck[];
    lines: DialogueLine[];
    randomLines?: DialogueLine[][];
    actions?: DialogueAction[];
};

export type DialogueOptionBranch = {
    checks?: DialogueCheck[];
    lines?: DialogueLine[];
    actions?: DialogueAction[];
};

export type DialogueOption = {
    id: string;
    textKey?: string;
    text?: string;
    lines?: DialogueLine[];
    actions?: DialogueAction[];
    branches?: DialogueOptionBranch[];
    suppressNpcInteractSend?: boolean;
};

export type DialogueData = {
    id: string;
    lines?: DialogueLine[];
    forks?: DialogueFork[];
    actions?: DialogueAction[];
};

export type DialogueRenderLine = {
    speaker: DialogueSpeaker;
    name: string;
    text: string;
    emotion: DialogueEmotion;
    npcId?: string;
    options?: DialogueRenderOption[];
    hideSpeakerVisuals?: boolean;
};

export type DialogueRenderOption = {
    id: string;
    text: string;
};
