# Twin: Google Maps Distance Matrix

The simplest twin of the four. The only Google Maps API MyGroomTime uses is Distance Matrix, for computing drive times between appointments.

## Endpoint

- `GET /maps/api/distancematrix/json?origins=...&destinations=...&key=...`

Request format matches Google: origins and destinations are `|`-separated lists of `lat,lng` pairs or address strings. The twin requires `lat,lng` — addresses are not geocoded by this twin (use a separate twin or a hardcoded geocoder if needed; for v1 we send lat/lng from the client's geocoded address).

## Response shape

Matches Google's:

```json
{
  "status": "OK",
  "origin_addresses": ["...", "..."],
  "destination_addresses": ["...", "..."],
  "rows": [
    {
      "elements": [
        {
          "status": "OK",
          "duration": { "value": 1234, "text": "21 mins" },
          "distance": { "value": 8500, "text": "5.3 mi" }
        }
      ]
    }
  ]
}
```

## How distances are computed

Deterministic, no API calls. For each origin/destination pair:

1. Haversine distance in meters between the two lat/lng points.
2. Drive time = (haversine_meters / 1000) / 35 km/h × 3600 seconds. (35 km/h is a reasonable urban average.)
3. Add a constant 60s "stop and start" overhead.

This is not accurate — but it's deterministic, free, and good enough for tests. The route optimizer just needs a metric; the twin gives it one that ranks routes consistently.

## Failure modes (for testing)

Special origin/destination pairs trigger failure:

- Any lat = `0.0` → element status `ZERO_RESULTS`
- Any lat = `-1.0` → request status `OVER_QUERY_LIMIT` (HTTP 200 but error in body)
- Any lat = `-2.0` → HTTP 429 with `Retry-After: 60`

The adapter must handle each of these. Scenarios touching route optimization should include at least one of these failure modes.

## Rate limit simulation

Real Google enforces a per-second QPS and a daily quota. The twin enforces neither by default — but supports a `--rate-limit N` flag that returns 429 after N requests/sec, for testing the adapter's backoff behavior.

## Not supported

- Geocoding (separate API; if needed, add a `geocode.md` twin)
- Directions API (we don't show turn-by-turn; the user uses their own nav app)
- Places API
- Distance matrix traffic / `departure_time` (twin ignores time-of-day; drive times are constant)
