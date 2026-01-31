import mqtt from "mqtt";
import fetch from "node-fetch";
import {
  MeshCoreDecoder,
  PayloadType,
} from "@michaelhart/meshcore-decoder";

const SIZE = 100;

// ===== ENV =====
const MQTT_URL = "wss://meshcoremqtt.cloud.shiftr.io:443";
const MQTT_USER = "meshcoremqtt";
const MQTT_PASS = "public";

const API_ENDPOINT = "https://your-site.com/api/place/pixel";
const API_KEY = process.env.INTERNAL_API_KEY;

const SECRET_KEY = "a8c33404bd3f74a61e132df40b5a1bc4";

// ===== MeshCore =====
const keyStore = MeshCoreDecoder.createKeyStore({
  channelSecrets: [SECRET_KEY],
});

// ===== DEDUPE =====
const seenRaw = new Set();

// ===== MQTT =====
const client = mqtt.connect(MQTT_URL, {
  clientId: `worker_${Math.random().toString(16).slice(2)}`,
  username: MQTT_USER,
  password: MQTT_PASS,
  reconnectPeriod: 1000,
});

client.on("connect", () => {
  console.log("[MQTT] Connected");
  client.subscribe("#");
});

client.on("message", async (_, message) => {
  try {
    const payload = JSON.parse(message.toString());
    if (!payload?.data) return;

    const rawPacket = String(payload.data).trim();

    // Decode
    const decoded = MeshCoreDecoder.decode(rawPacket, { keyStore });

    const rawKey = JSON.stringify(decoded);
    if (seenRaw.has(rawKey)) return;
    seenRaw.add(rawKey);

    if (
      decoded.payloadType !== PayloadType.GroupText ||
      !decoded.payload?.decoded
    ) return;

    const { sender, message: text } = decoded.payload.decoded.decrypted ?? {};
    if (!text || !sender) return;

    // PX command
    const match = text.trim().match(
      /^PX\s+(-?\d+)\s+(-?\d+)\s+#([0-9A-Fa-f]{6})$/
    );
    if (!match) return;

    const x = Number(match[1]);
    const y = Number(match[2]);
    const color = `#${match[3]}`;

    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;

    // POST to server
    await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify({
        x,
        y,
        color,
        name: sender,
      }),
    });

    console.log(`[PX] ${sender} → (${x},${y}) ${color}`);
  } catch (err) {
    console.error("[Worker Error]", err);
  }
});

client.on("error", err => {
  console.error("[MQTT Error]", err);
});
