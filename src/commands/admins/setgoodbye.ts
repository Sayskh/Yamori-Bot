import { Command } from '../../types/Command';
import { saveMediaToFile } from '../../utils/mediaHelper';
import fs from 'fs';

const command: Command = {
    name: 'setgoodbye',
    description: 'Set custom goodbye message (supports image/video)',
    usage: '<message> [with attachment or replied image/video]',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId, t } = context;
        const db = dataManager.db;
        const message = args.join(' ');

        const getMedia = (m: any) => {
            if (!m) return null;
            return m.imageMessage || m.videoMessage || m.documentMessage;
        };

        const hasMedia = !!(getMedia(msg.message) || getMedia(msg.message?.extendedTextMessage?.contextInfo?.quotedMessage));

        if (!message && !hasMedia) {
            const settings = await db.getGroupSettings(botId, from);

            await sock.sendMessage(from, {
                text: t('setgoodbye_usage', {
                    prefix,
                    current: settings.goodbye || '_(default)_',
                    hasMedia: settings.goodbyeImage ? 'Yes' : 'No'
                }),
            }, { quoted: msg });
            return;
        }

        if (message) {
            await db.setGoodbyeMessage(botId, from, message);
        }

        if (hasMedia) {
            let mediaMsg = msg;
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            if (getMedia(contextInfo?.quotedMessage)) {
                mediaMsg = {
                    key: { remoteJid: from, id: contextInfo?.stanzaId },
                    message: contextInfo?.quotedMessage
                } as any;
            }

            const itemName = `goodbye_${Date.now()}`;
            const filePath = await saveMediaToFile(mediaMsg, from, itemName);
            if (filePath) {
                const oldSettings = await db.getGroupSettings(botId, from);
                if (oldSettings.goodbyeImage && fs.existsSync(oldSettings.goodbyeImage)) {
                    try { fs.unlinkSync(oldSettings.goodbyeImage); } catch (e) { }
                }

                await db.setGoodbyeImage(botId, from, filePath);
                await sock.sendMessage(from, { text: t('setgoodbye_media_success') }, { quoted: msg });
                return;
            } else {
                await sock.sendMessage(from, { text: t('setgoodbye_media_fail') }, { quoted: msg });
            }
        } else {
            await sock.sendMessage(from, {
                text: t('setgoodbye_success'),
            }, { quoted: msg });
        }
    },
};

export default command;
