# Guitar 1

## Character
- white male, 40 year old
- muscular build
- short dark brown / black beard and stubble (NO gray, white, or salt-and-pepper hair)
- black tshirt, blue jeans, black tennis shoes
- trucker hat with light gray front/bill and black side/back panels

## Instrument
- kiesel vader headless multiscale guitar
    - headles means guitar should have no headstock
    - multiscale means frets are fanned / slanted
- walnut body, maple neck through (maple neck is visible between pickups)
- brown leather guitar strap

## Poses
- **`IDLE_1`**: slight crouch facing right, eyes open, hands on instrument ready to play.  Guitar body should be seen straight-on and neck almost horizontal (15 deg or so)
- **`IDLE_2`**: identical to IDLE_1 (same build, clothing, face, hat, and guitar position), but with a very subtle idle rhythm bob: a slight knee bend with head dropping only a few pixels (~3-4px) rather than an exaggerated crouch. Feet stay firmly planted on the ground.
- **`ACTIVE_1`**: crouched lower in an aggressive power stance, slightly aggressive focused expression on face (determined, slight brow furrow, eyes open, mouth closed, NOT an exaggerated angry face or head about to explode), guitar held slightly out front pushed away from body at angle approaching vertical, 75 deg or so. Right (strumming) arm angle bent at 90 degrees with the right hand positioned below shoulder height (hand must stay below the shoulder, not raised above it), ready to strum. Scale, head size, and build must match IDLE_1 proportionally.
- **`ACTIVE_2`**: similar to ACTIVE_1 (crouched lower in an aggressive stance, slightly aggressive focused expression on face, determined, eyes open, mouth closed, NOT an exaggerated angry face or head about to explode) but right arm extended straight downward across the guitar body (right hand below guitar body) as if it has just been strummed hard. Scale, head size, and build must match IDLE_1 proportionally.
- **`ATTACK_1`**: Wide aggressive power stance with legs and torso matching ACTIVE poses. The headless guitar is angled at ~50° from horizontal (following the blue line in `pose_attack_1.png`), with the body held at the right hip. Left hand grips the neck in front of the chest. The right (strumming) arm is bent with the right hand positioned firmly BELOW the shoulder at waist/rib level, hovering over the strings preparing to strum. (CRITICAL: Right hand MUST stay below shoulder height — NOT raised in the air, NOT punching).
- **`ATTACK_2`**: Same wide power stance as ATTACK_1. The headless guitar angle steepens to ~65° from horizontal (following the blue line in `pose_attack_2.png`). The right arm has just completed a powerful downward strum and is swept straight downward across/in front of the guitar body (right hand near bottom edge of guitar). Left hand holds the neck higher up near chin level.
- **`ULTIMATE_1`**: standing more upright, guitar held as if it were a rifle.  Guitar body facing camera, neck horizontal.  Character is siting down the upper horn of the body like it's a rifle scope.  Right hand on lower horn like a trigger.
- **`ULTIMATE_2`**: similar to ULTIMATE_1 but as if a large projectile has just been fired.  Guitar still held like a rifle, but guitar neck angled up 15 degrees and character's head is lifted as if looking to see if the projectile hit its mark.
- **`HIT`**: body reeling back similar to IDLE_1, but head/face turned back to the left (whiplash from impact) with an exaggerated pained grimace on his face.
- **`DOWN`**: crouched, head down as if injured, guitar vertical on the ground with left hand on the neck as if using as a support to try to stand.

## Additional Prompts & Generation Directives

### `ULTIMATE_2`
- **Reference Pairing (CRITICAL):** Pass `ultimate_1.png` as the pose anchor and **strictly EXCLUDE `idle_1.png`** from the reference set! Including `idle_1` causes diffusion models to mistakenly drop the guitar back down to the waist in a standard chord-playing pose.
- **Strict Negative Constraints:** The guitar MUST remain held up high across the chest/shoulder like a rifle. DO NOT lower the guitar to the waist or hips; DO NOT draw a standard strumming or chord-playing stance. Strictly zero VFX, muzzle flashes, or projectile sparks on the character sprite.
- **Recoil Posture & Angles:** Guitar neck kicks sharply upward at ~20–30 degrees from the blast recoil. Character's head is lifted off the scope into an upright, battle-ready position looking forward to see if the projectile hit its mark. Right hand remains on the lower horn trigger at chest height; left hand supports the raised neck. Torso leans back slightly from the rifle kickback. Legs and feet stay firmly planted in the same combat stance as `ultimate_1`.

### `ATTACK_1` & `ATTACK_2`
- **Pose Guide Fidelity (CRITICAL):** Strictly mirror the exact limb and instrument angles shown in `pose_attack_1.png` and `pose_attack_2.png`. The blue line explicitly represents the guitar body and neck orientation!
  - `ATTACK_1`: Blue line is at a ~50° angle from horizontal (moderately angled, NOT vertical). Right hand MUST be positioned below the shoulder at waist/rib height, poised over the strings ready to down-strum.
  - `ATTACK_2`: Blue line steepens to ~65° angle from horizontal. Right arm is fully extended downward across the guitar body in follow-through.
- **Strict Negative Constraints (CRITICAL):**
  - NEVER raise the right hand or right arm above the shoulder or into the air! Absolutely NO punching pose, NO raised fist, NO waving hand, NO overhead swing.
  - Both hands must stay in physical contact or immediate proximity to the guitar at all times.
  - Headless guitar: absolutely NO headstock at the end of the neck.
  - Bare hands only: skin-tone fingers, wrists, and palms (NO gloves, tape, or colored hands).
  - Pure flat `#FF00FF` magenta background, zero shadows, zero combat visual effects.
- **Reference Pairing & 2-Panel Layout:** Generate side-by-side as a 2-panel sheet (16:9 aspect ratio) referencing `active_1.png` (for arcade pixel style, face/beard likeness, clothing, and scale) alongside `pose_attack_1.png` (Panel 1) and `pose_attack_2.png` (Panel 2). Generating both poses side-by-side locks identical scale, clothing colors, and baseline grounding (`maxY: 249`).
