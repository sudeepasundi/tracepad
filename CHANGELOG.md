# Changelog

What changed in each release, written for people who use Tracepad.

## 0.3.0

Logs.

- Log files are recognised automatically: Spring Boot, Logback and Log4j, JSON lines, Apache/Nginx access logs, syslog, java.util.logging, epoch timestamps and a generic fallback for any line that starts with a timestamp. Kubernetes and Docker line prefixes are understood, and Windows line endings make no difference. The status bar shows the detected format. "Treat this tab as a log" forces it for anything else.
- Levels are coloured. In stack traces, library frames are dimmed and your own stand out; set your package prefix under Log insights. Stack traces fold into their entry.
- A timeline above the log shows activity over time with warnings and errors marked. Click a bar to jump there; drag across it to filter to that time range; double-click to clear.
- Filters, all combined: level chips with counts, text or regular expression, several "lines matching" patterns (any or all), logger or thread, trace ID, and From/To boxes that accept 10:15, 10:15:30 or a full date and time. One button clears them. Filtering never changes the file.
- F8 and Shift+F8 jump between errors.
- Log insights (sidebar): format, time span, level counts, and repeated errors and warnings grouped with counts; click a group to step through its occurrences.
- Highlight rules (sidebar): mark words or patterns in your own colours, in every file.
- "Filter to the trace ID on this line" follows one request through the log.
- The minimap shows where the warnings and errors are.
- Limits for now: files over 64 MB are still not opened (0.4), and a time typed without a date is taken on the day the log starts.

## 0.2.0

Tabs and files.

- Your tabs come back when you reopen Tracepad: names, order, the tab you were on, and unsaved text (up to about 2 MB per tab). Linked files are read again from disk. After a browser restart a linked file asks for access once, with a single button.
- Rename any tab by double-clicking it, pressing F2, or from the right-click menu. It works for tabs that were never saved, and Save then suggests the new name. A new extension switches the syntax colouring.
- Linked files are renamed on disk in Chrome and Edge. Where the browser cannot do that, Tracepad says so and offers to rename just the tab.
- Drag tabs to reorder them.
- Right-click a tab for Rename, Copy name, Move to start, Move to end, Close and Close other tabs.
- The Open files list (Ctrl+Shift+E) is now complete: a filter box (Enter opens the first match), sorting by tab order, name, recently used or type, arrow-key navigation, rename, close, the same menu as tabs, and drag to reorder. Unsaved files and logs are marked, and the current file is highlighted.
- Installed as an app, Tracepad can be chosen to open .log, .txt, .md, .json and .csv files.
- When Tracepad runs inside another page that may block downloads, Save now also offers "Copy all text".
- You are only warned when closing the page if some unsaved work could not be kept.

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
