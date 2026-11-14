# Visual Effects (FX) Specifications & Generation Guide

This document defines the asset specifications, prompt guidelines, and elemental color ramps for all combat visual effects (fireballs, elemental orbs, musical projectiles, and impact sparks).

---

## 1. Universal FX Generation Standards

All visual effects must adhere to these engine and sprite standards:
- **Master Resolution:** Native **128×128 px** masters (`128px` bounding box).
- **Background:** Pure solid flat magenta (`#FF00FF`) background with zero floor shadows, no gradients, and zero background halo.
- **Generous Margins:** Leave at least **16–20px of empty margin** on all 4 borders so whipping flame tips, electric sparks, and trails never clip the canvas edge.
- **Retro 16-Bit Pixel Clustering:** Authentic arcade pixel art style with distinct pixel clusters, hand-tuned contrast, and glowing molten cores. No blurry soft-brush airbrushing.
- **Silhouette & Edge Contrast:** Crisp perimeter delineation with dark inking/edge definitions so downscaled effects pop against bright arena backgrounds (e.g. desert sand).
- **Trajectory Convention:** Any directional projectile (fireballs, flying notes) should be drawn **facing rightwards (`-->`)** by default so the game engine can dynamically rotate or flip it along its movement vector.

---

## 2. Elemental Color Ramps & Palettes

Visual effects use vibrant 5-step color ramps:
- Standard Ramps: `[Core / Nucleus] -> [Inner Heat] -> [Main Body] -> [Perimeter] -> [Silhouette/Outline]`
- Inverted / Void Ramps (Black Center): `[Black Void Center] -> [Deep Body] -> [Vibrant Midtone] -> [Radiant Outer Rim] -> [Outer Outline]`

| Palette Name | Element / Vibe | Hex Ramp (Core -> Outer) | Typical Usage |
|---|---|---|---|
| **Solar Flame** | Fire / Heat | `#FFFFFF` -> `#FFE53B` -> `#FF6A00` -> `#D01200` -> `#450800` | Classic Fireball, Fire Orb, Explosions |
| **Electric Plasma** | Lightning / Energy | `#FFFFFF` -> `#75FFFF` -> `#00A6FF` -> `#0048C8` -> `#0C0E36` | Lightning Orb, Crackling Sparks, Shocks |
| **Toxic Acid** | Poison / Venom | `#F2FFF0` -> `#84FF14` -> `#00D22E` -> `#007A1D` -> `#042609` | Acid orbs, venom spits, boss slime |
| **Dark Magic** | Shadow / Cosmic | `#FFFFFF` -> `#FFF2FF` -> `#E85CFF` -> `#9414D6` -> `#160026` | Dark energy orbs, curse projectiles |
| **Void Magic** | Black Hole / Void | `#05000A` -> `#2E0054` -> `#8A12CC` -> `#E458FF` -> `#160026` | Inverted void orbs, black hole cores |
| **Dark Flame** | Blood Fire | `#1A0000` -> `#680404` -> `#C01200` -> `#FF7800` -> `#300400` | Blackened bloodfire, demonic flame |
| **Starlight Chorus** | Holy / Melodic | `#FFFFFF` -> `#FFF8A6` -> `#F2B800` -> `#BA7200` -> `#3E2200` | Holy musical notes, acoustic power beams |
| **Chrome & Blood** | Metal / Blade | `#FFFFFF` -> `#CBE2F4` -> `#D81A32` -> `#7B081A` -> `#1A0005` | Dangerous heavy metal musical notes, slashes |

---

## 3. FX Asset Catalog

### Category A: Fire & Heat Projectiles

#### `fx_fireball`
- **Shape & Anatomy:** Classic high-speed retro fireball facing right (`-->`). Rounded aerodynamic front head tapering back into dynamic, turbulent "licking" flame tongues and trailing ember particles.
- **Lighting:** Ultra-bright molten white-hot core at the front nucleus, radiating through vibrant cadmium yellow, fiery orange mid-body, and deep crimson licking fringes.
- **Outer Edge:** Crisp dark maroon/charcoal edge delineation to retain arcade punch against arena backdrops.
- **Default Palette:** **Solar Flame** (alternative: *Dark Flame*, *Electric Plasma*).

---

### Category B: Elemental Energy Orbs

Orbs share a common spherical energy chassis with unique dynamic secondary orbital elements:

#### `fx_orb_crackling`
- **Shape & Anatomy:** Centered spherical energy orb with a brilliant, unstable pulsing core.
- **Secondary Element:** Chaotic bursting micro-sparks, sharp particle flecks, and a jittering high-energy corona radiating outward in all directions.
- **Default Palette:** **Electric Plasma** or **Solar Flame**.

#### `fx_orb_lightning`
- **Shape & Anatomy:** A translucent glowing spherical containment orb (plasma globe style).
- **Secondary Element:** Branching electric lightning bolts writhing and arcing entirely inside the sphere, contained within its spherical boundary. No exterior orbits or radiating lines.
- **Default Palette:** **Electric Plasma** (bright cyan/blue with white bolts).

#### `fx_orb_fire`
- **Shape & Anatomy:** Rolling spherical fireball with a superheated sun-like nucleus.
- **Secondary Element:** Whipping solar flares and orbital flame tongues swirling around the equator of the orb, shedding ember trails.
- **Default Palette:** **Solar Flame** or **Dark Flame**.

---

### Category C: Musical Weaponry (Medieval Weapons Theme)

Stylized musical notation reimagined as lethal acoustic combat weapons. Inspired by medieval armory, these are aggressive, heavy, and metallic with razor-sharp bevels and solid iron/steel finishes. No glowing auras, energy trails, or directionally suggestive speed arrows:

#### `fx_note_quarter`
- **Shape & Anatomy:** Single quarter note weapon. The note head is a heavy spiked mace (spiked iron morningstar flanged sphere). The vertical stem is the sturdy iron mace shaft with a wrapped grip.
- **Finish:** Dark forged iron and polished steel with sharp specular metal highlights.
- **Default Palette:** **Chrome & Blood**.

#### `fx_note_eighth_pair`
- **Shape & Anatomy:** Two connected eighth notes. The two note heads are heavy single-bladed medieval battleaxes. The vertical stems are the axe handles, joined at the top by a thick, heavy iron connecting cross-beam bar.
- **Finish:** Honed steel axe blades with beveled cutting edges and forged iron handles.
- **Default Palette:** **Chrome & Blood**.

#### `fx_note_triplet`
- **Shape & Anatomy:** Three connected sixteenth notes (dual horizontal connecting beam bars). The three note heads are medieval flanged maces (gothic mace heads with steel radiating vertical flanges/fins).
- **Finish:** Heavy iron cluster weapon with three flanged mace heads.
- **Default Palette:** **Chrome & Blood**.

#### `fx_rest_quarter`
- **Shape & Anatomy:** The classic jagged quarter-note rest shape ($𝄽$), styled as an angular, faceted medieval throwing dagger / stiletto. Every corner and zig-zag bend forms a needle-sharp point with honed razor facets.
- **Finish:** Dark obsidian and cold steel dagger.
- **Default Palette:** **Dark Magic** or **Chrome & Blood**.

#### `fx_rest_eighth`
- **Shape & Anatomy:** The classic eighth-note rest shape ($𝄾$). The top curved hook is styled as a razor-sharp curved grim reaper scythe blade with an inner cutting edge, mounted onto an angled diagonal wooden/iron snath handle.
- **Finish:** Honed curved scythe blade with dark shaft.
- **Default Palette:** **Chrome & Blood**.

---

## 4. Prompting Template for Image-Generator Subagent

When prompting the `image-generator` subagent for an FX asset:
```text
16-bit retro arcade video game visual effect sprite of [EFFECT_NAME], isolated on a pure flat solid magenta (#FF00FF) background.
[DESCRIPTION OF SHAPE, FINISH, METALLIC EDGES, AND WEAPON DETAILS].
Color palette: [PALETTE NAME] ([HEX COLOR RAMP]).
Sharp 16-bit pixel clusters, solid dark outer ink outline for high contrast against arena backgrounds.
Master size 128x128 bounding box with generous empty margins on all four sides.
No soft glow auras, no speed trails, no background shadows, no background gradients, zero anti-aliasing to magenta background.
```
