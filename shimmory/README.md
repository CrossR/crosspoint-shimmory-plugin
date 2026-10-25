# Shimmory Reading Sync for CrossPoint

This SD plugin sends completed CrossPoint reading sessions to Grimmory through
Shimmory, so they appear in Grimmory's reading stats. It does not add a catalog
or download books; use Shimmory's OPDS feed for that.

It needs a Shimmory version with the `/koreader/plugin/sessions` endpoint (the
`feat/reading-sessions` branch of Shimmory).

## Install

1. Extract the release ZIP onto the SD card so the files are at
`/.crosspoint/plugins/shimmory/`.

2. Keep that exact canonical path. `device.json` reads
`/.crosspoint/plugins/shimmory/config.json`; alternate plugin discovery roots
cannot change this absolute config path.

3. Restart CrossPoint. Event subscriptions are rebuilt at boot, so a plugin
copied onto the card during a running session will not receive events until the
next restart.

4. Open the CrossPoint web interface and find **Shimmory Reading Sync** under
Settings.

## Configure

Enter:

- **Shimmory base URL:** your KOSync URL without `/koreader`, for example
`https://books.example.tld/xpoint`. If you paste a URL ending in `/koreader` or
a trailing slash, they are removed.

- **KOSync username:** the same username CrossPoint uses for progress sync.

- **KOSync password:** the same password CrossPoint uses for progress sync. The
plugin saves only its MD5 hash, because that is what CrossPoint's KOSync client
sends and what Grimmory stores. The saved value is never displayed; leave the
field blank on later saves to keep it unchanged.

Select **Save**.

`config.example.json` is an inert example. The plugin writes the active settings
to `config.json`. The saved hash is enough to authenticate to Shimmory, so treat
that file as sensitive.

## Delivery behavior

CrossPoint queues a `reader.session` event after at least ten seconds of active
forward reading. This plugin posts it to:

`{apiBase}/koreader/plugin/sessions`

The request carries the book's hash, start and end time, active duration, and
start and end progress. Shimmory matches the hash to a book in Grimmory and
records one reading session.

Delivery is **at least once** and in order. Shimmory ignores a session it has
already recorded, so a retry is harmless. If Shimmory can't match the book, it
accepts the session and logs a warning, so one unknown book doesn't hold up
later sessions. Any non-2xx response leaves the event queued and blocks the ones
after it.

`connect: true` lets CrossPoint bring up WiFi when the device goes to sleep.
Delivery still needs a saved WiFi network, enough battery, and a reachable
Shimmory server.

## Upgrade

1. Keep `/.crosspoint/plugins/shimmory/config.json`.

2. Replace the other files in `/.crosspoint/plugins/shimmory/` with the new
package contents.

3. Restart CrossPoint.

## Troubleshooting

- **Sessions never arrive:** check the URL is your Shimmory URL (the KOSync URL
without `/koreader`), is reachable from the reader's network, and the username
and password match your KOSync ones. Shimmory rejects bad credentials with 401,
which leaves the event queued.

- **Settings do not load:** check the folder is exactly
`/.crosspoint/plugins/shimmory/` and `config.json` is valid JSON. Save again
from Settings if needed.

- **No sessions arrive:** restart after installing or changing `device.json`.
Read forward for at least ten active seconds, then let the device connect to
WiFi.

- **Sessions arrive but don't show in Grimmory:** the book wasn't matched.
Shimmory logs "No book found for session document" with the hash. Books
downloaded through Shimmory's OPDS feed and books in Grimmory with the same file
hash are matched.

- **Sleep does not upload:** check CrossPoint has a saved WiFi network, enough
battery, and network access to Shimmory.
