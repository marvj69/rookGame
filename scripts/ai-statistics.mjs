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
