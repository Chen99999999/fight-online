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
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const STARTING_CHIPS = 0;
const MAX_PLAYERS = 6;

function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function safeSend(ws, payload) { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); }
function broadcast(room, build) { for (const p of room.players) safeSend(p.ws, build(p.id)); }
function playerRoom(playerId) {
  for (const r of rooms.values()) if (r.players.some(p => p.id === playerId)) return r;
  return null;
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
function rv(r) { return RANKS.indexOf(r) + 2; }
function sortDesc(arr) { return arr.slice().sort((a, b) => b - a); }
function countMap(vals) { const m = new Map(); vals.forEach(v => m.set(v, (m.get(v) || 0) + 1)); return m; }
function findStraight(vals) {
  const uniq = [...new Set(sortDesc(vals))];
  if (uniq[0] === 14) uniq.push(1);
  let run = 1;
  for (let i = 0; i < uniq.length - 1; i++) {
    if (uniq[i] - 1 === uniq[i + 1]) { run++; if (run >= 5) return uniq[i + 1] + 4; }
    else run = 1;
  }
  return null;
}
function eval5(cards) {
  const vals = cards.map(c => rv(c[0]));
  const suits = cards.map(c => c[1]);
  const counts = countMap(vals);
  const byCount = [...counts.entries()].sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const flush = suits.every(s => s === suits[0]);
  const straight = findStraight(vals);
  if (flush && straight) return { cat: 8, t: [straight], name: '同花顺' };
  if (byCount[0][1] === 4) { const four=byCount[0][0]; const k=sortDesc(vals.filter(v=>v!==four))[0]; return { cat: 7, t:[four,k], name:'四条' }; }
  if (byCount[0][1] === 3 && byCount[1] && byCount[1][1] === 2) return { cat: 6, t:[byCount[0][0],byCount[1][0]], name:'葫芦' };
  if (flush) return { cat: 5, t: sortDesc(vals), name:'同花' };
  if (straight) return { cat: 4, t:[straight], name:'顺子' };
  if (byCount[0][1] === 3) { const tr=byCount[0][0]; const ks=sortDesc(vals.filter(v=>v!==tr)).slice(0,2); return { cat: 3, t:[tr,...ks], name:'三条' }; }
  if (byCount[0][1] === 2 && byCount[1] && byCount[1][1] === 2) {
    const hi=Math.max(byCount[0][0],byCount[1][0]), lo=Math.min(byCount[0][0],byCount[1][0]); const k=sortDesc(vals.filter(v=>v!==hi&&v!==lo))[0];
    return { cat: 2, t:[hi,lo,k], name:'两对' };
  }
  if (byCount[0][1] === 2) { const pr=byCount[0][0]; const ks=sortDesc(vals.filter(v=>v!==pr)).slice(0,3); return { cat: 1, t:[pr,...ks], name:'一对' }; }
  return { cat: 0, t: sortDesc(vals), name:'高牌' };
}
function cmpEval(a,b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  for (let i=0;i<Math.max(a.t.length,b.t.length);i++) {
    const av=a.t[i]||0, bv=b.t[i]||0;
    if (av !== bv) return av - bv;
  }
  return 0;
}
function comb5(cards) {
  const out=[]; const n=cards.length;
  for(let a=0;a<n-4;a++) for(let b=a+1;b<n-3;b++) for(let c=b+1;c<n-2;c++) for(let d=c+1;d<n-1;d++) for(let e=d+1;e<n;e++) out.push([cards[a],cards[b],cards[c],cards[d],cards[e]]);
  return out;
}
function bestFive(cards7) {
  let bestEval=null, bestCards=null;
  for (const c of comb5(cards7)) {
    const e=eval5(c);
    if (!bestEval || cmpEval(e,bestEval)>0) { bestEval=e; bestCards=c; }
  }
  return { eval: bestEval, cards: bestCards };
}
function publicPlayer(p, reveal=false) {
  return {
    id:p.id, name:p.name, seat:p.seat, chips:p.chips, ready:p.ready,
    inHand:p.inHand, folded:p.folded, bet:p.bet, acted:p.acted,
    isDealer:p.isDealer, actionText:p.actionText||'', showdownName:p.showdownName||'',
    visibleCards: reveal ? (p.hand||[]) : [], highlightCards: reveal ? (p.highlightCards||[]) : []
  };
}
function roomStateFor(room, viewerId) {
  const reveal = room.phase === 'waiting' && room.community.length > 0;
  const self = room.players.find(p => p.id === viewerId);
  return {
    roomId: room.roomId,
    phase: room.phase,
    street: room.street,
    pot: room.pot,
    currentBet: room.currentBet,
    community: room.community,
    turnPlayerId: room.turnPlayerId,
    message: room.message || '',
    actionFeed: room.actionFeed.slice(-2),
    chats: room.chats.slice(-8),
    players: room.players.map(p => publicPlayer(p, reveal)),
    selfHand: self?.hand || [],
    selfResult: self?.selfResult || '',
    winnerText: room.winnerText || '',
    minRaise: room.minRaise || 1
  };
}
function pushAction(room, txt) {
  room.actionFeed.push(txt);
  if (room.actionFeed.length > 2) room.actionFeed.shift();
  room.message = txt;
}
function pushChat(room, txt) {
  room.chats.push(txt);
  if (room.chats.length > 16) room.chats.shift();
}
function nextOccupied(room, start) {
  const n = room.players.length;
  for (let i=1;i<=n;i++) { const idx=(start+i)%n; if (room.players[idx]) return idx; }
  return 0;
}
function nextActive(room, start) {
  const n = room.players.length;
  for (let i=1;i<=n;i++) { const idx=(start+i)%n; const p=room.players[idx]; if (p.inHand && !p.folded) return idx; }
  return -1;
}
function remaining(room) { return room.players.filter(p => p.inHand && !p.folded); }
function setTurn(room, idx) { room.turnPlayerId = idx >= 0 ? room.players[idx].id : null; }
function resetStreet(room) { room.players.forEach(p => { p.bet = 0; p.acted = false; p.actionText = ''; }); room.currentBet = 0; room.minRaise = 1; }
function collectToPot(room) { room.players.forEach(p => { room.pot += p.bet; p.bet = 0; }); }
function resetShowdown(room) { room.players.forEach(p => { p.showdownName=''; p.highlightCards=[]; p.selfResult=''; }); room.winnerText=''; }
function startHand(room) {
  const ready = room.players.filter(p => p.ready);
  if (ready.length < 2) { room.message='至少 2 人 ready 才能开局'; return false; }
  room.phase='playing'; room.street='preflop'; room.pot=0; room.community=[]; room.deck=makeDeck(); room.currentBet=0; room.turnPlayerId=null; room.actionFeed=[]; room.minRaise=1;
  resetShowdown(room);
  room.dealerIndex = nextOccupied(room, room.dealerIndex);
  room.players.forEach(p => { p.hand=[]; p.folded=false; p.inHand=p.ready; p.bet=0; p.acted=false; p.isDealer=false; p.actionText=''; });
  room.players[room.dealerIndex].isDealer = true;
  room.players.forEach(p => { if (p.inHand) p.hand=[room.deck.pop(), room.deck.pop()]; });
  setTurn(room, nextActive(room, room.dealerIndex));
  room.message='翻前行动';
  return true;
}
function allMatched(room) { return remaining(room).every(p => p.bet === room.currentBet); }
function allActed(room) { return remaining(room).every(p => p.acted); }
function awardSingle(room, winner, msg) {
  collectToPot(room);
  winner.chips += room.pot;
  room.phase='waiting'; room.street='showdown'; room.turnPlayerId=null; room.winnerText=msg; room.message=msg;
  room.players.forEach(p => { p.selfResult = p.id === winner.id ? '对手弃牌，你赢了' : '你输了'; });
}
function showdown(room) {
  collectToPot(room);
  const contenders = remaining(room);
  let best = null, winners = [];
  for (const p of contenders) {
    const out = bestFive([...p.hand, ...room.community]);
    p.showdownName = out.eval.name; p.highlightCards = out.cards;
    if (!best || cmpEval(out.eval, best.eval) > 0) { best = { player:p, eval:out.eval }; winners=[p]; }
    else if (cmpEval(out.eval, best.eval) === 0) winners.push(p);
  }
  const share = winners.length ? Math.floor(room.pot / winners.length) : 0;
  winners.forEach(w => w.chips += share);
  room.phase='waiting'; room.street='showdown'; room.turnPlayerId=null;
  const winName = winners[0]?.showdownName || '高牌';
  room.winnerText = winners.length===1 ? `${winName}，${winners[0].name} 赢了` : `${winName}，平局`;
  room.message = room.winnerText;
  room.players.forEach(p => { p.selfResult = winners.some(w => w.id===p.id) ? `${p.showdownName}，你赢了` : `${p.showdownName||'高牌'}，你输了`; });
}
function advanceStreet(room) {
  collectToPot(room);
  const alive = remaining(room);
  if (alive.length === 1) { awardSingle(room, alive[0], `${alive[0].name} 对手全弃牌，赢了`); return; }
  if (room.street === 'preflop') { room.street='flop'; room.community.push(room.deck.pop(), room.deck.pop(), room.deck.pop()); }
  else if (room.street === 'flop') { room.street='turn'; room.community.push(room.deck.pop()); }
  else if (room.street === 'turn') { room.street='river'; room.community.push(room.deck.pop()); }
  else { showdown(room); return; }
  resetStreet(room); setTurn(room, nextActive(room, room.dealerIndex)); room.message = `${room.street.toUpperCase()} 阶段`;
}
function maybeAdvance(room) {
  const alive=remaining(room);
  if (alive.length===1) { awardSingle(room, alive[0], `${alive[0].name} 对手全弃牌，赢了`); return; }
  if (allActed(room) && allMatched(room)) advanceStreet(room);
  else {
    const curr = room.players.findIndex(p => p.id === room.turnPlayerId);
    setTurn(room, nextActive(room, curr));
  }
}

wss.on('connection', ws => {
  const playerId = 'p_' + Math.random().toString(36).slice(2,10);
  safeSend(ws, { type:'hello', playerId });

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'create_room') {
      if (playerRoom(playerId)) return safeSend(ws, { type:'error_msg', text:'你已经在一个房间里了' });
      let roomId = code(); while (rooms.has(roomId)) roomId = code();
      const room = { roomId, players:[], dealerIndex:0, deck:[], community:[], pot:0, phase:'waiting', street:'preflop', currentBet:0, turnPlayerId:null, message:'房间创建成功', actionFeed:[], winnerText:'', chats:[] };
      room.players.push({ id:playerId, name:msg.name||'玩家1', ws, seat:1, chips:STARTING_CHIPS, ready:false, hand:[], folded:false, inHand:false, bet:0, acted:false, isDealer:false, actionText:'', showdownName:'', highlightCards:[], selfResult:'' });
      rooms.set(roomId, room);
      safeSend(ws, { type:'room_state', ...roomStateFor(room, playerId) });
      return;
    }
    if (msg.type === 'join_room') {
      if (playerRoom(playerId)) return safeSend(ws, { type:'error_msg', text:'你已经加入过房间了' });
      const room = rooms.get((msg.roomId||'').toUpperCase());
      if (!room) return safeSend(ws, { type:'error_msg', text:'房间不存在' });
      if (room.players.length >= MAX_PLAYERS) return safeSend(ws, { type:'error_msg', text:'房间已满（最多6人）' });
      room.players.push({ id:playerId, name:msg.name||('玩家'+(room.players.length+1)), ws, seat:room.players.length+1, chips:STARTING_CHIPS, ready:false, hand:[], folded:false, inHand:false, bet:0, acted:false, isDealer:false, actionText:'', showdownName:'', highlightCards:[], selfResult:'' });
      broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id) }));
      return;
    }

    const room = playerRoom(playerId);
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return;

    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 60);
      if (!text) return;
      pushChat(room, `${player.name}: ${text}`);
      broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id) }));
      return;
    }

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

    if (room.phase !== 'playing' || room.turnPlayerId !== playerId || !player.inHand || player.folded) return;

    if (msg.type === 'fold') {
      player.folded = true; player.acted = true; player.actionText='弃牌'; pushAction(room, `${player.name} 弃牌`); maybeAdvance(room);
      broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id) })); return;
    }
    if (msg.type === 'call') {
      const need = Math.max(0, room.currentBet - player.bet);
      player.chips -= need; player.bet += need; player.acted = true;
      player.actionText = need===0 ? 'Check' : `补到 ${player.bet}`;
      pushAction(room, need===0 ? `${player.name} Check` : `${player.name} 补分到 ${player.bet}`);
      maybeAdvance(room);
      broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id) })); return;
    }
    if (msg.type === 'raise') {
      let amount = Number(msg.amount || 1);
      if (!Number.isFinite(amount)) amount = 1;
      amount = Math.floor(amount);
      if (amount < (room.minRaise || 1)) {
        return safeSend(ws, { type:'error_msg', text:`本轮最小加注是 ${room.minRaise || 1}` });
      }
      const target = room.currentBet + amount;
      const need = target - player.bet;
      player.chips -= need;
      player.bet += need;
      room.currentBet = Math.max(room.currentBet, player.bet);
      room.minRaise = Math.max(room.minRaise || 1, amount);
      room.players.forEach(p => { if (p.inHand && !p.folded && p.id !== player.id) p.acted = false; });
      player.acted = true;
      player.actionText = `加到 ${player.bet}`;
      pushAction(room, `${player.name} 加注到 ${player.bet}`);
      maybeAdvance(room);
      broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id) })); return;
    }
  });

  ws.on('close', () => {
    let dead = null;
    for (const [rid, room] of rooms) {
      const idx = room.players.findIndex(p => p.id === playerId);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        room.players.forEach((p,i) => p.seat = i + 1);
        if (room.players.length === 0) dead = rid;
        else broadcast(room, id => ({ type:'room_state', ...roomStateFor(room, id) }));
        break;
      }
    }
    if (dead) rooms.delete(dead);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on ' + PORT));
