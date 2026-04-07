const statusEl = document.getElementById('status');
const roomBox = document.getElementById('roomBox');
const potText = document.getElementById('potText');
const streetText = document.getElementById('streetText');
const seatsEl = document.getElementById('seats');
const communityEl = document.getElementById('community');
const selfHandEl = document.getElementById('selfHand');
const selfResultEl = document.getElementById('selfResult');
const winnerBox = document.getElementById('winnerBox');
const messageBox = document.getElementById('messageBox');
const actionFeedEl = document.getElementById('actionFeed');
const bottomTurnEl = document.getElementById('bottomTurn');
const raiseDropdown = document.getElementById('raiseDropdown');
const raiseInput = document.getElementById('raiseInput');
const lobbyPanel = document.getElementById('lobbyPanel');
const chatFeedEl = document.getElementById('chatFeed');
const chatInput = document.getElementById('chatInput');

const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');

let ws = null;
let playerId = null;
let state = null;

function displayCard(card) {
  if (!card) return '';
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  return (rank === 'T' ? '10' : rank) + suit;
}
function cardClass(card, highlighted=false) {
  const suit = card.slice(-1);
  let cls = 'card';
  if (suit === '♥' || suit === '♦') cls += ' red';
  if (highlighted) cls += ' highlight';
  return cls;
}
function cardHtml(card, highlighted=false) {
  return `<div class="${cardClass(card, highlighted)}">${displayCard(card)}</div>`;
}
function renderPlayerShowdown(p) {
  if (!p.showdownName || !p.visibleCards || p.visibleCards.length === 0) return '';
  const hiSet = new Set((p.highlightCards || []).map(c => c));
  return `<div class="showdown-line"><div>${p.showdownName}</div><div class="small-cards">${p.visibleCards.map(c => cardHtml(c, hiSet.has(c))).join('')}</div></div>`;
}
function render() {
  if (!state) return;
  roomBox.textContent = `房间号：${state.roomId || '未进入'}`;
  potText.textContent = state.pot;
  streetText.textContent = state.street.toUpperCase();
  bottomTurnEl.textContent = state.turnPlayerId === playerId ? '轮到你了' : (state.turnPlayerId ? '还没到你' : '等待下一局');
  messageBox.textContent = state.message || '等待操作';
  winnerBox.textContent = state.winnerText || '';
  actionFeedEl.textContent = (state.actionFeed || []).join(' ｜ ');
  chatFeedEl.textContent = (state.chats || []).join('\n');

  if (state.phase === 'playing' || state.roomId) lobbyPanel.classList.add('hidden-panel');
  else lobbyPanel.classList.remove('hidden-panel');

  communityEl.innerHTML = (state.community || []).map(c => cardHtml(c)).join('');
  const selfHi = new Set();
  const me = (state.players || []).find(p => p.id === playerId);
  (me?.highlightCards || []).forEach(c => selfHi.add(c));
  selfHandEl.innerHTML = (state.selfHand || []).map(c => cardHtml(c, selfHi.has(c))).join('');
  selfResultEl.textContent = state.selfResult || '';

  seatsEl.innerHTML = (state.players || []).map((p) => `
    <div class="seat ${p.id===state.turnPlayerId?'turn':''} ${p.folded?'folded':''} ${p.ready?'ready':''}">
      <div class="name">${p.name}<span class="chips-badge">${p.chips}</span></div>
      <div class="meta">本轮下注：${p.bet}<br>${p.isDealer?'庄家 ':''}${p.folded?'已弃牌':(p.inHand?'在局中':'待命')}<br>${p.actionText || ''}</div>
      ${renderPlayerShowdown(p)}
    </div>
  `).join('');
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
  ws.send(JSON.stringify({ type: 'create_room', name: nameInput.value || '玩家1' }));
};
document.getElementById('joinBtn').onclick = () => {
  if (ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'join_room', roomId: roomInput.value.toUpperCase(), name: nameInput.value || '玩家' }));
};
document.getElementById('readyBtn').onclick = () => ws?.readyState===1 && ws.send(JSON.stringify({ type: 'toggle_ready' }));
document.getElementById('startBtn').onclick = () => ws?.readyState===1 && ws.send(JSON.stringify({ type: 'start_hand' }));
document.getElementById('foldBtn').onclick = () => ws?.readyState===1 && ws.send(JSON.stringify({ type: 'fold' }));
document.getElementById('checkBtn').onclick = () => {
  if (ws?.readyState!==1 || !state) return;
  const me = (state.players || []).find(p => p.id === playerId);
  if (me && me.bet === state.currentBet) ws.send(JSON.stringify({ type: 'call' }));
};
document.getElementById('callBtn').onclick = () => ws?.readyState===1 && ws.send(JSON.stringify({ type: 'call' }));
document.getElementById('raiseMenuBtn').onclick = () => raiseDropdown.classList.toggle('open');
document.getElementById('raiseBtn').onclick = () => {
  if (ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'raise', amount: Number(raiseInput.value || 1) }));
};
document.querySelectorAll('.quick-bet').forEach(btn => {
  btn.onclick = () => { raiseInput.value = String(Number(btn.dataset.amt || 1)); };
});
document.getElementById('chatBtn').onclick = () => {
  const text = (chatInput.value || '').trim();
  if (!text || ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'chat', text }));
  chatInput.value = '';
};
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('chatBtn').click();
});
