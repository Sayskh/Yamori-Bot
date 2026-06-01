import { getDevConfig } from '../../core/configLoader';
import { Command } from '../../types/Command';
import { replaceVariables } from '../../utils/helpers';
import { t } from '../../utils/lang';

function formatUptime(seconds: number, langCode?: string): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts: string[] = [];
    if (days > 0) parts.push(t('time_day', { value: days.toString() }, langCode));
    if (hours > 0) parts.push(t('time_hour', { value: hours.toString() }, langCode));
    if (minutes > 0) parts.push(t('time_minute', { value: minutes.toString() }, langCode));
    if (secs > 0 || parts.length === 0) parts.push(t('time_second', { value: secs.toString() }, langCode));

    return parts.join(', ');
}

function formatStartTime(uptimeSeconds: number, langCode?: string): string {
    const startDate = new Date(Date.now() - uptimeSeconds * 1000);
    return startDate.toLocaleString(langCode === 'id' ? 'id-ID' : 'en-US', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

const command: Command = {
    name: 'uptime',
    aliases: ['up'],
    description: 'Check how long the bot has been running',
    devOnly: true,

    async execute(sock, msg, _args, context) {
        const { from, lang } = context;
        const uptimeSeconds = process.uptime();
        const devCfg = getDevConfig();

        const text = replaceVariables(devCfg.uptime_template, {
            uptime: formatUptime(uptimeSeconds, lang),
            startTime: formatStartTime(uptimeSeconds, lang),
        });

        await sock.sendMessage(from, { text }, { quoted: msg });
    },
};

export default command;
