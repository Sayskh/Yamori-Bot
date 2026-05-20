import { WASocket, WAMessage } from 'baileys';
import { DataManager } from '../core/dataManager';

export interface CommandContext {
    botId: string;
    isBotAdmin: boolean;
    isGroupAdmin: boolean;
    isUser: boolean;
    commands: Map<string, Command>;
    prefix: string;
    from: string;
    pushname: string;
    groupName: string;
    dataManager: DataManager;
}

export interface Command {
    name: string;
    aliases?: string[];
    description: string;
    usage?: string;
    category?: string;
    devOnly?: boolean;
    groupAdminOnly?: boolean;
    userOnly?: boolean;
    execute: (
        sock: WASocket,
        msg: WAMessage,
        args: string[],
        context: CommandContext
    ) => Promise<any>;
}
