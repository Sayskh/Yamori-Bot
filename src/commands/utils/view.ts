import { Command } from '../../types/Command';
import { downloadMediaMessage } from 'baileys';
import pino from 'pino';
import log from '../../utils/logger';

const command: Command = {
    name: 'view',
    aliases: [],
    description: 'Resend view-once photo/video',

    async execute(sock, msg, args, context) {
        const { from, t } = context;

        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        const directViewOnce =
            msg.message?.viewOnceMessage?.message ||
            msg.message?.viewOnceMessageV2?.message ||
            msg.message?.viewOnceMessageV2Extension?.message;

        if (!quoted && !directViewOnce) {
            await sock.sendMessage(from, {
                text: t('view_no_reply'),
            }, { quoted: msg });
            return;
        }

        const viewOnce =
            directViewOnce ||
            quoted?.viewOnceMessage?.message ||
            quoted?.viewOnceMessageV2?.message ||
            quoted?.viewOnceMessageV2Extension?.message ||
            (quoted?.imageMessage?.viewOnce ? quoted : null) ||
            (quoted?.videoMessage?.viewOnce ? quoted : null);

        if (!viewOnce) {
            await sock.sendMessage(from, {
                text: t('view_not_viewonce'),
            }, { quoted: msg });
            return;
        }

        const isImage = !!viewOnce.imageMessage;
        const isVideo = !!viewOnce.videoMessage;

        if (!isImage && !isVideo) {
            await sock.sendMessage(from, {
                text: t('view_unsupported'),
            }, { quoted: msg });
            return;
        }

        try {
            const fakeMessage = directViewOnce
                ? { key: msg.key, message: viewOnce }
                : {
                    key: {
                        remoteJid: from,
                        id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId,
                        participant: msg.message?.extendedTextMessage?.contextInfo?.participant,
                    },
                    message: viewOnce
                };

            const silentLogger = pino({ level: 'silent' });

            const buffer = await downloadMediaMessage(
                fakeMessage as any,
                'buffer',
                {},
                {
                    logger: silentLogger as any,
                    reuploadRequest: sock.updateMediaMessage
                }
            ) as Buffer;

            const caption = isImage
                ? viewOnce.imageMessage?.caption
                : viewOnce.videoMessage?.caption;

            if (isImage) {
                await sock.sendMessage(from, {
                    image: buffer,
                    caption: caption || '',
                }, { quoted: msg });
            } else {
                await sock.sendMessage(from, {
                    video: buffer,
                    caption: caption || '',
                }, { quoted: msg });
            }
        } catch (error) {
            log.error({ err: error }, 'View command error');
            await sock.sendMessage(from, {
                text: t('view_fail'),
            }, { quoted: msg });
        }
    },
};

export default command;
