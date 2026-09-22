import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import { Copy, DoorOpen, LogOut, Play, Plus, Spade, Users } from "lucide-react";
import "./styles.css";

const socket = io({ autoConnect: true });

function getIdentity() {
  let id = localStorage.getItem("holdem-player-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("holdem-player-id", id);
  }
  return id;
}

const playerId = getIdentity();

function PlayingCard({ card, hidden = false, small = false }) {
  if (hidden || !card) return <div className={`card playing-card back ${small ? "small" : ""}`} aria-label="暗牌" />;
  const red = card.suit === "♥" || card.suit === "♦";
  return (
    <div className={`card playing-card ${red ? "red" : "black"} ${small ? "small" : ""}`} aria-label={`${card.rank}${card.suit}`}>
      <span className="card-rank">{card.rank}</span>
      <span className="card-suit">{card.suit}</span>
    </div>
  );
}

function Lobby({ onJoined }) {
  const [name, setName] = useState(localStorage.getItem("holdem-name") || "");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = (mode) => {
    const cleanName = name.trim().slice(0, 16);
    if (!cleanName) return setError("先输入一个昵称");
    if (mode === "join" && code.trim().length !== 6) return setError("请输入 6 位房间码");
    setBusy(true);
    setError("");
    socket.emit(mode === "create" ? "room:create" : "room:join", {
      playerId,
      name: cleanName,
      code: code.trim().toUpperCase(),
    }, (reply) => {
      setBusy(false);
      if (!reply?.ok) return setError(reply?.error || "暂时无法进入房间");
      localStorage.setItem("holdem-name", cleanName);
      localStorage.setItem("holdem-room", reply.code);
      onJoined(reply.code);
    });
  };

  return (
    <main className="lobby-shell">
      <section className="lobby-card">
        <div className="brand-lockup">
          <div className="brand-mark"><Spade size={25} fill="currentColor" /></div>
          <div><p className="eyebrow">PRIVATE TABLE</p><h1>九人桌</h1></div>
        </div>
        <p className="lobby-copy">建一个只属于你们的牌桌。没有注册，没有陌生人，房间码发给同学就能入座。</p>
        <label className="field-label" htmlFor="nickname">你的昵称</label>
        <input id="nickname" className="text-input" maxLength={16} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：小王" autoComplete="nickname" />
        <button className="primary-button" disabled={busy} onClick={() => submit("create")}>
          <Plus size={19} /> 创建新牌桌
        </button>
        <div className="divider"><span>或者加入同学的房间</span></div>
        <div className="join-row">
          <input className="text-input code-input" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, ""))} placeholder="6 位房间码" aria-label="房间码" />
          <button className="secondary-button" disabled={busy} onClick={() => submit("join")}><DoorOpen size={18} /> 加入</button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="lobby-meta"><Users size={17} /><span>支持 2–9 人 · 每人 2,000 筹码 · 盲注 10/20</span></div>
      </section>
    </main>
  );
}

function PlayerSeat({ player, isYou, isDealer, isTurn, position, holeCards, phase }) {
  return (
    <div className={`player-seat ${isYou ? "you" : ""} ${isTurn ? "turn" : ""}`} style={position}>
      {player.bet > 0 && <div className="seat-bet"><span className="chip-dot" />{player.bet}</div>}
      <div className="seat-cards">
        {phase !== "waiting" && !player.folded && (
          isYou && holeCards?.length ? holeCards.map((c, i) => <PlayingCard card={c} small key={i} />) : phase === "showdown" && player.revealedCards?.length ? player.revealedCards.map((c, i) => <PlayingCard card={c} small key={i} />) : <><PlayingCard hidden small /><PlayingCard hidden small /></>
        )}
      </div>
      <div className="seat-panel">
        <div className="seat-avatar">{player.name.slice(0, 1).toUpperCase()}</div>
        <div className="seat-info"><strong>{player.name}{isYou ? "（你）" : ""}</strong><span>{player.chips.toLocaleString()} 筹码</span></div>
        {isDealer && <span className="dealer-chip">D</span>}
      </div>
      {player.folded && <span className="seat-status">已弃牌</span>}
      {player.allIn && <span className="seat-status gold">ALL-IN</span>}
      {!player.connected && <span className="seat-status muted">已掉线</span>}
    </div>
  );
}

function GameTable({ state, error, onLeave }) {
  const me = state.players.find((p) => p.id === playerId);
  const isHost = state.hostId === playerId;
  const isMyTurn = state.currentPlayerId === playerId;
  const callAmount = Math.max(0, state.currentBet - (me?.bet || 0));
  const [raiseTo, setRaiseTo] = useState(state.minRaiseTo || state.bigBlind * 2);

  useEffect(() => setRaiseTo(state.minRaiseTo || state.bigBlind * 2), [state.minRaiseTo, state.handNumber]);

  const orderedPlayers = useMemo(() => {
    const mine = state.players.findIndex((p) => p.id === playerId);
    return mine < 0 ? state.players : [...state.players.slice(mine), ...state.players.slice(0, mine)];
  }, [state.players]);

  const action = (type, amount) => socket.emit("game:action", { code: state.code, playerId, type, amount }, () => {});
  const maxRaise = (me?.chips || 0) + (me?.bet || 0);

  return (
    <main className="game-shell">
      <header className="game-header">
        <div className="compact-brand"><Spade size={18} fill="currentColor" /><strong>九人桌</strong></div>
        <button className="room-code" onClick={() => navigator.clipboard?.writeText(state.code)} title="复制房间码"><span>房间码</span><strong>{state.code}</strong><Copy size={15} /></button>
        <button className="icon-button" onClick={onLeave} title="离开牌桌"><LogOut size={18} /></button>
      </header>

      <section className="table-zone">
        <div className="poker-table">
          <div className="table-rail" />
          <div className="table-center">
            <div className="pot-label"><span>底池</span><strong>{state.pot.toLocaleString()}</strong></div>
            <div className="community-cards">
              {[0,1,2,3,4].map((i) => state.communityCards[i] ? <PlayingCard card={state.communityCards[i]} key={i} /> : <div className="card-slot" key={i} />)}
            </div>
            <p className="round-label">{state.phaseLabel}</p>
            {state.message && <p className="table-message">{state.message}</p>}
          </div>
          {orderedPlayers.map((p, index) => {
            const n = Math.max(orderedPlayers.length, 2);
            const angle = 90 + index * (360 / n);
            const left = 50 + 46 * Math.cos(angle * Math.PI / 180);
            const top = 50 + 42 * Math.sin(angle * Math.PI / 180);
            return <PlayerSeat key={p.id} player={p} isYou={p.id === playerId} isDealer={p.seat === state.dealerSeat} isTurn={p.id === state.currentPlayerId} phase={state.phase} holeCards={p.id === playerId ? state.yourCards : null} position={{ left: `${left}%`, top: `${top}%` }} />;
          })}
        </div>
      </section>

      <section className="action-dock">
        {error && <p className="action-error">{error}</p>}
        {state.phase === "waiting" && (
          <div className="waiting-bar">
            <div><strong>{state.players.length}/9 人已入座</strong><span>{isHost ? "至少两人即可开局" : "等待房主开始游戏"}</span></div>
            {isHost && <button className="primary-button compact" disabled={state.players.length < 2} onClick={() => socket.emit("game:start", { code: state.code, playerId })}><Play size={18} fill="currentColor" /> 开始游戏</button>}
          </div>
        )}
        {state.phase === "showdown" && (
          <div className="waiting-bar"><div><strong>{state.message}</strong><span>本手牌已经结算</span></div>{isHost && <button className="primary-button compact" onClick={() => socket.emit("game:next", { code: state.code, playerId })}><Play size={18} fill="currentColor" /> 下一局</button>}</div>
        )}
        {!['waiting','showdown'].includes(state.phase) && (
          <div className="controls">
            <div className="turn-note"><span className={isMyTurn ? "live-dot" : ""} />{isMyTurn ? "轮到你了" : `等待 ${state.currentPlayerName || "其他玩家"}`}</div>
            <div className="action-buttons">
              <button className="danger-button" disabled={!isMyTurn} onClick={() => action("fold")}>弃牌</button>
              <button className="secondary-button" disabled={!isMyTurn} onClick={() => action(callAmount ? "call" : "check")}>{callAmount ? `跟注 ${Math.min(callAmount, me?.chips || 0)}` : "过牌"}</button>
              <div className="raise-control">
                <input type="range" min={Math.min(state.minRaiseTo, maxRaise)} max={Math.max(state.minRaiseTo, maxRaise)} value={Math.min(raiseTo, maxRaise)} disabled={!isMyTurn || maxRaise <= state.currentBet} onChange={(e) => setRaiseTo(Number(e.target.value))} />
                <button className="gold-button" disabled={!isMyTurn || maxRaise <= state.currentBet} onClick={() => action("raise", Math.min(raiseTo, maxRaise))}>加注到 {Math.min(raiseTo, maxRaise)}</button>
              </div>
              <button className="allin-button" disabled={!isMyTurn} onClick={() => action("allin")}>ALL-IN</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function App() {
  const [roomCode, setRoomCode] = useState(localStorage.getItem("holdem-room") || "");
  const [state, setState] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const onState = (next) => { setState(next); setRoomCode(next.code); setError(""); };
    const onError = (message) => setError(message);
    socket.on("room:state", onState);
    socket.on("game:error", onError);
    if (roomCode) socket.emit("room:join", { code: roomCode, playerId, name: localStorage.getItem("holdem-name") || "玩家" }, (reply) => {
      if (!reply?.ok) { localStorage.removeItem("holdem-room"); setRoomCode(""); setState(null); }
    });
    return () => { socket.off("room:state", onState); socket.off("game:error", onError); };
  }, []);

  const leave = () => {
    if (state) socket.emit("room:leave", { code: state.code, playerId });
    localStorage.removeItem("holdem-room");
    setRoomCode("");
    setState(null);
  };

  if (!roomCode || !state) return <Lobby onJoined={setRoomCode} />;
  return <GameTable state={state} error={error} onLeave={leave} />;
}

createRoot(document.getElementById("root")).render(<App />);
