const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="run-token"]').content;
const ctx = $('board').getContext('2d');
const colors = [
  '#0a1016',
  '#e46379',
  '#edaa66',
  '#e9cf72',
  '#75c994',
  '#71cbe1',
  '#7591e5',
  '#b68be2',
];
const text = (id, value) => {
  $(id).textContent = value;
};
let busy = false;
async function command(path, body = {}) {
  busy = true;
  try {
    const response = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Run-Token': token },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
  } catch (error) {
    text('message', error.message);
  } finally {
    busy = false;
    await refresh();
  }
}
$('start').onclick = () => command('start', { policy: $('policy').value, mode: $('mode').value });
$('step').onclick = () =>
  command('start', { policy: $('policy').value, mode: $('mode').value, step: true });
$('stop').onclick = () => command('stop');
$('close').onclick = () => command('close');
const phases = {
  idle: '대기',
  observing: '상태 확인',
  requesting: '선택 중',
  executing: '실행 중',
  stopped: '중단',
  finished: '종료',
  error: '확인 필요',
};
function draw(state, activeCells = []) {
  ctx.clearRect(0, 0, 300, 600);
  const board = state?.snapshot?.board;
  for (let y = 0; y < 20; y++)
    for (let x = 0; x < 10; x++) {
      ctx.fillStyle = colors[board?.[y]?.[x] || 0];
      ctx.fillRect(x * 30 + 1, y * 30 + 1, 28, 28);
      ctx.strokeStyle = '#192530';
      ctx.strokeRect(x * 30 + 0.5, y * 30 + 0.5, 30, 30);
    }
  if (state?.snapshot?.phase === 'active') {
    ctx.fillStyle = '#9ce3c2';
    ctx.globalAlpha = 0.65;
    for (const [x, y] of activeCells) if (y >= 0) ctx.fillRect(x * 30 + 2, y * 30 + 2, 26, 26);
    ctx.globalAlpha = 1;
  }
  const selected = state?.candidates.find((c) => c.id === state.decision?.choice);
  if (selected && ['requesting', 'executing'].includes(state.phase)) {
    ctx.strokeStyle = '#c6ffe5';
    ctx.lineWidth = 2;
    for (const [x, y] of selected.cells) if (y >= 0) ctx.strokeRect(x * 30 + 3, y * 30 + 3, 24, 24);
    ctx.lineWidth = 1;
  }
}
async function refresh() {
  try {
    const response = await fetch('/api/state');
    const data = await response.json();
    const s = data.state;
    document.querySelector('option[value="jev"]').disabled = !data.readyForJev;
    document.querySelector('option[value="jev"]').textContent = data.readyForJev
      ? 'Jev · AI 선택'
      : 'Jev · API 키 필요';
    for (const id of ['start', 'step', 'policy', 'mode'])
      $(id).disabled = busy || data.opening || data.running;
    $('stop').disabled = !data.opening && !data.running;
    const reasons = {
      STEP_COMPLETE: '한 수를 실행하고 착지를 확인했습니다.',
      SPRINT_COMPLETE: '40줄 스프린트를 완료했습니다.',
      GAME_ENDED: '게임이 종료됐습니다.',
      STOPPED_BY_USER: '봇 입력을 중단했습니다.',
      COST_LIMIT: '설정한 비용 한도에 도달했습니다.',
      DECISION_LIMIT: '설정한 선택 횟수에 도달했습니다.',
      GAME_FOCUS_LOST: '게임 창의 포커스가 바뀌어 멈췄습니다.',
    };
    text('badge', data.opening ? '연결 중' : phases[s?.phase] || '준비');
    text(
      'message',
      s?.reason
        ? `${data.message} ${reasons[s.reason] || '게임 또는 연결 상태가 달라져 입력을 멈췄습니다. 실행 기록을 확인해 주세요.'}`
        : data.message,
    );
    text('lines', `${s?.snapshot?.lines || 0} / 40`);
    text('locks', s?.verifiedLocks || 0);
    text('latency', s?.decision ? `${Math.round(s.decision.latencyMs)} ms` : '—');
    text('cost', `$${(s?.estimatedCost || 0).toFixed(4)}`);
    text(
      'piece',
      s?.snapshot?.active
        ? `현재 ${s.snapshot.active.kind} · 다음 ${s.snapshot.next.join(' ')}`
        : '—',
    );
    text('model', s?.decision?.model || (data.readyForJev ? data.model : 'API 키 미설정'));
    text('choice', s?.decision ? `${s.decision.choice} 선택` : '아직 선택하지 않았습니다.');
    const probability = s?.decision?.probabilities?.[s.decision.choice];
    text(
      'confidence',
      probability != null
        ? `선택 확률 ${(probability * 100).toFixed(1)}% · confidence ${s.decision.confidence.toFixed(3)} · 완주 확률이 아닙니다.`
        : '로컬 모드에는 모델의 확률과 confidence가 없습니다.',
    );
    if (data.logFile) text('log', data.logFile);
    if (s)
      text(
        'tokens',
        `입력 ${s.inputTokens.toLocaleString()} · 출력 ${s.outputTokens.toLocaleString()} 토큰 · 사용량 미확인 ${s.usageUnknown}회`,
      );
    const tbody = $('candidates');
    tbody.replaceChildren();
    for (const candidate of s?.candidates || []) {
      const row = document.createElement('tr');
      if (candidate.id === s.decision?.choice) row.className = 'selected';
      const p = s.decision?.probabilities?.[candidate.id];
      for (const value of [
        candidate.id,
        candidate.features.clearedLines,
        candidate.features.holesAfter,
        candidate.features.maxHeightAfter,
        p != null ? `${(p * 100).toFixed(1)}%` : '—',
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      tbody.append(row);
    }
    draw(s, data.activeCells);
  } catch {
    text('badge', '서버 연결 끊김');
  }
}
draw(null);
await refresh();
setInterval(refresh, 400);
