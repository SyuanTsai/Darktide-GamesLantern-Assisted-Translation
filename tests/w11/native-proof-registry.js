(function installIsolatedW11Proof(root) {
  // Test-harness-only proofs for fixed ability-card and editor-tooltip fixtures. Never copied into a normal development build.
  root.W11TestProofRegistry = Object.freeze({
    proofs: Object.freeze([
      {
        evidenceId: 'w11-test-only-approved-candidate-ability-fixture',
        sha256: '1edab67f63d228a8edfee24a4076ebb9f25aab4fe7e5a3ff8936d32ddac75a5a',
        identity: Object.freeze({ gameVersion: '1.13.2', gameReleaseId: 'darktide:1.13.2',
          snapshotId: 'psyker-skills-blessings-1.13.2-18-files' })
      },
      {
        evidenceId: 'w11-test-only-approved-candidate-editor-tooltip-fixture',
        sha256: '4ec72632b547b1690e571f27285fb94cd71752b06ba9b040f5546309c3182008',
        patchLabel: 'Depths of the Damned',
        identity: Object.freeze({ gameVersion: '1.13.2', gameReleaseId: 'darktide:1.13.2',
          snapshotId: 'psyker-skills-blessings-1.13.2-18-files' })
      },
      {
        evidenceId: 'w11-test-only-approved-reader-page-with-brain-rupture-card',
        sha256: '4265e2f772752e2b6ca9294e6699133b8780bbc0be118d531a4fb53c542d08fd',
        identity: Object.freeze({ gameVersion: '1.13.2', gameReleaseId: 'darktide:1.13.2',
          snapshotId: 'psyker-skills-blessings-1.13.2-18-files' })
      }
    ])
  });
})(globalThis);
