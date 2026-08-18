import { supabase } from '../lib/supabaseClient';
import type {
  AspectRatio, CreativeBrief, CreativeDna, CreativeRisk, CreativeTreatment, DirectingOption, Project,
  SceneCountMode, StoryboardStyle,
} from '../types';

/**
 * Calls the AI Director edge function: given a title/style and a creative brief,
 * the AI plans the full shot list (count, camera language, copy) and creates the
 * project + cuts server-side. Returns the new project's id.
 */
export async function directStoryboard(input: {
  title: string;
  style: StoryboardStyle;
  aspectRatio?: AspectRatio;
  brief: CreativeBrief;
  freeformIdea: string;
  creativeDirection?: CreativeTreatment;
  copyText?: string;
  sceneCountMode?: SceneCountMode;
  requestedSceneCount?: number;
  targetDurationSeconds?: number;
  /** The Director's Room option the user picked, if they went through it. */
  directingDirection?: DirectingOption;
  creativeRisk?: CreativeRisk;
  /** A reference Creative DNA analysis, if the user came through the Reference tab — used as
   * creative guidance for the shot list (never a hard rule; see ai-director's priority order). */
  creativeDna?: CreativeDna;
}): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('로그인이 필요합니다.');

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-director`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: input.title,
      style: input.style,
      aspectRatio: input.aspectRatio,
      brief: input.brief,
      freeformIdea: input.freeformIdea,
      creativeDirection: input.creativeDirection,
      copyText: input.copyText,
      sceneCountMode: input.sceneCountMode,
      requestedSceneCount: input.requestedSceneCount,
      targetDurationSeconds: input.targetDurationSeconds,
      directingDirection: input.directingDirection,
      creativeRisk: input.creativeRisk,
      creativeDna: input.creativeDna,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'AI Director 연출에 실패했습니다.' }));
    throw new Error(body.error ?? 'AI Director 연출에 실패했습니다.');
  }

  const body = await res.json();
  return body.projectId as string;
}

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data as Project[];
}
