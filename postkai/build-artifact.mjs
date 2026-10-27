// Builds dist/artifact.html: the app as one self-contained page for claude.ai,
// where it uses Claude through the viewer's account instead of server.mjs.
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(`public/${f}`, import.meta.url), 'utf8');
const html = read('index.html');
const icon = 'data:image/svg+xml;base64,' + Buffer.from(read('icon.svg')).toString('base64');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'))
  .replaceAll('src="icon.svg"', `src="${icon}"`);
const fonts = html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];

const page = `<title>โพสต์ขาย</title>
${fonts}
<style>
${read('style.css')}
</style>
${body.trim()}
<script type="module">
${read('app.js')}
</script>
`;
fs.mkdirSync(new URL('dist/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('dist/artifact.html', import.meta.url), page);
console.log('dist/artifact.html', page.length, 'bytes');
