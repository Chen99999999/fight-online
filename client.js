const statusEl = document.getElementById('status');
const roomBox = document.getElementById('roomBox');
const overlayMsg = document.getElementById('overlayMsg');
const ultOverlay = document.getElementById('ultOverlay');
const ultText = document.getElementById('ultText');
const comboInfo = document.getElementById('comboInfo');
const leftHp = document.getElementById('leftHp');
const rightHp = document.getElementById('rightHp');
const leftHpText = document.getElementById('leftHpText');
const rightHpText = document.getElementById('rightHpText');
const leftName = document.getElementById('leftName');
const rightName = document.getElementById('rightName');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const charSelect = document.getElementById('charSelect');

let ws = null;
let playerId = null;
let roomId = null;
let players = [];
let keys = { left:false, right:false, up:false, down:false, light:false, heavy:false, skill:false, ult:false };
let localState = { x:180, y:308, hp:100, facing:1, action:'idle', character:'blaze' };
let attackCooldown = 0;
let lastSend = 0;
let comboCount = 0;
let comboTimer = 0;
let hitFx = [];

const CHAR_DATA = {
  blaze: { body:'#f97316', arm:'#fdba74', weapon:'#fb7185', ult:'烈焰破天', speed:4.2 },
  frost: { body:'#60a5fa', arm:'#bfdbfe', weapon:'#93c5fd', ult:'寒霜禁域', speed:4.0 },
  shadow: { body:'#a855f7', arm:'#e9d5ff', weapon:'#c084fc', ult:'暗影裂幕', speed:4.5 }
};

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => statusEl.textContent = '已连接服务器';
  ws.onclose = () => statusEl.textContent = '连接断开，刷新重试';
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'hello') {
      playerId = msg.playerId;
    } else if (msg.type === 'error_msg') {
      showMsg(msg.text);
    } else if (msg.type === 'room_state') {
      roomId = msg.roomId;
      players = (msg.players || []).map(p => ({ ...p, drawX:p.x, drawY:p.y }));
      const me = players.find(p => p.id === playerId);
      if (me) {
        localState.x = me.x; localState.y = me.y; localState.hp = me.hp; localState.facing = me.facing;
      }
      roomBox.textContent = `房间号：${roomId || '未进入'} ${msg.msg ? '｜' + msg.msg : ''}`;
      syncHud();
      if (players.length === 2) showMsg('人齐了，狠狠干');
    } else if (msg.type === 'state_update') {
      const incoming = msg.players || [];
      incoming.forEach(p => {
        const existing = players.find(x => x.id === p.id);
        if (existing) Object.assign(existing, p);
        else players.push({ ...p, drawX:p.x, drawY:p.y });
      });
      players.forEach(p => {
        if (p.drawX == null) p.drawX = p.x;
        if (p.drawY == null) p.drawY = p.y;
      });
      syncHud();
    } else if (msg.type === 'hit_effect') {
      players = msg.players || players;
      const t = players.find(p => p.id === msg.targetId);
      if (t) {
        hitFx.push({ x:t.x, y:t.y, life:24, text:`-${msg.damage}`, color: msg.attackType === 'ult' ? '#f9a8d4' : '#fca5a5' });
      }
      if (msg.attackerId === playerId) {
        comboCount += 1;
        comboTimer = 90;
      }
      if (msg.attackType === 'ult') {
        const me = players.find(p => p.id === msg.attackerId);
        const char = me?.character || 'blaze';
        showUlt(CHAR_DATA[char]?.ult || '终极必杀');
      }
      syncHud();
    } else if (msg.type === 'match_over') {
      showMsg(`${msg.winnerName} 胜利`);
    }
  };
}

function syncHud() {
  const p1 = players.find(p => p.role === 'p1');
  const p2 = players.find(p => p.role === 'p2');
  if (p1) {
    leftName.textContent = `${p1.name}`;
    leftHp.style.width = `${p1.hp}%`;
    leftHpText.textContent = p1.hp;
  }
  if (p2) {
    rightName.textContent = `${p2.name}`;
    rightHp.style.width = `${p2.hp}%`;
    rightHpText.textContent = p2.hp;
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
  showUlt.t = setTimeout(() => ultOverlay.classList.add('hidden'), 700);
}

document.getElementById('createBtn').onclick = () => {
  if (!ws || ws.readyState !== 1) return;
  localState.character = charSelect.value;
  ws.send(JSON.stringify({ type: 'create_room', name: nameInput.value || '玩家1' }));
};
document.getElementById('joinBtn').onclick = () => {
  if (!ws || ws.readyState !== 1) return;
  localState.character = charSelect.value;
  ws.send(JSON.stringify({ type: 'join_room', roomId: roomInput.value.toUpperCase(), name: nameInput.value || '玩家2' }));
};
document.getElementById('resetBtn').onclick = () => {
  if (!ws || !roomId) return;
  comboCount = 0;
  ws.send(JSON.stringify({ type: 'reset_match' }));
};

function performAttack(kind) {
  if (attackCooldown > 0 || !roomId) return;
  const me = players.find(p => p.id === playerId);
  const other = players.find(p => p.id !== playerId);
  if (!me || !other) return;

  const char = CHAR_DATA[localState.character] || CHAR_DATA.blaze;
  let range = 75, damage = 8, cooldown = 12;
  if (kind === 'heavy') { range = 105; damage = 15; cooldown = 18; }
  if (kind === 'skill') { range = 135; damage = 20; cooldown = 24; }
  if (kind === 'ult') { range = 170; damage = 30; cooldown = 42; showUlt(char.ult); }

  localState.action = kind;
  attackCooldown = cooldown;

  const dx = other.x - me.x;
  const inRange = (me.facing > 0 && dx > 0 && dx < range) || (me.facing < 0 && dx < 0 && Math.abs(dx) < range);
  if (inRange) {
    ws.send(JSON.stringify({ type:'hit', targetId: other.id, damage, attackType: kind }));
  }
}

function update() {
  const char = CHAR_DATA[localState.character] || CHAR_DATA.blaze;
  const speed = char.speed;

  if (roomId) {
    if (keys.left) { localState.x -= speed; localState.facing = -1; if (attackCooldown <= 0) localState.action = 'run'; }
    if (keys.right) { localState.x += speed; localState.facing = 1; if (attackCooldown <= 0) localState.action = 'run'; }
    if (!keys.left && !keys.right && attackCooldown <= 0) localState.action = 'idle';

    localState.x = Math.max(50, Math.min(750, localState.x));

    if (keys.light) { performAttack('light'); keys.light = false; }
    if (keys.heavy) { performAttack('heavy'); keys.heavy = false; }
    if (keys.skill) { performAttack('skill'); keys.skill = false; }
    if (keys.ult) { performAttack('ult'); keys.ult = false; }

    const now = performance.now();
    if (ws && ws.readyState === 1 && now - lastSend > 66) {
      lastSend = now;
      ws.send(JSON.stringify({
        type:'input',
        x: localState.x,
        y: localState.y,
        hp: localState.hp,
        facing: localState.facing,
        action: localState.action,
        character: localState.character
      }));
    }
  }

  players.forEach(p => {
    if (p.id === playerId) {
      p.x = localState.x; p.y = localState.y; p.hp = localState.hp; p.facing = localState.facing; p.action = localState.action; p.character = localState.character;
      p.drawX = p.x; p.drawY = p.y;
    } else {
      p.drawX += (p.x - p.drawX) * 0.22;
      p.drawY += (p.y - p.drawY) * 0.22;
    }
  });

  if (attackCooldown > 0) attackCooldown--;
  if (comboTimer > 0) comboTimer--;
  else comboCount = 0;

  hitFx.forEach(h => h.life--);
  hitFx = hitFx.filter(h => h.life > 0);

  comboInfo.textContent = comboCount >= 2 ? `${comboCount} 连击` : 'READY';
}

function drawBlockFighter(p) {
  const char = CHAR_DATA[p.character] || CHAR_DATA.blaze;
  const x = p.drawX ?? p.x;
  const y = p.drawY ?? p.y;

  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(-20, 46, 40, 8);

  // legs
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(-14, 24, 10, 24);
  ctx.fillRect(4, 24, 10, 24);

  // body
  ctx.fillStyle = char.body;
  ctx.fillRect(-20, -8, 40, 34);

  // head (mc风)
  ctx.fillStyle = '#fde68a';
  ctx.fillRect(-16, -36, 32, 28);

  // eyes
  ctx.fillStyle = '#111827';
  ctx.fillRect(-8, -24, 4, 4);
  ctx.fillRect(4, -24, 4, 4);

  // arms
  ctx.fillStyle = char.arm;
  ctx.fillRect(-28, -4, 8, 24);
  ctx.fillRect(20, -4, 8, 24);

  // weapon / attack effect
  if (p.action === 'light' || p.action === 'heavy' || p.action === 'skill' || p.action === 'ult') {
    const len = p.action === 'ult' ? 58 : p.action === 'skill' ? 42 : p.action === 'heavy' ? 30 : 22;
    ctx.fillStyle = char.weapon;
    if (p.facing > 0) ctx.fillRect(28, 2, len, 8);
    else ctx.fillRect(-28 - len, 2, len, 8);

    if (p.action === 'ult') {
      ctx.fillStyle = 'rgba(236,72,153,.18)';
      if (p.facing > 0) ctx.fillRect(28, -18, 110, 54);
      else ctx.fillRect(-138, -18, 110, 54);
    }
  }

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${p.name}`, 0, -48);

  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // background
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#1e293b');
  g.addColorStop(1, '#111827');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // moon
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  ctx.fillRect(620, 50, 70, 70);

  // buildings
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.03 + i*0.01})`;
    ctx.fillRect(i * 120 + 20, 180 - i * 4, 60, 170 + i * 4);
  }

  // ground
  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 350, 800, 70);
  ctx.fillStyle = '#475569';
  for (let i = 0; i < 16; i++) {
    ctx.fillRect(i * 50, 350, 24, 10);
  }

  players.forEach(drawBlockFighter);

  hitFx.forEach(h => {
    ctx.fillStyle = h.color;
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(h.text, h.x, h.y - 60 + (24 - h.life));
  });
}

function loop() {
  update();
  render();
  requestAnimationFrame(loop);
}

function bindBtn(btn) {
  const key = btn.dataset.k;
  const down = (e) => { e.preventDefault(); keys[key] = true; btn.classList.add('active'); };
  const up = (e) => { e.preventDefault(); keys[key] = false; btn.classList.remove('active'); };
  btn.addEventListener('touchstart', down, { passive: false });
  btn.addEventListener('touchend', up, { passive: false });
  btn.addEventListener('touchcancel', up, { passive: false });
  btn.addEventListener('mousedown', down);
  btn.addEventListener('mouseup', up);
  btn.addEventListener('mouseleave', up);
}
document.querySelectorAll('[data-k]').forEach(bindBtn);

connect();
loop();
