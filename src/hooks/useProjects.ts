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
