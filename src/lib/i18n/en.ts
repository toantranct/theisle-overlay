// English translations. Typed as Record<MsgKey, string>: a missing key is a
// COMPILE error, so the two languages cannot drift apart.

import type { MsgKey } from "./vi";

export const en: Record<MsgKey, string> = {
  "app.title": "The Isle Map",
  "app.minimap_title": "Minimap",
  "app.fullmap_title": "Gateway Map",

  "tab.map": "Map",
  "tab.dino": "Your Dino",
  "tab.settings": "Settings",
  "tab.garage": "Garage",
  "tab.guide": "Guide",
  "tab.donate": "Donate",

  "pos.none": "No position yet",
  "pos.hint":
    "In game press Tab, then click “Asset Location” in the top-right corner to copy your coordinates.",
  "pos.off_map": "Off the map",

  "dir.N": "North",
  "dir.NE": "North-East",
  "dir.E": "East",
  "dir.SE": "South-East",
  "dir.S": "South",
  "dir.SW": "South-West",
  "dir.W": "West",
  "dir.NW": "North-West",
  "heading.unknown": "Heading unknown",
  "heading.hint": "Copy your coordinates again after moving to reveal your heading.",

  "layer.freshwater": "Fresh water",
  "layer.water": "Water",
  "layer.sanctuary": "Sanctuaries",
  "layer.migration": "Migration zones",
  "layer.saltlick": "Salt licks",
  "layer.mudwallow": "Mud wallows",
  "layer.food": "Food zones",
  "layer.patrol": "AI patrol zones",
  "layer.region": "Region names",
  "layer.landmark": "Landmarks",
  "layer.animal": "Animals",
  "layers.title": "Map layers",
  "layers.zone_labels": "Zone name labels",
  "layers.collapse": "Collapse",
  "layers.expand": "Expand",

  "wp.title": "Waypoints",
  "wp.new": "New waypoint",
  "wp.add": "Add waypoint",
  "wp.remove": "Delete",
  "wp.rename": "Rename",
  "wp.name_prompt": "Waypoint name:",
  "wp.empty": "No waypoints yet. Right-click the map to add one.",
  "wp.distance": "{dir} · {dist}",
  "wp.here": "My position",
  "wp.confirm_delete": "Delete waypoint “{name}”?",
  "wp.color": "Change color",

  "search.placeholder": "Search places or paste coords…",
  "search.goto_coords": "Go to these coordinates",
  "search.no_results": "No matches",
  "search.coords_failed": "Could not parse the coordinates — check the pasted text",
  "map.recenter": "Back to my position",

  "trail.title": "Travelled path",
  "trail.previous": "Previous session path",
  "trail.clear": "Clear trail",
  "trail.clear_hint":
    "Clears the lines on both maps to declutter; the history files on disk are kept.",

  "btn.close": "Close",
  "btn.ok": "OK",
  "btn.cancel": "Cancel",
  "btn.save": "Save",

  "warn.exclusive_fullscreen":
    "The game is running in exclusive Fullscreen mode. The minimap cannot draw on top of it. " +
    "In the game go to Settings › Video and switch to “Windowed” or “Borderless Fullscreen”.",
  "warn.hotkey_failed":
    "The following hotkeys could not be registered because another app holds them:",
  "warn.no_data": "No map data on this machine yet. It needs to be downloaded once before use.",

  "hotkey.toggle_minimap": "Show/hide minimap",
  "hotkey.toggle_fullmap": "Open/close full map",
  "hotkey.toggle_click_through": "Toggle click-through",
  "hotkey.mark_here": "Mark current position",
  "hotkey.opacity_up": "Minimap more opaque",
  "hotkey.opacity_down": "Minimap more transparent",
  "hotkey.zoom_in": "Zoom view in",
  "hotkey.reload_ui": "Reload the UI (if it freezes)",
  "hotkey.zoom_out": "Zoom view out",
  "hotkey.toggle_quests": "Show/hide the Prime quests panel",

  "settings.language": "Ngôn ngữ · Language",
  "settings.minimap": "Minimap",
  "settings.visible": "Show minimap",
  "settings.require_game": "Only show while you are in the game (hides on Alt-Tab)",
  "settings.click_through": "Click-through (never blocks gameplay)",
  "settings.show_trail": "Show the trail on the minimap",
  "settings.show_waypoints": "Show waypoints on the minimap",
  "settings.corner": "Anchor corner on the game window",
  "corner.top-left": "Top left",
  "corner.top-right": "Top right",
  "corner.bottom-left": "Bottom left",
  "corner.bottom-right": "Bottom right",
  "settings.size": "Size",
  "settings.margin": "Margin",
  "settings.opacity": "Opacity",
  "settings.radius": "View radius",
  "settings.hotkeys": "Hotkeys",
  "settings.hotkeys_hint":
    "Click a key field, then press the new combination. At least one modifier (Ctrl/Alt/Shift/Win) is required.",
  "settings.press_keys": "Press keys… (Esc to cancel)",
  "settings.hotkey_in_use": "This combination is held by another application",
  "settings.hotkey_duplicate": "Duplicates another hotkey in this app",
  "settings.hotkey_invalid": "Invalid combination — at least one modifier required",
  "settings.number_format": "Coordinate number format",
  "format.auto": "Auto-detect",
  "format.us": "US style — 1,234.5",
  "format.eu": "EU style — 1.234,5",
  "settings.data": "Data",
  "settings.open_trails": "Open trails folder",
  "settings.redownload": "Re-download map data",
  "settings.basemap": "Basemap style",
  "basemap.vulnona": "Vulnona (default)",
  "basemap.islemaps_light": "IsleMaps — light",
  "basemap.islemaps_dark": "IsleMaps — dark",
  "basemap.hint":
    "Applies to both the full map and the minimap. The first selection downloads " +
    "the imagery (~5–7 MB) — offline afterwards. The IsleMaps art tracks a newer " +
    "game build and shows the SE archipelago (Hell's Mouth).",
  "basemap.downloading": "Downloading imagery…",
  "basemap.failed":
    "Imagery download failed — check your connection and retry. The current basemap stays.",

  "firstrun.title": "Download map data",
  "firstrun.explain":
    "The app needs to download the basemap (~3 MB) and point data to your machine once. " +
    "Data is fetched straight from its sources instead of being bundled — it is a personal " +
    "copy on your machine, not a redistribution.",
  "firstrun.start": "Start download",
  "firstrun.downloading": "Downloading…",
  "firstrun.done": "Done! Opening the map…",
  "firstrun.partial":
    "The basemap downloaded but the point data failed. The map still works; " +
    "retry the data download from Settings later.",
  "firstrun.failed": "Download failed. Check your connection and try again.",
  "firstrun.retry": "Retry",
  "firstrun.continue": "Continue with the map",

  "dino.title": "Your dino",
  "dino.explain":
    "Reads your OWN dino's info from the server's IslePilot panel (growth, health, hunger, " +
    "thirst, Prime progress). It is just an HTTPS connection to the server's website — " +
    "nothing touches the game, anti-cheat safe.",
  "dino.server": "Server",
  "dino.login": "Sign in with Steam",
  "dino.login_wait": "Waiting for you to sign in in the window that just opened…",
  "dino.login_failed": "Sign-in did not complete. Try again.",
  "dino.logged_in": "Signed in",
  "dino.logout": "Sign out",
  "dino.auth_expired": "Your session expired — please sign in again.",
  "dino.supported_servers":
    "Works with any IslePilot-powered server — xxx.islepilot.eu or islepilot.eu/p/server-name. " +
    "See the Guide tab for examples and a step-by-step walkthrough.",
  "dino.manual_cookie": "Paste your session cookie",
  "dino.manual_cookie_hint":
    "Open the server page in your browser and sign in with Steam. Press F12 → " +
    "Application tab (Chrome) or Storage (Firefox) → Cookies → pick the server domain → " +
    "find the cookie named islepilot_player and paste its Value here.",
  "dino.cancel_login": "Cancel sign-in",
  "dino.manual_cookie_save": "Verify & save cookie",
  "dino.manual_cookie_checking": "Checking cookie…",
  "dino.manual_cookie_bad":
    "Cookie invalid or session not signed in — double-check the pasted string.",
  "dino.server_settings": "Server settings",
  "dino.token_login": "Steam login (once, works on every server)",
  "dino.token_login_hint":
    "Sign in through islepilot.eu ONCE — the token works on EVERY IslePilot server " +
    "(mixi, hoho, sdvn…), no server URL or cookie copying needed. Switch servers in game " +
    "and the data follows automatically.",
  "dino.token_paste": "Or paste the token manually",
  "dino.token_paste_hint":
    "If the login window fails to catch the token: paste the overlay token (or the whole " +
    "theisle-overlay://… / isle-overlay://… link) here.",
  "dino.token_save": "Verify & save token",
  "dino.token_checking": "Checking token…",
  "dino.token_bad": "Token invalid — double-check the pasted string.",
  "dino.legacy_section": "Legacy: server URL + cookie (fallback)",
  "dino.legacy_hint":
    "Only needed when the new login does not work with your server. Cookies are stored " +
    "per server.",
  "dino.live_map_yes": "This server has a live map — your position updates automatically",
  "dino.live_map_checking": "Checking whether this server has a live map…",
  "dino.enabled": "Track dino info",
  "dino.interval": "Update frequency",
  "dino.overlay_panel": "Show stats strip under the minimap",
  "dino.quests_panel": "Show Prime quests under the minimap",
  "dino.use_map_position":
    "Auto position from the server's live map (instead of manual coordinate copying)",
  "dino.rules_note":
    "⚠ Ask the server admins before using this routinely — some servers have their own " +
    "rules about third-party tools. Everything shown is your own data, served by the " +
    "server's own panel.",
  "dino.growth": "Growth",
  "dino.health": "Health",
  "dino.hunger": "Hunger",
  "dino.thirst": "Thirst",
  "dino.stamina": "Stamina",
  "dino.nutrition": "Nutrition",
  "dino.nutrition_carb": "Carbs",
  "dino.nutrition_protein": "Protein",
  "dino.nutrition_lipid": "Lipids",
  "dino.server_playing": "Server",
  "dino.sex_female": "Female",
  "dino.sex_male": "Male",
  "dino.prime": "Prime progress",
  "dino.online": "Online",
  "dino.offline": "Offline",
  "dino.updated": "Updated {time}",
  "dino.no_data": "No data yet — enable tracking and wait for the first update.",
  "dino.fetch_error": "Panel connection error:",
  "dino.layout_changed":
    "IslePilot just deployed a new version — if numbers look wrong, their markup may have " +
    "changed and the app needs an update.",
  "dino.map_disabled": "The live map is disabled on this server.",
  "dino.crashed":
    "The Your Dino section hit an error and was isolated — the map and other features are unaffected.",

  "garage.title": "Garage (Gacha)",
  "garage.hint":
    "Dinos parked in the server's garage. Park/Restore can take up to ~60 seconds — the " +
    "server processes commands asynchronously.",
  "garage.refresh": "Refresh",
  "garage.park": "Park current dino",
  "garage.restore": "Restore",
  "garage.sell": "Sell",
  "garage.rename": "Rename",
  "garage.rename_prompt": "New name for this dino:",
  "garage.confirm_restore": "Restore “{name}”? Your current dino may be replaced.",
  "garage.confirm_sell": "Sell “{name}”? This cannot be undone.",
  "garage.empty": "The garage is empty.",
  "garage.busy": "Sending command to the server… (up to ~60 s)",
  "garage.error": "Command failed:",
  "garage.sold": "Sold — received {amount} {currency}",
  "garage.done": "Done!",
  "garage.need_token":
    "The Garage needs the one-time Steam login via IslePilot — sign in from the " +
    "Your Dino tab. The legacy server + cookie flow cannot use the Garage.",
  "garage.unsupported":
    "Could not load the Garage — the server you are playing on may not support it.",
  "garage.updated":
    "Updated {time} · auto-refreshes every 10 minutes — press Refresh for now.",

  "dino3d.loading": "Loading 3D model…",
  "dino3d.no_model": "No 3D model for this species yet.",
  "dino3d.error": "Could not load the 3D model — check your connection and retry.",

  "layer.islepilot": "Server POIs (IslePilot)",
  "poi.islepilot_discord":
    "Link your Discord account with IslePilot to unlock the server map.",
  "poi.islepilot_disabled": "The live map is disabled on this server.",
  "poi.islepilot_login": "Log in with a token (Your Dino tab) to show server POIs.",
  "poi.islepilot_empty": "This server has no POIs yet.",
  "map.crashed":
    "The map hit a display error. Click Retry, or press F5 to reload the whole app.",
  "btn.retry": "Retry",

  "update.available": "Update {version} available",
  "update.install": "Update now",
  "update.installing": "Downloading update…",
  "update.later": "Later",

  "footer.developed_by": "Developed by",
  "footer.donate": "Donate",
  "footer.reload_hint": "If the app breaks, press F5 or Ctrl+Alt+R to reload",
  "donate.title": "Support the author",
  "donate.hint": "Scan the VietQR code with your banking app, or transfer manually:",
  "donate.copy_stk": "Copy account number",
  "donate.copied": "Copied!",
  "donate.thanks": "Thank you for your support! ❤",


  "telemetry.title": "Usage data & feedback",
  "telemetry.enabled": "Send anonymous usage data",
  "telemetry.hint":
    "Only this: a random install id, the app version, the Windows build " +
    "number, the UI language, and how many times each feature was used. No " +
    "IP address, no in-game position, no Windows account name.",
  "feedback.title": "Send feedback",
  "feedback.cat_bug": "Bug",
  "feedback.cat_idea": "Idea",
  "feedback.cat_other": "Other",
  "feedback.body": "Description (max 2000 characters)",
  "feedback.contact": "How to reach you (optional)",
  "feedback.send": "Send",
  "feedback.sending": "Sending…",
  "feedback.sent": "Sent. Thank you!",
  "feedback.failed": "Could not send. Check your connection and try again.",
  "credits.title": "Data sources",
  "credits.body":
    "Basemap: VulnonaMAP (Coco.N) — stitched from in-game captures. " +
    "IsleMaps basemap & animal points: IsleMaps.com (Pont & Emeara). " +
    "Imagery copyright Afterthought LLC (The Isle). " +
    "Point data: VulnonaMAP, myislemap.com, wiredredman's Steam guide. " +
    "This app is not affiliated with Afterthought LLC.",
};
