import { Command } from '../../types/Command';

/** .ping — Reports round-trip latency in milliseconds. */
const command: Command = {
    name: 'ping',
    aliases: ['p'],
    description: 'Cek latensi bot',

    async execute(sock, msg, _args, context) {
        const start = Date.now();
        const sentMsg = await sock.sendMessage(context.from, {
            text: '🏓 Pinging...',
        }, { quoted: msg });

        if (sentMsg) {
            const latency = Date.now() - start;
            await sock.sendMessage(context.from, {
                text: `🏓 Pong! *${latency}ms*`,
                edit: sentMsg.key,
            });
        }
    },
};

export default command;
