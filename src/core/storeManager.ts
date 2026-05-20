import { proto, WASocket } from 'baileys';

const MAX_MESSAGES_PER_JID = 20;
const MAX_JIDS = 100;

class SimpleStore {
    public messages: Map<string, proto.IWebMessageInfo[]> = new Map();
    private currentSock: WASocket | null = null;
    private upsertListener: ((update: { messages: proto.IWebMessageInfo[], type: any }) => void) | null = null;

    bind(sock: WASocket) {
        if (this.currentSock === sock) return;

        // Remove old listener if re-binding to prevent memory leaks
        if (this.currentSock && this.upsertListener) {
            this.currentSock.ev.off('messages.upsert', this.upsertListener);
        }

        this.currentSock = sock;

        this.upsertListener = (update) => {
            for (const msg of update.messages) {
                const jid = msg.key?.remoteJid;
                if (!jid) continue;

                let list = this.messages.get(jid);
                if (!list) {
                    if (this.messages.size >= MAX_JIDS) {
                        const oldestKey = this.messages.keys().next().value;
                        if (oldestKey) this.messages.delete(oldestKey);
                    }
                    list = [];
                    this.messages.set(jid, list);
                }

                if (!list.find(m => m.key?.id === msg.key?.id)) {
                    list.push(msg);
                    if (list.length > MAX_MESSAGES_PER_JID) {
                        list.shift();
                    }
                }
            }
        };

        sock.ev.on('messages.upsert', this.upsertListener);
    }

    isBoundTo(sock: WASocket): boolean {
        return this.currentSock === sock;
    }

    findMessage(jid: string, messageId: string): proto.IWebMessageInfo | null {
        const list = this.messages.get(jid);
        if (!list || !messageId) return null;
        return list.find(m => m.key?.id === messageId) || null;
    }
}

export class StoreManager {
    private stores: Map<string, SimpleStore> = new Map();

    getStore(sessionId: string): SimpleStore {
        let store = this.stores.get(sessionId);
        if (!store) {
            store = new SimpleStore();
            this.stores.set(sessionId, store);
        }
        return store;
    }

    bind(sessionId: string, sock: WASocket) {
        const store = this.getStore(sessionId);
        store.bind(sock);
    }

    deleteStore(sessionId: string) {
        this.stores.delete(sessionId);
    }

    findMessageBySocket(sock: WASocket, jid: string, messageId: string): proto.IWebMessageInfo | null {
        for (const store of this.stores.values()) {
            if (!store.isBoundTo(sock)) continue;
            const found = store.findMessage(jid, messageId);
            if (found) return found;
        }
        return null;
    }
}

export const storeManager = new StoreManager();
