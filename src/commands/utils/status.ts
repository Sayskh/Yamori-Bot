import { Command } from '../../types/Command';
import statusService from '../../services/statusService';
import { downloadMediaMessage } from 'baileys';

const command: Command = {
    name: 'status',
    aliases: ['sw', 'story'],
    description: 'View and save WhatsApp status/story',
    usage: '[index]',
    devOnly: true,

    async execute(sock, msg, args, context) {
        const { from } = context;

        const senders = statusService.getSenderList();

        if (args.length === 0) {
            if (senders.length === 0) {
                return sock.sendMessage(from, { text: '📭 Tidak ada status aktif yang terdeteksi.' }, { quoted: msg });
            }

            let responseText = `📋 *DAFTAR STATUS AKTIF* 📋\n`;
            responseText += `────────────────────\n`;
            senders.forEach((sender, idx) => {
                responseText += `*${idx + 1}.* 👤 ${sender.pushName} (@${sender.jid.split('@')[0]}) — [ ${sender.count} status ]\n`;
            });
            responseText += `────────────────────\n`;
            responseText += `Gunakan \`${context.prefix}sw <nomor>\` untuk mengunduh status mereka.`;

            return sock.sendMessage(from, {
                text: responseText,
                mentions: senders.map(s => s.jid)
            }, { quoted: msg });
        }

        let targetJid = '';
        let targetName = '';

        const mentionedJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
        if (mentionedJid) {
            targetJid = mentionedJid;
            const existing = senders.find(s => s.jid === targetJid);
            targetName = existing ? existing.pushName : `@${targetJid.split('@')[0]}`;
        } else {
            const index = parseInt(args[0]) - 1;
            if (!isNaN(index) && index >= 0 && index < senders.length) {
                targetJid = senders[index].jid;
                targetName = senders[index].pushName;
            } else {
                let rawNum = args[0].replace(/[^0-9]/g, '');
                if (rawNum) {
                    targetJid = `${rawNum}@s.whatsapp.net`;
                    const existing = senders.find(s => s.jid === targetJid);
                    targetName = existing ? existing.pushName : `@${rawNum}`;
                }
            }
        }

        if (!targetJid) {
            return sock.sendMessage(from, { text: '❌ Nomor daftar atau format JID tidak valid.' }, { quoted: msg });
        }

        const statuses = statusService.getStatusesBySender(targetJid);
        if (statuses.length === 0) {
            return sock.sendMessage(from, { 
                text: `❌ Tidak ada status aktif yang terdeteksi untuk *${targetName}*.`,
                mentions: [targetJid]
            }, { quoted: msg });
        }

        await sock.sendMessage(from, {
            text: `⏳ Mengunduh ${statuses.length} status dari *${targetName}*...`,
            mentions: [targetJid]
        }, { quoted: msg });

        for (const statusMsg of statuses) {
            const m = statusMsg.message;
            if (!m) continue;

            try {
                if (m.extendedTextMessage || m.conversation) {
                    const text = m.extendedTextMessage?.text || m.conversation || '';
                    await sock.sendMessage(from, {
                        text: `📝 *Status Text dari ${targetName}:*\n\n${text}`
                    });
                } else if (m.imageMessage) {
                    const buffer = await downloadMediaMessage(statusMsg, 'buffer', {});
                    await sock.sendMessage(from, {
                        image: buffer as Buffer,
                        caption: m.imageMessage.caption || `Gambar status dari ${targetName}`
                    });
                } else if (m.videoMessage) {
                    const buffer = await downloadMediaMessage(statusMsg, 'buffer', {});
                    await sock.sendMessage(from, {
                        video: buffer as Buffer,
                        caption: m.videoMessage.caption || `Video status dari ${targetName}`
                    });
                }
            } catch (err: any) {
                await sock.sendMessage(from, {
                    text: `❌ Gagal mengunduh salah satu status: ${err.message}`
                });
            }
        }
    }
};

export default command;
