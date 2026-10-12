import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import { ValidationFailedError } from '../http/validation.js';

/** The longest text a document may hold (the same limit as writing one by hand). */
export const MAX_EXTRACTED_CHARS = 200_000;
/** A PDF with more pages is refused before its text is read: reading costs CPU. */
export const MAX_PDF_PAGES = 100;

export interface UploadedFile {
  buffer: Buffer;
  filename: string;
}

export interface ExtractedText {
  title: string;
  content: string;
}

const refuse = (message: string): never => {
  throw new ValidationFailedError([{ path: 'file', message }]);
};

/**
 * Text of an uploaded .txt or .pdf file, ready to become a document. The kind is decided by
 * what the bytes are, not by the name or the type the client claims. Nothing is stored here.
 */
export async function extractText(file: UploadedFile): Promise<ExtractedText> {
  const raw = isPdf(file.buffer) ? await pdfText(file.buffer) : textFile(file);
  const content = tidy(raw);
  if (content === '') return refuse('The file contains no text that can be used (a scanned PDF has none).');
  if (content.length > MAX_EXTRACTED_CHARS) {
    return refuse(`The text is too long: a document holds at most ${MAX_EXTRACTED_CHARS.toLocaleString('en-US')} characters.`);
  }
  return { title: titleFrom(file.filename), content };
}

const isPdf = (buffer: Buffer) => buffer.subarray(0, 1024).includes('%PDF-');

function textFile({ buffer, filename }: UploadedFile): string {
  if (!/\.txt$/i.test(filename)) return refuse('Only .txt or .pdf files can be uploaded.');
  if (buffer.includes(0)) return refuse('This file is not a text file.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer); // also drops a byte order mark
  } catch {
    return refuse('This file is not a text file (it is not valid UTF-8).');
  }
}

async function pdfText(buffer: Buffer): Promise<string> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer));
    if (pdf.numPages > MAX_PDF_PAGES) {
      return refuse(`The PDF has too many pages: at most ${MAX_PDF_PAGES} are accepted.`);
    }
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  } catch (error) {
    if (error instanceof ValidationFailedError) throw error;
    // The parser's own messages say nothing useful to a person (and are not ours to show).
    return refuse('The PDF could not be read. It may be damaged or protected.');
  } finally {
    await pdf?.loadingTask?.destroy().catch(() => undefined); // frees the parser's memory and worker state
  }
}

/** Storable, tidy text: no NUL, no broken characters, Unix line ends, no runs of blank lines. */
function tidy(text: string): string {
  return text
    .replaceAll('\u0000', '')
    .toWellFormed()
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function titleFrom(filename: string): string {
  // Browsers send UTF-8 names that multer reads as Latin-1; undo that when it gives readable text.
  const decoded = Buffer.from(filename, 'latin1').toString('utf8');
  const name = decoded.includes('�') ? filename : decoded;
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '').trim();
  return (base || 'Untitled').slice(0, 200);
}
