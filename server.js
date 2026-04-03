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
function safeSend(ws, payload) { if (ws.readyState === 1) ws.send(JSON.stringify(payload)); }
function broadcast(room, payload) { for (const p of room.players.values()) safeSend(p.ws, payload); }
function findRoomByPlayer(playerId) {
  for (const r of rooms.values()) if (r.players.has(playerId)) return r;
  return null;
}
function createPlayer(id, name, ws, role) {
  return {
    id, name, ws, role,
    state: {
      x: role === 'p1' ? 180 : 620,
      y: 318,
      hp: 100,
      energy: 100,
      facing: role === 'p1' ? 1 : -1,
      action: 'idle',
      guard: false,
      character: role === 'p1' ? 'blade' : 'ranger',
      item: null,
      itemTimer: 0,
      invincibleTimer: 0
    }
  };
}
function snapshot(room) {
  return {
    roomId: room.roomId,
    hostId: room.hostId,
    theme: room.theme,
    items: room.items,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, role: p.role,
      x: p.state.x, y: p.state.y, hp: p.state.hp, energy: p.state.energy,
      facing: p.state.facing, action: p.state.action, guard: p.state.guard,
      character: p.state.character || 'blade',
      item: p.state.item, itemTimer: p.state.itemTimer, invincibleTimer: p.state.invincibleTimer
    }))
  };
}
function randomTheme() {
  const themes = ['neon', 'desert', 'snow', 'dojo'];
  return themes[Math.floor(Math.random() * themes.length)];
}
function randomItem(idCounter) {
  const types = ['minigun', 'grenade', 'heal', 'shield'];
  const type = types[Math.floor(Math.random() * types.length)];
  return {
    id: 'item_' + idCounter,
    type,
    x: 240 + Math.random() * 320,
    y: 338
  };
}
function cleanupPlayer(ws) {
  for (const [roomId, room] of rooms) {
    let found = null;
    for (const [id, p] of room.players) if (p.ws === ws) { found = id; break; }
    if (!found) continue;
    room.players.delete(found);
    if (room.players.size === 0) rooms.delete(roomId);
    else {
      if (room.hostId === found) room.hostId = [...room.players.keys()][0];
      room.locked = false;
      room.cinematic = false;
      broadcast(room, { type:'room_state', ...snapshot(room), msg:'有玩家离开了房间' });
    }
    break;
  }
}

function scheduleItems(room) {
  if (room.itemInterval) clearInterval(room.itemInterval);
  room.itemInterval = setInterval(() => {
    if (room.items.length < 2) {
      room.itemCounter += 1;
      room.items.push(randomItem(room.itemCounter));
      broadcast(room, { type:'room_state', ...snapshot(room), msg:'新道具掉落了' });
    }
  }, 7000);
}

wss.on('connection', (ws) => {
  const playerId = 'p_' + Math.random().toString(36).slice(2, 10);
  safeSend(ws, { type:'hello', playerId });

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'create_room') {
      let roomId = code();
      while (rooms.has(roomId)) roomId = code();
      const room = { roomId, hostId: playerId, players: new Map(), locked:false, cinematic:false, theme: randomTheme(), items: [], itemCounter: 0 };
      room.players.set(playerId, createPlayer(playerId, msg.name || '玩家1', ws, 'p1'));
      rooms.set(roomId, room);
      scheduleItems(room);
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
      player.state = {
        ...player.state,
        x: Math.max(40, Math.min(760, Number(msg.x ?? player.state.x))),
        y: Math.max(100, Math.min(330, Number(msg.y ?? player.state.y))),
        facing: Number(msg.facing ?? player.state.facing),
        action: msg.action || player.state.action,
        guard: !!msg.guard,
        hp: Math.max(0, Math.min(100, Number(msg.hp ?? player.state.hp))),
        energy: Math.max(0, Math.min(100, Number(msg.energy ?? player.state.energy))),
        character: msg.character || player.state.character,
        item: msg.item ?? player.state.item,
        itemTimer: Math.max(0, Number(msg.itemTimer ?? player.state.itemTimer)),
        invincibleTimer: Math.max(0, Number(msg.invincibleTimer ?? player.state.invincibleTimer))
      };
      broadcast(room, { type:'state_update', players: snapshot(room).players, locked: room.locked, cinematic: room.cinematic, items: room.items, theme: room.theme });
      return;
    }

    if (msg.type === 'pickup_item') {
      const idx = room.items.findIndex(i => i.id === msg.itemId);
      if (idx === -1) return;
      const item = room.items[idx];
      room.items.splice(idx, 1);
      if (item.type === 'heal') {
        player.state.hp = Math.min(100, player.state.hp + 24);
      } else if (item.type === 'shield') {
        player.state.invincibleTimer = 280;
      } else {
        player.state.item = item.type;
        player.state.itemTimer = item.type === 'minigun' ? 260 : 140;
      }
      broadcast(room, { type:'room_state', ...snapshot(room), msg:'道具已拾取' });
      return;
    }

    if (msg.type === 'hit') {
      if (room.locked || room.cinematic) return;
      const target = room.players.get(msg.targetId);
      if (!target) return;
      let damage = Number(msg.damage || 0);
      if (target.state.invincibleTimer > 0) damage = 0;
      else if (target.state.guard && !msg.guardBreak) damage = Math.floor(damage * 0.25);
      target.state.hp = Math.max(0, target.state.hp - damage);
      broadcast(room, {
        type:'hit_effect',
        attackerId: playerId,
        targetId: msg.targetId,
        damage,
        attackType: msg.attackType || 'slash',
        blocked: !!target.state.guard && !msg.guardBreak,
        players: snapshot(room).players
      });
      return;
    }

    if (msg.type === 'projectile') {
      if (room.locked || room.cinematic) return;
      broadcast(room, { type:'projectile', ...msg, fromId: playerId });
      return;
    }

    if (msg.type === 'ult_start') {
      if (room.locked || room.cinematic) return;
      const target = room.players.get(msg.targetId);
      if (!target) return;
      room.cinematic = true;
      broadcast(room, { type:'ult_cinematic', attackerId: playerId, targetId: msg.targetId, title: msg.title || '处决', players: snapshot(room).players });
      setTimeout(() => {
        let damage = Number(msg.damage || 36);
        if (target.state.invincibleTimer > 0) damage = 0;
        target.state.hp = Math.max(0, target.state.hp - damage);
        room.cinematic = false;
        broadcast(room, {
          type:'hit_effect',
          attackerId: playerId,
          targetId: msg.targetId,
          damage,
          attackType:'ult',
          blocked:false,
          players: snapshot(room).players
        });
      }, 1800);
      return;
    }

    if (msg.type === 'reset_match') {
      room.locked = false;
      room.cinematic = false;
      room.theme = randomTheme();
      room.items = [];
      let first = true;
      for (const p of room.players.values()) {
        p.state.hp = 100;
        p.state.energy = 100;
        p.state.x = first ? 180 : 620;
        p.state.y = 318;
        p.state.facing = first ? 1 : -1;
        p.state.action = 'idle';
        p.state.guard = false;
        p.state.item = null;
        p.state.itemTimer = 0;
        p.state.invincibleTimer = 0;
        first = false;
      }
      broadcast(room, { type:'room_state', ...snapshot(room), msg:'重新开打' });
    }
  });

  ws.on('close', () => cleanupPlayer(ws));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on ' + PORT));
