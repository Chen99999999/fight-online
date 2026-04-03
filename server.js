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
const W = 800, H = 560;
const CELL = 40;

function makeMap() {
  const walls = [];
  const iron = [];
  // outer blocks / center cover
  for (let x = 120; x <= 640; x += 80) walls.push({x, y: 200}, {x, y: 320});
  walls.push({x: 360, y: 240}, {x: 400, y: 240}, {x: 360, y: 280}, {x: 400, y: 280});
  iron.push({x: 200, y: 120}, {x: 560, y: 120}, {x: 200, y: 400}, {x: 560, y: 400});
  return {walls, iron};
}
function code() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function safeSend(ws, payload) { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); }
function broadcast(room, payload) { for (const p of room.players.values()) safeSend(p.ws, payload); }
function findRoomByPlayer(playerId) { for (const r of rooms.values()) if (r.players.has(playerId)) return r; return null; }

function createPlayer(id, name, ws, role) {
  return {
    id, name, ws, role,
    state: {
      x: role === 'p1' ? 120 : 680,
      y: role === 'p1' ? 480 : 80,
      dir: role === 'p1' ? 'up' : 'down',
      hp: 3,
      alive: true,
      respawn: 0,
      color: role === 'p1' ? '#f59e0b' : '#60a5fa'
    }
  };
}
function snapshot(room) {
  return {
    roomId: room.roomId,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, role: p.role,
      x: p.state.x, y: p.state.y, dir: p.state.dir,
      hp: p.state.hp, alive: p.state.alive, respawn: p.state.respawn,
      color: p.state.color
    })),
    bullets: room.bullets,
    map: room.map
  };
}
function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function collideMap(x, y, room) {
  for (const b of room.map.walls) if (aabb(x-16, y-16, 32, 32, b.x, b.y, CELL, CELL)) return true;
  for (const b of room.map.iron) if (aabb(x-16, y-16, 32, 32, b.x, b.y, CELL, CELL)) return true;
  return x < 20 || x > W-20 || y < 20 || y > H-20;
}
function resetRoom(room) {
  room.map = makeMap();
  room.bullets = [];
  for (const p of room.players.values()) {
    p.state.x = p.role === 'p1' ? 120 : 680;
    p.state.y = p.role === 'p1' ? 480 : 80;
    p.state.dir = p.role === 'p1' ? 'up' : 'down';
    p.state.hp = 3;
    p.state.alive = true;
    p.state.respawn = 0;
  }
}
function cleanupPlayer(ws) {
  for (const [roomId, room] of rooms) {
    let found = null;
    for (const [id, p] of room.players) if (p.ws === ws) { found = id; break; }
    if (!found) continue;
    room.players.delete(found);
    if (room.players.size === 0) rooms.delete(roomId);
    else broadcast(room, { type:'room_state', ...snapshot(room), msg:'有玩家离开了房间' });
    break;
  }
}

wss.on('connection', (ws) => {
  const playerId = 'p_' + Math.random().toString(36).slice(2, 10);
  safeSend(ws, { type:'hello', playerId });

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'create_room') {
      let roomId = code();
      while (rooms.has(roomId)) roomId = code();
      const room = { roomId, players:new Map(), bullets:[], map:makeMap() };
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

    const room = findRoomByPlayer(playerId);
    if (!room) return;
    const player = room.players.get(playerId);
    if (!player) return;

    if (msg.type === 'input') {
      player.state.x = Math.max(20, Math.min(W-20, Number(msg.x ?? player.state.x)));
      player.state.y = Math.max(20, Math.min(H-20, Number(msg.y ?? player.state.y)));
      player.state.dir = msg.dir || player.state.dir;
      player.state.alive = !!msg.alive;
      player.state.hp = Math.max(0, Math.min(3, Number(msg.hp ?? player.state.hp)));
      player.state.respawn = Math.max(0, Number(msg.respawn ?? player.state.respawn));
      broadcast(room, { type:'state_update', players: snapshot(room).players });
      return;
    }
    if (msg.type === 'shoot') {
      room.bullets.push({
        id: 'b_' + Math.random().toString(36).slice(2,9),
        ownerId: playerId,
        x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy, life: 90
      });
      broadcast(room, { type:'spawn_bullet', bullet: room.bullets[room.bullets.length-1] });
      return;
    }
    if (msg.type === 'bullet_hit_wall') {
      const idx = room.map.walls.findIndex(w => w.x === msg.wx && w.y === msg.wy);
      if (idx !== -1) room.map.walls.splice(idx, 1);
      room.bullets = room.bullets.filter(b => b.id !== msg.bulletId);
      broadcast(room, { type:'room_state', ...snapshot(room), msg:'' });
      return;
    }
    if (msg.type === 'bullet_remove') {
      room.bullets = room.bullets.filter(b => b.id !== msg.bulletId);
      broadcast(room, { type:'bullets', bullets: room.bullets });
      return;
    }
    if (msg.type === 'tank_hit') {
      const target = room.players.get(msg.targetId);
      if (!target || !target.state.alive) return;
      target.state.hp = Math.max(0, target.state.hp - 1);
      if (target.state.hp <= 0) {
        target.state.alive = false;
        target.state.respawn = 120;
      }
      room.bullets = room.bullets.filter(b => b.id !== msg.bulletId);
      broadcast(room, { type:'room_state', ...snapshot(room), msg: target.state.hp <= 0 ? `${target.name} 被打爆了` : '' });
      return;
    }
    if (msg.type === 'respawn_done') {
      player.state.alive = true;
      player.state.hp = 3;
      player.state.x = player.role === 'p1' ? 120 : 680;
      player.state.y = player.role === 'p1' ? 480 : 80;
      player.state.dir = player.role === 'p1' ? 'up' : 'down';
      player.state.respawn = 0;
      broadcast(room, { type:'room_state', ...snapshot(room), msg:'重生' });
      return;
    }
    if (msg.type === 'reset_match') {
      resetRoom(room);
      broadcast(room, { type:'room_state', ...snapshot(room), msg:'重新开打' });
      return;
    }
  });

  ws.on('close', () => cleanupPlayer(ws));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on ' + PORT));
