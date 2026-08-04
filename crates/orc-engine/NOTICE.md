# ORC Engine lineage and attribution

ORC Engine's private transfer backend is derived from **rqbit v9.0.0-beta.2**, created by Igor Katson and distributed under the Apache License 2.0:

- Source: https://github.com/ikatson/rqbit
- Base tag: https://github.com/ikatson/rqbit/releases/tag/v9.0.0-beta.2
- Upstream copyright: Copyright 2021 Igor Katson

The preserved upstream license is at `../librqbit-v9-patched/LICENSE`. Internal rqbit crates under `../rqbit-v9/` retain the same lineage and license.

ORC carries local integration patches for its engine boundary, peer statistics, Android custom storage, paused persistence restore, file-deletion error propagation, global PEX policy, strict transport binding, and private-torrent discovery/tracker restrictions. The ORC application and ORC-owned facade remain licensed as described by the repository's root `LICENSE`; this does not replace or remove the Apache terms applying to the derived backend.
