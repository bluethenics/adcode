// Snake: arrow keys to steer, R or the button to restart.
// Until you press a key it plays itself, so the page is never still.
const board = document.getElementById("board");
const ctx = board.getContext("2d");
const SIZE = 18;
const CELL = board.width / SIZE;
const KEYS = { ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 } };
let snake, dir, food, score, autopilot = true;
let best = Number(localStorage.getItem("snake-best") ?? 0);

function reset() {
  snake = [{ x: 7, y: 9 }, { x: 6, y: 9 }, { x: 5, y: 9 }, { x: 4, y: 9 }];
  dir = { x: 1, y: 0 };
  score = 0;
  placeFood();
  draw();
}

function placeFood() {
  do food = { x: Math.floor(Math.random() * SIZE), y: Math.floor(Math.random() * SIZE) };
  while (snake.some((part) => part.x === food.x && part.y === food.y));
}

const hits = (cell) => cell.x < 0 || cell.y < 0 || cell.x >= SIZE || cell.y >= SIZE
  || snake.some((part) => part.x === cell.x && part.y === cell.y);

function steer() {
  // Head for the food, never turn back, never turn into itself.
  const head = snake[0];
  const away = (d) => Math.abs(head.x + d.x - food.x) + Math.abs(head.y + d.y - food.y);
  const safe = Object.values(KEYS)
    .filter((d) => d.x !== -dir.x || d.y !== -dir.y)
    .filter((d) => !hits({ x: head.x + d.x, y: head.y + d.y }))
    .sort((a, b) => away(a) - away(b));
  if (safe[0]) dir = safe[0];
}

function tick() {
  if (autopilot) steer();
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  if (hits(head)) return reset();
  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) {
    score += 1;
    best = Math.max(best, score);
    localStorage.setItem("snake-best", String(best));
    placeFood();
  } else {
    snake.pop();
  }
  draw();
}

function draw() {
  ctx.clearRect(0, 0, board.width, board.height);
  ctx.fillStyle = "#f2c94c";
  ctx.beginPath();
  ctx.arc((food.x + 0.5) * CELL, (food.y + 0.5) * CELL, CELL / 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#5bd67e";
  for (const part of snake) {
    ctx.beginPath();
    ctx.roundRect(part.x * CELL + 2, part.y * CELL + 2, CELL - 4, CELL - 4, 5);
    ctx.fill();
  }
  document.getElementById("score").textContent = score;
  document.getElementById("best").textContent = best;
}

addEventListener("keydown", (event) => {
  if (event.key === "r" || event.key === "R") return reset();
  const next = KEYS[event.key];
  if (!next || (next.x === -dir.x && next.y === -dir.y)) return;
  autopilot = false;
  dir = next;
});
document.getElementById("restart").addEventListener("click", reset);

reset();
setInterval(tick, 110);
