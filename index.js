const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const readline = require("readline");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const SESSION_DIR = "./session";
let isDeleting = false;
let repliedUsers = new Set(); // simpan nomor yg sudah auto-reply

// Store sederhana menggunakan object
const store = {
    chats: {},

    bind: function (ev, sock) {
        ev.on("messages.upsert", async ({ messages }) => {
            for (let msg of messages) {
                const jid = msg.key.remoteJid;

                // abaikan group & broadcast
                if (jid.endsWith("@g.us") || jid.endsWith("@broadcast")) continue;

                // filter: hanya teks & gambar
                const isText = !!msg.message?.conversation;
                const isImage = !!msg.message?.imageMessage;
                if (!isText && !isImage) continue;

                if (!this.chats[jid]) {
                    this.chats[jid] = { messages: [] };
                }

                // cegah duplikat
                const exists = this.chats[jid].messages.some(
                    (m) => m.key.id === msg.key.id
                );
                if (exists) continue;

                this.chats[jid].messages.push(msg);

                // log hanya pesan keluar (fromMe)
                if (msg.key.fromMe && !isDeleting) {
                    let content = isText
                        ? msg.message.conversation
                        : "[Gambar]";
                    console.log(`📨 Kamu mengirim ke ${jid}: ${content}`);
                }

                // auto-reply sekali per nomor jika ada pesan masuk
                if (!msg.key.fromMe && !repliedUsers.has(jid)) {
                    try {
                        await sock.sendMessage(jid, { text: "maaf salah nomor" });
                        console.log(`🤖 Auto-reply ke ${jid}: "maaf salah nomor"`);
                        repliedUsers.add(jid); // tandai sudah dibalas
                    } catch (err) {
                        console.log(`⚠️ Gagal auto-reply ke ${jid}:`, err);
                    }
                }
            }
        });
    },
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// ---- MENU AWAL ----
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

// ---- START BOT ----
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: "silent" }),
        });

        store.chats = {};
        repliedUsers = new Set();

        store.bind(sock.ev, sock);
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

// ---- MENU UTAMA ----
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

// ---- HAPUS PESAN 24 JAM TERAKHIR ----
async function hapusSemuaPesan(sock) {
    const now = Math.floor(Date.now() / 1000);

    isDeleting = true;
    for (let [jid, chat] of Object.entries(store.chats)) {
        if (!jid.endsWith("@g.us") && chat.messages?.length) {
            let remaining = [];

            for (let msg of chat.messages) {
                const isText = !!msg.message?.conversation;
                const isImage = !!msg.message?.imageMessage;

                if (!(isText || isImage)) {
                    remaining.push(msg); // skip selain teks/gambar
                    continue;
                }

                if (msg.key.fromMe && now - msg.messageTimestamp < 86400) {
                    try {
                        await sock.sendMessage(jid, { delete: msg.key });
                        console.log(`🗑️ Dihapus: ${jid} (${msg.key.id})`);
                    } catch {
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
    isDeleting = false;
    console.log("\nSelesai hapus semua pesan teks/gambar 24 jam terakhir.");
}

// ---- MULAI ----
showInitialMenu();
