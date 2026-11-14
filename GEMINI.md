# Worm Battles — Agent Workspace Rules

## 1. Strict Character Folder Isolation (CRITICAL)
When generating, editing, slicing, or compiling sprites for a character `<char_id>` (e.g., `guitar_1`, `guitar_2`, `bass`, `drums`, `air_squid`):
- **ONLY** use reference images located inside `assets_src/characters/<char_id>/refs/` (or existing masters in `assets_src/characters/<char_id>/masters/`).
- **NEVER** pass, read, or reference any image from another character's folder (e.g., never use `guitar_2` as a style or proportion reference for `guitar_1`). Each character represents a distinct real person or boss and must only be derived from their own folder's references.
- When invoking the `image-generator` subagent for `<char_id>`, explicitly pass ONLY paths from `assets_src/characters/<char_id>/refs/` and instruct the subagent not to read any other character folder.

## 2. Character Reference (`refs/`) & Sprite Generation Rules
- **Universal Sprite Rules & Resolution Standards:** Before generating, editing, or prompting a subagent for sprites of ANY character, the agent MUST read [`assets_src/SPRITE_RULES.md`](file:///Users/zak/Unsynced/code/worm_battles/assets_src/SPRITE_RULES.md) and inject its constraints (margins, no sparks/effects, likeness priority, consistency, animation rules) into the generation brief.
  - **Native 256px Resolution for Characters & Bosses:** All character and boss sprites must be generated and stored as **256px native masters** (256px master height) to preserve authentic 16-bit arcade pixel clustering and sharp contrast.
  - **Native 128px Resolution for Effects (FX):** All combat FX, particles, and spell effects must be generated at **128px** (128×128).
- Inside `assets_src/characters/<char_id>/refs/`, files follow strict functional roles:
  - `description.md` (or `.txt`): Describes the character, outfit, instrument/accessories, and the list of expected poses.
    - **Override rule:** Clothing and instrument details in `description.md` override what is seen in reference photos; if `description.md` does not specify a detail, take it from the `instrument` and/or `character` reference images.
    - **Keep up to date:** Whenever the user requests a change to a character, outfit, instrument, or pose list (adding/removing/changing a pose), the agent MUST update `description.md` to stay in sync.
  - `character_<x>` (or `character.png`): Photos of the person used to establish facial/body likeness.
  - `instrument_<x>` (or `instrument.png`): Photos of the instrument or held accessory.
  - **Numbered priority rule (`<x>`):** When multiple `character_<x>` or `instrument_<x>` files exist, lower numbers have higher influence (`_01` wins over `_02` if they have contradictory elements).
  - `pose_<posename>`: Depicts a single pose (human, game sprite, or Pinta stick-figure using Black=body/arms/legs, Blue=`#0066FF` instrument/accessory; Red/Green strictly optional only if arms cross). **CRITICAL:** The character's facial/body likeness must **NEVER** be influenced by an image prefixed with `pose_` — use it strictly for body/limb/instrument positioning for that specific pose. Hands, fingers, and palms must always be bare skin tone (no gloves).
  - `packed_sheet.png`: Created after sprite generation is completed, packing all poses for that character into a single image.

## 3. Single-Step Sprite Processing Command
To minimize command executions and keep prefix-matching auto-approval working smoothly:
- Always invoke `node scripts/sprite_studio.mjs` directly using literal arguments (no shell variables or command substitutions).
- Use the single-step `build-pose` or `build-sheet` subcommands so importing to `masters/` and compiling to `public/assets/` happen in a single command invocation.

## 4. Image-Generator Quota Conservation & Automatic `.env` Fallback
Because Antigravity's `image-generator` subagent uses a strict 5-hour rolling window quota on `cloudcode-pa.googleapis.com` (and ignores Google One `AI Credits`):
1. **Check Free Pro Quota First (`node scripts/sprite_studio.mjs quota-status`):**
   - Before generating an image, check `.gemini_image_quota.json` (via `quota-status`).
   - If the free Google AI Pro 5-hour quota window is **available** (current time is past `quotaResetTimeStamp`), invoke the `image-generator` subagent first (instructing it to make **at most 1 `generate_image` call** and return immediately without internal retries).
   - If the subagent hits a `429 RESOURCE_EXHAUSTED` error, record the new `quotaResetTimeStamp` via `node scripts/sprite_studio.mjs quota-status --set-reset <ISO_TIMESTAMP>` and immediately fall back to step 2.
2. **Fallback to `GEMINI_API_KEY` in `.env` (`node scripts/sprite_studio.mjs generate-image`):**
   - Whenever the free Pro quota is on cooldown, run `node scripts/sprite_studio.mjs generate-image` (which reads `GEMINI_API_KEY` from `.env` and calls Vertex AI / Gemini API directly).
3. **Never** pass a flawed draft sprite back into `ImagePaths`/`--refs` to fix a pose/angle/scale issue (doing so locks the model to the flawed silhouette via img2img conditioning); instead, re-generate cleanly from the `refs/` photos with stronger prompt constraints.


