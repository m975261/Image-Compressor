import { z } from "zod";

export const conversionModes = ["yalla_ludo", "custom"] as const;
export type ConversionMode = typeof conversionModes[number];

export const conversionRequestSchema = z.object({
  mode: z.enum(conversionModes),
  maxFileSize: z.number().min(0.1).max(50).optional(),
  targetWidth: z.number().min(1).max(2000).optional(),
  targetHeight: z.number().min(1).max(2000).optional(),
});

export type ConversionRequest = z.infer<typeof conversionRequestSchema>;

export const conversionResultSchema = z.object({
  id: z.string(),
  originalSize: z.number(),
  finalSize: z.number(),
  originalWidth: z.number(),
  originalHeight: z.number(),
  finalWidth: z.number(),
  finalHeight: z.number(),
  frameCount: z.number(),
  downloadUrl: z.string(),
  previewUrl: z.string(),
  downloadFilename: z.string(),
  success: z.boolean(),
  error: z.string().optional(),
});

export type ConversionResult = z.infer<typeof conversionResultSchema>;

export const uploadedFileSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string(),
  downloadUrl: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export type UploadedFile = z.infer<typeof uploadedFileSchema>;

export const fileUploadRequestSchema = z.object({
  expiryHours: z.number().min(0.1).max(24).default(24),
});

export type FileUploadRequest = z.infer<typeof fileUploadRequestSchema>;

export const users = {} as any;
export const insertUserSchema = z.object({
  username: z.string(),
  password: z.string(),
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = { id: string; username: string; password: string };

// Temp Drive schemas
export const tempDriveAdminSchema = z.object({
  passwordHash: z.string(),
  totpSecret: z.string().nullable(),
  totpSetupComplete: z.boolean(),
  createdAt: z.string(),
});
export type TempDriveAdmin = z.infer<typeof tempDriveAdminSchema>;

export const tempDriveFileSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  diskFileName: z.string().optional(),
  fileSize: z.number(),
  mimeType: z.string(),
  uploadedAt: z.string(),
  uploadedBy: z.enum(["admin", "share"]),
});
export type TempDriveFile = z.infer<typeof tempDriveFileSchema>;

export const tempDriveShareSchema = z.object({
  id: z.string(),
  token: z.string(),
  passwordHash: z.string(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  active: z.boolean(),
});
export type TempDriveShare = z.infer<typeof tempDriveShareSchema>;

export const tempDriveSessionSchema = z.object({
  token: z.string(),
  type: z.enum(["admin", "share"]),
  shareId: z.string().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type TempDriveSession = z.infer<typeof tempDriveSessionSchema>;

export const adminLoginRequestSchema = z.object({
  password: z.string().min(1, "Password is required"),
  otp: z.string().optional(),
});
export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

export const shareCreateRequestSchema = z.object({
  password: z.string().min(1, "Share password is required"),
  expiryMinutes: z.number().min(1).nullable(),
});
export type ShareCreateRequest = z.infer<typeof shareCreateRequestSchema>;

export const shareAccessRequestSchema = z.object({
  password: z.string().min(1, "Password is required"),
});
export type ShareAccessRequest = z.infer<typeof shareAccessRequestSchema>;

export const storageStatusSchema = z.object({
  usedBytes: z.number(),
  totalBytes: z.number(),
  usedPercentage: z.number(),
  warning: z.boolean(),
});
export type StorageStatus = z.infer<typeof storageStatusSchema>;
