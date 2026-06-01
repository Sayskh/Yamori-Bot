import { Command } from '../../types/Command';
import { getLangConfig } from '../../core/configLoader';

const command: Command = {
    name: 'lang',
    aliases: ['language'],
    description: 'Set group language (en/id)',
    usage: 'en / id',
    groupAdminOnly: true,

    async execute(sock, msg, args, context) {
        const { from, prefix, dataManager, botId, t } = context;

        const settings = await dataManager.db.getGroupSettings(botId, from);
        const currentLangName = settings.language === 'id' ? 'Bahasa Indonesia' : 'English';

        if (!args[0]) {
            return sock.sendMessage(from, {
                text: t('lang_current', { lang: currentLangName, prefix })
            }, { quoted: msg });
        }

        const chosen = args[0].toLowerCase();
        if (!['en', 'id'].includes(chosen)) {
            return sock.sendMessage(from, {
                text: t('lang_invalid')
            }, { quoted: msg });
        }

        await dataManager.db.setGroupLanguage(botId, from, chosen);

        const newLangName = chosen === 'id' ? 'Bahasa Indonesia' : 'English';

        // Fetch translations in the newly chosen language to reply in the new language!
        const newTranslations = getLangConfig(chosen);
        let successText = newTranslations['lang_changed'] || 'Group language successfully changed to: {lang}';
        successText = successText.replace('{lang}', newLangName);

        await sock.sendMessage(from, { text: successText }, { quoted: msg });
    },
};

export default command;
