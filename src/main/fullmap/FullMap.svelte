<script lang="ts">
  // Full map: Leaflet with CRS.Simple over the ACTIVE basemap's pixel space
  // (geometry from get_map_info — vulnona 7800x7817 or islemaps 2500x2500),
  // so every px/py from Rust is used directly as a map coordinate. The
  // frontend never runs a world<->pixel transform. On a basemap switch the
  // whole component is remounted by App.svelte ({#key}) — every layer's px
  // changes together with the imageOverlay.
  import { onDestroy, onMount, untrack } from "svelte";
  import L from "leaflet";
  import "leaflet/dist/leaflet.css";
  import {
    addWaypointAtPixel,
    clearTrail,
    deleteWaypoint,
    getBasemapUrls,
    getCurrentPosition,
    getCurrentTrail,
    getMapInfo,
    getNearestWaypoint,
    getPoisRender,
    getPreviousTrail,
    getSettings,
    islepilotOverlayMap,
    type IslepilotOverlayMap,
    listenerBag,
    listWaypointsPx,
    patchSettings,
    resolveCoordinates,
    setWaypointColor,
    onFetchFinished,
    onWaypointsChanged,
    onPositionUpdate,
    onSettingsChanged,
    onTrailChanged,
    renameWaypoint,
    type NearestWaypoint,
    type OverlayRender,
    type PoiLayer,
    type PositionUpdate,
    type Settings,
    type TrailPayload,
    type Waypoint,
    type WaypointPx,
  } from "$lib/api";
  import {
    ANIMAL_GLYPHS,
    COLORS,
    LAYER_COLORS,
    LAYER_ORDER,
    POI_DOT_RADIUS,
    WAYPOINT_GLYPHS,
    WAYPOINT_RADIUS,
    waypointGlyph,
    ZONE_FILL_OPACITY,
    ZONE_STROKE_OPACITY,
  } from "$lib/theme";
  import LayerPanel from "./LayerPanel.svelte";
  import NamePrompt from "./NamePrompt.svelte";
  import { t, tNow } from "$lib/i18n";
  import { ask } from "@tauri-apps/plugin-dialog";

  // Ground-anchored zoom envelope: the same real-world scale range on every
  // basemap (zoom is screen px per BASEMAP px, which differs per source).
  // Derived from the original QGraphicsView envelope, scale 0.04 .. 3.0 over
  // the vulnona space (pxPerMY = 7817/11160): 0.04 * 0.70044 and 3.0 *
  // 0.70044 — so on vulnona these reproduce log2(0.04)..log2(3.0) exactly.
  const MIN_PX_PER_M = 0.028018;
  const MAX_PX_PER_M = 2.1013;

  const toLatLng = (px: number, py: number): L.LatLngTuple => [-py, px];

  // App.svelte keeps this component mounted across tab switches and says
  // whether its tab is the one on screen. Hidden means: keep the Leaflet
  // instance, do no per-sample work.
  let { visible = true }: { visible?: boolean } = $props();

  let mapEl: HTMLDivElement;
  let map: L.Map | undefined;
  let mapBounds: L.LatLngBoundsExpression | null = null;
  // True when fitBounds ran against a hidden (0x0) container because the tab
  // was switched away mid-load. The zoom it computed is meaningless and is
  // redone on the next show.
  let fitPending = false;
  // Set by onDestroy. The onMount loader awaits several IPC calls; a basemap
  // remount via {#key} (a tab switch no longer unmounts — see `visible`)
  // during any of them tears `map` down, so every resume re-checks this
  // before touching the map. Field crash: "Cannot read properties of
  // undefined (reading 'on')" on a slow first load.
  let destroyed = false;
  let layerGroups: Record<string, L.LayerGroup> = {};
  // Image overlays (fresh water). Separate from layerGroups so POI rebuilds
  // (after a background top-up) never tear them down.
  let overlayGroups: Record<string, L.LayerGroup> = {};
  // Zone name labels live in their own groups so the "zone names" toggle can
  // hide the text while the outlines stay.
  let zoneLabelGroups: Record<string, L.LayerGroup> = {};
  let waypointGroup: L.LayerGroup | undefined;
  let currentTrail: L.LayerGroup | undefined;
  let previousTrail: L.LayerGroup | undefined;
  let playerMarker: L.Marker | undefined;
  let playerArrowEl: HTMLElement | null = null;

  let settings = $state<Settings | null>(null);
  let position = $state<PositionUpdate | null>(null);
  let nearest = $state<NearestWaypoint | null>(null);
  // The newest sample/trail that arrived while the tab was hidden. Nothing is
  // painted for them until the tab shows again: keeping the map alive must
  // not become a map that pans, re-projects and round-trips to Rust for the
  // nearest waypoint on every sample while nobody is looking at it — that
  // would trade a rebuild-per-visit for a cost-per-sample and come out worse.
  let parkedPosition: PositionUpdate | null = null;
  let parkedTrail: TrailPayload | null = null;
  let availableLayers = $state<string[]>([]);
  let promptOpen = $state(false);
  let pendingPixel: { px: number; py: number } | null = null;

  // Follow mode: the map auto-centres on each position update until the user
  // drags away; then the edge arrow points back and a click resumes follow.
  let follow = $state(true);
  let edgeArrow = $state<{ x: number; y: number; angle: number } | null>(null);
  let pxPerMY = 0.70044; // replaced by get_map_info at mount

  /** Searchable places (region/landmark/water names) for the panel. */
  let searchPlaces = $state<{ label: string; px: number; py: number; kind: string }[]>([]);

  const bag = listenerBag();

  // The self-marker: a yellow dart when the heading is known, a plain disc
  // when it is not — always with the dark+white double outline so it can
  // never be confused with waypoint/POI circles.
  const PLAYER_SVG = `<svg viewBox="0 0 28 28" width="28" height="28">
    <g class="glyph-arrow">
      <path d="M14 2 L24 24 L14 18 L4 24 Z" fill="${COLORS.playerArrow}"
            stroke="${COLORS.playerArrowOutline}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M14 2 L24 24 L14 18 L4 24 Z" fill="${COLORS.playerArrow}"
            stroke="rgba(255,255,255,0.9)" stroke-width="1.2" stroke-linejoin="round"/>
    </g>
    <g class="glyph-dot">
      <circle cx="14" cy="14" r="6.5" fill="${COLORS.playerArrow}"
              stroke="${COLORS.playerArrowOutline}" stroke-width="3"/>
      <circle cx="14" cy="14" r="6.5" fill="${COLORS.playerArrow}"
              stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/>
    </g>
  </svg>`;

  function upsertPlayer(p: PositionUpdate) {
    if (!map) return;
    const ll = toLatLng(p.px, p.py);
    if (!playerMarker) {
      playerMarker = L.marker(ll, {
        icon: L.divIcon({
          className: "player-arrow",
          html: `<div class="player-arrow-inner">${PLAYER_SVG}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        interactive: false,
        keyboard: false,
      }).addTo(map);
      playerArrowEl = playerMarker.getElement()?.querySelector(".player-arrow-inner") ?? null;
    } else {
      playerMarker.setLatLng(ll);
    }
    if (playerArrowEl) {
      // Rotate the INNER element: Leaflet owns the icon's own transform for
      // positioning. Compass 0 = north = up, clockwise — CSS rotate matches.
      playerArrowEl.classList.toggle("no-heading", p.headingDeg === null);
      playerArrowEl.style.transform = p.headingDeg !== null ? `rotate(${p.headingDeg}deg)` : "";
    }
  }

  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /** Union of POI layers and image overlays, in draw order. */
  function refreshAvailable(poiKeys: Set<string>) {
    availableLayers = LAYER_ORDER.filter(
      (k) => poiKeys.has(k) || k in overlayGroups,
    );
  }

  /** Register one image overlay (fresh water) as a toggleable layer. */
  function addOverlay(ov: OverlayRender) {
    if (!map || overlayGroups[ov.key]) return;
    const [left, top, right, bottom] = ov.boundsPx;
    const group = L.layerGroup([
      L.imageOverlay(
        ov.url,
        [
          [-bottom, left],
          [-top, right],
        ],
        { opacity: 0.9, interactive: false },
      ),
    ]);
    overlayGroups[ov.key] = group;
    if (settings?.layers?.[ov.key] ?? true) group.addTo(map);
  }

  let poiKeysPresent = new Set<string>();

  /** Tear down and rebuild the POI layers (after a re-download/top-up). */
  function rebuildPoiLayers(pois: PoiLayer[]) {
    if (!map) return;
    for (const group of [...Object.values(layerGroups), ...Object.values(zoneLabelGroups)]) {
      map.removeLayer(group);
    }
    layerGroups = {};
    zoneLabelGroups = {};
    buildPoiLayers(pois);
    // The rebuild tore the IslePilot group down with the rest — restore it
    // from the cached data, no refetch.
    if (islepilotData) buildIslepilotLayer(islepilotData);
    // The groups above were built straight from `settings`, so they already
    // match; forgetting the memo anyway means the next apply does one real
    // pass rather than trusting that to stay true through future edits.
    appliedLayerState = "";
  }

  // --- IslePilot live server POIs (token mode) -----------------------------
  let islepilotData: IslepilotOverlayMap | null = null;
  let islepilotNote = $state<string | null>(null);

  function buildIslepilotLayer(data: IslepilotOverlayMap) {
    if (!map || !data.available) return;
    const catName = new Map(data.categories.map((c) => [c.id, c.name]));
    const group = L.layerGroup();
    for (const poi of data.pois) {
      const color = poi.color ?? LAYER_COLORS.islepilot;
      const cat = poi.categoryId ? catName.get(poi.categoryId) : undefined;
      const tooltip = [poi.name, cat].filter(Boolean).join(" · ");
      const pts = poi.pointsPx.map(([px, py]) => toLatLng(px, py));
      if (pts.length >= 3) {
        L.polygon(pts, {
          color,
          weight: 1.6,
          opacity: ZONE_STROKE_OPACITY,
          fillColor: color,
          fillOpacity: ZONE_FILL_OPACITY,
        })
          .bindTooltip(tooltip || "IslePilot", { sticky: true })
          .addTo(group);
      } else if (pts.length === 2) {
        L.polyline(pts, { color, weight: 2, opacity: ZONE_STROKE_OPACITY })
          .bindTooltip(tooltip || "IslePilot", { sticky: true })
          .addTo(group);
      } else if (pts.length === 1) {
        L.circleMarker(pts[0], {
          radius: POI_DOT_RADIUS,
          color: "rgba(0,0,0,0.63)",
          weight: 1,
          fillColor: color,
          fillOpacity: 1,
        })
          .bindTooltip(tooltip || "IslePilot")
          .addTo(group);
      }
    }
    layerGroups["islepilot"] = group;
    if (settings?.layers?.["islepilot"] ?? false) group.addTo(map);
    poiKeysPresent.add("islepilot");
    refreshAvailable(poiKeysPresent);
  }

  async function loadIslepilotPois() {
    try {
      const data = await islepilotOverlayMap();
      if (data.available) {
        islepilotData = data;
        islepilotNote = null;
        buildIslepilotLayer(data);
      } else if (data.reason === "discord") {
        islepilotNote = tNow("poi.islepilot_discord");
      } else if (data.reason === "disabled") {
        islepilotNote = tNow("poi.islepilot_disabled");
      }
      // "not-logged-in" / "empty": stay silent — the layer simply is absent.
    } catch {
      // Token expired or offline: the map works without server POIs.
    }
  }

  function buildPoiLayers(pois: PoiLayer[]) {
    if (!map) return;
    const byKey = new Map(pois.map((l) => [l.key, l]));
    for (const key of LAYER_ORDER) {
      const layer = byKey.get(key);
      if (!layer) continue;
      const color = LAYER_COLORS[key] ?? COLORS.accent;
      const group = L.layerGroup();
      const labelGroup = layer.kind === "zone" ? L.layerGroup() : undefined;
      for (const item of layer.items) {
        if (layer.kind === "label") {
          // Pure text label (region/landmark names) — no shape.
          L.marker(toLatLng(item.px, item.py), {
            icon: L.divIcon({
              className: `map-label map-label--${key}`,
              html: escapeHtml(item.label),
              iconSize: undefined,
            }),
            interactive: false,
            keyboard: false,
          }).addTo(group);
          continue;
        }
        if (
          labelGroup &&
          item.label &&
          item.labelPx !== undefined &&
          item.labelPy !== undefined
        ) {
          // Permanent name at the zone's centre, colour-matched to its layer.
          L.tooltip({
            permanent: true,
            direction: "center",
            className: "zone-label",
            opacity: 1,
            interactive: false,
          })
            .setContent(
              `<span style="color: ${color}">${escapeHtml(item.label)}</span>`,
            )
            .setLatLng(toLatLng(item.labelPx, item.labelPy))
            .addTo(labelGroup);
        }
        if (item.pointsPx) {
          L.polygon(item.pointsPx.map(([px, py]) => toLatLng(px, py)), {
            color,
            weight: 1.6,
            opacity: ZONE_STROKE_OPACITY,
            fillColor: color,
            fillOpacity: ZONE_FILL_OPACITY,
          })
            .bindTooltip(item.label, { sticky: true })
            .addTo(group);
        } else if (item.radiusPx) {
          // CRS.Simple: L.circle radius is in map units = basemap pixels.
          L.circle(toLatLng(item.px, item.py), {
            radius: item.radiusPx,
            color,
            weight: 1.6,
            opacity: ZONE_STROKE_OPACITY,
            fillColor: color,
            fillOpacity: ZONE_FILL_OPACITY,
          })
            .bindTooltip(item.label, { sticky: true })
            .addTo(group);
        } else {
          // Animals get a per-species glyph "logo"; everything else (and any
          // species without a glyph) stays a fixed screen-size dot.
          const glyph = key === "animal" ? ANIMAL_GLYPHS[item.label] : undefined;
          if (glyph) {
            L.marker(toLatLng(item.px, item.py), {
              icon: L.divIcon({
                className: "animal-glyph",
                html: glyph,
                iconSize: [18, 18],
                iconAnchor: [9, 9],
              }),
              keyboard: false,
            })
              .bindTooltip(item.label)
              .addTo(group);
          } else {
            // Fixed screen-size dot at any zoom (circleMarker radius is px).
            L.circleMarker(toLatLng(item.px, item.py), {
              radius: POI_DOT_RADIUS,
              color: "rgba(0,0,0,0.63)",
              weight: 1,
              fillColor: color,
              fillOpacity: 1,
            })
              .bindTooltip(item.label)
              .addTo(group);
          }
        }
      }
      layerGroups[key] = group;
      if (settings?.layers?.[key] ?? true) group.addTo(map);
      if (labelGroup) {
        zoneLabelGroups[key] = labelGroup;
        if ((settings?.layers?.[key] ?? true) && (settings?.map?.zone_labels ?? true)) {
          labelGroup.addTo(map);
        }
      }
    }
    poiKeysPresent = new Set(byKey.keys());
    refreshAvailable(poiKeysPresent);
    // Named places for the search box (labels only, not zones).
    searchPlaces = ["region", "landmark", "water"].flatMap((key) =>
      (byKey.get(key)?.items ?? [])
        .filter((it) => it.label)
        .map((it) => ({ label: it.label, px: it.px, py: it.py, kind: key })),
    );
  }

  function drawTrail(target: L.LayerGroup, trail: TrailPayload, dimmed: boolean) {
    target.clearLayers();
    for (const seg of trail.segmentsPx) {
      if (seg.length < 2) continue;
      L.polyline(seg.map(([px, py]) => toLatLng(px, py)), {
        color: COLORS.trail,
        weight: 2,
        opacity: dimmed ? 0.35 : 0.9,
        dashArray: dimmed ? "6 6" : undefined,
        interactive: false,
      }).addTo(target);
    }
  }

  let waypointsPx = $state<WaypointPx[]>([]);

  async function refreshWaypoints() {
    // px/py for rendering come from Rust — the transform stays single-sourced.
    waypointsPx = await listWaypointsPx();
    if (!map || !waypointGroup) return;
    waypointGroup.clearLayers();
    for (const wp of waypointsPx) {
      // A name starting with a preset icon (💀 🏠 💧 ⚠️ 🍖) renders as that
      // glyph itself; everything else stays a colour dot.
      const glyph = waypointGlyph(wp.name);
      if (glyph) {
        L.marker(toLatLng(wp.px, wp.py), {
          icon: L.divIcon({
            className: "wp-glyph",
            html: glyph,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
          keyboard: false,
        })
          .bindTooltip(wp.name)
          .addTo(waypointGroup);
        continue;
      }
      L.circleMarker(toLatLng(wp.px, wp.py), {
        radius: WAYPOINT_RADIUS,
        color: "rgba(0,0,0,0.78)",
        weight: 1.2,
        fillColor: wp.color ?? COLORS.waypoint,
        fillOpacity: 1,
      })
        .bindTooltip(wp.name)
        .addTo(waypointGroup);
    }
    nearest = await getNearestWaypoint();
  }

  // The last layer state actually applied. Two callers hit this per layer
  // click — the click handler, then the settings broadcast looping back — and
  // every settings broadcast of any kind lands here too: an opacity hotkey, a
  // language switch, the telemetry checkbox. Comparing first turns all of
  // those into a no-op instead of a sweep over every Leaflet group.
  let appliedLayerState = "";

  function applyLayerVisibility(layers: Record<string, boolean>, zoneLabels: boolean) {
    if (!map) return;
    const next = JSON.stringify(layers) + (zoneLabels ? "|1" : "|0");
    if (next === appliedLayerState) return;
    appliedLayerState = next;
    const setVisible = (group: L.LayerGroup, visible: boolean) => {
      if (visible && !map!.hasLayer(group)) group.addTo(map!);
      if (!visible && map!.hasLayer(group)) map!.removeLayer(group);
    };
    for (const [key, group] of Object.entries({ ...overlayGroups, ...layerGroups })) {
      setVisible(group, layers[key] ?? true);
    }
    for (const [key, group] of Object.entries(zoneLabelGroups)) {
      setVisible(group, (layers[key] ?? true) && zoneLabels);
    }
  }

  const zoneLabelsOn = (s: Settings | null) => s?.map?.zone_labels ?? true;

  async function onToggleLayer(key: string, visible: boolean) {
    // Persisted (bug fix 1) — settings://changed loops back to every window,
    // including the minimap's POI filter.
    settings = await patchSettings({ layers: { [key]: visible } });
    applyLayerVisibility(settings.layers, zoneLabelsOn(settings));
  }

  async function onToggleZoneLabels(visible: boolean) {
    settings = await patchSettings({ map: { zone_labels: visible } });
    applyLayerVisibility(settings.layers, zoneLabelsOn(settings));
  }

  async function confirmPrompt(name: string) {
    promptOpen = false;
    if (!pendingPixel) return;
    await addWaypointAtPixel(pendingPixel.px, pendingPixel.py, name || tNow("wp.new"));
    pendingPixel = null;
    await refreshWaypoints();
  }

  async function onRename(id: string, name: string) {
    await renameWaypoint(id, name);
    await refreshWaypoints();
  }

  async function onDelete(wp: Waypoint) {
    const yes = await ask(tNow("wp.confirm_delete", { name: wp.name }), {
      title: tNow("wp.title"),
      kind: "warning",
    });
    if (!yes) return;
    await deleteWaypoint(wp.id);
    await refreshWaypoints();
  }

  function focusWaypoint(wp: Waypoint) {
    const found = waypointsPx.find((w) => w.id === wp.id);
    if (map && found) locatePx(found.px, found.py);
  }

  async function onClearTrail() {
    // The command clears the tracker and broadcasts trail://changed (empty),
    // which repaints currentTrail here AND on the minimap. The previous
    // session's dimmed trail has no event channel — clear it locally.
    await clearTrail();
    previousTrail?.clearLayers();
  }

  async function onSetColor(wp: Waypoint, color: string | null) {
    await setWaypointColor(wp.id, color);
    await refreshWaypoints();
  }

  /** Player marker outside the viewport -> an arrow at the viewport edge on
   * the centre->player ray; clicking it (or the recenter button) resumes
   * follow. Recomputed on map moves and position updates — no timers. */
  function updateEdgeArrow() {
    if (!map || !position) {
      edgeArrow = null;
      return;
    }
    const p = map.latLngToContainerPoint(toLatLng(position.px, position.py));
    const size = map.getSize();
    const m = 28;
    if (p.x >= m && p.x <= size.x - m && p.y >= m && p.y <= size.y - m) {
      edgeArrow = null;
      return;
    }
    const cx = size.x / 2;
    const cy = size.y / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const sx = dx !== 0 ? (size.x / 2 - m) / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? (size.y / 2 - m) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy, 1);
    edgeArrow = {
      x: cx + dx * s,
      y: cy + dy * s,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  }

  function recenter() {
    follow = true;
    if (map && position) map.panTo(toLatLng(position.px, position.py));
    edgeArrow = null;
  }

  /** One-shot locate pulse; the marker removes itself (no repaint loops). */
  function pulseAt(px: number, py: number) {
    if (!map) return;
    const marker = L.marker(toLatLng(px, py), {
      icon: L.divIcon({ className: "locate-pulse", iconSize: [18, 18], iconAnchor: [9, 9] }),
      interactive: false,
      keyboard: false,
    }).addTo(map);
    setTimeout(() => marker.remove(), 2600);
  }

  function locatePx(px: number, py: number) {
    if (!map) return;
    follow = false;
    // Ground-anchored floor (~0.35 px/m) so "locate" lands at a readable
    // scale on every basemap without yanking an already-zoomed view.
    const floor = Math.log2(0.35 / pxPerMY);
    map.setView(toLatLng(px, py), Math.max(map.getZoom(), floor));
    pulseAt(px, py);
    updateEdgeArrow();
  }

  /** Manually pasted coordinate text from the search box. */
  async function onSearchCoords(text: string): Promise<boolean> {
    const r = await resolveCoordinates(text);
    if (!r) return false;
    locatePx(r.px, r.py);
    return true;
  }

  function applyPosition(p: PositionUpdate, animate = true) {
    position = p;
    if (!map) return;
    upsertPlayer(p);
    if (follow) map.panTo(toLatLng(p.px, p.py), { animate });
    updateEdgeArrow();
  }

  // Coming back from display:none. Leaflet measured a 0x0 container while
  // hidden — without invalidateSize the view paints blank or offset — then
  // whatever was parked meanwhile is applied once, without animating across
  // what may be a long jump.
  $effect(() => {
    if (!visible || !map) return;
    // untrack: the work below both writes and reads $state (position,
    // edgeArrow, nearest via applyPosition). Tracked, that made this effect
    // depend on `position` and re-run itself on the next sample after every
    // show. Its only real input is `visible`, read above.
    untrack(() => {
      map!.invalidateSize({ animate: false });
      if (fitPending && mapBounds) {
        fitPending = false;
        // No animation: it would tween from the meaningless hidden-container
        // zoom, and the user is arriving on a tab, not watching a transition.
        map!.fitBounds(mapBounds, { animate: false });
      }
      const trail = parkedTrail;
      parkedTrail = null;
      if (trail && currentTrail) drawTrail(currentTrail, trail, false);
      const p = parkedPosition;
      parkedPosition = null;
      if (p) {
        applyPosition(p, false);
        void getNearestWaypoint().then((n) => {
          if (!destroyed) nearest = n;
        });
      }
    });
  });

  onMount(() => {
    (async () => {
      settings = await getSettings();
      const info = await getMapInfo();
      // Unmounted meanwhile: a Leaflet map built now would sit on a detached
      // element and never be removed (onDestroy already ran).
      if (destroyed) return;
      const W = info.imageWidthPx;
      const H = info.imageHeightPx;
      pxPerMY = info.pxPerMY;

      map = L.map(mapEl, {
        crs: L.CRS.Simple,
        minZoom: Math.log2(MIN_PX_PER_M / info.pxPerMY),
        maxZoom: Math.log2(MAX_PX_PER_M / info.pxPerMY),
        zoomSnap: 0,
        zoomDelta: 0.25,
        wheelPxPerZoomLevel: 90,
        attributionControl: false,
        zoomControl: true,
      });
      const bounds: L.LatLngBoundsExpression = [
        [-H, 0],
        [0, W],
      ];
      const urls = await getBasemapUrls();
      if (destroyed || !map) return;
      L.imageOverlay(urls.fullmap, bounds).addTo(map);
      mapBounds = bounds;
      map.fitBounds(bounds);
      fitPending = !visible;
      map.setMaxBounds([
        [-H * 1.15, -W * 0.15],
        [H * 0.15, W * 1.15],
      ]);

      // Image overlays right after the basemap so their <img> sits under
      // every vector layer added later.
      for (const ov of info.overlays) addOverlay(ov);

      previousTrail = L.layerGroup().addTo(map);
      currentTrail = L.layerGroup().addTo(map);
      waypointGroup = L.layerGroup().addTo(map);

      try {
        buildPoiLayers(await getPoisRender());
      } catch {
        // POI data missing (partial first run): map works without dots.
      }
      // Server POIs load in the background — never block the map paint.
      void loadIslepilotPois();
      drawTrail(previousTrail, await getPreviousTrail(), true);
      drawTrail(currentTrail, await getCurrentTrail(), false);
      await refreshWaypoints();
      // The helpers above all guard `map` themselves; the handlers below do
      // not, and this is the point the field crash resumed at.
      if (destroyed || !map) return;

      map.on("contextmenu", (e: L.LeafletMouseEvent) => {
        pendingPixel = { px: e.latlng.lng, py: -e.latlng.lat };
        promptOpen = true;
      });
      // A manual drag pauses follow; the edge arrow / recenter button resume
      // it. Zoom alone does NOT pause (you zoom around your own position).
      map.on("dragstart", () => (follow = false));
      map.on("move", updateEdgeArrow);

      await bag.add(
        onPositionUpdate(async (p) => {
          if (!visible) {
            parkedPosition = p;
            return;
          }
          applyPosition(p);
          nearest = await getNearestWaypoint();
        }),
      );
      await bag.add(
        onTrailChanged((trail) => {
          if (!visible) {
            parkedTrail = trail;
            return;
          }
          if (currentTrail) drawTrail(currentTrail, trail, false);
        }),
      );
      await bag.add(
        onSettingsChanged((s) => {
          settings = s;
          applyLayerVisibility(s.layers, zoneLabelsOn(s));
        }),
      );
      // Hotkey "mark here" adds waypoints from Rust — refresh on its signal.
      await bag.add(onWaypointsChanged(() => void refreshWaypoints()));
      // A re-download or the silent top-up finished: new overlays/POI layers
      // (animal, fresh water) appear live without leaving the tab.
      await bag.add(
        onFetchFinished(async () => {
          const fresh = await getMapInfo();
          for (const ov of fresh.overlays) addOverlay(ov);
          refreshAvailable(poiKeysPresent);
          try {
            rebuildPoiLayers(await getPoisRender());
          } catch {
            // POI data still missing — overlays alone are fine.
          }
        }),
      );

      // Initial paint: position otherwise arrives only as an event, so after
      // an F5 the marker would wait for the player's next manual copy.
      const p = await getCurrentPosition();
      if (p && map) {
        position = p;
        upsertPlayer(p);
        map.panTo(toLatLng(p.px, p.py));
        nearest = await getNearestWaypoint();
      }
    })();

    return () => bag.dispose();
  });

  onDestroy(() => {
    destroyed = true;
    try {
      if (map) {
        // Leaflet ends a zoom animation on a 250 ms timer (Map._animateZoom,
        // its transitionend workaround) that outlives remove(): remove()
        // deletes _mapPane but never clears _animatingZoom, so the timer's
        // _onZoomTransitionEnd goes on to _move() and dereferences the gone
        // pane. Field crash on 1.5.1: "Cannot read properties of undefined
        // (reading '_leaflet_pos')" — a wheel zoom followed by a tab switch
        // within 250 ms. Nothing public cancels a zoom animation; the
        // handler's own first line is this flag, so clear it.
        (map as unknown as { _animatingZoom?: boolean })._animatingZoom = false;
        map.remove();
      }
    } catch {
      // A torn-down Leaflet must not poison the next mount of this tab.
    }
    map = undefined;
  });
</script>

<div class="flex h-full min-h-0">
  <div class="relative min-w-0 flex-1">
    <div class="absolute inset-0" bind:this={mapEl} style="background: var(--color-bg)"></div>
    {#if edgeArrow}
      <button
        class="edge-arrow"
        style="left: {edgeArrow.x}px; top: {edgeArrow.y}px; transform: translate(-50%, -50%) rotate({edgeArrow.angle}deg)"
        title={$t("map.recenter")}
        onclick={recenter}
      >
        ➤
      </button>
    {/if}
    {#if !follow && position}
      <button class="recenter-btn" title={$t("map.recenter")} onclick={recenter}>
        ◎ {$t("map.recenter")}
      </button>
    {/if}
  </div>
  <LayerPanel
    available={availableLayers}
    layers={settings?.layers ?? {}}
    zoneLabels={zoneLabelsOn(settings)}
    {position}
    {nearest}
    waypoints={waypointsPx}
    places={searchPlaces}
    {islepilotNote}
    ontoggle={onToggleLayer}
    ontogglezonelabels={onToggleZoneLabels}
    onrename={onRename}
    ondelete={onDelete}
    onfocus={focusWaypoint}
    oncleartrail={() => void onClearTrail()}
    onsetcolor={(wp, color) => void onSetColor(wp, color)}
    onlocate={locatePx}
    onsearchcoords={onSearchCoords}
  />
</div>

<NamePrompt
  open={promptOpen}
  title={tNow("wp.new")}
  label={tNow("wp.name_prompt")}
  presets={WAYPOINT_GLYPHS}
  onconfirm={confirmPrompt}
  oncancel={() => {
    promptOpen = false;
    pendingPixel = null;
  }}
/>

<style>
  :global(.leaflet-container) {
    background: var(--color-bg);
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  :global(.leaflet-tooltip) {
    background: var(--color-panel);
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }
  :global(.leaflet-tooltip-top:before),
  :global(.leaflet-tooltip-bottom:before),
  :global(.leaflet-tooltip-left:before),
  :global(.leaflet-tooltip-right:before) {
    border-top-color: var(--color-border);
  }
  :global(.leaflet-bar a) {
    background: var(--color-panel);
    color: var(--color-text);
    border-bottom: 1px solid var(--color-border);
  }
  :global(.leaflet-bar a:hover) {
    background: var(--color-bg);
  }

  /* Text-label layers (region/landmark names). The dark 1px shadow makes
     text readable over bright terrain without any outline box — same trick
     as the minimap compass letters. */
  :global(.map-label) {
    width: max-content !important;
    height: auto !important;
    margin: 0 !important;
    transform: translate(-50%, -50%);
    white-space: nowrap;
    pointer-events: none;
    text-shadow:
      1px 1px 2px rgba(0, 0, 0, 0.9),
      -1px -1px 2px rgba(0, 0, 0, 0.7);
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  :global(.map-label--region) {
    color: #eae6d6;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    opacity: 0.85;
  }
  :global(.map-label--landmark) {
    color: #cfc9b3;
    font-size: 11.5px;
    font-weight: 500;
  }
  :global(.map-label--landmark)::before {
    content: "";
    display: inline-block;
    width: 5px;
    height: 5px;
    margin-right: 4px;
    margin-bottom: 1px;
    border-radius: 50%;
    background: #cfc9b3;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.9);
  }

  /* Edge arrow + recenter: the way back to your position after panning away. */
  .edge-arrow {
    position: absolute;
    z-index: 1000;
    cursor: pointer;
    font-size: 22px;
    line-height: 1;
    color: var(--color-accent);
    text-shadow:
      0 0 3px rgba(0, 0, 0, 0.95),
      0 0 8px rgba(0, 0, 0, 0.6);
    background: none;
    border: none;
    padding: 4px;
  }
  .recenter-btn {
    position: absolute;
    left: 10px;
    bottom: 10px;
    z-index: 1000;
    cursor: pointer;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 4px;
    border: 1px solid var(--color-border);
    background: var(--color-panel);
    color: var(--color-text);
  }
  .recenter-btn:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  /* One-shot locate pulse (removed by timeout — nothing loops). */
  :global(.locate-pulse) {
    border: 2px solid var(--color-accent);
    border-radius: 50%;
    animation: locate-pulse 0.85s ease-out 3;
  }
  @keyframes locate-pulse {
    0% {
      transform: scale(0.5);
      opacity: 1;
    }
    100% {
      transform: scale(2.2);
      opacity: 0;
    }
  }

  /* Per-species animal markers: an emoji glyph instead of a dot. The drop
     shadow separates it from bright terrain; no box, no border. */
  :global(.animal-glyph) {
    font-size: 14px;
    line-height: 18px;
    text-align: center;
    filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.8));
    background: none;
    border: none;
  }

  /* Waypoints named with a preset icon: the icon IS the marker — slightly
     larger than animal glyphs because it is the user's own pin. */
  :global(.wp-glyph) {
    font-size: 17px;
    line-height: 22px;
    text-align: center;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.85));
    background: none;
    border: none;
  }

  /* Self-marker: the INNER element rotates (Leaflet owns the outer icon's
     transform for positioning); .no-heading swaps the dart for the disc. */
  :global(.player-arrow) {
    pointer-events: none;
  }
  :global(.player-arrow-inner) {
    width: 28px;
    height: 28px;
    transform-origin: 50% 50%;
  }
  :global(.player-arrow-inner .glyph-dot) {
    display: none;
  }
  :global(.player-arrow-inner.no-heading .glyph-arrow) {
    display: none;
  }
  :global(.player-arrow-inner.no-heading .glyph-dot) {
    display: block;
  }

  /* Zone name labels: plain colour-matched text, no tooltip bubble. */
  :global(.leaflet-tooltip.zone-label) {
    background: transparent;
    border: none;
    box-shadow: none;
    font-size: 11.5px;
    font-weight: 600;
    text-shadow:
      1px 1px 2px rgba(0, 0, 0, 0.9),
      -1px -1px 2px rgba(0, 0, 0, 0.7);
    pointer-events: none;
  }
  :global(.leaflet-tooltip.zone-label)::before {
    display: none;
  }
</style>
