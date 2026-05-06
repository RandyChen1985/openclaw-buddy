import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { vscodeDark, vscodeLight } from '@uiw/codemirror-theme-vscode';
import { codeMirrorLanguageExtensions } from '../utils/codeMirrorLanguageExtensions';

export interface CodeMirrorTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  filename: string;
  isDarkMode?: boolean;
}

export const CodeMirrorTextEditor: React.FC<CodeMirrorTextEditorProps> = ({
  value,
  onChange,
  filename,
  isDarkMode = false,
}) => {
  const extensions = useMemo(
    () => [...codeMirrorLanguageExtensions(filename), EditorView.lineWrapping],
    [filename]
  );

  return (
    <CodeMirror
      key={filename}
      value={value}
      height="100%"
      theme={isDarkMode ? vscodeDark : vscodeLight}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        dropCursor: true,
        allowMultipleSelections: true,
        indentOnInput: true,
        bracketMatching: true,
        closeBrackets: true,
        highlightSelectionMatches: true,
      }}
      style={{ fontSize: 13, height: '100%' }}
    />
  );
};
