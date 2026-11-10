/**
 * Installed with Playwright's init script, before any app module runs.
 * `src/lib/tauri.ts` treats a window with `__TAURI_INTERNALS__` as the desktop
 * app and routes `invoke` / `listen` through this object instead of the
 * browser stubs.
 *
 * Per-test switches live on `window.__WINFYND_TEST__` (seeded from the URL,
 * mutable afterwards) and every command is appended to `window.__WINFYND_CALLS__`.
 */
export function installTauriMock() {
  const params = new URLSearchParams(location.search);
  const w = window as unknown as {
    __WINFYND_TEST__: { search: string; ollama: string; state: string; transcribe: string };
    __WINFYND_CALLS__: { cmd: string; args: unknown }[];
    __TAURI_INTERNALS__: Record<string, unknown>;
    __TAURI_EVENT_PLUGIN_INTERNALS__: Record<string, unknown>;
  };

  w.__WINFYND_TEST__ = {
    search: params.get("search") || "ok",
    ollama: params.get("ollama") || "ok",
    state: params.get("state") || "idle",
    transcribe: params.get("transcribe") || "quarterly budget slides",
  };
  w.__WINFYND_CALLS__ = [];

  const callbacks = new Map<number, (data: unknown) => void>();
  let nextId = 1;
  const listeners = new Map<string, number[]>();

  function transformCallback(callback: (data: unknown) => void, once = false) {
    const id = nextId++;
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      return callback?.(data);
    });
    return id;
  }

  const roots = [
    "C:\\Users\\gupta\\Documents",
    "C:\\Users\\gupta\\Pictures",
    "C:\\Users\\gupta\\OneDrive\\Desktop",
    "C:\\Users\\gupta\\Downloads",
  ];

  // Rust `EngineConfig::default`, plus the folders first-run setup would offer.
  // `speechModel` stays empty until setup turns Whisper on.
  let config: Record<string, unknown> = {
    wholePc: true,
    roots,
    skip: [],
    embedBackend: "builtin",
    ollamaUrl: "http://127.0.0.1:11434",
    embedModel: "embeddinggemma-2",
    dimensions: 768,
    chatModel: "",
    indexImages: true,
    speechModel: "",
    indexVideoFrames: true,
    readOnlineFiles: false,
  };

  let hotkeys = {
    launcher: "Alt+Space",
    voice: "Alt+Shift+Space",
    ask: "Alt+Shift+A",
    selection: "Alt+Shift+F",
    voiceMode: "hold",
    autoSubmit: true,
  };

  const drives = [
    { path: "C:\\", label: "Windows", totalBytes: 953 * 2 ** 30, freeBytes: 541 * 2 ** 30, system: true },
    { path: "D:\\", label: "Data", totalBytes: Math.round(1.8 * 2 ** 40), freeBytes: Math.round(1.1 * 2 ** 40), system: false },
  ];

  const kinds = { document: 9412, image: 21903, code: 6904, spreadsheet: 1288, slides: 640, audio: 312, video: 187, other: 10558 };

  const receiptHits = [
    {
      id: 1,
      kind: "document",
      name: "Northwind_Order_88412.pdf",
      path: "C:\\Users\\gupta\\Documents\\Home\\Receipts\\Northwind_Order_88412.pdf",
      size: 188416,
      modified: 1773519720,
      location: "Page 2",
      snippet: "Harlow 3-seat sofa, navy velvet · 1 · $1,240.00. Total paid $1,393.00.",
      reason: "Exact words on page 2",
      confident: true,
    },
    {
      id: 2,
      kind: "image",
      name: "IMG_2041.jpg",
      path: "C:\\Users\\gupta\\Pictures\\Receipts\\IMG_2041.jpg",
      size: 2900000,
      modified: 1773520800,
      location: null,
      snippet: null,
      reason: "Image matches your search",
      confident: true,
    },
    {
      id: 3,
      kind: "spreadsheet",
      name: "Living room budget.xlsx",
      path: "C:\\Users\\gupta\\Documents\\Home\\Living room budget.xlsx",
      size: 24000,
      modified: 1772435400,
      location: "Sheet Furniture",
      snippet: "Row 14: Sofa $1,240, cushions $64, delivery $89.",
      reason: "Exact words on sheet furniture",
      confident: true,
    },
    {
      id: 4,
      kind: "document",
      name: "Moving checklist.docx",
      path: "C:\\Users\\gupta\\Documents\\Home\\Moving checklist.docx",
      size: 19000,
      modified: 1772146920,
      location: null,
      snippet: "Book sofa delivery window and measure the hallway.",
      reason: "Exact words match",
      confident: true,
    },
  ];

  function status() {
    const state = w.__WINFYND_TEST__.state;
    const idle = state === "idle";
    return {
      state,
      files: 12840,
      chunks: 96211,
      queued: idle ? 0 : 38364,
      done: idle ? 0 : 12840,
      current: idle ? null : "C:\\Users\\gupta\\Documents\\notes.md",
      ollama: w.__WINFYND_TEST__.ollama,
      message: null,
      unreadable: 0,
      pausedUntil: null,
    };
  }

  function folderStats(path: string) {
    return { path, files: 1200, kinds: { document: 800, image: 400 }, partial: false };
  }

  function logged(cmd: string, args: Record<string, unknown> | undefined) {
    let stored: unknown = {};
    if (cmd === "transcribe_voice") {
      const samples = args?.samples;
      stored = { samples: Array.isArray(samples) ? samples.length : 0 };
    } else {
      try {
        stored = JSON.parse(JSON.stringify(args ?? {}));
      } catch {
        stored = {};
      }
    }
    w.__WINFYND_CALLS__.push({ cmd, args: stored });
  }

  async function invoke(cmd: string, args: Record<string, unknown> = {}) {
    logged(cmd, args);
    const test = w.__WINFYND_TEST__;

    if (cmd === "plugin:event|listen") {
      const event = String(args.event);
      const list = listeners.get(event) ?? [];
      list.push(args.handler as number);
      listeners.set(event, list);
      return args.handler;
    }
    if (cmd === "plugin:event|unlisten") {
      const event = String(args.event);
      const list = listeners.get(event);
      if (list) {
        const at = list.indexOf(args.eventId as number);
        if (at >= 0) list.splice(at, 1);
      }
      return null;
    }
    if (cmd === "plugin:event|emit") {
      const event = String(args.event);
      for (const id of listeners.get(event) ?? []) {
        callbacks.get(id)?.({ event, id, payload: args.payload });
      }
      return null;
    }
    if (cmd === "plugin:dialog|message") {
      const buttons = args.buttons as { OkCancelCustom?: string[] } | string | undefined;
      if (buttons && typeof buttons === "object" && buttons.OkCancelCustom) return buttons.OkCancelCustom[0];
      if (buttons === "YesNo") return "Yes";
      return "Ok";
    }
    if (cmd === "plugin:dialog|open" || cmd === "plugin:dialog|save") return null;
    if (cmd === "plugin:window|is_maximized") return false;
    if (cmd === "plugin:window|scale_factor") return 1;
    if (cmd === "plugin:window|inner_size" || cmd === "plugin:window|outer_size") return { width: 960, height: 640 };
    if (cmd === "plugin:window|inner_position" || cmd === "plugin:window|outer_position") return { x: 0, y: 0 };
    if (cmd === "plugin:window|theme") return "light";
    if (cmd.startsWith("plugin:window|")) return null;
    if (cmd === "plugin:app|version") return "0.1.1";
    if (cmd === "plugin:app|name") return "WinFynd";
    if (cmd === "plugin:app|identifier") return "com.winfynd.app";
    if (cmd.startsWith("plugin:")) return null;

    switch (cmd) {
      case "appearance":
        return { accent: [], backdrop: "none" };
      case "shell_image":
        return null;
      case "engine_status":
        return status();
      case "get_engine_config":
        return config;
      case "set_engine_config":
        config = { ...(args.config as Record<string, unknown>) };
        return config;
      case "search": {
        if (test.search === "error") throw new Error("The index isn't ready");
        const query = String(args.query ?? "").toLowerCase();
        const hit = test.search === "empty" ? false : /receipt|sofa|budget/.test(query);
        return {
          hits: hit ? receiptHits : [],
          semantic: test.ollama === "ok",
          filters: [],
        };
      }
      case "ask":
        if (test.ollama === "offline") throw new Error("Ollama isn't running");
        return {
          text: "The sofa was **$1,240** [1].",
          sources: [{ n: 1, name: "Northwind_Order_88412.pdf", path: receiptHits[0].path, location: "Page 2" }],
          model: "llama3.2:3b",
        };
      case "open_path":
      case "reveal_path":
      case "hide_launcher_cmd":
      case "open_control_center":
      case "rescan":
      case "pull_model":
      case "download_speech_model":
      case "finish_onboarding":
      case "open_ollama_download":
      case "try_launcher":
      case "watch_first_index":
      case "pause_indexing":
      case "delete_index":
      case "open_link":
      case "run_setup":
      case "suspend_hotkeys":
        return null;
      case "transcribe_voice":
        return test.transcribe;
      case "online_only":
        return ((args.paths as unknown[]) ?? []).map(() => false);
      case "list_models":
        return {
          installed: [
            { name: "embeddinggemma-2", size: 865_000_000 },
            { name: "llama3.2:3b", size: 2_019_000_000 },
          ],
          error: test.ollama === "offline" ? "connection refused" : null,
          ollama: test.ollama !== "offline",
        };
      case "media_support":
        return {
          speechModels: [
            { id: "base", label: "Whisper Base", sizeMb: 148, note: "Fastest; fine for clear speech", installed: false },
            { id: "small", label: "Whisper Small", sizeMb: 488, note: "Balanced speed and accuracy", installed: true },
            { id: "large-v3-turbo-q5_0", label: "Whisper Large v3 Turbo", sizeMb: 574, note: "Most accurate", installed: false },
          ],
          ffmpeg: "C:\\ffmpeg\\bin\\ffmpeg.exe",
          ffmpegVersion: "7.1",
        };
      case "get_hotkeys":
        return { config: hotkeys, unavailable: [] };
      case "set_hotkey": {
        hotkeys = { ...hotkeys, [String(args.action)]: String(args.accelerator) };
        return hotkeys;
      }
      case "set_voice_options":
        hotkeys = { ...hotkeys, voiceMode: args.voiceMode as string, autoSubmit: Boolean(args.autoSubmit) };
        return hotkeys;
      case "index_stats":
        return { kinds, folders: [{ path: "C:\\", files: 40000, kinds, partial: false }], indexBytes: 2_470_000_000 };
      case "list_drives":
        return drives;
      case "estimate_folders":
        return ((args.paths as string[]) ?? []).map(folderStats);
      case "ollama_info":
        return { version: test.ollama === "offline" ? null : "0.12.3" };
      case "start_with_windows":
        return true;
      case "set_start_with_windows":
        return Boolean(args.on);
      case "latest_release":
        return { version: "0.1.1", url: "https://github.com/priyansh19/WinFynd/releases/tag/v0.1.1", newer: false };
      default:
        throw new Error(`No mock for ${cmd}`);
    }
  }

  w.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    convertFileSrc(filePath: string, protocol = "asset") {
      return `http://${protocol}.localhost/${encodeURIComponent(filePath)}`;
    },
    transformCallback,
    unregisterCallback: (id: number) => callbacks.delete(id),
    runCallback(id: number, data: unknown) {
      callbacks.get(id)?.(data);
    },
    callbacks,
    invoke,
  };
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(_event: string, id: number) {
      callbacks.delete(id);
    },
  };

  // The voice button drives the real recorder. A generated tone stands in for
  // the microphone so `transcribe_voice` is reached without a hardware device.
  const media = navigator.mediaDevices;
  if (media) {
    media.getUserMedia = async () => {
      const ctx = new AudioContext();
      if (ctx.state === "suspended") await ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.2;
      const dest = ctx.createMediaStreamDestination();
      osc.frequency.value = 440;
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      return dest.stream;
    };
  }
}
