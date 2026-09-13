# Agent Instructions

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

## Quality Gates

Before committing code changes, run:

```bash
bun test           # unit tests (sim core, gameplay, units)
bun run build      # tsc --noEmit + vite build
```

CI (`.github/workflows/ci.yml`) runs the same on every push and PR, and `main` deploys
to Cloudflare Pages only when both pass.


## VR UI verification

When modifying or verifying VR UI, use the [playwright-webxr](https://www.npmjs.com/package/playwright-webxr) suite added at the user's direction (2026-09-12): `SPINWARD_URL=<running-production-preview-url> bun run test:xr`. Run the app's actual VR entry and wrist-menu interaction; preserve the hardware-GPU preflight. Keep the served build unchanged while testing. Report emulation and physical-headset results separately. Setup, coverage and limitations: [WebXR UI checks](qa/webxr/README.md).


## Continuing Izma scenery references

At the user's direction (2026-09-12), the screenshots in `/Users/toming/Pictures/Screenshots/` inform ongoing Spinward development. On 2026-09-13 the user confirmed that reference additions are complete. Follow [the reference program](docs/izma-reference-program.md) using the existing manifest; do not poll the folder for new images or wait for additions. Run `node qa/izma-references/scan.mjs` only when the user explicitly resumes additions or a source-integrity issue requires it. Inspect the relevant source before adopting it; keep observation and implementation status separate. Exclude Mobile Suits and combat effects, preserve source files, and balance civilian streets, buildings, distant scenery and colony infrastructure, with the current priority on the citywide non-orthogonal road network. This workflow authorizes local implementation/testing/commits; it does not add publication, push, merge or deployment authorization.
