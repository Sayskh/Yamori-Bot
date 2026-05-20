import { Command } from '../../types/Command';
import { saveMediaToFile } from '../../utils/mediaHelper';
import fs from 'fs';

const command: Command = {
    name: 'setwelcome',
    description: 'Atur pesan sambutan member baru (bisa dengan gambar)',
    usage: '<pesan> [dengan lampiran/reply gambar]',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId } = context;
        const db = dataManager.db;
        const message = args.join(' ');

        // Check for attached or quoted image
        const hasMedia = msg.message?.imageMessage ||
            msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

        if (!message && !hasMedia) {
            const settings = await db.getGroupSettings(botId, from);

            await sock.sendMessage(from, {
                text: `*Pesan Sambutan*\n\n`
                    + `${prefix}setwelcome <pesan>\n`
                    + `Gunakan ${prefix}welcome (on/off) untuk menghidupkan/mematikan.\n\n`
                    + `Contoh:\n`
                    + `${prefix}setwelcome Halo @user! Selamat datang di @group\n\n`
                    + `Kirim/Balas gambar dengan caption perintah untuk set gambar juga.\n\n`
                    + `Variabel: @user @group @time @date @greeting\n\n`
                    + `─────────────────\n`
                    + `Saat ini: ${settings.welcome || '_(belum diatur)_'}\n`
                    + `Gambar : ${settings.welcomeImage ? 'Ya' : 'Tidak'}`,
            }, { quoted: msg });
            return;
        }

        if (message) {
            await db.setWelcomeMessage(botId, from, message);
        }

        if (hasMedia) {
            // Save media
            let mediaMsg = msg;
            if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                mediaMsg = {
                    key: { remoteJid: from, id: msg.message.extendedTextMessage.contextInfo.stanzaId },
                    message: msg.message.extendedTextMessage.contextInfo.quotedMessage
                } as any;
            }

            const itemName = `welcome_${Date.now()}`;
            const filePath = await saveMediaToFile(mediaMsg, from, itemName);
            if (filePath) {
                // If there's an old image, removing it from storage could be implemented here, 
                // but keeping it simple for now as it's just saved over or new file created.
                // We appended Date.now() to ensure fresh image is retrieved by whatsapp cache.
                const oldSettings = await db.getGroupSettings(botId, from);
                if (oldSettings.welcomeImage && fs.existsSync(oldSettings.welcomeImage)) {
                    try { fs.unlinkSync(oldSettings.welcomeImage); } catch (e) { }
                }

                await db.setWelcomeImage(botId, from, filePath);
                await sock.sendMessage(from, { text: 'Pesan dan gambar sambutan berhasil diatur.' }, { quoted: msg });
                return;
            } else {
                await sock.sendMessage(from, { text: 'Gagal meresave gambar welcome. Pesan teks tetap tersimpan jika diisi.' }, { quoted: msg });
            }
        } else {
            // If they are just setting text, ask if they want to retain image?
            // If they provided pure text, we just update the text and retain the existing image.
            await sock.sendMessage(from, {
                text: 'Pesan sambutan berhasil diatur.',
            }, { quoted: msg });
        }
    },
};

export default command;
