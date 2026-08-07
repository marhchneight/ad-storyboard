import { supabase } from '../lib/supabaseClient';
import type { CreativeBrief, Project, StoryboardStyle } from '../types';

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
  if (cutsError) {
    await supabase.from('projects').delete().eq('id', project.id);
    throw cutsError;
  }

  return project as Project;
}

/**
 * Calls the AI Director edge function: given a title/style and a creative brief,
 * the AI plans the full shot list (count, camera language, copy) and creates the
 * project + cuts server-side. Returns the new project's id.
 */
export async function directStoryboard(input: {
  title: string;
  style: StoryboardStyle;
  brief: CreativeBrief;
  freeformIdea: string;
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
      brief: input.brief,
      freeformIdea: input.freeformIdea,
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
