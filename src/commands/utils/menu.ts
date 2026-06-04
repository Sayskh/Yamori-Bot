import { Command } from '../../types/Command';
import config from '../../config';
import { getMenuConfig } from '../../core/configLoader';

const command: Command = {
    name: 'menu',
    aliases: ['help', 'm'],
    description: 'Display list of commands',

    async execute(sock, msg, args, context) {
        const { from, isBotAdmin, commands, prefix, t } = context;

        if (!commands) {
            await sock.sendMessage(from, { text: t('menu_load_fail') });
            return;
        }

        const p = prefix || config.prefix;
        const menuCfg = getMenuConfig();

        if (args.length > 0) {
            const cmdName = args[0].toLowerCase();
            const cmd = commands.get(cmdName);

            if (!cmd) {
                await sock.sendMessage(from, { text: t('command_not_found', { cmd: cmdName }) });
                return;
            }

            const descKey = `cmd_desc_${cmd.name}`;
            const desc = t(descKey) !== descKey ? t(descKey) : (cmd.description || t('no_desc'));

            let text = `━━━ *${cmd.name.toUpperCase()}* ━━━\n\n`;
            text += `${desc}\n\n`;
            if (cmd.aliases && cmd.aliases.length > 0) {
                text += `${t('aliases')}  : ${cmd.aliases.join(', ')}\n`;
            }
            text += `${t('usage')}    : ${p}${cmd.name}`;
            if (cmd.usage) text += ` ${cmd.usage}`;
            text += `\n`;
            if (cmd.groupAdminOnly) text += `${t('access')}   : Group Admin\n`;
            else if (cmd.devOnly) text += `${t('access')}   : Developer\n`;

            await sock.sendMessage(from, { text });
            return;
        }

        const commandsByCategory: Record<string, Command[]> = {};
        const processedCommands = new Set<string>();

        commands.forEach((cmd) => {
            if (processedCommands.has(cmd.name)) return;
            processedCommands.add(cmd.name);

            const category = cmd.category || 'Uncategorized';
            if (!commandsByCategory[category]) commandsByCategory[category] = [];
            commandsByCategory[category].push(cmd);
        });

        const categories = Object.keys(commandsByCategory).sort((a, b) => {
            const indexA = menuCfg.categoriesOrder.indexOf(a);
            const indexB = menuCfg.categoriesOrder.indexOf(b);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return a.localeCompare(b);
        });

        let menu = menuCfg.header
            .replace(/{botName}/g, config.botName)
            .replace(/{prefix}/g, p) + `\n\n`;

        categories.forEach(category => {
            if (category.toLowerCase() === 'dev' && !isBotAdmin) return;

            const label = menuCfg.categoryLabels[category] || category.toUpperCase();
            const cmds = commandsByCategory[category];

            menu += menuCfg.categoryHeader.replace('{category}', label) + `\n`;

            cmds.forEach(cmd => {
                menu += menuCfg.commandItem.replace('{command}', cmd.name) + `\n`;
            });
            menu += `\n`;
        });

        const footer = menuCfg.footer
            .replace(/{botName}/g, config.botName)
            .replace(/{prefix}/g, p);

        menu += footer;

        await sock.sendMessage(from, { text: menu });
    }
};

export default command;
