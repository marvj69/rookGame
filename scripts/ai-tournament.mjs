import { availableParallelism } from "node:os";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import * as candidateAi from "../src/ai.js";
import { NAMED_SEARCH_CONFIGS, normalizeSearchConfig } from "../src/ai/config.js";
import * as baselineAi from "./current-ai-baseline.mjs";
import {
  createBenchmarkTotal,
  getBenchmarkMetrics,
  mergeBenchmarkTotals,
  simulateBenchmarkRange,
} from "./ai-benchmark-sim.mjs";

function getArgValue(args, name) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  if (!match) return null;
  return match.slice(name.length + 3);
}

function getArgValues(args, name) {
  return args.filter((arg) => arg.startsWith(`--${name}=`)).map((arg) => arg.slice(name.length + 3));
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

function parseSeeds(rawValue, fallback) {
  const value = rawValue ?? fallback;
  return value
    .split(",")
    .flatMap((part) => {
      const trimmed = part.trim();
      if (!trimmed) return [];
      const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
      if (!rangeMatch) return [Number(trimmed)];

      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      const step = start <= end ? 1 : -1;
      const seeds = [];
      for (let seed = start; seed !== end + step; seed += step) {
        seeds.push(seed);
      }
      return seeds;
    })
    .filter((seed) => Number.isInteger(seed));
}

function parseEvaluationOverrides(rawValue) {
  if (!rawValue) return {};

  return Object.fromEntries(
    rawValue
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [key, value] = entry.split("=");
        return [key, Number(value)];
      })
      .filter(([key, value]) => key && Number.isFinite(value)),
  );
}

function withGlobalSearchOverrides(config, args) {
  const evaluationOverrides = parseEvaluationOverrides(getArgValue(args, "eval"));
  const overrides = {
    timeLimitMs: getArgNumber(args, "search-ms", config.timeLimitMs, 0),
    samples: getArgNumber(args, "search-samples", config.samples, 1),
    seed: getArgNumber(args, "search-seed", config.seed, 1),
    minSamples: getArgNumber(args, "search-min-samples", config.minSamples, 0),
    maxSampleAttempts: getArgNumber(args, "search-sample-attempts", config.maxSampleAttempts, 1),
    exactEndgameHandSize: getArgNumber(args, "search-endgame", config.exactEndgameHandSize, 0),
    exactNodeLimit: getArgNumber(args, "search-node-limit", config.exactNodeLimit, 1),
  };

  return normalizeSearchConfig({
    ...config,
    ...overrides,
    evaluation: {
      ...config.evaluation,
      ...evaluationOverrides,
    },
  });
}

function parseSearchConfigSpec(spec, args) {
  if (NAMED_SEARCH_CONFIGS[spec]) {
    return withGlobalSearchOverrides(NAMED_SEARCH_CONFIGS[spec], args);
  }

  const [label, timeLimitMs, samples, seed, minSamples, maxSampleAttempts] = spec.split(":");
  if (!label || !timeLimitMs || !samples) {
    throw new Error(`Invalid search config "${spec}". Use a named config or label:ms:samples[:seed[:minSamples[:sampleAttempts]]].`);
  }

  return withGlobalSearchOverrides(
    normalizeSearchConfig({
      label,
      timeLimitMs: Number(timeLimitMs),
      samples: Number(samples),
      seed: seed === undefined ? NAMED_SEARCH_CONFIGS.default.seed : Number(seed),
      minSamples: minSamples === undefined ? NAMED_SEARCH_CONFIGS.default.minSamples : Number(minSamples),
      maxSampleAttempts:
        maxSampleAttempts === undefined ? NAMED_SEARCH_CONFIGS.default.maxSampleAttempts : Number(maxSampleAttempts),
    }),
    args,
  );
}

function parseSearchConfigs(args) {
  const specs = [
    ...getArgValues(args, "search-config"),
    ...getArgValues(args, "search-configs").flatMap((value) => value.split(",")),
  ].filter(Boolean);

  const selectedSpecs = specs.length > 0 ? specs : ["default"];
  return selectedSpecs.map((spec) => parseSearchConfigSpec(spec.trim(), args));
}

function resolveWorkerCount(rawWorkerCount, jobCount) {
  if (jobCount <= 1) return 1;
  if (rawWorkerCount === "auto") {
    return Math.max(1, Math.min(jobCount, availableParallelism(), 8));
  }

  const numeric = Number(rawWorkerCount);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(jobCount, Math.floor(numeric))) : 1;
}

function createBenchmarkOptions({ candidateMode, search, gamesPerSide }) {
  return {
    mode: "tournament",
    candidateMode,
    gamesPerSide,
    seed: 0,
    workerCount: 1,
    search: normalizeSearchConfig(search),
  };
}

function createJobs({ seeds, candidates, searchConfigs, gamesPerSide }) {
  const jobs = [];

  seeds.forEach((seed) => {
    if (candidates.includes("baseline")) {
      jobs.push({
        id: `baseline:baseline:${seed}`,
        seed,
        engine: "baseline",
        configLabel: "baseline",
        candidateEngine: "baseline",
        options: createBenchmarkOptions({ candidateMode: "current", search: searchConfigs[0], gamesPerSide }),
        gamesPerSide,
      });
    }

    if (candidates.includes("current")) {
      jobs.push({
        id: `current:current:${seed}`,
        seed,
        engine: "current",
        configLabel: "current",
        candidateEngine: "current",
        options: createBenchmarkOptions({ candidateMode: "current", search: searchConfigs[0], gamesPerSide }),
        gamesPerSide,
      });
    }

    if (candidates.includes("search")) {
      searchConfigs.forEach((searchConfig) => {
        jobs.push({
          id: `search:${searchConfig.label}:${seed}`,
          seed,
          engine: "search",
          configLabel: searchConfig.label,
          candidateEngine: "current",
          options: createBenchmarkOptions({ candidateMode: "search", search: searchConfig, gamesPerSide }),
          gamesPerSide,
        });
      });
    }
  });

  return jobs;
}

function strategiesForEngine(candidateEngine) {
  return {
    candidateAi: candidateEngine === "baseline" ? baselineAi : candidateAi,
    baselineAi,
  };
}

function runJobLocal(job) {
  const startedAt = performance.now();
  const total = simulateBenchmarkRange({
    seed: job.seed,
    gamesPerSide: job.gamesPerSide,
    strategies: strategiesForEngine(job.candidateEngine),
    options: job.options,
  });
  return {
    ...job,
    total,
    elapsedMs: performance.now() - startedAt,
  };
}

function runJobWorker(job) {
  const startedAt = performance.now();

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ai-benchmark-worker.mjs", import.meta.url), {
      workerData: {
        jobId: job.id,
        startIndex: 0,
        gamesPerSide: job.gamesPerSide,
        seed: job.seed,
        candidateEngine: job.candidateEngine,
        options: job.options,
      },
    });

    worker.on("message", (message) => {
      if (message.ok) {
        resolve({
          ...job,
          total: message.total,
          elapsedMs: performance.now() - startedAt,
        });
      } else {
        reject(new Error(message.error?.stack || message.error?.message || "Tournament worker failed."));
      }
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Tournament worker exited with code ${code}.`));
      }
    });
  });
}

async function runJobs(jobs, workerCount) {
  if (workerCount <= 1) {
    return jobs.map((job) => runJobLocal(job));
  }

  const results = [];
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < jobs.length) {
      const job = jobs[nextIndex];
      nextIndex += 1;
      results.push(await runJobWorker(job));
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runNext));
  return results.sort((a, b) => jobs.findIndex((job) => job.id === a.id) - jobs.findIndex((job) => job.id === b.id));
}

function rowFromResult(result) {
  return {
    seed: result.seed,
    engine: result.engine,
    config: result.configLabel,
    metrics: getBenchmarkMetrics(result.total, result.elapsedMs),
  };
}

function aggregateResults(results) {
  const groups = new Map();

  results.forEach((result) => {
    const key = `${result.engine}:${result.configLabel}`;
    if (!groups.has(key)) {
      groups.set(key, {
        engine: result.engine,
        config: result.configLabel,
        seeds: [],
        total: createBenchmarkTotal(),
        elapsedMs: 0,
      });
    }

    const group = groups.get(key);
    group.seeds.push(result.seed);
    group.elapsedMs += result.elapsedMs;
    mergeBenchmarkTotals(group.total, result.total);
  });

  return [...groups.values()].map((group) => ({
    engine: group.engine,
    config: group.config,
    seeds: group.seeds,
    metrics: getBenchmarkMetrics(group.total, group.elapsedMs),
  }));
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.0";
}

function formatTable(rows, columns) {
  const widths = columns.map((column) =>
    Math.max(
      column.header.length,
      ...rows.map((row) => String(column.value(row)).length),
    ),
  );
  const line = columns.map((column, index) => column.header.padEnd(widths[index])).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rows.map((row) =>
    columns.map((column, index) => String(column.value(row)).padEnd(widths[index])).join("  "),
  );

  return [line, divider, ...body].join("\n");
}

function tableColumns() {
  return [
    { header: "Seed", value: (row) => row.seed ?? "ALL" },
    { header: "Engine", value: (row) => row.engine },
    { header: "Config", value: (row) => row.config },
    { header: "Games", value: (row) => row.metrics.games },
    { header: "Wins", value: (row) => row.metrics.wins },
    { header: "Win%", value: (row) => pct(row.metrics.winRate) },
    { header: "Margin", value: (row) => formatNumber(row.metrics.averageMargin, 1) },
    { header: "BidMake", value: (row) => pct(row.metrics.candidateBidMakeRate) },
    { header: "Illegal", value: (row) => row.metrics.illegalMoves },
    { header: "Search", value: (row) => row.metrics.searchDecisions },
    { header: "AvgS", value: (row) => formatNumber(row.metrics.averageSearchSamplesPerDecision, 2) },
    { header: "AvgMs", value: (row) => formatNumber(row.metrics.averageSearchMsPerDecision, 2) },
    { header: "Fallback", value: (row) => row.metrics.searchFallbacks },
    { header: "Timeout", value: (row) => row.metrics.searchTimeouts },
    { header: "Elapsed", value: (row) => `${formatNumber(row.metrics.elapsedMs / 1000, 1)}s` },
  ];
}

function printTournamentSummary(summary, { includeJson }) {
  console.log(`Tournament seeds: ${summary.seeds.join(", ")}`);
  console.log(`Games per seed per orientation: ${summary.gamesPerSeed}`);
  console.log(`Workers: ${summary.workers}`);
  console.log(`Wall time: ${formatNumber(summary.elapsedMs / 1000, 1)}s`);
  console.log("\nPer-seed results:");
  console.log(formatTable(summary.rows, tableColumns()));
  console.log("\nAggregate results:");
  console.log(formatTable(summary.aggregates.map((row) => ({ ...row, seed: "ALL" })), tableColumns()));

  if (includeJson) {
    console.log("\nJSON summary:");
    console.log(JSON.stringify(summary, null, 2));
  }
}

function summarizeResults({ args, seeds, gamesPerSeed, workers, searchConfigs, results, startedAt }) {
  const rows = results.map((result) => ({
    ...rowFromResult(result),
    total: result.total,
  }));

  return {
    seeds,
    gamesPerSeed,
    workers,
    searchConfigs: searchConfigs.map((config) => ({
      label: config.label,
      timeLimitMs: config.timeLimitMs,
      samples: config.samples,
      minSamples: config.minSamples,
      maxSampleAttempts: config.maxSampleAttempts,
      seed: config.seed,
      exactEndgameHandSize: config.exactEndgameHandSize,
      exactNodeLimit: config.exactNodeLimit,
      evaluation: config.evaluation,
    })),
    rows: rows.map(({ total, ...row }) => row),
    aggregates: aggregateResults(results),
    elapsedMs: performance.now() - startedAt,
    command: `node scripts/ai-tournament.mjs ${args.join(" ")}`.trim(),
  };
}

function createTournamentOptions(args) {
  const seeds = parseSeeds(getArgValue(args, "seeds"), "20260618-20260620");
  const candidates = (getArgValue(args, "candidates") ?? "baseline,current,search")
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const invalidCandidate = candidates.find((candidate) => !["baseline", "current", "search"].includes(candidate));
  if (invalidCandidate) throw new Error(`Unsupported candidate "${invalidCandidate}".`);

  const searchConfigs = parseSearchConfigs(args);
  const gamesPerSeed = getArgNumber(args, "games", 10, 1);
  const rawWorkers = getArgValue(args, "workers") ?? (hasFlag(args, "parallel") ? "auto" : "1");

  return {
    seeds,
    candidates,
    searchConfigs,
    gamesPerSeed,
    rawWorkers,
    includeJson: !hasFlag(args, "no-json"),
  };
}

function createTuningSearchConfigs(args, baseConfig) {
  const variants = [
    { label: "default", evaluation: {} },
    {
      label: "bid-pressure-plus",
      evaluation: {
        bidMadeStateReward: 55,
        bidNeedPenalty: 0.85,
        setStateReward: 105,
        trickMakesBidReward: 105,
        trickSetsBidReward: 130,
      },
    },
    {
      label: "trump-frugal",
      evaluation: {
        cardPointSpend: 0.6,
        trumpBaseSpend: 4,
        trumpHighSpend: 3,
      },
    },
    {
      label: "point-dump-plus",
      evaluation: {
        bidTeamPointReward: 1.5,
        bidTeamPointPenalty: 1.8,
        bidderLosePointPenalty: 1.55,
        defenderSetPointReward: 1.6,
      },
    },
    {
      label: "terminal-heavy",
      evaluation: {
        terminalEv: 1.15,
        bidMadeStateReward: 60,
        setStateReward: 115,
      },
    },
  ];
  const limit = getArgNumber(args, "tune-limit", variants.length, 1);

  return variants.slice(0, limit).map((variant) =>
    normalizeSearchConfig({
      ...baseConfig,
      label: variant.label,
      evaluation: {
        ...baseConfig.evaluation,
        ...variant.evaluation,
      },
    }),
  );
}

function bestAggregate(aggregates) {
  return [...aggregates].sort((a, b) => {
    const marginDiff = b.metrics.averageMargin - a.metrics.averageMargin;
    if (marginDiff !== 0) return marginDiff;
    return b.metrics.winRate - a.metrics.winRate;
  })[0];
}

async function runTournament(args, overrides = {}) {
  const options = {
    ...createTournamentOptions(args),
    ...overrides,
  };
  const jobs = createJobs({
    seeds: options.seeds,
    candidates: options.candidates,
    searchConfigs: options.searchConfigs,
    gamesPerSide: options.gamesPerSeed,
  });
  const workers = resolveWorkerCount(options.rawWorkers, jobs.length);
  const startedAt = performance.now();
  const results = await runJobs(jobs, workers);

  return summarizeResults({
    args,
    seeds: options.seeds,
    gamesPerSeed: options.gamesPerSeed,
    workers,
    searchConfigs: options.searchConfigs,
    results,
    startedAt,
  });
}

async function runTuning(args) {
  const baseSearchConfig = parseSearchConfigs(args)[0];
  const trainSeeds = parseSeeds(getArgValue(args, "train") ?? getArgValue(args, "tune-train"), "20260621-20260630");
  const holdoutSeeds = parseSeeds(getArgValue(args, "holdout") ?? getArgValue(args, "tune-holdout"), "20260631-20260640");
  const gamesPerSeed = getArgNumber(args, "games", 10, 1);
  const rawWorkers = getArgValue(args, "workers") ?? "auto";
  const searchConfigs = createTuningSearchConfigs(args, baseSearchConfig);

  console.log("Training search configs:");
  searchConfigs.forEach((config) => {
    console.log(`- ${config.label}: ${config.timeLimitMs} ms, ${config.samples} samples`);
  });

  const trainSummary = await runTournament(args, {
    seeds: trainSeeds,
    candidates: ["search"],
    searchConfigs,
    gamesPerSeed,
    rawWorkers,
    includeJson: false,
  });
  printTournamentSummary(trainSummary, { includeJson: false });

  const defaultAggregate = trainSummary.aggregates.find((aggregate) => aggregate.config === "default");
  const bestTrain = bestAggregate(trainSummary.aggregates);
  const bestConfig = searchConfigs.find((config) => config.label === bestTrain.config) ?? searchConfigs[0];
  const holdoutConfigs =
    bestConfig.label === "default"
      ? [bestConfig]
      : [searchConfigs.find((config) => config.label === "default") ?? searchConfigs[0], bestConfig];

  console.log("\nHoldout confirmation configs:");
  holdoutConfigs.forEach((config) => console.log(`- ${config.label}`));

  const holdoutSummary = await runTournament(args, {
    seeds: holdoutSeeds,
    candidates: ["baseline", "current", "search"],
    searchConfigs: holdoutConfigs,
    gamesPerSeed,
    rawWorkers,
    includeJson: false,
  });
  printTournamentSummary(holdoutSummary, { includeJson: false });

  const bestHoldout = holdoutSummary.aggregates.find(
    (aggregate) => aggregate.engine === "search" && aggregate.config === bestConfig.label,
  );
  const defaultHoldout = holdoutSummary.aggregates.find(
    (aggregate) => aggregate.engine === "search" && aggregate.config === "default",
  );
  const materialMarginGain =
    bestHoldout && defaultHoldout ? bestHoldout.metrics.averageMargin - defaultHoldout.metrics.averageMargin : 0;
  const accepted = bestConfig.label !== "default" && materialMarginGain >= 10;

  const tuningSummary = {
    train: trainSummary,
    holdout: holdoutSummary,
    bestConfig: {
      label: bestConfig.label,
      search: bestConfig,
      trainMetrics: bestTrain.metrics,
      holdoutMetrics: bestHoldout?.metrics ?? null,
    },
    defaultTrainMetrics: defaultAggregate?.metrics ?? null,
    defaultHoldoutMetrics: defaultHoldout?.metrics ?? null,
    accepted,
    acceptanceRule: "non-default config must improve holdout average margin by at least 10 points",
  };

  console.log("\nTuning result:");
  console.log(`Best train config: ${bestConfig.label}`);
  console.log(`Holdout material margin gain vs default: ${formatNumber(materialMarginGain, 1)}`);
  console.log(`Default update recommended: ${accepted ? "yes" : "no"}`);

  if (!hasFlag(args, "no-json")) {
    console.log("\nJSON tuning summary:");
    console.log(JSON.stringify(tuningSummary, null, 2));
  }

  return tuningSummary;
}

const args = process.argv.slice(2);

if (hasFlag(args, "tune")) {
  await runTuning(args);
} else {
  const summary = await runTournament(args);
  printTournamentSummary(summary, { includeJson: !hasFlag(args, "no-json") });
}
