import { Command } from '../../types/Command';

const command: Command = {
    name: 'badword',
    aliases: ['bw'],
    description: 'Mengatur daftar kata kotor (badwords) grup',
    usage: 'add/del/list <kata>',
    groupAdminOnly: true,
    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId } = context;

        if (args.length === 0) {
            await sock.sendMessage(from, {
                text: `*Pengaturan Badword*\n\n` +
                    `Gunakan fitur ini untuk memblokir kata-kata tertentu di grup.\n\n` +
                    `1. *${prefix}badword add <kata1> <kata2>...*\n` +
                    `2. *${prefix}badword del <kata1> <kata2>...*\n` +
                    `3. *${prefix}badword list*\n\n` +
                    `Contoh: ${prefix}badword add anjing babi`
            }, { quoted: msg });
            return;
        }

        const subCommand = args[0].toLowerCase();
        const words = args.slice(1).map(w => w.toLowerCase().trim()).filter(w => w);

        const db = dataManager.db;

        if (subCommand === 'add') {
            if (words.length === 0) {
                await sock.sendMessage(from, { text: `Sebutkan kata yang mau diblokir.\nContoh: *${prefix}badword add bodoh jelek*` }, { quoted: msg });
                return;
            }

            for (const word of words) {
                await db.addBadword(botId, from, word);
            }

            await sock.sendMessage(from, { text: `Berhasil menambahkan ${words.length} kata ke daftar badword.` }, { quoted: msg });
        }
        else if (subCommand === 'del' || subCommand === 'delete' || subCommand === 'remove') {
            if (words.length === 0) {
                await sock.sendMessage(from, { text: `Sebutkan kata yang mau dihapus.\nContoh: *${prefix}badword del bodoh*` }, { quoted: msg });
                return;
            }

            for (const word of words) {
                await db.removeBadword(botId, from, word);
            }

            await sock.sendMessage(from, { text: `Berhasil menghapus ${words.length} kata dari daftar badword.` }, { quoted: msg });
        }
        else if (subCommand === 'list') {
            const list = await db.getBadwords(botId, from);
            if (list.length === 0) {
                await sock.sendMessage(from, { text: `Grup ini belum memiliki daftar badword.` }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: `*Daftar Badword Grup:*\n\n${list.map((w, i) => `${i + 1}. ${w}`).join('\n')}` }, { quoted: msg });
            }
        }
        else {
            await sock.sendMessage(from, { text: `Sub-perintah tidak dikenal. Gunakan *add*, *del*, atau *list*.` }, { quoted: msg });
        }
    }
};

export default command;
