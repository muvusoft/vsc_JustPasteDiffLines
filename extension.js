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

        /** State to make Apply work even when diff is focused */
        this._lastSourceUri = null;    // URI of the document we previewed against
        this._lastDiffText = '';       // Last diff text received from webview
    }

    resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this._extensionUri] };
        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.onDidDispose(() => {
            // Don't touch the user's textarea; only clear preview panes
            this._diffContentProvider.reset();
            // Keep _lastSourceUri/_lastDiffText so Apply can still work after panel closure if desired
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
</head>
<body style="font-family: var(--vscode-font-family); padding: 8px;">
  <h3 style="margin-top:0;">Just Paste Diff Lines</h3>
  <p style="opacity:.8;margin:.2rem 0 .8rem 0;">Only lines starting with <code>+</code> or <code>-</code> are considered. Others are ignored.</p>
  <textarea id="diffInput" style="width:100%;height:200px;"></textarea>
  <div style="margin-top:.6rem; display:flex; gap:.5rem; flex-wrap:wrap;">
    <button id="btnPreview">Preview</button>
    <button id="btnApply">Apply</button>
    <button id="btnReset">Reset Preview</button>
    <button id="btnClose">Close Preview</button>
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

    /** Resolve a source document to work on, even if the diff is currently focused */
    async _resolveSourceDocument() {
        const active = vscode.window.activeTextEditor;
        if (active && active.document?.uri?.scheme !== DIFF_SCHEME) {
            this._lastSourceUri = active.document.uri;
            return active.document;
        }
        // If active is the diff or there's no active editor, fall back to last known source
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

        // Show the source doc to get a TextEditor we can edit,
        // even if the diff editor currently has focus.
        const editor = await vscode.window.showTextDocument(doc, { preview: false });

        await editor.edit(editBuilder => {
            const start = new vscode.Position(0, 0);
            const end = new vscode.Position(doc.lineCount, 0);
            editBuilder.replace(new vscode.Range(start, end), patchedText);
        });

        // Optional: keep preview open but refresh it to reflect "no diff" state
        try {
            this._diffContentProvider.setContents(patchedText, patchedText);
        } catch {}
        // Do NOT clear user's textarea; allow them to tweak and preview again
        // If needed, they can Reset Preview or Close Preview manually.
    }

    async previewPatch() {
        const doc = await this._resolveSourceDocument();
        if (!doc) return;

        const originalText = doc.getText();
        const patchedText = applyPatchCustom(originalText, this._lastDiffText ?? '');

        // Remember the source we previewed against
        this._lastSourceUri = doc.uri;

        // Update single diff tab
        this._diffContentProvider.setContents(originalText, patchedText);
        await vscode.commands.executeCommand('vscode.diff', LEFT_URI, RIGHT_URI, 'Just Paste Diff: Preview');
    }

    resetPreview() {
        // Only clear the preview panes; do not touch user's textarea or last diff text
        this._diffContentProvider.reset();
    }

    async closePreview() {
        // Clear preview content first
        this._diffContentProvider.reset();

        // Try to close any open diff tabs that match our URIs
        try {
            const groups = vscode.window.tabGroups.all;
            const toClose = [];
            for (const g of groups) {
                for (const tab of g.tabs) {
                    const input = tab.input;
                    // VS Code API: TabInputTextDiff has 'original' and 'modified' URIs
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
        // Return focus to source doc if we know it
        if (this._lastSourceUri) {
            try {
                const doc = await vscode.workspace.openTextDocument(this._lastSourceUri);
                await vscode.window.showTextDocument(doc, { preview: false });
            } catch {}
        }
    }
}

/**
 * Diff logic:
 * - Only lines starting with + or - are considered.
 * - "- old" followed by "+ new" => replace first matching "old" (from current cursor), else append at end.
 * - Lone "- old" => delete first matching "old" (from current cursor), else no-op.
 * - Lone "+ new" => insert after last touched position (cursor), clamped to end.
 * - Preserves original EOL style.
 */
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
