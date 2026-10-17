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

The checked-in snapshots use Source Data commit `15f285ec3ad9314435141a18125cabfc1b3d1d19` and Web commit `47e3641fb56250602144a6373e42cd9a4f7d25b1`. The exact file paths, byte lengths, and SHA-256 values are in `content/contracts/w02/owner-snapshot.lock.json`; its SHA-256 is `8cb4395b0bb813ba59af200127e3c52300ff590805dd95229c3168c7eaaa44fd`. The CLI pins that lock digest as well as the owner revisions, and rejects extra, missing, changed, or unsafe snapshot files before importing either validator.

The capability record lists the ten domain kinds accepted by the pinned Web contract. That list describes metadata vocabulary only; it does not mean the extension renders every domain. The current W01 loader requires `skills`, `blessings`, `weapons`, and `terms`, and supports those plus `game-changes`. It derives those values and dependencies from the existing loader source. The pinned Web validator checks release metadata, manifest pointers, JSON object shape, file sizes, and hashes. Domain-specific meaning and rendering remain outside this check.

The CLI checks the three known feature IDs and the native-localization prerequisite for blessing-tier presentations. It also verifies the W01 loader's game snapshot reference binding and its existing DEV restrictions. An announcement-only fixture remains a Web-scoped fixture; it does not identify a game update. Source and Web fixtures are marked fixture-only. The command always reports `runtimeIntegration: false` and `publicationEligible: false`; package version stays `0.2.30`, published packages remain unsupported by this W01 DEV loader, and pending previews still require the existing explicit opt-in.

This is a development conformance aid, not runtime integration, a content compiler, or publication approval. Authoring integration and any future renderer support require their own fixed owner revisions and validation work.
