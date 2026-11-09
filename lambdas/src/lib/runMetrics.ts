// Keep Strava's recorded efforts and HR buckets, not estimates from a
// downsampled chart stream. Only these public portfolio fields are retained.
export const RUN_METRICS_VERSION = 1;

export function normalizeRunMetrics(activity: any, activityZones?: any[]) {
  const distances: Record<string, number> = {
    "5k": 5000, "10k": 10000, "halfmarathon": 21097.5, "marathon": 42195,
  };
  const bestEfforts = (Array.isArray(activity.best_efforts) ? activity.best_efforts : [])
    .filter((effort: any) => {
      const key = String(effort.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return !activity.flagged && distances[key] && Number(effort.elapsed_time) > 0;
    })
    .map((effort: any) => {
      const key = String(effort.name).toLowerCase().replace(/[^a-z0-9]/g, "");
      return {
        name: effort.name,
        distanceMeters: distances[key],
        elapsedSeconds: Number(effort.elapsed_time),
        activityId: String(activity.id),
        startTime: effort.start_date || activity.start_date,
      };
    });
  const rawZones = activityZones?.find(zone => zone?.type === "heartrate");
  const zones = (Array.isArray(rawZones?.distribution_buckets) ? rawZones.distribution_buckets : [])
    .filter((zone: any) => Number.isFinite(zone.min) && Number.isFinite(zone.max) && Number.isFinite(zone.time) && zone.time >= 0)
    .map((zone: any) => ({ min: zone.min, max: zone.max === -1 ? null : zone.max, seconds: zone.time }));
  const hasHeartRate = Number(activity.average_heartrate) > 0 || Number(activity.max_heartrate) > 0;
  return {
    version: RUN_METRICS_VERSION,
    fetchedAt: new Date().toISOString(),
    bestEfforts,
    heartRate: hasHeartRate || zones.length ? {
      source: "strava",
      averageBpm: Number(activity.average_heartrate) > 0 ? Number(activity.average_heartrate) : null,
      maxBpm: Number(activity.max_heartrate) > 0 ? Number(activity.max_heartrate) : null,
      zonesSynced: Array.isArray(activityZones),
      zones,
    } : null,
  };
}
