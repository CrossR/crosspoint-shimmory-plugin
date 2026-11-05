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

  // Whether the reader joins WiFi by itself when it goes to sleep. This lives
  // in device.json ("connect": true on reader.session), which the firmware reads.
  const sleepLabel = makeElement("label");
  const sleepInput = makeElement("input");
  sleepInput.name = "sendAtSleep";
  sleepInput.type = "checkbox";
  sleepInput.checked = true;
  sleepLabel.appendChild(sleepInput);
  sleepLabel.appendChild(
    makeElement(
      "span",
      " Send sessions at sleep (joins your last WiFi network; turn off when travelling)",
    ),
  );
  container.appendChild(sleepLabel);
  let deviceDoc = null;

  const actions = makeElement("div");
  const saveButton = makeElement("button", "Save");
  saveButton.type = "button";
  const status = makeElement("p");
  status.setAttribute("role", "status");
  const testButton = makeElement("button", "Test connection");
  testButton.type = "button";
  actions.appendChild(saveButton);
  actions.appendChild(testButton);
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

  // Asks Shimmory's KOSync auth route whether the URL and credentials work.
  // The request goes through the device (api.relay) because the settings page
  // can't call another origin directly. Returns a message and never throws.
  async function checkConnection(config) {
    try {
      const response = await api.relay("GET", `${config.apiBase}/koreader/users/auth`, {
        accept: "application/json",
        "x-auth-user": config.username,
        "x-auth-key": config.password,
      });
      const code = Number(response && response.status);
      if (code === 200) return "Connected to Shimmory.";
      if (code === 401) return "Shimmory rejected the username or password.";
      if (code === 404) {
        return "Shimmory not found at that URL. Check the base URL, including any prefix such as /xpoint.";
      }
      return `Unexpected response from Shimmory (HTTP ${code || "unknown"}).`;
    } catch (_error) {
      return "Could not reach Shimmory. Check the URL and that the reader has WiFi.";
    }
  }

  testButton.addEventListener("click", async () => {
    const config = currentConfig();
    if (!config) return;
    testButton.disabled = true;
    setStatus("Checking connection…");
    try {
      setStatus(await checkConnection(config));
    } finally {
      testButton.disabled = false;
    }
  });

  function pluginDir() {
    return String(api.dir || "/.crosspoint/plugins/shimmory/").replace(/\/+$/, "");
  }

  function sessionHandler() {
    return deviceDoc && deviceDoc.events && deviceDoc.events["reader.session"];
  }

  // Rewrites device.json only when the box differs from what is stored.
  // Returns true when the file changed.
  async function saveSleepMode() {
    const handler = sessionHandler();
    const want = sleepInput.checked;
    if (!handler || want === (handler.connect === true)) return false;
    const next = JSON.parse(JSON.stringify(deviceDoc));
    if (want) next.events["reader.session"].connect = true;
    else delete next.events["reader.session"].connect;
    await api.writeFile(
      `${pluginDir()}/device.json`,
      encodeUtf8Base64(`${JSON.stringify(next, null, 2)}
`),
    );
    deviceDoc = next;
    return true;
  }

  saveButton.addEventListener("click", async () => {
    const config = currentConfig();
    if (!config) return;
    saveButton.disabled = true;
    setStatus("Saving configuration…");
    try {
      const data = encodeUtf8Base64(`${JSON.stringify(config, null, 2)}\n`);
      await api.writeFile(`${pluginDir()}/config.json`, data);
      storedPassword = config.password;
      passwordInput.value = "";
      apiBaseInput.value = config.apiBase;
      const sleepChanged = await saveSleepMode();
      const restart = sleepChanged ? " Restart the reader to apply the sleep setting." : "";
      setStatus(`Configuration saved.${restart} Checking connection…`);
      setStatus(`Configuration saved.${restart} ${await checkConnection(config)}`);
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

  async function loadDeviceMode() {
    try {
      const response = await fetch(api.pluginFile("device.json"), {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("no device.json");
      deviceDoc = await response.json();
      const handler = sessionHandler();
      if (handler) sleepInput.checked = handler.connect === true;
      else sleepInput.disabled = true;
    } catch (_error) {
      deviceDoc = null;
      sleepInput.disabled = true;
    }
  }

  loadDeviceMode();
  loadConfig();
});
