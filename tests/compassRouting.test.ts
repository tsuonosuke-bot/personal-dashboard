import assert from "node:assert/strict";
import test from "node:test";
import { compassRoutePath, parseCompassRoute } from "../public/compass-routing.js";

test("Compass direct route accepts a positive record id with an explicit view", () => {
  assert.deepEqual(parseCompassRoute("https://hub.example/compass/?view=wants&id=42"), {
    view: "wants",
    id: 42,
    error: null,
  });
});

test("Compass direct route rejects unsafe or incomplete targets", () => {
  assert.equal(parseCompassRoute("https://hub.example/compass/?id=42").error, "invalid-target");
  assert.equal(parseCompassRoute("https://hub.example/compass/?view=wants&id=-1").error, "invalid-target");
  assert.equal(parseCompassRoute("https://hub.example/compass/?view=wants&id=1.5").error, "invalid-target");
});

test("Compass route paths preserve unrelated callback parameters", () => {
  assert.equal(
    compassRoutePath("https://hub.example/compass/?calendar=connected", "wants", 42),
    "/compass/?calendar=connected&view=wants&id=42",
  );
  assert.equal(
    compassRoutePath("https://hub.example/compass/?view=wants&id=42", "wants"),
    "/compass/?view=wants",
  );
});
