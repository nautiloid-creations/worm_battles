# Universal Sprite Generation Rules

These instructions apply to **all characters** across the entire project. Whenever the agent or an image-generation subagent generates or edits sprites, these rules must be actively injected into the brief and strictly enforced.

---

## 1. Framing, Margins & Aspect Ratio (No Cropping)
- **Generous Margins:** Every pose must have generous empty padding on all four sides. No part of the request image should be cropped..
- **Unwarped Proportions:** Never squash or stretch sprites horizontally or vertically; maintain original aspect ratio.

## 2. Clean Pixel Art (No Visual Effects)
- **Zero Impact Sparks / VFX:** Do NOT generate impact flashes, glowing hit sparks, smoke, speed lines, shockwaves, or spell effects. The sprite must only contain the character, clothing, and the physical instrument/prop.
- **Solid Flat Background:** All sprites must be isolated on a pure flat solid magenta (`#FF00FF`) background with zero background gradients, zero floor shadows, and no stray colored halos.

## 3. Strict Reference Priority & Likeness
- **Likeness Anchors:** Facial likeness, skin tone, hair color/length, beard shape/color, and body build must strictly follow `character_<x>` photo references.
- **Numbered Priority Rule:** Lower numbered references have higher priority (`character_01` wins over `character_02` if contradictory; `instrument_01` wins over `instrument_02`).
- **Description Overrides:** Clothing and instrument specifications in that character's `description.md` strictly override what appears in reference photos. If `description.md` does not specify a detail, take it from `instrument_<x>` and `character_<x>`.
- **Pose Sketch Isolation (CRITICAL):** Any file prefixed with `pose_` (human photos, game rips, or stick-figure sketches) is **STRICTLY for body/limb positioning**. It must **NEVER** influence the character's face, hair, body type, skin color, or clothing.
- **Stick-Figure Pose Encoding (Pinta Sketches):**
  - **Black:** Head, torso, legs
  - **Blue (`#0066FF`):** Instrument and held objects/accessories (guitar angle, drumsticks, etc.)
  - **Red (`#FF2222`):** Right arm / hand
  - **Green (`#00CC44`):** Left arm / hand

## 4. Character & Instrument Consistency Across Poses
- **Character Uniformity:** The character for a given set will be in different poses with different facial expressions, but they should be the same character across all poses.  In addition the scale should be constant: head size, height, torso width, and limb thickness must match identically across all poses.
- **Instrument Uniformity:** An instrument (guitar, bass, drum kit) must be identical in size, hardware color, knob/string/cymbal layout, and shell finish across all poses, though it's position and orientation relative to the frame and character may change.
- **Palette Consistency:** Clothing, hat, hair, and beard colors must remain constant across all frames (e.g. do not turn a brown beard gray or change a black hat to green).

## 5. Animation Continuity
- **Looping Animations:** some poses are designed to be used as an animated loop.  For now this includes [`idle_1`, `idle_2`] (the idle animation) and [`attack_1`, `attack_2`] (the attack animation).  Any pose of which there are multiple with the same name and unique integer `_x` suffixes should be assumed to be animations.  Take this into account when considering differences between animation frames.

## 6. Generation & Iteration Discipline
- **No Flawed Draft Recycling:** NEVER feed a flawed or warped draft sprite back into reference image lists (`ImagePaths` / `--refs`) to fix an angle, scale, or limb issue. Doing so locks the diffusion model to the flawed silhouette. Always regenerate cleanly from original photo references, pose guides, and prompt constraints.
- **Keep `description.md` Synced:** Whenever a pose is added, removed, or modified, immediately update the character's `description.md` so the source-of-truth description stays accurate.
