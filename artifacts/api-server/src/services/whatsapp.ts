import {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { logger } from "../lib/logger";
import { verifyClaim } from "./verification";

type WhatsappState = {
  status: "idle" | "connecting" | "qr_ready" | "connected" | "disconnected" | "error";
  phone: string | null;
  displayName: string | null;
  qr: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
};

const state: WhatsappState = {
  status: "idle",
  phone: null,
  displayName: null,
  qr: null,
  lastConnectedAt: null,
  lastError: null,
};

let socket: ReturnType<typeof makeWASocket> | null = null;
let starting = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let manuallyDisconnecting = false;

function greeting(name: string) {
  return `Hi ${name}.\n\nTruthLens Naija is here to help you check information before you share it.\n\nYou can:\n• Send a text claim to fact-check it\n• Send a photo, screenshot, or meme for visual analysis\n• Get a confidence score and evidence links\n\nPlease remember: a result is guidance, not a substitute for careful judgment.`;
}

function getMessageText(message: any) {
  return (
    message.message?.conversation ??
    message.message?.extendedTextMessage?.text ??
    message.message?.imageMessage?.caption ??
    ""
  ).trim();
}

function isGreeting(text: string) {
  return /^(hi|hello|hey|good morning|good afternoon|good evening|howdy|greetings)[!. ]*$/i.test(text);
}

async function handleMessage(message: any) {
  if (!socket || message.key.fromMe || !message.message) return;
  const activeSocket = socket;
  const jid = message.key.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const text = getMessageText(message);
  const name = message.pushName || jid.split("@")[0] || "there";

  if (isGreeting(text)) {
    await activeSocket.sendMessage(jid, { text: greeting(name) });
    return;
  }

  const imageMessage = message.message.imageMessage;
  if (!text && !imageMessage) return;
  let composingTimer: ReturnType<typeof setInterval> | undefined;
  try {
    await activeSocket.sendPresenceUpdate("composing", jid);
    composingTimer = setInterval(() => {
      void activeSocket.sendPresenceUpdate("composing", jid).catch(() => undefined);
    }, 4_000);
    await activeSocket.sendMessage(jid, {
      text: "I’m checking this with published fact-checks and current web evidence. One moment.",
    });

    let image: { data: string; mimeType: string } | undefined;
    if (imageMessage) {
      const buffer = await downloadMediaMessage(message, "buffer", {});
      image = {
        data: Buffer.from(buffer as Uint8Array).toString("base64"),
        mimeType: imageMessage.mimetype || "image/jpeg",
      };
    }

    const result = await verifyClaim({ content: text, source: "whatsapp", image });
    const verdict =
      result.verdict === "likely_true"
        ? "Likely true"
        : result.verdict === "likely_false"
          ? "Likely false"
          : result.verdict === "mixed"
            ? "Mixed evidence"
            : "Insufficient evidence";
    const sourceLines = result.sources
      .slice(0, 3)
      .map((source) => `• ${source.provider}: ${source.title}${source.url ? `\n  ${source.url}` : ""}`)
      .join("\n");
    await activeSocket.sendMessage(jid, {
      text: `TruthLens Naija result\n\nVerdict: ${verdict}\nConfidence: ${Math.round(result.confidence * 100)}%\n\n${result.summary}\n\nAI: ${result.aiProvider}\n\nEvidence:\n${sourceLines || "• No matching evidence found."}`,
    });
  } finally {
    if (composingTimer) clearInterval(composingTimer);
    await activeSocket.sendPresenceUpdate("paused", jid).catch(() => undefined);
  }
}

async function connect() {
  if (starting || state.status === "connected") return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  starting = true;
  manuallyDisconnecting = false;
  state.status = "connecting";
  state.lastError = null;
  try {
    const { state: authState, saveCreds } = await useMultiFileAuthState(".data/baileys");
    const { version } = await fetchLatestBaileysVersion().catch(() => ({
      version: [2, 3000, 1023223821] as [number, number, number],
    }));
    const nextSocket = makeWASocket({
      auth: authState,
      version,
      browser: Browsers.macOS("TruthLens Naija"),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      connectTimeoutMs: 60_000,
    });
    socket = nextSocket;
    nextSocket.ev.on("creds.update", saveCreds);
    nextSocket.ev.on("messages.upsert", ({ messages }) => {
      for (const message of messages) {
        void handleMessage(message).catch((error) => logger.error({ err: error }, "WhatsApp message handling failed"));
      }
    });
    nextSocket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (socket !== nextSocket) return;
      if (qr) {
        state.status = "qr_ready";
        state.qr = qr;
        void QRCode.toDataURL(qr).then((dataUrl: string) => {
          state.qr = dataUrl;
        });
      }
      if (connection === "open") {
        state.status = "connected";
        state.qr = null;
        state.phone = nextSocket.user?.id?.split(":")[0] ?? null;
        state.displayName = nextSocket.user?.name ?? null;
        state.lastConnectedAt = new Date().toISOString();
        state.lastError = null;
        starting = false;
      }
      if (connection === "close") {
        const errorCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        const loggedOut = errorCode === DisconnectReason.loggedOut;
        state.status = loggedOut || manuallyDisconnecting ? "disconnected" : "error";
        state.lastError = loggedOut || manuallyDisconnecting ? "Session logged out. Start a new session." : "WhatsApp connection closed.";
        socket = null;
        starting = false;
        if (!loggedOut && !manuallyDisconnecting) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            void connect();
          }, 2500);
        }
      }
    });
  } catch (error) {
    state.status = "error";
    state.lastError = error instanceof Error ? error.message : "Unable to start WhatsApp";
    starting = false;
    logger.error({ err: error }, "WhatsApp session failed to start");
  }
}

export function getWhatsappStatus(): WhatsappState {
  return { ...state };
}

export function startWhatsappSession() {
  void connect();
  return getWhatsappStatus();
}

export async function disconnectWhatsappSession() {
  manuallyDisconnecting = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  const activeSocket = socket;
  socket = null;
  if (activeSocket) {
    await activeSocket.logout().catch((error) => {
      logger.warn({ err: error }, "WhatsApp logout did not complete cleanly");
    });
  }
  starting = false;
  state.status = "disconnected";
  state.qr = null;
  state.phone = null;
  state.displayName = null;
  return getWhatsappStatus();
}