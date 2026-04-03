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

function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function safeSend(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}
function broadcast(room, payload) {
  for (const p of room.players.values()) safeSend(p.ws, payload);
}
function snapshot(room) {
  return {
    roomId: room.roomId,
    hostId: room.hostId,
    players: [...room.players.values()].map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      x: p.state.x,
      y: p.state.y,
      hp: p.state.hp,
      facing: p.state.facing,
      action: p.state.action,
      color: p.state.color,
      character: p.state.character || 'fighter'
    }))
  };
}
function createPlayer(id, name, ws, role) {
  return {
    id,
    name,
    ws,
    role,
    state: {
      x: role === 'p1' ? 180 : 620,
      y: 308,
      hp: 100,
      facing: role === 'p1' ? 1 : -1,
      action: 'idle',
      color: role === 'p1' ? '#f97316' : '#60a5fa',
      character: role === 'p1' ? 'blaze' : 'frost'
    }
  };
}
function cleanupPlayer(ws) {
  for (const [roomId, room] of rooms) {
    let found = null;
    for (const [id, player] of room.players) {
      if (player.ws === ws) { found = id; break; }
    }
    if (!found) continue;
    room.players.delete(found);
    if (room.players.size === 0) rooms.delete(roomId);
    else {
      if (room.hostId === found) room.hostId = [...room.players.keys()][0];
      broadcast(room, { type:'room_state', ...snapshot(room), msg:'有玩家离开了房间' });
    }
    break;
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
      const room = { roomId, hostId: playerId, players: new Map() };
      room.players.set(playerId, createPlayer(playerId, msg.name || '玩家1', ws, 'p1'));
      rooms.set(roomId, room);
      safeSend(ws, { type:'room_state', ...snapshot(room), msg:'房间创建成功' });
      return;
    }

    if (msg.type === 'join_room') {
      const room = rooms.get((msg.roomId || '').toUpperCase());
      if (!room) return safeSend(ws, { type:'error_msg', text:'房间不存在' });
      if (room.players.size >= 2) return safeSend(ws, { type:'error_msg', text:'房间已满' });
      room.players.set(playerId, createPlayer(playerId, msg.name || '玩家2', ws, 'p2'));
      broadcast(room, { type:'room_state', ...snapshot(room), msg:'第二位玩家已加入' });
      return;
    }

    let room = null, player = null;
    for (const r of rooms.values()) {
      if (r.players.has(playerId)) { room = r; player = r.players.get(playerId); break; }
    }
    if (!room || !player) return;

    if (msg.type === 'input') {
      player.state = {
        ...player.state,
        x: Math.max(40, Math.min(760, Number(msg.x ?? player.state.x))),
        y: Math.max(120, Math.min(330, Number(msg.y ?? player.state.y))),
        facing: Number(msg.facing ?? player.state.facing),
        action: msg.action || player.state.action,
        hp: Math.max(0, Math.min(100, Number(msg.hp ?? player.state.hp))),
        character: msg.character || player.state.character
      };
      broadcast(room, { type:'state_update', players: snapshot(room).players });
      return;
    }

    if (msg.type === 'hit') {
      const target = room.players.get(msg.targetId);
      if (!target) return;
      target.state.hp = Math.max(0, target.state.hp - Number(msg.damage || 0));
      broadcast(room, {
        type:'hit_effect',
        attackerId: playerId,
        targetId: msg.targetId,
        damage: Number(msg.damage || 0),
        attackType: msg.attackType || 'light',
        players: snapshot(room).players
      });
      if (target.state.hp <= 0) {
        broadcast(room, { type:'match_over', winnerId: playerId, winnerName: player.name });
      }
      return;
    }

    if (msg.type === 'reset_match') {
      let first = true;
      for (const p of room.players.values()) {
        p.state.hp = 100;
        p.state.x = first ? 180 : 620;
        p.state.y = 308;
        p.state.facing = first ? 1 : -1;
        p.state.action = 'idle';
        first = false;
      }
      broadcast(room, { type:'room_state', ...snapshot(room), msg:'重新开打' });
    }
  });

  ws.on('close', () => cleanupPlayer(ws));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
