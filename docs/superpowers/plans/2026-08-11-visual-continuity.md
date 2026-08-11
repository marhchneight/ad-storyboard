# Project-Level Visual Continuity System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recurring characters/products/locations keep a consistent visual identity across a storyboard's scenes, via a project-level "Visual Bible" threaded through generation, image synthesis, and every regenerate path.

**Architecture:** Extend the existing single-call `ai-director` JSON contract to also emit a `visualBible` (persistent entities) and per-shot entity id links; extend `generate-image`'s prompt assembly to always inject full entity definitions and to use `gpt-image-1`'s `/v1/images/edits` (multi-image reference) once a reference image exists per entity, falling back to `/v1/images/generations`; extend `shot-editor`/`storyboard-editor` to receive the Visual Bible as immutable context and preserve entity links unless the edit explicitly changes them.

**Tech Stack:** Deno Supabase Edge Functions (TypeScript), OpenAI `gpt-4o-mini` (chat/JSON) and `gpt-image-1` (`/v1/images/generations`, `/v1/images/edits`), Postgres/Supabase (jsonb columns).

## Global Constraints

- Additive-only DB changes: new columns get `not null default` so every existing read/write path keeps working unchanged (spec section 7).
- No frontend/UI changes — Visual Bible is backend-only this iteration (decided during brainstorming).
- No new inter-function API round trips — the Visual Bible is produced by extending the *existing* single AI call in `ai-director`, not a second call.
- This repo does not unit-test Supabase edge functions (only pure TS libs under `src/lib` get `vitest` tests, per `package.json`'s `test` script and existing `*.test.ts` files). Verification for edge function tasks is: deploy via Supabase MCP, then exercise via the browser end-to-end (final task) — there is no `pytest`/`vitest`-style step for these files.
- Follow existing per-function conventions exactly: each edge function is self-contained (no shared `_shared/` module exists in `supabase/functions/`), duplicating small helpers (`CORS_HEADERS`, `jsonResponse`, type interfaces) is the established pattern — do not introduce a shared module in this plan.

---

### Task 1: Database migration — `visual_bible` / `entity_refs` columns

**Files:**
- Create: `supabase/migrations/0006_visual_continuity.sql`

**Interfaces:**
- Produces: `projects.visual_bible` (jsonb, default `{}`), `cuts.entity_refs` (jsonb, default `{"characters":[],"products":[],"location":null}`) — consumed by Tasks 2–5.

- [ ] **Step 1: Write the migration file**

```sql
alter table projects
  add column if not exists visual_bible jsonb not null default '{}'::jsonb;

alter table cuts
  add column if not exists entity_refs jsonb not null default
    '{"characters":[],"products":[],"location":null}'::jsonb;
```

- [ ] **Step 2: Apply the migration to the live Supabase project**

Use the Supabase MCP `apply_migration` tool with `name: "visual_continuity"` and the SQL above (this project applies migrations live via MCP rather than a local Supabase CLI — see prior migrations 0001–0005 applied the same way).

- [ ] **Step 3: Verify**

Use the Supabase MCP `execute_sql` tool to run:

```sql
select column_name, data_type, column_default from information_schema.columns
where table_name in ('projects', 'cuts') and column_name in ('visual_bible', 'entity_refs');
```

Expected: two rows, both `jsonb`, with the defaults above.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0006_visual_continuity.sql
git commit -m "feat: add visual_bible/entity_refs columns for continuity system"
```

---

### Task 2: `ai-director` — generate the Visual Bible and link shots to entities

**Files:**
- Modify: `supabase/functions/ai-director/index.ts`

**Interfaces:**
- Consumes: `projects.visual_bible`, `cuts.entity_refs` columns from Task 1.
- Produces: every new project gets a populated `visual_bible` (shape: `{ globalStyle: string, characters: CharacterEntity[], products: ProductEntity[], locations: LocationEntity[] }`, entities have `{ id, label, ...fields }`, no `referenceImageUrl` yet); every `cuts` row gets `entity_refs: { characters: string[], products: string[], location: string | null }`. Task 3 (`generate-image`) reads both.

- [ ] **Step 1: Add entity instruction text and extend both output contracts**

In `supabase/functions/ai-director/index.ts`, after the existing `DIRECTOR_SYSTEM_ROLE` constant (line 6), add:

```ts
const ENTITY_INSTRUCTIONS =
  '먼저 이 광고에 반복 등장하는 visual entity(인물, 제품/사물, 장소)를 파악하세요. 각 entity에는 ' +
  '"character_a", "product_a", "location_a"처럼 프로젝트 내에서 고유한 짧은 id를 부여하고, 이후 모든 샷에서 ' +
  '동일한 id로 참조하세요. 사용자가 명시하지 않은 속성(나이대, 헤어스타일, 의상, 제품 패키지 디자인 등)은 ' +
  '이 시점에 한 번만 합리적으로 결정하고, 이후 절대 다시 임의로 바꾸지 마세요. 실제 스토리상 새로운 인물/제품/' +
  '장소가 필요한 경우에만 새 id를 만드세요. 등장하지 않는 entity는 만들지 마세요.';
```

Replace the `DIRECTOR_OUTPUT_CONTRACT` constant (lines 8–16) with:

```ts
const DIRECTOR_OUTPUT_CONTRACT =
  'Always respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"concept": string, "creativeDirection": string, ' +
  '"visualBible": {"globalStyle": string, ' +
  '"characters": [{"id": string, "label": string, "ageRange": string, "genderPresentation": string, ' +
  '"ethnicity": string, "facialCharacteristics": string, "hairstyle": string, "outfit": string, ' +
  '"build": string, "distinctiveTraits": string}], ' +
  '"products": [{"id": string, "label": string, "type": string, "shape": string, "color": string, ' +
  '"material": string, "packaging": string, "labelDetails": string, "relativeSize": string, ' +
  '"distinctiveDetails": string}], ' +
  '"locations": [{"id": string, "label": string, "environmentType": string, "architectureInterior": string, ' +
  '"keyColors": string, "lighting": string, "recurringProps": string}]}, ' +
  '"shots": [{"shotNumber": number, "duration": number, ' +
  '"shotSize": string, "lens": string, "angle": string, "movement": string, "composition": string, ' +
  '"visual": string, "action": string, "lighting": string, "mood": string, "location": string, ' +
  '"props": string, "dialogue": string, "sfx": string, "transition": string, "purpose": string, ' +
  '"characterIds": string[], "productIds": string[], "locationId": (string or null)}]}. ' +
  '"visual" is the primary visual description of the shot (what the camera sees). "dialogue" is any spoken ' +
  'line, copy, or voice-over for that shot (leave "" if silent). "duration" is seconds as a number. ' +
  '"characterIds"/"productIds"/"locationId" must reference ids defined in "visualBible" — use [] / null when ' +
  'no persistent entity applies to that shot. Keep "shots" in narrative order starting at shotNumber 1. Never ' +
  'wrap the JSON in markdown code fences.';
```

Replace the `SHOTS_ONLY_OUTPUT_CONTRACT` constant (lines 80–88) with:

```ts
const SHOTS_ONLY_OUTPUT_CONTRACT =
  'Always respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"visualBible": {"globalStyle": string, ' +
  '"characters": [{"id": string, "label": string, "ageRange": string, "genderPresentation": string, ' +
  '"ethnicity": string, "facialCharacteristics": string, "hairstyle": string, "outfit": string, ' +
  '"build": string, "distinctiveTraits": string}], ' +
  '"products": [{"id": string, "label": string, "type": string, "shape": string, "color": string, ' +
  '"material": string, "packaging": string, "labelDetails": string, "relativeSize": string, ' +
  '"distinctiveDetails": string}], ' +
  '"locations": [{"id": string, "label": string, "environmentType": string, "architectureInterior": string, ' +
  '"keyColors": string, "lighting": string, "recurringProps": string}]}, ' +
  '"shots": [{"shotNumber": number, "duration": number, "shotSize": string, "lens": string, "angle": string, ' +
  '"movement": string, "composition": string, "visual": string, "action": string, "lighting": string, ' +
  '"mood": string, "location": string, "props": string, "dialogue": string, "sfx": string, "transition": ' +
  'string, "purpose": string, "characterIds": string[], "productIds": string[], "locationId": (string or ' +
  'null)}]}. "visual" is the primary visual description of the shot (what the camera sees). "dialogue" is ' +
  'any spoken line, copy, or voice-over for that shot (leave "" if silent). "duration" is seconds as a ' +
  'number. "characterIds"/"productIds"/"locationId" must reference ids defined in "visualBible" — use [] / ' +
  'null when no persistent entity applies. Keep "shots" in narrative order starting at shotNumber 1. Never ' +
  'wrap the JSON in markdown code fences.';
```

- [ ] **Step 2: Add Visual Bible types and shot fields**

After the `DirectorShot` interface (currently lines 31–49), add the entity id fields to it and add new interfaces. Replace the interface with:

```ts
interface DirectorShot {
  shotNumber: number;
  duration: number;
  shotSize: string;
  lens: string;
  angle: string;
  movement: string;
  composition: string;
  visual: string;
  action: string;
  lighting: string;
  mood: string;
  location: string;
  props: string;
  dialogue: string;
  sfx: string;
  transition: string;
  purpose: string;
  characterIds?: string[];
  productIds?: string[];
  locationId?: string | null;
}

interface CharacterEntity {
  id: string;
  label: string;
  ageRange: string;
  genderPresentation: string;
  ethnicity: string;
  facialCharacteristics: string;
  hairstyle: string;
  outfit: string;
  build: string;
  distinctiveTraits: string;
}

interface ProductEntity {
  id: string;
  label: string;
  type: string;
  shape: string;
  color: string;
  material: string;
  packaging: string;
  labelDetails: string;
  relativeSize: string;
  distinctiveDetails: string;
}

interface LocationEntity {
  id: string;
  label: string;
  environmentType: string;
  architectureInterior: string;
  keyColors: string;
  lighting: string;
  recurringProps: string;
}

interface VisualBible {
  globalStyle: string;
  characters: CharacterEntity[];
  products: ProductEntity[];
  locations: LocationEntity[];
}

function isValidVisualBible(value: unknown): value is VisualBible {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.globalStyle !== 'string') return false;
  if (!Array.isArray(v.characters) || !Array.isArray(v.products) || !Array.isArray(v.locations)) return false;
  const hasId = (e: unknown) => !!e && typeof e === 'object' && typeof (e as Record<string, unknown>).id === 'string';
  return v.characters.every(hasId) && v.products.every(hasId) && v.locations.every(hasId);
}
```

- [ ] **Step 3: Require `visualBible` in both validators**

In `isValidDirectorOutput` (currently lines 57–67), add the check. Replace with:

```ts
function isValidDirectorOutput(value: unknown): value is DirectorOutput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.concept !== 'string' || typeof v.creativeDirection !== 'string') return false;
  if (!isValidVisualBible(v.visualBible)) return false;
  if (!Array.isArray(v.shots) || v.shots.length < 2) return false;
  return v.shots.every((s) => {
    if (!s || typeof s !== 'object') return false;
    const shot = s as Record<string, unknown>;
    return typeof shot.visual === 'string' && typeof shot.shotNumber === 'number';
  });
}
```

Also add `visualBible: VisualBible;` to the `DirectorOutput` interface (currently lines 51–55):

```ts
interface DirectorOutput {
  concept: string;
  creativeDirection: string;
  visualBible: VisualBible;
  shots: DirectorShot[];
}
```

Replace `isValidShotsOnly` (currently lines 69–78) with:

```ts
function isValidShotsOnly(value: unknown): value is { shots: DirectorShot[]; visualBible: VisualBible } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (!isValidVisualBible(v.visualBible)) return false;
  if (!Array.isArray(v.shots) || v.shots.length < 2) return false;
  return v.shots.every((s) => {
    if (!s || typeof s !== 'object') return false;
    const shot = s as Record<string, unknown>;
    return typeof shot.visual === 'string' && typeof shot.shotNumber === 'number';
  });
}
```

- [ ] **Step 4: Inject `ENTITY_INSTRUCTIONS` into both prompts and capture `visualBible`**

In the treatment branch (`if (treatment) { ... }`, currently around lines 177–239), the `userPrompt` starts with `` `${SHOTS_ONLY_OUTPUT_CONTRACT}\n\n다음은 광고 브리프입니다:...` ``. Change it to:

```ts
const userPrompt = `${SHOTS_ONLY_OUTPUT_CONTRACT}\n\n${ENTITY_INSTRUCTIONS}\n\n다음은 광고 브리프입니다:\n${briefSummary}\n\n` +
  `다음은 클라이언트가 이미 승인한 Creative Direction입니다. 이 방향을 그대로 실행하는 샷 리스트를 ` +
  `만드세요(방향을 새로 해석하지 마세요):\n제목: ${treatment.title}\n컨셉: ${treatment.concept}\n` +
  `연출 방향: ${treatment.creativeDirection}\nVisual language: ${treatment.visualLanguage.join(', ')}\n` +
  `길이: ${treatment.approach.duration ?? '미지정'}초, 예상 샷 수: ${treatment.approach.estimatedShots ?? '미지정'}, ` +
  `대사 스타일: ${treatment.approach.dialogueStyle}, 제품 노출: ${treatment.approach.productReveal}, ` +
  `카메라 스타일: ${treatment.approach.cameraStyle}\n` +
  `각 샷은 실제 촬영에 바로 쓸 수 있을 만큼 구체적이어야 합니다.${buildCopySection(copyText)}`;
```

(only the first line changed — `${ENTITY_INSTRUCTIONS}\n\n` inserted after `${SHOTS_ONLY_OUTPUT_CONTRACT}\n\n`). After parsing succeeds (`concept = treatment.concept; creativeDirectionText = treatment.creativeDirection; shots = parsed.shots;`), add:

```ts
const visualBible: VisualBible = parsed.visualBible;
```

Then find the non-treatment branch's `userPrompt` (currently around line 243):

```ts
const userPrompt = `${DIRECTOR_OUTPUT_CONTRACT}\n\n다음은 광고 브리프입니다:\n${briefSummary}\n\n` +
  `이 브리프를 바탕으로 광고 감독으로서 전체 스토리보드를 연출하세요. 광고의 목적과 타깃, 플랫폼, ` +
  `길이에 맞는 샷 개수를 스스로 판단하세요(대략 3~8개 샷 권장). 각 샷은 실제 촬영에 바로 쓸 수 있을 만큼 ` +
  `구체적이어야 합니다.${buildCopySection(copyText)}`;
```

Change to:

```ts
const userPrompt = `${DIRECTOR_OUTPUT_CONTRACT}\n\n${ENTITY_INSTRUCTIONS}\n\n다음은 광고 브리프입니다:\n${briefSummary}\n\n` +
  `이 브리프를 바탕으로 광고 감독으로서 전체 스토리보드를 연출하세요. 광고의 목적과 타깃, 플랫폼, ` +
  `길이에 맞는 샷 개수를 스스로 판단하세요(대략 3~8개 샷 권장). 각 샷은 실제 촬영에 바로 쓸 수 있을 만큼 ` +
  `구체적이어야 합니다.${buildCopySection(copyText)}`;
```

After `concept = parsed.concept; creativeDirectionText = parsed.creativeDirection; shots = parsed.shots;` in this branch, add:

```ts
const visualBible2: VisualBible = parsed.visualBible;
```

Note the two branches produce differently-scoped `const visualBible`/`const visualBible2` (both inside their own `if`/`else` blocks) — before the project insert, add a shared variable. At the top of the function (near `let concept: string; let creativeDirectionText: string; let shots: DirectorShot[];`, currently line ~173), add a fourth declaration:

```ts
let concept: string;
let creativeDirectionText: string;
let shots: DirectorShot[];
let visualBible: VisualBible;
```

Then in the treatment branch use `visualBible = parsed.visualBible;` (not a new `const`), and in the non-treatment branch use `visualBible = parsed.visualBible;` too (rename the `visualBible2` from above to just assign the outer `visualBible`). This keeps one variable in scope for the project insert below.

- [ ] **Step 5: Store `visual_bible` on the project and `entity_refs` on each cut**

Find the `projects` insert (currently lines 289–303):

```ts
const { data: project, error: projectError } = await supabase
  .from('projects')
  .insert({
    user_id: userId,
    title,
    style,
    aspect_ratio: resolvedAspectRatio,
    overall_prompt: concept,
    creative_direction: creativeDirectionText,
    creative_treatment: treatment ?? null,
    brief: brief ?? {},
  })
  .select()
  .single();
if (projectError) return jsonResponse({ error: projectError.message }, 500);
```

Add `visual_bible: visualBible,` after `brief: brief ?? {},`:

```ts
const { data: project, error: projectError } = await supabase
  .from('projects')
  .insert({
    user_id: userId,
    title,
    style,
    aspect_ratio: resolvedAspectRatio,
    overall_prompt: concept,
    creative_direction: creativeDirectionText,
    creative_treatment: treatment ?? null,
    brief: brief ?? {},
    visual_bible: visualBible,
  })
  .select()
  .single();
if (projectError) return jsonResponse({ error: projectError.message }, 500);
```

Find the `cutRows` mapping (currently lines 305–328) and add `entity_refs` to the mapped object:

```ts
const cutRows = shots
  .slice()
  .sort((a, b) => a.shotNumber - b.shotNumber)
  .map((shot, i) => ({
    project_id: project.id,
    order_index: i,
    scene_description: shot.visual ?? '',
    dialogue: shot.dialogue ?? '',
    camera_direction: [shot.angle, shot.movement].filter(Boolean).join(', '),
    duration_seconds: typeof shot.duration === 'number' ? shot.duration : null,
    shot_size: shot.shotSize ?? '',
    lens: shot.lens ?? '',
    angle: shot.angle ?? '',
    movement: shot.movement ?? '',
    composition: shot.composition ?? '',
    action: shot.action ?? '',
    lighting: shot.lighting ?? '',
    mood: shot.mood ?? '',
    location: shot.location ?? '',
    props: shot.props ?? '',
    sfx: shot.sfx ?? '',
    transition: shot.transition ?? '',
    purpose: shot.purpose ?? '',
    entity_refs: {
      characters: Array.isArray(shot.characterIds) ? shot.characterIds : [],
      products: Array.isArray(shot.productIds) ? shot.productIds : [],
      location: typeof shot.locationId === 'string' ? shot.locationId : null,
    },
  }));
```

- [ ] **Step 6: Deploy**

Use the Supabase MCP `deploy_edge_function` tool for `ai-director` with the updated file contents.

- [ ] **Step 7: Verify with a direct call**

Use the Supabase MCP `execute_sql` tool is not applicable here (this calls OpenAI); instead verify via `get_logs` after Task 6's end-to-end browser test triggers a real generation — deferred to Task 6's Step 3. For now, verify the function deployed without error: `get_edge_function` with `name: "ai-director"`, expect `status: "ACTIVE"`.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/ai-director/index.ts
git commit -m "feat: generate project Visual Bible and link shots to persistent entities"
```

---

### Task 3: `generate-image` — entity-aware prompts and reference-image generation

**Files:**
- Modify: `supabase/functions/generate-image/index.ts`

**Interfaces:**
- Consumes: `project.visual_bible`, `cut.entity_refs` (from Task 2's writes).
- Produces: after this task, `project.visual_bible.<type>.<id>.referenceImageUrl` gets populated on first successful generation of an entity, and is read back for subsequent generations of the same entity. No other function depends on this task's internals beyond the DB columns already defined in Task 1.

- [ ] **Step 1: Add entity types and prompt-description helpers**

Replace the top of `supabase/functions/generate-image/index.ts` (the `STYLE_MODIFIERS` constant and `composePrompt` function, currently lines 9–19) with:

```ts
const STYLE_MODIFIERS: Record<string, string> = {
  sketch: 'black and white pencil sketch storyboard style, rough hand-drawn line art',
  animation: 'flat 2D animation illustration style, vibrant colors, cartoon character design',
  live_action: 'photorealistic cinematic film still, realistic lighting, live action',
};

interface CharacterEntity {
  id: string;
  label: string;
  ageRange?: string;
  genderPresentation?: string;
  ethnicity?: string;
  facialCharacteristics?: string;
  hairstyle?: string;
  outfit?: string;
  build?: string;
  distinctiveTraits?: string;
  referenceImageUrl?: string | null;
}

interface ProductEntity {
  id: string;
  label: string;
  type?: string;
  shape?: string;
  color?: string;
  material?: string;
  packaging?: string;
  labelDetails?: string;
  relativeSize?: string;
  distinctiveDetails?: string;
  referenceImageUrl?: string | null;
}

interface LocationEntity {
  id: string;
  label: string;
  environmentType?: string;
  architectureInterior?: string;
  keyColors?: string;
  lighting?: string;
  recurringProps?: string;
  referenceImageUrl?: string | null;
}

interface VisualBible {
  globalStyle?: string;
  characters?: CharacterEntity[];
  products?: ProductEntity[];
  locations?: LocationEntity[];
}

interface EntityRefs {
  characters?: string[];
  products?: string[];
  location?: string | null;
}

function describeCharacter(e: CharacterEntity): string {
  return `${e.label}: ${[
    e.ageRange && `age ${e.ageRange}`,
    e.genderPresentation,
    e.ethnicity,
    e.facialCharacteristics,
    e.hairstyle && `hair: ${e.hairstyle}`,
    e.outfit && `wearing: ${e.outfit}`,
    e.build,
    e.distinctiveTraits,
  ].filter(Boolean).join(', ')}`;
}

function describeProduct(e: ProductEntity): string {
  return `${e.label}: ${[
    e.type,
    e.shape,
    e.color,
    e.material,
    e.packaging && `packaging: ${e.packaging}`,
    e.labelDetails && `label: ${e.labelDetails}`,
    e.relativeSize,
    e.distinctiveDetails,
  ].filter(Boolean).join(', ')}`;
}

function describeLocation(e: LocationEntity): string {
  return `${e.label}: ${[
    e.environmentType,
    e.architectureInterior,
    e.keyColors && `colors: ${e.keyColors}`,
    e.lighting && `lighting: ${e.lighting}`,
    e.recurringProps && `recurring props: ${e.recurringProps}`,
  ].filter(Boolean).join(', ')}`;
}

function composeEntityAwarePrompt(
  style: string,
  overallPrompt: string,
  visualBible: VisualBible,
  entityRefs: EntityRefs,
  sceneDescription: string,
  cameraDirection: string,
): string {
  const characters = (visualBible.characters ?? []).filter((c) => (entityRefs.characters ?? []).includes(c.id));
  const products = (visualBible.products ?? []).filter((p) => (entityRefs.products ?? []).includes(p.id));
  const location = (visualBible.locations ?? []).find((l) => l.id === entityRefs.location);

  const parts = [
    STYLE_MODIFIERS[style],
    visualBible.globalStyle,
    overallPrompt.trim(),
    ...characters.map(describeCharacter),
    ...products.map(describeProduct),
    location ? describeLocation(location) : null,
    sceneDescription.trim(),
    cameraDirection.trim(),
    (entityRefs.characters?.length || entityRefs.products?.length)
      ? 'Preserve the exact identity, face, hairstyle, outfit, and packaging described above; only pose, ' +
        'action, framing, and camera angle should follow the scene description.'
      : null,
  ];
  return parts.filter((p): p is string => !!p && p.length > 0).join(', ');
}

function collectReferenceImageUrls(visualBible: VisualBible, entityRefs: EntityRefs): string[] {
  const urls: string[] = [];
  for (const id of entityRefs.characters ?? []) {
    const url = visualBible.characters?.find((c) => c.id === id)?.referenceImageUrl;
    if (url) urls.push(url);
  }
  for (const id of entityRefs.products ?? []) {
    const url = visualBible.products?.find((p) => p.id === id)?.referenceImageUrl;
    if (url) urls.push(url);
  }
  if (entityRefs.location) {
    const url = visualBible.locations?.find((l) => l.id === entityRefs.location)?.referenceImageUrl;
    if (url) urls.push(url);
  }
  return [...new Set(urls)].slice(0, 4);
}

function withLockedReferenceImages(visualBible: VisualBible, entityRefs: EntityRefs, imageUrl: string): VisualBible {
  const characterIds = new Set(entityRefs.characters ?? []);
  const productIds = new Set(entityRefs.products ?? []);
  return {
    ...visualBible,
    characters: (visualBible.characters ?? []).map((c) =>
      characterIds.has(c.id) && !c.referenceImageUrl ? { ...c, referenceImageUrl: imageUrl } : c
    ),
    products: (visualBible.products ?? []).map((p) =>
      productIds.has(p.id) && !p.referenceImageUrl ? { ...p, referenceImageUrl: imageUrl } : p
    ),
    locations: (visualBible.locations ?? []).map((l) =>
      l.id === entityRefs.location && !l.referenceImageUrl ? { ...l, referenceImageUrl: imageUrl } : l
    ),
  };
}

async function generateViaText(prompt: string, size: string): Promise<string> {
  const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1 }),
  });
  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    throw new Error(`openai error: ${errText}`);
  }
  const openaiJson = await openaiRes.json();
  const b64 = openaiJson.data?.[0]?.b64_json;
  if (!b64) throw new Error('openai: no image returned');
  return b64;
}

async function generateViaReference(prompt: string, size: string, referenceUrls: string[]): Promise<string> {
  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', prompt);
  form.append('size', size);
  for (let i = 0; i < referenceUrls.length; i++) {
    const imgRes = await fetch(referenceUrls[i]);
    if (!imgRes.ok) throw new Error(`failed to fetch reference image ${referenceUrls[i]}`);
    const blob = await imgRes.blob();
    form.append('image[]', blob, `reference-${i}.png`);
  }
  const openaiRes = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
    body: form,
  });
  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    throw new Error(`openai edits error: ${errText}`);
  }
  const openaiJson = await openaiRes.json();
  const b64 = openaiJson.data?.[0]?.b64_json;
  if (!b64) throw new Error('openai edits: no image returned');
  return b64;
}
```

- [ ] **Step 2: Replace the generation call site with entity-aware prompt + reference/fallback logic**

Find this block (currently lines 65–86):

```ts
    await supabase.from('cuts').update({ generation_status: 'generating' }).eq('id', cutId);

    const prompt = composePrompt(project.style, project.overall_prompt, cut.scene_description, cut.camera_direction);
    const size = IMAGE_SIZE_BY_ASPECT_RATIO[project.aspect_ratio as string] ?? '1024x1024';

    const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1 }),
    });

    if (!openaiRes.ok) {
      await supabase.from('cuts').update({ generation_status: 'failed' }).eq('id', cutId);
      const errText = await openaiRes.text();
      return jsonResponse({ error: `openai error: ${errText}` }, 502);
    }

    const openaiJson = await openaiRes.json();
    const b64 = openaiJson.data[0].b64_json;
```

Replace it with:

```ts
    await supabase.from('cuts').update({ generation_status: 'generating' }).eq('id', cutId);

    const visualBible: VisualBible = (project.visual_bible as VisualBible) ?? {};
    const entityRefs: EntityRefs = (cut.entity_refs as EntityRefs) ?? {};

    const prompt = composeEntityAwarePrompt(
      project.style, project.overall_prompt, visualBible, entityRefs, cut.scene_description, cut.camera_direction,
    );
    const size = IMAGE_SIZE_BY_ASPECT_RATIO[project.aspect_ratio as string] ?? '1024x1024';
    const referenceUrls = collectReferenceImageUrls(visualBible, entityRefs);

    let b64: string;
    try {
      b64 = referenceUrls.length > 0
        ? await generateViaReference(prompt, size, referenceUrls)
        : await generateViaText(prompt, size);
    } catch (primaryErr) {
      if (referenceUrls.length === 0) {
        await supabase.from('cuts').update({ generation_status: 'failed' }).eq('id', cutId);
        return jsonResponse({ error: String(primaryErr) }, 502);
      }
      console.error('reference-based generation failed, falling back to text-only', String(primaryErr));
      try {
        b64 = await generateViaText(prompt, size);
      } catch (fallbackErr) {
        await supabase.from('cuts').update({ generation_status: 'failed' }).eq('id', cutId);
        return jsonResponse({ error: String(fallbackErr) }, 502);
      }
    }
```

(This removes the direct inline `fetch`/`openaiJson`/`b64` block and replaces it with the try/catch above; everything below it — `const bytes = Uint8Array.from(...)` onward — stays unchanged since it still consumes a `b64` variable of the same name and type.)

- [ ] **Step 3: Lock in the reference image after a successful generation**

Find the end of the handler, right after the `image_url`/`generation_status` update (currently):

```ts
    await supabase.from('cuts').update({ image_url: imageUrl, generation_status: 'done' }).eq('id', cutId);

    return jsonResponse({ imageUrl }, 200);
```

Replace with:

```ts
    await supabase.from('cuts').update({ image_url: imageUrl, generation_status: 'done' }).eq('id', cutId);

    const hasEntities = (entityRefs.characters?.length ?? 0) > 0 || (entityRefs.products?.length ?? 0) > 0 || !!entityRefs.location;
    if (hasEntities) {
      const updatedBible = withLockedReferenceImages(visualBible, entityRefs, imageUrl);
      await supabase.from('projects').update({ visual_bible: updatedBible }).eq('id', project.id);
    }

    return jsonResponse({ imageUrl }, 200);
```

- [ ] **Step 4: Deploy**

Use the Supabase MCP `deploy_edge_function` tool for `generate-image` with the updated file contents.

- [ ] **Step 5: Verify deployment**

`get_edge_function` with `name: "generate-image"`, expect `status: "ACTIVE"`. Full behavioral verification happens in Task 6.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/generate-image/index.ts
git commit -m "feat: entity-aware prompts and reference-image generation for continuity"
```

---

### Task 4: `shot-editor` — preserve continuity on single-shot regenerate

**Files:**
- Modify: `supabase/functions/shot-editor/index.ts`

**Interfaces:**
- Consumes: `project.visual_bible` (read-only summary), `cut.entity_refs` (current linkage, used as default).
- Produces: updated `cuts.entity_refs` per edit (same shape as Task 1/2), consumed transparently by Task 3 on the next image generation for that cut (no code change needed there — it already reads `cut.entity_refs`).

- [ ] **Step 1: Add a Visual Bible summary helper and extend the output contract**

After the `QUICK_ACTION_INSTRUCTIONS` constant (currently lines 15–24), add:

```ts
interface VisualBibleSummaryEntity {
  id: string;
  label: string;
}

interface VisualBibleForSummary {
  characters?: VisualBibleSummaryEntity[];
  products?: VisualBibleSummaryEntity[];
  locations?: VisualBibleSummaryEntity[];
}

function summarizeVisualBible(bible: VisualBibleForSummary): string {
  const fmt = (items?: VisualBibleSummaryEntity[]) => (items ?? []).map((e) => `${e.id}: ${e.label}`).join('; ');
  const parts = [
    bible.characters?.length ? `Characters: ${fmt(bible.characters)}` : null,
    bible.products?.length ? `Products: ${fmt(bible.products)}` : null,
    bible.locations?.length ? `Locations: ${fmt(bible.locations)}` : null,
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join('\n') : '(no persistent entities defined for this project)';
}
```

Replace the `OUTPUT_CONTRACT` constant (currently lines 8–13) with:

```ts
const OUTPUT_CONTRACT =
  'Respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"shot": {"duration": number, "shotSize": string, "lens": string, "angle": string, "movement": string, ' +
  '"composition": string, "visual": string, "action": string, "lighting": string, "mood": string, ' +
  '"location": string, "props": string, "dialogue": string, "sfx": string, "transition": string, ' +
  '"purpose": string, "characterIds": string[], "productIds": string[], "locationId": (string or null)}}. ' +
  '"characterIds"/"productIds"/"locationId" must reference the persistent entity ids listed below and must ' +
  'stay exactly the same as the current shot\'s ids unless the edit instruction explicitly changes which ' +
  'entity appears in this shot. Never invent a new entity id. Never wrap the JSON in markdown code fences.';
```

Add `characterIds?: string[]; productIds?: string[]; locationId?: string | null;` to the `RevisedShot` interface (currently lines 39–56):

```ts
interface RevisedShot {
  duration: number;
  shotSize: string;
  lens: string;
  angle: string;
  movement: string;
  composition: string;
  visual: string;
  action: string;
  lighting: string;
  mood: string;
  location: string;
  props: string;
  dialogue: string;
  sfx: string;
  transition: string;
  purpose: string;
  characterIds?: string[];
  productIds?: string[];
  locationId?: string | null;
}
```

- [ ] **Step 2: Pass the Visual Bible and current entity links into the prompt**

Find the `userPrompt` construction (currently lines 119–122):

```ts
    const userPrompt = `${OUTPUT_CONTRACT}\n\n` +
      `Product / concept (do not change): ${project.overall_prompt}\n\n` +
      `Current shot:\n${JSON.stringify(currentShot)}\n\n` +
      `Edit instruction: ${editInstruction}`;
```

Replace with:

```ts
    const visualBible = (project.visual_bible as VisualBibleForSummary) ?? {};
    const currentEntityRefs = (cut.entity_refs as { characters?: string[]; products?: string[]; location?: string | null }) ?? {};

    const userPrompt = `${OUTPUT_CONTRACT}\n\n` +
      `Product / concept (do not change): ${project.overall_prompt}\n\n` +
      `Persistent project entities (visual definitions live elsewhere and must not be altered by this edit):\n` +
      `${summarizeVisualBible(visualBible)}\n\n` +
      `Current shot (currently references characterIds=${JSON.stringify(currentEntityRefs.characters ?? [])}, ` +
      `productIds=${JSON.stringify(currentEntityRefs.products ?? [])}, ` +
      `locationId=${JSON.stringify(currentEntityRefs.location ?? null)}):\n${JSON.stringify(currentShot)}\n\n` +
      `Edit instruction: ${editInstruction}`;
```

- [ ] **Step 3: Write back `entity_refs` alongside the shot fields**

Find the update call (currently lines 161–181):

```ts
    const { error: updateError } = await supabase.from('cuts').update({
      scene_description: shot.visual ?? '',
      dialogue: shot.dialogue ?? '',
      camera_direction: [shot.angle, shot.movement].filter(Boolean).join(', '),
      duration_seconds: typeof shot.duration === 'number' ? shot.duration : null,
      shot_size: shot.shotSize ?? '',
      lens: shot.lens ?? '',
      angle: shot.angle ?? '',
      movement: shot.movement ?? '',
      composition: shot.composition ?? '',
      action: shot.action ?? '',
      lighting: shot.lighting ?? '',
      mood: shot.mood ?? '',
      location: shot.location ?? '',
      props: shot.props ?? '',
      sfx: shot.sfx ?? '',
      transition: shot.transition ?? '',
      purpose: shot.purpose ?? '',
      image_url: null,
      generation_status: 'idle',
    }).eq('id', cutId);
```

Add `entity_refs` before `image_url`:

```ts
    const { error: updateError } = await supabase.from('cuts').update({
      scene_description: shot.visual ?? '',
      dialogue: shot.dialogue ?? '',
      camera_direction: [shot.angle, shot.movement].filter(Boolean).join(', '),
      duration_seconds: typeof shot.duration === 'number' ? shot.duration : null,
      shot_size: shot.shotSize ?? '',
      lens: shot.lens ?? '',
      angle: shot.angle ?? '',
      movement: shot.movement ?? '',
      composition: shot.composition ?? '',
      action: shot.action ?? '',
      lighting: shot.lighting ?? '',
      mood: shot.mood ?? '',
      location: shot.location ?? '',
      props: shot.props ?? '',
      sfx: shot.sfx ?? '',
      transition: shot.transition ?? '',
      purpose: shot.purpose ?? '',
      entity_refs: {
        characters: Array.isArray(shot.characterIds) ? shot.characterIds : (currentEntityRefs.characters ?? []),
        products: Array.isArray(shot.productIds) ? shot.productIds : (currentEntityRefs.products ?? []),
        location: (typeof shot.locationId === 'string' || shot.locationId === null)
          ? shot.locationId
          : (currentEntityRefs.location ?? null),
      },
      image_url: null,
      generation_status: 'idle',
    }).eq('id', cutId);
```

- [ ] **Step 4: Deploy**

Use the Supabase MCP `deploy_edge_function` tool for `shot-editor` with the updated file contents.

- [ ] **Step 5: Verify deployment**

`get_edge_function` with `name: "shot-editor"`, expect `status: "ACTIVE"`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/shot-editor/index.ts
git commit -m "feat: preserve entity continuity through single-shot regenerate"
```

---

### Task 5: `storyboard-editor` — preserve continuity on whole-storyboard regenerate

**Files:**
- Modify: `supabase/functions/storyboard-editor/index.ts`

**Interfaces:**
- Consumes: `project.visual_bible`, each existing cut's `entity_refs`.
- Produces: updated `entity_refs` on every touched/new cut (same shape as Task 1/2/4).

- [ ] **Step 1: Add the same Visual Bible summary helper and extend the output contract**

After the `PRESET_DIRECTIONS` constant (currently lines 20–42), add:

```ts
interface VisualBibleSummaryEntity {
  id: string;
  label: string;
}

interface VisualBibleForSummary {
  characters?: VisualBibleSummaryEntity[];
  products?: VisualBibleSummaryEntity[];
  locations?: VisualBibleSummaryEntity[];
}

function summarizeVisualBible(bible: VisualBibleForSummary): string {
  const fmt = (items?: VisualBibleSummaryEntity[]) => (items ?? []).map((e) => `${e.id}: ${e.label}`).join('; ');
  const parts = [
    bible.characters?.length ? `Characters: ${fmt(bible.characters)}` : null,
    bible.products?.length ? `Products: ${fmt(bible.products)}` : null,
    bible.locations?.length ? `Locations: ${fmt(bible.locations)}` : null,
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join('\n') : '(no persistent entities defined for this project)';
}
```

Replace the `OUTPUT_CONTRACT` constant (currently lines 9–18) with:

```ts
const OUTPUT_CONTRACT =
  'Respond with a single JSON object matching this exact shape, and nothing else: ' +
  '{"creativeDirection": string, "changesSummary": string[], "shots": [{"shotNumber": number, ' +
  '"duration": number, "shotSize": string, "lens": string, "angle": string, "movement": string, ' +
  '"composition": string, "visual": string, "action": string, "lighting": string, "mood": string, ' +
  '"location": string, "props": string, "dialogue": string, "sfx": string, "transition": string, ' +
  '"purpose": string, "characterIds": string[], "productIds": string[], "locationId": (string or null)}]}. ' +
  '"changesSummary" is 2-5 short bullet strings describing what changed, written for the person who ' +
  'commissioned this (e.g. "Opening shot replaced with a more dynamic angle"). "characterIds"/"productIds"/' +
  '"locationId" must reference the persistent entity ids listed below and must stay exactly the same as each ' +
  'shot\'s current ids unless the direction explicitly changes which entity appears in that shot (e.g. a ' +
  'costume change, a new location) — never invent a new entity id. Keep "shots" in narrative order starting ' +
  'at shotNumber 1. You may add, remove, or reorder shots if the instruction calls for it. Never wrap the ' +
  'JSON in markdown code fences.';
```

Add `characterIds?: string[]; productIds?: string[]; locationId?: string | null;` to the `RevisedShot` interface (currently lines 57–75):

```ts
interface RevisedShot {
  shotNumber: number;
  duration: number;
  shotSize: string;
  lens: string;
  angle: string;
  movement: string;
  composition: string;
  visual: string;
  action: string;
  lighting: string;
  mood: string;
  location: string;
  props: string;
  dialogue: string;
  sfx: string;
  transition: string;
  purpose: string;
  characterIds?: string[];
  productIds?: string[];
  locationId?: string | null;
}
```

- [ ] **Step 2: Include current entity links in `shotsContext` and the Visual Bible in the prompt**

Find `shotsContext` (currently lines 131–149):

```ts
    const shotsContext = existingCuts.map((c: Record<string, unknown>, i: number) => ({
      shotNumber: i + 1,
      duration: c.duration_seconds,
      shotSize: c.shot_size,
      lens: c.lens,
      angle: c.angle,
      movement: c.movement,
      composition: c.composition,
      visual: c.scene_description,
      action: c.action,
      lighting: c.lighting,
      mood: c.mood,
      location: c.location,
      props: c.props,
      dialogue: c.dialogue,
      sfx: c.sfx,
      transition: c.transition,
      purpose: c.purpose,
    }));
```

Replace with:

```ts
    const shotsContext = existingCuts.map((c: Record<string, unknown>, i: number) => {
      const refs = (c.entity_refs as { characters?: string[]; products?: string[]; location?: string | null }) ?? {};
      return {
        shotNumber: i + 1,
        duration: c.duration_seconds,
        shotSize: c.shot_size,
        lens: c.lens,
        angle: c.angle,
        movement: c.movement,
        composition: c.composition,
        visual: c.scene_description,
        action: c.action,
        lighting: c.lighting,
        mood: c.mood,
        location: c.location,
        props: c.props,
        dialogue: c.dialogue,
        sfx: c.sfx,
        transition: c.transition,
        purpose: c.purpose,
        characterIds: refs.characters ?? [],
        productIds: refs.products ?? [],
        locationId: refs.location ?? null,
      };
    });
```

Find the `userPrompt` (currently lines 155–158):

```ts
    const userPrompt = `${OUTPUT_CONTRACT}\n\n` +
      `Product / concept (do not change): ${project.overall_prompt}\n\n` +
      `Current shot list:\n${JSON.stringify(shotsContext)}\n\n` +
      `Direction to apply: ${directionInstruction}`;
```

Replace with:

```ts
    const visualBible = (project.visual_bible as VisualBibleForSummary) ?? {};

    const userPrompt = `${OUTPUT_CONTRACT}\n\n` +
      `Product / concept (do not change): ${project.overall_prompt}\n\n` +
      `Persistent project entities (visual definitions live elsewhere and must not be altered unless the ` +
      `direction explicitly requires it):\n${summarizeVisualBible(visualBible)}\n\n` +
      `Current shot list:\n${JSON.stringify(shotsContext)}\n\n` +
      `Direction to apply: ${directionInstruction}`;
```

- [ ] **Step 3: Write `entity_refs` back for both updated and newly-inserted cuts**

Find the update loop (currently lines 200–224):

```ts
    for (let i = 0; i < minLen; i++) {
      const shot = newShots[i];
      await supabase.from('cuts').update({
        order_index: i,
        scene_description: shot.visual ?? '',
        dialogue: shot.dialogue ?? '',
        camera_direction: [shot.angle, shot.movement].filter(Boolean).join(', '),
        duration_seconds: typeof shot.duration === 'number' ? shot.duration : null,
        shot_size: shot.shotSize ?? '',
        lens: shot.lens ?? '',
        angle: shot.angle ?? '',
        movement: shot.movement ?? '',
        composition: shot.composition ?? '',
        action: shot.action ?? '',
        lighting: shot.lighting ?? '',
        mood: shot.mood ?? '',
        location: shot.location ?? '',
        props: shot.props ?? '',
        sfx: shot.sfx ?? '',
        transition: shot.transition ?? '',
        purpose: shot.purpose ?? '',
        image_url: null,
        generation_status: 'idle',
      }).eq('id', existingCuts[i].id);
    }
```

Replace with:

```ts
    for (let i = 0; i < minLen; i++) {
      const shot = newShots[i];
      await supabase.from('cuts').update({
        order_index: i,
        scene_description: shot.visual ?? '',
        dialogue: shot.dialogue ?? '',
        camera_direction: [shot.angle, shot.movement].filter(Boolean).join(', '),
        duration_seconds: typeof shot.duration === 'number' ? shot.duration : null,
        shot_size: shot.shotSize ?? '',
        lens: shot.lens ?? '',
        angle: shot.angle ?? '',
        movement: shot.movement ?? '',
        composition: shot.composition ?? '',
        action: shot.action ?? '',
        lighting: shot.lighting ?? '',
        mood: shot.mood ?? '',
        location: shot.location ?? '',
        props: shot.props ?? '',
        sfx: shot.sfx ?? '',
        transition: shot.transition ?? '',
        purpose: shot.purpose ?? '',
        entity_refs: {
          characters: Array.isArray(shot.characterIds) ? shot.characterIds : [],
          products: Array.isArray(shot.productIds) ? shot.productIds : [],
          location: typeof shot.locationId === 'string' ? shot.locationId : null,
        },
        image_url: null,
        generation_status: 'idle',
      }).eq('id', existingCuts[i].id);
    }
```

Find the extra-rows insert block (currently lines 226–248):

```ts
    if (newShots.length > existingCuts.length) {
      const extraRows = newShots.slice(minLen).map((shot, i) => ({
        project_id: projectId,
        order_index: minLen + i,
        scene_description: shot.visual ?? '',
        dialogue: shot.dialogue ?? '',
        camera_direction: [shot.angle, shot.movement].filter(Boolean).join(', '),
        duration_seconds: typeof shot.duration === 'number' ? shot.duration : null,
        shot_size: shot.shotSize ?? '',
        lens: shot.lens ?? '',
        angle: shot.angle ?? '',
        movement: shot.movement ?? '',
        composition: shot.composition ?? '',
        action: shot.action ?? '',
        lighting: shot.lighting ?? '',
        mood: shot.mood ?? '',
        location: shot.location ?? '',
        props: shot.props ?? '',
        sfx: shot.sfx ?? '',
        transition: shot.transition ?? '',
        purpose: shot.purpose ?? '',
      }));
      await supabase.from('cuts').insert(extraRows);
    } else if (existingCuts.length > newShots.length) {
```

Replace the `extraRows` mapping with:

```ts
    if (newShots.length > existingCuts.length) {
      const extraRows = newShots.slice(minLen).map((shot, i) => ({
        project_id: projectId,
        order_index: minLen + i,
        scene_description: shot.visual ?? '',
        dialogue: shot.dialogue ?? '',
        camera_direction: [shot.angle, shot.movement].filter(Boolean).join(', '),
        duration_seconds: typeof shot.duration === 'number' ? shot.duration : null,
        shot_size: shot.shotSize ?? '',
        lens: shot.lens ?? '',
        angle: shot.angle ?? '',
        movement: shot.movement ?? '',
        composition: shot.composition ?? '',
        action: shot.action ?? '',
        lighting: shot.lighting ?? '',
        mood: shot.mood ?? '',
        location: shot.location ?? '',
        props: shot.props ?? '',
        sfx: shot.sfx ?? '',
        transition: shot.transition ?? '',
        purpose: shot.purpose ?? '',
        entity_refs: {
          characters: Array.isArray(shot.characterIds) ? shot.characterIds : [],
          products: Array.isArray(shot.productIds) ? shot.productIds : [],
          location: typeof shot.locationId === 'string' ? shot.locationId : null,
        },
      }));
      await supabase.from('cuts').insert(extraRows);
    } else if (existingCuts.length > newShots.length) {
```

- [ ] **Step 4: Deploy**

Use the Supabase MCP `deploy_edge_function` tool for `storyboard-editor` with the updated file contents.

- [ ] **Step 5: Verify deployment**

`get_edge_function` with `name: "storyboard-editor"`, expect `status: "ACTIVE"`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/storyboard-editor/index.ts
git commit -m "feat: preserve entity continuity through whole-storyboard regenerate"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only).

**Interfaces:** exercises Tasks 1–5 together through the deployed app.

- [ ] **Step 1: Generate a storyboard with the test prompt**

In the browser (existing authenticated session against the deployed app or local dev server), use the Home → Idea flow with:

```
한국인 30대 남자가 등장해서, 영양제를 손에 들고 성분과 효능에 대해 설명해주는 인포머셜 광고
```

Generate a Creative Direction, then "Direct the Storyboard →" to produce at least 4 scenes.

- [ ] **Step 2: Inspect the stored Visual Bible and entity links**

Use the Supabase MCP `execute_sql` tool:

```sql
select id, visual_bible from projects order by created_at desc limit 1;
```

```sql
select order_index, scene_description, entity_refs from cuts
where project_id = '<id from previous query>' order by order_index;
```

Expected: `visual_bible.characters` has one character entity (matching "30대 한국인 남자"), `visual_bible.products` has one product entity (the supplement), every cut's `entity_refs.characters`/`entity_refs.products` includes those ids (unless a shot is a pure environment/insert shot).

- [ ] **Step 3: Generate images for all scenes and inspect prompts/results**

Click "이미지 생성" on each cut in order. After the first successful cut featuring the character, re-run the Step 2 `projects` query and confirm `visual_bible.characters[0].referenceImageUrl` is now set (non-null). Use `get_logs` (Supabase MCP, service `edge-function`, function `generate-image`) to confirm later calls for the same character log through `generateViaReference` (no fallback error logged) rather than erroring — if the fallback log line appears, note it but treat it as an acceptable degraded path, not a blocking failure.

- [ ] **Step 4: Visually confirm continuity**

View the generated images for all 4+ cuts side by side (download or screenshot) and confirm:
- Same man recognizable across all scenes (face/hairstyle/age range held)
- Outfit unchanged unless the story calls for a change
- Same supplement bottle/packaging across scenes
- Same location's background/production design held within scenes sharing a location
- Pose and camera angle differ across scenes

- [ ] **Step 5: Confirm regenerate preserves identity**

Use a Director Controls quick action (e.g. "Change Camera Angle") on one cut, regenerate its image, and confirm the character/product identity is unchanged while the framing differs. Re-run the Step 2 cut query for that cut and confirm `entity_refs` is unchanged (or intentionally updated only if the instruction implied an entity change).

- [ ] **Step 6: Clean up test data**

Use the Supabase MCP `execute_sql` tool to delete the test project created in Step 1 (scoped by its exact `id`), consistent with this project's established test-data cleanup practice.

- [ ] **Step 7: Report results to the user**

Summarize (in Korean, matching the rest of this session): what was implemented, whether reference-image generation (`/v1/images/edits`) was actually exercised successfully in this test run or fell back to text-only, and the observed continuity results from Steps 4–5.
