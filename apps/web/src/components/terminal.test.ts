import { describe, expect, it } from 'vitest';
import { commandLine } from './TerminalPane';

describe('terminal command lines', () => {
  it('shows shell commands as typed and Luma tools as readable lines', () => {
    expect(commandLine({ name: 'bash', args: { command: 'npm run check' } })).toBe('$ npm run check');
    expect(commandLine({ name: 'bash', args: { command: 'a\nb' } })).toBe('$ a\n  b');
    expect(commandLine({ name: 'generate_voice', args: { placeholder: true } })).toBe('› generate voice (placeholder, silent)');
    expect(commandLine({ name: 'preview_frames', args: { times: [1, 2.5] } })).toBe('› render preview frames at 1.00s, 2.50s');
    expect(commandLine({ name: 'render_video', args: { preset: 'draft' } })).toBe('› render draft MP4');
  });
});
