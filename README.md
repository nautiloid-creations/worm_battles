# Worm Battles

A retro-style 2D turn-based JRPG / arcade battle proof-of-concept built with **TypeScript**, **Vite**, and custom **pixel art** asset pipelines.

---

## Quick Start

### Prerequisites
- Node.js (v18+ recommended)
- npm

### Installation & Local Development
```bash
# Install dependencies
npm install

# Start the Vite local development server
npm run dev
```
Open **http://localhost:5173/** in your browser to play and test sprite animations in real time.

### Production Build
```bash
# Typecheck and bundle for production
npm run build

# Preview production build locally
npm run preview
```

---

## Project Structure

```text
worm_battles/
├── index.html                   # Game entry point and web font imports
├── public/
│   └── assets/
│       ├── heroes/              # Compiled 128px high, <=16 color palette game sprites
│       │   ├── guitar_1/
│       │   ├── guitar_2/
│       │   ├── bass/
│       │   └── drums/
│       └── bosses/              # Compiled boss sprites (e.g. air_squid)
├── src/
│   ├── engine/                  # Core battle state machine, turn logic, and math
│   ├── ui/                      # DOM/Canvas rendering, HUD, and animation player
│   ├── main.ts                  # Game initialization & loop
│   └── style.css                # Retro arcade styling & responsive layout
├── assets_src/                  # Editable master assets, refs, and masks (source of truth)
│   ├── SPRITE_RULES.md          # Universal sprite generation & likeness rules
│   └── characters/              # Per-character source assets (refs, masks, masters)
├── scripts/
│   └── sprite_studio.mjs        # CLI tooling for slicing, compiling, packing, and editing sprites
├── GEMINI.md                    # Autonomous agent instructions & strict isolation rules
└── package.json
```

---

## Sprite Studio Asset Pipeline (`assets_src/`)

The `assets_src/` directory holds the **editable source-of-truth assets** (character descriptions, person/instrument reference photos, pose guides, Pinta scribble masks, and high-res per-pose masters) before they are downsampled and color-quantized into `public/assets/`.

### Directory Structure per Character
```text
assets_src/characters/<char_id>/
├── refs/              # Character description, reference photos, pose guides, packed sheet
├── masks/             # Pinta cyan (#00FFFF) scribble masks for surgical edits
└── masters/           # High-resolution transparent PNG masters per pose:
                       #   idle_1.png, idle_2.png, attack_1.png, attack_2.png,
                       #   ultimate.png, hit.png, downed.png
```

---

## Character Reference Guide (`refs/`)

Each `refs/` directory holds all the reference material needed to generate consistent sprite sheets. Filenames follow strict functional naming conventions:

### Reference File Naming & Roles
- **`description.md`**: Describes the character, clothing, instrument/accessories, and the expected list of poses.
  - *Override Rule:* Clothing and instrument details written in `description.md` strictly override what appears in reference photos. If `description.md` does not specify a detail, take it from `instrument_<x>` and/or `character_<x>`.
  - *Keep Up to Date:* Whenever a pose is added, removed, or modified, `description.md` must be updated to remain the source of truth.
- **`character_<x>`**: Photos of the person used to establish facial likeness, skin tone, hair, and body build.
- **`instrument_<x>`**: Photos of the instrument or held prop.
  - *Numbered Priority Rule:* When multiple `character_<x>` or `instrument_<x>` files exist, lower numbers have higher priority (`character_01` wins over `character_02` in case of contradictions).
- **`pose_<posename>`**: Depicts a specific pose (human photo, game sprite, or stick figure).
  - *CRITICAL Likeness Rule:* The character's face, hair, and body likeness must **NEVER** be influenced by an image prefixed with `pose_`. It is strictly used for body/limb/instrument positioning for that specific pose.
- **`packed_sheet.png`**: Created after sprite generation is complete, packing all poses into a single reviewable sheet.
  - *Standard Hero Order:* `idle_1`, `idle_2`, `attack_1`, `attack_2`, `ultimate`, `hit`, `downed`.

### Universal Generation Rules
For detailed constraints on margins, avoiding visual effects/sparks, maintaining 1:1 circular proportions, animation continuity, and anti-patterns, see **[`assets_src/SPRITE_RULES.md`](assets_src/SPRITE_RULES.md)**.

---

## Pinta Conventions for Working with AI Agents

### 1. Stick-Figure Pose Sketches
When drawing stick figures in [Pinta](https://www.pinta-project.com/) to guide character poses, use these 4 standard colors so arms are never confused with held instruments:
- **Black (or White on dark bg):** Head, torso, legs
- **Blue (`#0066FF`):** Accessories / held objects (guitar body, drumsticks, pick)
- **Red (`#FF2222`):** Right arm (strumming arm/hand for guitarists)
- **Green (`#00CC44`):** Left arm (fretting arm/hand for guitarists)

### 2. Surgical Edits via "Cyan Scribble" Masking
When a sprite is 90% perfect and you only want to change one specific area (e.g., *"change the hat color"*, *"close his mouth"*, or *"reposition the right hand"*), you can use surgical cyan masking to ensure 100% of the rest of the sprite remains pixel-identical.

#### Step-by-Step Workflow:
1. **Paint the Mask in Pinta:**
   - Open the master sprite in Pinta: `assets_src/characters/<id>/masters/<pose>.png`.
   - Select the brush or pencil tool with pure **bright cyan (`#00FFFF`)**.
   - Paint a cyan blob over the exact area you want modified.
   - Save the file as: `assets_src/characters/<id>/masks/<pose>_mask.png`.
2. **Instruct Antigravity:**
   - Tell the agent what you want changed, referencing the mask:  
     > *"I saved a mask at `assets_src/characters/<id>/masks/<pose>_mask.png`. Please [describe change, e.g. 'reposition the right arm striking downward' or 'make the beard brown']." *
3. **What Antigravity Does Automatically:**
   - Generates the targeted visual revision using reference photos and your prompt.
   - Runs `node scripts/sprite_studio.mjs splice-mask`:
     ```bash
     node scripts/sprite_studio.mjs splice-mask \
       --char <id> \
       --pose <pose> \
       --mask assets_src/characters/<id>/masks/<pose>_mask.png \
       --edited /path/to/ai_edit.png
     ```
     *How it works:* The script scans the mask image, detects all pixels under the `#00FFFF` cyan blob, and replaces **only** those coordinates on your master sprite with the new pixels. Every pixel outside the cyan mask is preserved bit-for-bit.
   - Automatically re-compiles the sprite into `public/assets/heroes/<id>/` and updates `refs/packed_sheet.png`.
4. **Review & Approval:**
   - Refresh your browser at **http://localhost:5173/** or inspect `assets_src/characters/<id>/masters/<pose>.png`.
   - If approved, you're done! If further tweaks are needed, you can ask the agent for adjustments or repaint the cyan area.

---

## CLI Quick Reference (`scripts/sprite_studio.mjs`)

The `sprite_studio.mjs` script handles slicing, compiling, and sprite manipulation:

```bash
# 1. Single-step import & compile a single pose (128px max height, 16 colors max)
node scripts/sprite_studio.mjs build-pose \
  --char guitar_1 \
  --pose idle_1 \
  --input /path/to/raw_pose.jpg \
  --max-height 128 \
  --max-colors 16

# 2. Single-step slice a flexible magenta sprite sheet & compile all poses
node scripts/sprite_studio.mjs build-sheet \
  --char guitar_1 \
  --input /path/to/raw_sheet.jpg \
  --max-height 128 \
  --max-colors 16

# 3. Pack all master poses in masters/*.png into a clean magenta review sheet
node scripts/sprite_studio.mjs pack-sheet \
  --char guitar_1

# 4. Compile existing masters/*.png into game-ready PNGs in public/assets/
node scripts/sprite_studio.mjs compile \
  --char guitar_1 \
  --max-height 128 \
  --max-colors 16

# 5. Deterministic transforms (flip horizontally or vertically)
node scripts/sprite_studio.mjs transform \
  --char guitar_1 \
  --pose all \
  --flip-x

# 6. Verify character folder isolation (enforces GEMINI.md Rule 1)
node scripts/sprite_studio.mjs verify-isolation
```

---

## AI Agent Integration (`GEMINI.md`)

When pairing with Google Antigravity or other AI coding agents:
- Workspace rules and strict character isolation constraints are enforced via **[`GEMINI.md`](GEMINI.md)**.
- Agents are strictly isolated per character folder (no character may cross-reference another character's photos or master sprites).
- Universal visual and likeness constraints are loaded on-demand from **[`assets_src/SPRITE_RULES.md`](assets_src/SPRITE_RULES.md)** to conserve agent token context.
