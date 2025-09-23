const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { makeInMemoryStore } = require("@naanzitos/baileys-make-in-memory-store"); // paket alternatif
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const readline = require("readline");
const pino = require("pino");

// buat store
const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: "silent" })
    });

    store.bind(sock.ev);
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) qrcode.generate(qr, { small: true });

        if (connection === "open") {
            console.log("✅ Bot tersambung\n");

            // ambil semua pesan dari store
            let lastMsg;
            for (let [jid, chat] of Object.entries(store.chats)) {
                if (!jid.endsWith("@g.us") && chat.messages) {
                    for (let msg of chat.messages) {
                        if (msg.key.fromMe) {
                            if (!lastMsg || msg.messageTimestamp > lastMsg.messageTimestamp) {
                                lastMsg = { jid, msg };
                            }
                        }
                    }
                }
            }

            if (lastMsg) {
                const textMsg = lastMsg.msg.message?.conversation || 
                                lastMsg.msg.message?.extendedTextMessage?.text || 
                                "[Media/Non-text]";
                console.log(`Pesan Terakhir: ${textMsg}\n`);
            } else {
                console.log("Pesan Terakhir: (belum ada pesan)\n");
            }

            console.log("1. Hapus semua pesan (24 jam terakhir)\n");

            rl.question("Pilih menu: ", async (choice) => {
                if (choice == "1") {
                    await hapusSemuaPesan(sock);
                }
                rl.close();
            });
        }

        if (connection === "close") {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startBot();
        }
    });
}

// fungsi hapus semua pesan 24 jam terakhir
async function hapusSemuaPesan(sock) {
    const now = Math.floor(Date.now() / 1000);
    for (let [jid, chat] of Object.entries(store.chats)) {
        if (!jid.endsWith("@g.us") && chat.messages) {
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
    console.log("\nSelesai hapus semua pesan dalam 24 jam terakhir.");
}

startBot();
