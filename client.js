const statusEl = document.getElementById('status');
const roomBox = document.getElementById('roomBox');
const overlayMsg = document.getElementById('overlayMsg');
const midInfo = document.getElementById('midInfo');
const p1Name = document.getElementById('p1Name');
const p2Name = document.getElementById('p2Name');
const p1Hp = document.getElementById('p1Hp');
const p2Hp = document.getElementById('p2Hp');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');

let ws = null, playerId = null, roomId = null;
let players = [];
let mapData = {walls:[], iron:[]};
let bullets = [];
let keys = { left:false, right:false, up:false, down:false, shoot:false };
let local = { x:120, y:480, dir:'up', hp:3, alive:true, respawn:0 };
let shotCd = 0, lastSend = 0;

function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => statusEl.textContent = '已连接服务器';
  ws.onclose = () => statusEl.textContent = '连接断开，刷新重试';
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'hello') playerId = msg.playerId;
    else if (msg.type === 'error_msg') showMsg(msg.text);
    else if (msg.type === 'room_state') {
      roomId = msg.roomId;
      players = (msg.players || []).map(p => ({...p, drawX:p.x, drawY:p.y}));
      mapData = msg.map || mapData;
      bullets = msg.bullets || bullets;
      const me = players.find(p => p.id === playerId);
      if (me) Object.assign(local, { x:me.x, y:me.y, dir:me.dir, hp:me.hp, alive:me.alive, respawn:me.respawn });
      roomBox.textContent = `房间号：${roomId || '未进入'} ${msg.msg ? '｜'+msg.msg : ''}`;
      syncHud();
      if (msg.msg) showMsg(msg.msg);
    } else if (msg.type === 'state_update') {
      const incoming = msg.players || [];
      incoming.forEach(p => {
        const ex = players.find(x => x.id === p.id);
        if (ex) Object.assign(ex, p);
      });
      syncHud();
    } else if (msg.type === 'spawn_bullet') {
      bullets.push(msg.bullet);
    } else if (msg.type === 'bullets') {
      bullets = msg.bullets || [];
    } else if (msg.type === 'match_over') {
      showMsg(`${msg.winnerName} 胜利`);
      midInfo.textContent = 'GG';
    }
  };
}

function syncHud() {
  const p1 = players.find(p => p.role === 'p1');
  const p2 = players.find(p => p.role === 'p2');
  if (p1) { p1Name.textContent = p1.name; p1Hp.textContent = p1.hp; }
  if (p2) { p2Name.textContent = p2.name; p2Hp.textContent = p2.hp; }
}
function showMsg(text) {
  overlayMsg.textContent = text;
  overlayMsg.classList.remove('hidden');
  clearTimeout(showMsg.t);
  showMsg.t = setTimeout(() => overlayMsg.classList.add('hidden'), 1000);
}

document.getElementById('createBtn').onclick = () => {
  if (ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ type:'create_room', name:nameInput.value || '玩家1' }));
};
document.getElementById('joinBtn').onclick = () => {
  if (ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ type:'join_room', roomId:roomInput.value.toUpperCase(), name:nameInput.value || '玩家2' }));
};
document.getElementById('resetBtn').onclick = () => {
  if (ws?.readyState !== 1 || !roomId) return;
  ws.send(JSON.stringify({ type:'reset_match' }));
};

function collides(x, y) {
  if (x < 20 || x > 780 || y < 20 || y > 540) return true;
  for (const w of mapData.walls) if (aabb(x-16, y-16, 32, 32, w.x, w.y, 40, 40)) return true;
  for (const w of mapData.iron) if (aabb(x-16, y-16, 32, 32, w.x, w.y, 40, 40)) return true;
  return false;
}
function shoot() {
  if (shotCd > 0 || !roomId || !local.alive) return;
  shotCd = 18;
  let vx=0, vy=0, x=local.x, y=local.y;
  if (local.dir === 'up') { vy = -8; y -= 24; }
  if (local.dir === 'down') { vy = 8; y += 24; }
  if (local.dir === 'left') { vx = -8; x -= 24; }
  if (local.dir === 'right') { vx = 8; x += 24; }
  ws.send(JSON.stringify({ type:'shoot', x, y, vx, vy }));
}
function updateTank() {
  if (!roomId) return;
  if (!local.alive) {
    local.respawn--;
    if (local.respawn <= 0 && ws?.readyState === 1) ws.send(JSON.stringify({ type:'respawn_done' }));
    return;
  }
  let nx = local.x, ny = local.y;
  const speed = 3.2;
  if (keys.left) { nx -= speed; local.dir = 'left'; }
  if (keys.right) { nx += speed; local.dir = 'right'; }
  if (keys.up) { ny -= speed; local.dir = 'up'; }
  if (keys.down) { ny += speed; local.dir = 'down'; }
  if (!collides(nx, ny)) { local.x = nx; local.y = ny; }
  if (keys.shoot) { shoot(); keys.shoot = false; }
  if (shotCd > 0) shotCd--;
  const now = performance.now();
  if (ws?.readyState === 1 && now - lastSend > 66) {
    lastSend = now;
    ws.send(JSON.stringify({ type:'input', x:local.x, y:local.y, dir:local.dir, hp:local.hp, alive:local.alive, respawn:local.respawn }));
  }
}
function updateBullets() {
  const other = players.find(p => p.id !== playerId);
  bullets.forEach(b => {
    b.x += b.vx; b.y += b.vy; b.life--;
    if (b.ownerId === playerId) {
      for (const w of mapData.walls) {
        if (aabb(b.x-4, b.y-4, 8, 8, w.x, w.y, 40, 40)) {
          ws.send(JSON.stringify({ type:'bullet_hit_wall', bulletId:b.id, wx:w.x, wy:w.y }));
          b.life = 0;
        }
      }
      for (const w of mapData.iron) {
        if (aabb(b.x-4, b.y-4, 8, 8, w.x, w.y, 40, 40)) {
          ws.send(JSON.stringify({ type:'bullet_remove', bulletId:b.id }));
          b.life = 0;
        }
      }
      if (other && other.alive && aabb(b.x-4, b.y-4, 8, 8, other.x-16, other.y-16, 32, 32)) {
        ws.send(JSON.stringify({ type:'tank_hit', targetId:other.id, bulletId:b.id }));
        b.life = 0;
      }
      if (b.x < 0 || b.x > 800 || b.y < 0 || b.y > 560) {
        ws.send(JSON.stringify({ type:'bullet_remove', bulletId:b.id }));
        b.life = 0;
      }
    }
  });
  bullets = bullets.filter(b => b.life > 0);
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, 560);
  g.addColorStop(0, '#16321a');
  g.addColorStop(1, '#0f172a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 800, 560);
  ctx.fillStyle = 'rgba(255,255,255,.04)';
  for (let i = 0; i < 10; i++) ctx.fillRect(i*80, 0, 2, 560);
  for (let i = 0; i < 7; i++) ctx.fillRect(0, i*80, 800, 2);
}
function drawMap() {
  for (const w of mapData.walls) {
    ctx.fillStyle = '#b45309';
    ctx.fillRect(w.x, w.y, 40, 40);
    ctx.fillStyle = '#92400e';
    ctx.fillRect(w.x+4, w.y+4, 32, 8);
  }
  for (const w of mapData.iron) {
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(w.x, w.y, 40, 40);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(w.x+6, w.y+6, 28, 6);
  }
}
function drawTank(p) {
  const x = p.x, y = p.y;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = p.color || '#f59e0b';
  ctx.fillRect(-16, -16, 32, 32);
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  ctx.fillRect(-12, -12, 24, 8);
  ctx.fillStyle = '#111827';
  ctx.fillRect(-20, -18, 6, 36);
  ctx.fillRect(14, -18, 6, 36);
  ctx.fillStyle = '#e5e7eb';
  if (p.dir === 'up') ctx.fillRect(-3, -26, 6, 18);
  if (p.dir === 'down') ctx.fillRect(-3, 8, 6, 18);
  if (p.dir === 'left') ctx.fillRect(-26, -3, 18, 6);
  if (p.dir === 'right') ctx.fillRect(8, -3, 18, 6);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(p.name, 0, -26);
  ctx.restore();
}
function drawBullets() {
  for (const b of bullets) {
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, Math.PI*2);
    ctx.fill();
  }
}
function render() {
  drawBackground();
  drawMap();
  drawBullets();
  players.forEach(drawTank);
  if (!local.alive) {
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.font = 'bold 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`重生 ${Math.ceil(local.respawn/60)}`, 400, 280);
  }
}
function loop() {
  updateTank();
  updateBullets();
  render();
  requestAnimationFrame(loop);
}
function bindBtn(btn) {
  const key = btn.dataset.k;
  const down = (e) => { e.preventDefault(); keys[key] = true; btn.classList.add('active'); };
  const up = (e) => { e.preventDefault(); keys[key] = false; btn.classList.remove('active'); };
  btn.addEventListener('touchstart', down, { passive:false });
  btn.addEventListener('touchend', up, { passive:false });
  btn.addEventListener('touchcancel', up, { passive:false });
  btn.addEventListener('mousedown', down);
  btn.addEventListener('mouseup', up);
  btn.addEventListener('mouseleave', up);
}
document.querySelectorAll('[data-k]').forEach(bindBtn);

connect();
loop();
