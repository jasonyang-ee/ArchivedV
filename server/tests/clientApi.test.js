import assert from "node:assert/strict";
import test from "node:test";
import { api } from "../../client/src/utils/api.js";

test("client mutations reject server errors and keep the API same-origin", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, "/api/channels");
    return new Response(JSON.stringify({ error: "Invalid channel" }), { status: 400 });
  });
  await assert.rejects(api.addChannel("bad"), /Invalid channel/);
});

test("client explains invalid proxy responses", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Bad gateway</html>", { status: 502 }));
  await assert.rejects(api.getStatus(), /invalid response.*502/);
});

test("client encodes path input and preserves successful responses", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/keywords/a%2Fb%20%3F");
    assert.equal(options.method, "DELETE");
    return Response.json({ success: true });
  });
  assert.deepEqual(await api.deleteKeyword("a/b ?"), { success: true });
});
