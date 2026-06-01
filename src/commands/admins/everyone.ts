import { Command } from '../../types/Command';
import { downloadMediaMessage } from 'baileys';
import log from '../../utils/logger';

const command: Command = {
    name: 'tagall',
    aliases: ['h', 'here'],
    description: 'Tag all group members',
    groupAdminOnly: true,
    async execute(sock, msg, args, context) {
        const { t } = context;
        const from = msg.key.remoteJid!;
        if (!from.endsWith('@g.us')) return;

        try {
            const groupMetadata = await sock.groupMetadata(from);
            const mentions = groupMetadata.participants.map((p: any) => p.id);

            let content: any = {};
            const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

            if (quotedMsg) {
                const quotedType = Object.keys(quotedMsg)[0];
                if (quotedType === 'conversation') {
                    content = { text: quotedMsg.conversation, mentions };
                } else if (quotedType === 'extendedTextMessage') {
                    content = { text: quotedMsg.extendedTextMessage?.text || '', mentions };
                } else if (quotedType === 'imageMessage') {
                    const media = await downloadMediaMessage({ message: quotedMsg } as any, 'buffer', {});
                    content = { image: media, caption: quotedMsg.imageMessage?.caption || '', mentions };
                } else if (quotedType === 'videoMessage') {
                    const media = await downloadMediaMessage({ message: quotedMsg } as any, 'buffer', {});
                    content = { video: media, caption: quotedMsg.videoMessage?.caption || '', mentions };
                } else {
                    content = { text: t('everyone_attention'), mentions };
                }
            } else if (args.length > 0) {
                content = { text: t('everyone_announce', { message: args.join(' ') }), mentions };
            } else {
                const tags = mentions.map(m => `@${m.split('@')[0]}`).join(' ');
                content = { text: `${t('everyone_attention')}\n\n${tags}`, mentions };
            }

            await sock.sendMessage(from, content);
        } catch (error) {
            log.error({ err: error }, 'Everyone command failed');
        }
    }
};

export default command;
