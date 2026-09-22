import express from "express";
import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { Server } from "socket.io";
import { createRoom, addPlayer, startHand, act, publicState } from "./server/poker.mjs";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true, credentials: true } });
const rooms = new Map();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function roomCode() {
  let code;
  do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(""); } while (rooms.has(code));
  return code;
}

function broadcast(room) {
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit("room:state", publicState(room, player.id));
  }
}

function fail(callback, error) {
  callback?.({ ok: false, error: error instanceof Error ? error.message : String(error) });
}

io.on("connection", (socket) => {
  socket.on("room:create", (data, callback) => {
    try {
      const code = roomCode();
      const room = createRoom(code, { id: data.playerId, name: String(data.name || "玩家").slice(0, 16), socketId: socket.id });
      rooms.set(code, room);
      socket.join(code);
      callback?.({ ok: true, code });
      broadcast(room);
    } catch (error) { fail(callback, error); }
  });

  socket.on("room:join", (data, callback) => {
    try {
      const code = String(data.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) throw new Error("没有找到这个房间");
      addPlayer(room, { id: data.playerId, name: String(data.name || "玩家").slice(0, 16), socketId: socket.id });
      socket.join(code);
      callback?.({ ok: true, code });
      broadcast(room);
    } catch (error) { fail(callback, error); }
  });

  socket.on("room:leave", ({ code, playerId }) => {
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return;
    if (room.phase === "waiting") room.players = room.players.filter((p) => p.id !== playerId);
    else player.connected = false;
    if (room.hostId === playerId && room.players.length) room.hostId = room.players[0].id;
    if (!room.players.length) rooms.delete(code); else broadcast(room);
  });

  socket.on("game:start", ({ code, playerId }) => {
    const room = rooms.get(code);
    try {
      if (!room || room.hostId !== playerId) throw new Error("只有房主可以开始游戏");
      startHand(room);
      broadcast(room);
    } catch (error) { socket.emit("game:error", error.message); }
  });

  socket.on("game:next", ({ code, playerId }) => {
    const room = rooms.get(code);
    try {
      if (!room || room.hostId !== playerId) throw new Error("只有房主可以开始下一局");
      if (room.phase !== "showdown") throw new Error("当前牌局还没有结束");
      startHand(room);
      broadcast(room);
    } catch (error) { socket.emit("game:error", error.message); }
  });

  socket.on("game:action", ({ code, playerId, type, amount }, callback) => {
    const room = rooms.get(code);
    try {
      if (!room) throw new Error("房间不存在");
      act(room, playerId, type, amount);
      callback?.({ ok: true });
      broadcast(room);
    } catch (error) { socket.emit("game:error", error.message); fail(callback, error); }
  });

  socket.on("disconnect", () => {
    for (const room of rooms.values()) {
      const player = room.players.find((p) => p.socketId === socket.id);
      if (player) { player.connected = false; broadcast(room); }
    }
  });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static("dist"));
  app.get("*", (_req, res) => res.sendFile(new URL("./dist/index.html", import.meta.url).pathname));
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

const port = Number(process.env.PORT || 4173);
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`九人桌已启动：http://localhost:${port}`);
});
