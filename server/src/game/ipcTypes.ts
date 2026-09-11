import type { TeamMode } from "../../../shared/gameConfig";
import type { FindGamePrivateBody, ServerGameConfig } from "../utils/types";

export interface GameData {
    id: string;
    teamMode: TeamMode;
    /** Squad cap for this match (2–8). */
    squadSize: number;
    mapName: string;
    canJoin: boolean;
    browsable: boolean;
    aliveCount: number;
    pendingJoinTokens: number;
    startedTime: number;
    stopped: boolean;
    timeRunning: number;
    difficulty?: string;
    endless?: boolean;
}

export enum ProcessMsgType {
    Create,
    KeepAlive,
    UpdateData,
    AddJoinToken,
    JoinTokensApplied,
}

export interface CreateGameMsg {
    type: ProcessMsgType.Create;
    config: ServerGameConfig;
    id: string;
}

export interface KeepAliveMsg {
    type: ProcessMsgType.KeepAlive;
}

export interface UpdateDataMsg extends GameData {
    type: ProcessMsgType.UpdateData;
}

export interface AddJoinTokenMsg {
    type: ProcessMsgType.AddJoinToken;
    autoFill: boolean;
    tokens: FindGamePrivateBody["playerData"];
    squadName?: string;
}

export interface JoinTokensAppliedMsg {
    type: ProcessMsgType.JoinTokensApplied;
    accepted: number;
    pendingJoinTokens: number;
}

export type ProcessMsg =
    | CreateGameMsg
    | KeepAliveMsg
    | UpdateDataMsg
    | AddJoinTokenMsg
    | JoinTokensAppliedMsg;
