"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.textContent = "";
    this.value = "";
    this.type = "";
    this.name = "";
    this.disabled = false;
    this.attributes = {};
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  async click() {
    if (this.listeners.click) {
      await this.listeners.click({ preventDefault() {} });
    }
  }
}

function allNodes(root) {
  return [root, ...root.children.flatMap(allNodes)];
}

function named(root, name) {
  const result = allNodes(root).find((node) => node.name === name);
  assert.ok(result, `missing control ${name}`);
  return result;
}

function button(root, text) {
  const result = allNodes(root).find(
    (node) => node.tagName === "BUTTON" && node.textContent === text,
  );
  assert.ok(result, `missing button ${text}`);
  return result;
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  const md5 = (text) => crypto.createHash("md5").update(text, "utf8").digest("hex");
  const storedHash = md5("stored-password");
  const replacementPassword = "pässword with spaces";
  const existing = {
    apiBase: "https://books.example/xpoint/",
    username: "léa",
    password: storedHash,
  };
  let registered;
  const writes = [];
  const container = new FakeElement("div");
  const document = { createElement: (tag) => new FakeElement(tag) };
  const fetchCalls = [];
  const fetch = async (url) => {
    fetchCalls.push(url);
    return {
      ok: true,
      async json() {
        return existing;
      },
    };
  };
  const api = {
    pluginFile(file) {
      assert.equal(file, "config.json");
      return `/plugin/shimmory/${file}`;
    },
    async writeFile(path, data) {
      writes.push({ path, data });
      return { ok: true };
    },
  };
  const sandbox = {
    CrossPoint: {
      registerPlugin(callback) {
        registered = callback;
      },
    },
    document,
    fetch,
    URL,
    TextEncoder,
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("shimmory/plugin.js", "utf8"), sandbox, {
    filename: "shimmory/plugin.js",
  });
  assert.equal(typeof registered, "function");
  registered(container, api);
  await settle();

  const shown = () => allNodes(container).map((node) => node.textContent).join(" ");
  const saved = (index) => JSON.parse(Buffer.from(writes[index].data, "base64").toString("utf8"));

  assert.deepEqual(fetchCalls, ["/plugin/shimmory/config.json"]);
  assert.equal(named(container, "apiBase").value, "https://books.example/xpoint");
  assert.equal(named(container, "username").value, "léa");
  assert.equal(named(container, "password").value, "");
  assert.ok(!allNodes(container).some((node) => node.name === "deviceId"));
  assert.ok(!shown().includes(storedHash));

  // A blank password keeps the stored one.
  await button(container, "Save").click();
  assert.equal(writes[0].path, "config.json");
  assert.deepEqual(saved(0), {
    apiBase: "https://books.example/xpoint",
    username: "léa",
    password: storedHash,
  });
  assert.ok(!shown().includes(storedHash));

  // A new password is stored as its MD5, and the UTF-8 username round-trips.
  named(container, "password").value = replacementPassword;
  await button(container, "Save").click();
  assert.equal(saved(1).password, md5(replacementPassword));
  assert.equal(saved(1).username, "léa");
  assert.equal(named(container, "password").value, "");
  assert.ok(!shown().includes(replacementPassword));
  assert.ok(!shown().includes(md5(replacementPassword)));

  // The bundled MD5 matches Node's across padding boundaries.
  let lastPassword = "";
  for (const length of [1, 27, 28, 31, 32, 33, 60, 100]) {
    lastPassword = "é".repeat(length);
    named(container, "password").value = lastPassword;
    await button(container, "Save").click();
    assert.equal(saved(writes.length - 1).password, md5(lastPassword), `md5 length ${length}`);
  }
  named(container, "password").value = "";
  await button(container, "Save").click();
  assert.equal(saved(writes.length - 1).password, md5(lastPassword));

  // URLs: trailing slashes and /koreader are stripped.
  for (const [input, expected] of [
    ["https://books.example/xpoint/koreader", "https://books.example/xpoint"],
    ["https://books.example/xpoint/koreader/", "https://books.example/xpoint"],
    ["https://books.example/xpoint///", "https://books.example/xpoint"],
    ["http://10.0.0.5:8084/koreader", "http://10.0.0.5:8084"],
    ["https://books.example", "https://books.example"],
  ]) {
    named(container, "apiBase").value = input;
    await button(container, "Save").click();
    assert.equal(saved(writes.length - 1).apiBase, expected, input);
  }

  // Invalid input is rejected without writing.
  const count = writes.length;
  named(container, "apiBase").value = "file:///etc/passwd";
  await button(container, "Save").click();
  assert.equal(writes.length, count);
  assert.ok(allNodes(container).some((node) => node.textContent === "Enter a valid HTTP(S) Shimmory URL."));

  console.log(`PLUGIN_SMOKE_PASS writes=${writes.length} secret_status_leaks=0 utf8=ok`);
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
