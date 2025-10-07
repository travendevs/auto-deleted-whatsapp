const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const readline = require("readline");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const SESSIONS_ROOT = "./sessions";
let SESSION_DIR = "";
let isDeleting = false;
let repliedUsers = new Set(); // simpan nomor yg sudah auto-reply

// ===== Sekar: Store sederhana untuk simpan pesan =====
const store = {
    chats: {},

    bind: function (ev, sock) {
        ev.on("messages.upsert", async ({ messages }) => {
            for (let msg of messages) {
                const jid = msg.key.remoteJid;

                if (jid.endsWith("@g.us") || jid.endsWith("@broadcast")) continue;

                const isText = !!msg.message?.conversation;
                const isImage = !!msg.message?.imageMessage;
                if (!isText && !isImage) continue;

                if (!this.chats[jid]) {
                    this.chats[jid] = { messages: [] };
                }

                const exists = this.chats[jid].messages.some((m) => m.key.id === msg.key.id);
                if (exists) continue;

                this.chats[jid].messages.push(msg);

                if (msg.key.fromMe && !isDeleting) {
                    let content = isText ? msg.message.conversation : "[Gambar]";
                    console.log(`📨 Kamu mengirim ke ${jid}: ${content}`);
                }

                // ===== Auto-reply sekali per nomor =====
                if (!msg.key.fromMe && !repliedUsers.has(jid)) {
                    repliedUsers.add(jid);

                    const delayMs = (Math.floor(Math.random() * (10 - 3 + 1)) + 3) * 60 * 1000;
                    console.log(`⏳ Akan auto-reply ke ${jid} dalam ${(delayMs / 60000).toFixed(1)} menit`);

                    setTimeout(async () => {
                        try {
                            const sent = await sock.sendMessage(jid, { text: "maaf salah nomor" });
                            console.log(`🤖 Auto-reply ke ${jid}: "maaf salah nomor"`);
                            if (sent?.key) {
                                if (!this.chats[jid]) this.chats[jid] = { messages: [] };
                                this.chats[jid].messages.push(sent);
                            }
                        } catch (err) {
                            console.log(`⚠️ Gagal auto-reply ke ${jid}:`, err);
                        }
                    }, delayMs);
                }
            }
        });
    },
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// ====== Sekar: Menu Multi Login ======
function showMultiLoginMenu() {
    if (!fs.existsSync(SESSIONS_ROOT)) fs.mkdirSync(SESSIONS_ROOT);
    const folders = fs.readdirSync(SESSIONS_ROOT).filter(f => fs.lstatSync(path.join(SESSIONS_ROOT, f)).isDirectory());

    console.log("\n==== MENU MULTI LOGIN ====");
    if (folders.length === 0) {
        console.log("Belum ada session tersimpan.");
    } else {
        console.log("Daftar session:");
        folders.forEach((f, i) => {
            console.log(`${i + 1}. ${f}`);
        });
    }
    console.log("N. Tambah session baru");
    console.log("9. Keluar\n");

    rl.question("Pilih nomor atau buat baru (mis. 1 / N / 9): ", (ans) => {
        if (ans === "9") {
            console.log("Keluar...");
            process.exit(0);
        } else if (ans.toLowerCase() === "n") {
            rl.question("Masukkan nama atau nomor session baru: ", (newName) => {
                if (!newName.trim()) return showMultiLoginMenu();
                SESSION_DIR = path.join(SESSIONS_ROOT, newName);
                fs.mkdirSync(SESSION_DIR, { recursive: true });
                console.log(`📱 Membuat session baru: ${newName}`);
                showInitialMenu();
            });
        } else {
            const index = parseInt(ans) - 1;
            if (folders[index]) {
                SESSION_DIR = path.join(SESSIONS_ROOT, folders[index]);
                console.log(`📲 Menggunakan session: ${folders[index]}`);
                showInitialMenu();
            } else {
                console.log("Pilihan tidak valid.");
                showMultiLoginMenu();
            }
        }
    });
}

// ===== Sekar: Menu awal session =====
function showInitialMenu() {
    const sessionExists = fs.existsSync(SESSION_DIR) && fs.existsSync(path.join(SESSION_DIR, "creds.json"));

    console.log("\n==== MENU SESSION ====");
    if (sessionExists) {
        console.log("1. Login Session (Session Tersedia)");
        console.log("2. Hapus Session Ini");
        console.log("3. Ganti Session (Multi Login)");
        console.log("9. Keluar");
    } else {
        console.log("1. Tampilkan Barcode Login (Session Baru)");
        console.log("3. Ganti Session (Multi Login)");
        console.log("9. Keluar");
    }

    rl.question("Pilih menu: ", async (choice) => {
        if (choice === "1") {
            console.log("✅ Memulai login...");
            startBot();
        } else if (choice === "2" && sessionExists) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            console.log("✅ Session dihapus!");
            showMultiLoginMenu();
        } else if (choice === "3") {
            showMultiLoginMenu();
        } else if (choice === "9") {
            console.log("Keluar...");
            process.exit(0);
        } else {
            console.log("Pilihan tidak valid.");
            showInitialMenu();
        }
    });
}

// ===== Sekar: Start bot =====
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
                console.log("✅ Bot tersambung!\n");
                showMainMenu(sock);
            }

            if (connection === "close") {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if ([DisconnectReason.badSession, DisconnectReason.loggedOut, DisconnectReason.connectionClosed].includes(reason)) {
                    console.log("❌ Session tidak bisa digunakan");
                    showInitialMenu();
                } else {
                    startBot();
                }
            }
        });
    } catch (e) {
        console.log("❌ Session tidak bisa digunakan:", e.message);
        showInitialMenu();
    }
}

// ===== Sekar: Menu utama =====
function showMainMenu(sock) {
    console.log("\n==== MENU UTAMA ====");
    console.log("1. Hapus semua pesan (24 jam terakhir)");
    console.log("2. Ganti Session (Multi Login)");
    console.log("9. Keluar");
    console.log("00. Hapus Session Ini");

    rl.question("Pilih menu: ", async (choice) => {
        if (choice === "1") {
            await hapusSemuaPesan(sock);
            showMainMenu(sock);
        } else if (choice === "2") {
            sock.end();
            showMultiLoginMenu();
        } else if (choice === "9") {
            console.log("Keluar...");
            process.exit(0);
        } else if (choice === "00") {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            console.log("✅ Session dihapus!");
            showMultiLoginMenu();
        } else {
            showMainMenu(sock);
        }
    });
}

// ===== Sekar: Hapus pesan 24 jam terakhir =====
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
                    remaining.push(msg);
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
    console.log("\nSelesai hapus semua pesan 24 jam terakhir.");
}

// ===== Jalankan Bot =====
showMultiLoginMenu();
