# CraftDock

A desktop Minecraft server manager for Windows with 15 server types:

| Java: plugins | Java: mods | Mods + plugins | Network | Bedrock |
|---|---|---|---|---|
| Vanilla, Paper, Purpur, Folia, Leaf, Spigot (BuildTools), SpongeVanilla | Fabric, Quilt, Forge, NeoForge | Mohist (Forge), Youer (NeoForge) | Velocity proxy | Bedrock Dedicated Server |

## Features

**Servers**
- One-click creation with the right Java (Temurin 8/17/21/25, a JDK for Spigot's BuildTools) downloaded automatically
- Any version, including snapshots, Bedrock previews and Velocity snapshot builds
- World presets (Survival, Friends SMP, Creative, Superflat, Hardcore, Amplified…) with seed, world type, structures, whitelist, PvP and online-mode options
- Start a new server from an existing singleplayer world
- Import existing servers from a folder or .zip (type, Minecraft and loader version detected from jars, manifests and libraries)
- Export a server as a .zip, duplicate it, change its version, update its build automatically before each start

**Worlds**
- Worlds tab: active world details (version, game mode, seed, size, dimensions), switch between worlds, rename, reset with a new seed/type, download as .zip/.mcworld, copy to your singleplayer saves
- Import singleplayer worlds found in the Minecraft Launcher, Prism, Modrinth App, CurseForge, ATLauncher, GDLauncher and Bedrock for Windows, or from any folder/.zip/.mcworld
- Converts between the singleplayer layout and Paper's split Nether/End folders
- Game rule editor that reads the world files (old camelCase rules, 26.x `game_rules.dat`, and Bedrock), applying changes live when the server is running

**Content**
- Mods, plugins and datapacks from **Modrinth** and **CurseForge** with categories, project pages (description, gallery, changelogs) and update checks
- Mohist/Youer servers manage mods and plugins side by side; datapacks on every Java server
- Bedrock add-ons (.mcpack / .mcaddon) turned on per world
- Performance mods matched to the exact Minecraft version, auto-updates before start
- **Geyser + Floodgate cross-play** (plus ViaVersion on older versions), set up for Bedrock's NetherNet connections automatically

**Running**
- Live CPU, RAM, players and **TPS / MSPT** charts (TPS answers are hidden from the console), activity timeline, server-list (MOTD) preview
- Colored console (Minecraft § codes and ANSI), editable quick-command buttons, log file browser with mclo.gs sharing
- Players: online list, full history with playtime, first/last seen, kick/ban reasons, private messages, whitelist/allowlist switch
- Schedule: scheduled tasks (commands, chat messages, restarts/stops with countdown, starts, backups) every N minutes or at set times on chosen days, startup commands, automatic restarts and backups
- World or full-server backups with notes, restore, optional custom backup folder
- Discord webhook notifications (online, stopped, crashes, joins, leaves, backups)
- Velocity network builder: link CraftDock servers into a proxy network with modern forwarding configured on Paper/Purpur/Leaf/Folia (paper-global.yml) and Fabric/Quilt (FabricProxy-Lite)
- playit.gg public addresses, crash helper, CPU priority, Java version override, extra JVM/server arguments

**App**
- Themes (Dark, Midnight, Ocean, Forest, Light, match Windows), any accent color, interface size, compact layout, console font size/colors/wrapping, reduced motion
- Dashboard with totals, search, filters, card/list view, Start all / Stop all; pin servers; sidebar search and sorting
- Ctrl+K command palette, right-click server menus, keyboard shortcuts, tray menu, Windows notifications, launch at startup

## Run from source

```bash
npm install
npm start
```

## Build the Windows installer

```bash
npm run dist
```

The installer is written to `dist/CraftDock Setup <version>.exe`. Running a newer installer upgrades in place:
it asks the running CraftDock to stop all servers cleanly (`--quit-for-update`, see `build/installer.nsh`),
replaces the old version, and keeps all servers and settings in `%APPDATA%\CraftDock`.

If the build fails with `!include: could not open file`, the project folder path is too long for NSIS
(260-character limit). Copy the project (without `node_modules`) to a short folder, `npm install`, and build there.

## Where things are stored

Servers, Java runtimes and backups: `%APPDATA%\CraftDock` (each server has its own folder, see the folder button in the app).
Temporary files and the BuildTools cache: `C:\ProgramData\CraftDock` (Java and BuildTools can't use paths with special characters).
CurseForge needs a free API key from https://console.curseforge.com, which you paste into App settings. It's stored encrypted.

## Notes on Bedrock and NetherNet

Bedrock 26.60 (October 27, 2026) only connects over NetherNet, which uses TCP and UDP on the server port.
CraftDock switches Geyser to NetherNet automatically (one automatic restart on its first start). Geyser's
NetherNet support needs a current server version; on older Paper versions it can't start its signaling service.
playit.gg's free Bedrock tunnels currently only carry RakNet; Bedrock servers have a "Connection method" setting for that.

## Code map

- `main.js` – window, tray, settings and IPC
- `src/backend/types.js` – the 15 server types and what each supports
- `src/backend/versions.js` – version lists (Mojang, PaperMC Fill, Purpur, Leaf, Mohist, Spigot, Sponge, Fabric, Quilt, Forge, NeoForge, Bedrock)
- `src/backend/installer.js` – downloads/installs server software, works out launch arguments
- `src/backend/servers.js` – server instances, process control, stats, TPS, tasks, webhooks, player history, backups, worlds, Velocity network
- `src/backend/worlds.js` + `nbt.js` – world listing/import/export, game rules (NBT reader/writer)
- `src/backend/bedrock.js` – Bedrock add-ons
- `src/backend/velocity.js` – velocity.toml and backend forwarding setup
- `src/backend/mods.js` – Modrinth / CurseForge search, install, updates, Geyser
- `src/backend/importer.js` – detects the type/version of an existing server folder
- `src/backend/tps.js`, `webhook.js`, `modpack.js`, `playit.js`, `java.js`, `archive.js`, `ping.js`, `monitor.js`
- `renderer/` – the UI (plain HTML/CSS/JS, no build step), one file per screen

## License

MIT. See [LICENSE](LICENSE).
