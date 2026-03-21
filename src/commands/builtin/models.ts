import type { BuiltinHandler, CommandEntry } from '../types.ts';

export const MODELS_COMMAND: CommandEntry = {
  name: 'models',
  description: 'Open the interactive model picker and switch models.',
  category: 'builtin',
};

export const handleModels: BuiltinHandler = async (ctx) => {
  try {
    const selectedModel = await ctx.session.openModelPicker();
    if (!selectedModel) {
      ctx.session.writeInfo('Model switch cancelled.');
      return { type: 'handled' };
    }

    await ctx.session.setModel(selectedModel);
    ctx.session.writeInfo(`Model switched to: ${selectedModel}`);
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};
