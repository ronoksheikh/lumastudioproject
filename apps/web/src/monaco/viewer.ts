// Read-only code viewer on Monaco. Loaded lazily (it is large) with its worker bundled locally,
// so it works offline and without any CDN.
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

// A viewer needs syntax colours (main thread), not language services: one generic worker serves everything,
// and diagnostics are off so nothing asks the TS/JSON/CSS/HTML services for work.
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = { getWorker: () => new EditorWorker() };
for (const d of [monaco.typescript.javascriptDefaults, monaco.typescript.typescriptDefaults]) {
  d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true });
  d.setModeConfiguration({
    completionItems: false, hovers: false, documentSymbols: false, definitions: false, references: false, documentHighlights: false, rename: false,
    diagnostics: false, documentRangeFormattingEdits: false, signatureHelp: false, onTypeFormattingEdits: false, codeActions: false, inlayHints: false,
  });
}
monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: false });
monaco.json.jsonDefaults.setModeConfiguration({
  documentFormattingEdits: false, documentRangeFormattingEdits: false, completionItems: false, hovers: false, documentSymbols: false, tokens: true, colors: false, foldingRanges: true, diagnostics: false, selectionRanges: false,
});

monaco.editor.defineTheme('luma', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: { 'editor.background': '#fbfdff', 'editorLineNumber.foreground': '#9fb3d9', 'editor.lineHighlightBackground': '#eff5ff' },
});

const LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', json: 'json', css: 'css', html: 'html', md: 'markdown', sh: 'shell', svg: 'xml', xml: 'xml', txt: 'plaintext',
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
    inlayHints: { enabled: 'off' },
    hover: { enabled: 'off' },
    quickSuggestions: false,
    parameterHints: { enabled: false },
    lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off },
    links: false,
    colorDecorators: false,
    occurrencesHighlight: 'off',
    selectionHighlight: false,
    'semanticHighlighting.enabled': false,
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
