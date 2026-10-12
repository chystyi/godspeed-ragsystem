import { describe, expect, it } from 'vitest';
import { makePdf } from '../../test/make-pdf.js';
import { ValidationFailedError } from '../http/validation.js';
import { extractText, MAX_EXTRACTED_CHARS, MAX_PDF_PAGES } from './text-extraction.js';

const txt = (text: string | Buffer, name = 'notes.txt') => extractText({ buffer: Buffer.from(text), filename: name });
const rejection = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ValidationFailedError);
  return (error as ValidationFailedError).issues[0].message;
};

describe('text files', () => {
  it('returns the text, with the file name (without extension) as the title', async () => {
    expect(await txt('Hello\r\nworld\r\n', 'Router setup.txt')).toEqual({ title: 'Router setup', content: 'Hello\nworld' });
  });

  it('removes a byte order mark and reads non-Latin text', async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Привет, мир — 你好')]);
    expect((await txt(bytes)).content).toBe('Привет, мир — 你好');
  });

  it('refuses a file that is not text (binary, or not valid UTF-8)', async () => {
    expect(await rejection(txt(Buffer.from([0x89, 0x00, 0x01, 0x02])))).toMatch(/text/i);
    expect(await rejection(txt(Buffer.from([0xc3, 0x28])))).toMatch(/text/i);
  });

  it('refuses an empty file', async () => {
    expect(await rejection(txt('  \n '))).toMatch(/no text/i);
  });

  it('refuses text longer than a document may be', async () => {
    expect(await rejection(txt('x'.repeat(MAX_EXTRACTED_CHARS + 1)))).toMatch(/too long/i);
  });
});

describe('PDF files', () => {
  it('extracts the text of all pages in order', async () => {
    const pdf = makePdf([['First page line one', 'line two'], ['Second page']]);
    const { content, title } = await extractText({ buffer: pdf, filename: 'Guide.PDF' });
    expect(title).toBe('Guide');
    expect(content.indexOf('First page line one')).toBeGreaterThanOrEqual(0);
    expect(content.indexOf('Second page')).toBeGreaterThan(content.indexOf('line two'));
  });

  it('is recognised by its content, not by its name', async () => {
    const { content } = await extractText({ buffer: makePdf([['Disguised']]), filename: 'notes.txt' });
    expect(content).toContain('Disguised');
  });

  it('refuses a damaged PDF without leaking parser details', async () => {
    const message = await rejection(extractText({ buffer: Buffer.from('%PDF-1.4\nthis is not a pdf'), filename: 'x.pdf' }));
    expect(message).toMatch(/could not be read/i);
    expect(message).not.toMatch(/pdfjs|stack|invalid/i);
  });

  it('refuses a PDF without any text (a scan)', async () => {
    expect(await rejection(extractText({ buffer: makePdf([['']]), filename: 'scan.pdf' }))).toMatch(/no text/i);
  });

  it('refuses a PDF with too many pages before reading them', async () => {
    const pdf = makePdf(Array.from({ length: MAX_PDF_PAGES + 1 }, (_, i) => [`page ${i}`]));
    expect(await rejection(extractText({ buffer: pdf, filename: 'big.pdf' }))).toMatch(/pages/i);
  });

  it('refuses extracted text longer than a document may be', async () => {
    const line = 'abcdefghij '.repeat(4); // 44 characters
    const pdf = makePdf(Array.from({ length: MAX_PDF_PAGES }, () => Array.from({ length: 50 }, () => line)));
    expect(await rejection(extractText({ buffer: pdf, filename: 'long.pdf' }))).toMatch(/too long/i);
  }, 30000);
});

describe('other files', () => {
  it('refuses unsupported types', async () => {
    const message = await rejection(extractText({ buffer: Buffer.from('PK\u0003\u0004zip'), filename: 'a.docx' }));
    expect(message).toMatch(/\.txt or \.pdf/);
  });
});
