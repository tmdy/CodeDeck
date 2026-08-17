import { describe, expect, it } from "vitest";
import {
  CheckinExecutionQueue,
  settleCheckinsSequentially,
} from "../../checkin/execution-queue.js";

describe("CheckinExecutionQueue", () => {
  it("serializes cross-site check-ins in enqueue order", async () => {
    const queue = new CheckinExecutionQueue();
    const events: string[] = [];
    let activeCount = 0;
    let maximumActiveCount = 0;

    const run = (account: string) => queue.enqueue(async () => {
      activeCount += 1;
      maximumActiveCount = Math.max(maximumActiveCount, activeCount);
      events.push(`start:${account}`);
      await Promise.resolve();
      events.push(`finish:${account}`);
      activeCount -= 1;
      return account;
    });

    await expect(Promise.all([
      run("site-a/account-1"),
      run("site-b/account-2"),
      run("site-a/account-3"),
    ])).resolves.toEqual([
      "site-a/account-1",
      "site-b/account-2",
      "site-a/account-3",
    ]);
    expect(maximumActiveCount).toBe(1);
    expect(events).toEqual([
      "start:site-a/account-1",
      "finish:site-a/account-1",
      "start:site-b/account-2",
      "finish:site-b/account-2",
      "start:site-a/account-3",
      "finish:site-a/account-3",
    ]);
  });

  it("continues after a rejected check-in without hiding its error", async () => {
    const queue = new CheckinExecutionQueue();
    const events: string[] = [];
    const failed = queue.enqueue(async () => {
      events.push("failed");
      throw new Error("request failed");
    });
    const next = queue.enqueue(async () => {
      events.push("next");
      return "completed";
    });

    await expect(failed).rejects.toThrow("request failed");
    await expect(next).resolves.toBe("completed");
    expect(events).toEqual(["failed", "next"]);
  });
});

describe("settleCheckinsSequentially", () => {
  it("keeps batch input order, one active operation, and continues after errors", async () => {
    const starts: string[] = [];
    let activeCount = 0;
    let maximumActiveCount = 0;

    const results = await settleCheckinsSequentially(
      ["account-3", "account-1", "account-2"],
      async (account) => {
        activeCount += 1;
        maximumActiveCount = Math.max(maximumActiveCount, activeCount);
        starts.push(account);
        await Promise.resolve();
        activeCount -= 1;
        if (account === "account-1") {
          throw new Error("account-1 failed");
        }
        return `done:${account}`;
      },
    );

    expect(starts).toEqual(["account-3", "account-1", "account-2"]);
    expect(results[0]).toEqual({ status: "fulfilled", value: "done:account-3" });
    expect(results[1]).toMatchObject({ status: "rejected" });
    expect(results[2]).toEqual({ status: "fulfilled", value: "done:account-2" });
    expect(maximumActiveCount).toBe(1);
  });
});
