# Architecture Notes

Known, intentional scope boundaries of this prototype — documented so they read as deliberate decisions rather than gaps or bugs if questioned.

## Single professor login sees all courses

This prototype uses a single professor login (`prof`) with visibility into all seeded courses for demo purposes. Production would have per-professor accounts, each seeing only their own timetable_slots via `professor_identifier` matching their login.

Because of this, the Professor calendar view can show classes belonging to other seeded courses (e.g. BDC, SOM) alongside DTAI's own. Each such class card is labeled with its real course and professor name (e.g. "BDC · Prof Arunabha Mukhopadhyay") so this reads as intentional multi-course visibility for one demo account, not a data-integrity bug.

## "Laptop verification" is a lower-precision geolocation reading, not a real network check

Scan.jsx's `verification_tier` field distinguishes `phone_gps` from `laptop_network`, but browsers have no API that exposes a device's real Wifi SSID or any true network-proximity signal, for privacy reasons — no web page can ask "which Wifi network is this?" or "how far is this device from the access point?"

So `laptop_network` is not an actual network check. It's the same `navigator.geolocation` reading used for phones, just interpreted differently: laptops typically resort to Wifi-based positioning (rather than a GPS chip), which the browser reports with a much larger `coords.accuracy` value (often 100s of meters instead of single-digit-to-low-tens of meters). Scan.jsx uses that accuracy value as a proxy to infer "this is probably a laptop" and applies a more forgiving distance-match threshold (500m instead of 100m) accordingly. If geolocation fails entirely — more common on laptops, whether from a denied permission prompt, no hardware support, or a timeout — the record is still created (matching the flag-don't-block philosophy used elsewhere for GPS mismatches), tagged `laptop_network`, and flagged with an honest reason rather than a fabricated position.

This was a deliberate, disclosed scope decision made early in the project, not an oversight: a real network-proximity check would require infrastructure (e.g. matching against the classroom's actual Wifi access point, or a native app with different permissions) that a browser-based prototype cannot access. Anywhere `verification_tier` is shown in a report or export, `laptop_network` is labeled distinctly from `phone_gps` so a reader can't mistake the two for equally precise.
