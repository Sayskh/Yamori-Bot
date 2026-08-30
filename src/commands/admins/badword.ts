import { Command } from '../../types/Command';

const command: Command = {
    name: 'badword',
    aliases: ['bw'],
    description: 'Manage group badwords list',
    usage: 'add/del/list <word>',
    groupAdminOnly: true,
    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId, t } = context;

        if (args.length === 0) {
            await sock.sendMessage(from, {
                text: t('badword_usage', { prefix })
            }, { quoted: msg });
            return;
        }

        const subCommand = args[0].toLowerCase();
        const words = args.slice(1).map(w => w.toLowerCase().trim()).filter(w => w);

        const db = dataManager.db;

const MAX_BADWORD_LENGTH = 50;

        if (subCommand === 'add') {
            if (words.length === 0) {
                await sock.sendMessage(from, { text: t('badword_add_empty', { prefix }) }, { quoted: msg });
                return;
            }

            if (words.some(w => w.length > MAX_BADWORD_LENGTH)) {
                await sock.sendMessage(from, { text: t('badword_limit') }, { quoted: msg });
                return;
            }

            for (const word of words) {
                await db.addBadword(botId, from, word);
            }

            await sock.sendMessage(from, { text: t('badword_added_count', { count: words.length.toString() }) }, { quoted: msg });
        }
        else if (subCommand === 'del' || subCommand === 'delete' || subCommand === 'remove') {
            if (words.length === 0) {
                await sock.sendMessage(from, { text: t('badword_del_empty', { prefix }) }, { quoted: msg });
                return;
            }

            for (const word of words) {
                await db.removeBadword(botId, from, word);
            }

            await sock.sendMessage(from, { text: t('badword_removed_count', { count: words.length.toString() }) }, { quoted: msg });
        }
        else if (subCommand === 'list') {
            const list = await db.getBadwords(botId, from);
            if (list.length === 0) {
                await sock.sendMessage(from, { text: t('badword_empty_list') }, { quoted: msg });
            } else {
                const listText = list.map((w, i) => `${i + 1}. ${w}`).join('\n');
                await sock.sendMessage(from, { text: t('badword_list_header', { list: listText }) }, { quoted: msg });
            }
        }
        else {
            await sock.sendMessage(from, { text: t('badword_unknown_sub') }, { quoted: msg });
        }
    }
};

export default command;
