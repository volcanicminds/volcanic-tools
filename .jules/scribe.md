## 2024-05-05 - Missing docs/ folder and llms.txt
**Learning:** The project lacked the `docs/` folder for limits/configurations and an `llms.txt` file for AI context. The codebase is entirely inside `lib/` (not `src/`). Import paths use `.js` extensions. AI models use dynamic imports.
**Action:** Create `docs/limits.md` with hardcoded limits found in the code, and establish a high-density `llms.txt` file. Ensure `llms.txt` notes that source is in `lib/` and ESM imports must include `.js`.
