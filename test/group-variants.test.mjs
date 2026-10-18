import test from "node:test";
import assert from "node:assert/strict";
import { groupVariants } from "../scripts/lib/group-variants.mjs";

test("variants attach to an existing base", () => {
  const g = groupVariants(["a", "a-light", "a-dark"]);
  assert.deepEqual([...g.keys()], ["a"]);
  assert.deepEqual(g.get("a").variants, { light: "a-light", dark: "a-dark" });
});
test("listed name with only light/dark files gets a synthesized base", () => {
  const g = groupVariants(["medium-light", "medium-dark"], new Set(["medium"]));
  assert.deepEqual([...g.keys()], ["medium"]);
  assert.equal(g.get("medium").fromVariant, true);
  assert.deepEqual(g.get("medium").variants, { light: "medium-light", dark: "medium-dark" });
});
test("single-variant listed name works; unlisted lone variant stays standalone", () => {
  assert.deepEqual(groupVariants(["yuno-host-light"], new Set(["yuno-host"])).get("yuno-host").variants, { light: "yuno-host-light" });
  assert.deepEqual([...groupVariants(["foo-light"]).keys()], ["foo-light"]);
});
