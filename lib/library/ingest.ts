// 知识库 ingestion orchestrator. Two-phase by design: extraction is awaited by
// the submitting request (seconds), AI indexing is fire-and-forget via a
// dynamic import of ./indexer. Dedup: canonical sourceUrl first, contentHash
// (sha256 of original bytes) second. Once the doc row exists, extraction
// failures are recorded on the row (status failed + processingError) and NOT
// rethrown — the uploader sees the failure and can retry.

import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import { prisma } from '@/lib/db';
import { CHUNKER_VERSION, chunkChapterText } from './chunker';
import { canonicalizeUrl } from './canonical-url';
import { extractArticle } from './extract-html';
import { extractEpub } from './extract-epub';
import { extractPdf } from './extract-pdf';
import { FetchUrlError, fetchBinary, fetchPage } from './fetch-url';
import { uniqueDocSlug } from './slug';
import {
  MAX_COVER_BYTES,
  deleteLibraryFile,
  libraryAbsPath,
  libraryPublicUrl,
  newLibraryKey,
  saveLibraryBuffer,
} from './storage';
import {
  countWords,
  detectLanguage,
  estReadMinutesForText,
  type ExtractedDoc,
  type LibraryDocTypeValue,
} from './types';

export type IngestDocType = LibraryDocTypeValue | 'auto';

type IngestErrorCode = 'invalid_url' | 'fetch_failed' | 'too_large' | 'unsupported_content';

export class IngestError extends Error {
  code: IngestErrorCode;

  constructor(code: IngestErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'IngestError';
    this.code = code;
  }
}

interface IngestResult {
  id: string;
  slug: string;
  status: string;
  existing: boolean;
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Kick the one-time AI reading without blocking or creating an import cycle. */
function triggerIndexing(docId: string): void {
  void import('./indexer')
    .then((m) => m.runDocIndexing(docId))
    .catch((e) => console.error('[library] failed to start indexing', e));
}

/** Provisional title before extraction: last meaningful URL path segment, else host. */
function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop();
    if (seg) {
      let words = seg;
      try {
        words = decodeURIComponent(seg);
      } catch {
        // keep raw
      }
      words = words.replace(/\.(html?|php|aspx?|shtml)$/i, '').replace(/[-_+]+/g, ' ').trim();
      if (words.length >= 3) return words;
    }
    return u.hostname;
  } catch {
    return '未命名文档';
  }
}

function coverExtFor(contentType: string, url: string): string {
  const byMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  const mime = byMime[contentType.toLowerCase()];
  if (mime) return mime;
  const m = url.match(/\.(jpe?g|png|webp|gif)(?:$|\?)/i);
  if (m) return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  return 'jpg';
}

/** Best-effort remote cover download → stored cover key → coverUrl update. */
async function downloadCover(docId: string, coverRemoteUrl: string): Promise<void> {
  try {
    const fetched = await fetchBinary(coverRemoteUrl, MAX_COVER_BYTES);
    if (!fetched) return;
    const key = newLibraryKey('cover', coverExtFor(fetched.contentType, coverRemoteUrl));
    await saveLibraryBuffer(key, fetched.buf);
    await prisma.libraryDoc.update({
      where: { id: docId },
      data: { coverUrl: libraryPublicUrl(key) },
    });
  } catch (e) {
    console.error('[library] cover download failed', e);
  }
}

async function saveCoverBuffer(docId: string, data: Buffer, ext: string): Promise<void> {
  try {
    const key = newLibraryKey('cover', ext);
    await saveLibraryBuffer(key, data);
    await prisma.libraryDoc.update({
      where: { id: docId },
      data: { coverUrl: libraryPublicUrl(key) },
    });
  } catch (e) {
    console.error('[library] cover save failed', e);
  }
}

const epubImageSaver = async (data: Buffer, ext: string): Promise<string | null> => {
  try {
    const key = newLibraryKey('image', ext);
    await saveLibraryBuffer(key, data);
    return libraryPublicUrl(key);
  } catch {
    return null;
  }
};

/**
 * Replace the doc's chapters/chunks with a fresh extraction and flip it to
 * ready — one transaction (60s budget: whole books write thousands of chunks).
 */
async function persistExtraction(docId: string, extracted: ExtractedDoc): Promise<void> {
  const allText = extracted.chapters.map((c) => c.text).join('\n\n');
  const wordCount = extracted.chapters.reduce((n, c) => n + countWords(c.text), 0);

  await prisma.$transaction(
    async (tx) => {
      await tx.libraryChunk.deleteMany({ where: { docId } });
      await tx.libraryChapter.deleteMany({ where: { docId } });

      await tx.libraryChapter.createMany({
        data: extracted.chapters.map((c, i) => ({
          docId,
          chapterIndex: i,
          title: c.title,
          html: c.html,
          charCount: c.text.length,
        })),
      });

      const chunks = extracted.chapters.flatMap((c, i) => chunkChapterText(i, c.text));
      if (chunks.length > 0) {
        await tx.libraryChunk.createMany({
          data: chunks.map((chunk) => ({
            docId,
            chapterIndex: chunk.chapterIndex,
            ordinal: chunk.ordinal,
            text: chunk.text,
            tokenEstimate: chunk.tokenEstimate,
            charStart: chunk.charStart,
            charEnd: chunk.charEnd,
          })),
        });
      }

      await tx.libraryDoc.update({
        where: { id: docId },
        data: {
          title: extracted.title,
          author: extracted.author,
          language: extracted.language ?? detectLanguage(allText),
          siteName: extracted.siteName,
          publishedAt: extracted.publishedAt,
          wordCount,
          estReadMinutes: allText ? estReadMinutesForText(allText) : 0,
          chapterCount: extracted.chapters.length,
          chunkerVersion: CHUNKER_VERSION,
          status: 'ready',
          processingError: null,
        },
      });
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

async function markFailed(docId: string, e: unknown): Promise<void> {
  const message = e instanceof Error ? e.message : String(e);
  await prisma.libraryDoc
    .update({
      where: { id: docId },
      data: { status: 'failed', processingError: message.slice(0, 500) },
    })
    .catch(() => undefined);
}

export async function createDocFromUrl(opts: {
  url: string;
  uploaderId: string;
  docType: IngestDocType;
}): Promise<IngestResult> {
  const canonical = canonicalizeUrl(opts.url);
  if (!canonical) throw new IngestError('invalid_url', '链接格式无效，请提交 http(s) 网页链接');

  const bySource = await prisma.libraryDoc.findFirst({
    where: { sourceUrl: canonical, deletedAt: null },
    select: { id: true, slug: true, status: true },
  });
  if (bySource) return { ...bySource, existing: true };

  let page: { html: string; finalUrl: string };
  try {
    page = await fetchPage(canonical);
  } catch (e) {
    if (e instanceof FetchUrlError) throw new IngestError(e.code, e.message);
    throw new IngestError('fetch_failed', (e as Error).message);
  }

  const contentHash = sha256Hex(page.html);
  const byHash = await prisma.libraryDoc.findFirst({
    where: { contentHash, deletedAt: null },
    select: { id: true, slug: true, status: true },
  });
  if (byHash) return { ...byHash, existing: true };

  const provisionalTitle = titleFromUrl(canonical);
  const slug = await uniqueDocSlug(provisionalTitle);
  const doc = await prisma.libraryDoc.create({
    data: {
      slug,
      title: provisionalTitle,
      format: 'url',
      status: 'processing',
      sourceUrl: canonical,
      contentHash,
      uploaderId: opts.uploaderId,
      docType: opts.docType === 'auto' ? 'article' : opts.docType,
      docTypePinned: opts.docType !== 'auto',
    },
    select: { id: true, slug: true },
  });

  let status = 'ready';
  try {
    const extracted = extractArticle(page.html, page.finalUrl);
    await persistExtraction(doc.id, extracted);
    if (extracted.coverRemoteUrl) await downloadCover(doc.id, extracted.coverRemoteUrl);
    triggerIndexing(doc.id);
  } catch (e) {
    await markFailed(doc.id, e);
    status = 'failed';
  }

  return { id: doc.id, slug: doc.slug, status, existing: false };
}

export async function createDocFromFile(opts: {
  fileKey: string;
  format: 'pdf' | 'epub';
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploaderId: string;
  docType: IngestDocType;
}): Promise<IngestResult> {
  const full = libraryAbsPath(opts.fileKey);
  if (!full) throw new IngestError('unsupported_content', '文件路径无效');
  let buf: Buffer;
  try {
    buf = await fsp.readFile(full);
  } catch {
    throw new IngestError('unsupported_content', '无法读取上传的文件');
  }

  const contentHash = sha256Hex(buf);
  const byHash = await prisma.libraryDoc.findFirst({
    where: { contentHash, deletedAt: null },
    select: { id: true, slug: true, status: true },
  });
  if (byHash) {
    await deleteLibraryFile(opts.fileKey);
    return { ...byHash, existing: true };
  }

  const fallbackType: LibraryDocTypeValue = opts.format === 'epub' ? 'book' : 'paper';
  const provisionalTitle =
    opts.filename.replace(/\.(pdf|epub)$/i, '').trim() || '未命名文档';
  const slug = await uniqueDocSlug(provisionalTitle);

  const doc = await prisma.libraryDoc.create({
    data: {
      slug,
      title: provisionalTitle,
      format: opts.format,
      status: 'processing',
      fileKey: opts.fileKey,
      fileUrl: libraryPublicUrl(opts.fileKey),
      mimeType: opts.mimeType,
      fileSizeBytes: opts.sizeBytes,
      contentHash,
      uploaderId: opts.uploaderId,
      docType: opts.docType === 'auto' ? fallbackType : opts.docType,
      docTypePinned: opts.docType !== 'auto',
    },
    select: { id: true, slug: true },
  });

  let status = 'ready';
  try {
    const extracted =
      opts.format === 'pdf' ? await extractPdf(buf) : await extractEpub(buf, epubImageSaver);
    if (!extracted.title) extracted.title = provisionalTitle;
    await persistExtraction(doc.id, extracted);
    if (extracted.coverBuffer) {
      await saveCoverBuffer(doc.id, extracted.coverBuffer.data, extracted.coverBuffer.ext);
    }
    triggerIndexing(doc.id);
  } catch (e) {
    await markFailed(doc.id, e);
    status = 'failed';
  }

  return { id: doc.id, slug: doc.slug, status, existing: false };
}

/**
 * Re-run extraction for an existing doc (URL refetch or stored-file re-read).
 * Never throws — failures land on the row. AI fields are left alone; the
 * indexer decides staleness via aiSourceHash vs contentHash.
 */
export async function reprocessDoc(docId: string): Promise<void> {
  const doc = await prisma.libraryDoc
    .findUnique({
      where: { id: docId },
      select: {
        id: true,
        format: true,
        sourceUrl: true,
        fileKey: true,
        deletedAt: true,
        coverUrl: true,
      },
    })
    .catch(() => null);
  if (!doc || doc.deletedAt) return;

  try {
    await prisma.libraryDoc.update({
      where: { id: docId },
      data: { status: 'processing', processingError: null },
    });

    let extracted: ExtractedDoc;
    if (doc.format === 'url') {
      if (!doc.sourceUrl) throw new Error('该文档没有可重新抓取的来源链接');
      const page = await fetchPage(doc.sourceUrl);
      extracted = extractArticle(page.html, page.finalUrl);
      await prisma.libraryDoc.update({
        where: { id: docId },
        data: { contentHash: sha256Hex(page.html) },
      });
      await persistExtraction(docId, extracted);
      if (!doc.coverUrl && extracted.coverRemoteUrl) {
        await downloadCover(docId, extracted.coverRemoteUrl);
      }
    } else {
      if (!doc.fileKey) throw new Error('原始文件缺失，无法重新处理');
      const full = libraryAbsPath(doc.fileKey);
      if (!full) throw new Error('原始文件路径无效');
      const buf = await fsp.readFile(full);
      extracted =
        doc.format === 'pdf' ? await extractPdf(buf) : await extractEpub(buf, epubImageSaver);
      if (!extracted.title) {
        const current = await prisma.libraryDoc.findUnique({
          where: { id: docId },
          select: { title: true },
        });
        extracted.title = current?.title ?? '未命名文档';
      }
      await persistExtraction(docId, extracted);
      if (!doc.coverUrl && extracted.coverBuffer) {
        await saveCoverBuffer(docId, extracted.coverBuffer.data, extracted.coverBuffer.ext);
      }
    }

    triggerIndexing(docId);
  } catch (e) {
    await markFailed(docId, e);
  }
}
