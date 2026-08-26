// Minimap overlay entry. Deliberately tiny: no Skeleton, no Leaflet, no
// framework — this webview runs beside the game for hours. Rendering is
// event-driven only (zero idle CPU: no rAF loop, no animations, no timers).

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { error } from "@tauri-apps/plugin-log";
import { installGlobalErrorLog } from "../lib/errlog";
import { ANIMAL_GLYPHS, waypointGlyph } from "../lib/theme";
import {
  PANEL_H,
  PANEL_ROW_H,
  QUEST_HEADER_H,
  QUEST_PAD_H,
  QUEST_ROW_H,
  render,
  type DinoBars,
  type MinimapState,
  type PoiDot,
  type QuestRow,
} from "./render";

installGlobalErrorLog("minimap");

// Local minimal types — this bundle stays free of the main window's modules.
interface PositionUpdate {
  xCm: number;
  yCm: number;
  px: number;
  py: number;
  headingDeg: number | null;
  compassKey: string | null;
}
interface PoiLayer {
  key: string;
  kind: string;
  items: { label: string; px: number; py: number; xCm: number; yCm: number }[];
}
type Settings = Record<string, any>;

const LAYER_COLORS: Record<string, string> = {
  water: "#4aa8d8",
  saltlick: "#d9a441",
  mudwallow: "#9c7b4f",
  sanctuary: "#a855f7",
  migration: "#72d653",
  food: "#e2664a",
  animal: "#d66ba0",
};

// Compass letters + strings per language (kept inline: no i18n bundle here).
const STRINGS = {
  vi: {
    letters: ["B", "Đ", "N", "T"] as [string, string, string, string],
    hint: "Trong game bấm Tab, rồi bấm “Asset Location” để chép tọa độ.",
    unknown: "Chưa rõ hướng",
    dirs: {
      "dir.N": "Bắc", "dir.NE": "Đông Bắc", "dir.E": "Đông", "dir.SE": "Đông Nam",
      "dir.S": "Nam", "dir.SW": "Tây Nam", "dir.W": "Tây", "dir.NW": "Tây Bắc",
    } as Record<string, string>,
  },
  en: {
    letters: ["N", "E", "S", "W"] as [string, string, string, string],
    hint: "In game press Tab, then click “Asset Location” to copy your coordinates.",
    unknown: "Heading unknown",
    dirs: {
      "dir.N": "N", "dir.NE": "NE", "dir.E": "E", "dir.SE": "SE",
      "dir.S": "S", "dir.SW": "SW", "dir.W": "W", "dir.NW": "NW",
    } as Record<string, string>,
  },
};

const canvas = document.getElementById("minimap") as HTMLCanvasElement;

let allPois: PoiDot[] = [];
let poiLayers: PoiLayer[] = [];
let settings: Settings = {};

const state: MinimapState = {
  position: null,
  trailPx: [],
  pois: [],
  waypoints: [],
  nearestWaypoint: null,
  basemap: null,
  freshwater: null,
  miniScale: 1,
  pxPerM: 0.7,
  sizePx: 260,
  radiusM: 600,
  opacity: 0.85,
  showTrail: true,
  showWaypoints: true,
  showFreshwater: true,
  panelH: 0,
  dino: null,
  questsH: 0,
  quests: [],
  questLang: "vi",
  compassLetters: STRINGS.vi.letters,
  hintText: STRINGS.vi.hint,
  headingLabel: "",
  headingUnknown: STRINGS.vi.unknown,
};

let lastHeadingKey: string | null = null;
let lastHeadingDeg: number | null = null;

function applySettings(s: Settings) {
  settings = s;
  const mm = s.minimap ?? {};
  state.sizePx = Number(mm.size_px ?? 260);
  // Zoom is a multiplier on the view radius: 2.0 = see half the area
  // (zoomed in), 0.5 = see double the area (zoomed out). The slider range
  // and the legacy zoom_in/zoom_out hotkeys both pivot on this number, so
  // clamping here keeps the render math safe from a stray 0.
  const baseRadius = Number(mm.radius_m ?? 600);
  const zoom = Math.max(0.25, Math.min(4, Number(mm.zoom ?? 1.0)));
  state.radiusM = baseRadius / zoom;
  state.opacity = Number(mm.opacity ?? 0.85);
  state.showTrail = Boolean(mm.show_trail ?? true);
  state.showWaypoints = Boolean(mm.show_waypoints ?? true);
  state.showFreshwater = Boolean((s.layers ?? {}).freshwater ?? true);
  recomputePanelH();
  const lang = (s.language === "en" ? "en" : "vi") as keyof typeof STRINGS;
  state.questLang = lang;
  recomputeQuestsH();
  state.compassLetters = STRINGS[lang].letters;
  state.hintText = STRINGS[lang].hint;
  state.headingUnknown = STRINGS[lang].unknown;
  refreshHeadingLabel(lang);
  refreshPoiFilter();
}

/** Window height for the stats strip is Rust's job (minimap.rs panel_h reads
 * the same stamina flag from the poller); this only has to agree on the
 * formula: base height + one row when stamina is present (token mode). */
function recomputePanelH() {
  const ip = settings.islepilot ?? {};
  state.panelH =
    ip.enabled && (ip.show_overlay_panel ?? true)
      ? PANEL_H + (state.dino?.stamina ? PANEL_ROW_H : 0)
      : 0;
}

/** Window height for the quest card is Rust's job (minimap.rs quests_h reads
 * the same count from the poller); this only has to agree on the formula. */
function recomputeQuestsH() {
  const ip = settings.islepilot ?? {};
  state.questsH =
    ip.enabled && (ip.show_quests_panel ?? false) && state.quests.length > 0
      ? QUEST_HEADER_H + state.quests.length * QUEST_ROW_H + QUEST_PAD_H
      : 0;
}

function refreshHeadingLabel(lang: keyof typeof STRINGS) {
  state.headingLabel =
    lastHeadingKey && lastHeadingDeg !== null
      ? `${STRINGS[lang].dirs[lastHeadingKey] ?? ""} ${Math.round(lastHeadingDeg)}°`
      : "";
}

function refreshPoiFilter() {
  const visible = settings.layers ?? {};
  state.pois = allPois.filter((p) => visible[(p as any).layerKey] ?? true);
}

function flattenPois() {
  allPois = [];
  for (const layer of poiLayers) {
    if (layer.kind !== "point") continue; // zones are full-map only
    const color = LAYER_COLORS[layer.key] ?? "#e8a33d";
    for (const item of layer.items) {
      allPois.push({
        xCm: item.xCm,
        yCm: item.yCm,
        px: item.px,
        py: item.py,
        color,
        // Animals draw as their species glyph instead of a dot.
        glyph: layer.key === "animal" ? ANIMAL_GLYPHS[item.label] : undefined,
        // carried for the visibility filter
        ...( { layerKey: layer.key } as object ),
      });
    }
  }
  refreshPoiFilter();
}

const draw = () => render(canvas, state);

let imageWidthPx = 7800;
// Which basemap imagery this webview currently renders — compared against
// settings broadcasts to reload only on a real switch.
let currentSource = "vulnona";
// Fresh-water overlay descriptor from get_map_info (bounds already in the
// ACTIVE calibration's px space); null when the file is not on disk yet.
let overlayInfo: { url: string; boundsPx: [number, number, number, number] } | null = null;

type MapInfoPayload = {
  imageWidthPx: number;
  pxPerMX: number;
  source: string;
  overlays?: { key: string; path: string; boundsPx: [number, number, number, number] }[];
};

function applyMapInfo(info: MapInfoPayload) {
  state.pxPerM = info.pxPerMX;
  imageWidthPx = info.imageWidthPx;
  currentSource = info.source;
  overlayInfo = null;
  for (const ov of info.overlays ?? []) {
    if (ov.key === "freshwater") {
      overlayInfo = { url: convertFileSrc(ov.path), boundsPx: ov.boundsPx };
    }
  }
}

/// (Re)load basemap + POIs. Called at init AND whenever the first-run /
/// re-download fetch finishes — the data may not exist yet when this webview
/// first starts, and it must pick it up without an app restart.
async function loadData() {
  try {
    poiLayers = await invoke<PoiLayer[]>("get_pois_render");
    flattenPois();
  } catch {
    // POI data missing (first run): map still works without dots.
  }
  try {
    const paths = await invoke<{ minimap: string; minimapDecodeWidth: number | null }>(
      "get_basemap_paths",
    );
    const resp = await fetch(convertFileSrc(paths.minimap));
    if (resp.ok) {
      // The islemaps PNGs decode to ~25 MB; the hint downscales them at
      // decode so the always-resident bitmap stays small. miniScale
      // normalises by bitmap width, so a downscaled decode needs no other
      // change anywhere.
      const blob = await resp.blob();
      const bitmap = await createImageBitmap(
        blob,
        paths.minimapDecodeWidth
          ? { resizeWidth: paths.minimapDecodeWidth, resizeQuality: "high" }
          : {},
      );
      state.basemap?.close(); // release the old pixels promptly
      state.basemap = bitmap;
      state.miniScale = state.basemap.width / imageWidthPx;
    }
  } catch {
    // Missing basemap: the disc just stays unfilled until data arrives.
  }
  try {
    if (overlayInfo) {
      const resp = await fetch(overlayInfo.url);
      if (resp.ok) {
        // Same downscale reasoning as the islemaps basemap: ~6 MB resident
        // instead of ~25 MB; the draw stretches to px bounds so resolution
        // only affects sharpness.
        const bmp = await createImageBitmap(await resp.blob(), {
          resizeWidth: 1250,
          resizeQuality: "high",
        });
        const [left, top, right, bottom] = overlayInfo.boundsPx;
        state.freshwater?.bitmap.close();
        state.freshwater = { bitmap: bmp, x: left, y: top, w: right - left, h: bottom - top };
      }
    } else if (state.freshwater) {
      state.freshwater.bitmap.close();
      state.freshwater = null;
    }
  } catch {
    // Overlay missing: the layer is simply absent.
  }
  draw();
}

/// Waypoints for the disc + the nearest-waypoint rim arrow. Both piggyback
/// on events (waypoints://changed, position updates) — no polling.
interface WaypointPx {
  id: string;
  name: string;
  /** world cm (legacy field names) */
  x: number;
  y: number;
  px: number;
  py: number;
  color: string | null;
}
let waypointsPx: WaypointPx[] = [];

async function refreshWaypoints() {
  try {
    waypointsPx = await invoke<WaypointPx[]>("list_waypoints_px");
  } catch {
    waypointsPx = [];
  }
  state.waypoints = waypointsPx.map((w) => ({
    xCm: w.x,
    yCm: w.y,
    px: w.px,
    py: w.py,
    color: w.color,
    glyph: waypointGlyph(w.name),
  }));
  await refreshNearest();
  draw();
}

async function refreshNearest() {
  try {
    const near = await invoke<{
      id: string;
      bearingDeg: number;
      distanceM: number;
    } | null>("nearest_waypoint");
    const target = near ? waypointsPx.find((w) => w.id === near.id) : undefined;
    state.nearestWaypoint = near
      ? {
          bearingDeg: near.bearingDeg,
          distanceM: near.distanceM,
          color: target?.color ?? null,
          glyph: target ? waypointGlyph(target.name) : undefined,
        }
      : null;
  } catch {
    state.nearestWaypoint = null;
  }
}

/// Full reload after a basemap switch: new geometry, new bitmap, and a
/// defensive position/trail re-fetch (resync events also arrive; this closes
/// the one-stale-frame window in between).
async function reloadMapSource() {
  try {
    applyMapInfo(await invoke<MapInfoPayload>("get_map_info"));
  } catch {
    return; // keep rendering the old frame rather than a mismatched one
  }
  await loadData();
  try {
    const p = await invoke<PositionUpdate | null>("get_current_position");
    if (p) {
      state.position = { xCm: p.xCm, yCm: p.yCm, px: p.px, py: p.py, headingDeg: p.headingDeg };
    }
    const trail = await invoke<{ segmentsPx: [number, number][][] }>("get_current_trail");
    state.trailPx = trail.segmentsPx;
  } catch {
    // resync events will repaint us shortly anyway
  }
  // Waypoint px is calibration-dependent — refresh in the new frame.
  await refreshWaypoints();
  draw();
}

async function init() {
  settings = await invoke<Settings>("get_settings");
  applySettings(settings);

  applyMapInfo(await invoke<MapInfoPayload>("get_map_info"));

  await listen<PositionUpdate>("position://update", (e) => {
    const p = e.payload;
    state.position = { xCm: p.xCm, yCm: p.yCm, px: p.px, py: p.py, headingDeg: p.headingDeg };
    lastHeadingKey = p.compassKey;
    lastHeadingDeg = p.headingDeg;
    refreshHeadingLabel(settings.language === "en" ? "en" : "vi");
    draw();
    // The rim arrow re-aims from the new position; repaints once more when
    // the answer arrives (still purely event-driven).
    void refreshNearest().then(draw);
  });
  await listen("waypoints://changed", () => void refreshWaypoints());
  await listen<{ segmentsPx: [number, number][][] }>("trail://changed", (e) => {
    state.trailPx = e.payload.segmentsPx;
    draw();
  });
  await listen<Settings>("settings://changed", (e) => {
    applySettings(e.payload);
    const src = (e.payload.map?.basemap as string) ?? "vulnona";
    if (src !== currentSource) {
      void reloadMapSource();
      return; // reloadMapSource draws when the new frame is ready
    }
    draw();
  });

  // "Your dino" stats for the strip under the disc.
  interface DinoStatBar {
    current: number | null;
    max: number | null;
  }
  interface DinoUpdatePayload {
    player: {
      growthPct: number | null;
      health: DinoStatBar | null;
      hunger: DinoStatBar | null;
      thirst: DinoStatBar | null;
      stamina?: DinoStatBar | null;
      primeQuests?: QuestRow[];
    } | null;
  }
  const toBars = (u: DinoUpdatePayload): DinoBars | null =>
    u.player
      ? {
          hp: u.player.health ?? { current: null, max: null },
          hunger: u.player.hunger ?? { current: null, max: null },
          thirst: u.player.thirst ?? { current: null, max: null },
          stamina: u.player.stamina ?? null,
          growthPct: u.player.growthPct,
        }
      : null;
  // Error updates carry player: null — keep the last good quests/bars so a
  // network hiccup doesn't blank (or resize) the overlay.
  const applyDino = (u: DinoUpdatePayload) => {
    state.dino = toBars(u) ?? state.dino;
    if (u.player) {
      state.quests = u.player.primeQuests ?? [];
      recomputeQuestsH();
      recomputePanelH();
    }
  };
  await listen<DinoUpdatePayload>("dino://update", (e) => {
    applyDino(e.payload);
    draw();
  });
  try {
    const st = await invoke<{ lastUpdate: DinoUpdatePayload | null }>("islepilot_state");
    if (st.lastUpdate) applyDino(st.lastUpdate);
  } catch {
    // feature off — strip just shows "…" until data arrives
  }

  // First-run / re-download / silent top-up completed: pick up the new data
  // live — including overlays that did not exist at init (get_map_info again).
  await listen("fetch://finished", () => void reloadMapSource());

  // Initial state: position/trail otherwise arrive only as events, so a
  // fresh (re)loaded webview would sit on the hint disc until the player's
  // next manual copy.
  try {
    const p = await invoke<PositionUpdate | null>("get_current_position");
    if (p) {
      state.position = { xCm: p.xCm, yCm: p.yCm, px: p.px, py: p.py, headingDeg: p.headingDeg };
      lastHeadingKey = p.compassKey;
      lastHeadingDeg = p.headingDeg;
      refreshHeadingLabel(settings.language === "en" ? "en" : "vi");
    }
    const trail = await invoke<{ segmentsPx: [number, number][][] }>("get_current_trail");
    state.trailPx = trail.segmentsPx;
  } catch {
    // Stays on the hint disc until the first event.
  }

  // First paint before the window is shown (Rust shows it on this signal).
  draw();
  await emit("minimap://ready", {});

  // Data load can lag behind the first paint; draws again when ready.
  void loadData();
  void refreshWaypoints();
}

void init().catch((e) => {
  void error(`[minimap] init failed: ${e}`).catch(() => {});
  // A blank-but-alive overlay beats an invisible one: Rust wires up the
  // supervisor on this signal (and has its own 5 s fallback besides).
  void emit("minimap://ready", {});
});
