const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const readline = require("readline");
const pino = require("pino");

// Store sederhana menggunakan object
const store = {
    chats: {},

    bind: function(ev) {
        ev.on('messages.upsert', ({ messages, type }) => {
            for (let msg of messages) {
                const jid = msg.key.remoteJid;
                if (!this.chats[jid]) this.chats[jid] = { messages: [] };
                this.chats[jid].messages.push(msg);
            }
        });
    }
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" })
    });

    store.bind(sock.ev);
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
        if (qr) qrcode.generate(qr, { small: true });

        if (connection === "open") {
            console.log("✅ Bot tersambung\n");

            // Ambil pesan terakhir dari chat
            let lastMsg;
            for (let [jid, chat] of Object.entries(store.chats)) {
                if (!jid.endsWith("@g.us") && chat.messages?.length) {
                    const myMsgs = chat.messages.filter(m => m.key.fromMe);
                    if (myMsgs.length) {
                        const latest = myMsgs.reduce((a, b) => (a.messageTimestamp > b.messageTimestamp ? a : b));
                        lastMsg = { jid, msg: latest };
                    }
                }
            }

            console.log(`Pesan Terakhir: ${lastMsg ? (lastMsg.msg.message?.conversation || "[Media/Non-text]") : "(belum ada pesan)"}\n`);
            console.log("1. Hapus semua pesan (24 jam terakhir)\n");

            rl.question("Pilih menu: ", async (choice) => {
                if (choice === "1") await hapusSemuaPesan(sock);
                rl.close();
            });
        }

        if (connection === "close") {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });
}

// Fungsi hapus semua pesan 24 jam terakhir
async function hapusSemuaPesan(sock) {
    const now = Math.floor(Date.now() / 1000);
    for (let [jid, chat] of Object.entries(store.chats)) {
        if (!jid.endsWith("@g.us") && chat.messages?.length) {
            for (let msg of chat.messages) {
                if (msg.key.fromMe && now - msg.messageTimestamp < 86400) {
                    try {
                        await sock.sendMessage(jid, { delete: msg.key });
                        console.log("✅ Dihapus:", jid, msg.key.id);
                    } catch (e) {
                        console.log("❌ Gagal hapus:", e.message);
                    }
                }
            }
        }
    }
    console.log("\nSelesai hapus semua pesan 24 jam terakhir.");
}

startBot();
