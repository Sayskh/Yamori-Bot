import { Command } from '../../types/Command';
import { downloadMediaMessage } from 'baileys';

const command: Command = {
    name: 'view',
    aliases: [],
    description: 'Kirim ulang foto/video sekali lihat',

    async execute(sock, msg, args, context) {
        const { from } = context;

        const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        // Check if the incoming message itself is a view-once
        const directViewOnce =
            msg.message?.viewOnceMessage?.message ||
            msg.message?.viewOnceMessageV2?.message ||
            msg.message?.viewOnceMessageV2Extension?.message;

        if (!quoted && !directViewOnce) {
            await sock.sendMessage(from, {
                text: 'Reply pesan foto/video sekali lihat untuk mengirim ulang.',
            }, { quoted: msg });
            return;
        }

        const viewOnce =
            directViewOnce ||
            quoted?.viewOnceMessage?.message ||
            quoted?.viewOnceMessageV2?.message ||
            quoted?.viewOnceMessageV2Extension?.message ||
            // Some clients wrap it differently
            (quoted?.imageMessage?.viewOnce ? quoted : null) ||
            (quoted?.videoMessage?.viewOnce ? quoted : null);

        if (!viewOnce) {
            await sock.sendMessage(from, {
                text: 'Pesan yang di-reply bukan foto/video sekali lihat.',
            }, { quoted: msg });
            return;
        }

        const isImage = !!viewOnce.imageMessage;
        const isVideo = !!viewOnce.videoMessage;

        if (!isImage && !isVideo) {
            await sock.sendMessage(from, {
                text: 'Format media tidak didukung.',
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

            const buffer = await downloadMediaMessage(
                fakeMessage as any,
                'buffer',
                {},
                {
                    logger: console as any,
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
            console.error('View command error:', error);
            await sock.sendMessage(from, {
                text: 'Gagal mengunduh media. Pastikan pesannya belum kadaluarsa.',
            }, { quoted: msg });
        }
    },
};

export default command;
