import { Command } from '../../types/Command';

const command: Command = {
    name: 'ping',
    aliases: ['p'],
    description: 'Check bot latency',

    async execute(sock, msg, _args, context) {
        const { t } = context;
        const start = Date.now();
        const sentMsg = await sock.sendMessage(context.from, {
            text: t('pinging'),
        }, { quoted: msg });

        if (sentMsg) {
            const latency = Date.now() - start;
            await sock.sendMessage(context.from, {
                text: `${t('pong')} *${latency}ms*`,
                edit: sentMsg.key,
            });
        }
    },
};

export default command;
