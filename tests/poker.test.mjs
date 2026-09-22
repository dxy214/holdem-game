import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, compareScores, createRoom, addPlayer, startHand, act } from "../server/poker.mjs";

const c = (rank, suit = "♠") => ({ rank, suit });

test("皇家同花顺高于四条", () => {
  const royal = evaluate([c("A"), c("K"), c("Q"), c("J"), c("10"), c("2", "♥"), c("3", "♦")]);
  const quads = evaluate([c("A"), c("A", "♥"), c("A", "♦"), c("A", "♣"), c("K"), c("2", "♥"), c("3", "♦")]);
  assert.equal(royal.name, "皇家同花顺");
  assert.ok(compareScores(royal.score, quads.score) > 0);
});

test("识别 A2345 顺子", () => {
  const hand = evaluate([c("A"), c("2", "♥"), c("3", "♦"), c("4", "♣"), c("5"), c("K", "♥"), c("Q", "♦")]);
  assert.equal(hand.name, "顺子");
  assert.deepEqual(hand.score, [4, 5]);
});

test("两名玩家开局后盲注与底池正确", () => {
  const room = createRoom("ABC123", { id: "a", name: "A", socketId: "1" });
  addPlayer(room, { id: "b", name: "B", socketId: "2" });
  startHand(room);
  assert.equal(room.pot, 30);
  assert.equal(room.players.reduce((sum, p) => sum + p.chips, 0) + room.pot, 4000);
  assert.equal(room.players.filter((p) => p.cards.length === 2).length, 2);
});

test("两人过牌到摊牌时筹码总量守恒", () => {
  const room = createRoom("ABC123", { id: "a", name: "A", socketId: "1" });
  addPlayer(room, { id: "b", name: "B", socketId: "2" });
  startHand(room);
  let guard = 20;
  while (room.phase !== "showdown" && guard-- > 0) {
    const player = room.players.find((p) => p.id === room.currentPlayerId);
    const toCall = room.currentBet - player.bet;
    act(room, player.id, toCall > 0 ? "call" : "check");
  }
  assert.equal(room.phase, "showdown");
  assert.equal(room.players.reduce((sum, p) => sum + p.chips, 0), 4000);
});
