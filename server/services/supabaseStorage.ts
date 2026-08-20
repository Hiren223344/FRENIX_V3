import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Dynamic Configuration Helpers
export function getSupabaseUrl(): string {
  return (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    'https://kknwnvtqmyncaotbrryv.supabase.co'
  );
}

export function getSupabaseKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    'sb_publishable_Wl5rWwaVSzdrWeg0Y4Rr_A_AqP_bLV-'
  );
}

export const DEFAULT_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'assets';

let supabaseClientInstance: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  return Boolean(
    url &&
      !url.includes('your-project-id') &&
      key &&
      !key.includes('your-supabase-')
  );
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (!supabaseClientInstance) {
    const url = getSupabaseUrl();
    const key = getSupabaseKey();
    supabaseClientInstance = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: fetch,
      },
      realtime: {
        transport: class StandaloneWebSocket {
          onopen: any = null;
          onclose: any = null;
          onerror: any = null;
          onmessage: any = null;
          readyState = 3;
          send() {}
          close() {}
        } as any,
      },
    });
  }
  return supabaseClientInstance;
}

export interface UploadOptions {
  bucket?: string;
  filePath: string;
  fileBuffer: Buffer | Uint8Array | ArrayBuffer | string;
  contentType?: string;
  upsert?: boolean;
}

export interface StorageFileItem {
  name: string;
  id?: string;
  updated_at?: string;
  created_at?: string;
  last_accessed_at?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Upload a file to Supabase Storage
 */
export async function uploadToStorage(options: UploadOptions) {
  const client = getSupabaseClient();
  const bucket = options.bucket || DEFAULT_BUCKET;

  if (!client) {
    // Simulated storage response when Supabase credentials are pending
    const simulatedUrl = `https://mock-storage.supabase.co/storage/v1/object/public/${bucket}/${options.filePath}`;
    return {
      success: true,
      simulated: true,
      bucket,
      path: options.filePath,
      publicUrl: simulatedUrl,
      message: 'Supabase credentials not yet configured in .env; simulated upload successful.',
    };
  }

  const { data, error } = await client.storage
    .from(bucket)
    .upload(options.filePath, options.fileBuffer, {
      contentType: options.contentType || 'application/octet-stream',
      upsert: options.upsert ?? true,
    });

  if (error) {
    throw new Error(`Supabase Storage Upload Error: ${error.message}`);
  }

  const { data: publicUrlData } = client.storage.from(bucket).getPublicUrl(options.filePath);

  return {
    success: true,
    simulated: false,
    bucket,
    path: data.path,
    publicUrl: publicUrlData.publicUrl,
  };
}

/**
 * List files inside a bucket / folder
 */
export async function listStorageFiles(bucket: string = DEFAULT_BUCKET, folder: string = '') {
  const client = getSupabaseClient();

  if (!client) {
    return {
      success: true,
      simulated: true,
      bucket,
      folder,
      files: [
        { name: 'sample-intelligence-model.json', created_at: new Date().toISOString() },
        { name: 'avatar-default.webp', created_at: new Date().toISOString() },
      ],
      message: 'Supabase credentials not configured in .env. Returning sample items.',
    };
  }

  const { data, error } = await client.storage.from(bucket).list(folder, {
    limit: 100,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  });

  if (error) {
    throw new Error(`Supabase Storage List Error: ${error.message}`);
  }

  return {
    success: true,
    simulated: false,
    bucket,
    folder,
    files: data as StorageFileItem[],
  };
}

/**
 * Get Public URL for a stored file
 */
export function getStoragePublicUrl(bucket: string = DEFAULT_BUCKET, filePath: string) {
  const client = getSupabaseClient();

  if (!client) {
    return {
      success: true,
      publicUrl: `https://mock-storage.supabase.co/storage/v1/object/public/${bucket}/${filePath}`,
      simulated: true,
    };
  }

  const { data } = client.storage.from(bucket).getPublicUrl(filePath);
  return {
    success: true,
    publicUrl: data.publicUrl,
    simulated: false,
  };
}

/**
 * Create a temporary signed download URL for private files
 */
export async function createSignedDownloadUrl(
  bucket: string = DEFAULT_BUCKET,
  filePath: string,
  expiresInSeconds: number = 3600
) {
  const client = getSupabaseClient();

  if (!client) {
    return {
      success: true,
      signedUrl: `https://mock-storage.supabase.co/storage/v1/object/sign/${bucket}/${filePath}?token=simulated_token`,
      expiresIn: expiresInSeconds,
      simulated: true,
    };
  }

  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(filePath, expiresInSeconds);

  if (error) {
    throw new Error(`Supabase Storage Signed URL Error: ${error.message}`);
  }

  return {
    success: true,
    signedUrl: data.signedUrl,
    expiresIn: expiresInSeconds,
    simulated: false,
  };
}

/**
 * Delete one or more files from Supabase Storage
 */
export async function deleteStorageFiles(bucket: string = DEFAULT_BUCKET, filePaths: string[]) {
  const client = getSupabaseClient();

  if (!client) {
    return {
      success: true,
      simulated: true,
      deleted: filePaths,
      message: 'Simulated deletion successful.',
    };
  }

  const { data, error } = await client.storage.from(bucket).remove(filePaths);

  if (error) {
    throw new Error(`Supabase Storage Delete Error: ${error.message}`);
  }

  return {
    success: true,
    simulated: false,
    deleted: data,
  };
}

/**
 * Create / Ensure a Storage Bucket exists
 */
export async function createStorageBucket(bucketName: string, isPublic: boolean = true) {
  const client = getSupabaseClient();

  if (!client) {
    return {
      success: true,
      simulated: true,
      bucket: bucketName,
      isPublic,
      message: 'Simulated bucket creation successful.',
    };
  }

  const { data, error } = await client.storage.createBucket(bucketName, {
    public: isPublic,
  });

  if (error) {
    // If already exists, treat as success
    if (error.message.includes('already exists') || error.message.includes('Duplicate')) {
      return {
        success: true,
        bucket: bucketName,
        message: 'Bucket already exists.',
      };
    }
    throw new Error(`Supabase Bucket Creation Error: ${error.message}`);
  }

  return {
    success: true,
    bucket: data.name,
    isPublic,
  };
}
