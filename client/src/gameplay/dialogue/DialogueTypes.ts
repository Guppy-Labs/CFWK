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
    options?: DialogueOption[];
    hideSpeakerVisuals?: boolean;
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

export type DialogueOptionBranch = {
    checks?: DialogueCheck[];
    lines?: DialogueLine[];
    actions?: DialogueAction[];
};

export type DialogueOption = {
    id: string;
    text: string;
    textKey?: string;
    lines?: DialogueLine[];
    actions?: DialogueAction[];
    branches?: DialogueOptionBranch[];
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
