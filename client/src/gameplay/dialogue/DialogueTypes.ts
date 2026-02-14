export type DialogueSpeaker = 'npc' | 'player';

export type DialogueEmotion =
    | 'angry'
    | 'disgust'
    | 'fear'
    | 'happy'
    | 'sad'
    | 'surprise';

export type DialogueLine = {
    speaker: DialogueSpeaker;
    text: string;
    textKey?: string;
    emotion?: DialogueEmotion;
    name?: string;
    nameKey?: string;
};

export type DialogueCheck = {
    type: 'hasItem';
    itemId: string;
    negate?: boolean;
};

export type DialogueAction = {
    type: 'giveItem';
    itemId: string;
    amount?: number;
    ifMissing?: boolean;
};

export type DialogueFork = {
    checks?: DialogueCheck[];
    lines: DialogueLine[];
    actions?: DialogueAction[];
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
};
