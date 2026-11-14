# Universal Sprite Generation Rules

These instructions apply to **all characters and visual effects (FX)** across the entire project. Whenever the agent or an image-generation subagent generates or edits sprites, these rules must be actively injected into the brief and strictly enforced.

---

## 1. Resolution Standards (256px Characters, 128px FX)
- **Character & Boss Sprites:** All character and boss sprites must be generated and stored as **256px native masters** (256px master height). This preserves authentic 16-bit arcade pixel clustering, sharp contrast, and hand-tuned facial likeness.
- **Visual Effects (FX):** All combat particles, fireballs, shockwaves, slashes, and impact bursts must be generated at **128px** (128×128).

---

## 2. Framing, Margins & Aspect Ratio (No Cropping)
- **Generous Margins:** Every pose must have generous empty padding on all four sides. No part of the requested image or character limbs should be cropped.
- **Unwarped Proportions:** Never squash or stretch sprites horizontally or vertically; maintain original aspect ratio.

## 3. Clean Pixel Art (No Visual Effects on Characters)
- **Zero Impact Sparks / VFX on Characters:** Do NOT generate impact flashes, glowing hit sparks, smoke, speed lines, shockwaves, or spell effects on character sprites. The sprite must only contain the character, clothing, and the physical instrument/prop. (Combat VFX are generated as separate 128px assets).
- **Solid Flat Background:** All sprites must be isolated on a pure flat solid magenta (`#FF00FF`) background with zero background gradients, zero floor shadows, and no stray colored halos.

## 4. Strict Reference Priority & Likeness
- **Likeness Anchors:** Facial likeness, skin tone, hair color/length, beard shape/color, and body build must strictly follow `character_<x>` photo references.
- **Numbered Priority Rule:** Lower numbered references have higher priority (`character_01` wins over `character_02` if contradictory; `instrument_01` wins over `instrument_02`).
- **Description Overrides:** Clothing and instrument specifications in that character's `description.md` strictly override what appears in reference photos. If `description.md` does not specify a detail, take it from `instrument_<x>` and `character_<x>`.
- **Pose Sketch Isolation (CRITICAL):** Any file prefixed with `pose_` (human photos, game rips, or stick-figure sketches) is **STRICTLY for body/limb positioning**. It must **NEVER** influence the character's face, hair, body type, skin color, or clothing.
- **Stick-Figure Pose Encoding (Pinta Sketches):**
  - **Black (Default for ALL body parts):** Head, torso, legs, feet, arms, and hands. By default, keep arms and hands black unless depth overlap requires differentiation.
  - **Blue (`#0066FF`):** Instrument and held objects/accessories (guitar angle, drumsticks, etc.)
  - **Red (`#FF2222`) / Green (`#00CC44`):** Strictly optional; only used if two arms cross directly in front of each other and need depth clarification.
- **Bare Hands & Skin Rule (CRITICAL):**
  - Hands, fingers, palms, and wrists MUST be rendered in the character's natural skin tone derived from `character_<x>` references.
  - NEVER render colored hands, gloves, fingerless gloves, wristbands, or tape unless explicitly demanded by `description.md`.

## 5. Character & Instrument Consistency Across Poses
- **Character Uniformity:** The character for a given set will be in different poses with different facial expressions, but they should be the same character across all poses. In addition the scale should be constant: head size, height, torso width, and limb thickness must match identically across all poses.
- **Instrument Uniformity:** An instrument (guitar, bass, drum kit) must be identical in size, hardware color, knob/string/cymbal layout, and shell finish across all poses, though its position and orientation relative to the frame and character may change.
- **Palette Consistency:** Clothing, hat, hair, and beard colors must remain constant across all frames (e.g. do not turn a brown beard gray or change a black hat to green).

## 6. Animation Continuity
- **Looping Animations:** Poses designed to be used as an animated loop (e.g. [`idle_1`, `idle_2`] or [`attack_1`, `attack_2`]) or multi-frame ultimates ([`ultimate_1`, `ultimate_2`, ...]) must share identical scale, baseline grounding, and perspective so animations cycle seamlessly without jitter.

## 7. Generation & Iteration Discipline
- **No Flawed Draft Recycling:** NEVER feed a flawed or warped draft sprite back into reference image lists (`ImagePaths` / `--refs`) to fix an angle, scale, or limb issue. Doing so locks the diffusion model to the flawed silhouette. Always regenerate cleanly from original photo references, pose guides, and prompt constraints at native 1024px.
- **Keep `description.md` Synced:** Whenever a pose is added, removed, or modified, immediately update the character's `description.md` so the source-of-truth description stays accurate.
