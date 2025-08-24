const vscode = require("vscode");

/**
 * DiffPanelProvider: view provider for Activity Bar panel
 * We also register a fallback command that opens a WebviewPanel (works even if view-provider doesn't instantiate).
 */
class DiffPanelProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    vscode.window.showInformationMessage("📌 Diff Panel view resolved (resolveWebviewView called)");
    console.log("[JustPasteDiff] resolveWebviewView CALLED");
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = getHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await handleMessage(message);
    });
  }
}

async function handleMessage(message) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active editor!");
    return;
  }
  const originalText = editor.document.getText();

  if (message.command === "preview") {
    try {
      const newText = applyPatchCustom(originalText, message.diff);
      const leftUri = vscode.Uri.parse("untitled:Original");
      const rightUri = vscode.Uri.parse("untitled:Modified");

      await vscode.workspace.openTextDocument(leftUri).then(() => {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(leftUri, new vscode.Position(0, 0), originalText);
        return vscode.workspace.applyEdit(edit);
      });

      await vscode.workspace.openTextDocument(rightUri).then(() => {
        const edit = new vscode.WorkspaceEdit();
        edit.insert(rightUri, new vscode.Position(0, 0), newText);
        return vscode.workspace.applyEdit(edit);
      });

      vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, "Diff Preview");
    } catch (err) {
      vscode.window.showErrorMessage("Failed to preview diff: " + err);
    }
  } else if (message.command === "apply") {
    try {
      const newText = applyPatchCustom(originalText, message.diff);
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        editor.document.positionAt(0),
        editor.document.positionAt(originalText.length)
      );
      edit.replace(editor.document.uri, fullRange, newText);
      await vscode.workspace.applyEdit(edit);
      await editor.document.save();
      vscode.window.showInformationMessage("Changes applied!");
    } catch (err) {
      vscode.window.showErrorMessage("Failed to apply diff: " + err);
    }
  }
}

/**
 * Custom patch: only lines starting with + or - are acted on.
 */
function applyPatchCustom(originalText, diffText) {
  const originalLines = originalText.split("\n");
  const diffLines = diffText.split("\n");

  const result = [...originalLines];
  for (const line of diffLines) {
    if (line.startsWith("+")) {
      result.push(line.slice(1));
    } else if (line.startsWith("-")) {
      const toRemove = line.slice(1);
      const idx = result.indexOf(toRemove);
      if (idx !== -1) result.splice(idx, 1);
    }
  }
  return result.join("\n");
}

/**
 * The webview HTML (same for both view-provider and fallback panel)
 */
function getHtml() {
  const script = `
    const vscode = acquireVsCodeApi();
    function preview() {
      const diff = document.getElementById("diffText").value;
      vscode.postMessage({ command: "preview", diff });
    }
    function apply() {
      const diff = document.getElementById("diffText").value;
      vscode.postMessage({ command: "apply", diff });
    }
  `;
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body { font-family: sans-serif; padding: 10px; }
        textarea { width: 100%; height: 220px; font-family: monospace; }
        button { margin-top: 10px; margin-right: 10px; padding: 6px 12px; }
      </style>
    </head>
    <body>
      <h3>Paste your diff (+/- lines only)</h3>
      <textarea id="diffText" placeholder="+ added line\n- removed line"></textarea><br>
      <button onclick="preview()">Preview changes</button>
      <button onclick="apply()">Apply changes</button>
      <script>${script}</script>
    </body>
    </html>
  `;
}

/**
 * activate: register view provider AND a fallback command (open as WebviewPanel)
 */
function activate(context) {
  vscode.window.showInformationMessage("🚀 Just Paste Diff Lines extension activated!");

  const provider = new DiffPanelProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("diffView", provider)
  );

  // fallback command: always works (createWebviewPanel)
  const disposable = vscode.commands.registerCommand("justPasteDiff.openPanel", () => {
    const panel = vscode.window.createWebviewPanel(
      "justPasteDiff.panel",
      "Diff Panel",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );
    panel.webview.html = getHtml();

    panel.webview.onDidReceiveMessage(async (message) => {
      await handleMessage(message);
    });
  });
  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };
