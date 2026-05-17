# Twin: Google Geocoding

Companion to the [Google Maps Distance Matrix twin](google-maps.md). The Distance Matrix takes lat/lng; users enter addresses. We need a way to turn one into the other.

Tiny, single-endpoint twin. Deterministic per address string.

## Endpoint

- `GET /maps/api/geocode/json?address=<urlencoded>&key=<any>`

Request matches Google's Geocoding API.

## Response shape

Matches Google's:

```json
{
  "status": "OK",
  "results": [
    {
      "formatted_address": "1234 Oak St, Plano, TX 75024, USA",
      "geometry": {
        "location": { "lat": 33.0734, "lng": -96.7853 },
        "location_type": "ROOFTOP"
      },
      "place_id": "twin_place_<hash>",
      "address_components": [
        { "long_name": "1234", "short_name": "1234", "types": ["street_number"] },
        { "long_name": "Oak St", "short_name": "Oak St", "types": ["route"] },
        { "long_name": "Plano", "short_name": "Plano", "types": ["locality"] },
        { "long_name": "Texas", "short_name": "TX", "types": ["administrative_area_level_1"] },
        { "long_name": "75024", "short_name": "75024", "types": ["postal_code"] }
      ]
    }
  ]
}
```

## How coordinates are computed

Deterministic, no API calls:

1. Parse the 5-digit US zip code from the address (regex `\b\d{5}\b`).
2. Look the zip up in the twin's static zip-centroid table (Plano + McKinney + Frisco zips for v1 — add more as scenarios demand).
3. Compute a small per-address offset so different addresses in the same zip return different (but stable) coords. Hash the full address string, derive offsets in the range ±0.005° lat and ±0.005° lng (~500m envelope inside the zip).
4. Return one result with that lat/lng.

This is not geocoding. It's deterministic synthesis. Tests get reproducible coordinates; the API contract is satisfied.

## Zip-centroid table (v1 minimum)

| Zip   | City      | Lat       | Lng        |
|-------|-----------|-----------|------------|
| 75023 | Plano     | 33.0440   | -96.7320   |
| 75024 | Plano     | 33.0828   | -96.8076   |
| 75025 | Plano     | 33.0900   | -96.7280   |
| 75070 | McKinney  | 33.1924   | -96.7370   |
| 75035 | Frisco    | 33.1730   | -96.8024   |
| 75093 | Plano     | 33.0288   | -96.8290   |

Extend as new test addresses appear. New zips not in the table → `ZERO_RESULTS`.

## Failure modes (for testing)

Trigger by including a sentinel substring in the address:

- `__ZERO_RESULTS__` → `{ status: "ZERO_RESULTS", results: [] }`
- `__OVER_QUERY_LIMIT__` → HTTP 200 with `{ status: "OVER_QUERY_LIMIT" }`
- `__REQUEST_DENIED__` → HTTP 200 with `{ status: "REQUEST_DENIED" }`
- `__RATE_LIMIT_ME__` → HTTP 429 with `Retry-After: 60`

Empty `address` query param → HTTP 200 with `{ status: "INVALID_REQUEST" }`.

Zip-not-in-table addresses (no sentinel) → `ZERO_RESULTS`.

## Not supported

- Reverse geocoding (lat/lng → address). Add if a scenario needs it.
- International addresses (US only — single-country v1).
- Region biasing, language hints, component filters. Ignored if passed.
- Place autocomplete (different API; out of scope).
