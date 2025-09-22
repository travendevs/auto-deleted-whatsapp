const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log("⚠️ Reconnecting...");
                startBot();
            } else {
                console.log("🔴 Logged out, please scan QR again.");
            }
        } else if (connection === "open") {
            console.log("✅ Bot connected");
        }
    });

    // Auto delete pesan yang dikirim sendiri
    sock.ev.on("messages.upsert", async ({ messages }) => {
        for (const msg of messages) {
            if (!msg.message) continue;
            if (msg.key.fromMe) {
                try {
                    await sock.sendMessage(msg.key.remoteJid, { delete: msg.key });
                    console.log("🗑️ Deleted message:", msg.key.id);
                } catch (err) {
                    console.error("❌ Failed delete:", err);
                }
            }
        }
    });
}

startBot();
