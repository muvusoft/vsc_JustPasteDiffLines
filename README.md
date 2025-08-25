# Just Paste Diff Lines

🚀 **A minimal, no-frills diff tool for VS Code.**  
Paste only the lines starting with `+` or `-`, preview the result, and apply with a single click.  

This extension is designed to make testing small patches fast and frictionless – whether from code reviews, AI-generated suggestions, or forum posts.  

---

## ✨ Features

- 📋 **Copy-paste friendly** – lines without a leading `+` or `-` are ignored, so you can paste raw snippets, forum posts, or AI outputs without cleanup.  
- 👀 **Preview before apply** – always see the exact changes side-by-side before committing them.  
- 🔨 **Apply changes instantly** – patch the active file with one click.  
- ♻️ **Reset or close preview** – quickly discard or exit the diff view.  
- 🎯 **Super lightweight** – no `git apply`, no patch headers, no extra setup.  

---

## 🖼️ Example

Paste this into the diff panel:

-console.log("foo");
+console.log("bar");

or, if you prefer you can paste with remarks, both are same:

```diff
-console.log("foo");
+console.log("bar");
```

Then hit **Preview** → see the diff → **Apply** to patch your file.  

---

## 🚀 How to Use

1. Copy any snippet that shows additions/removals.  
   - Example from a code review, StackOverflow answer, or an AI model (ChatGPT, Grok, Claude, etc.).  
   - Context lines or headers will be ignored unless they start with `+` or `-`.  

2. Open the **Diff Tool** panel:  
   - Command Palette (`Ctrl+Shift+P`) → **Just Paste Diff: Open Panel**, or  
   - Click the **Diff Tool** icon in the Activity Bar.  

3. Paste the diff text.  
   - **Preview** → see side-by-side differences.  
   - **Apply** → update your active document.  

---

## 🤖 Using with AI Assistants (ChatGPT, Grok, Claude, Mistral, etc.)

Large language models (LMM) often propose code changes . Instruct them to use in simple with `-` and `+` diff-like formats.  
This extension makes it easy to apply them:  

- Instruct the model to output changes **only with `-` and `+` prefixes**, for example:

  ```diff
  -oldFunction();
  +newFunction();
  ```

- You can safely copy-paste the entire response; lines without `+` or `-` will be ignored automatically.  
- Always **Preview** first to confirm correctness before applying.  

---

## ⚠️ Disclaimer

- This extension uses a **very simple line-based algorithm**.  
- It does not perform advanced context matching – lines are replaced, inserted, or deleted as-is.  
- **Always verify the preview** before applying.  
- Use at your own risk. (VS Code’s Undo is your friend.)  

---

## ⚙️ Commands

- **Just Paste Diff: Open Panel** → Open the diff panel.  
- **Just Paste Diff: Preview Patch** → Show a preview of changes.  
- **Just Paste Diff: Apply Patch** → Apply the patch to the active file.  
- **Just Paste Diff: Reset/Close Preview** → Reset or close the preview view.  

---

## 📦 Installation

- Marketplace: [Just Paste Diff Lines](https://marketplace.visualstudio.com/items?itemName=muvusoft.just-paste-diff-lines)  
- Manual: download the `.vsix` file and install via  
  **Extensions → … → Install from VSIX…**  

---

## 📄 License

MIT License. See [LICENSE](./LICENSE) for details.

---

🎯 With **Just Paste Diff Lines**, applying quick patches becomes as simple as copy, paste, preview, and apply. Perfect for lightweight workflows and AI-assisted coding.  
