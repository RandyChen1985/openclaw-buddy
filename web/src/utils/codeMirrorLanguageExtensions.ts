import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { go } from '@codemirror/legacy-modes/mode/go';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';

function basename(filename: string): string {
  const parts = filename.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filename;
}

/** Syntax highlighting extensions for CodeMirror from file name (extension + special names). */
export function codeMirrorLanguageExtensions(filename: string): Extension[] {
  const name = basename(filename).toLowerCase();
  if (name === 'dockerfile' || name.endsWith('.dockerfile')) {
    return [StreamLanguage.define(dockerFile)];
  }

  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1) : '';

  switch (ext) {
    case 'js':
    case 'cjs':
    case 'mjs':
      return [javascript()];
    case 'jsx':
      return [javascript({ jsx: true })];
    case 'ts':
      return [javascript({ typescript: true })];
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })];
    case 'json':
      return [json()];
    case 'py':
      return [python()];
    case 'go':
      return [StreamLanguage.define(go)];
    case 'sh':
    case 'bash':
    case 'zsh':
      return [StreamLanguage.define(shell)];
    case 'yml':
    case 'yaml':
      return [yaml()];
    case 'css':
    case 'less':
    case 'scss':
    case 'sass':
      return [css()];
    case 'html':
    case 'htm':
      return [html()];
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'sql':
      return [sql()];
    case 'xml':
    case 'svg':
      return [xml()];
    case 'env':
    case 'ini':
    case 'properties':
    case 'conf':
    case 'cfg':
    case 'prop':
      return [StreamLanguage.define(properties)];
    case 'toml':
      return [StreamLanguage.define(toml)];
    case 'ps1':
    case 'psm1':
      return [StreamLanguage.define(powerShell)];
    default:
      return [];
  }
}
