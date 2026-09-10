// Dedicated, bounded parser process. No application credentials are passed in its environment.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > 10 * 1024 * 1024) throw new Error("File limit");
  chunks.push(chunk);
}
const task = getDocument({
  data: new Uint8Array(Buffer.concat(chunks)),
  useSystemFonts: false,
  stopAtErrors: true,
});
try {
  const pdf = await task.promise;
  if (pdf.numPages > 100) throw new Error("Page limit");
  const pages = [];
  let length = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((x) => x.str + (x.hasEOL ? "\n" : " "))
      .join("");
    length += text.length;
    if (length > 2 * 1024 * 1024) throw new Error("Text limit");
    pages.push(text);
    page.cleanup();
  }
  process.stdout.write(JSON.stringify(pages));
} finally {
  await task.destroy();
}
