const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const rooms = new Map();
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const STARTING_CHIPS = 500;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;

function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function safeSend(ws, payload) { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); }
function broadcast(room, payloadBuilder) {
  for (const p of room.players) safeSend(p.ws, payloadBuilder(p.id));
}
function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
function rankValue(r) { return RANKS.indexOf(r) + 2; }
function sortDesc(vals) { return vals.slice().sort((a,b)=>b-a); }
function countMap(vals) {
  const m = new Map();
  vals.forEach(v => m.set(v, (m.get(v)||0)+1));
  return m;
}
function findStraight(vals) {
  const uniq = [...new Set(sortDesc(vals))];
  if (uniq[0] === 14) uniq.push(1);
  let run = 1;
  for (let i = 0; i < uniq.length - 1; i++) {
    if (uniq[i] - 1 === uniq[i+1]) {
      run++;
      if (run >= 5) return uniq[i+1] + 4;
    } else run = 1;
  }
  return null;
}
function evaluate7(cards) {
  const vals = cards.map(c => rankValue(c[0]));
  const suits = cards.map(c => c[1]);
  const counts = countMap(vals);
  const byCount = [...counts.entries()].sort((a,b)=> b[1]-a[1] || b[0]-a[0]);
  const flushSuit = SUITS.find(s => suits.filter(x => x === s).length >= 5);
  let flushCards = [];
  if (flushSuit) flushCards = cards.filter(c => c[1] === flushSuit).map(c => rankValue(c[0]));
  const straight = findStraight(vals);
  const straightFlush = flushSuit ? findStraight(flushCards) : null;

  if (straightFlush) return {cat:8, tiebreak:[straightFlush], name:'同花顺'};
  if (byCount[0][1] === 4) {
    const four = byCount[0][0];
    const kicker = sortDesc(vals.filter(v => v !== four))[0];
    return {cat:7, tiebreak:[four, kicker], name:'四条'};
  }
  if (byCount[0][1] === 3 && byCount[1] && byCount[1][1] >= 2) return {cat:6, tiebreak:[byCount[0][0], byCount[1][0]], name:'葫芦'};
  if (flushSuit) return {cat:5, tiebreak:sortDesc(flushCards).slice(0,5), name:'同花'};
  if (straight) return {cat:4, tiebreak:[straight], name:'顺子'};
  if (byCount[0][1] === 3) {
    const trips = byCount[0][0];
    const kickers = sortDesc(vals.filter(v => v !== trips)).slice(0,2);
    return {cat:3, tiebreak:[trips, ...kickers], name:'三条'};
  }
  if (byCount[0][1] === 2 && byCount[1] && byCount[1][1] === 2) {
    const highPair = Math.max(byCount[0][0], byCount[1][0]);
    const lowPair = Math.min(byCount[0][0], byCount[1][0]);
    const kicker = sortDesc(vals.filter(v => v !== highPair && v !== lowPair))[0];
    return {cat:2, tiebreak:[highPair, lowPair, kicker], name:'两对'};
  }
  if (byCount[0][1] === 2) {
    const pair = byCount[0][0];
    const kickers = sortDesc(vals.filter(v => v !== pair)).slice(0,3);
    return {cat:1, tiebreak:[pair, ...kickers], name:'一对'};
  }
  return {cat:0, tiebreak:sortDesc(vals).slice(0,5), name:'高牌'};
}
function cmpEval(a,b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  for (let i=0;i<Math.max(a.tiebreak.length,b.tiebreak.length);i++) {
    const av = a.tiebreak[i] || 0, bv = b.tiebreak[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}
function publicPlayer(p) {
  return {
    id:p.id, name:p.name, chips:p.chips, seat:p.seat, ready:p.ready,
    inHand:p.inHand, folded:p.folded, bet:p.bet, totalBet:p.totalBet, acted:p.acted,
    isDealer:p.isDealer, isSB:p.isSB, isBB:p.isBB
  };
}
function roomStateFor(room, viewerId, extra={}) {
  return {
    roomId: room.roomId,
    phase: room.phase,
    street: room.street,
    pot: room.pot,
    currentBet: room.currentBet,
    dealerIndex: room.dealerIndex,
    community: room.community,
    turnPlayerId: room.turnPlayerId,
    minRaise: room.minRaise,
    message: room.message || '',
    players: room.players.map(publicPlayer),
    selfHand: (room.players.find(p => p.id === viewerId)?.hand) || [],
    ...extra
  };
}
function nextOccupied(room, startIdx) {
  const n = room.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (startIdx + i) % n;
    const p = room.players[idx];
    if (p && p.chips > 0) return idx;
  }
  return 0;
}
function nextActive(room, startIdx) {
  const n = room.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (startIdx + i) % n;
    const p = room.players[idx];
    if (p && p.inHand && !p.folded) return idx;
  }
  return -1;
}
function resetBetsForStreet(room) {
  room.players.forEach(p => { p.bet = 0; p.acted = false; });
  room.currentBet = 0;
  room.minRaise = BIG_BLIND;
}
function collectBetsToPot(room) {
  room.players.forEach(p => { room.pot += p.bet; p.totalBet += p.bet; p.bet = 0; });
}
function setBlinds(room) {
  room.players.forEach(p => { p.isDealer = p.isSB = p.isBB = false; });
  const dealer = room.dealerIndex;
  const sb = nextOccupied(room, dealer);
  const bb = nextOccupied(room, sb);
  room.players[dealer].isDealer = true;
  room.players[sb].isSB = true;
  room.players[bb].isBB = true;
  const sbPlayer = room.players[sb];
  const bbPlayer = room.players[bb];
  const sbAmt = Math.min(SMALL_BLIND, sbPlayer.chips);
  const bbAmt = Math.min(BIG_BLIND, bbPlayer.chips);
  sbPlayer.chips -= sbAmt; sbPlayer.bet = sbAmt;
  bbPlayer.chips -= bbAmt; bbPlayer.bet = bbAmt;
  room.currentBet = bbAmt;
  room.minRaise = BIG_BLIND;
  return {bb};
}
function startHand(room) {
  const seated = room.players.filter(p => p.ready && p.chips > 0);
  if (seated.length < 2) {
    room.message = '至少 2 人 ready 才能开局';
    return false;
  }
  room.phase = 'playing';
  room.street = 'preflop';
  room.deck = makeDeck();
  room.community = [];
  room.pot = 0;
  room.message = '发牌中';
  room.dealerIndex = nextOccupied(room, room.dealerIndex);
  room.players.forEach(p => {
    p.hand = [];
    p.folded = false;
    p.inHand = p.ready && p.chips > 0;
    p.bet = 0;
    p.totalBet = 0;
    p.acted = false;
  });
  room.players.forEach(p => { if (p.inHand) p.hand = [room.deck.pop(), room.deck.pop()]; });
  const {bb} = setBlinds(room);
  const turnIdx = nextActive(room, bb);
  room.turnPlayerId = turnIdx >= 0 ? room.players[turnIdx].id : null;
  room.message = '翻前行动';
  return true;
}
function allMatched(room) {
  return room.players.filter(p => p.inHand && !p.folded)
    .every(p => p.bet === room.currentBet || p.chips === 0);
}
function allActed(room) {
  return room.players.filter(p => p.inHand && !p.folded)
    .every(p => p.acted || p.chips === 0);
}
function remaining(room) { return room.players.filter(p => p.inHand && !p.folded); }
function awardSingleWinner(room, winner, msg) {
  room.pot += room.players.reduce((s,p)=>s+p.bet,0);
  room.players.forEach(p => { p.bet = 0; });
  winner.chips += room.pot;
  room.message = msg;
  room.phase = 'waiting';
  room.street = 'showdown';
  room.turnPlayerId = null;
}
function showdown(room) {
  collectBetsToPot(room);
  const contenders = remaining(room);
  let best = null;
  let winners = [];
  for (const p of contenders) {
    p.eval = evaluate7([...p.hand, ...room.community]);
    if (!best || cmpEval(p.eval, best.eval) > 0) {
      best = p; winners = [p];
    } else if (cmpEval(p.eval, best.eval) === 0) winners.push(p);
  }
  const share = Math.floor(room.pot / winners.length);
  winners.forEach(w => w.chips += share);
  room.message = winners.length === 1
    ? `${winners[0].name} 获胜：${winners[0].eval.name}`
    : `平分底池：${winners.map(w=>w.name).join(' / ')}`;
  room.phase = 'waiting';
  room.street = 'showdown';
  room.turnPlayerId = null;
}
function advanceStreet(room) {
  collectBetsToPot(room);
  const alive = remaining(room);
  if (alive.length === 1) {
    awardSingleWinner(room, alive[0], `${alive[0].name} 直接收池`);
    return;
  }
  if (room.street === 'preflop') {
    room.street = 'flop';
    room.community.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
  } else if (room.street === 'flop') {
    room.street = 'turn';
    room.community.push(room.deck.pop());
  } else if (room.street === 'turn') {
    room.street = 'river';
    room.community.push(room.deck.pop());
  } else {
    showdown(room);
    return;
  }
  resetBetsForStreet(room);
  const first = nextActive(room, room.dealerIndex);
  room.turnPlayerId = first >= 0 ? room.players[first].id : null;
  room.message = `${room.street.toUpperCase()} 阶段`;
}
function maybeAdvance(room) {
  const alive = remaining(room);
  if (alive.length === 1) {
    awardSingleWinner(room, alive[0], `${alive[0].name} 对手全弃牌`);
    return;
  }
  if (allActed(room) && allMatched(room)) advanceStreet(room);
  else {
    const currIdx = room.players.findIndex(p => p.id === room.turnPlayerId);
    const nextIdx = nextActive(room, currIdx);
    room.turnPlayerId = nextIdx >= 0 ? room.players[nextIdx].id : null;
  }
}

wss.on('connection', (ws) => {
  const playerId = 'p_' + Math.random().toString(36).slice(2, 10);
  safeSend(ws, { type:'hello', playerId });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'create_room') {
      let roomId = code();
      while (rooms.has(roomId)) roomId = code();
      const room = {
        roomId, players: [], dealerIndex: 0, deck: [], community: [],
        pot:0, phase:'waiting', street:'preflop', currentBet:0, minRaise:BIG_BLIND,
        turnPlayerId:null, message:'房间创建成功'
      };
      room.players.push({
        id:playerId, name:msg.name||'玩家1', ws, seat:1, chips:STARTING_CHIPS,
        ready:false, hand:[], folded:false, inHand:false, bet:0, totalBet:0, acted:false,
        isDealer:false, isSB:false, isBB:false
      });
      rooms.set(roomId, room);
      safeSend(ws, { type:'room_state', ...roomStateFor(room, playerId) });
      return;
    }

    if (msg.type === 'join_room') {
      const room = rooms.get((msg.roomId||'').toUpperCase());
      if (!room) return safeSend(ws, { type:'error_msg', text:'房间不存在' });
      if (room.players.length >= 6) return safeSend(ws, { type:'error_msg', text:'房间已满（最多6人）' });
      room.players.push({
        id:playerId, name:msg.name||('玩家'+(room.players.length+1)), ws, seat:room.players.length+1, chips:STARTING_CHIPS,
        ready:false, hand:[], folded:false, inHand:false, bet:0, totalBet:0, acted:false,
        isDealer:false, isSB:false, isBB:false
      });
      broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id, {message:'新玩家加入'}) }));
      return;
    }

    let room = null;
    for (const r of rooms.values()) if (r.players.some(p => p.id === playerId)) { room = r; break; }
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    if (msg.type === 'toggle_ready') {
      if (room.phase !== 'waiting') return;
      player.ready = !player.ready;
      broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id) }));
      return;
    }
    if (msg.type === 'start_hand') {
      if (room.phase !== 'waiting') return;
      startHand(room);
      broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id) }));
      return;
    }

    if (room.phase !== 'playing') return;
    if (room.turnPlayerId !== playerId) return;
    if (!player.inHand || player.folded) return;

    if (msg.type === 'fold') {
      player.folded = true;
      player.acted = true;
      maybeAdvance(room);
      broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id) }));
      return;
    }
    if (msg.type === 'check_call') {
      const need = Math.max(0, room.currentBet - player.bet);
      const pay = Math.min(need, player.chips);
      player.chips -= pay;
      player.bet += pay;
      player.acted = true;
      maybeAdvance(room);
      broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id) }));
      return;
    }
    if (msg.type === 'bet_raise') {
      let amount = Number(msg.amount || 0);
      if (!Number.isFinite(amount)) amount = room.currentBet + room.minRaise;
      amount = Math.max(room.currentBet + room.minRaise, amount);
      const need = amount - player.bet;
      const pay = Math.min(need, player.chips);
      if (pay <= 0) return;
      player.chips -= pay;
      player.bet += pay;
      const raiseSize = player.bet - room.currentBet;
      if (player.bet > room.currentBet) {
        room.minRaise = Math.max(room.minRaise, raiseSize);
        room.currentBet = player.bet;
        room.players.forEach(p => { if (p.inHand && !p.folded && p.id !== player.id) p.acted = false; });
      }
      player.acted = true;
      maybeAdvance(room);
      broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id) }));
      return;
    }
  });

  ws.on('close', () => {
    let deadRoom = null;
    for (const [rid, room] of rooms) {
      const idx = room.players.findIndex(p => p.id === playerId);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        room.players.forEach((p,i) => p.seat = i + 1);
        if (room.players.length === 0) deadRoom = rid;
        else broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id, {message:'有人离开房间'}) }));
        break;
      }
    }
    if (deadRoom) rooms.delete(deadRoom);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on ' + PORT));
