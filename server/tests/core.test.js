import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DOWNLOAD_DIR, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS } from "../config.js";
import { classifyYtDlpAuthFailure } from "../auth.js";
import {
  computeNextAttempt,
  parseScheduledTime,
} from "../downloader.js";
import {
  migrateHistoryEntries,
  normalizeHistoryTitle,
  resolveHistoryChannel,
} from "../database.js";

test("parseScheduledTime handles supported units and invalid input", () => {
  const cases = [
    ["1 minute", 60_000],
    ["2 hours", 2 * 60 * 60 * 1000],
    ["3 days", 3 * 24 * 60 * 60 * 1000],
    ["1 week", 7 * 24 * 60 * 60 * 1000],
  ];

  for (const [label, expectedMs] of cases) {
    const before = Date.now();
    const parsed = parseScheduledTime(`This live event will begin in ${label}.`);
    const delta = new Date(parsed).getTime() - before;
    assert.ok(Math.abs(delta - expectedMs) < 1000, label);
  }

  assert.equal(parseScheduledTime("not scheduled"), null);
  assert.equal(parseScheduledTime(""), null);
});

test("computeNextAttempt caps exponential delay", () => {
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    for (let attempts = 0; attempts <= 12; attempts++) {
      const before = Date.now();
      const next = new Date(computeNextAttempt(attempts)).getTime();
      const expected = Math.min(
        RETRY_MAX_DELAY_MS,
        RETRY_BASE_DELAY_MS * 2 ** Math.min(10, attempts)
      );
      assert.ok(Math.abs(next - before - expected) < 1000, `attempt ${attempts}`);
    }
  } finally {
    Math.random = originalRandom;
  }
});

test("classifyYtDlpAuthFailure identifies auth-required errors", () => {
  const cases = [
    ["Private video. Sign in to confirm your age.", "private_video"],
    ["Video unavailable. This video is private", "private_video"],
    ["This video is available to this channel's members", "members_only"],
    ["This video is age-restricted", "age_restricted"],
  ];

  for (const [message, reason] of cases) {
    assert.deepEqual(classifyYtDlpAuthFailure(message), {
      kind: "auth_required",
      reason,
    });
  }
  assert.equal(classifyYtDlpAuthFailure("video unavailable"), null);
});

test("migrateHistoryEntries enriches metadata from direct and folder matches", () => {
  const username = `test-history-${process.pid}`;
  const folder = path.join(DOWNLOAD_DIR, username, "[2026-01-01] Folder Match");
  fs.mkdirSync(folder, { recursive: true });

  try {
    const channel = {
      id: "channel-test",
      username,
      channelName: "Test Channel",
    };
    const data = {
      channels: [channel, { id: "other", username: "other", channelName: "Other" }],
      history: [
        { title: "Direct", channelId: "channel-test" },
        { title: "Username", username },
        { title: "Folder Match" },
        { title: "No Match" },
      ],
    };

    const result = migrateHistoryEntries(data);
    assert.equal(result.updatedCount, 3);
    assert.equal(data.history[0].channelName, "Test Channel");
    assert.equal(data.history[1].channelId, "channel-test");
    assert.equal(data.history[2].channelId, "channel-test");
    assert.equal(data.history[3].channelId, undefined);
  } finally {
    fs.rmSync(path.join(DOWNLOAD_DIR, username), { recursive: true, force: true });
  }
});

test("resolveHistoryChannel resolves channel metadata by precedence", () => {
  const primary = { id: "chan-1", username: "primary", channelName: "Primary Channel" };
  const other = { id: "chan-2", username: "other", channelName: "Other Channel" };
  const channelsById = new Map([primary, other].map((c) => [c.id, c]));
  const channelsByUsername = new Map([primary, other].map((c) => [c.username, c]));
  const titleMap = new Map([[normalizeHistoryTitle("Folder Match"), [primary]]]);
  const multiCtx = { channelsById, channelsByUsername, singleChannel: null, titleMap };

  // direct channelId match wins
  assert.deepEqual(resolveHistoryChannel({ title: "A", channelId: "chan-1" }, multiCtx), {
    channelId: "chan-1",
    username: "primary",
    channelName: "Primary Channel",
    channelUrl: "https://www.youtube.com/@primary",
  });

  // username match
  assert.deepEqual(resolveHistoryChannel({ title: "B", username: "other" }, multiCtx), {
    channelId: "chan-2",
    username: "other",
    channelName: "Other Channel",
    channelUrl: "https://www.youtube.com/@other",
  });

  // bare item resolved by single folder-title match
  assert.deepEqual(resolveHistoryChannel({ title: "Folder Match" }, multiCtx), {
    channelId: "chan-1",
    username: "primary",
    channelName: "Primary Channel",
    channelUrl: "https://www.youtube.com/@primary",
  });

  // channelName-only item still folder-enriched (HARDEN-2: API now matches migration)
  assert.deepEqual(
    resolveHistoryChannel({ title: "Folder Match", channelName: "Legacy Name" }, multiCtx),
    {
      channelId: "chan-1",
      username: "primary",
      channelName: "Legacy Name",
      channelUrl: "https://www.youtube.com/@primary",
    }
  );

  // no match falls back to the sole channel
  const singleCtx = {
    channelsById: new Map([[primary.id, primary]]),
    channelsByUsername: new Map([[primary.username, primary]]),
    singleChannel: primary,
    titleMap: null,
  };
  assert.deepEqual(resolveHistoryChannel({ title: "Unknown" }, singleCtx), {
    channelId: "chan-1",
    username: "primary",
    channelName: "Primary Channel",
    channelUrl: "https://www.youtube.com/@primary",
  });

  // no match with multiple channels stays unresolved
  assert.deepEqual(resolveHistoryChannel({ title: "Unknown" }, multiCtx), {
    channelId: null,
    username: null,
    channelName: null,
    channelUrl: null,
  });
});
