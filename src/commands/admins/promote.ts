import { Command } from '../../types/Command';

const command: Command = {
    name: 'promote',
    description: 'Jadikan member sebagai admin',
    usage: '@mention / reply',
    groupAdminOnly: true,
    async execute(sock, msg, args, context) {
        const from = msg.key.remoteJid!;
        if (!from.endsWith('@g.us')) return sock.sendMessage(from, { text: 'This command can only be used in groups.' });

        try {
            const groupMetadata = await sock.groupMetadata(from);
            const participants = groupMetadata.participants;

            let targetUser;

            if (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length && msg.message.extendedTextMessage.contextInfo.mentionedJid.length > 0) {
                targetUser = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
            } else if (msg.message?.extendedTextMessage?.contextInfo?.participant) {
                targetUser = msg.message.extendedTextMessage.contextInfo.participant;
            } else {
                return sock.sendMessage(from, { text: 'Mention user or reply to their message.' });
            }

            const targetParticipant = participants.find((p: any) => p.id === targetUser);
            if (!targetParticipant) return sock.sendMessage(from, { text: 'User not found.' });
            if (targetParticipant.admin) return sock.sendMessage(from, { text: 'User is already an admin.' });

            await sock.groupParticipantsUpdate(from, [targetUser], 'promote');

            const { getAdminConfig } = require('../../core/configLoader');
            const template = getAdminConfig().promote_template;
            const text = template.replace(/@user/gi, `@${targetUser.split('@')[0]}`);

            await sock.sendMessage(from, {
                text,
                mentions: [targetUser]
            });

        } catch (error) {
            await sock.sendMessage(from, { text: 'Failed to promote. Bot needs admin privileges.' });
        }
    }
};

export default command;
