import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 4180;
const DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
const PLAYER_COUNT = 4;
const TRICKS_PER_HAND = 13;
const CODEX_PLAYWRIGHT_PATH = path.join(
  homedir(),
  ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
);

function getArgValue(args, name) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  return match ? match.slice(name.length + 3) : null;
}

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

function getArgNumber(args, name, fallback, min = 0) {
  const rawValue = getArgValue(args, name);
  if (rawValue === null) return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function resolvePlaywright() {
  const candidates = [
    () => require("playwright"),
    () => {
      const moduleRoot = process.env.PLAYWRIGHT_NODE_MODULES
        ? path.join(process.env.PLAYWRIGHT_NODE_MODULES, "playwright")
        : null;
      return moduleRoot && existsSync(moduleRoot) ? require(moduleRoot) : null;
    },
    () => (existsSync(CODEX_PLAYWRIGHT_PATH) ? require(CODEX_PLAYWRIGHT_PATH) : null),
  ];

  for (const candidate of candidates) {
    try {
      const playwright = candidate();
      if (playwright?.chromium) return playwright;
    } catch {
      // Try the next resolution strategy.
    }
  }

  throw new Error("Playwright is unavailable. Install playwright or set PLAYWRIGHT_NODE_MODULES.");
}

function createOptions(args) {
  const port = getArgNumber(args, "port", DEFAULT_PORT, 1);
  const baseUrl = getArgValue(args, "url") ?? `http://127.0.0.1:${port}`;
  const forcedTimeout = hasFlag(args, "forced-timeout");
  const query = forcedTimeout ? "?strongAiTimeoutMs=0" : (getArgValue(args, "query") ?? "");

  return {
    baseUrl,
    port,
    games: getArgNumber(args, "games", 1, 1),
    handsPerGame: getArgNumber(args, "hands", 1, 1),
    maxStepsPerHand: getArgNumber(args, "max-steps-per-hand", 900, 1),
    headless: getArgValue(args, "headed") === "true" ? false : !hasFlag(args, "headed"),
    forcedTimeout,
    query,
    cpuThrottle: getArgNumber(args, "cpu-throttle", 1, 1),
    slowMo: getArgNumber(args, "slow-mo", 0, 0),
    noPreview: hasFlag(args, "no-preview") || getArgValue(args, "url") !== null,
    includeJson: !hasFlag(args, "no-json"),
    failOnFallback: hasFlag(args, "fail-on-fallback"),
    maxFallbackRate: getArgValue(args, "max-fallback-rate"),
  };
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

function pct(value) {
  return `${formatNumber(value * 100, 1)}%`;
}

async function waitForPreview(baseUrl, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Preview may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Preview did not start at ${baseUrl}`);
}

function startPreview(options) {
  if (options.noPreview) return null;

  const viteBin = path.join(PROJECT_ROOT, "node_modules/vite/bin/vite.js");
  const nodeExecutable = process.env.npm_node_execpath && existsSync(process.env.npm_node_execpath)
    ? process.env.npm_node_execpath
    : "/usr/bin/env";
  const childArgs =
    nodeExecutable === "/usr/bin/env"
      ? ["node", viteBin, "preview", "--host", "127.0.0.1", "--port", String(options.port)]
      : [viteBin, "preview", "--host", "127.0.0.1", "--port", String(options.port)];
  const child = spawn(nodeExecutable, childArgs, {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    if (process.env.HARNESS_DEBUG) process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    if (process.env.HARNESS_DEBUG) process.stderr.write(chunk);
  });

  return child;
}

function stopPreview(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
}

function readExpectedAssets() {
  const indexPath = path.join(PROJECT_ROOT, "dist/index.html");
  const serviceWorkerPath = path.join(PROJECT_ROOT, "dist/service-worker.js");
  const assetsPath = path.join(PROJECT_ROOT, "dist/assets");
  const html = readFileSync(indexPath, "utf8");
  const serviceWorker = readFileSync(serviceWorkerPath, "utf8");
  const appScript = html.match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/)?.[1] ?? null;
  const style = html.match(/<link[^>]+href="([^"]*\/assets\/index-[^"]+\.css)"/)?.[1] ?? null;
  const searchWorker = readdirSync(assetsPath).find((file) => file.startsWith("searchWorker-") && file.endsWith(".js"));
  const cacheName = serviceWorker.match(/CACHE_NAME\s*=\s*"([^"]+)"/)?.[1] ?? null;

  return {
    appScript,
    style,
    searchWorker: searchWorker ? `/assets/${searchWorker}` : null,
    cacheName,
    serviceWorkerIncludesNetworkFirstDocument:
      serviceWorker.includes('request.mode === "navigate"') && serviceWorker.includes('requestUrl.pathname === "/service-worker.js"'),
  };
}

async function clickButton(page, predicateSource, description) {
  const clicked = await page.evaluate(({ predicateSource }) => {
    const predicate = new Function("button", predicateSource);
    const isVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const button = [...document.querySelectorAll("button")].find((candidate) => {
      return !candidate.disabled && isVisible(candidate) && predicate(candidate);
    });
    if (!button) return false;
    button.click();
    return true;
  }, { predicateSource });

  if (!clicked) return false;
  await page.waitForTimeout(80);
  return true;
}

async function clickButtonText(page, text) {
  return clickButton(page, `return button.textContent.trim() === ${JSON.stringify(text)};`, text);
}

async function clickButtonContains(page, text) {
  return clickButton(page, `return button.textContent.trim().includes(${JSON.stringify(text)});`, text);
}

async function getPageState(page) {
  return page.evaluate(() => {
    const text = document.body.textContent.trim();
    const parseStats = () => {
      if (window.__rookStrongAiStats) return window.__rookStrongAiStats;
      const raw = document.documentElement.dataset.strongAiStats;
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };

    return {
      text,
      bidModal: Boolean(document.querySelector("#bid-modal")),
      trumpModal: Boolean(document.querySelector("#trump-modal")),
      kittyModal: Boolean(document.querySelector("#kitty-modal")),
      roundEndModal: Boolean(document.querySelector("#round-end-modal")),
      handCount: document.querySelectorAll("button.hand-card").length,
      playableHandCount: document.querySelectorAll("button.hand-card:not(.unplayable)").length,
      selectedHandCount: document.querySelectorAll("button.hand-card.selected").length,
      canPlaySelected: Boolean(document.querySelector("#play-btn.visible")),
      confirmDiscardEnabled: Boolean(document.querySelector("#confirm-discard-btn:not(:disabled)")),
      stats: parseStats(),
    };
  });
}

async function ensureMainMenuStrongGame(page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(250);

  await page.evaluate(() => {
    window.localStorage?.clear?.();
    window.sessionStorage?.clear?.();
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(250);

  if (!(await clickButtonContains(page, "Settings"))) {
    await clickButton(page, `return button.getAttribute("aria-label") === "Open settings";`, "Open settings");
  }
  await clickButtonText(page, "Strong");

  if (!(await clickButtonContains(page, "Start New Game"))) {
    if (!(await clickButtonText(page, "RESTART GAME"))) {
      throw new Error("Could not start a fresh Strong game.");
    }
  }

  await page.evaluate(() => {
    delete window.__rookStrongAiStats;
    delete document.documentElement.dataset.strongAiStats;
  });
  await page.waitForTimeout(250);
}

async function chooseTrumpIfNeeded(page) {
  const clicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll("#trump-modal .color-options button")].find((candidate) => !candidate.disabled);
    if (!button) return false;
    button.click();
    return true;
  });
  if (clicked) await page.waitForTimeout(100);
  return clicked;
}

async function discardKittyIfNeeded(page) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const status = await page.evaluate(() => {
      const confirm = document.querySelector("#confirm-discard-btn");
      if (!confirm) return "not-kitty";
      if (!confirm.disabled) {
        confirm.click();
        return "confirmed";
      }

      const card = [...document.querySelectorAll("button.hand-card:not(.unplayable):not(.selected)")][0];
      if (!card) return "blocked";
      card.click();
      return "selected";
    });

    await page.waitForTimeout(80);
    if (status === "confirmed" || status === "not-kitty") return status;
    if (status === "blocked") throw new Error("Kitty discard automation could not find a legal discard.");
  }
  throw new Error("Kitty discard automation did not converge.");
}

async function playHumanCardIfNeeded(page) {
  const status = await page.evaluate(() => {
    const playButton = document.querySelector("#play-btn");
    if (playButton?.classList.contains("visible") && !playButton.disabled) {
      playButton.click();
      return "played";
    }

    const card = [...document.querySelectorAll("button.hand-card:not(.unplayable)")][0];
    if (!card) return "none";
    card.click();

    const nextPlayButton = document.querySelector("#play-btn");
    if (nextPlayButton?.classList.contains("visible") && !nextPlayButton.disabled) {
      nextPlayButton.click();
      return "played";
    }
    return "selected";
  });

  if (status !== "none") await page.waitForTimeout(120);
  return status;
}

async function driveOneHand(page, options) {
  const startedStats = (await getPageState(page)).stats;
  let idleSteps = 0;
  const snapshots = [];

  for (let step = 0; step < options.maxStepsPerHand; step += 1) {
    const state = await getPageState(page);
    if (step % 20 === 0 || state.roundEndModal || state.stats?.fallbacks || state.stats?.timeouts) {
      snapshots.push({
        step,
        handCount: state.handCount,
        bidModal: state.bidModal,
        trumpModal: state.trumpModal,
        kittyModal: state.kittyModal,
        roundEndModal: state.roundEndModal,
        stats: state.stats,
      });
    }

    if (state.roundEndModal) {
      return {
        completed: true,
        snapshots,
        startedStats,
        endedStats: state.stats,
      };
    }

    let acted = false;
    if (state.bidModal) {
      acted = await clickButtonText(page, "PASS");
    } else if (state.trumpModal) {
      acted = await chooseTrumpIfNeeded(page);
    } else if (state.kittyModal) {
      const discardStatus = await discardKittyIfNeeded(page);
      acted = discardStatus !== "not-kitty";
    } else {
      const playStatus = await playHumanCardIfNeeded(page);
      acted = playStatus !== "none";
    }

    if (acted) {
      idleSteps = 0;
    } else {
      idleSteps += 1;
      await page.waitForTimeout(250);
    }

    if (idleSteps > 80) {
      throw new Error(`Harness stalled. Last state: ${JSON.stringify(state).slice(0, 1200)}`);
    }
  }

  throw new Error(`Hand did not complete within ${options.maxStepsPerHand} steps.`);
}

function metricDelta(start, end, key) {
  return (end?.[key] ?? 0) - (start?.[key] ?? 0);
}

function reasonDeltas(start, end) {
  const startReasons = start?.fallbackReasons ?? {};
  const endReasons = end?.fallbackReasons ?? {};
  return Object.fromEntries(
    Object.keys(endReasons)
      .map((reason) => [reason, (endReasons[reason] ?? 0) - (startReasons[reason] ?? 0)])
      .filter(([, count]) => count > 0),
  );
}

function summarizeStats(startStats, endStats) {
  const searchRequested = metricDelta(startStats, endStats, "searchRequested");
  const searchCompleted = metricDelta(startStats, endStats, "searchCompleted");
  const fallbacks = metricDelta(startStats, endStats, "fallbacks");
  const timeouts = metricDelta(startStats, endStats, "timeouts");
  const staleResults = metricDelta(startStats, endStats, "staleResults");
  const illegalResults = metricDelta(startStats, endStats, "illegalResults");
  const workerErrors = metricDelta(startStats, endStats, "workerErrors");
  const totalWorkerMs = metricDelta(startStats, endStats, "totalWorkerMs");
  const totalRoundTripMs = metricDelta(startStats, endStats, "totalRoundTripMs");
  const totalSamples = metricDelta(startStats, endStats, "totalSamples");

  return {
    searchRequested,
    searchCompleted,
    completionRate: searchRequested > 0 ? searchCompleted / searchRequested : 1,
    fallbacks,
    fallbackRate: searchRequested > 0 ? fallbacks / searchRequested : 0,
    timeouts,
    timeoutRate: searchRequested > 0 ? timeouts / searchRequested : 0,
    staleResults,
    illegalResults,
    workerErrors,
    averageWorkerMs: searchCompleted > 0 ? totalWorkerMs / searchCompleted : 0,
    averageRoundTripMs: searchCompleted > 0 ? totalRoundTripMs / searchCompleted : 0,
    averageSamples: searchCompleted > 0 ? totalSamples / searchCompleted : 0,
    fallbackReasons: reasonDeltas(startStats, endStats),
    timeoutContexts: (endStats?.timeoutContexts ?? []).slice((startStats?.timeoutContexts ?? []).length),
    lastProfile: endStats?.lastProfile ?? null,
  };
}

function mergeSummary(total, next) {
  total.searchRequested += next.searchRequested;
  total.searchCompleted += next.searchCompleted;
  total.fallbacks += next.fallbacks;
  total.timeouts += next.timeouts;
  total.staleResults += next.staleResults;
  total.illegalResults += next.illegalResults;
  total.workerErrors += next.workerErrors;
  total.totalWorkerWeighted += next.averageWorkerMs * next.searchCompleted;
  total.totalRoundTripWeighted += next.averageRoundTripMs * next.searchCompleted;
  total.totalSamplesWeighted += next.averageSamples * next.searchCompleted;
  Object.entries(next.fallbackReasons).forEach(([reason, count]) => {
    total.fallbackReasons[reason] = (total.fallbackReasons[reason] ?? 0) + count;
  });
  total.timeoutContexts = [...total.timeoutContexts, ...next.timeoutContexts].slice(-20);
}

function createAggregate() {
  return {
    searchRequested: 0,
    searchCompleted: 0,
    fallbacks: 0,
    timeouts: 0,
    staleResults: 0,
    illegalResults: 0,
    workerErrors: 0,
    totalWorkerWeighted: 0,
    totalRoundTripWeighted: 0,
    totalSamplesWeighted: 0,
    fallbackReasons: {},
    timeoutContexts: [],
  };
}

async function collectCacheSanity(page, baseUrl, expectedAssets, observedUrls) {
  const loaded = await page.evaluate(() => ({
    scripts: [...document.scripts].map((script) => new URL(script.src, location.href).pathname),
    styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => new URL(link.href, location.href).pathname),
    serviceWorkerSupported: "serviceWorker" in navigator,
  }));
  const serviceWorkerResponse = await fetch(`${baseUrl}/service-worker.js`, { cache: "no-store" });
  const servedServiceWorker = await serviceWorkerResponse.text();
  const servedCacheName = servedServiceWorker.match(/CACHE_NAME\s*=\s*"([^"]+)"/)?.[1] ?? null;
  const expectedWorkerAsset = [...observedUrls].find((url) => url.includes("/assets/searchWorker-"));

  return {
    expectedAppScript: expectedAssets.appScript,
    loadedAppScript: loaded.scripts.find((script) => script.includes("/assets/index-")) ?? null,
    expectedStyle: expectedAssets.style,
    loadedStyle: loaded.styles.find((style) => style.includes("/assets/index-")) ?? null,
    expectedSearchWorkerAsset: expectedAssets.searchWorker,
    expectedCacheName: expectedAssets.cacheName,
    servedCacheName,
    serviceWorkerSupported: loaded.serviceWorkerSupported,
    serviceWorkerNetworkFirstDocument: expectedAssets.serviceWorkerIncludesNetworkFirstDocument,
    observedSearchWorkerAsset: expectedWorkerAsset ? new URL(expectedWorkerAsset).pathname : null,
  };
}

function assertCacheSanity(cacheSanity, options) {
  if (cacheSanity.expectedAppScript !== cacheSanity.loadedAppScript) {
    throw new Error(
      `Stale app bundle loaded. Expected ${cacheSanity.expectedAppScript}, got ${cacheSanity.loadedAppScript}.`,
    );
  }
  if (cacheSanity.expectedStyle !== cacheSanity.loadedStyle) {
    throw new Error(`Stale stylesheet loaded. Expected ${cacheSanity.expectedStyle}, got ${cacheSanity.loadedStyle}.`);
  }
  if (cacheSanity.expectedCacheName !== cacheSanity.servedCacheName) {
    throw new Error(`Stale service worker served. Expected ${cacheSanity.expectedCacheName}, got ${cacheSanity.servedCacheName}.`);
  }
  if (!cacheSanity.serviceWorkerNetworkFirstDocument) {
    throw new Error("Service worker does not expose network-first document handling.");
  }
  if (!options.forcedTimeout && cacheSanity.expectedSearchWorkerAsset !== cacheSanity.observedSearchWorkerAsset) {
    throw new Error(
      `Stale search worker loaded. Expected ${cacheSanity.expectedSearchWorkerAsset}, got ${cacheSanity.observedSearchWorkerAsset}.`,
    );
  }
}

function assertReliability(summary, options) {
  const aggregate = summary.aggregate;
  if (aggregate.illegalResults > 0 || aggregate.staleResults > 0 || aggregate.workerErrors > 0) {
    throw new Error(
      `Reliability failure: illegal=${aggregate.illegalResults}, stale=${aggregate.staleResults}, workerErrors=${aggregate.workerErrors}.`,
    );
  }

  if (options.failOnFallback && aggregate.fallbacks > 0) {
    throw new Error(`Fallbacks occurred while --fail-on-fallback was set: ${aggregate.fallbacks}.`);
  }

  if (options.maxFallbackRate !== null) {
    const maxFallbackRate = Number(options.maxFallbackRate);
    if (Number.isFinite(maxFallbackRate) && summary.aggregate.fallbackRate > maxFallbackRate) {
      throw new Error(
        `Fallback rate ${formatNumber(summary.aggregate.fallbackRate, 4)} exceeded ${formatNumber(maxFallbackRate, 4)}.`,
      );
    }
  }
}

async function runHarness(options) {
  const playwright = resolvePlaywright();
  const preview = startPreview(options);
  await waitForPreview(options.baseUrl);

  const observedUrls = new Set();
  const consoleIssues = [];
  const pageErrors = [];
  const expectedAssets = readExpectedAssets();

  let browser = null;
  try {
    browser = await playwright.chromium.launch({
      headless: options.headless,
      slowMo: options.slowMo,
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      serviceWorkers: "allow",
    });
    const page = await context.newPage();

    if (options.cpuThrottle > 1) {
      const client = await context.newCDPSession(page);
      await client.send("Emulation.setCPUThrottlingRate", { rate: options.cpuThrottle });
    }

    page.on("requestfinished", (request) => {
      const url = request.url();
      if (url.includes("/assets/index-") || url.includes("/assets/searchWorker-")) {
        observedUrls.add(url);
      }
    });
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        consoleIssues.push({ type: message.type(), text: message.text() });
      }
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    const games = [];
    const aggregate = createAggregate();
    const targetUrl = `${options.baseUrl}${options.query}`;

    for (let gameIndex = 0; gameIndex < options.games; gameIndex += 1) {
      await page.goto(targetUrl, { waitUntil: "load" });
      await ensureMainMenuStrongGame(page);

      const handResults = [];
      let startStats = (await getPageState(page)).stats;

      for (let handIndex = 0; handIndex < options.handsPerGame; handIndex += 1) {
        const handResult = await driveOneHand(page, options);
        const endStats = (await getPageState(page)).stats;
        const handSummary = summarizeStats(startStats, endStats);
        mergeSummary(aggregate, handSummary);
        handResults.push({
          hand: handIndex + 1,
          ...handSummary,
          snapshots: handResult.snapshots.slice(-8),
        });

        if (handIndex < options.handsPerGame - 1) {
          if (!(await clickButtonText(page, "NEXT ROUND"))) {
            if (!(await clickButtonText(page, "START NEW GAME"))) {
              throw new Error("Could not advance after completed hand.");
            }
          }
          await page.waitForTimeout(300);
          startStats = (await getPageState(page)).stats;
        }
      }

      games.push({
        game: gameIndex + 1,
        hands: handResults,
      });
    }

    const completedHands = options.games * options.handsPerGame;
    const aggregateSummary = {
      ...aggregate,
      completionRate: aggregate.searchRequested > 0 ? aggregate.searchCompleted / aggregate.searchRequested : 1,
      fallbackRate: aggregate.searchRequested > 0 ? aggregate.fallbacks / aggregate.searchRequested : 0,
      timeoutRate: aggregate.searchRequested > 0 ? aggregate.timeouts / aggregate.searchRequested : 0,
      averageWorkerMs: aggregate.searchCompleted > 0 ? aggregate.totalWorkerWeighted / aggregate.searchCompleted : 0,
      averageRoundTripMs: aggregate.searchCompleted > 0 ? aggregate.totalRoundTripWeighted / aggregate.searchCompleted : 0,
      averageSamples: aggregate.searchCompleted > 0 ? aggregate.totalSamplesWeighted / aggregate.searchCompleted : 0,
    };

    const cacheSanity = await collectCacheSanity(page, options.baseUrl, expectedAssets, observedUrls);
    const summary = {
      mode: options.forcedTimeout ? "forced-timeout" : options.cpuThrottle > 1 ? "throttled" : "normal",
      baseUrl: options.baseUrl,
      games: options.games,
      hands: completedHands,
      estimatedTricks: completedHands * TRICKS_PER_HAND,
      cpuThrottle: options.cpuThrottle,
      forcedTimeout: options.forcedTimeout,
      aggregate: aggregateSummary,
      cacheSanity,
      consoleIssues,
      pageErrors,
      gameResults: games,
    };

    assertCacheSanity(cacheSanity, options);
    if (consoleIssues.length > 0 || pageErrors.length > 0) {
      throw new Error(`Browser console/page errors occurred: ${JSON.stringify({ consoleIssues, pageErrors })}`);
    }
    assertReliability(summary, options);

    return summary;
  } finally {
    if (browser) await browser.close();
    stopPreview(preview);
  }
}

function printSummary(summary, includeJson) {
  const aggregate = summary.aggregate;
  console.log(`Strong AI browser reliability mode: ${summary.mode}`);
  console.log(`Base URL: ${summary.baseUrl}`);
  console.log(`Games: ${summary.games}`);
  console.log(`Hands: ${summary.hands}`);
  console.log(`Estimated tricks: ${summary.estimatedTricks}`);
  console.log(`CPU throttle: ${summary.cpuThrottle}x`);
  console.log(`Searches: ${aggregate.searchCompleted}/${aggregate.searchRequested} completed (${pct(aggregate.completionRate)})`);
  console.log(`Fallbacks: ${aggregate.fallbacks} (${pct(aggregate.fallbackRate)})`);
  console.log(`Timeouts: ${aggregate.timeouts} (${pct(aggregate.timeoutRate)})`);
  console.log(
    `Illegal/stale/worker errors: ${aggregate.illegalResults}/${aggregate.staleResults}/${aggregate.workerErrors}`,
  );
  console.log(`Average worker ms: ${formatNumber(aggregate.averageWorkerMs, 2)}`);
  console.log(`Average round-trip ms: ${formatNumber(aggregate.averageRoundTripMs, 2)}`);
  console.log(`Average samples: ${formatNumber(aggregate.averageSamples, 2)}`);
  console.log(`Fallback reasons: ${JSON.stringify(aggregate.fallbackReasons)}`);
  console.log(`Timeout contexts: ${JSON.stringify(aggregate.timeoutContexts.slice(-5))}`);
  console.log(
    `Cache sanity: app=${summary.cacheSanity.loadedAppScript}, worker=${summary.cacheSanity.observedSearchWorkerAsset}, cache=${summary.cacheSanity.servedCacheName}`,
  );

  if (includeJson) {
    console.log("\nJSON summary:");
    console.log(JSON.stringify(summary, null, 2));
  }
}

const options = createOptions(process.argv.slice(2));
runHarness(options)
  .then((summary) => {
    printSummary(summary, options.includeJson);
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
