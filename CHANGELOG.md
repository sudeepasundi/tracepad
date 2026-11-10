# Changelog

What changed in each release, written for people who use Tracepad.

## 0.1.0

The first release: a solid editor to build the log tools on.

- Open several files at once, edit them in tabs, and save. In Chrome and Edge a file stays linked, so Save writes straight back to it; in other browsers Save downloads a copy.
- Drag files onto the window to open them.
- Encodings are detected and kept: UTF-8, UTF-8 with BOM, UTF-16 LE/BE and Latin-1. The status bar shows the encoding and the line endings, and you can switch between LF and CRLF there. Binary files are refused with a message.
- Multi-cursor editing, column (box) selection with Alt+drag, find and replace with regular expressions, go to line, word wrap and a minimap.
- A command palette (Ctrl+Shift+P or F1) lists every action with its shortcut.
- Six themes, six accent colours and a compact mode. Font and size are adjustable.
- Works offline once visited and can be installed as an app. When a new version is published you are asked to reload.
- Also available as a single HTML file that runs anywhere, including inside an embedded frame.
- A sample Spring Boot log is included to try things on.
- Limit for now: files larger than 64 MB are not opened. The large-file viewer is planned for 0.4.
