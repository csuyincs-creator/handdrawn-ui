/**
 * 手绘渲染器 —— 零依赖
 *
 * 核心三步：采样 → 抖动 → 画两遍。
 * 详细说明见 README.md。
 */

const NS = "http://www.w3.org/2000/svg";

/* ══════════════════════════════════════════════════════════════
   自己的手绘渲染器 —— 全部代码就在这里，没有依赖
   ══════════════════════════════════════════════════════════════ */

/** 固定种子的伪随机数：同一个种子永远给出同一串数 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把两点之间的线拆成等距的点 */
function sampleLine(x1, y1, x2, y2, step = 8) {
  const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
  return Array.from({ length: n + 1 }, (_, i) =>
    [x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n]);
}

/** 椭圆上的点 —— 圆、圆角、圈选都靠它 */
function ellipsePoints(cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, n = 24) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
}

/** 圆角矩形的轮廓点 */
function roundRectPoints(x, y, w, h, r = 8) {
  r = Math.min(r, w / 2, h / 2);
  const arc = (cx, cy, a0, a1) => ellipsePoints(cx, cy, r, r, a0, a1, 4);
  return [
    ...sampleLine(x + r, y, x + w - r, y),
    ...arc(x + w - r, y + r, -Math.PI / 2, 0),
    ...sampleLine(x + w, y + r, x + w, y + h - r),
    ...arc(x + w - r, y + h - r, 0, Math.PI / 2),
    ...sampleLine(x + w - r, y + h, x + r, y + h),
    ...arc(x + r, y + h - r, Math.PI / 2, Math.PI),
    ...sampleLine(x, y + h - r, x, y + r),
    ...arc(x + r, y + r, Math.PI, Math.PI * 1.5),
  ];
}

/** 勾选标记的点 */
function checkPoints(x, y, w, h) {
  return [
    ...sampleLine(x, y + h * 0.6, x + w * 0.35, y + h, 4),
    ...sampleLine(x + w * 0.35, y + h, x + w, y, 4),
  ];
}

/** 来回涂抹填充 */
function scribblePoints(x, y, w, h, gap = 6) {
  const pts = [];
  let flip = false;
  for (let t = gap; t < w + h; t += gap) {
    const a = [x + Math.max(0, t - h), y + Math.min(t, h)];
    const b = [x + Math.min(t, w), y + Math.max(0, t - w)];
    pts.push(...(flip ? [b, a] : [a, b]));
    flip = !flip;
  }
  return pts;
}

/** 抖动：每个点随机挪一点 —— 这一步把"机器线"变成"手画的" */
const jitter = (pts, rnd, amp) =>
  pts.map(([x, y]) => [x + (rnd() * 2 - 1) * amp, y + (rnd() * 2 - 1) * amp]);

/** 点数组 → SVG path 的 d 属性（用二次贝塞尔平滑，避免折线感） */
function toPath(pts, close = false) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [cx, cy] = pts[i];
    const mx = (cx + pts[i + 1][0]) / 2;
    const my = (cy + pts[i + 1][1]) / 2;
    d += `Q${cx.toFixed(1)} ${cy.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return d + `L${lx.toFixed(1)} ${ly.toFixed(1)}` + (close ? "Z" : "");
}

/* ────────────── 核心：一次画两遍 ────────────── */

const CFG = { rough: 1.5, step: 8, boil: 0.6 };

/** 生成一帧的 path —— rnd 决定抖动，amp 是幅度 */
function stroke(pts, rnd, amp = CFG.rough, close = true) {
  return toPath(jitter(pts, rnd, amp), close) +
         toPath(jitter(pts, rnd, amp * 1.4), close);
}

/** 生成"沸腾"用的三个版本（同一形状，三组不同抖动） */
function frames(pts, seed, close = true, amp = CFG.rough) {
  return [0, 1, 2].map((i) =>
    stroke(pts, mulberry32(seed + i * 7919), amp, close));
}

/* ────────────── 挂到真实元素上 ────────────── */

const NS = "http://www.w3.org/2000/svg";

/** 把一组 path 数据画进宿主元素的 SVG 覆层。
 *  同一宿主可以挂多层（比如实心按钮 = 涂抹层 + 外框层），
 *  用 layer 名字区分，各层独立重画。 */
function mount(host, shapeFn, opts = {}) {
  const { close = true, amp = CFG.rough, fill = false, layer = "sk-layer" } = opts;
  let seed = opts.seed ?? 1;                    // let：reseed() 要改它
  host.classList.add("sk");
  let svg = host.querySelector(`:scope > svg.${CSS.escape(layer)}`);
  if (!svg) {
    svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", layer);
    svg.setAttribute("aria-hidden", "true");
    host.prepend(svg);
  }
  const draw = () => {
    const w = host.offsetWidth || 120;
    const h = host.offsetHeight || 36;
    if (!w || !h) return;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.textContent = "";
    const pts = shapeFn(w, h);
    if (!pts || pts.length < 2) return;
    frames(pts, seed, close, amp).forEach((d, i) => {
      if (!d) return;
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      p.dataset.f = String(i);
      if (fill) p.setAttribute("class", "fill");
      svg.append(p);
    });
  };
  draw();
  // 尺寸变化就重画（比如 textarea 被拖拽缩放）
  new ResizeObserver(draw).observe(host);
  return {
    redraw: draw,
    reseed(s) { seed = s; draw(); },
  };
}

/* ────────────── 形状定义 ────────────── */

const INSET = 2;
const shape = {
  /** 外框 */
  rect: (w, h) => roundRectPoints(INSET, INSET, w - INSET * 2, h - INSET * 2, 8),
  /** 胶囊形（开关、滑块） */
  pill: (w, h) => roundRectPoints(INSET, INSET, w - INSET * 2, h - INSET * 2, (h - INSET * 2) / 2),
  /** 圆/椭圆 */
  circle: (w, h) => ellipsePoints(w / 2, h / 2, w / 2 - INSET, h / 2 - INSET, 0, Math.PI * 2, 28),
  /** 勾 */
  check: (w, h) => checkPoints(w * 0.24, h * 0.18, w * 0.54, h * 0.56),
  /** 涂抹块 */
  scribble: (w, h) => scribblePoints(INSET + 1, INSET + 1, w - INSET * 2 - 2, h - INSET * 2 - 2),
  /** 下划线（画在文字下方） */
  underline: (w, h) => [[0, h + 2], [w, h + 2]],
  /** 圈选（比文字大一圈） */
  lasso: (w, h) => ellipsePoints(w / 2, h / 2, w / 2 + 5, h / 2 + 5, -Math.PI * 0.15, Math.PI * 2 - Math.PI * 0.15, 30),
};

export { mulberry32, sampleLine, ellipsePoints, roundRectPoints, checkPoints,
         scribblePoints, jitter, toPath, stroke, frames, mount, CFG, shape };
