const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");
const readline = require("readline");

// Buat input dari terminal
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");

    const sock = makeWASocket({
        auth: state,
        logger: undefined // 🔇 matikan log bawaan biar bersih
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
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
            console.log("✅ Bot connected\n");

            // Tampilkan pesan terakhir sebelum menu
            await showLastMessages(sock);

            // Munculkan menu
            showMenu(sock);
        }
    });
}

// 🔥 Tampilkan pesan terakhir dari semua private chat
async function showLastMessages(sock) {
    try {
        const allChats = sock?.store?.chats || {};
        console.log("📩 Pesan Terakhir:\n");

        for (const jid of Object.keys(allChats)) {
            if (jid.endsWith("@g.us")) continue; // skip grup

            const messages = await sock.loadMessages(jid, 1, undefined);
            if (messages.length > 0) {
                const msg = messages[0];
                let text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "[Non-text message]";
                console.log(`👤 ${jid} → ${text}`);
            }
        }
        console.log("\n-------------------------\n");
    } catch (err) {
        console.error("⚠️ Error saat ambil pesan terakhir:", err);
    }
}

// 🔥 Menu interaktif
function showMenu(sock) {
    console.log("=== MENU BOT ===");
    console.log("1. Tarik semua pesan (hapus pesan lama dari private chat)\n");

    rl.question("Pilih opsi: ", async (answer) => {
        if (answer.trim() === "1") {
            await deleteMyOldMessages(sock);
        } else {
            console.log("❌ Opsi tidak dikenal");
        }
        showMenu(sock); // tampilkan menu lagi setelah selesai
    });
}

// 🔥 Fungsi untuk menarik & hapus pesan lama
async function deleteMyOldMessages(sock) {
    try {
        const allChats = sock?.store?.chats || {};

        for (const jid of Object.keys(allChats)) {
            if (jid.endsWith("@g.us")) continue; // skip grup

            console.log(`🔍 Memproses chat pribadi dengan: ${jid}`);

            const messages = await sock.loadMessages(jid, 50, undefined);

            for (const msg of messages) {
                if (msg.key.fromMe) {
                    try {
                        await sock.sendMessage(jid, { delete: msg.key });
                        console.log(`🗑️ Pesan ${msg.key.id} di ${jid} berhasil dihapus`);
                    } catch (err) {
                        console.error(`❌ Gagal hapus pesan di ${jid}: ${err.message}`);
                    }
                }
            }
        }
        console.log("✅ Semua pesan pribadi sudah diproses.");
    } catch (err) {
        console.error("⚠️ Error bulk delete:", err);
    }
}

startBot();
