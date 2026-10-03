import { toolSchemas, type ToolArgs, type ToolName } from '@luma/shared';
import { bash } from './bash.js';
import { editFile, listFiles, readFile, writeFile } from './files.js';
import { previewFrames } from './frames.js';
import { askUser, renderVideo, updatePlan, webFetch } from './misc.js';
import { fail, type ToolContext, type ToolResult } from './types.js';
import { generateVoice, patchVoice } from './voice.js';

export * from './types.js';

type Handler<N extends ToolName> = (ctx: ToolContext, args: ToolArgs<N>) => ToolResult | Promise<ToolResult>;
const handlers: { [N in ToolName]: Handler<N> } = {
  bash,
  read_file: readFile,
  write_file: writeFile,
  edit_file: editFile,
  list_files: listFiles,
  update_plan: updatePlan,
  generate_voice: generateVoice,
  patch_voice: patchVoice,
  preview_frames: previewFrames,
  render_video: renderVideo,
  ask_user: askUser,
  web_fetch: webFetch,
};

export const isToolName = (n: string): n is ToolName => n in toolSchemas;

/**
 * Validates the model's raw JSON arguments against the tool's schema and runs the tool. Anything wrong
 * (unknown tool, malformed JSON, schema violation) comes back as an error result the model can learn from.
 */
export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<{ result: ToolResult; args: unknown }> {
  if (!isToolName(name)) return { result: fail(`Unknown tool "${name}". Available tools: ${Object.keys(toolSchemas).join(', ')}.`), args: rawArgs };
  let json: unknown;
  try {
    json = rawArgs.trim() ? JSON.parse(rawArgs) : {};
  } catch (e) {
    return { result: fail(`The arguments for ${name} are not valid JSON (${(e as Error).message}). If the content was long, split it into smaller write_file / edit_file calls.`), args: rawArgs };
  }
  const parsed = toolSchemas[name].safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ');
    return { result: fail(`Invalid arguments for ${name}: ${problems}`), args: json };
  }
  try {
    const result = await (handlers[name] as Handler<ToolName>)(ctx, parsed.data as never);
    return { result, args: parsed.data };
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { result: fail('Stopped.'), args: parsed.data };
    return { result: fail(`${name} crashed: ${(e as Error).message}`), args: parsed.data };
  }
}
