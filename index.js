import mqtt from "mqtt";
import fetch from "node-fetch";
import {
  MeshCoreDecoder,
  PayloadType,
} from "@michaelhart/meshcore-decoder";

const SIZE = 100;

// ===== ENV =====
// Original MeshCore MQTT
const MQTT_URL = "wss://meshcoremqtt.cloud.shiftr.io:443";
const MQTT_USER = "meshcoremqtt";
const MQTT_PASS = "public";

// Second MQTT for broadcasting updates
const BROADCAST_MQTT_URL = "wss://meshplacegrid.cloud.shiftr.io:443";
const BROADCAST_USER = "meshplacegrid";
const BROADCAST_PASS = process.env.BROADCAST_KEY;
const BROADCAST_TOPIC = "pixels";

// API server
const API_ENDPOINT = "https://ve7oov.ca/api/place/pixel";

// MeshCore secret
const SECRET_KEY = "a8c33404bd3f74a61e132df40b5a1bc4";

// ===== MeshCore =====
const keyStore = MeshCoreDecoder.createKeyStore({
  channelSecrets: [SECRET_KEY],
});

// ===== DEDUPE =====
const seenRaw = new Set();

// ===== MQTT Clients =====
// Original listener
const client = mqtt.connect(MQTT_URL, {
  clientId: `worker_${Math.random().toString(16).slice(2)}`,
  username: MQTT_USER,
  password: MQTT_PASS,
  reconnectPeriod: 1000,
});

// Broadcast MQTT
const broadcastClient = mqtt.connect(BROADCAST_MQTT_URL, {
  clientId: `broadcast_${Math.random().toString(16).slice(2)}`,
  username: BROADCAST_USER,
  password: BROADCAST_PASS,
  reconnectPeriod: 1000,
});

client.on("connect", () => {
  console.log("[MQTT] Connected to MeshCore");
  client.subscribe("#");
});

broadcastClient.on("connect", () => {
  console.log("[Broadcast MQTT] Connected to meshplacegrid");
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
    const name = sender;

    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;

    // POST to server
    await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x, y, color, name }),
    });

    // Publish to second MQTT so all clients update in real-time
    broadcastClient.publish(
      BROADCAST_TOPIC,
      JSON.stringify({ x, y, color, name }),
      { qos: 1, retain: true } // retain ensures new clients get the last state
    );

    console.log(`[PX] ${sender} → (${x},${y}) ${color}`);
  } catch (err) {
    console.error("[Worker Error]", err);
  }
});

client.on("error", err => console.error("[MQTT Error]", err));
broadcastClient.on("error", err => console.error("[Broadcast MQTT Error]", err));
