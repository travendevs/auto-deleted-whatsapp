const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const qrcode = require("qrcode-terminal");

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("./session");

    const sock = makeWASocket({
        auth: state
        // jangan pakai printQRInTerminal lagi
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
            console.log("✅ Bot connected");
        }
    });

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

startBot();                } catch (err) {
                    console.error("❌ Failed delete:", err);
                }
            }
        }
    });
}

startBot();
