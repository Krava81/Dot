import MarkdownIt from 'markdown-it';

const mdParser = new MarkdownIt({ breaks: true, html: true, linkify: true });

mdParser.inline.ruler.after('escape', 'spoiler', (state, silent) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x7C || state.src.charCodeAt(start + 1) !== 0x7C) return false;
  const match = state.src.slice(start + 2).match(/^([\s\S]+?)\|\|/);
  if (!match) return false;
  if (!silent) {
    const token = state.push('spoiler_open', 'tg-spoiler', 1);
    state.pos += 2;
    // @ts-ignore
    state.md.inline.tokenize(state);
    state.push('spoiler_close', 'tg-spoiler', -1);
    state.pos = start + match[0].length;
  } else {
    state.pos += match[0].length;
  }
  return true;
});

let md = "Hello\n\n  Indented paragraph\n\n**bold** and *italic*\n\n||spoiler||";
let html = mdParser.render(md);
    
html = html.replace(/<p>/g, '').replace(/<\/p>/g, '\n\n');
html = html.replace(/<br\s*\/?>/g, '\n');
html = html.replace(/^ +/gm, (match) => '&nbsp;'.repeat(match.length));
html = html.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '<b>$1</b>\n\n');
html = html.replace(/<ul>/g, '').replace(/<\/ul>/g, '\n');
html = html.replace(/<ol>/g, '').replace(/<\/ol>/g, '\n');
html = html.replace(/<li>/g, '• ').replace(/<\/li>/g, '\n');
html = html.trim();

console.log(html);
