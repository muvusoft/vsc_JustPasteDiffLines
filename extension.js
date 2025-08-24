// extension.js
const vscode = require('vscode');

function activate(context) {
    console.log('Extension "just-paste-diff-lines" is active');

    const provider = new DiffViewProvider(context.extensionUri);

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

    constructor(extensionUri) {
        this._extensionUri = extensionUri;
        this._view = null;
        this._diffText = '';
    }

    resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(message => {
            if (!message) return;
            switch (message.command) {
                case 'apply':
                    this._diffText = message.text ?? '';
                    vscode.commands.executeCommand('diffView.applyPatch');
                    break;
                case 'preview':
                    this._diffText = message.text ?? '';
                    vscode.commands.executeCommand('diffView.previewPatch');
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
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('btnPreview').addEventListener('click', () => {
      vscode.postMessage({ command: 'preview', text: document.getElementById('diffInput').value });
    });
    document.getElementById('btnApply').addEventListener('click', () => {
      vscode.postMessage({ command: 'apply', text: document.getElementById('diffInput').value });
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

        const leftUri = vscode.Uri.parse('untitled:Just Paste Diff — Original');
        const rightUri = vscode.Uri.parse('untitled:Just Paste Diff — Patched');

        // Open both untitled docs first
        await Promise.all([
            vscode.workspace.openTextDocument(leftUri),
            vscode.workspace.openTextDocument(rightUri)
        ]);

        // Insert contents via single WorkspaceEdit
        const edit = new vscode.WorkspaceEdit();
        edit.insert(leftUri, new vscode.Position(0, 0), originalText);
        edit.insert(rightUri, new vscode.Position(0, 0), patchedText);
        await vscode.workspace.applyEdit(edit);

        // Show diff
        await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, 'Just Paste Diff: Preview');
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
    const raw = (diffText || '').split(/\r?\n/);
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
