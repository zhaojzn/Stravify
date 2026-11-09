import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRunMetrics } from "../src/lib/runMetrics";

test("normalizes Strava best efforts without estimating or exposing private activity fields", () => {
  const result = normalizeRunMetrics({ id: 123, start_date: "2026-11-06", description: "private description", map: { polyline: "private route" }, best_efforts: [
    { name: "5K", elapsed_time: 1638 },
    { name: "10K", elapsed_time: 3371 },
    { name: "Half-Marathon", elapsed_time: 7392 },
    { name: "1 mile", elapsed_time: 300 },
    { name: "Marathon", elapsed_time: 0 },
  ] });
  assert.deepEqual(result.bestEfforts.map((effort: any) => effort.distanceMeters), [5000, 10000, 21097.5]);
  assert.equal(result.bestEfforts[0].activityId, "123");
  assert.equal(JSON.stringify(result).includes("private"), false);
})

test("copies official HR averages, maxima and inclusive zone limits without resampling", () => {
  const result = normalizeRunMetrics({ average_heartrate: 162.9, max_heartrate: 195 }, [
    { type: "power", distribution_buckets: [{ min: 0, max: 100, time: 200 }] },
    { type: "heartrate", distribution_buckets: [{ min: 130, max: 161, time: 721 }, { min: 194, max: -1, time: 65 }] },
  ]);
  assert.equal(result.heartRate?.averageBpm, 162.9);
  assert.equal(result.heartRate?.maxBpm, 195);
  assert.deepEqual(result.heartRate?.zones, [{ min: 130, max: 161, seconds: 721 }, { min: 194, max: null, seconds: 65 }]);
})

test("missing zones, missing monitors and flagged efforts remain honest", () => {
  const unavailable = normalizeRunMetrics({ average_heartrate: 140 });
  assert.equal(unavailable.heartRate?.zonesSynced, false);
  assert.deepEqual(unavailable.heartRate?.zones, []);
  assert.equal(normalizeRunMetrics({}).heartRate, null);
  assert.deepEqual(normalizeRunMetrics({ flagged: true, best_efforts: [{ name: "5K", elapsed_time: 900 }] }).bestEfforts, []);
})
