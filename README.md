# CrossPoint Shimmory Reading Sync

An SD plugin that sends completed CrossPoint reading sessions to Shimmory's
existing KOReader-compatible page-stat endpoint.

This repository contains only the Shimmory-specific plugin. The firmware
contribution is service-neutral: it exposes a bounded `reader.session` event
through CrossPoint's SD plugin system, without embedding Shimmory URLs,
authentication, payloads, or storage in firmware.

## Download

Grab the latest release from the [Releases
page](https://github.com/CrossR/crosspoint-shimmory-plugin/releases), and unzip
it into your CrossPoint plugins directory:

```text /.crosspoint/plugins/shimmory/ ```

Restart CrossPoint after installation, then configure **Shimmory Reading Sync**
from the web interface’s Settings page.

The plugin requires a CrossPoint build that supports SD plugins and the generic
`reader.session` event. See
[crosspoint-reader/crosspoint-reader#2612](https://github.com/crosspoint-reader/crosspoint-reader/issues/2612)
for the upstream feature context.

Detailed installation, configuration, delivery, upgrade, and troubleshooting
instructions are in [`shimmory/README.md`](shimmory/README.md) and are included
in the ZIP.

## What it syncs

Each completed active-reading session becomes one Grimmory reading session:
start time, active duration, and start and end progress. Delivery is at least
once, and Shimmory ignores repeats.

## Development

The package uses only Python and Node standard-library tooling.

```bash bash scripts/verify.sh node tests/plugin_smoke.js ```

The verification gate checks the manifest and payload contract, secret-safe
browser behavior, deterministic packaging, exact ZIP contents, and an executable
fake-DOM/API smoke test.

## Acknowledgments

Based on the [BookOrbit plugin](https://github.com/samfoy/crosspoint-bookorbit-plugin) by [@samfoy](https://github.com/samfoy).
