import { supabase } from './supabase'

// Storage bucket names
export const BUCKETS = {
  FF3_ATTACHMENTS: 'ff3-attachments',
  FF4_ATTACHMENTS: 'ff4-attachments',
  QUOTATIONS: 'quotations',
} as const

export type BucketName = typeof BUCKETS[keyof typeof BUCKETS]

export type UploadedFile = {
  id: string
  name: string
  size: number
  type: string
  url: string
  path: string
  uploadedAt: string
}

// Generate a unique file path
function generateFilePath(bucket: BucketName, recordId: string, fileName: string): string {
  const timestamp = Date.now()
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
  return `${recordId}/${timestamp}-${sanitizedName}`
}

// Upload a file to Supabase Storage
export async function uploadFile(
  bucket: BucketName,
  recordId: string,
  file: File
): Promise<UploadedFile> {
  const filePath = generateFilePath(bucket, recordId, file.name)

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: false,
    })

  if (error) {
    console.error('Upload error:', error)
    throw new Error(`Failed to upload file: ${error.message}`)
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(data.path)

  return {
    id: data.id || data.path,
    name: file.name,
    size: file.size,
    type: file.type,
    url: urlData.publicUrl,
    path: data.path,
    uploadedAt: new Date().toISOString(),
  }
}

// Upload multiple files
export async function uploadFiles(
  bucket: BucketName,
  recordId: string,
  files: File[]
): Promise<UploadedFile[]> {
  const uploadPromises = files.map(file => uploadFile(bucket, recordId, file))
  return Promise.all(uploadPromises)
}

// Delete a file from storage
export async function deleteFile(bucket: BucketName, path: string): Promise<void> {
  const { error } = await supabase.storage
    .from(bucket)
    .remove([path])

  if (error) {
    console.error('Delete error:', error)
    throw new Error(`Failed to delete file: ${error.message}`)
  }
}

// List files in a folder
export async function listFiles(bucket: BucketName, folder: string): Promise<UploadedFile[]> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(folder, {
      sortBy: { column: 'created_at', order: 'desc' },
    })

  if (error) {
    console.error('List error:', error)
    throw new Error(`Failed to list files: ${error.message}`)
  }

  return (data || []).map(file => {
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(`${folder}/${file.name}`)

    return {
      id: file.id || file.name,
      name: file.name,
      size: file.metadata?.size || 0,
      type: file.metadata?.mimetype || 'application/octet-stream',
      url: urlData.publicUrl,
      path: `${folder}/${file.name}`,
      uploadedAt: file.created_at || new Date().toISOString(),
    }
  })
}

// Download a file
export async function downloadFile(bucket: BucketName, path: string): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(path)

  if (error) {
    console.error('Download error:', error)
    throw new Error(`Failed to download file: ${error.message}`)
  }

  return data
}

// Get signed URL for private files (expires after specified seconds)
export async function getSignedUrl(
  bucket: BucketName,
  path: string,
  expiresIn: number = 3600
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn)

  if (error) {
    console.error('Signed URL error:', error)
    throw new Error(`Failed to get signed URL: ${error.message}`)
  }

  return data.signedUrl
}

// Validate file before upload
export function validateFile(
  file: File,
  options: {
    maxSizeMB?: number
    allowedTypes?: string[]
  } = {}
): { valid: boolean; error?: string } {
  const { maxSizeMB = 10, allowedTypes } = options

  // Check file size
  const maxSizeBytes = maxSizeMB * 1024 * 1024
  if (file.size > maxSizeBytes) {
    return {
      valid: false,
      error: `File size exceeds ${maxSizeMB}MB limit`,
    }
  }

  // Check file type
  if (allowedTypes && allowedTypes.length > 0) {
    const fileType = file.type.toLowerCase()
    const isAllowed = allowedTypes.some(type => {
      if (type.endsWith('/*')) {
        return fileType.startsWith(type.replace('/*', '/'))
      }
      return fileType === type
    })

    if (!isAllowed) {
      return {
        valid: false,
        error: `File type not allowed. Allowed types: ${allowedTypes.join(', ')}`,
      }
    }
  }

  return { valid: true }
}

// Common allowed file types
export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]
