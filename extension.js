const vscode = require("vscode");

function activate(context) {
  vscode.window.showInformationMessage("🚀 Extension activated!");
  console.log("✅ Extension activated");

  const provider = new class {
    resolveWebviewView(webviewView) {
      console.log("🚀 resolveWebviewView CALISTI");
      webviewView.webview.options = { enableScripts: true };
      webviewView.webview.html = `
        <html><body>
          <h3>Hello from panel 🎉</h3>
          <textarea style="width:100%;height:200px"></textarea><br>
          <button onclick="alert('preview')">Preview</button>
          <button onclick="alert('apply')">Apply</button>
        </body></html>`;
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("diffView", provider)
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
