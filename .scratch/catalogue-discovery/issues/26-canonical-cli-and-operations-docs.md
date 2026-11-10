# 26: Canonical CLI and operations documentation

**What to build:** Rename the scripts to the agreed vocabulary and document every command, environment variable, data path, backup/restore sequence, First run, Scheduled catalogue scan and deployment. The documentation is the reference a future maintainer or rewrite can follow, not a quick start alone.

**Blocked by:** 21, 22, 23

**Status:** ready-for-agent

- [ ] Scripts are `catalogue:scan`, `catalogue:resample`, `sweep` (with `--book` and `--delay`), `enrich` (`--all`, `--unmatched`, `--failed`, `--id`), `snapshot`, `restore`, `export`, `overrides:import`, `export:unmatched`, `seed`, plus `dev`, `build`, `start`, `test`, `typecheck`.
- [ ] Old script names are removed or documented as aliases.
- [ ] Every command has its purpose, arguments and an example.
- [ ] The operations documentation covers environment variables, data layout, First run, startup catch-up, the Scheduled catalogue scan, Snapshots/Restore/Export, and the Cloudflare Tunnel deployment.
- [ ] The README links to the operations documentation.
