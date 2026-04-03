const statusEl = document.getElementById('status');
const roomBox = document.getElementById('roomBox');
const overlayMsg = document.getElementById('overlayMsg');
const ultOverlay = document.getElementById('ultOverlay');
const ultText = document.getElementById('ultText');
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
let keys = { left:false, right:false, up:false, down:false, slash:false, shoot:false, guard:false, ult:false };
let localState = { x:180, y:398, hp:100, energy:100, facing:1, action:'idle', actionFrame:0, character:'blade', guard:false, crouch:false, vy:0, grounded:true, item:null, itemTimer:0, invincibleTimer:0 };
let actionCooldown = 0, lastSend = 0, comboCount = 0, comboTimer = 0, locked = false, cinematic = false;
let hitFx = [], projectiles = [], items = [], theme = 'neon';
let playerCountShown = 0;

const CHAR_DATA = {
  blade: { name:'火帽刀客', body:'#f97316', arm:'#fdba74', weapon:'#fb7185', hat:'#b91c1c', shoe:'#111827', ult:'火帽刀客 · 处决', speed:4.2, ranged:'knife' },
  ranger: { name:'冰弓仔', body:'#60a5fa', arm:'#bfdbfe', weapon:'#93c5fd', hat:'#1d4ed8', shoe:'#0f172a', ult:'冰弓仔 · 处决', speed:4.0, ranged:'arrow' },
  cowboy: { name:'影子牛仔', body:'#a855f7', arm:'#e9d5ff', weapon:'#c084fc', hat:'#111827', shoe:'#1f2937', ult:'影子牛仔 · 处决', speed:4.5, ranged:'bullet' }
};
const ITEM_LABEL = { minigun:'机枪', grenade:'手雷', heal:'恢复', shield:'无敌' };

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
      theme = msg.theme || theme;
      items = msg.items || [];
      const oldCount = players.length;
      roomId = msg.roomId;
      players = (msg.players || []).map(p => ({ ...p, drawX:p.x, drawY:p.y, drawScale:1, bloodTimer:0 }));
      const me = players.find(p => p.id === playerId);
      if (me) Object.assign(localState, { x:me.x, y:me.y, hp:me.hp, energy:me.energy, facing:me.facing, character:me.character, item:me.item, itemTimer:me.itemTimer, invincibleTimer:me.invincibleTimer });
      roomBox.textContent = `房间号：${roomId || '未进入'} ${msg.msg ? '｜' + msg.msg : ''}`;
      locked = false; cinematic = false; syncHud();
      if (oldCount < 2 && players.length === 2) showMsg('人齐了，狠狠干');
      playerCountShown = players.length;
    } else if (msg.type === 'state_update') {
      locked = !!msg.locked; cinematic = !!msg.cinematic; items = msg.items || items; theme = msg.theme || theme;
      const incoming = msg.players || [];
      incoming.forEach(p => {
        const ex = players.find(x => x.id === p.id);
        if (ex) Object.assign(ex, p);
        else players.push({ ...p, drawX:p.x, drawY:p.y, drawScale:1, bloodTimer:0 });
      });
      syncHud();
    } else if (msg.type === 'hit_effect') {
      players = msg.players || players;
      const t = players.find(p => p.id === msg.targetId);
      if (t) {
        t.bloodTimer = msg.damage > 0 ? 22 : 0;
        hitFx.push({ x:t.x, y:t.y, life:26, text: msg.blocked ? '格挡' : `-${msg.damage}`, color: msg.blocked ? '#93c5fd' : (msg.attackType === 'ult' ? '#f9a8d4' : '#fca5a5') });
      }
      if (msg.attackerId === playerId && msg.damage > 0) { comboCount += 1; comboTimer = 90; }
      if (msg.attackType === 'ult') {
        const me = players.find(p => p.id === msg.attackerId);
        showUlt(CHAR_DATA[me?.character || 'blade'].ult);
      }
      syncHud();
    } else if (msg.type === 'projectile') {
      projectiles.push({ x:msg.x, y:msg.y, vx:msg.vx, vy:msg.vy, fromId:msg.fromId, kind:msg.kind || 'shoot', life:90 });
    } else if (msg.type === 'ult_cinematic') {
      cinematic = true;
      players = msg.players || players;
      const attacker = players.find(p => p.id === msg.attackerId);
      const target = players.find(p => p.id === msg.targetId);
      showUlt(CHAR_DATA[attacker?.character || 'blade'].ult);
      if (attacker) attacker.drawScale = 1.36;
      if (target) target.drawScale = 0.88;
      setTimeout(() => {
        players.forEach(p => p.drawScale = 1);
        cinematic = false;
      }, 1800);
    }
  };
}

function syncHud() {
  const p1 = players.find(p => p.role === 'p1');
  const p2 = players.find(p => p.role === 'p2');
  if (p1) {
    leftName.textContent = `${p1.name}${p1.item ? ' · '+ITEM_LABEL[p1.item] : ''}`;
    leftHp.style.width = `${p1.hp}%`; leftEnergy.style.width = `${p1.energy}%`;
    leftHpText.textContent = p1.hp; leftEnergyText.textContent = Math.round(p1.energy);
  }
  if (p2) {
    rightName.textContent = `${p2.name}${p2.item ? ' · '+ITEM_LABEL[p2.item] : ''}`;
    rightHp.style.width = `${p2.hp}%`; rightEnergy.style.width = `${p2.energy}%`;
    rightHpText.textContent = p2.hp; rightEnergyText.textContent = Math.round(p2.energy);
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
  showUlt.t = setTimeout(() => ultOverlay.classList.add('hidden'), 1900);
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
  comboCount = 0;
  Object.assign(localState, { energy:100, item:null, itemTimer:0, invincibleTimer:0 });
  ws.send(JSON.stringify({ type:'reset_match' }));
};

function performSlash() {
  if (actionCooldown > 0 || !roomId || locked || cinematic) return;
  const me = players.find(p => p.id === playerId);
  const other = players.find(p => p.id !== playerId);
  if (!me || !other) return;
  localState.action = 'slash';
  localState.actionFrame = 12;
  actionCooldown = 14;
  const range = 86;
  const damage = localState.item === 'minigun' ? 12 : 10;
  const dx = other.x - me.x;
  const inRange = (me.facing > 0 && dx > 0 && dx < range) || (me.facing < 0 && dx < 0 && Math.abs(dx) < range);
  if (inRange) ws.send(JSON.stringify({ type:'hit', targetId:other.id, damage, attackType:'slash' }));
}

function spawnProjectile(kind, x, y, vx, vy) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'projectile', x, y, vx, vy, kind }));
  projectiles.push({ x, y, vx, vy, fromId:playerId, kind, life: kind === 'grenade' ? 55 : 90, own:true });
}

function performShoot() {
  if (actionCooldown > 0 || !roomId || locked || cinematic) return;
  let energyCost = 14;
  let kind = 'shoot';
  let cd = 18;
  if (localState.item === 'minigun') { energyCost = 4; cd = 5; }
  if (localState.item === 'grenade') { energyCost = 10; kind = 'grenade'; cd = 20; }
  if (localState.energy < energyCost) return;
  localState.energy -= energyCost;
  localState.action = 'shoot';
  localState.actionFrame = 8;
  actionCooldown = cd;

  const baseX = localState.x + localState.facing * 42;
  const baseY = localState.y - (localState.crouch ? 10 : 34);
  if (kind === 'grenade') {
    spawnProjectile(kind, baseX, baseY, localState.facing * 5.6, -2.8);
    localState.item = null;
    localState.itemTimer = 0;
  } else {
    spawnProjectile(kind, baseX, baseY, localState.facing * 9.2, 0);
  }
}

function performUlt() {
  if (actionCooldown > 0 || !roomId || locked || cinematic) return;
  const me = players.find(p => p.id === playerId);
  const other = players.find(p => p.id !== playerId);
  if (!me || !other || localState.energy < 70) return;
  const dx = other.x - me.x;
  const range = 156;
  const inRange = (me.facing > 0 && dx > 0 && dx < range) || (me.facing < 0 && dx < 0 && Math.abs(dx) < range);
  if (!inRange) return;
  localState.energy -= 70;
  localState.action = 'ult';
  localState.actionFrame = 20;
  actionCooldown = 62;
  ws.send(JSON.stringify({ type:'ult_start', targetId: other.id, damage: 38, title:'处决' }));
}

function tryPickupItem() {
  if (!roomId || !ws || ws.readyState !== 1) return;
  for (const item of items) {
    if (Math.abs(item.x - localState.x) < 24 && Math.abs(item.y - (localState.y + 60)) < 28) {
      ws.send(JSON.stringify({ type:'pickup_item', itemId: item.id }));
      break;
    }
  }
}

function updateProjectiles() {
  const other = players.find(p => p.id !== playerId);
  projectiles.forEach(pr => {
    if (pr.kind === 'grenade') pr.vy += 0.16;
    pr.x += pr.vx; pr.y += pr.vy; pr.life--;
    if (other && pr.fromId === playerId) {
      const hit = Math.abs(pr.x - other.x) < 28 && Math.abs(pr.y - (other.y - 24)) < 46;
      if (hit && !pr.hitSent) {
        pr.hitSent = true;
        const damage = pr.kind === 'grenade' ? 26 : (localState.item === 'minigun' ? 8 : 18);
        ws.send(JSON.stringify({ type:'hit', targetId: other.id, damage, attackType: pr.kind === 'grenade' ? 'grenade' : 'projectile' }));
        pr.life = 0;
      }
    }
    if (pr.kind === 'grenade' && pr.y > 500) pr.life = 0;
  });
  projectiles = projectiles.filter(pr => pr.life > 0 && pr.x > -60 && pr.x < 860);
}

function updateLocalMovement() {
  const char = CHAR_DATA[localState.character] || CHAR_DATA.blade;
  if (!locked && !cinematic && roomId) {
    if (keys.left) { localState.x -= char.speed; localState.facing = -1; if (actionCooldown <= 0 && !localState.guard) localState.action = 'run'; }
    if (keys.right) { localState.x += char.speed; localState.facing = 1; if (actionCooldown <= 0 && !localState.guard) localState.action = 'run'; }
    if (keys.up && localState.grounded) { localState.vy = -11.3; localState.grounded = false; localState.action = 'jump'; }
    localState.crouch = !!keys.down && localState.grounded;
    localState.guard = !!keys.guard && localState.grounded && actionCooldown <= 0;

    if (!keys.left && !keys.right && !localState.crouch && !localState.guard && actionCooldown <= 0 && localState.grounded) localState.action = 'idle';
    if (localState.crouch && actionCooldown <= 0) localState.action = 'crouch';
    if (localState.guard && actionCooldown <= 0) localState.action = 'guard';

    localState.vy += 0.58;
    localState.y += localState.vy;
    if (localState.y >= 398) { localState.y = 398; localState.vy = 0; localState.grounded = true; }
    else { localState.grounded = false; }

    localState.x = Math.max(50, Math.min(750, localState.x));
    localState.energy = Math.min(100, localState.energy + 0.03);
    if (localState.itemTimer > 0) localState.itemTimer--;
    else if (localState.item && localState.item !== 'shield') { localState.item = null; }
    if (localState.invincibleTimer > 0) localState.invincibleTimer--;
    if (localState.actionFrame > 0) localState.actionFrame--;

    tryPickupItem();

    if (keys.slash) { performSlash(); keys.slash = false; }
    if (keys.shoot) { performShoot(); keys.shoot = false; }
    if (keys.ult) { performUlt(); keys.ult = false; }

    const now = performance.now();
    if (ws && ws.readyState === 1 && now - lastSend > 66) {
      lastSend = now;
      ws.send(JSON.stringify({
        type:'input',
        x:localState.x, y:localState.y, hp:localState.hp, energy:localState.energy,
        facing:localState.facing, action:localState.action, actionFrame:localState.actionFrame, character:localState.character,
        guard:localState.guard, item:localState.item, itemTimer:localState.itemTimer, invincibleTimer:localState.invincibleTimer
      }));
    }
  }
}

function update() {
  updateLocalMovement();

  players.forEach(p => {
    if (p.id === playerId) {
      p.x = localState.x; p.y = localState.y; p.hp = localState.hp; p.energy = localState.energy;
      p.facing = localState.facing; p.action = localState.action; p.actionFrame = localState.actionFrame; p.character = localState.character; p.guard = localState.guard; p.crouch = localState.crouch;
      p.item = localState.item; p.itemTimer = localState.itemTimer; p.invincibleTimer = localState.invincibleTimer;
      p.drawX = p.x; p.drawY = p.y;
      if (p.drawScale == null) p.drawScale = 1;
      if (p.bloodTimer == null) p.bloodTimer = 0;
    } else {
      if (p.drawX == null) p.drawX = p.x;
      if (p.drawY == null) p.drawY = p.y;
      if (p.drawScale == null) p.drawScale = 1;
      if (p.bloodTimer == null) p.bloodTimer = 0;
      p.drawX += (p.x - p.drawX) * 0.22;
      p.drawY += (p.y - p.drawY) * 0.22;
      p.drawScale += (1 - p.drawScale) * 0.18;
      if (p.bloodTimer > 0) p.bloodTimer--;
    }
  });

  updateProjectiles();

  if (actionCooldown > 0) actionCooldown--;
  if (comboTimer > 0) comboTimer--;
  else comboCount = 0;
  hitFx.forEach(h => h.life--);
  hitFx = hitFx.filter(h => h.life > 0);
  comboInfo.textContent = comboCount >= 2 ? `${comboCount} 连击` : (cinematic ? 'EXECUTE' : 'READY');
}

function drawTheme() {
  const palettes = {
    neon: ['#1e293b', '#111827'],
    desert: ['#7c5a3a', '#4a3425'],
    snow: ['#334155', '#475569'],
    dojo: ['#3b2f2f', '#1f2937'],
    forest: ['#16351f', '#10251a']
  };
  const [c1, c2] = palettes[theme] || palettes.neon;
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (theme === 'neon') {
    ctx.fillStyle = 'rgba(255,255,255,.05)';
    ctx.fillRect(610, 54, 80, 80);
    for (let i = 0; i < 7; i++) { ctx.fillStyle = `rgba(255,255,255,${0.03 + i*0.01})`; ctx.fillRect(i*120+20, 180-i*4, 60, 270+i*4); }
  } else if (theme === 'desert') {
    ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(660, 92, 48, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#8b5e34'; for (let i = 0; i < 4; i++) ctx.fillRect(i*180+20, 250, 90, 230);
    ctx.fillStyle = '#d97706'; ctx.beginPath(); ctx.moveTo(0,420); ctx.lineTo(200,360); ctx.lineTo(460,430); ctx.lineTo(800,350); ctx.lineTo(800,560); ctx.lineTo(0,560); ctx.fill();
  } else if (theme === 'snow') {
    ctx.fillStyle = '#e0f2fe'; ctx.beginPath(); ctx.arc(650, 92, 40, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < 10; i++) ctx.fillRect(i*86, 430 - (i%3)*12, 50, 130 + (i%3)*12);
    ctx.fillStyle = '#cbd5e1'; ctx.fillRect(0, 470, 800, 90);
  } else if (theme === 'dojo') {
    ctx.fillStyle = '#f59e0b'; for (let i = 0; i < 8; i++) ctx.fillRect(i*100+20, 120, 8, 360);
    ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fillRect(0, 180, 800, 18);
    ctx.fillStyle = '#7c2d12'; ctx.fillRect(0, 470, 800, 90);
  } else if (theme === 'forest') {
    ctx.fillStyle = '#fde68a'; ctx.beginPath(); ctx.arc(660, 92, 44, 0, Math.PI*2); ctx.fill();
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = '#14532d'; ctx.fillRect(i*96+20, 220, 22, 260);
      ctx.fillStyle = '#166534'; ctx.beginPath(); ctx.arc(i*96+31, 200, 44, 0, Math.PI*2); ctx.fill();
    }
    ctx.fillStyle = '#3f6212'; ctx.fillRect(0, 470, 800, 90);
  }

  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 490, 800, 70);
  ctx.fillStyle = '#475569';
  for (let i = 0; i < 16; i++) ctx.fillRect(i*50, 490, 24, 10);
}

function drawItem(item) {
  ctx.save();
  const colors = { minigun:'#ef4444', grenade:'#f59e0b', heal:'#22c55e', shield:'#06b6d4' };
  ctx.fillStyle = colors[item.type] || '#fff';
  ctx.beginPath(); ctx.arc(item.x, item.y, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(ITEM_LABEL[item.type], item.x, item.y - 18);
  ctx.restore();
}

function drawCharacterParts(p, char) {
  const crouchOffset = p.crouch ? 14 : 0;
  const bodyH = p.crouch ? 26 : 34;
  const headY = p.crouch ? -18 : -32;

  if (p.invincibleTimer > 0) {
    ctx.fillStyle = 'rgba(34,211,238,.18)';
    ctx.beginPath(); ctx.arc(0, 8, 38, 0, Math.PI*2); ctx.fill();
  }

  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(-20, 52, 40, 8);

  ctx.fillStyle = char.shoe;
  ctx.fillRect(-14, 28 + crouchOffset, 10, 24 - crouchOffset);
  ctx.fillRect(4, 28 + crouchOffset, 10, 24 - crouchOffset);

  ctx.fillStyle = char.body;
  ctx.fillRect(-20, -4 + crouchOffset, 40, bodyH);

  ctx.fillStyle = 'rgba(255,255,255,.16)';
  ctx.fillRect(-20, 8 + crouchOffset, 40, 6);

  ctx.fillStyle = '#fde68a';
  ctx.fillRect(-16, headY, 32, 28);

  ctx.fillStyle = char.hat;
  ctx.fillRect(-18, headY - 8, 36, 8);
  ctx.fillRect(-10, headY - 16, 20, 8);

  ctx.fillStyle = '#111827';
  ctx.fillRect(-8, headY + 12, 4, 4);
  ctx.fillRect(4, headY + 12, 4, 4);

  ctx.fillStyle = char.arm;
  ctx.fillRect(-28, 0 + crouchOffset, 8, 24 - (p.crouch ? 8 : 0));
  ctx.fillRect(20, 0 + crouchOffset, 8, 24 - (p.crouch ? 8 : 0));
}

function drawAttackEffects(p, char) {
  if (p.action === 'slash') {
    const len = 30;
    ctx.fillStyle = char.weapon;
    if (p.facing > 0) ctx.fillRect(28, 6, len, 8);
    else ctx.fillRect(-28 - len, 6, len, 8);

    // swing arc
    const t = Math.max(0, p.actionFrame || 0);
    const a1 = p.facing > 0 ? -0.9 : 2.1;
    const a2 = p.facing > 0 ? 0.8 : 3.8;
    ctx.strokeStyle = 'rgba(255,255,255,.42)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(p.facing > 0 ? 20 : -20, 8, 28 + (12 - t), a1, a2);
    ctx.stroke();
  }
  if (p.guard) {
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (p.facing > 0) ctx.arc(16, 10, 20, -1.1, 1.1);
    else ctx.arc(-16, 10, 20, 2.04, 4.24);
    ctx.stroke();
  }
  if (p.action === 'ult') {
    ctx.fillStyle = 'rgba(236,72,153,.18)';
    if (p.facing > 0) ctx.fillRect(28, -30, 190, 110);
    else ctx.fillRect(-218, -30, 190, 110);
  }
}

function drawCharacterWeaponFlavor(p, char) {
  if (char.ranged === 'arrow') {
    ctx.strokeStyle = '#d1fae5';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(26, 4, 10, -1.2, 1.2); ctx.stroke();
  } else if (char.ranged === 'bullet') {
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(24, 2, 16, 6);
  } else {
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(24, 0, 18, 6);
  }
}

function drawBlockFighter(p) {
  const char = CHAR_DATA[p.character] || CHAR_DATA.blade;
  const x = p.drawX ?? p.x, y = p.drawY ?? p.y;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(p.drawScale || 1, p.drawScale || 1);

  drawCharacterParts(p, char);
  drawCharacterWeaponFlavor(p, char);
  drawAttackEffects(p, char);

  if (p.bloodTimer > 0) {
    ctx.fillStyle = 'rgba(239,68,68,.16)';
    ctx.fillRect(-34, -42, 68, 96);
    ctx.fillStyle = 'rgba(239,68,68,.42)';
    ctx.beginPath(); ctx.arc(0, 24, 18, 0, Math.PI*2); ctx.fill();
  }

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(p.name, 0, -54);

  ctx.restore();
}

function drawProjectile(pr) {
  ctx.save();
  ctx.fillStyle = pr.kind === 'grenade' ? '#f59e0b' : '#93c5fd';
  if (pr.kind === 'grenade') {
    ctx.beginPath(); ctx.arc(pr.x, pr.y, 10, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillRect(pr.x - 8, pr.y - 3, 16, 6);
  }
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawTheme();
  items.forEach(drawItem);
  projectiles.forEach(drawProjectile);
  players.forEach(drawBlockFighter);
  hitFx.forEach(h => {
    ctx.fillStyle = h.color;
    ctx.font = 'bold 22px sans-serif';
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
