# Project-Level Visual Continuity System — Design

## Problem

Each storyboard scene image is generated independently (`gpt-image-1`
`/v1/images/generations`, text-to-image only), so recurring characters,
products, and locations drift in appearance across scenes within the same
project — different face, different outfit, different product packaging,
different background, even though the ad is meant to be one continuous shoot.

## Goal

Introduce a project-level **Visual Bible** (a structured, persistent
description of every recurring character / product / location) and thread it
through storyboard generation, image generation, and every regenerate/edit
path, so recurring entities keep a consistent visual identity across scenes
while pose, framing, camera angle, and lighting remain free to vary per scene.

Out of scope for this iteration: any user-facing UI to view or edit the
Visual Bible (backend-only; decided during brainstorming). A future
iteration can add a read/edit panel without touching the data model.

## Current System (from code analysis)

- **Storyboard generation** (`supabase/functions/ai-director/index.ts`):
  one `gpt-4o-mini` JSON-mode call produces `concept`, `creativeDirection`,
  and a `shots[]` array. Each shot is inserted as a row in `cuts` with plain
  text fields (`scene_description`, `dialogue`, `camera_direction`,
  `shot_size`, `lens`, `angle`, `movement`, `composition`, `action`,
  `lighting`, `mood`, `location`, `props`, `sfx`, `transition`, `purpose`).
  No entity concept exists. A second code path (when a `creativeDirection`
  treatment was already approved) calls a shots-only variant of the same
  contract.
- **Image generation** (`supabase/functions/generate-image/index.ts`):
  builds a prompt from style modifier + `project.overall_prompt` +
  `cut.scene_description` + `cut.camera_direction`, then calls
  `gpt-image-1` via `/v1/images/generations` (pure text-to-image, no
  reference image, no seed). Every cut is generated from scratch.
- **Regenerate paths**:
  - `shot-editor` (single shot quick actions / free-form instruction):
    text-only `gpt-4o-mini` call rewrites one shot's fields and resets
    `image_url`/`generation_status` to force re-generation.
  - `storyboard-editor` (presets like "More Cinematic", "Make It Crazy",
    "Ask the Director"): text-only `gpt-4o-mini` call rewrites the whole
    shot list, same reset behavior.
  - Neither path currently has any notion of persistent visual identity.
- **Data model**: `projects` has `style`, `aspect_ratio`, `overall_prompt`,
  `brief`, `creative_direction`, `creative_dna`, `creative_treatment`.
  `cuts` has the per-shot text fields listed above. No entity/continuity
  columns exist.

### Key capability confirmed

`gpt-image-1` supports `/v1/images/edits`, which accepts one or more input
images plus a text prompt and returns a single composited/edited image.
This is usable as a practical "character/product reference" mechanism,
distinct from the `/v1/images/generations` endpoint currently used
exclusively. This lets us satisfy the reference-image requirement (not just
textual "consistent character" prompt phrases).

## Design

### 1. Data model changes (minimal, additive)

New migration `0006_visual_continuity.sql`:

```sql
alter table projects
  add column if not exists visual_bible jsonb not null default '{}'::jsonb;

alter table cuts
  add column if not exists entity_refs jsonb not null default
    '{"characters":[],"products":[],"location":null}'::jsonb;
```

Both are additive with safe defaults — no existing read/write path breaks.

`visual_bible` shape:

```ts
interface VisualBible {
  globalStyle: string; // overall visual/style notes shared by every scene
  characters: Record<string, CharacterEntity>;
  products: Record<string, ProductEntity>;
  locations: Record<string, LocationEntity>;
}

interface CharacterEntity {
  label: string;           // human-readable, e.g. "30대 한국인 남성 (설명자)"
  ageRange: string;
  genderPresentation: string;
  ethnicity: string;       // only set when explicitly specified by the user
  facialCharacteristics: string;
  hairstyle: string;
  outfit: string;
  build: string;
  distinctiveTraits: string;
  referenceImageUrl: string | null; // first successful generation featuring this entity
}

interface ProductEntity {
  label: string;
  type: string;
  shape: string;
  color: string;
  material: string;
  packaging: string;
  labelDetails: string;
  relativeSize: string;
  distinctiveDetails: string;
  referenceImageUrl: string | null;
}

interface LocationEntity {
  label: string;
  environmentType: string;
  architectureInterior: string;
  keyColors: string;
  lighting: string;
  recurringProps: string;
  referenceImageUrl: string | null;
}
```

`entity_refs` shape (per `cuts` row):

```ts
interface EntityRefs {
  characters: string[]; // entity ids into visual_bible.characters
  products: string[];   // entity ids into visual_bible.products
  location: string | null; // entity id into visual_bible.locations
}
```

Entity ids are short slugs generated by the AI (e.g. `character_a`,
`product_a`, `location_a`), unique within the project.

### 2. Visual Bible generation (`ai-director`)

Extend the existing single JSON-mode call's output contract (no extra AI
round trip — same latency budget as today) to also return:

```json
{
  "visualBible": {
    "globalStyle": string,
    "characters": [{ "id": string, ...CharacterEntity fields minus referenceImageUrl }],
    "products": [{ "id": string, ...ProductEntity fields minus referenceImageUrl }],
    "locations": [{ "id": string, ...LocationEntity fields minus referenceImageUrl }]
  },
  "shots": [{ ..., "characterIds": string[], "productIds": string[], "locationId": string | null }]
}
```

Both the "generate from scratch" path and the "shots-only, treatment already
approved" path get this extension — same instruction added to each prompt:
identify recurring entities first, define them once with concrete visual
detail (deciding any unspecified-but-necessary attribute a single time), then
reference them by id from every shot that features them. New entities are
only introduced when the narrative actually introduces a new
person/product/place.

On insert: `visual_bible` is stored on the `projects` row (with
`referenceImageUrl: null` for every entity — filled in later by image
generation); each `cuts` row gets its `entity_refs` populated from the
matching shot's `characterIds`/`productIds`/`locationId`.

Validation (`isValidShotsOnly`/`isValidDirectorOutput`) is extended to
require `visualBible` and per-shot entity id arrays, but stays lenient about
empty arrays (a shot may legitimately reference no persistent entity, e.g. a
pure product-package close-up already covered by `productIds`).

### 3. Prompt composition (`generate-image`)

Replace the current flat `composePrompt` with a version that, given
`project.visual_bible` and `cut.entity_refs`, assembles (in order):

1. Style modifier (unchanged, from `STYLE_MODIFIERS[style]`)
2. `visual_bible.globalStyle`
3. Full text definition of every character in `entity_refs.characters`
4. Full text definition of every product in `entity_refs.products`
5. Full text definition of the location in `entity_refs.location` (if any)
6. `cut.scene_description` (scene-specific action/composition)
7. `cut.camera_direction`

Step 3–5 always inject the entity's full stored definition — never inferred
freshly from `scene_description` text. This directly satisfies "even if the
scene text doesn't repeat the description, don't reinterpret the entity."

`project.overall_prompt` (previously part of the prompt) is superseded by
`visual_bible.globalStyle` + entity definitions for continuity purposes, but
we keep including `overall_prompt` too (concept-level framing) since it
carries campaign concept information the bible doesn't.

### 4. Reference-image-based generation

New helper module logic inside `generate-image` (structured as an isolated
function so a future reference-capable model swap only touches this one
place):

- For each entity referenced by the cut, check `visual_bible.<type>.<id>.referenceImageUrl`.
- **No reference images available yet** (first time any of this cut's
  entities appear): call `/v1/images/generations` as today, with the
  assembled prompt.
- **One or more reference images available**: call `/v1/images/edits` with:
  - `image[]` = the reference images for every entity in this cut that has
    one (deduplicated; capped at a small number, e.g. 4, to keep request
    size reasonable — prioritize characters, then products, then location)
  - `prompt` = the same assembled prompt, plus an explicit instruction that
    identity/appearance from the reference images must be preserved while
    pose, action, framing, and camera angle follow the new scene's
    instructions (not the reference images' pose/composition)
  - `size` = resolved from `aspect_ratio` as today
- If the edits call fails (network/validation error), fall back to
  `/v1/images/generations` with the text-only assembled prompt rather than
  failing the whole generation — matches existing "best effort" behavior
  (cut marked `failed` only if both attempts fail).
- After a successful generation (either path), for every entity referenced
  by this cut whose `referenceImageUrl` is still `null`, update
  `visual_bible` on the `projects` row to set it to the newly generated
  image URL. First successful appearance "locks in" the reference for every
  entity that doesn't already have one.

### 5. Regenerate paths keep continuity

- `shot-editor`: already loads `project` — pass `visual_bible` into the AI
  prompt with an explicit instruction ("do not alter the definitions of any
  referenced character/product/location; only vary what the edit instruction
  asks for"). The AI response gains `characterIds`/`productIds`/`locationId`
  (defaulting to the existing `entity_refs` if omitted) so `entity_refs` is
  preserved/updated correctly. Image regeneration afterward automatically
  goes through the same reference-image path in `generate-image` — no
  separate change needed there.
- `storyboard-editor` (presets + free-form + Make It Crazy): same treatment
  — `visual_bible` included in the prompt with a "preserve identity" clause,
  each returned shot carries entity id arrays, `entity_refs` updated
  accordingly on write. Only entities whose narrative role explicitly
  changes (e.g. new outfit called for by the instruction) should get new or
  modified definitions — the instruction to the AI states this explicitly,
  mirroring the human-language rules in section 6 of the request.
- Quick actions like "Change Camera Angle" / "Reframe" are pure
  camera/composition changes — the system prompt tells the AI these must
  never alter entity definitions, only the shot's own camera/composition
  fields.

### 6. What stays fixed vs. what's free (enforced structurally)

Fixed (lives in `visual_bible`, re-injected verbatim every time):
character identity/face/hair/outfit (unless explicitly changed), product
identity/packaging, location production design, global visual style.

Free (lives in per-cut fields, already scene-specific today): pose,
expression, action, camera angle, shot size, framing, lens, object position,
lighting variation. This split is enforced by prompt assembly order — entity
text always comes from the bible, scene text always comes from the cut —
not by asking the model nicely in a single blob.

### 7. Existing functionality preserved

No rewrite of auth, saving, PDF export, drag-reorder, Creative DNA, or the
Director Controls UI. All new fields are additive with safe defaults so
older projects (created before this migration) continue to work — their
`visual_bible` is `{}` and `entity_refs` is the default empty shape, so
prompt assembly falls back to exactly today's behavior (style + overall
prompt + scene + camera) when no entities are present.

## Testing plan

Manual verification via the Home → Idea flow using:

> "한국인 30대 남자가 등장해서, 영양제를 손에 들고 성분과 효능에 대해 설명해주는
> 인포머셜 광고"

Generate at least 4 scenes and confirm:
- Same man recognizable across all scenes (face/hairstyle/age range held)
- Outfit unchanged unless the story calls for a change
- Same supplement bottle/packaging across scenes
- Same location's background/production design held within scenes sharing
  a location
- Pose and camera angle differ across scenes
- Regenerating a single cut preserves identity

Report back: how continuity was implemented, and whether reference-image
generation was actually exercised in the test run (vs. falling back to
text-only).

## Open implementation notes for the plan phase

- `promptComposer.ts` (client-side, used only for a legacy manual-mode
  preview) is unaffected — the real prompt composition happens server-side
  in `generate-image`; client stays as-is.
- `NewProjectPage.tsx` (manual/legacy creation path) does not go through
  `ai-director`, so projects created there simply get an empty
  `visual_bible` — acceptable, matches "no entities" fallback behavior.
