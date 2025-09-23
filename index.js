const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const readline = require("readline");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const SESSION_DIR = "./session";

// Store sederhana menggunakan object
const store = {
    chats: {},

    bind: function(ev) {
        ev.on('messages.upsert', ({ messages }) => {
            for (let msg of messages) {
                const jid = msg.key.remoteJid;

                // Simpan pesan
                if (!this.chats[jid]) this.chats[jid] = { messages: [] };
                this.chats[jid].messages.push(msg);

                // Notifikasi pesan terkirim
                if (msg.key.fromMe) {
                    console.log(`📨 Kamu telah mengirim pesan ke ${jid}: ${msg.message?.conversation || "[Media/Non-text]"}`);
                }
            }
        });
    }
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: "silent" })
        });

        store.bind(sock.ev);
        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
            if (qr) {
                console.log("🔹 Session belum aktif, scan QR berikut:");
                qrcode.generate(qr, { small: true });
                showMenuQRCode();
            }

            if (connection === "open") {
                console.log("✅ Bot tersambung\n");
                showMainMenu(sock);
            }

            if (connection === "close") {
                const reason = lastDisconnect?.error?.output?.statusCode;

                // Session invalid atau nomor ditangguhkan
                if (reason === DisconnectReason.badSession || reason === DisconnectReason.loggedOut || reason === DisconnectReason.connectionClosed) {
                    console.log("❌ Session tidak bisa digunakan");
                    showMenuQRCode();
                } else {
                    startBot();
                }
            }
        });

    } catch (e) {
        // Jika session gagal di-load
        console.log("❌ Session tidak bisa digunakan");
        showMenuQRCode();
    }
}

function showMenuQRCode() {
    console.log("\n1. Tampilkan Barcode Baru");
    rl.question("Pilih menu: ", async (choice) => {
        if (choice === "1") {
            console.log("Silakan scan QR untuk login...");
            startBot();
        } else {
            rl.close();
        }
    });
}

function showMainMenu(sock) {
    console.log("Menu:");
    console.log("1. Hapus semua pesan (24 jam terakhir)");
    console.log("9. Keluar");
    console.log("00. Hapus Session Perangkat");

    rl.question("Pilih menu: ", async (choice) => {
        if (choice === "1") {
            await hapusSemuaPesan(sock);
            showMainMenu(sock);
        } else if (choice === "9") {
            console.log("Keluar...");
            process.exit(0);
        } else if (choice === "00") {
            fs.rmSync(path.join(SESSION_DIR), { recursive: true, force: true });
            console.log("Session dihapus!");
            process.exit(0);
        } else {
            showMainMenu(sock);
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
                    } catch {}
                }
            }
        }
    }
    console.log("\nSelesai hapus semua pesan 24 jam terakhir.");
}

startBot();
