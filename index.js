const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");

    const sock = makeWASocket({
        auth: state
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrcode.generate(qr, { small: true }); // tampilkan QR di terminal
        }

        if (connection === "close") {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                console.log("⚠️ Reconnecting...");
                startBot();
            } else {
                console.log("🔴 Logged out, please scan QR again.");
            }
        } else if (connection === "open") {
            console.log("✅ Bot connected, mulai tarik & hapus pesan...");
            deleteMyOldMessages(sock);
        }
    });
}

// 🔥 Fungsi untuk menarik & hapus pesan lama
async function deleteMyOldMessages(sock) {
    try {
        const chats = await sock.groupFetchAllParticipating(); // ini hanya grup
        const allChats = await sock.ws.chatStore; // semua chat (private + grup)

        // Loop semua chat
        for (const jid in allChats) {
            // Skip kalau grup (biasanya jid berakhiran "@g.us")
            if (jid.endsWith("@g.us")) continue;

            console.log(`🔍 Memproses chat pribadi dengan: ${jid}`);

            // Ambil 50 pesan terakhir (bisa ditambah count)
            const messages = await sock.loadMessages(jid, 50, undefined);

            for (const msg of messages) {
                if (msg.key.fromMe) {
                    try {
                        await sock.sendMessage(jid, { delete: msg.key });
                        console.log(`🗑️ Pesan ${msg.key.id} di ${jid} berhasil dihapus`);
                    } catch (err) {
                        console.error(`❌ Gagal hapus pesan di ${jid}:`, err.message);
                    }
                }
            }
        }
    } catch (err) {
        console.error("⚠️ Error bulk delete:", err);
    }
}

startBot();
