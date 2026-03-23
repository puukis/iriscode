import type { Message } from '../shared/types.ts';

export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
  author?: string;
  allowed_tools?: string;
  model?: string;
  disable_model_invocation?: boolean;
  tags?: string[];
}

export interface Skill {
  frontmatter: SkillFrontmatter;
  instructions: string;
  source: string;
  baseDir: string;
}

export interface SkillLoadResult {
  skills: Skill[];
  availableSkills: Skill[];
  errors: Array<{ path: string; error: string }>;
  characterBudgetUsed: number;
}

export interface SkillContextModifier {
  preApprovedTools: string[];
  modelOverride: string | null;
}

export interface SkillInjection {
  visibleMessage: Message;
  hiddenMessage: Message;
  contextModifier: SkillContextModifier;
}
