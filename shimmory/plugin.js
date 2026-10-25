"use strict";

CrossPoint.registerPlugin((container, api) => {
  let storedPassword = "";

  function makeElement(tag, text) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function makeField(labelText, name, type) {
    const wrapper = makeElement("label");
    const label = makeElement("span", labelText);
    const input = makeElement("input");
    input.name = name;
    input.type = type || "text";
    input.autocomplete = name === "password" ? "new-password" : "off";
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    container.appendChild(wrapper);
    return input;
  }

  function normalizeApiBase(value) {
    let parsed;
    try {
      parsed = new URL(String(value).trim());
    } catch (_error) {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      return null;
    const path = parsed.pathname
      .replace(/\/+$/, "")
      .replace(/\/koreader$/i, "");
    return parsed.origin + path;
  }

  function encodeUtf8Base64(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  // CrossPoint's KOSync client sends the MD5 of the password as x-auth-key,
  // which is what Grimmory stores. WebCrypto has no MD5, so it is done here.
  const MD5_SHIFTS = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
    9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
    16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
    15, 21,
  ];
  const MD5_CONSTANTS = [];
  for (let i = 0; i < 64; i++) {
    MD5_CONSTANTS.push(
      Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0,
    );
  }

  function md5Hex(text) {
    const input = new TextEncoder().encode(text);
    const length = input.length;
    const paddedLength = (((length + 8) >> 6) + 1) << 6;
    const padded = new Uint8Array(paddedLength);
    padded.set(input);
    padded[length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, (length << 3) >>> 0, true);
    view.setUint32(paddedLength - 4, Math.floor(length / 0x20000000), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    for (let offset = 0; offset < paddedLength; offset += 64) {
      let a = a0;
      let b = b0;
      let c = c0;
      let d = d0;
      for (let i = 0; i < 64; i++) {
        let f;
        let g;
        if (i < 16) {
          f = (b & c) | (~b & d);
          g = i;
        } else if (i < 32) {
          f = (d & b) | (~d & c);
          g = (5 * i + 1) % 16;
        } else if (i < 48) {
          f = b ^ c ^ d;
          g = (3 * i + 5) % 16;
        } else {
          f = c ^ (b | ~d);
          g = (7 * i) % 16;
        }
        f =
          (f + a + MD5_CONSTANTS[i] + view.getUint32(offset + g * 4, true)) >>>
          0;
        a = d;
        d = c;
        c = b;
        const shift = MD5_SHIFTS[i];
        b = (b + (((f << shift) | (f >>> (32 - shift))) >>> 0)) >>> 0;
      }
      a0 = (a0 + a) >>> 0;
      b0 = (b0 + b) >>> 0;
      c0 = (c0 + c) >>> 0;
      d0 = (d0 + d) >>> 0;
    }

    let hex = "";
    for (const word of [a0, b0, c0, d0]) {
      for (let i = 0; i < 4; i++) {
        hex += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
      }
    }
    return hex;
  }

  const heading = makeElement("h2", "Shimmory Reading Sync");
  const help = makeElement(
    "p",
    "Send completed reading sessions to Grimmory through Shimmory, using your KOSync credentials.",
  );
  container.appendChild(heading);
  container.appendChild(help);

  const apiBaseInput = makeField(
    "Shimmory base URL (your KOSync URL without /koreader)",
    "apiBase",
    "url",
  );
  const usernameInput = makeField("KOSync username", "username", "text");
  const passwordInput = makeField("KOSync password", "password", "password");

  const actions = makeElement("div");
  const saveButton = makeElement("button", "Save");
  saveButton.type = "button";
  const status = makeElement("p");
  status.setAttribute("role", "status");
  actions.appendChild(saveButton);
  container.appendChild(actions);
  container.appendChild(status);

  function setStatus(message) {
    status.textContent = message;
  }

  // The returned password is the MD5 form that is stored and sent to Shimmory.
  function currentConfig() {
    const apiBase = normalizeApiBase(apiBaseInput.value);
    if (!apiBase) {
      setStatus("Enter a valid HTTP(S) Shimmory URL.");
      return null;
    }
    const username = usernameInput.value.trim();
    if (!username) {
      setStatus("Enter your KOSync username.");
      return null;
    }
    const password = passwordInput.value
      ? md5Hex(passwordInput.value)
      : storedPassword;
    if (!password) {
      setStatus("Enter your KOSync password.");
      return null;
    }
    return { apiBase, username, password };
  }

  saveButton.addEventListener("click", async () => {
    const config = currentConfig();
    if (!config) return;
    saveButton.disabled = true;
    setStatus("Saving configuration…");
    try {
      const data = encodeUtf8Base64(`${JSON.stringify(config, null, 2)}\n`);
      await api.writeFile("config.json", data);
      storedPassword = config.password;
      passwordInput.value = "";
      apiBaseInput.value = config.apiBase;
      setStatus("Configuration saved.");
    } catch (_error) {
      setStatus("Unable to save configuration.");
    } finally {
      saveButton.disabled = false;
    }
  });

  async function loadConfig() {
    try {
      const response = await fetch(api.pluginFile("config.json"), {
        cache: "no-store",
      });
      if (!response.ok) return;
      const config = await response.json();
      const apiBase = normalizeApiBase(config.apiBase);
      if (apiBase) apiBaseInput.value = apiBase;
      if (typeof config.username === "string")
        usernameInput.value = config.username;
      if (typeof config.password === "string") storedPassword = config.password;
      passwordInput.value = "";
      setStatus("Configuration loaded.");
    } catch (_error) {
      setStatus("No saved configuration found.");
    }
  }

  loadConfig();
});
