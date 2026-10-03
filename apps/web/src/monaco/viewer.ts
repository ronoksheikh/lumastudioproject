// Read-only code viewer on Monaco. Loaded lazily (it is large) with its worker bundled locally, so it works
// offline and without any CDN.
//
// Only Monaco's core editor + Monarch tokenizers (syntax colours on the main thread) are loaded — never the
// HTML/CSS/JSON/TypeScript *language services*. Those run in dedicated workers and, served by one generic
// worker, failed with "Missing requestHandler or method: getFoldingRanges" and could leave a file blank.
// A viewer needs colours, find, folding and copy — nothing that has to talk to a worker.
import * as monaco from 'monaco-editor/editor/editor.api';
// the package exports map only .js files; the icon font CSS is reached by path
import '../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu';
import 'monaco-editor/features/find/register';
import 'monaco-editor/editor/contrib/find/browser/findController';
import 'monaco-editor/editor/contrib/folding/browser/folding';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter';
import 'monaco-editor/languages/definitions/css/register';
import 'monaco-editor/languages/definitions/html/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/typescript/register';
import 'monaco-editor/languages/definitions/markdown/register';
import 'monaco-editor/languages/definitions/shell/register';
import 'monaco-editor/languages/definitions/xml/register';
import 'monaco-editor/languages/definitions/python/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = { getWorker: () => new EditorWorker() };

monaco.editor.defineTheme('luma', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#fbfdff', 'editorLineNumber.foreground': '#9fb3d9', 'editor.lineHighlightBackground': '#eff5ff' },
});

// JSON has no Monarch tokenizer of its own (only a worker-backed service): JavaScript's colours fit it well.
const LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', json: 'javascript', ts: 'typescript', css: 'css', html: 'html', htm: 'html',
  md: 'markdown', sh: 'shell', svg: 'xml', xml: 'xml', py: 'python', txt: 'plaintext',
};
export const languageOf = (path: string) => LANG[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext';

export function createViewer(container: HTMLElement) {
  const editor = monaco.editor.create(container, {
    value: '',
    readOnly: true,
    theme: 'luma',
    automaticLayout: true,
    minimap: { enabled: false },
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontSize: 13,
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    padding: { top: 8 },
    wordWrap: 'off',
    domReadOnly: true,
    quickSuggestions: false,
    links: false,
    occurrencesHighlight: 'off',
    selectionHighlight: false,
  });
  return {
    show(value: string, path: string) {
      const model = monaco.editor.createModel(value, languageOf(path));
      const old = editor.getModel();
      editor.setModel(model);
      old?.dispose();
    },
    dispose() {
      editor.getModel()?.dispose();
      editor.dispose();
    },
  };
}
