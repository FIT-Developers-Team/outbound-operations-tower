import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRoutePlanRules,
  defaultRoutePlan,
  diffDestinationRules,
} from "../lib/route-defaults.ts";
import { resolveDestinationRule } from "../lib/outbound-logic.ts";

test("the default plan carries every route and drop from operations", () => {
  assert.equal(defaultRoutePlan.length, 39);
  assert.deepEqual(
    defaultRoutePlan.map((route) => route.routeNo),
    Array.from({ length: 39 }, (_, index) => index + 1),
  );
  assert.ok(
    defaultRoutePlan.every(
      (route) => route.drops.length >= 1 && route.drops.length <= 2,
    ),
  );
  const rules = buildRoutePlanRules({ effectiveMonth: "2026-08" });
  assert.equal(
    rules.length,
    defaultRoutePlan.reduce((total, route) => total + route.drops.length, 0),
  );
});

test("each drop column becomes its own destination mapping", () => {
  const rules = buildRoutePlanRules({ effectiveMonth: "2026-08" });
  const byCode = (code) => rules.filter((rule) => rule.destinationCode === code);

  assert.deepEqual(
    byCode("SWL").map((rule) => [rule.wave, rule.drop, rule.sequence]),
    [["WAVE 1", "DROP 1", 1]],
  );
  assert.deepEqual(
    byCode("PSG").map((rule) => [rule.wave, rule.drop, rule.sequence]),
    [["WAVE 1", "DROP 2", 1]],
  );
  assert.deepEqual(
    byCode("BSX").map((rule) => [rule.wave, rule.drop, rule.sequence]),
    [["WAVE 1", "DROP 1", 5]],
  );
  assert.deepEqual(
    byCode("ASA").map((rule) => [rule.wave, rule.drop, rule.sequence]),
    [["WAVE 4+", "DROP 1", 39]],
  );
});

test("a destination served by two routes keeps both rows, and the lower route number wins", () => {
  const rules = buildRoutePlanRules({ effectiveMonth: "2026-08" });
  const cinere = rules.filter((rule) => rule.destinationCode === "CNR");
  assert.deepEqual(
    cinere.map((rule) => [rule.wave, rule.sequence]),
    [
      ["WAVE 2", 17],
      ["WAVE 3", 24],
    ],
  );
  assert.equal(
    resolveDestinationRule("CNR - Cinere", "2026-08-02", rules).wave,
    "WAVE 2",
  );
});

test("applying the plan twice edits the same rows instead of duplicating them", () => {
  const month = "2026-08";
  const first = buildRoutePlanRules({ effectiveMonth: month });
  const second = buildRoutePlanRules({ effectiveMonth: month, existing: first });
  assert.deepEqual(
    second.map((rule) => rule.id),
    first.map((rule) => rule.id),
  );
  assert.equal(diffDestinationRules(second, first).pending.length, 0);
  assert.equal(diffDestinationRules(second, first).unchanged.length, first.length);

  // A hand-made mapping for the same month is adopted, not shadowed by a
  // second row for the same destination.
  const handMade = [
    {
      id: "DEST-manual",
      effectiveMonth: month,
      destinationCode: "PBT",
      destinationName: "PBT - Pondok Betung",
      wave: "WAVE 5",
      drop: "DROP 9",
      sequence: 99,
      active: true,
    },
  ];
  const merged = buildRoutePlanRules({
    effectiveMonth: month,
    existing: handMade,
  });
  const betung = merged.filter((rule) => rule.destinationCode === "PBT");
  assert.equal(betung.length, 1);
  assert.equal(betung[0].id, "DEST-manual");
  assert.equal(betung[0].wave, "WAVE 2");
  assert.equal(betung[0].destinationName, "PBT - Pondok Betung");
});

test("only the differing rows are queued for the server", () => {
  const month = "2026-08";
  const existing = buildRoutePlanRules({ effectiveMonth: month });
  const edited = existing.map((rule) =>
    rule.destinationCode === "DNS" ? { ...rule, wave: "WAVE 9" } : rule,
  );
  const diff = diffDestinationRules(existing, edited);
  assert.equal(diff.pending.length, 1);
  assert.equal(diff.updated[0].destinationCode, "DNS");
  assert.equal(diff.added.length, 0);

  const otherMonth = buildRoutePlanRules({ effectiveMonth: "2026-09", existing });
  assert.equal(diffDestinationRules(otherMonth, existing).added.length, otherMonth.length);
});

test("destination names come from SO data when the code is already known", () => {
  const rules = buildRoutePlanRules({
    effectiveMonth: "2026-08",
    destinationNames: new Map([["JTI", "JTI - Jatibening New"]]),
  });
  const named = rules.find((rule) => rule.destinationCode === "JTI");
  assert.equal(named.destinationName, "JTI - Jatibening New");
  const unnamed = rules.find((rule) => rule.destinationCode === "SWL");
  assert.equal(unnamed.destinationName, "SWL");
});
