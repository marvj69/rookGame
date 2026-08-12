export function wilsonScoreInterval(wins, games, z = 1.959963984540054) {
  if (!Number.isFinite(games) || games <= 0) return { low: 0, high: 1 };

  const boundedWins = Math.max(0, Math.min(games, wins));
  const proportion = boundedWins / games;
  const zSquared = z * z;
  const denominator = 1 + zSquared / games;
  const center = (proportion + zSquared / (2 * games)) / denominator;
  const spread =
    (z * Math.sqrt((proportion * (1 - proportion)) / games + zSquared / (4 * games * games))) / denominator;

  return {
    low: Math.max(0, center - spread),
    high: Math.min(1, center + spread),
  };
}

export function eloDeltaFromScore(score) {
  const boundedScore = Math.max(0.001, Math.min(0.999, score));
  return 400 * Math.log10(boundedScore / (1 - boundedScore));
}

function createRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function quantile(values, probability) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const position = Math.max(0, Math.min(1, probability)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function deterministicClusterBootstrapInterval(
  clusterScores,
  { replicates = 2000, seed = 20260811, confidence = 0.95 } = {},
) {
  const values = clusterScores.filter(Number.isFinite);
  if (values.length < 2) return { low: 0, high: 1, clusters: values.length, replicates: 0 };
  const random = createRandom(seed + values.length * 7919);
  const means = [];

  for (let replicate = 0; replicate < replicates; replicate += 1) {
    let sum = 0;
    for (let index = 0; index < values.length; index += 1) {
      sum += values[Math.floor(random() * values.length)];
    }
    means.push(sum / values.length);
  }

  const tail = (1 - confidence) / 2;
  return {
    low: quantile(means, tail),
    high: quantile(means, 1 - tail),
    clusters: values.length,
    replicates,
  };
}
