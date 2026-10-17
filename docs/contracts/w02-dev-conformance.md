# W02 development contract conformance

The read-only conformance command checks fixed Source and Web contract snapshots against their owner validators and the existing W01 loader. It does not generate content, publish a package, or change the W01 runtime.

Run it offline with:

```powershell
npm run validate:w02:contract
```

The CLI can additionally verify a checkout's exact `HEAD` and the bytes of each locked file:

```powershell
npm run validate:w02:contract -- --source-root <Source-checkout> --web-root <Web-checkout>
```

The checked-in snapshots use Source Data commit `15f285ec3ad9314435141a18125cabfc1b3d1d19` and Web commit `2816042d4a7380288ac8e73d1058a8accfe5687b`. The exact file paths, byte lengths, and SHA-256 values are in `content/contracts/w02/owner-snapshot.lock.json`; it pins three Source files and 21 Web files and has SHA-256 `90c13714911497e9c757e8402b3929a1c46c2527053842e83010cec279dcb0b9`. The Web snapshot includes the fixed authoring schema, validator, representative and official-input fixtures, both owner locks, and the nested Source cache. The CLI pins that lock digest as well as the owner revisions, and rejects extra, missing, changed, or unsafe snapshot files before importing owner validators.

For the authoring path, the CLI checks the Source schema, fixture, and validator against the top-level Source pin and requires the nested Source cache inside the Web snapshot to have identical bytes. It then imports the pinned Web authoring validator, verifies schema parity and the Web authoring lock, and validates the representative fixture's typed Source references, Source pin, and exact official-input records. The fixture contains eight presentations and eight official input records, and remains non-publishable.

The capability record lists the ten domain kinds accepted by the pinned Web contract. That list describes metadata vocabulary only; it does not mean the extension renders every domain. The current W01 loader requires `skills`, `blessings`, `weapons`, and `terms`, and supports those plus `game-changes`. It derives those values and dependencies from the existing loader source. The pinned Web validator checks release metadata, manifest pointers, JSON object shape, file sizes, and hashes. Domain-specific meaning and rendering remain outside this check.

The CLI checks the three known feature IDs and the native-localization prerequisite for blessing-tier presentations. It also verifies the W01 loader's game snapshot reference binding and its existing DEV restrictions. An announcement-only fixture remains a Web-scoped fixture; it does not identify a game update. The release-metadata and authoring examples are separate synthetic fixtures: their sample release metadata is not a production package pinned to the representative Source fixture. Source, authoring, and release fixtures remain marked fixture-only. The command always reports `runtimeIntegration: false` and `publicationEligible: false`; package version stays `0.2.30`, published packages remain unsupported by this W01 DEV loader, and pending previews still require the existing explicit opt-in.

This is a development conformance aid, not production runtime integration, a content compiler, or publication approval. Runtime authoring/compiler integration and any future renderer support require separate validation work.
