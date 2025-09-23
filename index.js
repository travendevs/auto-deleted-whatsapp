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

    bind: function (ev) {
        ev.on("messages.upsert", ({ messages }) => {
            for (let msg of messages) {
                const jid = msg.key.remoteJid;

                // abaikan group / broadcast
                if (jid.endsWith("@g.us") || jid.endsWith("@broadcast")) continue;

                // hanya catat pesan yang kita kirim
                if (!msg.key.fromMe) continue;

                if (!this.chats[jid]) {
                    this.chats[jid] = { messages: [] };
                }

                // Cegah duplikat
                const exists = this.chats[jid].messages.some(
                    (m) => m.key.id === msg.key.id
                );
                if (exists) continue;

                this.chats[jid].messages.push(msg);

                // log saat kita mengirim
                const content = msg.message?.conversation || "[Media/Non-text]";
                console.log(`📨 Kamu mengirim ke ${jid}: ${content}`);
            }
        });
    },
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// ---- MENU AWAL BERDASARKAN SESSION ----
function showInitialMenu() {
    const sessionExists = fs.existsSync(SESSION_DIR);

    if (sessionExists) {
        console.log("1. Login Session (Session Tersedia)");
        console.log("2. Hapus Session");
        console.log("9. Keluar");

        rl.question("Pilih menu: ", async (choice) => {
            if (choice === "1") {
                console.log("✅ Memulai login dengan session...");
                startBot();
            } else if (choice === "2") {
                fs.rmSync(path.join(SESSION_DIR), { recursive: true, force: true });
                console.log("✅ Session dihapus!");
                rl.close();
            } else if (choice === "9") {
                console.log("Keluar...");
                process.exit(0);
            } else {
                console.log("Pilihan tidak valid");
                showInitialMenu();
            }
        });
    } else {
        console.log("1. Tampilkan Barcode Login (Session Tidak Tersedia)");
        console.log("9. Keluar");

        rl.question("Pilih menu: ", async (choice) => {
            if (choice === "1") {
                console.log("Silakan scan QR untuk login...");
                startBot();
            } else if (choice === "9") {
                console.log("Keluar...");
                process.exit(0);
            } else {
                console.log("Pilihan tidak valid");
                showInitialMenu();
            }
        });
    }
}

// ---- START BOT (LOGIN / QR) ----
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: "silent" }),
        });

        // reset store setiap kali bot mulai
        store.chats = {};

        store.bind(sock.ev);
        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
            if (qr) {
                console.log("🔹 Scan QR untuk login:");
                qrcode.generate(qr, { small: true });
            }

            if (connection === "open") {
                console.log("✅ Bot tersambung\n");
                showMainMenu(sock);
            }

            if (connection === "close") {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (
                    [DisconnectReason.badSession, DisconnectReason.loggedOut, DisconnectReason.connectionClosed].includes(
                        reason
                    )
                ) {
                    console.log("❌ Session tidak bisa digunakan");
                    showInitialMenu();
                } else {
                    startBot();
                }
            }
        });
    } catch (e) {
        console.log("❌ Session tidak bisa digunakan");
        showInitialMenu();
    }
}

// ---- MENU UTAMA BOT ----
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
            console.log("✅ Session dihapus!");
            process.exit(0);
        } else {
            showMainMenu(sock);
        }
    });
}

// ---- HAPUS PESAN 24 JAM TERAKHIR (SEMUA NOMOR) ----
async function hapusSemuaPesan(sock) {
    const now = Math.floor(Date.now() / 1000);

    for (let [jid, chat] of Object.entries(store.chats)) {
        if (chat.messages?.length) {
            let remaining = [];

            for (let msg of chat.messages) {
                if (msg.key.fromMe && now - msg.messageTimestamp < 86400) {
                    try {
                        await sock.sendMessage(jid, { delete: msg.key });
                        console.log(`🗑️ Dihapus: ${jid} (${msg.key.id})`);
                        // pesan dibuang dari log
                    } catch (err) {
                        console.log(`⚠️ Gagal hapus: ${jid} (${msg.key.id})`);
                        remaining.push(msg);
                    }
                } else {
                    remaining.push(msg);
                }
            }

            store.chats[jid].messages = remaining;
        }
    }

    console.log("\nSelesai hapus semua pesan 24 jam terakhir.");
}

// ---- MULAI ----
showInitialMenu();
