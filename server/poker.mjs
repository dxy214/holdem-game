import { randomInt } from "node:crypto";

export const SUITS = ["♠", "♥", "♦", "♣"];
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

export function freshDeck() {
  const deck = SUITS.flatMap((suit) => RANKS.map((rank) => ({ suit, rank })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const rankValue = (rank) => RANKS.indexOf(rank) + 2;

function combinations(items, choose) {
  const result = [];
  const walk = (start, picked) => {
    if (picked.length === choose) return result.push(picked);
    for (let i = start; i <= items.length - (choose - picked.length); i++) walk(i + 1, [...picked, items[i]]);
  };
  walk(0, []);
  return result;
}

function evaluateFive(cards) {
  const values = cards.map((c) => rankValue(c.rank)).sort((a, b) => b - a);
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const unique = [...new Set(values)];
  if (unique[0] === 14) unique.push(1);
  let straightHigh = 0;
  for (let i = 0; i <= unique.length - 5; i++) {
    if (unique[i] - unique[i + 4] === 4) { straightHigh = unique[i]; break; }
  }
  if (flush && straightHigh) return { score: [8, straightHigh], name: straightHigh === 14 ? "皇家同花顺" : "同花顺" };
  if (groups[0][1] === 4) return { score: [7, groups[0][0], groups[1][0]], name: "四条" };
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) return { score: [6, groups[0][0], groups[1][0]], name: "葫芦" };
  if (flush) return { score: [5, ...values], name: "同花" };
  if (straightHigh) return { score: [4, straightHigh], name: "顺子" };
  if (groups[0][1] === 3) return { score: [3, groups[0][0], ...groups.filter((g) => g[1] === 1).map((g) => g[0])], name: "三条" };
  const pairs = groups.filter((g) => g[1] === 2).map((g) => g[0]).sort((a, b) => b - a);
  if (pairs.length >= 2) {
    const kicker = groups.find((g) => g[1] === 1)?.[0] || 0;
    return { score: [2, pairs[0], pairs[1], kicker], name: "两对" };
  }
  if (pairs.length === 1) return { score: [1, pairs[0], ...groups.filter((g) => g[1] === 1).map((g) => g[0])], name: "一对" };
  return { score: [0, ...values], name: "高牌" };
}

export function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  }
  return 0;
}

export function evaluate(cards) {
  if (cards.length < 5) throw new Error("至少需要五张牌");
  return combinations(cards, 5).map(evaluateFive).reduce((best, hand) => compareScores(hand.score, best.score) > 0 ? hand : best);
}

function nextEligible(room, fromSeat, predicate = () => true) {
  const sorted = room.players.slice().sort((a, b) => a.seat - b.seat);
  for (let step = 1; step <= 9; step++) {
    const seat = (fromSeat + step) % 9;
    const player = sorted.find((p) => p.seat === seat && predicate(p));
    if (player) return player;
  }
  return null;
}

const activeInHand = (p) => p.inHand && !p.folded;
const canAct = (p) => activeInHand(p) && !p.allIn;

function takeChips(player, amount, room) {
  const paid = Math.max(0, Math.min(player.chips, amount));
  player.chips -= paid;
  player.bet += paid;
  player.contribution += paid;
  room.pot += paid;
  if (player.chips === 0) player.allIn = true;
  return paid;
}

function phaseLabel(phase) {
  return ({ waiting: "等待开局", preflop: "翻牌前", flop: "翻牌", turn: "转牌", river: "河牌", showdown: "本局结束" })[phase] || phase;
}

export function createRoom(code, host) {
  return {
    code,
    hostId: host.id,
    players: [{ ...host, seat: 0, chips: 2000, connected: true, inHand: false, folded: false, allIn: false, bet: 0, contribution: 0, cards: [] }],
    phase: "waiting",
    phaseLabel: phaseLabel("waiting"),
    smallBlind: 10,
    bigBlind: 20,
    currentBet: 0,
    minRaise: 20,
    minRaiseTo: 40,
    pot: 0,
    communityCards: [],
    deck: [],
    dealerSeat: 0,
    currentPlayerId: null,
    pending: new Set(),
    handNumber: 0,
    message: "等待同学入座",
  };
}

export function addPlayer(room, player) {
  const existing = room.players.find((p) => p.id === player.id);
  if (existing) {
    existing.connected = true;
    existing.socketId = player.socketId;
    existing.name = player.name;
    return existing;
  }
  if (room.players.length >= 9) throw new Error("房间已经坐满了");
  if (room.phase !== "waiting") throw new Error("牌局已经开始，请等待下一局");
  const used = new Set(room.players.map((p) => p.seat));
  const seat = [...Array(9).keys()].find((i) => !used.has(i));
  const added = { ...player, seat, chips: 2000, connected: true, inHand: false, folded: false, allIn: false, bet: 0, contribution: 0, cards: [] };
  room.players.push(added);
  return added;
}

export function startHand(room) {
  const eligible = room.players.filter((p) => p.chips > 0);
  if (eligible.length < 2) throw new Error("至少需要两名有筹码的玩家");
  room.handNumber += 1;
  room.deck = freshDeck();
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = 0;
  room.minRaise = room.bigBlind;
  room.phase = "preflop";
  room.phaseLabel = phaseLabel(room.phase);
  room.message = "";
  for (const p of room.players) {
    p.inHand = p.chips > 0;
    p.folded = !p.inHand;
    p.allIn = false;
    p.bet = 0;
    p.contribution = 0;
    p.cards = p.inHand ? [room.deck.pop(), room.deck.pop()] : [];
  }
  if (room.handNumber > 1 || !eligible.some((p) => p.seat === room.dealerSeat)) {
    room.dealerSeat = nextEligible(room, room.dealerSeat, (p) => p.inHand).seat;
  }
  const dealer = room.players.find((p) => p.seat === room.dealerSeat);
  const headsUp = eligible.length === 2;
  const small = headsUp ? dealer : nextEligible(room, dealer.seat, (p) => p.inHand);
  const big = nextEligible(room, small.seat, (p) => p.inHand);
  takeChips(small, room.smallBlind, room);
  takeChips(big, room.bigBlind, room);
  room.currentBet = Math.max(small.bet, big.bet);
  room.minRaiseTo = room.currentBet + room.bigBlind;
  room.pending = new Set(room.players.filter(canAct).map((p) => p.id));
  const first = nextEligible(room, big.seat, canAct);
  room.currentPlayerId = first?.id || null;
  if (first) room.pending.delete(big.allIn ? big.id : "");
  return room;
}

function advanceStreet(room) {
  for (const p of room.players) p.bet = 0;
  room.currentBet = 0;
  room.minRaise = room.bigBlind;
  room.minRaiseTo = room.bigBlind;
  if (room.phase === "preflop") {
    room.phase = "flop";
    room.deck.pop();
    room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
  } else if (room.phase === "flop") {
    room.phase = "turn";
    room.deck.pop();
    room.communityCards.push(room.deck.pop());
  } else if (room.phase === "turn") {
    room.phase = "river";
    room.deck.pop();
    room.communityCards.push(room.deck.pop());
  } else {
    return settle(room);
  }
  room.phaseLabel = phaseLabel(room.phase);
  room.pending = new Set(room.players.filter(canAct).map((p) => p.id));
  const first = nextEligible(room, room.dealerSeat, canAct);
  room.currentPlayerId = first?.id || null;
  if (room.pending.size <= 1 && room.players.filter(canAct).length <= 1) runOutBoard(room);
}

function runOutBoard(room) {
  while (room.phase !== "river") {
    if (room.phase === "preflop") {
      room.phase = "flop"; room.deck.pop(); room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
    } else if (room.phase === "flop") {
      room.phase = "turn"; room.deck.pop(); room.communityCards.push(room.deck.pop());
    } else if (room.phase === "turn") {
      room.phase = "river"; room.deck.pop(); room.communityCards.push(room.deck.pop());
    }
  }
  settle(room);
}

function distribute(room, amount, winners) {
  if (!winners.length || amount <= 0) return;
  const ordered = winners.slice().sort((a, b) => ((a.seat - room.dealerSeat + 9) % 9) - ((b.seat - room.dealerSeat + 9) % 9));
  const share = Math.floor(amount / ordered.length);
  let remainder = amount % ordered.length;
  for (const winner of ordered) winner.chips += share + (remainder-- > 0 ? 1 : 0);
}

export function settle(room) {
  const contenders = room.players.filter(activeInHand);
  const names = new Set();
  if (contenders.length === 1) {
    distribute(room, room.pot, contenders);
    room.message = `${contenders[0].name} 赢得 ${room.pot} 筹码`;
    names.add(contenders[0].name);
  } else {
    const levels = [...new Set(room.players.map((p) => p.contribution).filter(Boolean))].sort((a, b) => a - b);
    let previous = 0;
    for (const level of levels) {
      const contributors = room.players.filter((p) => p.contribution >= level);
      const amount = (level - previous) * contributors.length;
      const eligible = contributors.filter(activeInHand);
      if (eligible.length) {
        const ranked = eligible.map((p) => ({ p, hand: evaluate([...p.cards, ...room.communityCards]) }));
        const best = ranked.reduce((a, b) => compareScores(b.hand.score, a.hand.score) > 0 ? b : a);
        const winners = ranked.filter((r) => compareScores(r.hand.score, best.hand.score) === 0).map((r) => r.p);
        winners.forEach((p) => names.add(`${p.name}（${best.hand.name}）`));
        distribute(room, amount, winners);
      }
      previous = level;
    }
    room.message = `${[...names].join("、")} 赢得本局`;
  }
  room.pot = 0;
  room.phase = "showdown";
  room.phaseLabel = phaseLabel(room.phase);
  room.currentPlayerId = null;
  room.pending = new Set();
  return room;
}

function progress(room, actingSeat) {
  const live = room.players.filter(activeInHand);
  if (live.length === 1) return settle(room);
  const actors = room.players.filter(canAct);
  if (actors.length === 0) return runOutBoard(room);
  if (room.pending.size === 0) return advanceStreet(room);
  const next = nextEligible(room, actingSeat, (p) => canAct(p) && room.pending.has(p.id));
  if (!next) return advanceStreet(room);
  room.currentPlayerId = next.id;
}

export function act(room, playerId, type, amount) {
  const player = room.players.find((p) => p.id === playerId);
  if (!player || room.currentPlayerId !== playerId || !canAct(player)) throw new Error("现在还不能这样操作");
  const toCall = Math.max(0, room.currentBet - player.bet);
  if (type === "fold") player.folded = true;
  else if (type === "check") {
    if (toCall > 0) throw new Error("当前不能过牌");
  } else if (type === "call") {
    if (toCall <= 0) throw new Error("当前无需跟注");
    takeChips(player, toCall, room);
  } else if (type === "allin") {
    const previousBet = room.currentBet;
    const target = player.bet + player.chips;
    takeChips(player, player.chips, room);
    if (target > previousBet) {
      const raiseSize = target - previousBet;
      room.currentBet = target;
      if (raiseSize >= room.minRaise) {
        room.minRaise = raiseSize;
      }
      room.pending = new Set(room.players.filter((p) => canAct(p) && p.id !== player.id).map((p) => p.id));
    }
  } else if (type === "raise") {
    const target = Number(amount);
    const max = player.bet + player.chips;
    if (!Number.isFinite(target) || target <= room.currentBet) throw new Error("加注金额无效");
    if (target < room.minRaiseTo && target < max) throw new Error(`最少加注到 ${room.minRaiseTo}`);
    const previousBet = room.currentBet;
    takeChips(player, target - player.bet, room);
    room.currentBet = player.bet;
    const raiseSize = room.currentBet - previousBet;
    if (raiseSize >= room.minRaise) room.minRaise = raiseSize;
    room.pending = new Set(room.players.filter((p) => canAct(p) && p.id !== player.id).map((p) => p.id));
  } else throw new Error("未知操作");
  room.pending.delete(player.id);
  room.minRaiseTo = room.currentBet + room.minRaise;
  progress(room, player.seat);
  return room;
}

export function publicState(room, viewerId) {
  const viewer = room.players.find((p) => p.id === viewerId);
  const current = room.players.find((p) => p.id === room.currentPlayerId);
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    phaseLabel: room.phaseLabel,
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    currentBet: room.currentBet,
    minRaiseTo: room.minRaiseTo,
    pot: room.pot,
    communityCards: room.communityCards,
    dealerSeat: room.dealerSeat,
    currentPlayerId: room.currentPlayerId,
    currentPlayerName: current?.name,
    handNumber: room.handNumber,
    message: room.message,
    yourCards: viewer?.cards || [],
    players: room.players.map(({ cards, socketId, contribution, ...p }) => ({
      ...p,
      revealedCards: room.phase === "showdown" && !p.folded ? cards : [],
    })),
  };
}
