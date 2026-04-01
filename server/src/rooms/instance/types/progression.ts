import { IGuideTutorialState, IPlayerHeartsState } from "@cfwk/shared";

export type TutorialBySession = Map<string, IGuideTutorialState>;
export type HeartsByUserId = Map<string, IPlayerHeartsState>;
