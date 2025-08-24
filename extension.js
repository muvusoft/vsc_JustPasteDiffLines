// extension.js
const vscode = require('vscode');

/**
 * A virtual document content provider so we can reuse
 * the same diff tab for every Preview (no tab explosion).
 */
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
    console.log('Extension "just-paste-diff-lines" is active');

    // Register our virtual content provider
    const diffContentProvider = new JPDiffContentProvider();
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffContentProvider)
    );

    const provider = new DiffViewProvider(context.extensionUri, diffContentProvider);

    // View provider: id MUST match package.json -> contributes.views[*].id = "diffView"
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DiffViewProvider.viewType, provider)
    );

    // Commands (also declared in package.json)
    context.subscriptions.push(
        vscode.commands.registerCommand('diffView.applyPatch', () => provider.applyPatch())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('diffView.previewPatch', () => provider.previewPatch())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('diffView.closePreview', () => provider.closePreview())
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('justPasteDiff.openPanel', async () => {
            // Reveal the container, then focus the view
            try {
                await vscode.commands.executeCommand('workbench.view.extension.diffContainer');
            } catch {}
            try {
                // VS Code automatically contributes a <viewId>.focus command
                await vscode.commands.executeCommand('diffView.focus');
            } catch {}
        })
    );
}

class DiffViewProvider {
    static viewType = 'diffView';

    constructor(extensionUri, diffContentProvider) {
        this._extensionUri = extensionUri;
        this._view = null;
        this._diffText = '';
        this._diffContentProvider = diffContentProvider;
    }

    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        // Panel kapatıldığında reset
        webviewView.onDidDispose(() => {
            this._diffText = '';
            // preview'i de temizle (sekmeyi kapatmasak bile içerik boş görünür)
            this._diffContentProvider.reset();
        });

        webviewView.webview.onDidReceiveMessage(message => {
            if (!message) return;
            switch (message.command) {
                case 'apply':
                    this._diffText = message.text ?? '';
                    vscode.commands.executeCommand('diffView.applyPatch').finally(() => {
                        this._diffText = ''; // apply sonrası reset
                    });
                    break;
                case 'preview':
                    this._diffText = message.text ?? '';
                    vscode.commands.executeCommand('diffView.previewPatch').finally(() => {
                        // _diffText'i saklamaya gerek yok, preview bir "geçici görüntü"
                        this._diffText = '';
                    });
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
  <div style="margin-top:.6rem; display:flex; gap:.5rem;">
    <button id="btnPreview">Preview</button>
    <button id="btnApply">Apply</button>
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
    $('btnClose').addEventListener('click', () => {
      vscode.postMessage({ command: 'closePreview' });
    });
  </script>
</body>
</html>`;
    }

    applyPatch() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active text editor to apply the patch.');
            return;
        }

        const originalText = editor.document.getText();
        const diff = this._diffText ?? '';
        const patchedText = applyPatchCustom(originalText, diff);

        editor.edit(editBuilder => {
            const start = new vscode.Position(0, 0);
            const end = new vscode.Position(editor.document.lineCount, 0);
            editBuilder.replace(new vscode.Range(start, end), patchedText);
        });
    }

    async previewPatch() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active text editor to preview the patch.');
            return;
        }

        const originalText = editor.document.getText();
        const diff = this._diffText ?? '';
        const patchedText = applyPatchCustom(originalText, diff);

        // Tek bir diff sekmesi: içerikleri güncelle, sekmeyi aç (veya ön plana getir).
        this._diffContentProvider.setContents(originalText, patchedText);
        await vscode.commands.executeCommand('vscode.diff', LEFT_URI, RIGHT_URI, 'Just Paste Diff: Preview');
    }

    async closePreview() {
        // İçeriği sıfırla (sekme açık kalsa da boş görünür)
        this._diffContentProvider.reset();

        // Açık diff sekmesini kapatmaya çalış
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
        } catch {
            // fallback: aktif editörü kapat
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
    }
}

/**
 * Custom patch v2:
 * - Only lines starting with + or - are considered.
 * - "- old" followed immediately by "+ new" => replace first matching "old" (from current cursor) with "new".
 * - Lone "- old" => delete first matching "old" (from current cursor).
 * - Lone "+ new" => insert after the last touched position (or end if none).
 * - Preserves original EOL style.
 */
function applyPatchCustom(originalText, diffText) {
    const EOL = originalText.includes('\\r\\n') ? '\\r\\n' : '\\n';
    let lines = originalText.split(/\\r?\\n/);

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
                const insertPos = clamp(cursor, 0, lines.length);
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

/** Parse only +/- lines. "- x" followed by "+ y" => replace; others => delete/insert. */
function parseSimpleDiff(diffText) {
    const raw = (diffText || '').split(/\\r?\\n/);
    const ops = [];
    for (let i = 0; i < raw.length; i++) {
        const s = raw[i];
        if (s.startsWith('-')) {
            const oldLine = s.slice(1);
            if (i + 1 < raw.length && raw[i + 1].startsWith('+')) {
                const newLine = raw[i + 1].slice(1);
                ops.push({ type: 'replace', old: oldLine, new: newLine });
                i++; // consume the + line
            } else {
                ops.push({ type: 'delete', old: oldLine });
            }
        } else if (s.startsWith('+')) {
            ops.push({ type: 'insert', new: s.slice(1) });
        } // everything else ignored
    }
    return ops;
}

/** Find exact line match from a starting index */
function indexOfLine(arr, value, fromIndex) {
    for (let i = Math.max(0, fromIndex | 0); i < arr.length; i++) {
        if (arr[i] === value) return i;
    }
    return -1;
}

function clamp(x, min, max) {
    return Math.min(Math.max(x, min), max);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
