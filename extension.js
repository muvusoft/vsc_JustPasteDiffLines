// extension.js
const vscode = require('vscode');

/** Virtual diff documents so every Preview reuses the same tab */
const DIFF_SCHEME = 'jpdiff';
const LEFT_URI = vscode.Uri.parse(`${DIFF_SCHEME}:/preview/left`);
const RIGHT_URI = vscode.Uri.parse(`${DIFF_SCHEME}:/preview/right`);

class JPDiffContentProvider {
    constructor() {
        this._left = '';
        this._right = '';
        this._emitter = new vscode.EventEmitter();
        this.onDidChange = this._emitter.event;
    }
    provideTextDocumentContent(uri) {
        if (uri.toString() === LEFT_URI.toString()) return this._left;
        if (uri.toString() === RIGHT_URI.toString()) return this._right;
        return '';
    }
    setContents(left, right) {
        this._left = left ?? '';
        this._right = right ?? '';
        this._emitter.fire(LEFT_URI);
        this._emitter.fire(RIGHT_URI);
    }
    reset() {
        this._left = '';
        this._right = '';
        this._emitter.fire(LEFT_URI);
        this._emitter.fire(RIGHT_URI);
    }
}

function activate(context) {
    const diffContentProvider = new JPDiffContentProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffContentProvider)
    );

    const provider = new DiffViewProvider(context.extensionUri, diffContentProvider);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DiffViewProvider.viewType, provider),
        vscode.commands.registerCommand('diffView.applyPatch', () => provider.applyPatch()),
        vscode.commands.registerCommand('diffView.previewPatch', () => provider.previewPatch()),
        vscode.commands.registerCommand('diffView.resetPreview', () => provider.resetPreview()),
        vscode.commands.registerCommand('diffView.closePreview', () => provider.closePreview()),
        vscode.commands.registerCommand('justPasteDiff.openPanel', async () => {
            try { await vscode.commands.executeCommand('workbench.view.extension.diffContainer'); } catch {}
            try { await vscode.commands.executeCommand('diffView.focus'); } catch {}
        }),
    );
}

class DiffViewProvider {
    static viewType = 'diffView';
    constructor(extensionUri, diffContentProvider) {
        this._extensionUri = extensionUri;
        this._view = null;
        this._diffContentProvider = diffContentProvider;

        this._lastSourceUri = null;
        this._lastDiffText = '';
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.onDidDispose(() => {
            this._diffContentProvider.reset();
        });

        webviewView.webview.onDidReceiveMessage(message => {
            if (!message) return;
            switch (message.command) {
                case 'apply':
                    this._lastDiffText = message.text ?? '';
                    vscode.commands.executeCommand('diffView.applyPatch');
                    break;
                case 'preview':
                    this._lastDiffText = message.text ?? '';
                    vscode.commands.executeCommand('diffView.previewPatch');
                    break;
                case 'resetPreview':
                    this.resetPreview();
                    break;
                case 'closePreview':
                    vscode.commands.executeCommand('diffView.closePreview');
                    break;
            }
        });
    }

    _getHtmlForWebview() {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Just Paste Diff</title>
<style>
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    width: 100%;
    overflow: hidden; /* dış scrollbar tamamen gizlenir */
    font-family: var(--vscode-font-family);
  }
  .wrap {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 8px;
    box-sizing: border-box;
  }
  h3 { margin: 0; }
  p { margin: .2rem 0 .8rem 0; opacity: .8; }
  #diffInput {
    flex: 1;
    width: 100%;
    min-height: 120px;
    resize: vertical;
    overflow: auto;
    box-sizing: border-box;
    padding: 6px;
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    line-height: var(--vscode-editor-line-height);
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 4px;
  }
  #diffInput::-webkit-scrollbar { width: 8px; }
  #diffInput::-webkit-scrollbar-thumb {
    background: var(--vscode-editorWidget-border);
    border-radius: 4px;
  }
  .controls {
    margin-top: .6rem;
    display: flex;
    gap: .5rem;
    flex-wrap: wrap;
  }
</style>
</head>
<body>
  <div class="wrap">
    <h3>Just Paste Diff Lines</h3>
    <p>Only lines starting with <code>+</code> or <code>-</code> are considered. Others are ignored.</p>
    <textarea id="diffInput"></textarea>
    <div class="controls">
      <button id="btnPreview">Preview</button>
      <button id="btnApply">Apply</button>
      <button id="btnReset">Reset Preview</button>
      <button id="btnClose">Close Preview</button>
    </div>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const $ = id => document.getElementById(id);
    $('btnPreview').addEventListener('click', () => {
      vscode.postMessage({ command: 'preview', text: $('diffInput').value });
    });
    $('btnApply').addEventListener('click', () => {
      vscode.postMessage({ command: 'apply', text: $('diffInput').value });
    });
    $('btnReset').addEventListener('click', () => {
      vscode.postMessage({ command: 'resetPreview' });
    });
    $('btnClose').addEventListener('click', () => {
      vscode.postMessage({ command: 'closePreview' });
    });
  </script>
</body>
</html>`;
    }

    async _resolveSourceDocument() {
        const active = vscode.window.activeTextEditor;
        if (active && active.document?.uri?.scheme !== DIFF_SCHEME) {
            this._lastSourceUri = active.document.uri;
            return active.document;
        }
        if (this._lastSourceUri) {
            try {
                return await vscode.workspace.openTextDocument(this._lastSourceUri);
            } catch {}
        }
        vscode.window.showErrorMessage('No source document to operate on. Focus a text editor and try again.');
        return null;
    }

    async applyPatch() {
        const doc = await this._resolveSourceDocument();
        if (!doc) return;
        const originalText = doc.getText();
        const patchedText = applyPatchCustom(originalText, this._lastDiffText ?? '');
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        await editor.edit(editBuilder => {
            const start = new vscode.Position(0, 0);
            const end = new vscode.Position(doc.lineCount, 0);
            editBuilder.replace(new vscode.Range(start, end), patchedText);
        });
        try {
            this._diffContentProvider.setContents(patchedText, patchedText);
        } catch {}
    }

    async previewPatch() {
        const doc = await this._resolveSourceDocument();
        if (!doc) return;

        const originalText = doc.getText();
        const patchedText = applyPatchCustom(originalText, this._lastDiffText ?? '');

        this._lastSourceUri = doc.uri;
        this._diffContentProvider.setContents(originalText, patchedText);
        await vscode.commands.executeCommand('vscode.diff', LEFT_URI, RIGHT_URI, 'Just Paste Diff: Preview');

        const ops = parseSimpleDiff(this._lastDiffText ?? '');
        let firstChangeLine = 0;
        if (ops.length) {
            const originalLines = originalText.split(/\r?\n/);
            for (const op of ops) {
                if (op.type === 'replace' || op.type === 'delete') {
                    const pos = indexOfLine(originalLines, op.old, 0);
                    if (pos !== -1) { firstChangeLine = pos; break; }
                } else if (op.type === 'insert') {
                    firstChangeLine = Math.max(0, originalLines.length - 1);
                    break;
                }
            }
        }
        const wait = ms => new Promise(r => setTimeout(r, ms));
        let rightEditor = null;
        for (let i = 0; i < 10; i++) {
            rightEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === RIGHT_URI.toString());
            if (rightEditor) break;
            await wait(40);
        }
        if (rightEditor) {
            const line = Math.max(0, Math.min(firstChangeLine, rightEditor.document.lineCount - 1));
            rightEditor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
        }
    }

    async resetPreview() {
        if (this._lastSourceUri) {
            try {
                const doc = await vscode.workspace.openTextDocument(this._lastSourceUri);
                const originalText = doc.getText();
                this._diffContentProvider.setContents(originalText, originalText);
                return;
            } catch {}
        }
        this._diffContentProvider.setContents('', '');
    }

    async closePreview() {
        this._diffContentProvider.reset();
        try {
            const groups = vscode.window.tabGroups.all;
            const toClose = [];
            for (const g of groups) {
                for (const tab of g.tabs) {
                    const input = tab.input;
                    if (input && input.original && input.modified) {
                        const o = input.original;
                        const m = input.modified;
                        if (o?.toString() === LEFT_URI.toString() && m?.toString() === RIGHT_URI.toString()) {
                            toClose.push(tab);
                        }
                    }
                }
            }
            if (toClose.length) {
                await vscode.window.tabGroups.close(toClose, true);
            }
        } catch {}
        if (this._lastSourceUri) {
            try {
                const doc = await vscode.workspace.openTextDocument(this._lastSourceUri);
                await vscode.window.showTextDocument(doc, { preview: false });
            } catch {}
        }
    }
}

function applyPatchCustom(originalText, diffText) {
    const EOL = originalText.includes('\r\n') ? '\r\n' : '\n';
    let lines = originalText.split(/\r?\n/);
    const ops = parseSimpleDiff(diffText || '');
    let cursor = 0;
    for (const op of ops) {
        if (op.type === 'replace') {
            let pos = indexOfLine(lines, op.old, cursor);
            if (pos === -1) pos = indexOfLine(lines, op.old, 0);
            if (pos !== -1) {
                lines.splice(pos, 1, op.new);
                cursor = pos + 1;
            } else {
                const insertPos = lines.length;
                lines.splice(insertPos, 0, op.new);
                cursor = insertPos + 1;
            }
        } else if (op.type === 'delete') {
            let pos = indexOfLine(lines, op.old, cursor);
            if (pos === -1) pos = indexOfLine(lines, op.old, 0);
            if (pos !== -1) {
                lines.splice(pos, 1);
                cursor = pos;
            }
        } else if (op.type === 'insert') {
            const insertPos = clamp(cursor, 0, lines.length);
            lines.splice(insertPos, 0, op.new);
            cursor = insertPos + 1;
        }
    }
    return lines.join(EOL);
}

function parseSimpleDiff(diffText) {
    const raw = (diffText || '').split(/\r?\n/);
    const ops = [];
    for (let i = 0; i < raw.length; i++) {
        const s = raw[i];
        if (s.startsWith('-')) {
            const oldLine = s.slice(1);
            if (i + 1 < raw.length && raw[i + 1].startsWith('+')) {
                const newLine = raw[i + 1].slice(1);
                ops.push({ type: 'replace', old: oldLine, new: newLine });
                i++;
            } else {
                ops.push({ type: 'delete', old: oldLine });
            }
        } else if (s.startsWith('+')) {
            ops.push({ type: 'insert', new: s.slice(1) });
        }
    }
    return ops;
}

function indexOfLine(arr, value, fromIndex) {
    for (let i = Math.max(0, fromIndex | 0); i < arr.length; i++) {
        if (arr[i] === value) return i;
    }
    return -1;
}
function clamp(x, min, max) { return Math.min(Math.max(x, min), max); }

function deactivate() {}

module.exports = { activate, deactivate };
