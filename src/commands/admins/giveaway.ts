import { Command } from '../../types/Command';
import giveawayService from '../../services/giveawayService';
import database from '../../core/database';
import { t } from '../../utils/lang';

function parseDuration(input: string): number | null {
    const match = input.match(/^(\d+)(s|m|h|d)$/i);
    if (!match) return null;

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    const multipliers: Record<string, number> = {
        's': 1000,
        'm': 60 * 1000,
        'h': 60 * 60 * 1000,
        'd': 24 * 60 * 60 * 1000
    };

    return value * (multipliers[unit] || 0);
}

function formatRemaining(ms: number, langCode?: string): string {
    if (ms <= 0) return t('time_ended', undefined, langCode);

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${t('time_day', { value: days.toString() }, langCode)} ${t('time_hour', { value: (hours % 24).toString() }, langCode)} ${t('time_minute', { value: (minutes % 60).toString() }, langCode)}`;
    }
    if (hours > 0) {
        return `${t('time_hour', { value: hours.toString() }, langCode)} ${t('time_minute', { value: (minutes % 60).toString() }, langCode)}`;
    }
    if (minutes > 0) {
        return `${t('time_minute', { value: minutes.toString() }, langCode)} ${t('time_second', { value: (seconds % 60).toString() }, langCode)}`;
    }
    return t('time_second', { value: seconds.toString() }, langCode);
}

const command: Command = {
    name: 'giveaway',
    aliases: ['ga'],
    description: 'Create a giveaway in the group',
    usage: '<duration> <winner> <prize> | end | reroll | info',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, botId, prefix, t } = context;

        if (!from.endsWith('@g.us')) {
            return sock.sendMessage(from, { text: t('group_only') }, { quoted: msg });
        }

        const subCommand = args[0]?.toLowerCase();

        if (subCommand === 'end' || subCommand === 'stop') {
            const giveaway = await database.getActiveGiveaway(botId, from);
            if (!giveaway) {
                return sock.sendMessage(from, { text: t('giveaway_not_active') }, { quoted: msg });
            }
            await giveawayService.endGiveaway(sock, botId, giveaway.id);
            return;
        }

        if (subCommand === 'reroll') {
            try {
                await giveawayService.rerollGiveaway(sock, botId, from);
            } catch (err: any) {
                if (err.message === 'NO_ENDED_GIVEAWAY') {
                    return sock.sendMessage(from, { text: t('giveaway_no_ended') }, { quoted: msg });
                }
                if (err.message === 'NO_PARTICIPANTS') {
                    return sock.sendMessage(from, { text: t('giveaway_no_participants') }, { quoted: msg });
                }
                throw err;
            }
            return;
        }

        if (subCommand === 'info') {
            const giveaway = await database.getActiveGiveaway(botId, from);
            if (!giveaway) {
                return sock.sendMessage(from, { text: t('giveaway_not_active') }, { quoted: msg });
            }

            const participants = await database.getGiveawayParticipants(giveaway.id);
            const remaining = giveaway.ends_at - Date.now();

            const endTimeStr = new Date(giveaway.ends_at).toLocaleString(context.lang === 'id' ? 'id-ID' : 'en-US', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Jakarta'
            });

            const info = t('giveaway_info_header', {
                prize: giveaway.prize,
                emoji: giveaway.emoji,
                winnersCount: giveaway.winners_count.toString(),
                participantsCount: participants.length.toString(),
                endTime: endTimeStr,
                remaining: formatRemaining(remaining, context.lang),
                host: giveaway.host_jid.split('@')[0]
            });

            return sock.sendMessage(from, {
                text: info,
                mentions: [giveaway.host_jid]
            }, { quoted: msg });
        }

        if (args.length < 3) {
            return sock.sendMessage(from, {
                text: t('giveaway_usage_block', { prefix })
            }, { quoted: msg });
        }

        const durationStr = args[0];
        const winnersCountStr = args[1];
        const emoji = '🎉';
        const prize = args.slice(2).join(' ');

        const durationMs = parseDuration(durationStr);
        if (!durationMs || durationMs < 10000 || durationMs > 7 * 24 * 60 * 60 * 1000) {
            return sock.sendMessage(from, { text: t('giveaway_limit') }, { quoted: msg });
        }

        const winnersCount = parseInt(winnersCountStr);
        if (isNaN(winnersCount) || winnersCount < 1 || winnersCount > 20) {
            return sock.sendMessage(from, { text: t('giveaway_winners_limit') }, { quoted: msg });
        }

        let hostJid = (msg.key as any).participantAlt || msg.key.participant || msg.key.remoteJid || '';
        if (hostJid.includes(':')) {
            hostJid = `${hostJid.split(':')[0]}@${hostJid.split('@')[1] || 's.whatsapp.net'}`;
        }

        try {
            giveawayService.registerSock(botId, sock);

            await giveawayService.startGiveaway(
                sock, botId, from, prize, emoji, winnersCount, durationMs, hostJid
            );
        } catch (err: any) {
            if (err.message === 'ACTIVE_EXISTS') {
                return sock.sendMessage(from, {
                    text: t('giveaway_end_first', { giveaway_active: t('giveaway_active'), prefix })
                }, { quoted: msg });
            }
            throw err;
        }
    }
};

export default command;
