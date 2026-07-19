import { localDateKey } from "../checkin/types.js";

export interface CheckinSchedulerOptions {
  hasEligibleAccounts: (today: string) => boolean;
  runAutomaticCheckins: () => Promise<void>;
  onScheduled: (scheduledAt: string) => void | Promise<void>;
  onCleared: () => void | Promise<void>;
  random?: () => number;
  now?: () => Date;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

const MIN_DELAY_MS = 5 * 60_000;
const MAX_DELAY_MS = 30 * 60_000;

export function randomCheckinDelayMs(random: () => number = Math.random): number {
  const ratio = Math.min(1, Math.max(0, random()));
  return Math.round(MIN_DELAY_MS + ratio * (MAX_DELAY_MS - MIN_DELAY_MS));
}

export function millisecondsUntilNextLocalDay(now: Date): number {
  const next = new Date(now);
  next.setHours(24, 0, 1, 0);
  return Math.max(1_000, next.getTime() - now.getTime());
}

export class CheckinScheduler {
  private dailyTimer: ReturnType<typeof setTimeout> | null = null;
  private rolloverTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private readonly random: () => number;
  private readonly now: () => Date;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;

  constructor(private options: CheckinSchedulerOptions) {
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => new Date());
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  start(): void {
    this.stop();
    this.started = true;
    this.scheduleToday();
    this.armRollover();
  }

  refresh(): void {
    if (!this.started) {
      return;
    }
    if (this.dailyTimer) {
      this.clearTimer(this.dailyTimer);
      this.dailyTimer = null;
    }
    this.scheduleToday();
  }

  stop(): void {
    this.started = false;
    if (this.dailyTimer) {
      this.clearTimer(this.dailyTimer);
      this.dailyTimer = null;
    }
    if (this.rolloverTimer) {
      this.clearTimer(this.rolloverTimer);
      this.rolloverTimer = null;
    }
  }

  private scheduleToday(): void {
    const today = localDateKey(this.now());
    if (!this.options.hasEligibleAccounts(today)) {
      void this.options.onCleared();
      return;
    }
    const target = new Date(this.now().getTime() + randomCheckinDelayMs(this.random));
    void this.options.onScheduled(target.toISOString());
    this.dailyTimer = this.setTimer(() => {
      this.dailyTimer = null;
      void this.options.onCleared();
      void this.options.runAutomaticCheckins().catch(() => undefined);
    }, Math.max(0, target.getTime() - this.now().getTime()));
  }

  private armRollover(): void {
    const delay = millisecondsUntilNextLocalDay(this.now());
    this.rolloverTimer = this.setTimer(() => {
      this.rolloverTimer = null;
      if (!this.started) {
        return;
      }
      if (this.dailyTimer) {
        this.clearTimer(this.dailyTimer);
        this.dailyTimer = null;
      }
      this.scheduleToday();
      this.armRollover();
    }, delay);
  }
}
