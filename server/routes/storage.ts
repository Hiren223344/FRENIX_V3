import { Router, Request, Response } from 'express';
import {
  isSupabaseConfigured,
  uploadToStorage,
  listStorageFiles,
  getStoragePublicUrl,
  createSignedDownloadUrl,
  deleteStorageFiles,
  createStorageBucket,
  DEFAULT_BUCKET,
} from '../services/supabaseStorage.js';

const storageRouter = Router();

/**
 * 1. Storage Status Check
 * GET /api/storage/status
 */
storageRouter.get('/status', (_req: Request, res: Response) => {
  const configured = isSupabaseConfigured();
  res.json({
    success: true,
    service: 'Supabase Storage Integration',
    configured,
    defaultBucket: DEFAULT_BUCKET,
    message: configured
      ? 'Supabase Storage is fully configured and ready.'
      : 'Supabase credentials not yet supplied in .env (running in simulated fallback mode).',
  });
});

/**
 * 2. Upload File to Storage
 * POST /api/storage/upload
 * Body: { bucket?: string, path: string, content: string (base64 or text), contentType?: string, isBase64?: boolean }
 */
storageRouter.post('/upload', async (req: Request, res: Response) => {
  try {
    const { bucket, path, content, contentType, isBase64 } = req.body;

    if (!path || !content) {
      return res.status(400).json({
        success: false,
        message: 'Both path (file target path) and content are required.',
      });
    }

    let fileBuffer: Buffer;
    if (isBase64 || content.startsWith('data:')) {
      const cleanBase64 = content.includes(',') ? content.split(',')[1] : content;
      fileBuffer = Buffer.from(cleanBase64, 'base64');
    } else {
      fileBuffer = Buffer.from(content, 'utf-8');
    }

    const result = await uploadToStorage({
      bucket: bucket || DEFAULT_BUCKET,
      filePath: path,
      fileBuffer,
      contentType: contentType || 'application/octet-stream',
      upsert: true,
    });

    return res.status(200).json(result);
  } catch (err: unknown) {
    console.error('Storage upload error:', err);
    const message = err instanceof Error ? err.message : 'Storage upload failed';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * 3. List Files in Bucket
 * GET /api/storage/files?bucket=assets&folder=models
 */
storageRouter.get('/files', async (req: Request, res: Response) => {
  try {
    const bucket = (req.query.bucket as string) || DEFAULT_BUCKET;
    const folder = (req.query.folder as string) || '';

    const result = await listStorageFiles(bucket, folder);
    return res.status(200).json(result);
  } catch (err: unknown) {
    console.error('Storage list error:', err);
    const message = err instanceof Error ? err.message : 'Storage listing failed';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * 4. Get File URL (Public or Signed)
 * GET /api/storage/url?bucket=assets&path=sample.png&signed=false
 */
storageRouter.get('/url', async (req: Request, res: Response) => {
  try {
    const bucket = (req.query.bucket as string) || DEFAULT_BUCKET;
    const filePath = req.query.path as string;
    const signed = req.query.signed === 'true';
    const expiresIn = parseInt((req.query.expiresIn as string) || '3600', 10);

    if (!filePath) {
      return res.status(400).json({
        success: false,
        message: 'Query parameter "path" is required.',
      });
    }

    if (signed) {
      const result = await createSignedDownloadUrl(bucket, filePath, expiresIn);
      return res.status(200).json(result);
    } else {
      const result = getStoragePublicUrl(bucket, filePath);
      return res.status(200).json(result);
    }
  } catch (err: unknown) {
    console.error('Storage URL error:', err);
    const message = err instanceof Error ? err.message : 'Failed to retrieve storage URL';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * 5. Delete Files
 * DELETE /api/storage/files
 * Body: { bucket?: string, paths: string[] }
 */
storageRouter.delete('/files', async (req: Request, res: Response) => {
  try {
    const { bucket, paths } = req.body;

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({
        success: false,
        message: '"paths" array is required and cannot be empty.',
      });
    }

    const result = await deleteStorageFiles(bucket || DEFAULT_BUCKET, paths);
    return res.status(200).json(result);
  } catch (err: unknown) {
    console.error('Storage delete error:', err);
    const message = err instanceof Error ? err.message : 'Storage deletion failed';
    return res.status(500).json({ success: false, error: message });
  }
});

/**
 * 6. Create Bucket
 * POST /api/storage/buckets
 * Body: { name: string, isPublic?: boolean }
 */
storageRouter.post('/buckets', async (req: Request, res: Response) => {
  try {
    const { name, isPublic } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Bucket "name" string is required.',
      });
    }

    const result = await createStorageBucket(name, isPublic ?? true);
    return res.status(200).json(result);
  } catch (err: unknown) {
    console.error('Storage create bucket error:', err);
    const message = err instanceof Error ? err.message : 'Bucket creation failed';
    return res.status(500).json({ success: false, error: message });
  }
});

export default storageRouter;
