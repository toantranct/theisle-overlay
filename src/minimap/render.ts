// Circular minimap renderer — full port of MinimapWindow.paintEvent.
//
// The map NEVER rotates: north is always up, so the compass letters stay
// put. The player's heading is shown by the arrow and the readout pill.
// Drawn with one drawImage cropping the region around the player out of the
// preloaded bitmap (vulnona 975 px tier, or a downscaled islemaps decode).
// No repaint timers: draw only on new data.

export interface PoiDot {
  xCm: number;
  yCm: number;
  px: number; // px in the ACTIVE calibration's basemap space
  py: number;
  color: string;
  /** When set (animal species), drawn as this emoji instead of a dot. */
  glyph?: string;
}

export interface DinoBars {
  hp: { current: number | null; max: number | null };
  hunger: { current: number | null; max: number | null };
  thirst: { current: number | null; max: number | null };
  /** Only the token-mode JSON API provides this; null in cookie mode. */
  stamina: { current: number | null; max: number | null } | null;
  growthPct: number | null;
}

/** Must match DINO_PANEL_H in src-tauri/src/minimap.rs. */
export const PANEL_H = 80;
/** One extra stats row (stamina). Must match DINO_PANEL_ROW_H in minimap.rs. */
export const PANEL_ROW_H = 16;

/** Quest-panel geometry. Must match QUEST_HEADER_H / QUEST_ROW_H /
 * QUEST_PAD_H in src-tauri/src/minimap.rs. */
export const QUEST_HEADER_H = 18;
export const QUEST_ROW_H = 14;
export const QUEST_PAD_H = 8;

export interface QuestRow {
  text: string;
  /** Vietnamese translation from the backend; absent when untranslated. */
  textVi?: string | null;
  completed: boolean;
}

export interface MinimapState {
  /** Player position (cm + basemap px) and heading, or null before first sample. */
  position: { xCm: number; yCm: number; px: number; py: number; headingDeg: number | null } | null;
  /** Trail segments in basemap px. */
  trailPx: [number, number][][];
  /** Point POIs already filtered by layer visibility (not by distance). */
  pois: PoiDot[];
  /** Saved waypoints (cm + basemap px + user colour; glyph = icon pins). */
  waypoints: {
    xCm: number;
    yCm: number;
    px: number;
    py: number;
    color: string | null;
    glyph?: string;
  }[];
  /** Rim arrow target: the closest saved waypoint, or null. */
  nearestWaypoint: {
    bearingDeg: number;
    distanceM: number;
    color: string | null;
    glyph?: string;
  } | null;
  basemap: ImageBitmap | null;
  /** Fresh-water overlay; x/y/w/h in ACTIVE-calibration basemap px. */
  freshwater: { bitmap: ImageBitmap; x: number; y: number; w: number; h: number } | null;
  /** bitmap scale: bitmapWidth / active calibration's image_width_px. */
  miniScale: number;
  /** Basemap px per real metre (horizontal). */
  pxPerM: number;
  sizePx: number;
  radiusM: number;
  opacity: number;
  /** Trail lines on the disc — settings.minimap.show_trail (declutter). */
  showTrail: boolean;
  /** Waypoint dots + rim arrow — settings.minimap.show_waypoints. */
  showWaypoints: boolean;
  /** Fresh-water overlay visibility — settings.layers.freshwater. */
  showFreshwater: boolean;
  /** Extra height for the dino-stats strip; 0 = strip off. */
  panelH: number;
  dino: DinoBars | null;
  /** Extra height for the Prime-quests panel; 0 = panel off or no quests. */
  questsH: number;
  quests: QuestRow[];
  /** Quest text language: "vi" shows textVi (fallback English). */
  questLang: "vi" | "en";
  /** Localised strings: compass letters clockwise from north, hint, unknown. */
  compassLetters: [string, string, string, string];
  hintText: string;
  headingLabel: string; // "" when unknown -> shows headingUnknown
  headingUnknown: string;
}

const LABEL_MARGIN = 15;
const POI_MARGIN = 1.6; // filter wider than the view so dots don't pop in at the rim

const COLORS = {
  bg: "#11150e",
  text: "#eae6d6",
  textMuted: "#a3aa8c",
  accent: "#e8a33d",
  // Electric yellow + double outline (dark under, white over): the
  // self-marker must never be confused with POI dots or the softer trail.
  playerArrow: "#ffe600",
  playerArrowOutline: "#10130c",
  playerHalo: "rgba(255, 230, 0, 0.20)",
  trail: "#ffcc55",
  waypoint: "#4fc3f7", // matches theme.ts COLORS.waypoint
};

export function render(canvas: HTMLCanvasElement, state: MinimapState): void {
  const size = state.sizePx;
  const totalH = size + state.panelH + state.questsH;
  const dpr = window.devicePixelRatio || 1;
  if (
    canvas.width !== Math.round(size * dpr) ||
    canvas.height !== Math.round(totalH * dpr)
  ) {
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(totalH * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${totalH}px`;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, totalH);

  if (state.panelH > 0) {
    drawDinoPanel(ctx, state, size);
  }
  if (state.questsH > 0) {
    drawQuestPanel(ctx, state, size);
  }

  const c = size / 2;
  const radius = size / 2 - LABEL_MARGIN;

  if (!state.position) {
    // No position yet: a dim disc so the hint text is readable.
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(17, 21, 14, 0.88)";
    ctx.fill();
    drawHint(ctx, c, radius, state.hintText);
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.clip();
  drawMap(ctx, state, c, radius);
  ctx.restore();

  drawCompass(ctx, state, c, radius);
  drawWaypointArrow(ctx, state, c, radius);
  drawHeadingPill(ctx, state, c, radius);
  // Player marker LAST and always fully opaque: however faded the map is,
  // you must still see where you are or the whole map is pointless.
  drawPlayer(ctx, state, c);
}

function drawMap(
  ctx: CanvasRenderingContext2D,
  state: MinimapState,
  c: number,
  radius: number,
): void {
  const pos = state.position!;
  const sceneR = state.radiusM * state.pxPerM; // view radius in basemap px
  const side = radius * 2;
  const ox = c - radius;
  const oy = c - radius;

  if (state.basemap) {
    const s = state.miniScale;
    ctx.globalAlpha = state.opacity;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      state.basemap,
      (pos.px - sceneR) * s,
      (pos.py - sceneR) * s,
      sceneR * 2 * s,
      sceneR * 2 * s,
      ox,
      oy,
      side,
      side,
    );
    ctx.globalAlpha = 1;
  }

  const toWidget = (sx: number, sy: number): [number, number] => [
    ox + ((sx - (pos.px - sceneR)) / (sceneR * 2)) * side,
    oy + ((sy - (pos.py - sceneR)) / (sceneR * 2)) * side,
  ];

  // Fresh-water overlay: stretched over its px bounds, over the basemap and
  // under the trail/POIs. The disc clip is already active.
  if (state.showFreshwater && state.freshwater) {
    const fw = state.freshwater;
    const [dx1, dy1] = toWidget(fw.x, fw.y);
    const [dx2, dy2] = toWidget(fw.x + fw.w, fw.y + fw.h);
    ctx.globalAlpha = state.opacity;
    ctx.drawImage(fw.bitmap, dx1, dy1, dx2 - dx1, dy2 - dy1);
    ctx.globalAlpha = 1;
  }

  // Trail.
  ctx.strokeStyle = COLORS.trail;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  for (const seg of state.showTrail ? state.trailPx : []) {
    if (seg.length < 2) continue;
    ctx.beginPath();
    const [x0, y0] = toWidget(seg[0][0], seg[0][1]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < seg.length; i++) {
      const [x, y] = toWidget(seg[i][0], seg[i][1]);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // POI dots, distance-filtered (in metres, straight from cm).
  const limitM = state.radiusM * POI_MARGIN;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.59)";
  ctx.lineWidth = 1;
  for (const poi of state.pois) {
    const distM = Math.hypot(poi.xCm - pos.xCm, poi.yCm - pos.yCm) / 100;
    if (distM > limitM) continue;
    const [x, y] = toWidget(poi.px, poi.py);
    if (poi.glyph) {
      // Species "logo" — colour emoji ignores fillStyle.
      ctx.font = "13px 'Segoe UI Emoji', 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(poi.glyph, x, y);
      continue;
    }
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = poi.color;
    ctx.fill();
    ctx.stroke();
  }

  // Waypoints: user colour + WHITE ring, so they never read as POI dots
  // (those carry a dark ring).
  if (state.showWaypoints) {
    for (const wp of state.waypoints) {
      const distM = Math.hypot(wp.xCm - pos.xCm, wp.yCm - pos.yCm) / 100;
      if (distM > limitM) continue;
      const [x, y] = toWidget(wp.px, wp.py);
      if (wp.glyph) {
        // Icon pins (💀 🏠 💧 …) draw as the icon itself.
        ctx.font = "14px 'Segoe UI Emoji', 'Segoe UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(wp.glyph, x, y);
        continue;
      }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = wp.color ?? COLORS.waypoint;
      ctx.fill();
      ctx.stroke();
    }
  }
}

/** Rim arrow + distance toward the closest waypoint OUTSIDE the view radius
 * (inside it, its dot is already visible). North is always up, so the screen
 * angle IS the compass bearing. */
export function drawWaypointArrow(
  ctx: CanvasRenderingContext2D,
  state: MinimapState,
  c: number,
  radius: number,
): void {
  const wp = state.nearestWaypoint;
  if (!state.showWaypoints || !wp || !state.position) return;
  if (wp.distanceM <= state.radiusM) return;
  const color = wp.color ?? COLORS.waypoint;
  const rad = ((wp.bearingDeg - 90) * Math.PI) / 180;
  const ax = c + (radius - 9) * Math.cos(rad);
  const ay = c + (radius - 9) * Math.sin(rad);

  ctx.save();
  ctx.globalAlpha = state.opacity;
  ctx.translate(ax, ay);
  ctx.rotate(rad + Math.PI / 2); // triangle drawn tip-up, rotate onto bearing
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(5, 4);
  ctx.lineTo(-5, 4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Distance label just inside the arrow, with the compass-letter shadow
  // trick. Icon pins prefix their icon: "💧 850 m" says what you're chasing.
  const distText =
    wp.distanceM >= 1000 ? `${(wp.distanceM / 1000).toFixed(1)} km` : `${Math.round(wp.distanceM)} m`;
  const dist = wp.glyph ? `${wp.glyph} ${distText}` : distText;
  const tx = c + (radius - 24) * Math.cos(rad);
  const ty = c + (radius - 24) * Math.sin(rad);
  ctx.font = "bold 10px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = state.opacity;
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillText(dist, tx + 1, ty + 1);
  ctx.fillStyle = color;
  ctx.fillText(dist, tx, ty);
  ctx.globalAlpha = 1;
}

function drawCompass(
  ctx: CanvasRenderingContext2D,
  state: MinimapState,
  c: number,
  radius: number,
): void {
  // Four letters around the disc. No ring, no ticks: each letter gets a
  // 1 px offset shadow instead — enough to separate it from bright terrain
  // without drawing any outline.
  ctx.font = "bold 13px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelR = radius + LABEL_MARGIN / 2 + 2;
  ctx.globalAlpha = state.opacity;
  const angles = [0, 90, 180, 270];
  for (let i = 0; i < 4; i++) {
    const rad = ((angles[i] - 90) * Math.PI) / 180;
    const x = c + labelR * Math.cos(rad);
    const y = c + labelR * Math.sin(rad);
    ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
    ctx.fillText(state.compassLetters[i], x + 1, y + 1);
    // North in the accent colour so a glance finds it.
    ctx.fillStyle = angles[i] === 0 ? COLORS.accent : COLORS.text;
    ctx.fillText(state.compassLetters[i], x, y);
  }
  ctx.globalAlpha = 1;
}

function drawPlayer(ctx: CanvasRenderingContext2D, state: MinimapState, c: number): void {
  const heading = state.position!.headingDeg;

  ctx.beginPath();
  ctx.arc(c, c, 13, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.playerHalo;
  ctx.fill();

  if (heading !== null) {
    // Compass bearing 0 = north = up; canvas rotate() is clockwise in
    // y-down coordinates, so the bearing maps 1:1. Dart shape (tip ahead,
    // notched tail) centred on the player.
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate((heading * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(9, 11);
    ctx.lineTo(0, 5);
    ctx.lineTo(-9, 11);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.strokeStyle = COLORS.playerArrowOutline;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.fillStyle = COLORS.playerArrow;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  } else {
    // Heading unknown: a plain disc implies no direction (the pill below
    // says why); same yellow + double outline keeps it unmistakably "you".
    ctx.beginPath();
    ctx.arc(c, c, 7, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.playerArrowOutline;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.fillStyle = COLORS.playerArrow;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawHeadingPill(
  ctx: CanvasRenderingContext2D,
  state: MinimapState,
  c: number,
  radius: number,
): void {
  const known = state.headingLabel !== "";
  const text = known ? state.headingLabel : state.headingUnknown;
  ctx.font = "600 12px 'Segoe UI', sans-serif";
  const w = ctx.measureText(text).width + 16;
  const h = 20;
  const x = c - w / 2;
  const y = c + radius * 0.52;

  ctx.globalAlpha = state.opacity;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.67)";
  ctx.fill();
  ctx.fillStyle = known ? COLORS.accent : COLORS.textMuted;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, c, y + h / 2 + 0.5);
  ctx.globalAlpha = 1;
}

/// Compact "your dino" strip below the disc: HP / hunger / thirst bars plus
/// growth. Drawn with the same opacity as the map so the whole widget reads
/// as one block; text keeps a dark shadow for readability.
function drawDinoPanel(ctx: CanvasRenderingContext2D, state: MinimapState, size: number): void {
  const top = size + 2;
  const h = state.panelH - 4;
  ctx.save();
  ctx.globalAlpha = Math.max(state.opacity, 0.55);

  // Backing card.
  ctx.beginPath();
  ctx.roundRect(4, top, size - 8, h, 8);
  ctx.fillStyle = "rgba(10, 13, 9, 0.78)";
  ctx.fill();

  const dino = state.dino;
  const rows: Array<{ label: string; cur: number | null; max: number | null; color: string }> =
    dino
      ? [
          {
            label: "HP",
            cur: dino.hp.current,
            max: dino.hp.max,
            color:
              dino.hp.current !== null && dino.hp.max
                ? dino.hp.current / dino.hp.max > 0.5
                  ? "#72d653"
                  : dino.hp.current / dino.hp.max > 0.25
                    ? "#e8a33d"
                    : "#e2664a"
                : "#72d653",
          },
          { label: "\u{1F356}", cur: dino.hunger.current, max: dino.hunger.max, color: "#e8a33d" },
          { label: "\u{1F4A7}", cur: dino.thirst.current, max: dino.thirst.max, color: "#4aa8d8" },
          // Stamina (token mode only) — the window is one row taller then.
          ...(dino.stamina
            ? [
                {
                  label: "\u{26A1}",
                  cur: dino.stamina.current,
                  max: dino.stamina.max,
                  color: "#a78bfa",
                },
              ]
            : []),
        ]
      : [];

  ctx.font = "600 10px 'Segoe UI', sans-serif";
  ctx.textBaseline = "middle";

  if (!dino) {
    ctx.fillStyle = COLORS.textMuted;
    ctx.textAlign = "center";
    ctx.fillText("…", size / 2, top + h / 2);
    ctx.restore();
    return;
  }

  const rowH = 16;
  const barX = 30;
  // Right padding sized for "999/999 (100%)" so the wider readout never
  // crashes into the bar's right edge (was 44, sized only for "999/999").
  const barW = size - 8 - barX - 84;
  rows.forEach((row, i) => {
    const y = top + 6 + i * rowH + rowH / 2;
    ctx.textAlign = "left";
    ctx.fillStyle = COLORS.text;
    ctx.fillText(row.label, 10, y);

    ctx.beginPath();
    ctx.roundRect(barX, y - 3.5, barW, 7, 3.5);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();
    if (row.cur !== null && row.max) {
      const frac = Math.max(0, Math.min(1, row.cur / row.max));
      if (frac > 0) {
        ctx.beginPath();
        ctx.roundRect(barX, y - 3.5, Math.max(barW * frac, 3), 7, 3.5);
        ctx.fillStyle = row.color;
        ctx.fill();
      }
    }

    ctx.textAlign = "right";
    ctx.fillStyle = COLORS.text;
    // "75/100 (75%)" - the parenthetical is the remaining percentage (the
    // same number the bar visually fills to), so a glance confirms the bar
    // without reading two scales. Use the same truthy guard as the bar
    // branch above so a max of 0 (e.g. uninitialised stamina) renders the
    // em-dash placeholder instead of "0/0 (NaN%)".
    if (row.cur !== null && row.max) {
      const pct = Math.round((row.cur / row.max) * 100);
      ctx.fillText(`${Math.round(row.cur)}/${Math.round(row.max)} (${pct}%)`, size - 12, y);
    } else {
      ctx.fillText("—", size - 12, y);
    }
  });

  // Growth line.
  const gy = top + 6 + rows.length * rowH + 6;
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.accent;
  ctx.fillText(
    dino.growthPct !== null ? `Growth ${Math.round(dino.growthPct)}%` : "Growth —",
    10,
    gy,
  );
  ctx.restore();
}

/// Prime-quests card under the stats strip (or directly under the disc when
/// the strip is off). Same backing-card language as drawDinoPanel; one line
/// per quest, ellipsised — 10 rows must stay glanceable, not a wall of text.
function drawQuestPanel(ctx: CanvasRenderingContext2D, state: MinimapState, size: number): void {
  const top = size + state.panelH + 2;
  const h = state.questsH - 4;
  ctx.save();
  ctx.globalAlpha = Math.max(state.opacity, 0.55);

  ctx.beginPath();
  ctx.roundRect(4, top, size - 8, h, 8);
  ctx.fillStyle = "rgba(10, 13, 9, 0.78)";
  ctx.fill();

  const done = state.quests.filter((q) => q.completed).length;
  ctx.font = "600 10px 'Segoe UI', sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = COLORS.accent;
  ctx.fillText(`Prime ${done}/${state.quests.length}`, 10, top + 4 + QUEST_HEADER_H / 2);

  const maxW = size - 8 - 24 - 8; // card minus glyph column minus right pad
  state.quests.forEach((quest, i) => {
    const y = top + 4 + QUEST_HEADER_H + i * QUEST_ROW_H + QUEST_ROW_H / 2;
    ctx.font = "10px 'Segoe UI', sans-serif";
    ctx.fillStyle = quest.completed ? "#72d653" : COLORS.textMuted;
    ctx.fillText(quest.completed ? "✓" : "○", 10, y);
    const text = state.questLang === "vi" ? (quest.textVi ?? quest.text) : quest.text;
    ctx.fillStyle = quest.completed ? "#72d653" : COLORS.text;
    ctx.fillText(truncate(ctx, text, maxW), 24, y);
  });
  ctx.restore();
}

/** Single-line ellipsis via measureText — canvas has no text-overflow. */
function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) {
    t = t.slice(0, -1);
  }
  return `${t.trimEnd()}…`;
}

function drawHint(
  ctx: CanvasRenderingContext2D,
  c: number,
  radius: number,
  hint: string,
): void {
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = "12px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Simple greedy word wrap inside the disc.
  const maxWidth = radius * 2 - 44;
  const words = hint.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word;
    if (ctx.measureText(probe).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = probe;
    }
  }
  if (line) lines.push(line);
  const lineH = 16;
  const y0 = c - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, c, y0 + i * lineH));
}
