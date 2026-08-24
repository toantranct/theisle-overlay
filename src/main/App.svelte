<script lang="ts">
  // Main window shell: tab navigation (map | settings | guide), the
  // exclusive-fullscreen warning banner, and locale bootstrapping.
  import { onMount } from "svelte";
  import {
    getDataStatus,
    getFullscreenMode,
    getSettings,
    listenerBag,
    onFetchFinished,
    onFullmapShow,
    onHotkeyFailed,
    onSettingsChanged,
    simulatePosition,
    trackFeature,
    type DataStatus,
    type FailedHotkey,
    type Feature,
  } from "$lib/api";
  import { locale, t, type Locale } from "$lib/i18n";
  import FullMap from "./fullmap/FullMap.svelte";
  import Footer from "./Footer.svelte";
  import DinoTab from "./dino/DinoTab.svelte";
  import GarageTab from "./garage/GarageTab.svelte";
  import Settings from "./settings/Settings.svelte";
  import Guide from "./guide/Guide.svelte";
  import Donate from "./donate/Donate.svelte";
  import FirstRun from "./firstrun/FirstRun.svelte";

  type Tab = "map" | "dino" | "garage" | "settings" | "guide" | "donate";
  const initialTab = ["map", "dino", "garage", "settings", "guide", "donate"].includes(
    location.hash.slice(1),
  )
    ? (location.hash.slice(1) as Tab)
    : "map";

  // Lucide-style tab icons (24x24, stroke = currentColor) as inline path
  // markup — no icon library, and the color follows the button state.
  const TAB_ICONS: Record<Tab, string> = {
    map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
    dino: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
    garage:
      '<path d="M22 8.35V20a2 2 0 0 1-2 2h-4v-9H8v9H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/>',
    settings:
      '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    guide:
      '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    donate:
      '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  };
  let tab = $state<Tab>(initialTab);
  // Write-back so F5 restores the tab the user was on (the hash was already
  // read above; nothing ever wrote it). replaceState: no history spam.
  $effect(() => {
    history.replaceState(null, "", `#${tab}`);
  });
  // Which tabs people actually open. Everything else is counted in Rust, so
  // the hotkey and UI paths to the same action share one counter.
  // Deliberately a total Record, not Partial: adding a tab without deciding
  // how it is counted should be a compile error, not a silent zero.
  const TAB_FEATURE: Record<Tab, Feature> = {
    map: "fullmap_open",
    dino: "dino3d_view",
    garage: "islepilot_garage",
    settings: "settings_open",
    guide: "guide_open",
    donate: "donate_open",
  };
  $effect(() => {
    trackFeature(TAB_FEATURE[tab]);
  });
  // Dino + Garage tabs are KEPT ALIVE after their first visit (hidden with
  // display:none, not unmounted): both host a 3D viewer whose teardown/
  // rebuild made tab switching visibly laggy. First visit still lazy-mounts
  // so an untouched tab costs nothing.
  let visitedDino = $state(false);
  let visitedGarage = $state(false);
  $effect(() => {
    if (tab === "dino") visitedDino = true;
    if (tab === "garage") visitedGarage = true;
  });
  let dataStatus = $state<DataStatus | null>(null);
  let exclusiveFullscreen = $state(false);
  let failedHotkeys = $state<FailedHotkey[]>([]);
  let ready = $state(false);
  // Remount FullMap when the basemap changes ({#key} below): the imageOverlay
  // bounds and every layer's px change together, so a rebuild IS the correct
  // "in-place" update. Seeded before ready=true — no spurious first remount.
  let basemapSource = $state("vulnona");

  // Update prompt: silent check on launch, non-blocking banner, only ever in
  // this window — never over the game.
  let updateVersion = $state<string | null>(null);
  let updating = $state(false);
  let pendingUpdate: import("@tauri-apps/plugin-updater").Update | null = null;

  async function checkForUpdate() {
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      if (update) {
        pendingUpdate = update;
        updateVersion = update.version;
      }
    } catch {
      // Offline or endpoint not set up yet — stay silent.
    }
  }

  async function installUpdate() {
    if (!pendingUpdate) return;
    updating = true;
    try {
      await pendingUpdate.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch {
      updating = false;
    }
  }

  // POIs are optional (fail-soft: the map works without dots); the basemap
  // images are the hard requirement.
  const dataOk = $derived(
    dataStatus !== null && dataStatus.basemapMinimap && dataStatus.basemapFullmap,
  );

  onMount(() => {
    const bag = listenerBag();
    (async () => {
      const settings = await getSettings();
      locale.set((settings.language as Locale) ?? "vi");
      basemapSource = settings.map?.basemap ?? "vulnona";
      dataStatus = await getDataStatus();
      exclusiveFullscreen = (await getFullscreenMode()) === 0;
      await bag.add(
        onSettingsChanged((s) => {
          locale.set((s.language as Locale) ?? "vi");
          basemapSource = s.map?.basemap ?? "vulnona";
        }),
      );
      await bag.add(onHotkeyFailed((failed) => (failedHotkeys = failed)));
      // Full-map hotkey mid-game: land on the map, not the last-open tab.
      await bag.add(onFullmapShow(() => (tab = "map")));
      // The download can finish while the user is on another tab (FirstRun
      // unmounted) — the App itself must notice and unlock the map tab.
      await bag.add(onFetchFinished(() => void getDataStatus().then((d) => (dataStatus = d))));
      ready = true;
      void checkForUpdate();
    })();
    return () => bag.dispose();
  });

  // Dev-only: walk south-east to exercise the pipeline without the game.
  let simX = -231654;
  function simulateStep() {
    simX += 30_000;
    void simulatePosition(simX, 52099.673, 0);
  }
</script>

<div class="flex h-screen flex-col">
  <header
    class="flex shrink-0 items-center gap-1 border-b px-3 py-1.5"
    style="border-color: var(--color-border); background: var(--color-panel)"
  >
    <span class="mr-3 font-semibold" style="color: var(--color-accent)">
      {$t("app.title")}
    </span>
    {#each [["map", $t("tab.map")], ["dino", $t("tab.dino")], ["garage", $t("tab.garage")], ["settings", $t("tab.settings")], ["guide", $t("tab.guide")], ["donate", $t("tab.donate")]] as [key, label] (key)}
      <button
        class="flex cursor-pointer items-center gap-1.5 rounded px-3 py-1 text-sm"
        style={tab === key
          ? "background: var(--color-accent); color: var(--color-bg); font-weight: 600"
          : "color: var(--color-muted)"}
        onclick={() => (tab = key as Tab)}
      >
        <svg
          viewBox="0 0 24 24"
          class="h-4 w-4 shrink-0"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          {@html TAB_ICONS[key as Tab]}
        </svg>
        {label}
      </button>
    {/each}
    {#if import.meta.env.DEV}
      <button
        class="ml-auto cursor-pointer rounded border px-2 py-0.5 text-xs"
        style="border-color: var(--color-border); color: var(--color-muted)"
        onclick={simulateStep}
      >
        +300 m (dev)
      </button>
    {/if}
  </header>

  {#if updateVersion}
    <div
      class="flex shrink-0 items-center gap-3 px-3 py-2 text-sm"
      style="background: #1e3a2f; color: #a7f3d0"
    >
      {updating
        ? $t("update.installing")
        : $t("update.available", { version: updateVersion })}
      {#if !updating}
        <button
          class="cursor-pointer rounded px-2 py-0.5 font-medium"
          style="background: #34d399; color: #0b2018"
          onclick={() => void installUpdate()}
        >
          {$t("update.install")}
        </button>
        <button class="cursor-pointer underline" onclick={() => (updateVersion = null)}>
          {$t("update.later")}
        </button>
      {/if}
    </div>
  {/if}

  {#if failedHotkeys.length > 0}
    <div
      class="shrink-0 px-3 py-2 text-sm"
      style="background: #4a1a10; color: #ffb4a1"
    >
      ⚠ {$t("warn.hotkey_failed")}
      {failedHotkeys
        .map((f) => `${f.spec} (${$t(`hotkey.${f.action}` as never)})`)
        .join(", ")}
      <button
        class="ml-2 cursor-pointer underline"
        onclick={() => (failedHotkeys = [])}
      >
        {$t("btn.close")}
      </button>
    </div>
  {/if}

  {#if exclusiveFullscreen}
    <div
      class="shrink-0 px-3 py-2 text-sm"
      style="background: #4a3210; color: #ffd591"
    >
      ⚠ {$t("warn.exclusive_fullscreen")}
      <button
        class="ml-2 cursor-pointer underline"
        onclick={() => (exclusiveFullscreen = false)}
      >
        {$t("btn.close")}
      </button>
    </div>
  {/if}

  <main class="min-h-0 flex-1">
    {#if !ready}
      <div class="p-6" style="color: var(--color-muted)">…</div>
    {:else if tab === "map"}
      <!-- Only the map needs the downloaded data; the other tabs must stay
           usable during (and before) the first-run download. -->
      {#if !dataOk}
        <FirstRun oncomplete={() => void getDataStatus().then((d) => (dataStatus = d))} />
      {:else}
        <!-- Error-isolated like DinoTab: a Leaflet throw must not take the
             whole shell (and its tab bar) down with it. -->
        {#key basemapSource}
          <svelte:boundary>
            <FullMap />
            {#snippet failed(_error, reset)}
              <div class="mx-auto max-w-lg p-8">
                <p class="mb-3 text-sm" style="color: #ff8a80">{$t("map.crashed")}</p>
                <button
                  class="cursor-pointer rounded border px-3 py-1 text-sm"
                  style="border-color: var(--color-border)"
                  onclick={reset}
                >
                  {$t("btn.retry")}
                </button>
              </div>
            {/snippet}
          </svelte:boundary>
        {/key}
      {/if}
    {:else if tab === "settings"}
      <div class="h-full overflow-y-auto"><Settings /></div>
    {:else if tab === "donate"}
      <div class="h-full overflow-y-auto"><Donate /></div>
    {:else if tab === "guide"}
      <div class="h-full overflow-y-auto"><Guide /></div>
    {/if}
    <!-- Kept-alive tabs (see visitedDino/visitedGarage above). Both are
         error-isolated: a failure in the IslePilot integration or the 3D
         viewer must never take down the map or any other feature. -->
    {#if ready && visitedDino}
      <div class="h-full overflow-y-auto" style:display={tab === "dino" ? null : "none"}>
        <svelte:boundary>
          <DinoTab />
          {#snippet failed(_error, reset)}
            <div class="mx-auto max-w-lg p-8">
              <p class="mb-3 text-sm" style="color: #ff8a80">{$t("dino.crashed")}</p>
              <button
                class="cursor-pointer rounded border px-3 py-1 text-sm"
                style="border-color: var(--color-border)"
                onclick={reset}
              >
                {$t("btn.retry")}
              </button>
            </div>
          {/snippet}
        </svelte:boundary>
      </div>
    {/if}
    {#if ready && visitedGarage}
      <div class="h-full overflow-y-auto" style:display={tab === "garage" ? null : "none"}>
        <svelte:boundary>
          <GarageTab />
          {#snippet failed(_error, reset)}
            <div class="mx-auto max-w-lg p-8">
              <p class="mb-3 text-sm" style="color: #ff8a80">{$t("dino.crashed")}</p>
              <button
                class="cursor-pointer rounded border px-3 py-1 text-sm"
                style="border-color: var(--color-border)"
                onclick={reset}
              >
                {$t("btn.retry")}
              </button>
            </div>
          {/snippet}
        </svelte:boundary>
      </div>
    {/if}
  </main>

  <Footer />
</div>
