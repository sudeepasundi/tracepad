// Markdown to safe HTML for the preview. Raw HTML in the document is shown as
// text (never interpreted), the result is sanitised as well, and remote images
// are not loaded: Tracepad makes no network requests.
import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });

// Every block remembers its source line, for scroll sync and "Edit as table".
md.core.ruler.push('tp_source_lines', (state) => {
  for (const token of state.tokens) {
    if (!token.map || token.nesting < 0) continue;
    token.attrSet('data-line', String(token.map[0] + 1));
    if (token.type === 'table_open') token.attrSet('data-end', String(token.map[1] + 1));
  }
});

const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return defaultLink(tokens, idx, options, env, self);
};

const defaultImage = md.renderer.rules.image!;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const src = String(tokens[idx].attrGet('src') ?? '');
  if (/^data:image\/(png|jpeg|gif|webp);/i.test(src)) return defaultImage(tokens, idx, options, env, self);
  const alt = md.utils.escapeHtml(tokens[idx].content || 'image');
  return `<span class="tp-md-img" title="${md.utils.escapeHtml(src)}">[image: ${alt}]</span>`;
};

/** Longest document rendered in one go; beyond this the preview shows the beginning and says so. */
export const PREVIEW_LIMIT = 1_500_000;

export function renderMarkdown(text: string): string {
  const html = md.render(text.length > PREVIEW_LIMIT ? text.slice(0, PREVIEW_LIMIT) : text);
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['target', 'data-line', 'data-end'], FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'] });
}
