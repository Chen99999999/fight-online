const statusEl = document.getElementById('status');
const roomBox = document.getElementById('roomBox');
const overlayMsg = document.getElementById('overlayMsg');
const ultOverlay = document.getElementById('ultOverlay');
const ultText = document.getElementById('ultText');
const finisherOverlay = document.getElementById('finisherOverlay');
const finisherText = document.getElementById('finisherText');
const comboInfo = document.getElementById('comboInfo');
const leftHp = document.getElementById('leftHp');
const rightHp = document.getElementById('rightHp');
const leftEnergy = document.getElementById('leftEnergy');
const rightEnergy = document.getElementById('rightEnergy');
const leftHpText = document.getElementById('leftHpText');
const rightHpText = document.getElementById('rightHpText');
const leftEnergyText = document.getElementById('leftEnergyText');
const rightEnergyText = document.getElementById('rightEnergyText');
const leftName = document.getElementById('leftName');
const rightName = document.getElementById('rightName');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const charSelect = document.getElementById('charSelect');

let ws = null, playerId = null, roomId = null;
let players = [];
let keys = { left:false, right:false, up:false, down:false, light:false, heavy:false, skill:false, ult:false };
let localState = { x:180, y:308, hp:100, energy:100, facing:1, action:'idle', character:'blaze' };
let attackCooldown = 0, lastSend = 0, comboCount = 0, comboTimer = 0, locked = false;
let hitFx = [], projectiles = [];

const CHAR_DATA = {
  blaze: { body:'#f97316', arm:'#fdba74', weapon:'#fb7185', ult:'烈焰处决', speed:4.2 },
  frost: { body:'#60a5fa', arm:'#bfdbfe', weapon:'#93c5fd', ult:'寒霜处决', speed:4.0 },
  shadow: { body:'#a855f7', arm:'#e9d5ff', weapon:'#c084fc', ult:'暗影处决', speed:4.5 }
};

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
      players = (msg.players || []).map(p => ({ ...p, drawX:p.x, drawY:p.y }));
      const me = players.find(p => p.id === playerId);
      if (me) Object.assign(localState, { x:me.x, y:me.y, hp:me.hp, energy:me.energy, facing:me.facing });
      roomBox.textContent = `房间号：${roomId || '未进入'} ${msg.msg ? '｜' + msg.msg : ''}`;
      locked = false;
      syncHud();
      if (players.length === 2) showMsg('人齐了，狠狠干');
    } else if (msg.type === 'state_update') {
      locked = !!msg.locked;
      const incoming = msg.players || [];
      incoming.forEach(p => {
        const ex = players.find(x => x.id === p.id);
        if (ex) Object.assign(ex, p);
        else players.push({ ...p, drawX:p.x, drawY:p.y });
      });
      syncHud();
    } else if (msg.type === 'hit_effect') {
      players = msg.players || players;
      const t = players.find(p => p.id === msg.targetId);
      if (t) hitFx.push({ x:t.x, y:t.y, life:24, text:`-${msg.damage}`, color: msg.attackType === 'ult' ? '#f9a8d4' : '#fca5a5' });
      if (msg.attackerId === playerId) { comboCount += 1; comboTimer = 90; }
      if (msg.attackType === 'ult') {
        const me = players.find(p => p.id === msg.attackerId);
        showUlt(CHAR_DATA[me?.character || 'blaze'].ult);
      }
      syncHud();
    } else if (msg.type === 'projectile') {
      projectiles.push({ x:msg.x, y:msg.y, vx:msg.vx, vy:msg.vy, fromId:msg.fromId, life:80 });
    } else if (msg.type === 'finisher') {
      locked = true;
      const winner = players.find(p => p.id === msg.winnerId);
      showFinisher(`${winner?.name || msg.winnerName} 处决`);
    } else if (msg.type === 'match_over') {
      locked = false;
      showMsg(`${msg.winnerName} 胜利`);
    }
  };
}

function syncHud() {
  const p1 = players.find(p => p.role === 'p1');
  const p2 = players.find(p => p.role === 'p2');
  if (p1) {
    leftName.textContent = p1.name;
    leftHp.style.width = `${p1.hp}%`;
    leftEnergy.style.width = `${p1.energy}%`;
    leftHpText.textContent = p1.hp;
    leftEnergyText.textContent = Math.round(p1.energy);
  }
  if (p2) {
    rightName.textContent = p2.name;
    rightHp.style.width = `${p2.hp}%`;
    rightEnergy.style.width = `${p2.energy}%`;
    rightHpText.textContent = p2.hp;
    rightEnergyText.textContent = Math.round(p2.energy);
  }
}
function showMsg(text) {
  overlayMsg.textContent = text;
  overlayMsg.classList.remove('hidden');
  clearTimeout(showMsg.t);
  showMsg.t = setTimeout(() => overlayMsg.classList.add('hidden'), 1200);
}
function showUlt(text) {
  ultText.textContent = text;
  ultOverlay.classList.remove('hidden');
  clearTimeout(showUlt.t);
  showUlt.t = setTimeout(() => ultOverlay.classList.add('hidden'), 800);
}
function showFinisher(text) {
  finisherText.textContent = text;
  finisherOverlay.classList.remove('hidden');
  clearTimeout(showFinisher.t);
  showFinisher.t = setTimeout(() => finisherOverlay.classList.add('hidden'), 2200);
}

document.getElementById('createBtn').onclick = () => {
  if (!ws || ws.readyState !== 1) return;
  localState.character = charSelect.value;
  ws.send(JSON.stringify({ type:'create_room', name:nameInput.value || '玩家1' }));
};
document.getElementById('joinBtn').onclick = () => {
  if (!ws || ws.readyState !== 1) return;
  localState.character = charSelect.value;
  ws.send(JSON.stringify({ type:'join_room', roomId:roomInput.value.toUpperCase(), name:nameInput.value || '玩家2' }));
};
document.getElementById('resetBtn').onclick = () => {
  if (!ws || !roomId) return;
  comboCount = 0; localState.energy = 100;
  ws.send(JSON.stringify({ type:'reset_match' }));
};

function performAttack(kind) {
  if (attackCooldown > 0 || !roomId || locked) return;
  const me = players.find(p => p.id === playerId);
  const other = players.find(p => p.id !== playerId);
  if (!me || !other) return;

  let range = 70, damage = 8, cooldown = 12, energyCost = 0;
  if (kind === 'heavy') { range = 110; damage = 15; cooldown = 18; energyCost = 8; }
  if (kind === 'skill') { cooldown = 24; energyCost = 18; }
  if (kind === 'ult') { range = 180; damage = 30; cooldown = 42; energyCost = 70; }
  if (localState.energy < energyCost) return;

  localState.energy -= energyCost;
  localState.action = kind;
  attackCooldown = cooldown;

  if (kind === 'skill') {
    const speed = 8.2;
    const vx = localState.facing > 0 ? speed : -speed;
    ws.send(JSON.stringify({ type:'projectile', x:localState.x + localState.facing * 36, y:localState.y - 6, vx, vy:0 }));
    projectiles.push({ x:localState.x + localState.facing * 36, y:localState.y - 6, vx, vy:0, fromId:playerId, life:80, own:true });
    return;
  }

  const dx = other.x - me.x;
  const inRange = (me.facing > 0 && dx > 0 && dx < range) || (me.facing < 0 && dx < 0 && Math.abs(dx) < range);
  if (inRange) ws.send(JSON.stringify({ type:'hit', targetId:other.id, damage, attackType:kind }));
}

function updateProjectiles() {
  const other = players.find(p => p.id !== playerId);
  projectiles.forEach(pr => {
    pr.x += pr.vx; pr.y += pr.vy; pr.life--;
    if (other && pr.fromId === playerId) {
      const hit = Math.abs(pr.x - other.x) < 26 && Math.abs(pr.y - (other.y - 10)) < 40;
      if (hit && !pr.hitSent) {
        pr.hitSent = true;
        ws.send(JSON.stringify({ type:'hit', targetId:other.id, damage:18, attackType:'projectile' }));
        pr.life = 0;
      }
    }
  });
  projectiles = projectiles.filter(pr => pr.life > 0 && pr.x > -50 && pr.x < 850);
}

function update() {
  const char = CHAR_DATA[localState.character] || CHAR_DATA.blaze;
  const speed = char.speed;

  if (!locked && roomId) {
    if (keys.left) { localState.x -= speed; localState.facing = -1; if (attackCooldown <= 0) localState.action = 'run'; }
    if (keys.right) { localState.x += speed; localState.facing = 1; if (attackCooldown <= 0) localState.action = 'run'; }
    if (!keys.left && !keys.right && attackCooldown <= 0) localState.action = 'idle';
    localState.x = Math.max(50, Math.min(750, localState.x));

    localState.energy = Math.min(100, localState.energy + 0.06);

    if (keys.light) { performAttack('light'); keys.light = false; }
    if (keys.heavy) { performAttack('heavy'); keys.heavy = false; }
    if (keys.skill) { performAttack('skill'); keys.skill = false; }
    if (keys.ult) { performAttack('ult'); keys.ult = false; }

    const now = performance.now();
    if (ws && ws.readyState === 1 && now - lastSend > 66) {
      lastSend = now;
      ws.send(JSON.stringify({ type:'input', x:localState.x, y:localState.y, hp:localState.hp, energy:localState.energy, facing:localState.facing, action:localState.action, character:localState.character }));
    }
  }

  players.forEach(p => {
    if (p.id === playerId) {
      p.x = localState.x; p.y = localState.y; p.hp = localState.hp; p.energy = localState.energy; p.facing = localState.facing; p.action = localState.action; p.character = localState.character;
      p.drawX = p.x; p.drawY = p.y;
    } else {
      if (p.drawX == null) p.drawX = p.x;
      if (p.drawY == null) p.drawY = p.y;
      p.drawX += (p.x - p.drawX) * 0.22;
      p.drawY += (p.y - p.drawY) * 0.22;
    }
  });

  updateProjectiles();

  if (attackCooldown > 0) attackCooldown--;
  if (comboTimer > 0) comboTimer--;
  else comboCount = 0;
  hitFx.forEach(h => h.life--);
  hitFx = hitFx.filter(h => h.life > 0);
  comboInfo.textContent = comboCount >= 2 ? `${comboCount} 连击` : (locked ? 'FINISH' : 'READY');
}

function drawBlockFighter(p) {
  const char = CHAR_DATA[p.character] || CHAR_DATA.blaze;
  const x = p.drawX ?? p.x, y = p.drawY ?? p.y;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-20, 52, 40, 8);
  ctx.fillStyle = '#1f2937'; ctx.fillRect(-14, 28, 10, 24); ctx.fillRect(4, 28, 10, 24);
  ctx.fillStyle = char.body; ctx.fillRect(-20, -4, 40, 34);
  ctx.fillStyle = '#fde68a'; ctx.fillRect(-16, -32, 32, 28);
  ctx.fillStyle = '#111827'; ctx.fillRect(-8, -20, 4, 4); ctx.fillRect(4, -20, 4, 4);
  ctx.fillStyle = char.arm; ctx.fillRect(-28, 0, 8, 24); ctx.fillRect(20, 0, 8, 24);

  if (p.action === 'light' || p.action === 'heavy' || p.action === 'ult') {
    const len = p.action === 'ult' ? 70 : p.action === 'heavy' ? 36 : 24;
    ctx.fillStyle = char.weapon;
    if (p.facing > 0) ctx.fillRect(28, 8, len, 8);
    else ctx.fillRect(-28 - len, 8, len, 8);
  }
  if (p.action === 'ult') {
    ctx.fillStyle = 'rgba(236,72,153,.18)';
    if (p.facing > 0) ctx.fillRect(28, -16, 150, 64);
    else ctx.fillRect(-178, -16, 150, 64);
  }

  ctx.fillStyle = '#fff'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(p.name, 0, -42);
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#1e293b'); g.addColorStop(1, '#111827');
  ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(620, 50, 70, 70);
  for (let i = 0; i < 7; i++) { ctx.fillStyle = `rgba(255,255,255,${0.03 + i*0.01})`; ctx.fillRect(i*120+20, 180-i*4, 60, 210+i*4); }
  ctx.fillStyle = '#334155'; ctx.fillRect(0, 390, 800, 70);
  ctx.fillStyle = '#475569'; for (let i = 0; i < 16; i++) ctx.fillRect(i*50, 390, 24, 10);

  projectiles.forEach(pr => {
    ctx.fillStyle = pr.own ? '#c084fc' : '#93c5fd';
    ctx.beginPath(); ctx.arc(pr.x, pr.y, 8, 0, Math.PI * 2); ctx.fill();
  });

  players.forEach(drawBlockFighter);

  hitFx.forEach(h => {
    ctx.fillStyle = h.color; ctx.font = 'bold 22px sans-serif';
    ctx.fillText(h.text, h.x, h.y - 60 + (24 - h.life));
  });
}

function loop() { update(); render(); requestAnimationFrame(loop); }

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
