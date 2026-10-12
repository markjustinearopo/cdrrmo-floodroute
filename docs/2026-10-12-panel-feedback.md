# Panel feedback implementation — 12 October 2026

The existing red/white design, navigation structure and operational features are preserved. Changes target the panel comments.

## Community entry and account access

- The root opens the community flood map without signing in. Public flood maps, alerts, road status, shelter directory and evacuation routing remain accessible during emergencies.
- Resident login is at /login (also /resident/login); officials have separate /admin/login and /barangay/login pages. Server role checks and guarded operational portals remain in place.
- Signed-in residents see a suspension/inactivity notice when account status is available. Login errors explain restricted access and offer the community map.
- Anonymous routing cannot submit an unidentified automatic rescue request; the existing warning explains that no request was sent and directs the visitor to contact CDRRMO.

## Maps, plotting and evacuation

- Flood maps start with NOAH hazard, shelters and road conditions. A shared state limiter and disabled-toggle explanation enforce a maximum of three thematic overlays, including returning preferences. Unsupported 3D layers are switched off when changing views.
- Layer controls group flood/hazard, places/access and operational overlays. A permanent text-labelled legend explains each visible overlay, with source distinctions between NOAH susceptibility, modeled risk and verified reports.
- Mobile map actions and the legend have separate positions. City framing uses bundled land bounds and resizes correctly. Full shelters are not offered for directions.
- Address lookup, coordinate entry and reverse address lookup are available in report/area/evacuation-location editors and route starting-location selection. Network failures retain coordinates and allow manual plotting.
- Flood reports support single points, multiple points and boundary polygons. Points are numbered, can be removed individually, and duplicate/crossed/degenerate/excessive plots cannot be submitted. Reports remain pending until official approval; reviewers can inspect all points and the boundary.
- Shelter actions pass the chosen destination to the planner. Starting locations can be GPS, a pin, an address or coordinates. Existing hazard/closure checks continue to govern routing.

## Coordinator observations and reports

- Officials can record rising, steady, receding or observed-cleared water with an observation time and an optional later clearance estimate. Published observations are grouped behind a compact expandable section.
- Observations over one hour old need rechecking. An estimate within one hour is explicitly labelled an estimate; it never expires a warning, reopens a road or guarantees safe passage.
- Pending flood submissions have an admin navigation badge. Verification lists filter by complete Philippine calendar days.
- Barangay incident lists default to open incidents and keep jurisdiction isolation. The admin incident queue has a barangay selector; resolved incidents are excluded from unassigned queues.
- Report coverage filters flood-area observations by date, excludes undated observations when a range is selected, and labels road/model data as a current snapshot. This is not a historical reconstruction of sensor/model conditions.
- The barangay risk table offers flagged road length (km): the union of mapped flooded/closed edges and partial closures, counted once and assigned by edge midpoint barangay. It is not a flood radius or a travel-safety guarantee.

## Database and verification

- Applied Supabase migration 20261012060007_community_flood_geometry on the confirmed CDRRMO project. It adds reported GeoJSON and an approved-only public view using security-invoker semantics and restricted anonymous column grants. Reporter identities, photos, remarks and logs remain unavailable to anonymous visitors.
- A rollback-only fixture verified approved/pending visibility, geometry round-trip, denied private columns and denied anonymous mutation before application. A live anonymous REST read returned HTTP 200 with approved-only results. Security-advisor findings were unchanged.
- Production Vite build passed using the same esbuild version's WebAssembly transform service because Windows sandbox pipe creation blocked native esbuild subprocesses. Application dependencies/configuration were not changed for this workaround.
- Safety and panel-feedback tests passed with Node's process-isolation disabled locally; the normal test command remains configured for GitHub Actions. Edge Function parse/phone checks and regex checks passed. No messaging functions or provider secrets were deployed or changed.
- Browser checks covered phone/tablet/desktop layouts, separate login screens, map-layer exchange, multi-point/polygon reporting and selected-shelter directions using isolated API fixtures. Real message delivery and live account authentication were not tested.

Assisted by Codex. No credentials are included in this change.
