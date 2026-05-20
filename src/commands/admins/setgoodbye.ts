import { Command } from '../../types/Command';
import { saveMediaToFile } from '../../utils/mediaHelper';
import fs from 'fs';

const command: Command = {
    name: 'setgoodbye',
    description: 'Atur pesan member keluar (bisa dengan gambar)',
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
                text: `*Pesan Member Keluar*\n\n`
                    + `${prefix}setgoodbye <pesan>\n`
                    + `Gunakan ${prefix}goodbye (on/off) untuk menghidupkan/mematikan.\n\n`
                    + `Contoh:\n`
                    + `${prefix}setgoodbye Selamat tinggal @user\n\n`
                    + `Kirim/Balas gambar dengan caption perintah untuk set gambar juga.\n\n`
                    + `Variabel: @user @group @time @date @greeting\n\n`
                    + `─────────────────\n`
                    + `Saat ini: ${settings.goodbye || '_(belum diatur)_'}\n`
                    + `Gambar : ${settings.goodbyeImage ? 'Ya' : 'Tidak'}`,
            }, { quoted: msg });
            return;
        }

        if (message) {
            await db.setGoodbyeMessage(botId, from, message);
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

            const itemName = `goodbye_${Date.now()}`;
            const filePath = await saveMediaToFile(mediaMsg, from, itemName);
            if (filePath) {
                const oldSettings = await db.getGroupSettings(botId, from);
                if (oldSettings.goodbyeImage && fs.existsSync(oldSettings.goodbyeImage)) {
                    try { fs.unlinkSync(oldSettings.goodbyeImage); } catch (e) { }
                }

                await db.setGoodbyeImage(botId, from, filePath);
                await sock.sendMessage(from, { text: 'Pesan dan gambar goodbye berhasil diatur.' }, { quoted: msg });
                return;
            } else {
                await sock.sendMessage(from, { text: 'Gagal meresave gambar goodbye. Pesan teks tetap tersimpan jika diisi.' }, { quoted: msg });
            }
        } else {
            // If they are just setting text
            await sock.sendMessage(from, {
                text: 'Pesan goodbye berhasil diatur.',
            }, { quoted: msg });
        }
    },
};

export default command;
