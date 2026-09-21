import assert from "node:assert/strict";
import test from "node:test";
import { compassRoutePath, parseCompassRoute } from "../public/compass-routing.js";

test("Compass direct route accepts a positive record id with an explicit view", () => {
  assert.deepEqual(parseCompassRoute("https://hub.example/compass/?view=wants&id=42"), {
    view: "wants",
    id: 42,
    filter: null,
    error: null,
  });
});

test("Compass direct route accepts only the untriaged Wants filter", () => {
  assert.deepEqual(parseCompassRoute("https://hub.example/compass/?view=wants&filter=untriaged"), {
    view: "wants",
    id: null,
    filter: "untriaged",
    error: null,
  });
  assert.equal(parseCompassRoute("https://hub.example/compass/?filter=untriaged").error, "invalid-target");
  assert.equal(parseCompassRoute("https://hub.example/compass/?view=wants&filter=unknown").error, "invalid-target");
});

test("Compass direct route accepts the Knowledge pending filter on both tabs", () => {
  assert.deepEqual(parseCompassRoute("https://hub.example/compass/?filter=knowledge"), {
    view: "inbox",
    id: null,
    filter: "knowledge",
    error: null,
  });
  assert.deepEqual(parseCompassRoute("https://hub.example/compass/?view=wants&filter=knowledge"), {
    view: "wants",
    id: null,
    filter: "knowledge",
    error: null,
  });
  assert.equal(parseCompassRoute("https://hub.example/compass/?view=bogus&filter=knowledge").error, "invalid-target");
  assert.equal(compassRoutePath("https://hub.example/compass/", "inbox", null, "knowledge"), "/compass/?filter=knowledge");
  assert.equal(
    compassRoutePath("https://hub.example/compass/", "wants", null, "knowledge"),
    "/compass/?view=wants&filter=knowledge",
  );
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
  assert.equal(
    compassRoutePath("https://hub.example/compass/", "wants", null, "untriaged"),
    "/compass/?view=wants&filter=untriaged",
  );
});
