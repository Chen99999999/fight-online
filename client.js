const statusEl = document.getElementById('status');
const roomBox = document.getElementById('roomBox');
const potText = document.getElementById('potText');
const streetText = document.getElementById('streetText');
const turnText = document.getElementById('turnText');
const seatsEl = document.getElementById('seats');
const communityEl = document.getElementById('community');
const selfHandEl = document.getElementById('selfHand');
const messageBox = document.getElementById('messageBox');

const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const raiseInput = document.getElementById('raiseInput');

let ws = null;
let playerId = null;
let state = null;

function cardHtml(card, back=false) {
  return `<div class="card ${back?'back':''}">${back?'♠':card}</div>`;
}
function seatStyle(idx) {
  const positions = [
    'left:50%;top:0;transform:translateX(-50%);',
    'right:0;top:70px;',
    'right:40px;bottom:40px;',
    'left:50%;bottom:0;transform:translateX(-50%);',
    'left:40px;bottom:40px;',
    'left:0;top:70px;'
  ];
  return positions[idx] || '';
}
function renderRaisePanel() {
  return `
    <div class="raise-panel">
      <div class="quick-bets">
        <button class="quick-bet" data-amt="1">1分</button>
        <button class="quick-bet" data-amt="5">5分</button>
        <button class="quick-bet" data-amt="10">10分</button>
        <button class="quick-bet" data-amt="50">50分</button>
      </div>
    </div>
  `;
}
function render() {
  if (!state) return;
  roomBox.textContent = `房间号：${state.roomId || '未进入'}`;
  potText.textContent = state.pot;
  streetText.textContent = state.street.toUpperCase();
  turnText.textContent = state.turnPlayerId === playerId ? '轮到你了' : (state.turnPlayerId ? '别急，还没到你' : '等待下一局');
  messageBox.textContent = state.message || '等待操作';

  communityEl.innerHTML = state.community.map(c => cardHtml(c)).join('');
  selfHandEl.innerHTML = (state.selfHand || []).map(c => cardHtml(c)).join('');

  seatsEl.innerHTML = state.players.map((p, i) => `
    <div class="seat ${p.id===state.turnPlayerId?'turn':''} ${p.folded?'folded':''} ${p.ready?'ready':''}" style="${seatStyle(i)}">
      <div class="name">${p.name}<span class="chips-badge">${p.chips}</span></div>
      <div class="meta">
        本轮下注：${p.bet}<br>
        ${p.isDealer?'庄家 ':''}${p.isSB?'SB ':''}${p.isBB?'BB ':''}<br>
        ${p.folded?'已弃牌':(p.inHand?'在局中':'待命')}
      </div>
    </div>
  `).join('');

  bindQuickBetButtons();
}
function bindQuickBetButtons() {
  document.querySelectorAll('.quick-bet').forEach(btn => {
    btn.onclick = () => {
      const amt = Number(btn.dataset.amt || 0);
      raiseInput.value = String(amt);
    };
  });
}
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => statusEl.textContent = '已连接服务器';
  ws.onclose = () => statusEl.textContent = '连接断开，刷新重试';
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'hello') playerId = msg.playerId;
    else if (msg.type === 'error_msg') messageBox.textContent = msg.text;
    else if (msg.type === 'room_state') { state = msg; render(); }
  };
}
connect();

document.getElementById('createBtn').onclick = () => {
  if (ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ type:'create_room', name:nameInput.value || '玩家1' }));
};
document.getElementById('joinBtn').onclick = () => {
  if (ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ type:'join_room', roomId:roomInput.value.toUpperCase(), name:nameInput.value || '玩家' }));
};
document.getElementById('readyBtn').onclick = () => ws?.readyState===1 && ws.send(JSON.stringify({ type:'toggle_ready' }));
document.getElementById('startBtn').onclick = () => ws?.readyState===1 && ws.send(JSON.stringify({ type:'start_hand' }));
document.getElementById('foldBtn').onclick = () => ws?.readyState===1 && ws.send(JSON.stringify({ type:'fold' }));
document.getElementById('callBtn').onclick = () => ws?.readyState===1 && ws.send(JSON.stringify({ type:'check_call' }));
document.getElementById('raiseBtn').onclick = () => ws?.readyState===1 && ws.send(JSON.stringify({ type:'bet_raise', amount:Number(raiseInput.value||40) }));

document.querySelector('.actions').insertAdjacentHTML('beforeend', renderRaisePanel());
bindQuickBetButtons();
