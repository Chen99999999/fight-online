const statusEl = document.getElementById('status');
const roomBox = document.getElementById('roomBox');
const overlayMsg = document.getElementById('overlayMsg');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');

let ws = null;
let playerId = null;
let myRole = null;
let roomId = null;
let players = [];
let keys = { left:false, right:false, up:false, down:false, light:false, heavy:false, skill:false };
let localState = { x:180, y:310, hp:100, facing:1, action:'idle' };
let attackCooldown = 0;
let hitFx = [];

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
      players = msg.players || [];
      const me = players.find(p => p.id === playerId);
      if (me) {
        myRole = me.role;
        localState.x = me.x;
        localState.y = me.y;
        localState.hp = me.hp;
        localState.facing = me.facing;
        localState.action = me.action;
      }
      roomBox.textContent = `房间号：${roomId || '未进入'} ${msg.msg ? '｜'+msg.msg : ''}`;
      if (players.length === 2) showMsg('人齐了，狠狠干');
    } else if (msg.type === 'state_update') {
      players = msg.players || players;
      const me = players.find(p => p.id === playerId);
      if (me) localState.hp = me.hp;
    } else if (msg.type === 'hit_effect') {
      players = msg.players || players;
      const t = players.find(p => p.id === msg.targetId);
      if (t) {
        hitFx.push({ x: t.x, y: t.y, life: 18, text: `-${msg.damage}` });
      }
    } else if (msg.type === 'match_over') {
      showMsg(`${msg.winnerName} 胜利`);
    }
  };
}

function showMsg(text) {
  overlayMsg.textContent = text;
  overlayMsg.classList.remove('hidden');
  clearTimeout(showMsg.t);
  showMsg.t = setTimeout(() => overlayMsg.classList.add('hidden'), 1400);
}

document.getElementById('createBtn').onclick = () => {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'create_room', name: nameInput.value || '玩家1' }));
};
document.getElementById('joinBtn').onclick = () => {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'join_room', roomId: roomInput.value.toUpperCase(), name: nameInput.value || '玩家2' }));
};
document.getElementById('resetBtn').onclick = () => {
  if (!ws || !roomId) return;
  ws.send(JSON.stringify({ type: 'reset_match' }));
};

function sendState() {
  if (!ws || ws.readyState !== 1 || !roomId) return;
  ws.send(JSON.stringify({ type:'input', x: localState.x, y: localState.y, hp: localState.hp, facing: localState.facing, action: localState.action }));
}

function performAttack(kind) {
  if (attackCooldown > 0 || !roomId) return;
  const me = players.find(p => p.id === playerId);
  const other = players.find(p => p.id !== playerId);
  if (!me || !other) return;

  let range = 70, damage = 8;
  if (kind === 'heavy') { range = 95; damage = 14; }
  if (kind === 'skill') { range = 130; damage = 20; }
  localState.action = kind;
  attackCooldown = kind === 'light' ? 12 : kind === 'heavy' ? 18 : 26;

  const dx = other.x - me.x;
  if ((me.facing > 0 && dx > 0 && dx < range) || (me.facing < 0 && dx < 0 && Math.abs(dx) < range)) {
    ws.send(JSON.stringify({ type: 'hit', targetId: other.id, damage }));
  }
}

function update() {
  if (myRole && roomId) {
    if (keys.left) { localState.x -= 4.2; localState.facing = -1; localState.action = 'run'; }
    if (keys.right) { localState.x += 4.2; localState.facing = 1; localState.action = 'run'; }
    if (!keys.left && !keys.right && attackCooldown <= 0) localState.action = 'idle';
    localState.x = Math.max(40, Math.min(760, localState.x));

    if (keys.light) { performAttack('light'); keys.light = false; }
    if (keys.heavy) { performAttack('heavy'); keys.heavy = false; }
    if (keys.skill) { performAttack('skill'); keys.skill = false; }

    sendState();
  }
  if (attackCooldown > 0) attackCooldown--;
  hitFx.forEach(h => h.life--);
  hitFx = hitFx.filter(h => h.life > 0);
}

function drawPlayer(p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath();
  ctx.ellipse(0, 24, 22, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // legs
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-8, 34); ctx.lineTo(-10, 54);
  ctx.moveTo(8, 34); ctx.lineTo(10, 54);
  ctx.stroke();

  // body
  ctx.fillStyle = p.color || '#94a3b8';
  ctx.beginPath();
  ctx.roundRect(-18, -4, 36, 42, 10);
  ctx.fill();

  // head
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.arc(0, -18, 14, 0, Math.PI * 2);
  ctx.fill();

  // arms
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  let armY = 4;
  if (p.action === 'light') armY = -8;
  if (p.action === 'heavy') armY = -14;
  if (p.action === 'skill') armY = -20;
  ctx.moveTo(-16, 4); ctx.lineTo(-24, 18);
  ctx.moveTo(16, 4); ctx.lineTo(16 + p.facing * 18, armY);
  ctx.stroke();

  // name
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${p.name} ${p.hp}`, 0, -40);
  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#231942');
  g.addColorStop(0.55, '#1e293b');
  g.addColorStop(1, '#111827');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // moon
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.beginPath();
  ctx.arc(400, 90, 60, 0, Math.PI * 2);
  ctx.fill();

  // ground
  ctx.fillStyle = '#2e3448';
  ctx.fillRect(0, 350, 800, 70);
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 350);
  ctx.lineTo(800, 350);
  ctx.stroke();

  players.forEach(drawPlayer);

  hitFx.forEach(h => {
    ctx.fillStyle = '#fca5a5';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(h.text, h.x, h.y - 50 + (18 - h.life));
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

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'a') keys.left = true;
  if (k === 'd') keys.right = true;
  if (k === 'w') keys.up = true;
  if (k === 's') keys.down = true;
  if (k === 'j') keys.light = true;
  if (k === 'k') keys.heavy = true;
  if (k === 'l') keys.skill = true;
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'a') keys.left = false;
  if (k === 'd') keys.right = false;
  if (k === 'w') keys.up = false;
  if (k === 's') keys.down = false;
});

connect();
loop();
