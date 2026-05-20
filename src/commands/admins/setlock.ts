import { Command } from '../../types/Command';

const command: Command = {
    name: 'setclose',
    aliases: ['setgc'],
    description: 'Atur pesan custom saat grup di-lock/unlock',
    usage: 'lock <pesan> / unlock <pesan>',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId } = context;
        const db = dataManager.db;

        if (args.length === 0) {
            const settings = await db.getGroupSettings(botId, from);

            await sock.sendMessage(from, {
                text: `*Pesan Lock/Unlock*\n\n`
                    + `${prefix}setclose lock <pesan>\n`
                    + `${prefix}setclose unlock <pesan>\n`
                    + `${prefix}setclose lock off\n`
                    + `${prefix}setclose unlock off\n\n`
                    + `Contoh:\n`
                    + `${prefix}setclose lock Grup dikunci. Silakan tunggu.\n\n`
                    + `Variabel: @user @group @time @date @greeting\n\n`
                    + `─────────────────\n`
                    + `Lock: ${settings.lock || '_(default)_'}\n`
                    + `Unlock: ${settings.unlock || '_(default)_'}`,
            }, { quoted: msg });
            return;
        }

        const type = args[0].toLowerCase();
        const message = args.slice(1).join(' ');

        if (type !== 'lock' && type !== 'unlock') {
            await sock.sendMessage(from, {
                text: `Pilih tipe: *lock* atau *unlock*\n\nContoh: *${prefix}setclose lock Grup sedang dikunci*`,
            }, { quoted: msg });
            return;
        }

        if (!message) {
            await sock.sendMessage(from, {
                text: `Tulis pesan setelah tipe.\n\nContoh: *${prefix}setclose ${type} Pesan custom*`,
            }, { quoted: msg });
            return;
        }

        if (message.toLowerCase() === 'off') {
            if (type === 'lock') {
                await db.setLockMessage(botId, from, null);
            } else {
                await db.setUnlockMessage(botId, from, null);
            }
            await sock.sendMessage(from, { text: `Pesan ${type} direset ke default.` }, { quoted: msg });
            return;
        }

        if (type === 'lock') {
            await db.setLockMessage(botId, from, message);
        } else {
            await db.setUnlockMessage(botId, from, message);
        }

        await sock.sendMessage(from, {
            text: `Pesan *${type}* berhasil diatur.\n\nPreview:\n${message}`,
        }, { quoted: msg });
    },
};

export default command;
