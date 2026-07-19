import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CheckinScheduler,
  millisecondsUntilNextLocalDay,
  randomCheckinDelayMs,
} from "../../services/checkin-scheduler.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("check-in scheduler", () => {
  it("keeps startup delays inside the fixed 5-30 minute range", () => {
    expect(randomCheckinDelayMs(() => 0)).toBe(5 * 60_000);
    expect(randomCheckinDelayMs(() => 1)).toBe(30 * 60_000);
    expect(randomCheckinDelayMs(() => 0.5)).toBe(17.5 * 60_000);
  });

  it("schedules one eligible startup run and does not retry it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 14, 9, 0, 0));
    const run = vi.fn(async () => undefined);
    const scheduled: string[] = [];
    const cleared = vi.fn();
    const scheduler = new CheckinScheduler({
      hasEligibleAccounts: () => true,
      runAutomaticCheckins: run,
      onScheduled: (value) => {
        scheduled.push(value);
      },
      onCleared: cleared,
      random: () => 0,
    });

    scheduler.start();
    expect(Date.parse(scheduled[0]) - Date.now()).toBe(5 * 60_000);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(cleared).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("re-evaluates eligibility after the local day rolls over", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 14, 23, 59, 50));
    const dates: string[] = [];
    const scheduler = new CheckinScheduler({
      hasEligibleAccounts: (today) => {
        dates.push(today);
        return true;
      },
      runAutomaticCheckins: async () => undefined,
      onScheduled: () => undefined,
      onCleared: () => undefined,
      random: () => 0,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(millisecondsUntilNextLocalDay(new Date()));

    expect(dates).toContain("2026-07-14");
    expect(dates).toContain("2026-07-15");
    scheduler.stop();
  });

  it("clears a pending timer when all accounts are disabled", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 14, 9, 0, 0));
    let eligible = true;
    const run = vi.fn(async () => undefined);
    const cleared = vi.fn();
    const scheduler = new CheckinScheduler({
      hasEligibleAccounts: () => eligible,
      runAutomaticCheckins: run,
      onScheduled: () => undefined,
      onCleared: cleared,
      random: () => 0,
    });

    scheduler.start();
    eligible = false;
    scheduler.refresh();
    vi.advanceTimersByTime(30 * 60_000);

    expect(run).not.toHaveBeenCalled();
    expect(cleared).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });
});
