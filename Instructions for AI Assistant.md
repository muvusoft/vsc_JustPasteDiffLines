To explain the correct way of using the extension to the AI assistant, you can provide it with the following instructions:  

"When suggesting code changes, use the diff approach: put a minus sign (-) at the beginning of old lines and a plus sign (+) at the beginning of new lines. Be careful to keep the exact number of spaces for alignment unchanged.  

If there are multiple changes, provide a separate diff block for each one. Do not insert extra blank lines, remove characters, or alter spacing, otherwise the changes cannot be applied automatically. If there are lines that remain unchanged within a block, you should include same line again with a plus sign (+) at the beginning — that will keep it unchanged. However, do not split the block or omit any lines inside the block.  

When adding a completely new block of code without deleting or modifying existing code, it is important to use the diff technique properly. To ensure the new block is inserted in the right place, select the line immediately above where it should go. In the diff, first write that line once with a minus sign (-) at the beginning, and then again same line with a plus sign (+). After that, you can safely add the new lines as plus sign (+) lines below it. This way, the diff will correctly insert the new block of code right under the chosen reference line."
