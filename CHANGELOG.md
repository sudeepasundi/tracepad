# Changelog

What changed in each release, written for people who use Tracepad.

## 1.1.1

- The SQL rule now marks whole statements, not just the keyword, and is on from the start. It finds `select … from`, `insert into`, `update … set`, `delete from`, `merge into` and `with … as (select`, in any case, so Hibernate's lower-case SQL is covered (1.1.0 only matched upper-case keywords). A statement runs to a semicolon or the end of its log entry.
- SQL that Hibernate pretty-prints over several lines (`format_sql`) is marked on every line it spans, without the indentation, and never into a stack trace or the next entry.
- The statement gets a light tint, so a slow time or the filter's matches inside it still stand out. Ordinary sentences such as "please select a value from the list" are not marked.
- Works the same in the large-file viewer.
- Fixed: with panes scrolling together by time, a log that finished loading after you had already scrolled another pane stayed where it was until the next scroll. It now lines up as soon as it is ready.

## 1.1.0

Selection and highlighting.

- Fixed: a selection was invisible on the line with the cursor, and on the highlighted stack frames from your own code. Both are now drawn see-through, so the selection always shows.
- Selecting a word now outlines the other places it appears, instead of colouring them like a second selection. Only a single word counts (INFO, HikariPool, orderId): selecting part of a timestamp or any text with punctuation no longer lights up every line.
- Ready-made highlight rules for logs, on from the start: exception and error class names, HTTP 4xx and 5xx statuses, slow times (500 ms or more), and timeouts, refusals and retries. Three more can be switched on: trace and span IDs, IP addresses, and SQL statements. They are at the top of the Highlight rules panel, each with an example; your own rules are below them and take precedence where both match. The ready-made rules apply to logs only; your own rules apply to every file.
- The log filter now marks what it matched in the lines it shows, the same way the find box does.
- Highlight rules and the filter's marks now also work in the large-file viewer.
- Highlighted text on dimmed lines (DEBUG entries, library stack frames) now uses the full text colour, so it stays readable.

## 1.0.0

Polish. Everything from the earlier versions, checked over.

- Accessibility: every main screen is now checked by an automated audit (WCAG 2.1 A and AA) in a dark and a light theme, and what it found is fixed. Line numbers are easier to read. Read-only views (large files' placeholders, empty panes, the compare view) can be reached and scrolled from the keyboard. The sidebar and result tables can be scrolled from the keyboard. Names of controls match what they show.
- From the keyboard, Delete on a result's tab closes it; tabs close with Alt+W or from their menu (Shift+F10).
- Faster start: the Markdown renderer and the compare view are loaded the first time you use them (they still work offline). The first load is about 13% smaller.
- An open Markdown preview now comes back after a reload.
- Phones: the list of patterns in Auto tables has more room.
- More of the app is tested in Firefox and Safari: logs and filters, Auto tables, split view with time sync, compare, the Markdown preview and pasted tables.
- Limits that remain: large files (over 64 MB) are read-only and cannot be compared; a file is shown in one pane at a time; in Firefox and Safari files cannot be saved in place (they are downloaded instead); inside another page, downloads may be blocked, and Save then offers to copy the text.

## 0.8.0

Compare.

- Compare two files side by side: right-click a tab (or a file in the Open files list) and choose "Compare with…", press Alt+C, or search "Compare" in the command palette. With two files open, or two side by side in a split, it goes straight to the comparison; otherwise you pick the other file from a list.
- Changed lines are tinted on both sides, with the changed words marked. F7 and Shift+F7 (or the arrows) go to the next and previous change. "Hide unchanged" shows only the changes with a few lines around them. Swap sides, Refresh, and full screen are in the header. The two sides meet at a single line, with no strip between them.
- In large files, Shift+click on a line's text (not only its number) now extends the selected range.
- Limits: the comparison is read-only and shows the files as they were when it opened (Refresh takes them again); large files shown from disk cannot be compared.
- Not included, by decision: the Copilot hand-off that was planned for this version. Tracepad has no Copilot button and opens no other site.

## 0.7.1

- Fixed: "Edit as table" on a large table opened its editor far down the page, mostly off the screen. It now stays in the middle of the screen whatever the size of the table, and the grid scrolls inside it.
- The table editor keeps the header row in view while you scroll, makes each column wide enough to read its values, and shows how many rows and columns the table has.

## 0.7.0

Split view with snap layouts.

- The split button in the top bar (hover or click) shows five layouts: side by side, top and bottom, three columns, one large and two stacked, and two by two. Click the place where the current file should go.
- Empty places show your other open files as large cards to pick from, "Open a file", or "Leave this space out".
- Drag a tab, or a file from the Open files list, over the editor: a bar with the same layouts appears at the top, and a translucent outline shows exactly where the file will land. Dropping on a pane replaces what it shows; dropping on the right half of a single editor opens the two side by side. Dragging within the tab strip still reorders.
- Up to four files. Every layout has dividers you can drag; double-click a divider for equal sizes. Sizes are remembered, and the split comes back after a reload.
- Ctrl+\ toggles two files side by side. F6 moves to the next pane. "Show beside" is in the tab menu.
- Panes scroll together by time: several services' logs stay at the same moment, whichever pane you scroll. Choose "By time", "By line" or "Off" in the split menu.
- Filters, including time ranges, and Ctrl+F apply to every pane. The log bar stays in place while any pane shows a log.
- Each pane has its own header with a file picker, swap with the main pane, and close (the file stays open as a tab). Ctrl+S, the status bar and the sidebar follow the pane that has focus.
- Large files, the Markdown preview and Auto tables all work inside panes.
- On phones the panes stack.
- Limits: a file is shown in one pane at a time; "By time" needs both panes to be logs with timestamps.

## 0.6.1

- Fixed: "Copy as table" (and Copy CSV, Copy table, Copy as rich text, Copy name, and copying lines in large files) did nothing but show an error when the browser refuses clipboard permission. That happens when Tracepad is embedded in another page and on managed browsers where the permission is switched off. Copying now uses a way that needs no permission, only your click.

## 0.6.0

Tables that survive pasting, and a Markdown preview.

- Paste a table from an AI chat, a web page or Excel into a Markdown or plain-text tab and it arrives as a clean, aligned Markdown table instead of a jumble. Headings, lists, links, bold text and code blocks from rich text are kept as Markdown in Markdown tabs.
- Plain text works too: tab-separated, comma-separated and space-aligned columns (such as kubectl output) become tables, including headers like "p95 (ms)" and headers of several words.
- Ordinary sentences and code are never touched, and code, log and CSV files never convert anything. Each conversion shows a notice with "Paste plain text instead". The switch "Convert pasted tables" is under Appearance.
- On phones, where the keyboard may insert the clipboard without a paste event, a table arriving in one go is recognised the same way.
- Markdown preview (Alt+P, or the button in the top bar on Markdown files): live as you type, and scrolling either side moves the other to the same place.
- Tables in the preview sort when you click a header (up, down, back to the original order; numbers sort as numbers). Each table has "Copy table" (pastes as a real table into Excel, Outlook, Teams and Word) and "Edit as table", a small grid editor that writes the table back neatly aligned.
- "Copy as rich text" copies the whole preview with its formatting for Teams, Outlook or Word.
- Drag the preview's edge to resize it (20% to 85%; double-click for half and half). The width is remembered.
- Preview full screen: the button, a double-click on its header, or Alt+Shift+P. Wider column, larger text, the file name on top. Esc leaves.
- The preview is safe: HTML written in the document is shown as text, nothing in it can run, and pictures from the internet are not loaded (Tracepad makes no network requests).
- Limits: the preview is for editor tabs (not large files) and shows the first 1.5 million characters of very long documents; whether the preview is open is not remembered across reloads.

## 0.5.0

Tables from logs.

- Auto tables (the "Auto tables" button above a log, or Alt+T): Tracepad learns the message patterns in the log by itself and builds one table per pattern. Nothing to configure.
- The patterns are listed with their counts and level colour, with the variable parts highlighted; pick one to see its table beside the list. The list can be filtered.
- Columns are named from the words around the values: "took 84ms" becomes "took (ms)", "orderId=90001" becomes orderId, "moved from PAID to SHIPPED by ravi" gives from / to / by, "CPU_USAGE=64%" becomes "CPU_USAGE (%)". Time, level, thread and logger appear when they vary, plus the trace ID. Error tables add "exception" and "caused by". JSON logs add their other fields. Access logs get one request table with a route column such as /api/orders/{id}.
- Rows stay in file order, and clicking a row takes you to that line. Number columns show min, average, p95 and max.
- For each table: Count by value, Copy as table (pastes as a real table into Excel, Outlook, Teams and Word), Copy CSV, Open as new tab, Filter log to these lines, and Pop out table into its own window.
- Extract (sidebar, Tables): response times, SQL statements, Kafka offsets, IP addresses, timestamps, or your own regular expression where named groups become columns.
- A results panel at the bottom keeps several results open as tabs. Drag its top edge to resize, double-click to reset, maximise it, or go full screen (Esc leaves, after any open dialog or palette has closed).
- Find in all open tabs (Ctrl+Shift+F) and Count duplicate lines.
- All of this also works on large files.
- Limits: a table shows at most 200,000 rows (the count is still exact); copying is limited to 50,000 rows and the pop-out window to 20,000.

## 0.4.0

Large files and live files.

- Files over 64 MB now open, in a read-only viewer that never loads the file into memory. A 500 MB log is ready in a few seconds and scrolls instantly. The timeline, level colours, every filter, F8, Go to line and Log insights work the same as for small files.
- Find (Ctrl+F) searches the whole file on disk and steps through the matching lines.
- Click a line number, Shift+click another, and Ctrl+C copies that range.
- Files over 1 GB ask first: open the last 500 MB (the recent entries, quick) or all of it. Above 3 GB only the last part can be opened.
- Linked files that change on disk now update by themselves. New lines are added in place without moving your view, unless you were at the end, in which case the view follows. A rewritten file is reloaded and undo brings the old text back. If you have unsaved edits you are asked whether to reload or keep your version. If the file disappears you get one notice.
- Follow (status bar, or "Follow file" in the palette) keeps the end of a growing file in view, like tail -f.
- Linked large files come back after a reload like other tabs.
- Limits: large files are read-only; UTF-8 and Latin-1 only; no highlight rules, minimap or stack-trace folding there yet. A text filter on a file that is still growing re-reads the file each time it grows.

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
