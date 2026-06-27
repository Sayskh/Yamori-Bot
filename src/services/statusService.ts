import { WAMessage } from 'baileys';

interface StatusItem {
    msg: WAMessage;
    timestamp: number;
}

class StatusService {
    // Map of senderJid -> Array of active StatusItem
    private cache = new Map<string, StatusItem[]>();

    addStatus(msg: WAMessage) {
        const remoteJid = msg.key?.remoteJid;
        if (remoteJid !== 'status@broadcast') return;

        const sender = msg.key.participant || '';
        if (!sender) return;

        const now = Date.now();
        let list = this.cache.get(sender);
        if (!list) {
            list = [];
            this.cache.set(sender, list);
        }

        // Avoid duplicates
        if (!list.find(item => item.msg.key?.id === msg.key?.id)) {
            list.push({ msg, timestamp: now });
        }

        this.cleanExpired();
    }

    getSenderList() {
        this.cleanExpired();
        const senders: { jid: string; count: number; pushName: string }[] = [];
        
        for (const [jid, list] of this.cache.entries()) {
            if (list.length > 0) {
                senders.push({
                    jid,
                    count: list.length,
                    pushName: list[0].msg.pushName || jid.split('@')[0]
                });
            }
        }
        return senders.sort((a, b) => a.pushName.localeCompare(b.pushName));
    }

    getStatusesBySender(jid: string): WAMessage[] {
        this.cleanExpired();
        const list = this.cache.get(jid) || [];
        return list.map(item => item.msg);
    }

    private cleanExpired() {
        const expiryTime = 24 * 60 * 60 * 1000; // 24 hours
        const now = Date.now();

        for (const [jid, list] of this.cache.entries()) {
            const filtered = list.filter(item => (now - item.timestamp) < expiryTime);
            if (filtered.length === 0) {
                this.cache.delete(jid);
            } else {
                this.cache.set(jid, filtered);
            }
        }
    }
}

export default new StatusService();
