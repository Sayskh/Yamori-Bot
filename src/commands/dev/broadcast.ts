import { delay } from 'baileys';
import { getDevConfig } from '../../core/configLoader';
import { Command } from '../../types/Command';
import { replaceVariables } from '../../utils/helpers';
import log from '../../utils/logger';

const command: Command = {
    name: 'broadcast',
    aliases: ['bc'],
    description: 'Kirim pesan ke semua grup yang diikuti bot',
    usage: '<pesan>',
    devOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix } = context;
        const broadcastMsg = args.join(' ').trim();

        if (!broadcastMsg) {
            await sock.sendMessage(from, {
                text: `*Broadcast Grup*\n\n`
                    + `Gunakan: ${prefix}broadcast <pesan>\n\n`
                    + `Contoh:\n`
                    + `${prefix}broadcast Halo, bot sedang maintenance selama 1 jam. Mohon maaf atas ketidaknyamanannya.`,
            }, { quoted: msg });
            return;
        }

        try {
            const participating = await sock.groupFetchAllParticipating();
            const groups = Object.values(participating || {}) as Array<{ id: string }>;

            if (groups.length === 0) {
                await sock.sendMessage(from, { text: 'Bot belum tergabung di grup mana pun.' }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, {
                text: `Memulai broadcast ke ${groups.length} grup.\n_Proses ini mungkin memakan waktu._`
            }, { quoted: msg });

            const devCfg = getDevConfig();
            let success = 0;
            let failed = 0;

            for (const group of groups) {
                try {
                    await delay(1500);
                    const finalMsg = replaceVariables(devCfg.broadcast_template, { broadcastMsg });
                    await sock.sendMessage(group.id, { text: finalMsg });
                    success++;
                } catch (err) {
                    log.warn({ groupId: group.id, err }, 'Failed to broadcast to group');
                    failed++;
                }
            }

            await sock.sendMessage(from, {
                text: `*Broadcast Selesai!*\n\n`
                    + `Berhasil: ${success} grup\n`
                    + `Gagal: ${failed} grup`,
            });
        } catch (error) {
            log.error({ err: error }, 'Broadcast command error');
            await sock.sendMessage(from, { text: 'Terjadi kesalahan saat menjalankan broadcast.' }, { quoted: msg });
        }
    },
};

export default command;
