"use client"

import { useState, useRef, useCallback } from "react"
import { Upload, X, FileText, Image, File, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { uploadFile, validateFile, ALLOWED_DOCUMENT_TYPES, type BucketName, type UploadedFile } from "@/lib/storage"

type FileUploadProps = {
  bucket: BucketName
  recordId: string
  onUploadComplete?: (file: UploadedFile) => void
  onUploadError?: (error: string) => void
  maxSizeMB?: number
  allowedTypes?: string[]
  multiple?: boolean
  label?: string
  description?: string
  className?: string
}

type FileWithStatus = {
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
  uploadedFile?: UploadedFile
}

export function FileUpload({
  bucket,
  recordId,
  onUploadComplete,
  onUploadError,
  maxSizeMB = 10,
  allowedTypes = ALLOWED_DOCUMENT_TYPES,
  multiple = false,
  label = "Upload File",
  description = "PDF, JPG, PNG up to 10MB",
  className = "",
}: FileUploadProps) {
  const [files, setFiles] = useState<FileWithStatus[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(async (selectedFiles: FileList | null) => {
    if (!selectedFiles || selectedFiles.length === 0) return

    const fileArray = Array.from(selectedFiles)
    const filesToProcess = multiple ? fileArray : [fileArray[0]]

    // Validate and add files
    const newFiles: FileWithStatus[] = filesToProcess.map(file => {
      const validation = validateFile(file, { maxSizeMB, allowedTypes })
      return {
        file,
        status: validation.valid ? 'pending' : 'error',
        progress: 0,
        error: validation.error,
      }
    })

    setFiles(prev => multiple ? [...prev, ...newFiles] : newFiles)

    // Upload valid files
    for (const fileItem of newFiles) {
      if (fileItem.status === 'error') continue

      setFiles(prev =>
        prev.map(f =>
          f.file === fileItem.file ? { ...f, status: 'uploading' } : f
        )
      )

      try {
        const uploadedFile = await uploadFile(bucket, recordId, fileItem.file)

        setFiles(prev =>
          prev.map(f =>
            f.file === fileItem.file
              ? { ...f, status: 'success', progress: 100, uploadedFile }
              : f
          )
        )

        onUploadComplete?.(uploadedFile)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Upload failed'

        setFiles(prev =>
          prev.map(f =>
            f.file === fileItem.file
              ? { ...f, status: 'error', error: errorMessage }
              : f
          )
        )

        onUploadError?.(errorMessage)
      }
    }
  }, [bucket, recordId, maxSizeMB, allowedTypes, multiple, onUploadComplete, onUploadError])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <Image className="h-5 w-5 text-blue-500" />
    if (type === 'application/pdf') return <FileText className="h-5 w-5 text-red-500" />
    return <File className="h-5 w-5 text-slate-500" />
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className={className}>
      {/* Drop Zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
          ${isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
          }
        `}
      >
        <Upload className={`h-8 w-8 mx-auto mb-2 ${isDragging ? 'text-blue-500' : 'text-slate-400'}`} />
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className="text-xs text-slate-500 mt-1">{description}</p>
        <p className="text-xs text-slate-400 mt-2">Click or drag and drop</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={allowedTypes.join(',')}
        multiple={multiple}
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />

      {/* File List */}
      {files.length > 0 && (
        <div className="mt-4 space-y-2">
          {files.map((fileItem, index) => (
            <div
              key={index}
              className={`
                flex items-center gap-3 p-3 rounded-lg border
                ${fileItem.status === 'error' ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}
              `}
            >
              {getFileIcon(fileItem.file.type)}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">
                  {fileItem.file.name}
                </p>
                <p className="text-xs text-slate-500">
                  {formatFileSize(fileItem.file.size)}
                </p>
              </div>

              {fileItem.status === 'uploading' && (
                <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
              )}

              {fileItem.status === 'success' && (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              )}

              {fileItem.status === 'error' && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  <span className="text-xs text-red-600">{fileItem.error}</span>
                </div>
              )}

              <button
                onClick={(e) => {
                  e.stopPropagation()
                  removeFile(index)
                }}
                className="p-1 hover:bg-slate-200 rounded"
              >
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Simple file display component for viewing uploaded files
type FileListProps = {
  files: UploadedFile[]
  onDelete?: (file: UploadedFile) => void
  showDelete?: boolean
}

export function FileList({ files, onDelete, showDelete = false }: FileListProps) {
  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <Image className="h-5 w-5 text-blue-500" />
    if (type === 'application/pdf') return <FileText className="h-5 w-5 text-red-500" />
    return <File className="h-5 w-5 text-slate-500" />
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (files.length === 0) {
    return (
      <p className="text-sm text-slate-500 italic">No files uploaded</p>
    )
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <div
          key={file.id}
          className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200"
        >
          {getFileIcon(file.type)}

          <div className="flex-1 min-w-0">
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-blue-600 hover:text-blue-700 truncate block"
            >
              {file.name}
            </a>
            <p className="text-xs text-slate-500">
              {formatFileSize(file.size)}
            </p>
          </div>

          {showDelete && onDelete && (
            <button
              onClick={() => onDelete(file)}
              className="p-1 hover:bg-red-100 rounded text-red-500"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
