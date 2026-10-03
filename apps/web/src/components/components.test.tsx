import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AskCard, AssistantText, Notice, ToolCard } from './Blocks';
import { PlanCard } from './Chat';
import { DiffView } from './DiffView';
import type { Block } from '../lib/reduce';

type Tool = Extract<Block, { kind: 'tool' }>;
const tool = (over: Partial<Tool>): Tool => ({ kind: 'tool', id: 1, callId: 'c', name: 'bash', args: {}, output: '', status: 'ok', files: [], startedAt: 0, ...over });

describe('DiffView', () => {
  it('colours additions, deletions, hunks and file headers', () => {
    const { container } = render(<DiffView diff={'diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new\n same'} />);
    expect(container.querySelector('.file')).toHaveTextContent('diff --git');
    expect(container.querySelector('.hunk')).toBeInTheDocument();
    expect(container.querySelector('.del')).toHaveTextContent('-old');
    expect(container.querySelector('.add')).toHaveTextContent('+new');
  });
  it('says so when there is nothing to show', () => {
    render(<DiffView diff="" empty="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });
});

describe('PlanCard', () => {
  it('shows progress and marks items', () => {
    render(<PlanCard items={[{ text: 'Write script', status: 'done' }, { text: 'Build scenes', status: 'doing' }, { text: 'Render', status: 'todo' }]} />);
    expect(screen.getByText('1/3 done')).toBeInTheDocument();
    expect(screen.getByText('Write script')).toHaveClass('line-through');
    expect(screen.getByText('Build scenes')).toHaveClass('font-medium');
  });
  it('collapses', async () => {
    render(<PlanCard items={[{ text: 'Only item', status: 'todo' }]} />);
    await userEvent.click(screen.getByRole('button', { name: /plan/i }));
    expect(screen.queryByText('Only item')).not.toBeInTheDocument();
  });
});

describe('AskCard', () => {
  const block = { kind: 'ask' as const, id: 1, question: 'Which colour?', options: ['Blue', 'White'] };
  it('answers with a quick reply', async () => {
    const onAnswer = vi.fn();
    render(<AskCard block={block} canAnswer onAnswer={onAnswer} />);
    await userEvent.click(screen.getByRole('button', { name: 'White' }));
    expect(onAnswer).toHaveBeenCalledWith('White');
  });
  it('answers with free text', async () => {
    const onAnswer = vi.fn();
    render(<AskCard block={block} canAnswer onAnswer={onAnswer} />);
    await userEvent.type(screen.getByLabelText('Your answer'), 'Sky blue{enter}');
    expect(onAnswer).toHaveBeenCalledWith('Sky blue');
  });
  it('is read-only once answered', () => {
    render(<AskCard block={block} canAnswer={false} onAnswer={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Blue' })).not.toBeInTheDocument();
    expect(screen.getByText('Answered.')).toBeInTheDocument();
  });
});

describe('ToolCard', () => {
  it('shows a running command with its output, stderr marked', () => {
    render(<ToolCard block={tool({ status: 'running', args: { command: 'npm run check' }, output: 'ok line\n\u0001oops\n\u0002' })} />);
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    const out = screen.getByLabelText('Command output');
    expect(within(out).getByText(/ok line/)).toBeInTheDocument();
    expect(within(out).getByText(/oops/)).toHaveClass('err');
  });
  it('strips colour codes from output', async () => {
    render(<ToolCard block={tool({ args: { command: 'ls' }, output: '\u001b[32mgreen\u001b[0m text', summary: 'exit 0' })} />);
    await userEvent.click(screen.getByRole('button', { name: /terminal/i })); // finished commands start collapsed
    expect(screen.getByLabelText('Command output')).toHaveTextContent('green text');
  });
  it('lists file changes with +/- counts', () => {
    render(<ToolCard block={tool({ name: 'edit_file', args: { path: 'a.js' }, files: [{ path: 'a.js', change: 'modified', additions: 3, deletions: 1, diff: '+x' }] })} />);
    expect(screen.getByTitle('View changes')).toHaveTextContent('+3');
    expect(screen.getByTitle('View changes')).toHaveTextContent('−1');
  });
  it('hides the ask_user tool call (the question card replaces it)', () => {
    const { container } = render(<ToolCard block={tool({ name: 'ask_user', args: { question: 'x' } })} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('shows a failed tool with its reason', () => {
    render(<ToolCard block={tool({ name: 'write_file', status: 'error', summary: 'Path escapes the project', args: { path: '../x' } })} />);
    expect(screen.getByText('Path escapes the project')).toBeInTheDocument();
  });
});

describe('AssistantText / Notice', () => {
  it('renders markdown', () => {
    render(<AssistantText text={'**bold** and `code`\n\n- one\n- two'} />);
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('code').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
  it('does not execute html in model output', () => {
    const { container } = render(<AssistantText text={'<img src=x onerror="alert(1)"><script>alert(2)</script>hi'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
  it('flags transient and fatal notices differently', () => {
    const { rerender } = render(<Notice block={{ kind: 'notice', id: 1, message: 'retrying', retryable: true }} />);
    expect(screen.getByRole('status')).toHaveClass('bg-[#fff7e6]');
    rerender(<Notice block={{ kind: 'notice', id: 2, message: 'bad key', retryable: false }} />);
    expect(screen.getByRole('status')).toHaveClass('bg-[#fdecec]');
  });
});
