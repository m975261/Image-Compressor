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
