import { WASocket } from 'baileys';
import database from '../core/database';
import log from '../utils/logger';
import { normalizeJid, normalizeBotId } from '../utils/jid';
import { t } from '../utils/lang';

const glog = log.child({ module: 'giveaway' });

class GiveawayService {
    private timers = new Map<number, NodeJS.Timeout>();
    private socks = new Map<string, WASocket>();

    registerSock(botId: string, sock: WASocket) {
        this.socks.set(botId, sock);
    }

    private getSock(botId: string): WASocket | undefined {
        return this.socks.get(botId);
    }

    async startGiveaway(
        sock: WASocket,
        botId: string,
        groupId: string,
        prize: string,
        emoji: string,
        winnersCount: number,
        durationMs: number,
        hostJid: string
    ): Promise<{ giveawayId: number; messageId: string }> {
        const existing = await database.getActiveGiveaway(botId, groupId);
        if (existing) throw new Error('ACTIVE_EXISTS');

        const endsAt = Date.now() + durationMs;

        const endTimeStr = new Date(endsAt).toLocaleString('id-ID', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Jakarta'
        });

        const settings = await database.getGroupSettings(botId, groupId);
        const lang = settings.language || 'en';

        const announcement = t('giveaway_start_announcement', {
            prize,
            winnersCount: winnersCount.toString(),
            endTime: endTimeStr,
            emoji,
            host: hostJid.split('@')[0]
        }, lang);

        const header = t('giveaway_title', undefined, lang) || '🎉  *GIVEAWAY TIME*  🎉';
        const instruction = lang === 'id' 
            ? `Reaksi pesan ini dengan emoji ${emoji} untuk bergabung!` 
            : `React to this message with ${emoji} to join!`;
        const text = `${header}\n\n${announcement}\n\n${instruction}`;

        const sentMsg = await sock.sendMessage(groupId, {
            text,
            mentions: [hostJid]
        });

        const messageId = sentMsg?.key?.id;
        if (!messageId) throw new Error('Failed to send giveaway message');

        // Automatically react with the emoji so users know what to react with
        await sock.sendMessage(groupId, {
            react: {
                text: emoji,
                key: sentMsg.key
            }
        });

        const giveawayId = await database.createGiveaway(
            botId, groupId, messageId, prize, emoji, winnersCount, hostJid, endsAt
        );

        this.setTimer(giveawayId, botId, durationMs);

        glog.info({ giveawayId, groupId, prize, durationMs }, 'Giveaway started');
        return { giveawayId, messageId };
    }

    async endGiveaway(sock: WASocket, botId: string, giveawayId: number): Promise<void> {
        const giveaway = await database.getGiveawayById(giveawayId);
        if (!giveaway || giveaway.status !== 'active') return;

        const normalizedBotJid = normalizeBotId(sock);
        const rawParticipants = await database.getGiveawayParticipants(giveawayId);
        const participants = rawParticipants.filter(p => {
            const normalized = normalizeJid(p);
            return normalized !== normalizedBotJid && !normalized.endsWith('@g.us');
        });

        let winners: string[] = [];
        let announcement: string;

        const settings = await database.getGroupSettings(botId, giveaway.group_id);
        const lang = settings.language || 'en';

        if (participants.length === 0) {
            announcement = t('giveaway_end_no_participants', {
                prize: giveaway.prize,
                host: giveaway.host_jid.split('@')[0]
            }, lang);
        } else {
            const count = Math.min(giveaway.winners_count, participants.length);
            winners = this.pickRandom(participants, count);

            const winnerTags = winners.map(w => `@${w.split('@')[0]}`).join('\n');

            announcement = t('giveaway_end_announcement', {
                prize: giveaway.prize,
                winners: winnerTags,
                participantsCount: participants.length.toString(),
                host: giveaway.host_jid.split('@')[0]
            }, lang);
        }

        await database.endGiveaway(giveawayId, JSON.stringify(winners));

        const timer = this.timers.get(giveawayId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(giveawayId);
        }

        await sock.sendMessage(giveaway.group_id, {
            text: announcement,
            mentions: [...winners, giveaway.host_jid]
        });

        glog.info({ giveawayId, winners, totalParticipants: participants.length }, 'Giveaway ended');
    }

    async rerollGiveaway(sock: WASocket, botId: string, groupId: string): Promise<void> {
        const giveaway = await database.getLatestEndedGiveaway(botId, groupId);
        if (!giveaway) throw new Error('NO_ENDED_GIVEAWAY');

        const normalizedBotJid = normalizeBotId(sock);
        const rawParticipants = await database.getGiveawayParticipants(giveaway.id);
        const participants = rawParticipants.filter(p => {
            const normalized = normalizeJid(p);
            return normalized !== normalizedBotJid && !normalized.endsWith('@g.us');
        });
        if (participants.length === 0) throw new Error('NO_PARTICIPANTS');

        const previousWinners: string[] = giveaway.winners ? JSON.parse(giveaway.winners) : [];
        const eligible = participants.filter(p => !previousWinners.includes(p));
        const pool = eligible.length > 0 ? eligible : participants;

        const count = Math.min(giveaway.winners_count, pool.length);
        const newWinners = this.pickRandom(pool, count);

        await database.updateGiveawayWinners(giveaway.id, JSON.stringify(newWinners));

        const settings = await database.getGroupSettings(botId, groupId);
        const lang = settings.language || 'en';

        const winnerTags = newWinners.map(w => `@${w.split('@')[0]}`).join('\n');
        const announcement = t('giveaway_reroll_announcement', {
            prize: giveaway.prize,
            winners: winnerTags
        }, lang);

        await sock.sendMessage(groupId, {
            text: announcement,
            mentions: newWinners
        });

        glog.info({ giveawayId: giveaway.id, newWinners }, 'Giveaway rerolled');
    }

    async handleReaction(sock: WASocket, reaction: any): Promise<void> {
        const messageId = reaction.key?.id;
        if (!messageId) return;

        const botId = normalizeBotId(sock);

        const giveaway = await database.getGiveawayByMessageId(botId, messageId);
        if (!giveaway || giveaway.status !== 'active') return;

        const reactionData = reaction.reaction;
        if (!reactionData?.key) return;

        const reactorRaw = reaction.sender
            || (reactionData.key as any).participantAlt
            || reactionData.key.participant
            || '';
        const reactorJid = normalizeJid(reactorRaw);

        if (!reactorJid || reactorJid === botId || reactorJid.endsWith('@g.us')) return;

        const emoji = reactionData.text || '';

        if (emoji === giveaway.emoji) {
            await database.addGiveawayParticipant(giveaway.id, reactorJid);
            glog.info({ giveawayId: giveaway.id, participant: reactorJid }, 'Participant joined');
        } else if (emoji === '') {
            await database.removeGiveawayParticipant(giveaway.id, reactorJid);
            glog.info({ giveawayId: giveaway.id, participant: reactorJid }, 'Participant left');
        }
    }

    async restoreTimers(sock: WASocket): Promise<void> {
        const botId = normalizeBotId(sock);
        this.registerSock(botId, sock);

        const activeGiveaways = await database.getAllActiveGiveaways(botId);

        for (const giveaway of activeGiveaways) {
            const remaining = giveaway.ends_at - Date.now();

            if (remaining <= 0) {
                await this.endGiveaway(sock, botId, giveaway.id);
            } else {
                this.setTimer(giveaway.id, botId, remaining);
                glog.info({ giveawayId: giveaway.id, remainingMs: remaining }, 'Restored giveaway timer');
            }
        }

        if (activeGiveaways.length > 0) {
            glog.info({ count: activeGiveaways.length }, 'Giveaway timers restored');
        }
    }

    private setTimer(giveawayId: number, botId: string, delayMs: number): void {
        const existing = this.timers.get(giveawayId);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(async () => {
            this.timers.delete(giveawayId);
            const sock = this.getSock(botId);
            if (!sock) {
                glog.error({ giveawayId, botId }, 'No socket available to end giveaway');
                return;
            }
            try {
                await this.endGiveaway(sock, botId, giveawayId);
            } catch (err) {
                glog.error({ err, giveawayId }, 'Error ending giveaway');
            }
        }, delayMs);

        this.timers.set(giveawayId, timer);
    }

    private pickRandom(arr: string[], count: number): string[] {
        const shuffled = [...arr];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled.slice(0, count);
    }
}

export default new GiveawayService();
