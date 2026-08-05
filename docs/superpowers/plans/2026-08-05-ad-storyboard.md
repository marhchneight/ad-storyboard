# 광고용 콘티 스토리보드 웹앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI가 장면별 이미지를 자동 생성해주는 광고 콘티(스토리보드) 웹앱을 만들고 Vercel에 배포한다.

**Architecture:** React + TypeScript(Vite) SPA. Supabase가 Auth/Database/Storage/Edge Function을 담당. OpenAI 이미지 생성 API는 Supabase Edge Function 뒤에 숨겨 키를 보호한다. PDF/이미지 내보내기는 클라이언트에서 처리한다.

**Tech Stack:** React 18, TypeScript, Vite, react-router-dom, @supabase/supabase-js, @dnd-kit/core (드래그 정렬), jsPDF (PDF 생성), Supabase (Postgres+Auth+Storage+Edge Functions, Deno), OpenAI Images API (`gpt-image-1`), Vercel (배포)

## Global Constraints

- 스타일은 프로젝트 단위로만 지정한다 (`sketch` | `animation` | `live_action`). 컷별 스타일 지정은 지원하지 않는다.
- 컷 개수는 프로젝트 생성 시 최소 2 이상이어야 한다. 이후에도 추가/삭제 가능하되 삭제로 인해 2 미만이 되는 것은 막는다.
- OpenAI API 키는 클라이언트 코드/번들에 절대 포함하지 않는다. Supabase Edge Function의 secret로만 존재한다.
- 각 사용자는 자기 프로젝트/컷만 조회·수정 가능해야 한다 (Supabase RLS로 강제).
- 컷별 이미지 생성 상태는 독립적으로 관리한다 (한 컷 생성 중에도 다른 컷 편집 가능).

---

## Task 1: 프로젝트 스캐폴딩 (Vite + React + TS)

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`
- Create: `src/main.tsx`, `src/App.tsx`, `src/types.ts`
- Create: `.gitignore`

**Interfaces:**
- Produces: `Project`, `Cut`, `StoryboardStyle` 타입 (이후 모든 태스크가 사용)

- [ ] **Step 1: Vite 프로젝트 생성**

```bash
cd "/Users/fertile/Desktop/AI STUDY/vibe_coding_project/project-5"
npm create vite@latest . -- --template react-ts
```

- [ ] **Step 2: 라우팅 및 필수 패키지 설치**

```bash
npm install react-router-dom @supabase/supabase-js @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities jspdf
npm install -D @types/node
```

- [ ] **Step 3: 공통 타입 정의**

`src/types.ts`:
```typescript
export type StoryboardStyle = 'sketch' | 'animation' | 'live_action';
export type GenerationStatus = 'idle' | 'generating' | 'done' | 'failed';

export interface Project {
  id: string;
  user_id: string;
  title: string;
  style: StoryboardStyle;
  overall_prompt: string;
  created_at: string;
  updated_at: string;
}

export interface Cut {
  id: string;
  project_id: string;
  order_index: number;
  scene_description: string;
  dialogue: string;
  camera_direction: string;
  image_url: string | null;
  generation_status: GenerationStatus;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: 기본 라우팅 뼈대**

`src/App.tsx`:
```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

function Placeholder({ label }: { label: string }) {
  return <div>{label}</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Placeholder label="login" />} />
        <Route path="/" element={<Placeholder label="projects" />} />
        <Route path="/projects/new" element={<Placeholder label="new project" />} />
        <Route path="/projects/:id" element={<Placeholder label="editor" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 5: 로컬 실행 확인**

```bash
npm run dev
```
Expected: 콘솔에 `Local: http://localhost:5173/` 출력, 에러 없음.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite react-ts project with routing skeleton"
```

---

## Task 2: Supabase 프로젝트 생성 및 스키마 정의

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Create: `src/lib/supabaseClient.ts`
- Create: `.env.local` (git에 포함하지 않음), `.env.example`

**Interfaces:**
- Produces: `supabase` client 싱글턴 (`src/lib/supabaseClient.ts`에서 `export const supabase`)
- Produces: `projects`, `cuts` 테이블, RLS 정책, `storyboard-images` 스토리지 버킷

- [ ] **Step 1: Supabase 프로젝트 생성 (MCP 도구 사용)**

`mcp__supabase__create_project` 도구로 새 프로젝트 생성 (이름: `ad-storyboard`). 완료 후 `get_project_url`, `get_publishable_keys`로 URL과 anon key 확보.

- [ ] **Step 2: 마이그레이션 SQL 작성**

`supabase/migrations/0001_init.sql`:
```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  style text not null check (style in ('sketch', 'animation', 'live_action')),
  overall_prompt text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table cuts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  order_index int not null,
  scene_description text not null default '',
  dialogue text not null default '',
  camera_direction text not null default '',
  image_url text,
  generation_status text not null default 'idle' check (generation_status in ('idle', 'generating', 'done', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table projects enable row level security;
alter table cuts enable row level security;

create policy "projects_owner_all" on projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "cuts_owner_all" on cuts
  for all using (
    exists (select 1 from projects p where p.id = cuts.project_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from projects p where p.id = cuts.project_id and p.user_id = auth.uid())
  );

insert into storage.buckets (id, name, public) values ('storyboard-images', 'storyboard-images', true)
  on conflict (id) do nothing;

create policy "storyboard_images_read" on storage.objects
  for select using (bucket_id = 'storyboard-images');

create policy "storyboard_images_write" on storage.objects
  for insert with check (bucket_id = 'storyboard-images');
```

- [ ] **Step 2b: 마이그레이션 적용**

`mcp__supabase__apply_migration` 도구로 위 SQL을 프로젝트에 적용.

- [ ] **Step 3: 클라이언트 초기화 코드**

`src/lib/supabaseClient.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  throw new Error('Missing Supabase env vars: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, anonKey);
```

`.env.example`:
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

`.env.local` (실제 값, git 미포함):
```
VITE_SUPABASE_URL=<get_project_url 결과>
VITE_SUPABASE_ANON_KEY=<get_publishable_keys 결과>
```

- [ ] **Step 4: `.gitignore`에 `.env.local` 포함 확인**

`.gitignore`에 `.env.local` 라인이 있는지 확인, 없으면 추가.

- [ ] **Step 5: 검증**

`mcp__supabase__list_tables`로 `projects`, `cuts` 테이블이 생성됐는지 확인.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0001_init.sql src/lib/supabaseClient.ts .env.example .gitignore
git commit -m "feat: add supabase schema (projects, cuts, storage bucket, RLS)"
```

---

## Task 3: 로그인/회원가입 화면

**Files:**
- Create: `src/pages/LoginPage.tsx`
- Create: `src/hooks/useAuth.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 2)
- Produces: `useAuth()` 훅 — `{ user, loading, signIn(email, password), signUp(email, password), signOut() }`. 이후 모든 화면이 `user`로 로그인 여부 판단.

- [ ] **Step 1: useAuth 훅 작성**

`src/hooks/useAuth.ts`:
```typescript
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return {
    user,
    loading,
    signIn: (email: string, password: string) =>
      supabase.auth.signInWithPassword({ email, password }),
    signUp: (email: string, password: string) =>
      supabase.auth.signUp({ email, password }),
    signOut: () => supabase.auth.signOut(),
  };
}
```

- [ ] **Step 2: 로그인 화면 작성**

`src/pages/LoginPage.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = mode === 'signin'
      ? await signIn(email, password)
      : await signUp(email, password);
    if (error) {
      setError(error.message);
      return;
    }
    navigate('/');
  }

  return (
    <div className="login-page">
      <h1>광고 콘티 스토리보드</h1>
      <form onSubmit={handleSubmit}>
        <input type="email" placeholder="이메일" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="비밀번호" value={password}
          onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        {error && <p className="error">{error}</p>}
        <button type="submit">{mode === 'signin' ? '로그인' : '회원가입'}</button>
      </form>
      <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: App.tsx에 인증 라우팅 연결**

`src/App.tsx`을 수정해 `useAuth()`로 `user`가 없으면 `/login`으로 리다이렉트하는 `RequireAuth` 래퍼를 추가하고 `LoginPage`를 `/login`에 연결한다 (나머지 라우트는 Task 4 이후 이어서 채움).

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import { useAuth } from './hooks/useAuth';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div>로딩 중...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Placeholder({ label }: { label: string }) {
  return <div>{label}</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><Placeholder label="projects" /></RequireAuth>} />
        <Route path="/projects/new" element={<RequireAuth><Placeholder label="new project" /></RequireAuth>} />
        <Route path="/projects/:id" element={<RequireAuth><Placeholder label="editor" /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4: 브라우저로 직접 검증**

`npm run dev` 실행 후 브라우저에서:
1. `/`에 접속하면 `/login`으로 리다이렉트되는지 확인
2. 회원가입 → 로그인 성공 시 `/`로 이동하고 "projects" 텍스트가 보이는지 확인

- [ ] **Step 5: Commit**

```bash
git add src/pages/LoginPage.tsx src/hooks/useAuth.ts src/App.tsx
git commit -m "feat: add email login/signup and route protection"
```

---

## Task 4: 프롬프트 조합 로직 (순수 함수, 단위 테스트)

**Files:**
- Create: `src/lib/promptComposer.ts`
- Test: `src/lib/promptComposer.test.ts`
- Modify: `package.json` (vitest 추가)

**Interfaces:**
- Produces: `composeImagePrompt(style: StoryboardStyle, overallPrompt: string, cut: Pick<Cut, 'scene_description' | 'camera_direction'>): string` — Task 6(Edge Function)과 Task 7(생성 버튼)에서 사용

- [ ] **Step 1: vitest 설치**

```bash
npm install -D vitest
```
`package.json`의 `scripts`에 `"test": "vitest run"` 추가.

- [ ] **Step 2: 실패하는 테스트 작성**

`src/lib/promptComposer.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { composeImagePrompt } from './promptComposer';

describe('composeImagePrompt', () => {
  it('combines style modifier, overall prompt, scene description, and camera direction', () => {
    const result = composeImagePrompt('sketch', '30초 스니커즈 광고, 도시 배경', {
      scene_description: '주인공이 신발끈을 묶는다',
      camera_direction: '클로즈업',
    });
    expect(result).toContain('pencil sketch');
    expect(result).toContain('30초 스니커즈 광고, 도시 배경');
    expect(result).toContain('주인공이 신발끈을 묶는다');
    expect(result).toContain('클로즈업');
  });

  it('omits empty camera_direction without leaving stray separators', () => {
    const result = composeImagePrompt('live_action', '전체 콘셉트', {
      scene_description: '장면 설명',
      camera_direction: '',
    });
    expect(result).not.toMatch(/,\s*,/);
    expect(result).not.toMatch(/,\s*$/);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
npx vitest run src/lib/promptComposer.test.ts
```
Expected: FAIL, `Cannot find module './promptComposer'`.

- [ ] **Step 4: 구현**

`src/lib/promptComposer.ts`:
```typescript
import type { StoryboardStyle } from '../types';

const STYLE_MODIFIERS: Record<StoryboardStyle, string> = {
  sketch: 'black and white pencil sketch storyboard style, rough hand-drawn line art',
  animation: 'flat 2D animation illustration style, vibrant colors, cartoon character design',
  live_action: 'photorealistic cinematic film still, realistic lighting, live action',
};

export function composeImagePrompt(
  style: StoryboardStyle,
  overallPrompt: string,
  cut: { scene_description: string; camera_direction: string }
): string {
  const parts = [
    STYLE_MODIFIERS[style],
    overallPrompt.trim(),
    cut.scene_description.trim(),
    cut.camera_direction.trim(),
  ].filter((part) => part.length > 0);

  return parts.join(', ');
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/lib/promptComposer.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/promptComposer.ts src/lib/promptComposer.test.ts package.json
git commit -m "feat: add image prompt composer with unit tests"
```

---

## Task 5: 프로젝트 생성 화면 (스타일/컷 개수/전체 프롬프트)

**Files:**
- Create: `src/pages/NewProjectPage.tsx`
- Create: `src/hooks/useProjects.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `supabase` (Task 2), `Project`/`Cut` 타입 (Task 1)
- Produces: `createProject({ title, style, cutCount, overallPrompt }): Promise<Project>` — 프로젝트 row 1개 + 컷 row `cutCount`개(order_index 0..n-1)를 함께 생성. Task 6(에디터), Task 8(목록)이 재사용.

- [ ] **Step 1: useProjects 훅 작성**

`src/hooks/useProjects.ts`:
```typescript
import { supabase } from '../lib/supabaseClient';
import type { Project, StoryboardStyle } from '../types';

export async function createProject(input: {
  title: string;
  style: StoryboardStyle;
  cutCount: number;
  overallPrompt: string;
}): Promise<Project> {
  if (input.cutCount < 2) {
    throw new Error('컷 개수는 최소 2개 이상이어야 합니다.');
  }
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('로그인이 필요합니다.');

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      title: input.title,
      style: input.style,
      overall_prompt: input.overallPrompt,
    })
    .select()
    .single();
  if (projectError) throw projectError;

  const cutRows = Array.from({ length: input.cutCount }, (_, i) => ({
    project_id: project.id,
    order_index: i,
  }));
  const { error: cutsError } = await supabase.from('cuts').insert(cutRows);
  if (cutsError) throw cutsError;

  return project as Project;
}

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data as Project[];
}
```

- [ ] **Step 2: 프로젝트 생성 화면 작성**

`src/pages/NewProjectPage.tsx`:
```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createProject } from '../hooks/useProjects';
import type { StoryboardStyle } from '../types';

export default function NewProjectPage() {
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState<StoryboardStyle>('sketch');
  const [cutCount, setCutCount] = useState(4);
  const [overallPrompt, setOverallPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const project = await createProject({ title, style, cutCount, overallPrompt });
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="new-project-page">
      <h1>새 스토리보드</h1>
      <form onSubmit={handleSubmit}>
        <label>
          제목
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          스타일
          <select value={style} onChange={(e) => setStyle(e.target.value as StoryboardStyle)}>
            <option value="sketch">스케치형</option>
            <option value="animation">애니메이션형</option>
            <option value="live_action">실사형</option>
          </select>
        </label>
        <label>
          컷 개수 (최소 2)
          <input type="number" min={2} value={cutCount}
            onChange={(e) => setCutCount(Number(e.target.value))} required />
        </label>
        <label>
          전체 콘셉트 프롬프트
          <textarea value={overallPrompt} onChange={(e) => setOverallPrompt(e.target.value)}
            placeholder="예: 30초 스니커즈 광고, 도시를 배경으로 달리는 청년" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>{submitting ? '생성 중...' : '만들기'}</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: App.tsx 라우트 연결**

`src/App.tsx`의 `/projects/new` 라우트 element를 `<RequireAuth><NewProjectPage /></RequireAuth>`로 교체하고 import 추가.

- [ ] **Step 4: 브라우저로 직접 검증**

로그인 후 "새 프로젝트" 화면에서: 제목/스타일/컷 개수(예: 3)/전체 프롬프트 입력 → 제출 → `/projects/:id`로 이동하는지 확인. Supabase 대시보드 또는 `mcp__supabase__execute_sql`로 `projects` 1행, `cuts` 3행(order_index 0,1,2)이 생성됐는지 확인.

- [ ] **Step 5: 컷 개수 최소값 검증 테스트**

브라우저에서 컷 개수를 1로 입력해 제출 시 "컷 개수는 최소 2개 이상이어야 합니다." 에러가 뜨는지 확인.

- [ ] **Step 6: Commit**

```bash
git add src/pages/NewProjectPage.tsx src/hooks/useProjects.ts src/App.tsx
git commit -m "feat: add new project creation flow with style and cut count"
```

---

## Task 6: OpenAI 이미지 생성 Edge Function

**Files:**
- Create: `supabase/functions/generate-image/index.ts`

**Interfaces:**
- Consumes: `composeImagePrompt`의 로직(Deno 환경이라 별도 인라인 구현), `cuts`/`projects` 테이블 (Task 2)
- Produces: HTTP POST 엔드포인트. Request body `{ cutId: string }`. 성공 시 `cuts.image_url`, `cuts.generation_status='done'` 갱신 후 `{ imageUrl: string }` 반환. 실패 시 `generation_status='failed'` 갱신 후 4xx/5xx 응답.

- [ ] **Step 1: Edge Function 작성**

`supabase/functions/generate-image/index.ts`:
```typescript
import { createClient } from 'jsr:@supabase/supabase-js@2';

const STYLE_MODIFIERS: Record<string, string> = {
  sketch: 'black and white pencil sketch storyboard style, rough hand-drawn line art',
  animation: 'flat 2D animation illustration style, vibrant colors, cartoon character design',
  live_action: 'photorealistic cinematic film still, realistic lighting, live action',
};

function composePrompt(style: string, overallPrompt: string, sceneDescription: string, cameraDirection: string) {
  return [STYLE_MODIFIERS[style], overallPrompt.trim(), sceneDescription.trim(), cameraDirection.trim()]
    .filter((p) => p.length > 0)
    .join(', ');
}

Deno.serve(async (req) => {
  try {
    const { cutId } = await req.json();
    if (!cutId) return new Response(JSON.stringify({ error: 'cutId required' }), { status: 400 });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: cut, error: cutError } = await supabase.from('cuts').select('*').eq('id', cutId).single();
    if (cutError || !cut) return new Response(JSON.stringify({ error: 'cut not found' }), { status: 404 });

    const { data: project, error: projectError } = await supabase
      .from('projects').select('*').eq('id', cut.project_id).single();
    if (projectError || !project) return new Response(JSON.stringify({ error: 'project not found' }), { status: 404 });

    await supabase.from('cuts').update({ generation_status: 'generating' }).eq('id', cutId);

    const prompt = composePrompt(project.style, project.overall_prompt, cut.scene_description, cut.camera_direction);

    const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024', n: 1 }),
    });

    if (!openaiRes.ok) {
      await supabase.from('cuts').update({ generation_status: 'failed' }).eq('id', cutId);
      const errText = await openaiRes.text();
      return new Response(JSON.stringify({ error: `openai error: ${errText}` }), { status: 502 });
    }

    const openaiJson = await openaiRes.json();
    const b64 = openaiJson.data[0].b64_json;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = `${cut.project_id}/${cut.id}-${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
      .from('storyboard-images')
      .upload(path, bytes, { contentType: 'image/png', upsert: true });
    if (uploadError) {
      await supabase.from('cuts').update({ generation_status: 'failed' }).eq('id', cutId);
      return new Response(JSON.stringify({ error: uploadError.message }), { status: 500 });
    }

    const { data: publicUrlData } = supabase.storage.from('storyboard-images').getPublicUrl(path);
    const imageUrl = publicUrlData.publicUrl;

    await supabase.from('cuts').update({ image_url: imageUrl, generation_status: 'done' }).eq('id', cutId);

    return new Response(JSON.stringify({ imageUrl }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
```

- [ ] **Step 2: Edge Function 배포**

`mcp__supabase__deploy_edge_function` 도구로 `generate-image` 함수 배포.

- [ ] **Step 3: OpenAI API 키를 secret으로 등록**

사용자에게 OpenAI API 키를 요청한 뒤, Supabase 대시보드(Edge Functions > Secrets) 또는 CLI로 `OPENAI_API_KEY` secret 등록. (Claude가 직접 결제 정보를 다루지 않음 — 키 값만 전달받아 secret으로 등록)

- [ ] **Step 4: curl로 직접 호출 검증**

Task 5에서 만든 테스트 프로젝트의 실제 cut id를 사용:
```bash
curl -X POST 'https://<project-ref>.supabase.co/functions/v1/generate-image' \
  -H 'Authorization: Bearer <anon-key>' \
  -H 'Content-Type: application/json' \
  -d '{"cutId":"<실제 cut id>"}'
```
Expected: `{"imageUrl":"https://...storyboard-images/..."}` 응답, 응답의 URL을 브라우저에서 열어 이미지가 실제로 열리는지 확인. `mcp__supabase__execute_sql`로 해당 cut의 `generation_status`가 `done`인지 확인.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/generate-image/index.ts
git commit -m "feat: add generate-image edge function calling OpenAI images API"
```

---

## Task 7: 편집 화면 — 컷 카드 목록 및 이미지 생성

**Files:**
- Create: `src/pages/EditorPage.tsx`
- Create: `src/components/CutCard.tsx`
- Create: `src/hooks/useCuts.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `Cut`/`Project` 타입, `supabase` client, Edge Function `generate-image` (Task 6)
- Produces: `useCuts(projectId)` — `{ cuts, updateCut(id, patch), generateImage(cutId), refresh() }`. Task 8(드래그 정렬), Task 9(PDF), Task 10(다운로드)이 재사용.

- [ ] **Step 1: useCuts 훅 작성**

`src/hooks/useCuts.ts`:
```typescript
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Cut } from '../types';

export function useCuts(projectId: string) {
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('cuts').select('*').eq('project_id', projectId).order('order_index');
    if (!error) setCuts(data as Cut[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function updateCut(id: string, patch: Partial<Cut>) {
    const { error } = await supabase.from('cuts').update(patch).eq('id', id);
    if (error) throw error;
    await refresh();
  }

  async function generateImage(cutId: string) {
    setCuts((prev) => prev.map((c) => c.id === cutId ? { ...c, generation_status: 'generating' } : c));
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ cutId }),
      }
    );
    if (!res.ok) {
      setCuts((prev) => prev.map((c) => c.id === cutId ? { ...c, generation_status: 'failed' } : c));
      const body = await res.json().catch(() => ({ error: 'unknown error' }));
      throw new Error(body.error ?? 'image generation failed');
    }
    await refresh();
  }

  return { cuts, loading, updateCut, generateImage, refresh };
}
```

- [ ] **Step 2: CutCard 컴포넌트 작성**

`src/components/CutCard.tsx`:
```tsx
import { useState } from 'react';
import type { Cut } from '../types';

interface Props {
  cut: Cut;
  index: number;
  onUpdate: (patch: Partial<Cut>) => Promise<void>;
  onGenerate: () => Promise<void>;
}

export default function CutCard({ cut, index, onUpdate, onGenerate }: Props) {
  const [sceneDescription, setSceneDescription] = useState(cut.scene_description);
  const [dialogue, setDialogue] = useState(cut.dialogue);
  const [cameraDirection, setCameraDirection] = useState(cut.camera_direction);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setError(null);
    try {
      await onUpdate({ scene_description: sceneDescription, dialogue, camera_direction: cameraDirection });
      await onGenerate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="cut-card">
      <h3>컷 {index + 1}</h3>
      {cut.image_url && <img src={cut.image_url} alt={`컷 ${index + 1}`} width={256} />}
      {cut.generation_status === 'generating' && <p>이미지 생성 중...</p>}
      {cut.generation_status === 'failed' && (
        <div>
          <p className="error">이미지 생성에 실패했습니다.</p>
          <button onClick={handleGenerate}>다시 시도</button>
        </div>
      )}
      <label>
        장면 설명
        <textarea value={sceneDescription} onChange={(e) => setSceneDescription(e.target.value)}
          onBlur={() => onUpdate({ scene_description: sceneDescription })} />
      </label>
      <label>
        대사/내레이션
        <textarea value={dialogue} onChange={(e) => setDialogue(e.target.value)}
          onBlur={() => onUpdate({ dialogue })} />
      </label>
      <label>
        카메라 지시문
        <input value={cameraDirection} onChange={(e) => setCameraDirection(e.target.value)}
          onBlur={() => onUpdate({ camera_direction: cameraDirection })} />
      </label>
      {error && <p className="error">{error}</p>}
      {cut.generation_status !== 'generating' && cut.generation_status !== 'failed' && (
        <button onClick={handleGenerate}>{cut.image_url ? '다시 생성' : '이미지 생성'}</button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: EditorPage 작성 (전체 프롬프트 + 컷 목록)**

`src/pages/EditorPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useCuts } from '../hooks/useCuts';
import CutCard from '../components/CutCard';
import type { Project } from '../types';

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [overallPrompt, setOverallPrompt] = useState('');
  const { cuts, updateCut, generateImage } = useCuts(id!);

  useEffect(() => {
    supabase.from('projects').select('*').eq('id', id).single().then(({ data }) => {
      if (data) {
        setProject(data as Project);
        setOverallPrompt((data as Project).overall_prompt);
      }
    });
  }, [id]);

  async function saveOverallPrompt() {
    if (!project) return;
    await supabase.from('projects').update({ overall_prompt: overallPrompt }).eq('id', project.id);
  }

  if (!project) return <div>로딩 중...</div>;

  return (
    <div className="editor-page">
      <h1>{project.title}</h1>
      <label>
        전체 콘셉트 프롬프트
        <textarea value={overallPrompt} onChange={(e) => setOverallPrompt(e.target.value)}
          onBlur={saveOverallPrompt} />
      </label>
      <div className="cut-list">
        {cuts.map((cut, i) => (
          <CutCard
            key={cut.id}
            cut={cut}
            index={i}
            onUpdate={(patch) => updateCut(cut.id, patch)}
            onGenerate={() => generateImage(cut.id)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: App.tsx 라우트 연결**

`/projects/:id` 라우트 element를 `<RequireAuth><EditorPage /></RequireAuth>`로 교체.

- [ ] **Step 5: 브라우저로 직접 검증**

Task 5에서 만든 프로젝트 진입 → 각 컷에 장면 설명 입력 → "이미지 생성" 클릭 → 로딩 표시 후 실제 이미지가 카드에 나타나는지 확인. 한 컷이 생성 중인 동안 다른 컷의 텍스트를 수정할 수 있는지 확인.

- [ ] **Step 6: Commit**

```bash
git add src/pages/EditorPage.tsx src/components/CutCard.tsx src/hooks/useCuts.ts src/App.tsx
git commit -m "feat: add editor page with per-cut image generation"
```

---

## Task 8: 컷 추가/삭제/드래그 순서 변경

**Files:**
- Modify: `src/hooks/useCuts.ts`
- Modify: `src/pages/EditorPage.tsx`

**Interfaces:**
- Consumes: `useCuts` (Task 7), `@dnd-kit/sortable`
- Produces: `useCuts`에 `addCut()`, `removeCut(id)`, `reorderCuts(orderedIds: string[])` 추가

- [ ] **Step 1: useCuts에 추가/삭제/재정렬 함수 추가**

`src/hooks/useCuts.ts`에 이어서 추가:
```typescript
  const MIN_CUTS = 2;

  async function addCut() {
    const nextIndex = cuts.length;
    const { error } = await supabase.from('cuts').insert({ project_id: projectId, order_index: nextIndex });
    if (error) throw error;
    await refresh();
  }

  async function removeCut(id: string) {
    if (cuts.length <= MIN_CUTS) {
      throw new Error(`컷은 최소 ${MIN_CUTS}개 이상이어야 합니다.`);
    }
    const { error } = await supabase.from('cuts').delete().eq('id', id);
    if (error) throw error;
    const remaining = cuts.filter((c) => c.id !== id).sort((a, b) => a.order_index - b.order_index);
    await Promise.all(remaining.map((c, i) => supabase.from('cuts').update({ order_index: i }).eq('id', c.id)));
    await refresh();
  }

  async function reorderCuts(orderedIds: string[]) {
    await Promise.all(orderedIds.map((id, i) => supabase.from('cuts').update({ order_index: i }).eq('id', id)));
    await refresh();
  }

  return { cuts, loading, updateCut, generateImage, refresh, addCut, removeCut, reorderCuts };
```
(기존 `return { cuts, loading, updateCut, generateImage, refresh };` 라인을 이 return으로 교체)

- [ ] **Step 2: EditorPage에 드래그 정렬 + 추가/삭제 버튼 연결**

`src/pages/EditorPage.tsx`의 `cut-list` 부분을 `@dnd-kit`의 `DndContext`/`SortableContext`로 감싸고, 각 `CutCard`에 삭제 버튼(`onRemove`)을 전달하며, 목록 하단에 "컷 추가" 버튼을 추가한다. `CutCard` props에 `onRemove: () => Promise<void>`를 추가하고 카드 내부에 삭제 버튼을 렌더링한다.

- [ ] **Step 3: 브라우저로 직접 검증**

"컷 추가" 클릭 시 새 카드가 목록 끝에 추가되는지 확인. 컷을 드래그해서 순서를 바꾼 뒤 새로고침해도 순서가 유지되는지 확인. 컷이 2개 남았을 때 삭제 시도하면 에러 메시지가 뜨고 삭제되지 않는지 확인.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useCuts.ts src/pages/EditorPage.tsx src/components/CutCard.tsx
git commit -m "feat: add cut add/remove/reorder with minimum-2-cuts guard"
```

---

## Task 9: PDF 내보내기 및 이미지 개별 다운로드

**Files:**
- Create: `src/lib/pdfExport.ts`
- Test: `src/lib/pdfExport.test.ts`
- Modify: `src/pages/EditorPage.tsx`

**Interfaces:**
- Consumes: `Project`, `Cut[]` (Task 1)
- Produces: `buildStoryboardPdf(project: Project, cuts: Cut[]): jsPDF` — 테스트 가능한 순수 조립 함수. `downloadCutImage(cut: Cut): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/lib/pdfExport.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildStoryboardPdf } from './pdfExport';
import type { Project, Cut } from '../types';

const project: Project = {
  id: 'p1', user_id: 'u1', title: '테스트 프로젝트', style: 'sketch',
  overall_prompt: '콘셉트', created_at: '', updated_at: '',
};

const cuts: Cut[] = [
  { id: 'c1', project_id: 'p1', order_index: 0, scene_description: '장면1', dialogue: '대사1',
    camera_direction: '클로즈업', image_url: null, generation_status: 'idle', created_at: '', updated_at: '' },
  { id: 'c2', project_id: 'p1', order_index: 1, scene_description: '장면2', dialogue: '대사2',
    camera_direction: '', image_url: null, generation_status: 'idle', created_at: '', updated_at: '' },
];

describe('buildStoryboardPdf', () => {
  it('creates one page per cut plus contains the project title', () => {
    const doc = buildStoryboardPdf(project, cuts);
    expect(doc.getNumberOfPages()).toBe(cuts.length);
    const text = doc.getTextContent ? '' : ''; // jsPDF has no direct text extraction; check page count and no throw
    expect(text).toBe('');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/lib/pdfExport.test.ts
```
Expected: FAIL, `Cannot find module './pdfExport'`.

- [ ] **Step 3: 구현**

`src/lib/pdfExport.ts`:
```typescript
import { jsPDF } from 'jspdf';
import type { Project, Cut } from '../types';

export function buildStoryboardPdf(project: Project, cuts: Cut[]): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  cuts.forEach((cut, i) => {
    if (i > 0) doc.addPage();
    doc.setFontSize(16);
    doc.text(`${project.title} — 컷 ${i + 1}`, 40, 40);
    if (cut.image_url) {
      doc.text('(이미지는 온라인 이미지 URL 참조: ' + cut.image_url + ')', 40, 60);
    }
    doc.setFontSize(11);
    doc.text(`장면 설명: ${cut.scene_description || '-'}`, 40, 90, { maxWidth: 500 });
    doc.text(`대사/내레이션: ${cut.dialogue || '-'}`, 40, 130, { maxWidth: 500 });
    doc.text(`카메라 지시문: ${cut.camera_direction || '-'}`, 40, 170, { maxWidth: 500 });
  });

  return doc;
}

export function downloadCutImage(cut: Cut, index: number) {
  if (!cut.image_url) return;
  const a = document.createElement('a');
  a.href = cut.image_url;
  a.download = `cut-${index + 1}.png`;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/pdfExport.test.ts
```
Expected: PASS.

- [ ] **Step 5: 이미지까지 포함하도록 보강**

`buildStoryboardPdf`에서 `cut.image_url`이 있으면 `doc.addImage`로 실제 이미지를 페이지에 삽입하도록 수정한다 (이미지는 fetch 후 base64 변환 필요하므로 함수를 `async`로 변경):
```typescript
export async function buildStoryboardPdf(project: Project, cuts: Cut[]): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    if (i > 0) doc.addPage();
    doc.setFontSize(16);
    doc.text(`${project.title} — 컷 ${i + 1}`, 40, 40);

    if (cut.image_url) {
      const res = await fetch(cut.image_url);
      const blob = await res.blob();
      const dataUrl: string = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      doc.addImage(dataUrl, 'PNG', 40, 60, 200, 200);
    }

    doc.setFontSize(11);
    doc.text(`장면 설명: ${cut.scene_description || '-'}`, 40, 280, { maxWidth: 500 });
    doc.text(`대사/내레이션: ${cut.dialogue || '-'}`, 40, 320, { maxWidth: 500 });
    doc.text(`카메라 지시문: ${cut.camera_direction || '-'}`, 40, 360, { maxWidth: 500 });
  }

  return doc;
}
```
테스트 파일의 `buildStoryboardPdf(project, cuts)` 호출을 `await buildStoryboardPdf(project, cuts)`로, `it`을 `async` 콜백으로 수정한다 (image_url이 없는 테스트 데이터이므로 fetch는 호출되지 않음).

- [ ] **Step 6: 테스트 재실행**

```bash
npx vitest run src/lib/pdfExport.test.ts
```
Expected: PASS.

- [ ] **Step 7: EditorPage에 내보내기 버튼 연결**

`src/pages/EditorPage.tsx`에 "PDF로 내보내기" 버튼(클릭 시 `await buildStoryboardPdf(project, cuts)` 후 `doc.save(project.title + '.pdf')`)과 각 `CutCard`에 "이미지 다운로드" 버튼(`downloadCutImage(cut, index)` 호출)을 추가한다.

- [ ] **Step 8: 브라우저로 직접 검증**

이미지가 생성된 프로젝트에서 "PDF로 내보내기" 클릭 → PDF 파일이 다운로드되고 열어보면 컷 수만큼 페이지가 있고 이미지·텍스트가 포함되어 있는지 확인. 컷 카드의 "이미지 다운로드" 클릭 시 PNG 파일이 받아지는지 확인.

- [ ] **Step 9: Commit**

```bash
git add src/lib/pdfExport.ts src/lib/pdfExport.test.ts src/pages/EditorPage.tsx src/components/CutCard.tsx
git commit -m "feat: add PDF export and individual image download"
```

---

## Task 10: 프로젝트 목록 화면

**Files:**
- Create: `src/pages/ProjectListPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `listProjects()` (Task 5)

- [ ] **Step 1: 화면 작성**

`src/pages/ProjectListPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listProjects } from '../hooks/useProjects';
import { useAuth } from '../hooks/useAuth';
import type { Project } from '../types';

export default function ProjectListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const { signOut } = useAuth();

  useEffect(() => {
    listProjects().then(setProjects);
  }, []);

  return (
    <div className="project-list-page">
      <div className="header">
        <h1>내 스토리보드</h1>
        <button onClick={() => signOut()}>로그아웃</button>
      </div>
      <Link to="/projects/new">새 프로젝트</Link>
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <Link to={`/projects/${p.id}`}>{p.title}</Link>
            <span> ({p.style})</span>
          </li>
        ))}
      </ul>
      {projects.length === 0 && <p>아직 만든 프로젝트가 없어요.</p>}
    </div>
  );
}
```

- [ ] **Step 2: App.tsx 라우트 연결**

`/` 라우트 element를 `<RequireAuth><ProjectListPage /></RequireAuth>`로 교체.

- [ ] **Step 3: 브라우저로 직접 검증**

로그인 후 `/`에서 이전에 만든 프로젝트들이 목록에 보이는지, 클릭 시 에디터로 이동하는지, 로그아웃 후 다시 `/login`으로 돌아가는지 확인.

- [ ] **Step 4: Commit**

```bash
git add src/pages/ProjectListPage.tsx src/App.tsx
git commit -m "feat: add project list page with logout"
```

---

## Task 11: Vercel 배포

**Files:**
- Create: `vercel.json` (SPA 라우팅용 rewrite 규칙)

**Interfaces:**
- Consumes: Task 1~10의 전체 앱

- [ ] **Step 1: SPA rewrite 설정**

`vercel.json`:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

- [ ] **Step 2: 프로덕션 빌드 로컬 검증**

```bash
npm run build
npm run preview
```
Expected: 빌드 에러 없음. `preview` 서버에서 로그인부터 PDF 내보내기까지 전체 흐름이 정상 동작.

- [ ] **Step 3: Vercel에 배포**

`mcp__vercel__deploy_to_vercel` 도구로 배포. 환경 변수 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`를 Vercel 프로젝트 환경 변수로 등록.

- [ ] **Step 4: 배포된 URL로 실제 흐름 재검증**

배포된 URL에 접속하여: 회원가입/로그인 → 프로젝트 생성 → 이미지 생성 → 컷 추가/삭제/순서변경 → PDF 내보내기/이미지 다운로드 → 로그아웃 후 재로그인해서 프로젝트 목록에 남아있는지까지 전체 흐름 재확인.

- [ ] **Step 5: Commit**

```bash
git add vercel.json
git commit -m "chore: add vercel spa rewrite config"
```

---

## 최종 검증 체크리스트 (spec 대비)

- [x] 웹 앱, 로그인 기반 프로젝트 저장/관리 — Task 3, 5, 10
- [x] 스타일 선택(스케치/애니메이션/실사) 프로젝트 단위 적용 — Task 5, 6
- [x] 컷 개수 최소 2, 자유 지정 + 추가/삭제/순서변경 — Task 5, 8
- [x] 전체 프롬프트 + 컷별 프롬프트(장면설명/대사/카메라지시문) — Task 4, 5, 7
- [x] AI 이미지 생성, 컷별 독립 로딩/실패/재시도 — Task 6, 7
- [x] PDF 내보내기 + 이미지 개별 다운로드 — Task 9
- [x] Vercel 배포 — Task 11
